"""
arkAI adaptive layer: circuit breaker + learning scoreboard.

Circuit breaker (per warm instance): a model that fails 3 times in a row is
benched for 3 minutes so requests stop wasting time on it; a success resets
its record. This keeps the cascade fast and avoids hammering a dead quota.

Learning scoreboard: anonymous, aggregate-only counters per (intent, model):
thumbs up/down, regenerate-away events. NO prompts, NO answers, NO user data
are ever stored. The router nudges rankings by observed win-rate, so arkAI
literally routes smarter the more it is used. Counters live in memory and,
when a hosted KV is configured (UPSTASH_REDIS_REST_URL/TOKEN or Vercel KV's
KV_REST_API_URL/TOKEN), they persist server-side across restarts - nothing
is ever written to the user's device.
"""

import json
import os
import threading
import time
from typing import Any, Dict, List, Tuple

# ------------------------------------------------------------ circuit breaker
_FAILS: Dict[str, Dict[str, Any]] = {}
_BENCH_SECONDS = 180
_FAIL_THRESHOLD = 3
_lock = threading.Lock()


def is_benched(model_id: str) -> bool:
    with _lock:
        rec = _FAILS.get(model_id)
        if not rec:
            return False
        return rec.get("benched_until", 0) > time.time()


def record_failure(model_id: str) -> None:
    with _lock:
        rec = _FAILS.setdefault(model_id, {"fails": 0, "benched_until": 0})
        rec["fails"] = rec.get("fails", 0) + 1
        if rec["fails"] >= _FAIL_THRESHOLD:
            rec["benched_until"] = time.time() + _BENCH_SECONDS
            rec["fails"] = 0


def record_success(model_id: str) -> None:
    with _lock:
        _FAILS.pop(model_id, None)


def breaker_snapshot() -> Dict[str, Any]:
    now = time.time()
    with _lock:
        return {m: {"benched_for_s": max(0, int(r.get("benched_until", 0) - now))}
                for m, r in _FAILS.items() if r.get("benched_until", 0) > now}


# ------------------------------------------------------------ scoreboard
_SCORES: Dict[str, Dict[str, int]] = {}
_KV_URL = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL") or ""
_KV_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN") or ""
_KV_KEY = "arkai:scoreboard:v1"
_kv_loaded = False
_feedback_count = 0


def _key(intent: str, model: str) -> str:
    return f"{intent}::{model}"


def learning_enabled() -> bool:
    return True  # in-memory always on; KV persistence is additive


def kv_configured() -> bool:
    return bool(_KV_URL and _KV_TOKEN)


async def _kv_load_once() -> None:
    global _kv_loaded
    if _kv_loaded or not kv_configured():
        return
    _kv_loaded = True
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
            resp = await client.get(f"{_KV_URL}/get/{_KV_KEY}",
                                    headers={"Authorization": f"Bearer {_KV_TOKEN}"})
            data = resp.json()
            raw = (data or {}).get("result")
            if raw:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    with _lock:
                        for k, v in parsed.items():
                            if isinstance(v, dict):
                                _SCORES[k] = {"up": int(v.get("up", 0)),
                                              "down": int(v.get("down", 0)),
                                              "regen": int(v.get("regen", 0))}
    except Exception:
        pass  # persistence is best-effort; in-memory learning continues


async def _kv_save() -> None:
    if not kv_configured():
        return
    try:
        import httpx
        with _lock:
            snapshot = json.dumps(_SCORES)
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
            await client.post(f"{_KV_URL}/set/{_KV_KEY}",
                              headers={"Authorization": f"Bearer {_KV_TOKEN}"},
                              content=snapshot)
    except Exception:
        pass


async def record_feedback(intent: str, model: str, event: str) -> Dict[str, int]:
    """event: 'up' | 'down' | 'regen' (user regenerated away from this model)."""
    global _feedback_count
    await _kv_load_once()
    field = {"up": "up", "down": "down", "regen": "regen", "regenerate": "regen"}.get(event)
    if not model or field is None:
        return {}
    with _lock:
        rec = _SCORES.setdefault(_key(intent or "general", model),
                                 {"up": 0, "down": 0, "regen": 0})
        rec[field] = rec.get(field, 0) + 1
        _feedback_count += 1
        count = _feedback_count
    if kv_configured() and count % 3 == 0:
        await _kv_save()
    return dict(rec)


def winrate(intent: str, model: str) -> float:
    """Laplace-smoothed success estimate from feedback; 0.5 when unknown."""
    with _lock:
        rec = _SCORES.get(_key(intent or "general", model))
    if not rec:
        return 0.5
    up = rec.get("up", 0)
    down = rec.get("down", 0) + rec.get("regen", 0)
    return (up + 1) / (up + down + 2)


def apply_learning(intent: str, ordered_models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Nudge the base ranking by observed win-rate (max ~1.2 positions).
    With no feedback data the order is returned untouched."""
    if not ordered_models:
        return ordered_models
    keyed: List[Tuple[float, int, Dict[str, Any]]] = []
    for idx, m in enumerate(ordered_models):
        adj = (winrate(intent, m["id"]) - 0.5) * 2 * 1.2
        keyed.append((idx - adj, idx, m))
    keyed.sort(key=lambda t: (t[0], t[1]))
    return [m for _, _, m in keyed]


def scoreboard_snapshot() -> Dict[str, Any]:
    with _lock:
        return {"entries": len(_SCORES), "scores": dict(_SCORES),
                "kv_persistence": kv_configured()}
