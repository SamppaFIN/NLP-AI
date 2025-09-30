from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    # Reuse the shared OpenRouter client from the root scripts
    from scripts.openrouter_client import OpenRouterClient
except Exception as exc:  # pragma: no cover
    raise RuntimeError("OpenRouter client not found. Ensure repository layout is preserved.") from exc


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    task: Optional[str] = None  # used for routing policy (e.g., plan, red, green)
    model: Optional[str] = None  # override


class ChatResponse(BaseModel):
    content: str
    model: str


app = FastAPI(title="NLP Therapy AI", version="0.1.0")


def resolve_model(task: Optional[str], explicit_model: Optional[str]) -> Optional[str]:
    if explicit_model:
        return explicit_model
    policy = OpenRouterClient.load_policy(os.environ.get("OPENROUTER_POLICY"))
    if policy and task:
        routed = policy.route_model(task)
        if routed:
            return routed
    return os.environ.get("OPENROUTER_MODEL")


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    return {"ok": True}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    client = OpenRouterClient.from_env()
    if not client:
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured")

    model = resolve_model(req.task, req.model)
    if not model:
        raise HTTPException(status_code=400, detail="Model not resolvable. Set OPENROUTER_MODEL or policy.")

    messages = [m.model_dump() for m in req.messages]
    content = client.chat(model=model, messages=messages)
    if content is None:
        raise HTTPException(status_code=502, detail="Upstream model error or empty response")
    return ChatResponse(content=content, model=model)


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "name": "nlp-therapy-ai",
        "docs": "/docs",
        "chat_endpoint": "/api/chat",
    }


