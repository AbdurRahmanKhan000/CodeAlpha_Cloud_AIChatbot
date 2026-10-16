"""
arkAI - Sub-2ms Heuristic Router + Free Multi-Model Orchestrator

1. classify_prompt_intent(): pre-compiled regex classifier (<2ms) that
   labels a prompt code / math_logic / creative / general.
2. execute_orchestrated_chat(): walks the intent's ranked logical models
   (see config.INTENT_RANKINGS), calling free anonymous gateways in order
   until one answers. Every failure (429/503/timeout/quota) cascades to
   the next model. `exclude_models` powers Regenerate: models already
   tried for the prompt are never repeated.
3. Own-Key mode: when the caller supplies their own API key, ONLY that
   provider is called (its own ranked models) - never the free pool.
"""

import re
import time
import json
import asyncio
from typing import Dict, Any, List, Optional, Tuple

try:
    import httpx
except ImportError:
    httpx = None

import urllib.request
import urllib.error

try:
    from api.config import (
        FREE_GATEWAYS, MODEL_CATALOG, MODEL_REGISTRY, INTENT_RANKINGS,
        OWN_KEY_PROVIDERS, ranked_models_for_intent, detect_provider_from_key,
    )
except ImportError:
    from config import (
        FREE_GATEWAYS, MODEL_CATALOG, MODEL_REGISTRY, INTENT_RANKINGS,
        OWN_KEY_PROVIDERS, ranked_models_for_intent, detect_provider_from_key,
    )

# ---------------------------------------------------------------- classifier
CODE_PATTERNS = [
    r"\b(def\s+\w+|function\s*\(|function\s+\w+|class\s+\w+|async\s+def|return\s+\S+)\b",
    r"\b(const\s+\w+|let\s+\w+|var\s+\w+|import\s+\w+|from\s+[\w\.]+\s+import|export\s+(default|const|let|var|function|class))\b",
    r"\b(python|javascript|typescript|react|vue|angular|node|express|fastapi|django|flask)\b",
    r"\b(c\+\+|c#|golang|rust|java|kotlin|swift|php|ruby|scala|sql|nosql|postgres|mysql|sqlite)\b",
    r"\b(html|css|tailwind|scss|json|yaml|xml|bash|shell|zsh|docker|kubernetes|git|github)\b",
    r"\b(code|coding|script|algorithm|refactor|debug|compile|syntax|regex|syntax error)\b",
    r"\b(bug|error|exception|traceback|stacktrace|segfault|undefined|nullpointer|fix this code)\b",
    r"\b(api|rest|graphql|sdk|endpoint|crud|webhook|npm|pip|cargo|composer)\b",
    r"```[\s\S]*?```",
    r"=>|===|!==|!=|==|\+=|-=|\*=|/=|::",
]
MATH_LOGIC_PATTERNS = [
    r"\b(math|mathematics|algebra|calculus|geometry|trigonometry|arithmetic|derivative|integral)\b",
    r"\b(calculate|computation|solve|equation|formula|matrix|vector|probability|statistics|theorem)\b",
    r"\b(logic|deduction|premise|syllogism|riddle|puzzle|proof|prove that|counterexample)\b",
    r"\b(step[- ]by[- ]step|think step by step|chain of thought|reasoning|deep reasoning)\b",
    r"\b(why is|how does it work logically|scientific method|hypothesis|analyze the paradox)\b",
    r"[0-9]+\s*[\+\-\*\/\^%]\s*[0-9]+",
    r"\b(log_2|sqrt|pi|summation|infinity|factorial)\b",
]
CREATIVE_PATTERNS = [
    r"\b(essay|story|poem|poetry|novel|narrative|dialogue|scriptwriting|screenplay)\b",
    r"\b(email|letter|proposal|pitch|press release|memo|newsletter|cover letter|resume)\b",
    r"\b(blog|article|content|copywriting|headline|slogan|marketing|social media post)\b",
    r"\b(write a|compose|draft|brainstorm|rewrite|paraphrase|summarize|critique|rephrase)\b",
    r"\b(creative|metaphor|analogy|tone of voice|persuasive|formal tone|informal tone)\b",
]
COMPILED_CODE_REGEX = [re.compile(p, re.IGNORECASE) for p in CODE_PATTERNS]
COMPILED_MATH_REGEX = [re.compile(p, re.IGNORECASE) for p in MATH_LOGIC_PATTERNS]
COMPILED_CREATIVE_REGEX = [re.compile(p, re.IGNORECASE) for p in CREATIVE_PATTERNS]


def classify_prompt_intent(prompt: str) -> Tuple[str, str, float]:
    """Returns (category, best_logical_model_id, routing_time_ms)."""
    start_ns = time.perf_counter_ns()
    text = (prompt or "").strip()

    def done(category: str):
        elapsed = (time.perf_counter_ns() - start_ns) / 1_000_000.0
        best = ranked_models_for_intent(category)
        return category, (best[0]["id"] if best else MODEL_CATALOG[0]["id"]), round(elapsed, 3)

    if not text:
        return done("general")
    for pattern in COMPILED_CODE_REGEX:
        if pattern.search(text):
            return done("code")
    for pattern in COMPILED_MATH_REGEX:
        if pattern.search(text):
            return done("math_logic")
    for pattern in COMPILED_CREATIVE_REGEX:
        if pattern.search(text):
            return done("creative")
    return done("general")


# ---------------------------------------------------------------- transport
async def _post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str],
                     timeout_seconds: float) -> Tuple[int, Any]:
    """POST JSON, via httpx when present, else urllib in a thread."""
    if httpx is not None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds), trust_env=False) as client:
            resp = await client.post(url, json=payload, headers=headers)
            try:
                return resp.status_code, resp.json()
            except Exception:
                return resp.status_code, {"raw": resp.text[:300]}

    def _sync() -> Tuple[int, Any]:
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as he:
            body = he.read().decode("utf-8", errors="replace") if he.fp else ""
            try:
                return he.code, json.loads(body)
            except Exception:
                return he.code, {"raw": body[:300]}
        except Exception as e:
            return 0, {"error": str(e)}

    return await asyncio.to_thread(_sync)


def _extract_openai_content(data: Any) -> str:
    if isinstance(data, dict):
        choices = data.get("choices") or []
        if choices:
            msg = choices[0].get("message") or {}
            return (msg.get("content") or "").strip()
    return ""


async def _call_gateway_model(logical: Dict[str, Any], messages: List[Dict[str, str]],
                              temperature: float) -> Tuple[bool, str, str]:
    """One free-gateway attempt. Returns (ok, content, error_reason)."""
    gateway = FREE_GATEWAYS[logical["gateway"]]
    headers = {"Content-Type": "application/json"}
    payload = {"model": logical["upstream_model"], "messages": messages,
               "temperature": temperature}
    try:
        status, data = await _post_json(gateway["endpoint"], payload, headers,
                                        gateway["timeout_seconds"])
    except Exception as e:
        return False, "", f"{e.__class__.__name__}: {e}"
    if status != 200:
        err = ""
        if isinstance(data, dict):
            e = data.get("error")
            err = str(e.get("message") if isinstance(e, dict) else (e or data.get("raw") or ""))[:160]
        return False, "", f"HTTP {status} {err}".strip()
    content = _extract_openai_content(data)
    if not content:
        return False, "", "Empty response from model"
    return True, content, ""


async def _call_own_key(provider: str, api_key: str, messages: List[Dict[str, str]],
                        temperature: float, exclude_models: List[str] = None
                        ) -> Dict[str, Any]:
    """Own-Key mode: call ONLY the user's provider, its models in order."""
    spec = OWN_KEY_PROVIDERS[provider]
    exclude = set(exclude_models or [])
    history: List[Dict[str, Any]] = []
    for model in spec["models"]:
        logical_id = f"ownkey/{provider}/{model}"
        if logical_id in exclude or model in exclude:
            continue
        start_ns = time.perf_counter_ns()
        if provider == "claude":
            headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01",
                       "Content-Type": "application/json"}
            sys_msgs = [m["content"] for m in messages if m["role"] == "system"]
            chat = [{"role": ("assistant" if m["role"] == "assistant" else "user"),
                     "content": m["content"]} for m in messages if m["role"] != "system"]
            payload = {"model": model, "max_tokens": 4096, "temperature": temperature,
                       "messages": chat}
            if sys_msgs:
                payload["system"] = "\n".join(sys_msgs)
        else:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"model": model, "messages": messages, "temperature": temperature}
        try:
            status, data = await _post_json(spec["endpoint"], payload, headers, 45.0)
        except Exception as e:
            history.append({"model": logical_id, "reason": str(e)})
            continue
        latency = round((time.perf_counter_ns() - start_ns) / 1_000_000.0, 2)
        content = ""
        if provider == "claude" and isinstance(data, dict):
            blocks = data.get("content") or []
            if blocks:
                content = (blocks[0].get("text") or "").strip()
        else:
            content = _extract_openai_content(data)
        if status == 200 and content:
            return {"response": content, "model_used": logical_id, "model_name": model,
                    "model_badge": spec["name"], "gateway": provider,
                    "gateway_name": spec["name"], "provider_status": "success",
                    "status": "success", "failover_count": len(history),
                    "failover_history": history, "mode": "own_key",
                    "total_latency_ms": latency}
        err = ""
        if isinstance(data, dict):
            e = data.get("error")
            err = str(e.get("message") if isinstance(e, dict) else (e or ""))[:160]
        history.append({"model": logical_id, "status_code": status,
                        "latency_ms": latency, "reason": err or f"HTTP {status}"})
    return {"response": "Your API key's provider did not return an answer. "
                        "Check the key and provider in Settings, then try again.",
            "model_used": f"ownkey/{provider}", "model_name": spec["name"],
            "model_badge": spec["name"], "gateway": provider, "gateway_name": spec["name"],
            "provider_status": "exhausted", "status": "exhausted",
            "failover_count": len(history), "failover_history": history, "mode": "own_key"}


# ---------------------------------------------------------------- orchestrator
async def execute_orchestrated_chat(
    messages: List[Dict[str, str]],
    intent: str = "general",
    exclude_models: List[str] = None,
    api_key_override: str = "",
    provider: str = "",
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
) -> Dict[str, Any]:
    """
    The arkAI orchestrator.
    - Own-Key mode (api_key_override set): only that provider is used.
    - Free mode (default): ranked free logical models for the intent,
      skipping exclude_models (Regenerate), first success wins.
    """
    overall_start_ns = time.perf_counter_ns()
    effective = list(messages)
    if system_prompt:
        if not effective or effective[0].get("role") != "system":
            effective.insert(0, {"role": "system", "content": system_prompt})

    if (api_key_override or "").strip():
        detected = detect_provider_from_key(api_key_override, provider)
        result = await _call_own_key(detected, api_key_override.strip(), effective,
                                     temperature, exclude_models)
        result["total_latency_ms"] = round(
            (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0, 2)
        ranked = [f"ownkey/{detected}/{m}" for m in OWN_KEY_PROVIDERS[detected]["models"]]
        tried = list(exclude_models or []) + [result["model_used"]]
        remaining = [m for m in ranked if m not in tried]
        result["next_model"] = remaining[0] if remaining else None
        result["tried_models"] = tried
        return result

    ranked = ranked_models_for_intent(intent, exclude=exclude_models)
    failover_history: List[Dict[str, Any]] = []
    for logical in ranked:
        start_ns = time.perf_counter_ns()
        ok, content, reason = await _call_gateway_model(logical, effective, temperature)
        latency = round((time.perf_counter_ns() - start_ns) / 1_000_000.0, 2)
        if ok:
            tried = list(exclude_models or []) + [logical["id"]]
            remaining = ranked_models_for_intent(intent, exclude=tried)
            return {
                "response": content,
                "model_used": logical["id"],
                "model_name": logical["name"],
                "model_badge": logical["badge"],
                "gateway": logical["gateway"],
                "gateway_name": FREE_GATEWAYS[logical["gateway"]]["name"],
                "provider_family": logical["provider_family"],
                "provider_status": "success",
                "status": "success",
                "mode": "arkai_free",
                "failover_count": len(failover_history),
                "failover_history": failover_history,
                "next_model": remaining[0]["id"] if remaining else None,
                "next_model_name": remaining[0]["name"] if remaining else None,
                "tried_models": tried,
                "total_latency_ms": round(
                    (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0, 2),
                "model_latency_ms": latency,
            }
        failover_history.append({"model": logical["id"], "gateway": logical["gateway"],
                                 "latency_ms": latency, "reason": reason})

    total = round((time.perf_counter_ns() - overall_start_ns) / 1_000_000.0, 2)
    return {
        "response": ("All free AI gateways are busy right now. arkAI tried "
                     f"{len(failover_history)} model(s) across Pollinations and LLM7. "
                     "Please press Regenerate in a moment, or add your own API key in Settings."),
        "model_used": "none", "model_name": "All free models busy",
        "model_badge": "Failover Exhausted", "gateway": "none", "gateway_name": "-",
        "provider_status": "exhausted", "status": "exhausted", "mode": "arkai_free",
        "failover_count": len(failover_history), "failover_history": failover_history,
        "next_model": None, "tried_models": list(exclude_models or []),
        "total_latency_ms": total,
    }


# ---------------------------------------------------------------- streaming
class _StreamOpenError(Exception):
    def __init__(self, status: int, message: str = ""):
        super().__init__(message or f"HTTP {status}")
        self.status = status


def _parse_sse_delta(line: str) -> str:
    """Extract delta text from one OpenAI-style SSE line."""
    if not line.startswith("data:"):
        return ""
    data = line[5:].strip()
    if not data or data == "[DONE]":
        return ""
    try:
        obj = json.loads(data)
        choices = obj.get("choices") or []
        if choices:
            delta = choices[0].get("delta") or choices[0].get("message") or {}
            return delta.get("content") or ""
    except Exception:
        return ""
    return ""


async def _stream_post_lines(url: str, payload: Dict[str, Any],
                             headers: Dict[str, str], timeout_seconds: float):
    """Async generator of raw response lines from a streaming POST.
    Raises _StreamOpenError on HTTP error status (before any content)."""
    if httpx is not None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds), trust_env=False) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")[:200]
                    raise _StreamOpenError(resp.status_code, body)
                async for line in resp.aiter_lines():
                    yield line
        return

    queue: "asyncio.Queue" = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _sync_worker():
        try:
            req = urllib.request.Request(
                url, data=json.dumps(payload).encode("utf-8"),
                headers={**headers, "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=timeout_seconds) as r:
                for raw in r:
                    loop.call_soon_threadsafe(queue.put_nowait, raw.decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as he:
            body = he.read().decode("utf-8", errors="replace") if he.fp else ""
            loop.call_soon_threadsafe(queue.put_nowait, _StreamOpenError(he.code, body[:200]))
        except Exception as e:  # noqa: BLE001
            loop.call_soon_threadsafe(queue.put_nowait, e)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    asyncio.get_running_loop().run_in_executor(None, _sync_worker)
    while True:
        item = await queue.get()
        if item is None:
            return
        if isinstance(item, Exception):
            raise item
        yield item


async def _stream_gateway_model(logical, messages, temperature):
    """Yield deltas from one free gateway model; raises before first delta on failure."""
    gateway = FREE_GATEWAYS[logical["gateway"]]
    payload = {"model": logical["upstream_model"], "messages": messages,
               "temperature": temperature, "stream": True}
    got_any = False
    async for line in _stream_post_lines(gateway["endpoint"], payload,
                                         {"Content-Type": "application/json"},
                                         gateway["timeout_seconds"] + 60):
        delta = _parse_sse_delta(line)
        if delta:
            got_any = True
            yield delta
    if not got_any:
        raise _StreamOpenError(502, "Empty stream from model")


async def execute_orchestrated_chat_stream(
    messages, intent="general", exclude_models=None, api_key_override="",
    provider="", system_prompt=None, temperature=0.7,
):
    """Streaming twin of execute_orchestrated_chat. Yields event dicts:
    {type:'meta', ...} once a model starts answering, {type:'delta', content}
    per token chunk, and a final {type:'done', ...result}."""
    overall_start_ns = time.perf_counter_ns()
    effective = list(messages)
    if system_prompt:
        if not effective or effective[0].get("role") != "system":
            effective.insert(0, {"role": "system", "content": system_prompt})

    def _done(result):
        result["type"] = "done"
        result["total_latency_ms"] = round(
            (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0, 2)
        return result

    # Own-Key mode: OpenAI-compatible providers stream; Claude falls back to
    # one-shot delivery emitted as a single delta.
    if (api_key_override or "").strip():
        detected = detect_provider_from_key(api_key_override, provider)
        spec = OWN_KEY_PROVIDERS[detected]
        if detected == "claude":
            result = await _call_own_key(detected, api_key_override.strip(), effective,
                                         temperature, exclude_models)
            ranked = [f"ownkey/{detected}/{m}" for m in spec["models"]]
            tried = list(exclude_models or []) + [result["model_used"]]
            remaining = [m for m in ranked if m not in tried]
            result["next_model"] = remaining[0] if remaining else None
            result["tried_models"] = tried
            yield {"type": "meta", "model_used": result["model_used"],
                   "model_name": result["model_name"], "model_badge": result["model_badge"],
                   "gateway": detected, "gateway_name": spec["name"], "mode": "own_key"}
            if result["response"]:
                yield {"type": "delta", "content": result["response"]}
            yield _done(result)
            return
        headers = {"Authorization": f"Bearer {api_key_override.strip()}",
                   "Content-Type": "application/json"}
        history = []
        for model in spec["models"]:
            logical_id = f"ownkey/{detected}/{model}"
            if logical_id in (exclude_models or []) or model in (exclude_models or []):
                continue
            payload = {"model": model, "messages": effective,
                       "temperature": temperature, "stream": True}
            collected = ""
            try:
                yield {"type": "meta", "model_used": logical_id, "model_name": model,
                       "model_badge": spec["name"], "gateway": detected,
                       "gateway_name": spec["name"], "mode": "own_key"}
                async for line in _stream_post_lines(spec["endpoint"], payload, headers, 120):
                    delta = _parse_sse_delta(line)
                    if delta:
                        collected += delta
                        yield {"type": "delta", "content": delta}
                if not collected:
                    raise _StreamOpenError(502, "Empty stream")
            except Exception as e:  # noqa: BLE001
                if collected:
                    pass  # mid-stream failure: keep what arrived
                else:
                    history.append({"model": logical_id, "reason": str(e)})
                    continue
            ranked = [f"ownkey/{detected}/{m}" for m in spec["models"]]
            tried = list(exclude_models or []) + [logical_id]
            remaining = [m for m in ranked if m not in tried]
            yield _done({
                "response": collected, "model_used": logical_id, "model_name": model,
                "model_badge": spec["name"], "gateway": detected,
                "gateway_name": spec["name"], "provider_status": "success",
                "status": "success", "mode": "own_key",
                "failover_count": len(history), "failover_history": history,
                "next_model": remaining[0] if remaining else None,
                "tried_models": tried})
            return
        yield _done({
            "response": "Your API key's provider did not return an answer. "
                        "Check the key and provider in Settings, then try again.",
            "model_used": f"ownkey/{detected}", "model_name": spec["name"],
            "model_badge": spec["name"], "gateway": detected,
            "gateway_name": spec["name"], "provider_status": "exhausted",
            "status": "exhausted", "mode": "own_key",
            "failover_count": len(history), "failover_history": history,
            "next_model": None, "tried_models": list(exclude_models or [])})
        return

    ranked = ranked_models_for_intent(intent, exclude=exclude_models)
    failover_history = []
    for logical in ranked:
        collected = ""
        try:
            announced = False
            async for delta in _stream_gateway_model(logical, effective, temperature):
                if not announced:
                    yield {"type": "meta", "model_used": logical["id"],
                           "model_name": logical["name"], "model_badge": logical["badge"],
                           "gateway": logical["gateway"],
                           "gateway_name": FREE_GATEWAYS[logical["gateway"]]["name"],
                           "provider_family": logical["provider_family"],
                           "mode": "arkai_free"}
                    announced = True
                collected += delta
                yield {"type": "delta", "content": delta}
        except Exception as e:  # noqa: BLE001
            if collected:
                pass
            else:
                failover_history.append({"model": logical["id"],
                                         "gateway": logical["gateway"],
                                         "reason": str(e)})
                continue
        tried = list(exclude_models or []) + [logical["id"]]
        remaining = ranked_models_for_intent(intent, exclude=tried)
        yield _done({
            "response": collected, "model_used": logical["id"],
            "model_name": logical["name"], "model_badge": logical["badge"],
            "gateway": logical["gateway"],
            "gateway_name": FREE_GATEWAYS[logical["gateway"]]["name"],
            "provider_family": logical["provider_family"],
            "provider_status": "success", "status": "success", "mode": "arkai_free",
            "failover_count": len(failover_history),
            "failover_history": failover_history,
            "next_model": remaining[0]["id"] if remaining else None,
            "next_model_name": remaining[0]["name"] if remaining else None,
            "tried_models": tried})
        return

    yield _done({
        "response": ("All free AI gateways are busy right now. arkAI tried "
                     f"{len(failover_history)} model(s) across Pollinations and LLM7. "
                     "Please press Regenerate in a moment, or add your own API key in Settings."),
        "model_used": "none", "model_name": "All free models busy",
        "model_badge": "Failover Exhausted", "gateway": "none", "gateway_name": "-",
        "provider_status": "exhausted", "status": "exhausted", "mode": "arkai_free",
        "failover_count": len(failover_history), "failover_history": failover_history,
        "next_model": None, "tried_models": list(exclude_models or [])})


# ------------------------------------------------------- legacy compat alias
async def execute_openrouter_cascade(messages, primary_model, api_key="",
                                     system_prompt=None, temperature=0.7,
                                     max_retries=4, timeout_seconds=25.0):
    """Backwards-compatible alias: now runs the free orchestrator, or the
    caller's OpenRouter key in Own-Key mode when a key is supplied."""
    intent = "general"
    if messages:
        intent, _, _ = classify_prompt_intent(messages[-1].get("content", ""))
    return await execute_orchestrated_chat(
        messages=messages, intent=intent,
        api_key_override=api_key or "", provider="openrouter" if api_key else "",
        system_prompt=system_prompt, temperature=temperature)
