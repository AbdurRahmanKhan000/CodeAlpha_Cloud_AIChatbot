"""
arkAI local pattern engine (Python port of the TypeScript matcher).

Instant, on-device answers for arkAI's built-in knowledge intents
(pricing, hours, services, refunds, SLA, security, API limits, human
escalation, greetings) - no gateway call, works even when every AI
gateway is busy. Loaded from data/patterns.json.
"""

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

_PATTERNS: List[Dict[str, Any]] = []
_EXACT: Dict[str, Dict[str, Any]] = {}
_REGEXES: List = []
_LOADED = False


def _candidate_paths() -> List[str]:
    here = os.path.dirname(os.path.abspath(__file__))
    return [
        os.path.join(here, "..", "data", "patterns.json"),
        os.path.join(here, "..", "..", "data", "patterns.json"),
        os.path.join(os.getcwd(), "data", "patterns.json"),
        os.path.join(os.getcwd(), "CodeAlpha_AIChatbot", "data", "patterns.json"),
    ]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", (text or "").lower())).strip()


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[-1]


def _similarity(a: str, b: str) -> float:
    if a == b:
        return 100.0
    if abs(len(a) - len(b)) > 8:
        return 0.0
    if sorted(a.split()) == sorted(b.split()):
        return 96.0
    dist = _levenshtein(a, b)
    return max(0.0, (1 - dist / max(len(a), len(b))) * 100.0)


def load_patterns() -> int:
    global _LOADED
    if _LOADED:
        return len(_PATTERNS)
    for path in _candidate_paths():
        try:
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                for item in data.get("intents", []):
                    _PATTERNS.append(item)
                    for trig in item.get("triggers", []) or []:
                        clean = _normalize(trig)
                        if clean:
                            _EXACT[clean] = item
                    for reg in item.get("regex_patterns", []) or []:
                        try:
                            _REGEXES.append((re.compile(reg, re.IGNORECASE), item))
                        except re.error:
                            pass
                break
        except Exception:
            continue
    _LOADED = True
    return len(_PATTERNS)


def patterns_loaded() -> bool:
    load_patterns()
    return len(_PATTERNS) > 0


def intents_count() -> int:
    load_patterns()
    return len(_PATTERNS)


def triggers_count() -> int:
    load_patterns()
    return len(_EXACT)


def list_intents() -> List[Dict[str, Any]]:
    load_patterns()
    return [{"id": p.get("id"), "intent": p.get("intent"),
             "triggers": len(p.get("triggers", []) or [])} for p in _PATTERNS]


def match_intent(query: str, threshold: float = 85.0) -> Dict[str, Any]:
    """Mirror of the TS matchIntent: exact -> regex -> fuzzy similarity."""
    start = time.perf_counter_ns()
    load_patterns()
    clean = _normalize(query or "")

    def done(**kw):
        elapsed_us = (time.perf_counter_ns() - start) / 1000.0
        base = {"matched": False, "confidence": 0, "match_type": "none",
                "execution_time_micros": round(elapsed_us, 2),
                "execution_time_ms": round(elapsed_us / 1000.0, 4)}
        base.update(kw)
        return base

    if not clean:
        return done()

    item = _EXACT.get(clean)
    if item:
        return done(matched=True, intent=item.get("intent"), confidence=100,
                    match_type="exact", matched_trigger=clean,
                    response=item.get("response"),
                    follow_up_suggestions=item.get("follow_up_suggestions"),
                    tags=item.get("tags"))

    for regex, pattern in _REGEXES:
        if regex.search(query or "") or regex.search(clean):
            return done(matched=True, intent=pattern.get("intent"), confidence=95,
                        match_type="regex", matched_trigger=regex.pattern,
                        response=pattern.get("response"),
                        follow_up_suggestions=pattern.get("follow_up_suggestions"),
                        tags=pattern.get("tags"))

    query_words = [w for w in clean.split(" ") if len(w) > 2]
    candidates = set()
    for trig in _EXACT:
        trig_words = set(trig.split(" "))
        if any(w in trig_words for w in query_words):
            candidates.add(trig)
    triggers = list(candidates) if candidates else list(_EXACT)[:20]

    best_score, best_trigger, best_item = 0.0, "", None
    for trig in triggers:
        score = _similarity(clean, trig)
        if score > best_score:
            best_score, best_trigger = score, trig
            best_item = _EXACT.get(trig)
            if best_score >= 95:
                break

    if best_item and best_score >= threshold:
        return done(matched=True, intent=best_item.get("intent"),
                    confidence=round(best_score, 1), match_type="fuzzy",
                    matched_trigger=best_trigger,
                    response=best_item.get("response"),
                    follow_up_suggestions=best_item.get("follow_up_suggestions"),
                    tags=best_item.get("tags"))
    return done()
