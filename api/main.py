"""The API service (SPEC 2): live match stream, moments, cached breakdowns, what-if, TTS, and
tamper checks (the verifier on a claim with one number changed, SPEC 7).

    uv run uvicorn api.main:app --reload

Live play never waits on a model: the stream and the moments are deterministic. Breakdowns and
what-if answers are computed once and cached by a content hash of everything that shapes them
(moment card, personas, languages, prompt version, model deployment). With a model configured,
regeneration is rate-limited per client and capped per UTC day across all clients
(`TTE_DAILY_MODEL_CAP`, SPEC 8); past either, the cached answer or the offline template is served,
flagged `rate_limited` or `capped`. With a model, the Analyst inspects the moment through our MCP
tool server, a subprocess per breakdown (`TTE_ANALYST_MCP`, on unless set to 0).
"""

from __future__ import annotations

import asyncio
import hashlib
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from agents import whatif
from agents.context import MomentContext
from agents.llm import client_from_env, sync_credential_from_env
from agents.prompts import PROMPT_VERSION
from agents.schemas import Language, Persona
from agents.telemetry import configure_tracing
from agents.workflow import PIPELINE_VERSION, run_breakdown
from api import tts
from api.live import stream
from api.settings import Settings
from api.store import DailyCap, Match, MatchStore, RateLimiter, content_key, open_storage
from api.tamper import TamperError, tamper

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
    moment: str | None = None  # which hero moment, in a match with several; default the first
    question: str = Field(min_length=1, max_length=300)
    language: Language = "en"
    persona: Persona = "analyst"


class TtsBody(BaseModel):
    ssml: str = Field(min_length=1, max_length=20_000)


class VerifyBody(BaseModel):
    match: str
    moment: str | None = None  # which hero moment, in a match with several; default the first
    claim: str = Field(max_length=100)
    slot: str = Field(max_length=100)
    value: float = Field(strict=True, allow_inf_nan=False)  # a JSON number: no strings, no bools
    language: Language = "en"


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
    if settings.cosmos_endpoint and credential is None and cosmos_client is None:
        credential = sync_credential_from_env()  # keyless: managed identity in Azure, az locally
    storage = open_storage(settings, credential, cosmos_client)
    store = MatchStore(settings, audit=storage.audit)
    breakdowns, answers = storage.breakdowns, storage.answers
    limiter = RateLimiter(*settings.rate_limit)
    verify_limiter = RateLimiter(*settings.verify_rate_limit)
    cap = DailyCap(settings.daily_model_cap)

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
        info = {
            "id": m.id, "scenario": m.scenario, "seed": m.seed, "dt": e["dt"],
            "frames": e["runs"]["factual"]["frames"], "players": e["players"], "hero": e["hero"],
            "key_scan": e.get("key_scan"), "hero_moment": next(iter(m.contexts)),
            "hero_moments": list(m.contexts), "kind": e.get("kind", "hero"),
        }  # fmt: skip
        if "match" in e:  # a stitched match (SPEC 3.1)
            info |= {"possessions": e["match"]["possessions"], "score": e["match"]["score"]}
        return info

    @app.get("/api/matches/{mid}/export")
    async def match_export(mid: str) -> dict[str, Any]:
        return (await match_or_404(mid)).export

    @app.get("/api/matches/{mid}/moments")
    async def match_moments(mid: str) -> list[dict[str, Any]]:
        return (await match_or_404(mid)).cards

    @app.get("/api/matches/{mid}/audit")
    async def match_audit(mid: str, limit: int = 50) -> list[dict[str, Any]]:
        m = await match_or_404(mid)
        limit = max(1, min(limit, 500))
        records = []
        for ctx in {id(c): c for c in m.contexts.values()}.values():  # each hero's run once
            recent = getattr(ctx.audit, "recent", None)
            records += recent(ctx.evaluator.match, limit) if recent else []
        return [r.model_dump(mode="json") for r in records[:limit]]

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
        ctx = m.context(body.moment)
        if ctx is None:
            raise HTTPException(404, f"breakdowns are available for {', '.join(m.contexts)}")
        where = {"possession": m.where[body.moment]} if body.moment in m.where else {}

        def key(model_name: str, **tools: str) -> str:
            return content_key(card=ctx.card.content_hash(), personas=sorted(body.personas),
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
                    **hit, **where}  # fmt: skip
        limits = {"rate_limited": False, "capped": False}
        if client is not None:
            verdict = regeneration(request)
            if verdict == "model":
                return {**await _compute(ctx, body, client, "model", model_key), **where}
            limits[verdict] = True
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {"key": k, "cached": True, **limits, **hit, **where}
        out = await _compute(ctx, body, None, "offline", offline_key)
        return {**out, **limits, **where}

    async def _compute(
        ctx: MomentContext, body: BreakdownBody, llm, source: str, k: str
    ) -> dict[str, Any]:
        result = await run_breakdown(ctx, client=llm, personas=tuple(body.personas),
                                     languages=tuple(body.languages),
                                     use_mcp=settings.analyst_mcp)  # fmt: skip
        value = {"source": source, "result": result.model_dump(mode="json", by_alias=True)}
        breakdowns.put(k, value)
        return {"key": k, "cached": False, "rate_limited": False, "capped": False, **value}

    @app.post("/api/whatif")
    async def what_if(body: WhatIfBody, request: Request) -> dict[str, Any]:
        m = await match_or_404(body.match)
        ctx = m.context(body.moment)
        if ctx is None:
            raise HTTPException(404, f"what-ifs are available for {', '.join(m.contexts)}")
        verdict = regeneration(request) if client is not None else "offline"
        use_model, capped = verdict == "model", verdict == "capped"
        action, _ = await whatif.map_question(ctx, body.question, client if use_model else None)
        if action is not None:
            # A match with one hero keeps its cache keys; with several, the moment is part of it.
            moment = {"moment": ctx.card.id} if len(m.contexts) > 1 else {}
            k = content_key(match=m.id, action=action, language=body.language,
                            persona=body.persona, version=WHATIF_VERSION, **moment)  # fmt: skip
            if (hit := answers.get(k)) is not None:
                return {"key": k, "cached": True, "capped": capped,
                        "answer": {**hit, "question": body.question}}  # fmt: skip
        answer = await whatif.answer_question(ctx, body.question, body.language, body.persona,
                                              client if use_model else None)  # fmt: skip
        data = answer.model_dump(mode="json")
        if action is None or answer.action is None:
            return {"key": None, "cached": False, "capped": capped, "answer": data}
        answers.put(k, data)
        return {"key": k, "cached": False, "capped": capped, "answer": data}

    @app.post("/api/verify")
    async def verify(body: VerifyBody, request: Request) -> dict[str, Any]:
        """Check one claim of the match with one numeric slot set to `value` (api/tamper.py).

        Not written to the audit log; limited per client like the model-backed requests.
        """
        m = await match_or_404(body.match)
        ctx = m.context(body.moment)
        if ctx is None:
            raise HTTPException(404, f"checks are available for {', '.join(m.contexts)}")
        if not verify_limiter.allow(_client_ip(request)):
            raise HTTPException(429, "too many checks from this address: try again in a minute")
        try:
            out = await asyncio.to_thread(tamper, ctx, body.claim, body.slot, body.value,
                                          body.language)  # fmt: skip
        except TamperError as e:
            raise HTTPException(e.status, e.detail) from None
        return {"match": m.id, **out}

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


configure_tracing()  # Application Insights when its connection string is set (SPEC 8)
app = create_app()
