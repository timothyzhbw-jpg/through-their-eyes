"""The API service (SPEC 2): live match stream, moments, cached breakdowns, what-if, TTS.

    uv run uvicorn api.main:app --reload

Live play never waits on a model: the stream and the moments are deterministic. Breakdowns and
what-if answers are computed once and cached by a content hash of everything that shapes them
(moment card, personas, languages, prompt version, model deployment). With a model configured,
regeneration is rate-limited per client and capped per UTC day across all clients
(`TTE_DAILY_MODEL_CAP`, SPEC 8); past either, the cached answer or the offline template is served,
flagged `rate_limited` or `capped`. With a model, the Analyst inspects the moment through our MCP
tool server, a subprocess per breakdown (`TTE_ANALYST_MCP`, on unless set to 0).

Speech speaks only voice cues the crew wrote, by key (api/tts.py); the live stream, request
bodies and response headers are bounded for a public service (api/live.py, api/guard.py).
"""

from __future__ import annotations

import asyncio
import hashlib
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import HTTPConnection
from fastapi.responses import Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from agents import whatif
from agents.llm import client_from_env, sync_credential_from_env
from agents.prompts import PROMPT_VERSION
from agents.schemas import Language, Persona
from agents.telemetry import configure_tracing
from agents.workflow import PIPELINE_VERSION, run_breakdown
from api import guard, tts
from api.live import Slots, stream
from api.settings import Settings
from api.store import DailyCap, Match, MatchStore, RateLimiter, content_key, open_storage

VERSION = "0.4.0"
WHATIF_VERSION = hashlib.sha256(whatif.WHATIF.encode()).hexdigest()[:12]
MAX_LIST = 8  # personas or languages in one request, before duplicates are dropped


def _unique(items: list) -> list:
    return list(dict.fromkeys(items))


Personas = Annotated[
    list[Persona], Field(min_length=1, max_length=MAX_LIST), AfterValidator(_unique)
]
Languages = Annotated[
    list[Language], Field(min_length=1, max_length=MAX_LIST), AfterValidator(_unique)
]


class BreakdownBody(BaseModel):
    match: str
    moment: str | None = None
    personas: Personas = Field(default_factory=lambda: ["casual", "analyst"])
    languages: Languages = Field(default_factory=lambda: ["en", "zh"])
    regenerate: bool = False


class WhatIfBody(BaseModel):
    match: str
    question: str = Field(min_length=1, max_length=300)
    language: Language = "en"
    persona: Persona = "analyst"


class TtsBody(BaseModel):
    """A voice cue to speak, by the `cache_key` the crew gave it; never SSML."""

    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=f"^{tts.KEY.pattern}$")


def _client_ip(request: HTTPConnection) -> str:
    """The address the Container Apps ingress saw: it appends that as the last X-Forwarded-For
    hop, after any hops the client sent itself. Every per-client limit uses this."""
    hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",")]
    if hops[-1]:
        return hops[-1]
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
    if settings.cosmos_endpoint and credential is None and cosmos_client is None:
        credential = sync_credential_from_env()  # keyless: managed identity in Azure, az locally
    storage = open_storage(settings, credential, cosmos_client)
    store = MatchStore(settings, audit=storage.audit)
    cues = tts.Cues(storage.voice)  # what POST /api/tts may speak: cues of breakdowns served
    breakdowns, answers = cues.recording(storage.breakdowns), storage.answers
    limiter = RateLimiter(*settings.rate_limit)
    cap = DailyCap(settings.daily_model_cap)
    speech_limiter = RateLimiter(*settings.tts_rate_limit)  # POST /api/tts per client
    speech_cap = DailyCap(settings.daily_tts_cap)  # Azure Speech syntheses per UTC day
    speech_calls = asyncio.Semaphore(settings.tts_concurrency)  # Azure Speech calls in flight
    synthesizing = tts.KeyLocks()  # one synthesis per cue key at a time
    slots = Slots(settings.live_per_client, settings.live_max_total)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        storage.close()
        if close is not None:
            await close()

    app = FastAPI(title="Through Their Eyes", version=VERSION, lifespan=lifespan)
    guard.install(app)
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

    def regeneration(request: Request) -> str:
        """Whether a model-backed regeneration may run now: "model", "capped" or "rate_limited".

        The daily cap is checked first, so a capped request does not use up the client's quota.
        """
        if cap.left() <= 0:
            return "capped"
        if not limiter.allow(_client_ip(request)):
            return "rate_limited"
        cap.take()
        return "model"

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "version": VERSION, "model": model, "speech": tts.configured(),
                "analyst_mcp": client is not None and settings.analyst_mcp}  # fmt: skip

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
        ip = _client_ip(ws)
        if refused := slots.take(ip):
            await ws.send_json({"type": "error", "detail": refused})
            await ws.close(code=4429)
            return
        try:
            await stream(ws, match, speed, start, settings.live_max_s)
        finally:
            slots.give(ip)

    @app.post("/api/breakdowns")
    async def breakdown(body: BreakdownBody, request: Request) -> dict[str, Any]:
        m = await match_or_404(body.match)
        if body.moment not in (None, m.ctx.card.id):
            raise HTTPException(404, f"breakdowns are available for {m.ctx.card.id}")

        def key(model_name: str, **tools: str) -> str:
            return content_key(card=m.ctx.card.content_hash(), personas=sorted(body.personas),
                               languages=sorted(body.languages), prompts=PROMPT_VERSION,
                               pipeline=PIPELINE_VERSION, model=model_name,
                               **tools)  # fmt: skip

        # The Analyst's tools shape a model breakdown, so they are part of its key.
        model_key = key(model, analyst_tools="mcp") if settings.analyst_mcp else key(model)
        offline_key = key("offline")
        candidates = ([model_key] if client is not None else []) + [offline_key]
        # With a model, only a model result is a cache hit up front: a template served while a
        # client was limited must not stand in for the model on later requests.
        if not body.regenerate and (hit := breakdowns.get(candidates[0])) is not None:
            return {"key": candidates[0], "cached": True, "rate_limited": False, "capped": False,
                    **hit}  # fmt: skip
        limits = {"rate_limited": False, "capped": False}
        if client is not None:
            verdict = regeneration(request)
            if verdict == "model":
                return await _compute(m, body, client, "model", model_key)
            limits[verdict] = True
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {"key": k, "cached": True, **limits, **hit}
        out = await _compute(m, body, None, "offline", offline_key)
        return {**out, **limits}

    async def _compute(m: Match, body: BreakdownBody, llm, source: str, k: str) -> dict[str, Any]:
        result = await run_breakdown(m.ctx, client=llm, personas=tuple(body.personas),
                                     languages=tuple(body.languages),
                                     use_mcp=settings.analyst_mcp)  # fmt: skip
        value = {"source": source, "result": result.model_dump(mode="json", by_alias=True)}
        breakdowns.put(k, value)
        return {"key": k, "cached": False, "rate_limited": False, "capped": False, **value}

    @app.post("/api/whatif")
    async def what_if(body: WhatIfBody, request: Request) -> dict[str, Any]:
        m = await match_or_404(body.match)
        verdict = regeneration(request) if client is not None else "offline"
        use_model, capped = verdict == "model", verdict == "capped"
        action, _ = await whatif.map_question(m.ctx, body.question, client if use_model else None)
        if action is not None:
            k = content_key(match=m.id, action=action, language=body.language,
                            persona=body.persona, version=WHATIF_VERSION)  # fmt: skip
            if (hit := answers.get(k)) is not None:
                return {"key": k, "cached": True, "capped": capped,
                        "answer": {**hit, "question": body.question}}  # fmt: skip
        answer = await whatif.answer_question(m.ctx, body.question, body.language, body.persona,
                                              client if use_model else None)  # fmt: skip
        data = answer.model_dump(mode="json")
        if action is None or answer.action is None:
            return {"key": None, "cached": False, "capped": capped, "answer": data}
        answers.put(k, data)
        return {"key": k, "cached": False, "capped": capped, "answer": data}

    tts_body = {"content": {"application/json": {"schema": TtsBody.model_json_schema()}}}

    @app.post("/api/tts", openapi_extra={"requestBody": tts_body})
    async def speech(request: Request) -> Response:
        """WAV for one voice cue of a breakdown this service served, by its `cache_key`.

        Rate-limited per client; synthesis (an audio cache miss) is also capped per UTC day, and
        only a synthesis that is stored counts. Requests for one key wait for the synthesis in
        flight and get its audio; at most `TTE_TTS_CONCURRENCY` Azure calls run at once.
        """
        try:  # parsed here, not by FastAPI, so that SSML or any other body is a 400
            key = TtsBody.model_validate_json(await request.body()).key
        except ValidationError:
            raise HTTPException(
                400, 'send {"key": VoiceCue.cache_key}; SSML is not accepted'
            ) from None
        if not speech_limiter.allow(_client_ip(request)):
            raise HTTPException(429, "too many speech requests from this address; try again later")
        if (ssml := cues.ssml(key)) is None:
            raise HTTPException(404, "unknown voice cue: request its breakdown first")
        if not tts.configured():
            raise HTTPException(503, "Azure Speech is not configured")
        if (audio := tts.cached(key, settings.cache_dir)) is None:
            async with synthesizing.hold(key):
                if (audio := tts.cached(key, settings.cache_dir)) is None:  # made while waiting?
                    audio = await _synthesize(ssml, key)
        return Response(audio, media_type="audio/wav")

    async def _synthesize(ssml: str, key: str) -> bytes:
        if not speech_cap.take():
            raise HTTPException(429, "today's speech budget is used up; captions still work")
        try:
            async with speech_calls:
                return await asyncio.to_thread(tts.synthesize, ssml, key, settings.cache_dir)
        except Exception as e:  # nothing stored: the unit goes back (not on cancel: the worker
            speech_cap.give()  # thread may still store its audio)
            if isinstance(e, tts.SpeechUnavailable):
                raise HTTPException(502, str(e)) from e
            raise

    app.state.settings = settings
    app.state.store = store
    app.state.cues = cues
    return app


configure_tracing()  # Application Insights when its connection string is set (SPEC 8)
app = create_app()
