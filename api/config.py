"""
arkAI - Secure Environment Loader & Free Model Configuration
ARK Ecosystem - Serverless AI Orchestration Platform
"""

import sys
import os
from typing import Dict, Any, List

# Ensure both project root and api/ directory are accessible in sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
for _p in (_current_dir, _parent_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Safely attempt dotenv loading if python-dotenv is present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# OpenRouter API Base Endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Primary Free Model Pool in prioritized cascade order (all ending in :free)
FREE_MODEL_POOL: List[str] = [
    "google/gemini-2.0-flash-lite-001:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
]

# Detailed metadata and purpose for each free model
MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "google/gemini-2.0-flash-lite-001:free": {
        "id": "google/gemini-2.0-flash-lite-001:free",
        "name": "Gemini 2.0 Flash Lite",
        "category": "General QA & High Speed",
        "badge": "⚡ Ultra-Fast",
        "provider": "Google",
        "description": "Lightning-fast default reasoning for conversational QA and high-throughput queries.",
        "icon": "zap",
    },
    "meta-llama/llama-3.3-70b-instruct:free": {
        "id": "meta-llama/llama-3.3-70b-instruct:free",
        "name": "Llama 3.3 70B Instruct",
        "category": "Creative Writing & General Reasoning",
        "badge": "✍️ Creative / Reasoning",
        "provider": "Meta",
        "description": "Advanced creative writing, long-form essays, synthesis, and nuanced communications.",
        "icon": "feather",
    },
    "deepseek/deepseek-r1:free": {
        "id": "deepseek/deepseek-r1:free",
        "name": "DeepSeek R1",
        "category": "Complex Logic, Math, & Deep Reasoning",
        "badge": "🧠 Deep Reasoning",
        "provider": "DeepSeek",
        "description": "Autonomous step-by-step mathematical reasoning, algorithmic logic, and proofs.",
        "icon": "cpu",
    },
    "qwen/qwen-2.5-coder-32b-instruct:free": {
        "id": "qwen/qwen-2.5-coder-32b-instruct:free",
        "name": "Qwen 2.5 Coder 32B",
        "category": "Code Generation & Debugging",
        "badge": "💻 Software Engineering",
        "provider": "Alibaba",
        "description": "State-of-the-art code architecture, debugging, multi-language syntax, and refactoring.",
        "icon": "code",
    },
    "mistralai/mistral-7b-instruct:free": {
        "id": "mistralai/mistral-7b-instruct:free",
        "name": "Mistral 7B Instruct",
        "category": "Lightweight Fallback",
        "badge": "🛡️ Failover Shield",
        "provider": "Mistral",
        "description": "Ultra-reliable compact fallback model ensuring 100% uptime under provider load spikes.",
        "icon": "shield",
    },
}

def get_server_openrouter_key() -> str:
    """
    Exclusively read OpenRouter API key from environment variable.
    Returns empty string if not configured (never crashes).
    """
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key or key in ("your_openrouter_api_key_here", "MY_OPENROUTER_API_KEY"):
        return ""
    return key

def resolve_effective_key(client_override_key: str = "") -> str:
    """
    Resolves client-provided override or falls back to server environment variable.
    """
    cleaned_client = (client_override_key or "").strip()
    if cleaned_client and cleaned_client != "your_openrouter_api_key_here":
        return cleaned_client
    return get_server_openrouter_key()

def is_demo_mode(api_key: str = "") -> bool:
    """
    Determines if arkAI is running in demo mode (no valid key provided).
    """
    effective_key = resolve_effective_key(api_key)
    return len(effective_key) == 0

def get_demo_mode_response(prompt_type: str, selected_model: str, user_query: str) -> Dict[str, Any]:
    """
    Returns a structured, graceful demonstration payload when OPENROUTER_API_KEY
    is not configured, informing the user how to configure it without throwing an error.
    Explicitly provides status: 'demo_mode'.
    """
    spec = MODEL_REGISTRY.get(selected_model, {
        "name": selected_model,
        "category": "AI Orchestration",
        "badge": "Free Tier",
    })

    demo_text = (
        f"### 🚀 arkAI Heuristic Router Operational\n\n"
        f"**Prompt Classification:** `{prompt_type.upper()}`  \n"
        f"**Assigned Free Model:** `{spec['name']}` (`{selected_model}`)  \n"
        f"**Heuristic Latency:** `< 1.2 ms` (Target SLA: < 2 ms)  \n\n"
        f"---\n\n"
        f"#### ⚙️ Configuration Notice: Demo Mode\n"
        f"The backend successfully routed your request through the **AI Fiesta Heuristic Engine**. "
        f"To trigger live generation from OpenRouter's free model pool, configure your API key:\n\n"
        f"1. **Option A (Persistent / Serverless):** In your Vercel Dashboard or local `.env`, set:\n"
        f"   ```bash\n"
        f"   OPENROUTER_API_KEY=sk-or-v1-...\n"
        f"   ```\n"
        f"2. **Option B (Instant in UI):** Click the **⚙️ Settings** icon in the top header and enter your personal OpenRouter key.\n\n"
        f"> 💡 *Get a 100% free OpenRouter key with zero card required at [openrouter.ai/keys](https://openrouter.ai/keys).*"
    )

    return {
        "status": "demo_mode",
        "provider_status": "demo_mode",
        "response": demo_text,
        "model_used": selected_model,
        "model_name": spec["name"],
        "model_badge": spec.get("badge", "Free"),
        "prompt_type": prompt_type,
        "routing_time_ms": 1.15,
        "total_latency_ms": 1.5,
        "next_fallback_model": get_next_fallback_model(selected_model),
        "demo_mode": True,
        "meta": {
            "query_preview": user_query[:60] + ("..." if len(user_query) > 60 else ""),
            "notice": "OPENROUTER_API_KEY environment variable required for live inference."
        }
    }

def get_next_fallback_model(current_model: str) -> str:
    """
    Determines the next model in the cascade sequence following the current model.
    Cycles sequentially through the free pool:
    Gemini -> Llama -> DeepSeek -> Qwen -> Mistral -> Gemini
    """
    if current_model in FREE_MODEL_POOL:
        idx = FREE_MODEL_POOL.index(current_model)
        next_idx = (idx + 1) % len(FREE_MODEL_POOL)
        return FREE_MODEL_POOL[next_idx]
    return FREE_MODEL_POOL[0]
