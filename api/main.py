"""The API service (SPEC 2): live match stream, moments, cached breakdowns, what-if, TTS.

    uv run uvicorn api.main:app --reload

Live play never waits on a model: the stream and the moments are deterministic. Breakdowns and
what-if answers are computed once and cached by a content hash of everything that shapes them
(moment card, personas, languages, prompt version, model deployment). With a model configured,
regeneration is rate-limited per client; the cached answer is served instead.
"""

from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from agents import whatif
from agents.llm import client_from_env
from agents.prompts import PROMPT_VERSION
from agents.schemas import Language, Persona
from agents.workflow import run_breakdown
from api import tts
from api.live import stream
from api.settings import Settings
from api.store import Match, MatchStore, RateLimiter, content_key, open_storage

VERSION = "0.4.0"
WHATIF_VERSION = hashlib.sha256(whatif.WHATIF.encode()).hexdigest()[:12]


class BreakdownBody(BaseModel):
    match: str
    moment: str | None = None
    personas: list[Persona] = Field(default_factory=lambda: ["casual", "analyst"])
    languages: list[Language] = Field(default_factory=lambda: ["en", "zh"])
    regenerate: bool = False


class WhatIfBody(BaseModel):
    match: str
    question: str = Field(min_length=1, max_length=300)
    language: Language = "en"
    persona: Persona = "analyst"


class TtsBody(BaseModel):
    ssml: str = Field(min_length=1, max_length=20_000)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:  # first hop, as set by the Container Apps ingress
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def create_app(
    settings: Settings | None = None,
    client: Any | None = None,
    model_id: str | None = None,
    credential: Any | None = None,
    cosmos_client: Any | None = None,
) -> FastAPI:
    """`credential` (a sync TokenCredential) is needed when TTE_COSMOS_ENDPOINT is set."""
    settings = settings or Settings.from_env()
    close = None
    if client is None and model_id is None:
        client, close = client_from_env()
    model = model_id or ("foundry" if client is not None else "offline")
    storage = open_storage(settings, credential, cosmos_client)
    store = MatchStore(settings, audit=storage.audit)
    breakdowns, answers = storage.breakdowns, storage.answers
    limiter = RateLimiter(*settings.rate_limit)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        storage.close()
        if close is not None:
            await close()

    app = FastAPI(title="Through Their Eyes", version=VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.web_origin.split(",")],
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    async def match_or_404(mid: str) -> Match:
        match = await store.get(mid)
        if match is None:
            raise HTTPException(404, f"unknown match {mid}")
        return match

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "version": VERSION, "model": model, "speech": tts.configured()}

    @app.get("/api/matches")
    async def matches() -> list[dict[str, Any]]:
        return [{"id": mid, "scenario": s, "seed": seed} for mid, (s, seed) in store.known.items()]

    @app.get("/api/matches/{mid}")
    async def match_info(mid: str) -> dict[str, Any]:
        m = await match_or_404(mid)
        e = m.export
        return {
            "id": m.id, "scenario": m.scenario, "seed": m.seed, "dt": e["dt"],
            "frames": e["runs"]["factual"]["frames"], "players": e["players"], "hero": e["hero"],
            "key_scan": e["key_scan"], "hero_moment": m.ctx.card.id,
        }  # fmt: skip

    @app.get("/api/matches/{mid}/export")
    async def match_export(mid: str) -> dict[str, Any]:
        return (await match_or_404(mid)).export

    @app.get("/api/matches/{mid}/moments")
    async def match_moments(mid: str) -> list[dict[str, Any]]:
        return (await match_or_404(mid)).cards

    @app.get("/api/matches/{mid}/audit")
    async def match_audit(mid: str, limit: int = 50) -> list[dict[str, Any]]:
        ctx = (await match_or_404(mid)).ctx
        recent = getattr(ctx.audit, "recent", None)
        records = recent(ctx.evaluator.match, max(1, min(limit, 500))) if recent else []
        return [r.model_dump(mode="json") for r in records]

    @app.websocket("/ws/matches/{mid}/live")
    async def live(ws: WebSocket, mid: str, speed: float = 1.0, start: int = 0) -> None:
        match = await store.get(mid)
        await ws.accept()
        if match is None:
            await ws.send_json({"type": "error", "detail": f"unknown match {mid}"})
            await ws.close(code=4404)
            return
        await stream(ws, match, speed, start)
        await ws.close()

    @app.post("/api/breakdowns")
    async def breakdown(body: BreakdownBody, request: Request) -> dict[str, Any]:
        m = await match_or_404(body.match)
        if body.moment not in (None, m.ctx.card.id):
            raise HTTPException(404, f"breakdowns are available for {m.ctx.card.id}")

        def key(model_name: str) -> str:
            return content_key(card=m.ctx.card.content_hash(), personas=sorted(body.personas),
                               languages=sorted(body.languages), prompts=PROMPT_VERSION,
                               model=model_name)  # fmt: skip

        model_key, offline_key = key(model), key("offline")
        candidates = ([model_key] if client is not None else []) + [offline_key]
        if not body.regenerate:
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {"key": k, "cached": True, "rate_limited": False, **hit}
        rate_limited = False
        if client is not None:
            if limiter.allow(_client_ip(request)):
                return await _compute(m, body, client, "model", model_key)
            rate_limited = True
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {"key": k, "cached": True, "rate_limited": True, **hit}
        out = await _compute(m, body, None, "offline", offline_key)
        return {**out, "rate_limited": rate_limited}

    async def _compute(m: Match, body: BreakdownBody, llm, source: str, k: str) -> dict[str, Any]:
        result = await run_breakdown(m.ctx, client=llm, personas=tuple(body.personas),
                                     languages=tuple(body.languages))  # fmt: skip
        value = {"source": source, "result": result.model_dump(mode="json", by_alias=True)}
        breakdowns.put(k, value)
        return {"key": k, "cached": False, "rate_limited": False, **value}

    @app.post("/api/whatif")
    async def what_if(body: WhatIfBody, request: Request) -> dict[str, Any]:
        m = await match_or_404(body.match)
        use_model = client is not None and limiter.allow(_client_ip(request))
        action, _ = await whatif.map_question(m.ctx, body.question, client if use_model else None)
        if action is not None:
            k = content_key(match=m.id, action=action, language=body.language,
                            persona=body.persona, version=WHATIF_VERSION)  # fmt: skip
            if (hit := answers.get(k)) is not None:
                return {"key": k, "cached": True, "answer": {**hit, "question": body.question}}
        answer = await whatif.answer_question(m.ctx, body.question, body.language, body.persona,
                                              client if use_model else None)  # fmt: skip
        data = answer.model_dump(mode="json")
        if action is None or answer.action is None:
            return {"key": None, "cached": False, "answer": data}
        answers.put(k, data)
        return {"key": k, "cached": False, "answer": data}

    @app.post("/api/tts")
    async def speech(body: TtsBody) -> Response:
        if not tts.configured():
            raise HTTPException(503, "Azure Speech is not configured")
        try:
            audio = tts.synthesize(body.ssml, settings.cache_dir)
        except tts.SpeechUnavailable as e:
            raise HTTPException(502, str(e)) from e
        return Response(audio, media_type="audio/wav")

    app.state.settings = settings
    app.state.store = store
    return app


app = create_app()
