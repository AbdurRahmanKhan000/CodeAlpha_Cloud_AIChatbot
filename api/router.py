"""
arkAI - Sub-2ms Zero-Latency Heuristic Router & Automatic Cascade Failover
ARK Ecosystem - "AI Fiesta Engine" for Pure OpenRouter Orchestration
"""

import sys
import os
import re
import time
import json
import asyncio
from typing import Dict, Any, List, Optional, Tuple

# Ensure both project root and api/ directory are accessible in sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
for _p in (_current_dir, _parent_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    import httpx
except ImportError:
    httpx = None

import urllib.request
import urllib.error

try:
    from api.config import (
        OPENROUTER_API_URL,
        FREE_MODEL_POOL,
        MODEL_REGISTRY,
        get_next_fallback_model,
        resolve_effective_key,
        is_demo_mode,
        get_demo_mode_response,
    )
except ImportError:
    from config import (
        OPENROUTER_API_URL,
        FREE_MODEL_POOL,
        MODEL_REGISTRY,
        get_next_fallback_model,
        resolve_effective_key,
        is_demo_mode,
        get_demo_mode_response,
    )

# ==============================================================================
# SUB-2MS HEURISTIC ROUTER: PRE-COMPILED REGEX PATTERNS & KEYWORD DICTIONARIES
# ==============================================================================

# 1. Code / Programming Keywords & Syntax Regexes -> Qwen 2.5 Coder 32B Free
CODE_PATTERNS = [
    r"\b(def\s+\w+|function\s*\(|function\s+\w+|class\s+\w+|async\s+def|return\s+\S+)\b",
    r"\b(const\s+\w+|let\s+\w+|var\s+\w+|import\s+\w+|from\s+[\w\.]+\s+import|export\s+(default|const|let|var|function|class))\b",
    r"\b(python|javascript|typescript|react|vue|angular|node|express|fastapi|django|flask)\b",
    r"\b(c\+\+|c#|golang|rust|java|kotlin|swift|php|ruby|scala|sql|nosql|postgres|mysql|sqlite)\b",
    r"\b(html|css|tailwind|scss|json|yaml|xml|bash|shell|zsh|docker|kubernetes|git|github)\b",
    r"\b(code|coding|script|algorithm|refactor|debug|compile|syntax|regex|syntax error)\b",
    r"\b(bug|error|exception|traceback|stacktrace|segfault|undefined|nullpointer|fix this code)\b",
    r"\b(api|rest|graphql|sdk|endpoint|crud|webhook|npm|pip|cargo|composer)\b",
    r"```[\s\S]*?```",  # Markdown code blocks
    r"=>|===|!==|!=|==|\+=|-=|\*=|/=|::",  # Common code operators
]

# 2. Math / Logic / Step-by-Step Reasoning -> DeepSeek R1 Free
MATH_LOGIC_PATTERNS = [
    r"\b(math|mathematics|algebra|calculus|geometry|trigonometry|arithmetic|derivative|integral)\b",
    r"\b(calculate|computation|solve|equation|formula|matrix|vector|probability|statistics|theorem)\b",
    r"\b(logic|deduction|premise|syllogism|riddle|puzzle|proof|prove that|counterexample)\b",
    r"\b(step[- ]by[- ]step|think step by step|chain of thought|reasoning|deep reasoning)\b",
    r"\b(why is|how does it work logically|scientific method|hypothesis|analyze the paradox)\b",
    r"[0-9]+\s*[\+\-\*\/\^%]\s*[0-9]+",  # Arithmetic expressions
    r"\b(log_2|sqrt|pi|summation|infinity|factorial)\b",
]

# 3. Creative / Essay / Long-form Synthesis -> Llama 3.3 70B Instruct Free
CREATIVE_PATTERNS = [
    r"\b(essay|story|poem|poetry|novel|narrative|dialogue|scriptwriting|screenplay)\b",
    r"\b(email|letter|proposal|pitch|press release|memo|newsletter|cover letter|resume)\b",
    r"\b(blog|article|content|copywriting|headline|slogan|marketing|social media post)\b",
    r"\b(write a|compose|draft|brainstorm|rewrite|paraphrase|summarize|critique|rephrase)\b",
    r"\b(creative|metaphor|analogy|tone of voice|persuasive|formal tone|informal tone)\b",
]

# Pre-compile for maximum sub-microsecond throughput
COMPILED_CODE_REGEX = [re.compile(p, re.IGNORECASE) for p in CODE_PATTERNS]
COMPILED_MATH_REGEX = [re.compile(p, re.IGNORECASE) for p in MATH_LOGIC_PATTERNS]
COMPILED_CREATIVE_REGEX = [re.compile(p, re.IGNORECASE) for p in CREATIVE_PATTERNS]

PRIMARY_MODEL_MAPPING = {
    "code": "qwen/qwen-2.5-coder-32b-instruct:free",
    "math_logic": "deepseek/deepseek-r1:free",
    "creative": "meta-llama/llama-3.3-70b-instruct:free",
    "general": "google/gemini-2.0-flash-lite-001:free",
}

# ==============================================================================
# SUB-2MS ZERO-LATENCY HEURISTIC CLASSIFIER
# ==============================================================================

def classify_prompt_intent(prompt: str) -> Tuple[str, str, float]:
    """
    Sub-2ms Zero-Latency Heuristic Classifier ('AI Fiesta Engine').
    Scans the prompt against pre-compiled regex signatures and assigns the optimal
    free OpenRouter model.

    Returns:
        (category: str, assigned_model: str, routing_time_ms: float)
    """
    start_ns = time.perf_counter_ns()
    text = (prompt or "").strip()

    if not text:
        elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000.0
        return "general", PRIMARY_MODEL_MAPPING["general"], round(elapsed_ms, 3)

    # 1. Code test
    for pattern in COMPILED_CODE_REGEX:
        if pattern.search(text):
            elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000.0
            return "code", PRIMARY_MODEL_MAPPING["code"], round(elapsed_ms, 3)

    # 2. Math & Deep Logic test
    for pattern in COMPILED_MATH_REGEX:
        if pattern.search(text):
            elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000.0
            return "math_logic", PRIMARY_MODEL_MAPPING["math_logic"], round(elapsed_ms, 3)

    # 3. Creative & Synthesis test
    for pattern in COMPILED_CREATIVE_REGEX:
        if pattern.search(text):
            elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000.0
            return "creative", PRIMARY_MODEL_MAPPING["creative"], round(elapsed_ms, 3)

    # 4. Default / General conversational QA -> Gemini 2.0 Flash Lite Free
    elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000.0
    return "general", PRIMARY_MODEL_MAPPING["general"], round(elapsed_ms, 3)


# ==============================================================================
# AUTOMATIC CASCADE FAILOVER ENGINE
# ==============================================================================

def build_cascade_order(primary_model: str) -> List[str]:
    """
    Builds the model retry sequence starting from the primary model,
    followed by the remaining models in the free pool without duplicate entries.
    """
    sequence = [primary_model]
    for model in FREE_MODEL_POOL:
        if model not in sequence:
            sequence.append(model)
    return sequence

async def execute_openrouter_cascade(
    messages: List[Dict[str, str]],
    primary_model: str,
    api_key: str,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_retries: int = 4,
    timeout_seconds: float = 25.0,
) -> Dict[str, Any]:
    """
    Executes chat completion via OpenRouter with automatic cascade failover.
    If a model returns 429, 503, 504, 502, 404, or times out, it immediately cascades
    to the next free model in the sequence.
    """
    overall_start_ns = time.perf_counter_ns()
    cascade_models = build_cascade_order(primary_model)
    effective_messages = list(messages)

    if system_prompt:
        if not effective_messages or effective_messages[0].get("role") != "system":
            effective_messages.insert(0, {"role": "system", "content": system_prompt})

    failover_history: List[Dict[str, Any]] = []
    last_error: Optional[Exception] = None

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://arkai.arkecosystem.com",
        "X-Title": "arkAI Pure OpenRouter Orchestrator",
    }

    # Branch A: Preferred httpx Async Client (Vercel standard)
    if httpx is not None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds)) as client:
            for idx, model in enumerate(cascade_models[:max_retries + 1]):
                payload = {
                    "model": model,
                    "messages": effective_messages,
                    "temperature": temperature,
                }

                model_start_ns = time.perf_counter_ns()
                try:
                    response = await client.post(
                        OPENROUTER_API_URL,
                        json=payload,
                        headers=headers,
                    )

                    model_latency_ms = (time.perf_counter_ns() - model_start_ns) / 1_000_000.0

                    # Check for rate-limiting, server load, or model offline
                    if response.status_code != 200:
                        error_body = response.text[:200]
                        failover_history.append({
                            "model": model,
                            "status_code": response.status_code,
                            "latency_ms": round(model_latency_ms, 2),
                            "reason": f"HTTP {response.status_code} ({error_body})",
                        })
                        continue

                    response.raise_for_status()
                    data = response.json()

                    choices = data.get("choices", [])
                    if not choices:
                        failover_history.append({
                            "model": model,
                            "status_code": 200,
                            "latency_ms": round(model_latency_ms, 2),
                            "reason": "Empty choices array returned by model",
                        })
                        continue

                    content = choices[0].get("message", {}).get("content", "")
                    total_latency_ms = (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0

                    next_model = get_next_fallback_model(model)
                    meta_info = MODEL_REGISTRY.get(model, {"name": model, "badge": "OpenRouter Free"})

                    return {
                        "response": content,
                        "model_used": model,
                        "model_name": meta_info.get("name", model),
                        "model_badge": meta_info.get("badge", "Free"),
                        "provider_status": "success",
                        "status": "success",
                        "failover_count": len(failover_history),
                        "failover_history": failover_history,
                        "next_fallback_model": next_model,
                        "total_latency_ms": round(total_latency_ms, 2),
                        "model_latency_ms": round(model_latency_ms, 2),
                        "raw_usage": data.get("usage", {}),
                    }

                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                    model_latency_ms = (time.perf_counter_ns() - model_start_ns) / 1_000_000.0
                    last_error = exc
                    failover_history.append({
                        "model": model,
                        "error": str(exc),
                        "latency_ms": round(model_latency_ms, 2),
                        "reason": exc.__class__.__name__,
                    })
                    continue

    else:
        # Branch B: Standard library urllib fallback (for dependency-free environments)
        def _sync_request(model_name: str) -> Tuple[int, str, Any]:
            payload_bytes = json.dumps({
                "model": model_name,
                "messages": effective_messages,
                "temperature": temperature,
            }).encode("utf-8")

            req = urllib.request.Request(
                OPENROUTER_API_URL,
                data=payload_bytes,
                headers=headers,
                method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                    status_code = resp.status
                    body = resp.read().decode("utf-8")
                    return status_code, body, None
            except urllib.error.HTTPError as he:
                body = he.read().decode("utf-8", errors="replace") if he.fp else str(he)
                return he.code, body, he
            except Exception as e:
                return 500, str(e), e

        for idx, model in enumerate(cascade_models[:max_retries + 1]):
            model_start_ns = time.perf_counter_ns()
            try:
                status_code, body, exc = await asyncio.to_thread(_sync_request, model)
                model_latency_ms = (time.perf_counter_ns() - model_start_ns) / 1_000_000.0

                if status_code != 200:
                    failover_history.append({
                        "model": model,
                        "status_code": status_code,
                        "latency_ms": round(model_latency_ms, 2),
                        "reason": f"HTTP {status_code} ({body[:200]})",
                    })
                    continue

                data = json.loads(body)
                choices = data.get("choices", [])
                if not choices:
                    continue

                content = choices[0].get("message", {}).get("content", "")
                total_latency_ms = (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0
                next_model = get_next_fallback_model(model)
                meta_info = MODEL_REGISTRY.get(model, {"name": model, "badge": "OpenRouter Free"})

                return {
                    "response": content,
                    "model_used": model,
                    "model_name": meta_info.get("name", model),
                    "model_badge": meta_info.get("badge", "Free"),
                    "provider_status": "success",
                    "status": "success",
                    "failover_count": len(failover_history),
                    "failover_history": failover_history,
                    "next_fallback_model": next_model,
                    "total_latency_ms": round(total_latency_ms, 2),
                    "model_latency_ms": round(model_latency_ms, 2),
                }
            except Exception as e:
                last_error = e
                continue

    # If all cascade models failed or were exhausted
    total_latency_ms = (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0
    err_summary = str(last_error) if last_error else "All cascade free models were temporarily unavailable."

    return {
        "response": (
            f"⚠️ **arkAI Failover Notice**: All free cascade models experienced high demand. "
            f"Details: `{err_summary}`. Please click **🔀 Try Next Model** or enter a custom key in Settings."
        ),
        "model_used": cascade_models[-1],
        "model_name": "Fallback Exhausted",
        "provider_status": "exhausted",
        "status": "exhausted",
        "failover_count": len(failover_history),
        "failover_history": failover_history,
        "next_fallback_model": FREE_MODEL_POOL[0],
        "total_latency_ms": round(total_latency_ms, 2),
        "error": err_summary,
    }
