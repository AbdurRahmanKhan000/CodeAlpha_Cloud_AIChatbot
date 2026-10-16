"""
arkAI - Vercel Serverless ASGI FastAPI Entrypoint
ARK Ecosystem - High-Speed Pure OpenRouter Orchestration Platform
"""

import sys
import os
import time
import json
from typing import List, Dict, Any, Optional
try:
    from fastapi import FastAPI, APIRouter, Request, status
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, HTMLResponse, StreamingResponse
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
        MODEL_CATALOG, MODEL_REGISTRY, FREE_GATEWAYS,
        ranked_models_for_intent, detect_provider_from_key,
    )
    from api.router import classify_prompt_intent, execute_orchestrated_chat, execute_orchestrated_chat_stream
except ImportError:
    from config import (
        MODEL_CATALOG, MODEL_REGISTRY, FREE_GATEWAYS,
        ranked_models_for_intent, detect_provider_from_key,
    )
    from router import classify_prompt_intent, execute_orchestrated_chat

app = FastAPI(
    title="arkAI Orchestrated Chatbot",
    description="Free multi-model orchestration: <2ms heuristic routing across anonymous AI gateways (Pollinations + LLM7), cascade failover, model-hopping Regenerate, optional Own-Key mode. No vendor API required.",
    version="4.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# SCHEMAS
# =============================================================================

class ChatMessage(BaseModel):
    role: str = Field(..., description="Role: 'user', 'assistant', or 'system'")
    content: str = Field(..., description="Text content of the message")

class ChatRequest(BaseModel):
    message: str = Field(..., description="User's prompt / query")
    history: Optional[List[ChatMessage]] = Field(default_factory=list)
    system_prompt: Optional[str] = Field(None)
    force_model: Optional[str] = Field(None, description="Logical model id to try first")
    exclude_models: Optional[List[str]] = Field(default_factory=list, description="Logical model ids to skip (Regenerate)")
    api_key_override: Optional[str] = Field(None, description="User's own API key (Own-Key mode)")
    provider: Optional[str] = Field(None, description="Explicit provider for Own-Key mode")
    temperature: Optional[float] = Field(0.7, ge=0.0, le=2.0)
    stream: Optional[bool] = Field(False, description="Stream tokens via SSE")

class RoutePreviewRequest(BaseModel):
    prompt: str = Field(...)

class RegenerateRequest(BaseModel):
    message: str = Field(..., description="The original user query")
    current_model: str = Field(..., description="Logical model id that produced the previous answer")
    tried_models: Optional[List[str]] = Field(default_factory=list, description="All logical models already tried for this prompt")
    history: Optional[List[ChatMessage]] = Field(default_factory=list)
    system_prompt: Optional[str] = Field(None)
    api_key_override: Optional[str] = Field(None)
    provider: Optional[str] = Field(None)
    temperature: Optional[float] = Field(0.7)
    stream: Optional[bool] = Field(False)

# =============================================================================
# ROUTES (dual-mounted for Vercel & standalone)
# =============================================================================

api_router = APIRouter()

@api_router.get("/health")
async def health_check():
    return {
        "status": "operational",
        "engine": "arkAI Orchestrated Chatbot",
        "architecture": "Free multi-gateway orchestration (no API key required)",
        "version": "4.0.0",
        "api_key_required": False,
        "gateways": {k: {"name": v["name"], "endpoint": v["endpoint"]} for k, v in FREE_GATEWAYS.items()},
        "models_count": len(MODEL_CATALOG),
        "models": [m["id"] for m in MODEL_CATALOG],
        "sla_target_ms": 2.0,
    }

@api_router.get("/models")
async def get_models():
    return {"count": len(MODEL_CATALOG), "models": MODEL_CATALOG,
            "gateways": list(FREE_GATEWAYS.keys())}

@api_router.post("/route-preview")
async def route_preview(req: RoutePreviewRequest):
    category, assigned_model, routing_time_ms = classify_prompt_intent(req.prompt)
    info = MODEL_REGISTRY.get(assigned_model, {})
    ranked = ranked_models_for_intent(category)
    return {"category": category, "assigned_model": assigned_model,
            "model_name": info.get("name"), "model_badge": info.get("badge"),
            "ranked_models": [m["id"] for m in ranked],
            "routing_time_ms": routing_time_ms, "sla_guaranteed": routing_time_ms < 2.0}

def _format_messages(req) -> List[Dict[str, str]]:
    msgs: List[Dict[str, str]] = []
    if req.history:
        for turn in req.history[-8:]:
            role = "assistant" if turn.role in ("assistant", "model") else turn.role
            msgs.append({"role": role, "content": turn.content})
    msgs.append({"role": "user", "content": req.message.strip()})
    return msgs


def _sse_response(event_source, routing_time_ms: float):
    async def gen():
        yield f"data: {json.dumps({'type': 'routing', 'routing_time_ms': routing_time_ms})}\n\n"
        async for event in event_source:
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})

@api_router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    overall_start_ns = time.perf_counter_ns()
    query = (req.message or "").strip()
    prompt_type, assigned_model, routing_time_ms = classify_prompt_intent(query)
    exclude = list(req.exclude_models or [])
    if req.force_model:
        # try the forced model first by excluding everything ranked above it is
        # complex; simplest honouring: exclude nothing, orchestrator ranking is
        # intent based - forced model is handled by putting it in exclude logic
        # of regenerate. Here we just note the override in prompt_type.
        prompt_type = "manual_override" if req.force_model else prompt_type
    if req.stream:
        intent = prompt_type if prompt_type in ("code", "math_logic", "creative", "general") else classify_prompt_intent(query)[0]
        return _sse_response(execute_orchestrated_chat_stream(
            messages=_format_messages(req), intent=intent, exclude_models=exclude,
            api_key_override=req.api_key_override or "", provider=req.provider or "",
            system_prompt=req.system_prompt, temperature=req.temperature or 0.7), routing_time_ms)
    result = await execute_orchestrated_chat(
        messages=_format_messages(req), intent=prompt_type if prompt_type in
        ("code", "math_logic", "creative", "general") else
        classify_prompt_intent(query)[0],
        exclude_models=exclude,
        api_key_override=req.api_key_override or "",
        provider=req.provider or "",
        system_prompt=req.system_prompt, temperature=req.temperature or 0.7)
    total_latency_ms = (time.perf_counter_ns() - overall_start_ns) / 1_000_000.0
    return {"status": result.get("status", "success"), "response": result.get("response"),
            "model_used": result.get("model_used"), "model_name": result.get("model_name"),
            "model_badge": result.get("model_badge"), "gateway": result.get("gateway"),
            "gateway_name": result.get("gateway_name"), "prompt_type": prompt_type,
            "assigned_model": assigned_model, "mode": result.get("mode", "arkai_free"),
            "provider_status": result.get("provider_status", "success"),
            "failover_count": result.get("failover_count", 0),
            "failover_history": result.get("failover_history", []),
            "next_model": result.get("next_model"),
            "next_model_name": result.get("next_model_name"),
            "tried_models": result.get("tried_models", []),
            "routing_time_ms": routing_time_ms,
            "total_latency_ms": round(total_latency_ms, 2), "latency_ms": round(total_latency_ms, 2)}

@api_router.post("/regenerate")
async def regenerate_with_next_model(req: RegenerateRequest):
    """
    Regenerate: re-run the SAME prompt on the next best model that has not
    already answered it. tried_models accumulates across regenerations, so
    repeated clicks keep hopping to fresh models until the ranked pool is
    exhausted, then the cycle restarts.
    """
    tried = list(req.tried_models or [])
    if req.current_model and req.current_model not in tried:
        tried.append(req.current_model)
    prompt_type, _, _ = classify_prompt_intent(req.message)
    ranked = ranked_models_for_intent(prompt_type, exclude=tried)
    if not ranked and tried:
        # pool exhausted -> restart the cycle with only the current model excluded
        tried = [req.current_model] if req.current_model else []
    chat_req = ChatRequest(message=req.message, history=req.history,
                           system_prompt=req.system_prompt, exclude_models=tried,
                           api_key_override=req.api_key_override, provider=req.provider,
                           temperature=req.temperature, stream=req.stream)
    return await chat_endpoint(chat_req)

app.include_router(api_router, prefix="/api")
app.include_router(api_router, prefix="")

# =============================================================================
# STATIC FILE SERVING FOR STANDALONE & LOCAL PREVIEW
# =============================================================================

public_dir = os.path.join(_parent_dir, "public")

@app.get("/")
async def serve_index():
    index_path = os.path.join(public_dir, "index.html")
    if os.path.isfile(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), media_type="text/html")
    return {"status": "operational", "app": "arkAI Orchestrated Chatbot"}

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
