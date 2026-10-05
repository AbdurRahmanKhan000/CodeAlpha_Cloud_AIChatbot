"""
arkAI - Vercel Serverless ASGI FastAPI Entrypoint
ARK Ecosystem - High-Speed Pure OpenRouter Orchestration Platform
"""

import sys
import os
import time
from typing import List, Dict, Any, Optional
try:
    from fastapi import FastAPI, APIRouter, Request, status
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, HTMLResponse
    from pydantic import BaseModel, Field
except ImportError:
    # Graceful standard library ASGI compatibility shim for test environments without pip
    class FieldShim:
        def __init__(self, default=None, **kwargs):
            self.default = default

    def Field(default=None, **kwargs):
        return default

    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    class APIRouter:
        def __init__(self, prefix=""):
            self.prefix = prefix
            self.routes = []

        def get(self, path, **kwargs):
            def decorator(func):
                self.routes.append(type("Route", (), {"path": self.prefix + path, "endpoint": func})())
                return func
            return decorator

        def post(self, path, **kwargs):
            def decorator(func):
                self.routes.append(type("Route", (), {"path": self.prefix + path, "endpoint": func})())
                return func
            return decorator

    class FastAPI:
        def __init__(self, title="arkAI Serverless Orchestrator", **kwargs):
            self.title = title
            self.routes = []

        def add_middleware(self, *args, **kwargs):
            pass

        def include_router(self, router, prefix=""):
            for r in router.routes:
                p = (prefix + r.path).replace("//", "/")
                self.routes.append(type("Route", (), {"path": p, "endpoint": r.endpoint})())

        def get(self, path, **kwargs):
            def decorator(func):
                self.routes.append(type("Route", (), {"path": path, "endpoint": func})())
                return func
            return decorator

        def post(self, path, **kwargs):
            def decorator(func):
                self.routes.append(type("Route", (), {"path": path, "endpoint": func})())
                return func
            return decorator

    class CORSMiddleware:
        pass

    class JSONResponse:
        def __init__(self, content, status_code=200):
            self.content = content
            self.status_code = status_code

    class HTMLResponse:
        def __init__(self, content, media_type="text/html"):
            self.content = content
            self.media_type = media_type

    class StatusShim:
        HTTP_200_OK = 200

    status = StatusShim()

# Ensure both project root and api/ directory are accessible in sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
for _p in (_current_dir, _parent_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from api.config import (
        FREE_MODEL_POOL,
        MODEL_REGISTRY,
        get_server_openrouter_key,
        resolve_effective_key,
        is_demo_mode,
        get_demo_mode_response,
        get_next_fallback_model,
    )
    from api.router import (
        classify_prompt_intent,
        execute_openrouter_cascade,
    )
except ImportError:
    from config import (
        FREE_MODEL_POOL,
        MODEL_REGISTRY,
        get_server_openrouter_key,
        resolve_effective_key,
        is_demo_mode,
        get_demo_mode_response,
        get_next_fallback_model,
    )
    from router import (
        classify_prompt_intent,
        execute_openrouter_cascade,
    )

app = FastAPI(
    title="arkAI Serverless Orchestrator",
    description="Pure OpenRouter Orchestrated Engine with Sub-2ms Heuristic Routing & Automatic Cascade Failover",
    version="3.0.0",
)

# Enable permissive CORS for frontend deployment & preview environments
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# REQUEST & RESPONSE SCHEMAS
# ==============================================================================

class ChatMessage(BaseModel):
    role: str = Field(..., description="Role: 'user', 'assistant', or 'system'")
    content: str = Field(..., description="Text content of the message")

class ChatRequest(BaseModel):
    message: str = Field(..., description="User's prompt / query")
    history: Optional[List[ChatMessage]] = Field(default_factory=list, description="Recent conversation turns")
    system_prompt: Optional[str] = Field(None, description="Custom system persona tuning")
    force_model: Optional[str] = Field(None, description="Explicit model override if requested")
    api_key_override: Optional[str] = Field(None, description="User-provided OpenRouter API key override")
    temperature: Optional[float] = Field(0.7, ge=0.0, le=2.0)

class RoutePreviewRequest(BaseModel):
    prompt: str = Field(..., description="Prompt to classify")

class RegenerateRequest(BaseModel):
    message: str = Field(..., description="The user query to regenerate")
    current_model: str = Field(..., description="The model that produced the previous answer")
    history: Optional[List[ChatMessage]] = Field(default_factory=list)
    system_prompt: Optional[str] = Field(None)
    api_key_override: Optional[str] = Field(None)
    temperature: Optional[float] = Field(0.7)


# ==============================================================================
# ROUTER DEFINITIONS (DUAL MOUNTED FOR VERCEL & STANDALONE ROUTING)
# ==============================================================================

api_router = APIRouter()

@api_router.get("/health")
async def health_check():
    """
    Diagnostics and health check endpoint for Vercel Serverless Function.
    """
    server_key = get_server_openrouter_key()
    has_env_key = len(server_key) > 0

    return {
        "status": "operational",
        "engine": "arkAI Pure OpenRouter Orchestrator",
        "architecture": "Serverless ASGI Heuristic Cascade",
        "version": "3.0.0",
        "free_models_count": len(FREE_MODEL_POOL),
        "primary_free_model": FREE_MODEL_POOL[0],
        "openrouter_key_configured": has_env_key,
        "runtime_mode": "live_inference" if has_env_key else "demo_mode",
        "sla_target_ms": 2.0,
        "supported_models": FREE_MODEL_POOL,
    }

@api_router.get("/models")
async def get_models():
    """
    Returns list of free OpenRouter models with category labels and visual badges.
    """
    models_list = [MODEL_REGISTRY.get(m, {"id": m, "name": m}) for m in FREE_MODEL_POOL]
    return {
        "count": len(models_list),
        "models": models_list,
        "default_model": FREE_MODEL_POOL[0],
    }

@api_router.post("/route-preview")
async def route_preview(req: RoutePreviewRequest):
    """
    Sub-2ms Zero-Latency Heuristic Classification preview.
    Simulates prompt routing without calling external APIs.
    """
    category, assigned_model, routing_time_ms = classify_prompt_intent(req.prompt)
    model_info = MODEL_REGISTRY.get(assigned_model, {"name": assigned_model, "badge": "Free"})

    return {
        "category": category,
        "assigned_model": assigned_model,
        "model_name": model_info.get("name"),
        "model_badge": model_info.get("badge"),
        "routing_time_ms": routing_time_ms,
        "sla_guaranteed": routing_time_ms < 2.0,
    }

@api_router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """
    Main Chat Endpoint:
    1. Runs sub-2ms heuristic classifier to pick primary model (or honors force_model).
    2. Resolves API key (environment or client override).
    3. If no key, returns graceful Demo Mode response with status: "demo_mode" (never crashes).
    4. If key is present, executes OpenRouter chat completion with automatic cascade failover.
    """
    overall_start_ns = time.perf_counter_ns()
    query = req.message.strip()

    # Step 1: Sub-2ms Zero-Latency Heuristic Classification
    if req.force_model and req.force_model in FREE_MODEL_POOL:
        assigned_model = req.force_model
        prompt_type = "manual_override"
        routing_time_ms = 0.05
    else:
        prompt_type, assigned_model, routing_time_ms = classify_prompt_intent(query)

    # Step 2: Key Resolution & Demo Mode Guard (Never Crash)
    effective_key = resolve_effective_key(req.api_key_override or "")
    if not effective_key:
        demo_payload = get_demo_mode_response(prompt_type, assigned_model, query)
        demo_payload["routing_time_ms"] = routing_time_ms
        return JSONResponse(status_code=status.HTTP_200_OK, content=demo_payload)

    # Step 3: Format conversation history for OpenRouter
    formatted_messages: List[Dict[str, str]] = []
    if req.history:
        for turn in req.history[-8:]:
            formatted_messages.append({"role": turn.role, "content": turn.content})
    formatted_messages.append({"role": "user", "content": query})

    # Step 4: Execute OpenRouter with Automatic Cascade Failover
    result = await execute_openrouter_cascade(
        messages=formatted_messages,
        primary_model=assigned_model,
        api_key=effective_key,
        system_prompt=req.system_prompt,
        temperature=req.temperature or 0.7,
    )

    total_latency_ms = (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0

    return {
        "status": result.get("status", "success"),
        "response": result.get("response"),
        "model_used": result.get("model_used"),
        "model_name": result.get("model_name"),
        "model_badge": result.get("model_badge"),
        "prompt_type": prompt_type,
        "provider_status": result.get("provider_status", "success"),
        "failover_count": result.get("failover_count", 0),
        "failover_history": result.get("failover_history", []),
        "next_fallback_model": result.get("next_fallback_model"),
        "routing_time_ms": routing_time_ms,
        "total_latency_ms": round(total_latency_ms, 2),
        "demo_mode": False,
    }

@api_router.post("/regenerate")
async def regenerate_with_next_model(req: RegenerateRequest):
    """
    Frontend '🔀 Try Next Model' feature handler:
    Forces execution using the next fallback model in the free cascade sequence.
    """
    next_model = get_next_fallback_model(req.current_model)

    chat_req = ChatRequest(
        message=req.message,
        history=req.history,
        system_prompt=req.system_prompt,
        force_model=next_model,
        api_key_override=req.api_key_override,
        temperature=req.temperature,
    )

    return await chat_endpoint(chat_req)

# Register routes under both /api and root / to prevent Vercel prefix rewrite mismatches
app.include_router(api_router, prefix="/api")
app.include_router(api_router, prefix="")

# ==============================================================================
# STATIC FILE SERVING FOR STANDALONE & LOCAL PREVIEW
# ==============================================================================

public_dir = os.path.join(_parent_dir, "public")

@app.get("/")
async def serve_index():
    index_path = os.path.join(public_dir, "index.html")
    if os.path.isfile(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), media_type="text/html")
    return {"status": "operational", "app": "arkAI Pure OpenRouter Orchestrator"}

@app.get("/{static_file:path}")
async def serve_static(static_file: str):
    file_path = os.path.join(public_dir, static_file)
    if os.path.isfile(file_path):
        media_type = "text/plain"
        if static_file.endswith(".html"):
            media_type = "text/html"
        elif static_file.endswith(".css"):
            media_type = "text/css"
        elif static_file.endswith(".js"):
            media_type = "application/javascript"
        elif static_file.endswith(".svg"):
            media_type = "image/svg+xml"
        elif static_file.endswith(".json"):
            media_type = "application/json"
        with open(file_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), media_type=media_type)
    return JSONResponse(status_code=404, content={"detail": f"File '{static_file}' not found"})
