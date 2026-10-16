"""
arkAI - Free Orchestration Configuration (NO API key required by default)

arkAI is an *orchestrated* chatbot: by default it does NOT depend on any
single vendor API (not Gemini, not OpenRouter, not anyone). Every query is
classified locally in <2ms and dispatched to the best-ranked model that is
reachable through FREE, anonymous AI gateways:

  1. Pollinations Classic  - https://text.pollinations.ai/openai
     Anonymous, no key. Verified live. Serves GPT-OSS 20B (reasoning).
  2. LLM7 Anonymous         - https://api.llm7.io/v1/chat/completions
     Anonymous free tier, no key. Serves DeepSeek Flash, GLM Flash,
     GPT-OSS and more (subject to the gateway's anonymous daily quota;
     failures simply cascade to the next model).

A "logical model" in the catalog below is one (gateway, upstream model)
pair. Regenerate excludes every logical model already tried for a prompt
and picks the next best-ranked one, so the user always gets a *different*
model's answer.

Optional "Own Key" mode: if (and only if) the user supplies their own API
key in Settings, arkAI uses ONLY that provider's models - see
OWN_KEY_PROVIDERS. There is no arkAI server key and no fallback into the
free pool in that mode.
"""

import os
from typing import Dict, Any, List

# ---------------------------------------------------------------- gateways
FREE_GATEWAYS: Dict[str, Dict[str, Any]] = {
    "pollinations": {
        "name": "Pollinations",
        "endpoint": "https://text.pollinations.ai/openai",
        "requires_key": False,
        "timeout_seconds": 45.0,
    },
    "llm7": {
        "name": "LLM7",
        "endpoint": "https://api.llm7.io/v1/chat/completions",
        "requires_key": False,
        "timeout_seconds": 30.0,
    },
}

# ------------------------------------------------------------- model catalog
# strengths: the intents this model is best at, in order of excellence.
MODEL_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "pollinations/gpt-oss-20b",
        "gateway": "pollinations",
        "upstream_model": "openai-fast",
        "name": "GPT-OSS 20B",
        "provider_family": "OpenAI (open weights)",
        "badge": "Reasoning",
        "strengths": ["math_logic", "general", "code", "creative"],
        "description": "Open-weight reasoning model served anonymously by Pollinations. Fast, dependable all-rounder and arkAI's primary free model.",
    },
    {
        "id": "llm7/deepseek-v4-flash",
        "gateway": "llm7",
        "upstream_model": "DeepSeek-V4-Flash-0731",
        "name": "DeepSeek V4 Flash",
        "provider_family": "DeepSeek",
        "badge": "Deep Reasoning & Code",
        "strengths": ["code", "math_logic", "general"],
        "description": "DeepSeek's flash reasoning model via the LLM7 anonymous gateway. First choice for code and hard logic.",
    },
    {
        "id": "llm7/glm-5.3-flash",
        "gateway": "llm7",
        "upstream_model": "GLM-5.3-Flash",
        "name": "GLM 5.3 Flash",
        "provider_family": "Z.ai (GLM)",
        "badge": "Ultra-Fast",
        "strengths": ["general", "creative", "code"],
        "description": "Very fast GLM flash model via LLM7. Great for general chat and creative writing.",
    },
    {
        "id": "llm7/gpt-oss-20b",
        "gateway": "llm7",
        "upstream_model": "gpt-oss:20b",
        "name": "GPT-OSS 20B (LLM7)",
        "provider_family": "OpenAI (open weights)",
        "badge": "Reasoning",
        "strengths": ["general", "math_logic", "creative"],
        "description": "The same open-weight GPT-OSS family through a second gateway - a genuinely different route for Regenerate.",
    },
]

MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {m["id"]: m for m in MODEL_CATALOG}

# Ranked logical-model ids per intent (best first). Regenerate walks this
# list, skipping everything already tried for the prompt.
INTENT_RANKINGS: Dict[str, List[str]] = {
    "code": [
        "llm7/deepseek-v4-flash",
        "pollinations/gpt-oss-20b",
        "llm7/glm-5.3-flash",
        "llm7/gpt-oss-20b",
    ],
    "math_logic": [
        "llm7/deepseek-v4-flash",
        "pollinations/gpt-oss-20b",
        "llm7/gpt-oss-20b",
        "llm7/glm-5.3-flash",
    ],
    "creative": [
        "llm7/glm-5.3-flash",
        "pollinations/gpt-oss-20b",
        "llm7/gpt-oss-20b",
        "llm7/deepseek-v4-flash",
    ],
    "general": [
        "pollinations/gpt-oss-20b",
        "llm7/glm-5.3-flash",
        "llm7/deepseek-v4-flash",
        "llm7/gpt-oss-20b",
    ],
}

# ------------------------------------------------------------ own-key mode
# Used ONLY when the user pastes their own key in Settings. arkAI then
# calls that provider alone, with that provider's own best models.
OWN_KEY_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "openai": {
        "name": "OpenAI",
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "models": ["gpt-4o-mini", "gpt-4o"],
        "key_prefixes": ["sk-"],
    },
    "openrouter": {
        "name": "OpenRouter",
        "endpoint": "https://openrouter.ai/api/v1/chat/completions",
        "models": ["deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"],
        "key_prefixes": ["sk-or-"],
    },
    "deepseek": {
        "name": "DeepSeek",
        "endpoint": "https://api.deepseek.com/chat/completions",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "key_prefixes": [],
    },
    "grok": {
        "name": "xAI Grok",
        "endpoint": "https://api.x.ai/v1/chat/completions",
        "models": ["grok-2", "grok-2-mini"],
        "key_prefixes": ["xai-"],
    },
    "meta": {
        "name": "Meta LLaMA (Groq)",
        "endpoint": "https://api.groq.com/openai/v1/chat/completions",
        "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
        "key_prefixes": ["gsk_"],
    },
    "qwen": {
        "name": "Alibaba Qwen",
        "endpoint": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        "models": ["qwen-plus", "qwen-turbo"],
        "key_prefixes": [],
    },
    "gemini": {
        "name": "Google Gemini",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "models": ["gemini-2.0-flash", "gemini-1.5-flash"],
        "key_prefixes": ["AIza"],
    },
    "claude": {
        "name": "Anthropic Claude",
        "endpoint": "https://api.anthropic.com/v1/messages",
        "models": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
        "key_prefixes": ["sk-ant-"],
    },
}


def detect_provider_from_key(key: str = "", explicit_provider: str = "") -> str:
    """Detect which provider an own-key belongs to (explicit wins)."""
    explicit = (explicit_provider or "").lower().strip()
    if explicit and explicit in OWN_KEY_PROVIDERS:
        return explicit
    trimmed = (key or "").strip()
    # order matters: sk-or- and sk-ant- also start with sk-
    for prefix, provider in (("sk-or-", "openrouter"), ("sk-ant-", "claude"),
                             ("xai-", "grok"), ("gsk_", "meta"), ("AIza", "gemini")):
        if trimmed.startswith(prefix):
            return provider
    if trimmed.startswith("sk-"):
        return "openai"
    return "openai"


def ranked_models_for_intent(intent: str, exclude: List[str] = None) -> List[Dict[str, Any]]:
    """Best-first logical models for an intent, skipping excluded ids."""
    exclude_set = set(exclude or [])
    ranking = INTENT_RANKINGS.get(intent) or INTENT_RANKINGS["general"]
    ordered = [MODEL_REGISTRY[mid] for mid in ranking if mid in MODEL_REGISTRY]
    # append any catalog model not in the ranking, as a last resort
    for m in MODEL_CATALOG:
        if m["id"] not in ranking:
            ordered.append(m)
    return [m for m in ordered if m["id"] not in exclude_set]


def next_model_for_regenerate(intent: str, tried: List[str]) -> Dict[str, Any] | None:
    """Next best model that has NOT already answered this prompt."""
    remaining = ranked_models_for_intent(intent, exclude=tried)
    return remaining[0] if remaining else None


# ------------------------------------------------- legacy compat (old tests)
# The old OpenRouter-only pool is gone. These names are kept as thin aliases
# so nothing external breaks, but arkAI no longer depends on them.
FREE_MODEL_POOL: List[str] = [m["id"] for m in MODEL_CATALOG]


def get_next_fallback_model(current_model: str) -> str:
    ids = [m["id"] for m in MODEL_CATALOG]
    if current_model in ids:
        return ids[(ids.index(current_model) + 1) % len(ids)]
    return ids[0]


def get_server_openrouter_key() -> str:
    """Legacy helper: arkAI needs NO server key anymore. Always ''."""
    return ""


def resolve_effective_key(client_override_key: str = "") -> str:
    return (client_override_key or "").strip()


def is_demo_mode(api_key: str = "") -> bool:
    """There is no demo mode anymore - free orchestration always works."""
    return False
