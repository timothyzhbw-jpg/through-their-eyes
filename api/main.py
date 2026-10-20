"""The API service (SPEC 2): live match stream, moments, cached breakdowns, what-if, TTS.

    uv run uvicorn api.main:app --reload

Live play never waits on a model: the stream and the moments are deterministic. Breakdowns and
what-if answers are computed once and cached by a content hash of everything that shapes them
(moment card, personas, languages, prompt version, model deployment). With a model configured,
regeneration is rate-limited per client and capped per UTC day across all clients
(`TTE_DAILY_MODEL_CAP`, SPEC 8); past either, the cached answer or the offline template is served,
flagged `rate_limited` or `capped`.

Failure drill (SPEC 6): a breakdown request with `fail` takes those agents down for one fresh run,
kept under its own key and never under the cache keys of normal breakdowns. It counts against
the per-client limit (and, with a model, the daily cap) and answers 429 past them. No model is
called for a downed step. `POST /api/breakdowns/{key}/bring-back` re-runs one downed step from
the run's checkpoint. Every crew run checkpoints to files under the cache directory
(`checkpoints/`), so a normal breakdown interrupted mid-workflow, by a restart too, resumes from
its last completed step. Its checkpoints are deleted once it is cached. A drill keeps its
checkpoints, and only the most recent `DRILLS_KEPT` drills are kept.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from agent_framework import FileCheckpointStorage
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from agents import whatif
from agents.llm import client_from_env, sync_credential_from_env
from agents.prompts import PROMPT_VERSION
from agents.schemas import AgentStep, Language, Persona
from agents.telemetry import configure_tracing
from agents.workflow import PIPELINE_VERSION, NotWaiting, run_crew
from api import tts
from api.live import stream
from api.settings import Settings
from api.store import (
    DailyCap,
    Match,
    MatchStore,
    RateLimiter,
    content_key,
    open_storage,
    prune_dirs,
)

VERSION = "0.5.0"
DRILLS_KEPT = 50  # failure drills whose checkpoints are kept for a bring-back
KEY = re.compile(r"[0-9a-f]{32}")  # content_key()
WHATIF_VERSION = hashlib.sha256(whatif.WHATIF.encode()).hexdigest()[:12]


class BreakdownBody(BaseModel):
    match: str
    moment: str | None = None
    personas: list[Persona] = Field(default_factory=lambda: ["casual", "analyst"])
    languages: list[Language] = Field(default_factory=lambda: ["en", "zh"])
    regenerate: bool = False
    fail: list[AgentStep] = Field(default_factory=list, max_length=4)  # agents to take down


class BringBackBody(BaseModel):
    step: AgentStep


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
    if settings.cosmos_endpoint and credential is None and cosmos_client is None:
        credential = sync_credential_from_env()  # keyless: managed identity in Azure, az locally
    storage = open_storage(settings, credential, cosmos_client)
    store = MatchStore(settings, audit=storage.audit)
    breakdowns, answers = storage.breakdowns, storage.answers
    limiter = RateLimiter(*settings.rate_limit)
    cap = DailyCap(settings.daily_model_cap)
    checkpoint_dir = Path(settings.cache_dir) / "checkpoints"
    runs_dir, drills_dir = checkpoint_dir / "runs", checkpoint_dir / "drills"
    locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)  # one crew run per key at a time

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

    def drill_allowed(request: Request) -> None:
        """A drill or a bring-back runs the crew: it counts against the per-client limit and,
        with a model, the daily cap. Past either: 429."""
        if client is not None:
            verdict = regeneration(request)
        else:
            verdict = "offline" if limiter.allow(_client_ip(request)) else "rate_limited"
        if verdict == "rate_limited":
            raise HTTPException(429, "rate_limited: try again in a few minutes")
        if verdict == "capped":
            raise HTTPException(429, "capped: the model budget for today is used up")

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

        def key(model_name: str, **drill: Any) -> str:
            return content_key(card=m.ctx.card.content_hash(), personas=sorted(body.personas),
                               languages=sorted(body.languages), prompts=PROMPT_VERSION,
                               pipeline=PIPELINE_VERSION, model=model_name,
                               **drill)  # fmt: skip

        if body.fail:  # a fresh run under its own key: never a cache hit, never cached for others
            drill_allowed(request)
            down = sorted(set(body.fail))
            return await _drill(m, body, down, key(model, fail=down, run=uuid.uuid4().hex))
        model_key, offline_key = key(model), key("offline")
        candidates = ([model_key] if client is not None else []) + [offline_key]
        # With a model, only a model result is a cache hit up front: a template served while a
        # client was limited must not stand in for the model on later requests.
        if not body.regenerate and (hit := breakdowns.get(candidates[0])) is not None:
            return {"key": candidates[0], "cached": True, "rate_limited": False, "capped": False,
                    "drill": None, **hit}  # fmt: skip
        limits = {"rate_limited": False, "capped": False}
        if client is not None:
            verdict = regeneration(request)
            if verdict == "model":
                return await _compute(m, body, client, "model", model_key)
            limits[verdict] = True
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {"key": k, "cached": True, **limits, "drill": None, **hit}
        out = await _compute(m, body, None, "offline", offline_key)
        return {**out, **limits}

    async def _compute(m: Match, body: BreakdownBody, llm, source: str, k: str) -> dict[str, Any]:
        """Run the crew and cache the result. A run of this key that was interrupted resumes from
        its checkpoint; once the result is cached, the checkpoints go."""
        async with locks[k]:
            run = await run_crew(m.ctx, client=llm, personas=tuple(body.personas),
                                 languages=tuple(body.languages),
                                 checkpoints=FileCheckpointStorage(runs_dir / k))  # fmt: skip
            value = {"source": source, "result": run.result.model_dump(mode="json", by_alias=True)}
            breakdowns.put(k, value)
            shutil.rmtree(runs_dir / k, ignore_errors=True)
            for empty in (runs_dir, checkpoint_dir):  # a finished run leaves nothing on disk
                with suppress(OSError):
                    empty.rmdir()
        return {"key": k, "cached": False, "rate_limited": False, "capped": False, "drill": None,
                **value}  # fmt: skip

    def _drill_response(k: str, record: dict[str, Any]) -> dict[str, Any]:
        public = {name: v for name, v in record.items() if name != "match"}
        return {"key": k, "cached": False, "rate_limited": False, "capped": False, **public}

    async def _drill(m: Match, body: BreakdownBody, down: list[str], k: str) -> dict[str, Any]:
        """The crew with `down` taken down, checkpointed for a bring-back (SPEC 6)."""
        async with locks[k]:
            run = await run_crew(m.ctx, client=client, personas=tuple(body.personas),
                                 languages=tuple(body.languages), down=down,
                                 checkpoints=FileCheckpointStorage(drills_dir / k))  # fmt: skip
            record = {"source": "model" if client is not None else "offline",
                      "result": run.result.model_dump(mode="json", by_alias=True),
                      "drill": {"down": down, "pending": run.pending}, "match": m.id}  # fmt: skip
            breakdowns.put(k, record)
        prune_dirs(drills_dir, DRILLS_KEPT)
        return _drill_response(k, record)

    @app.post("/api/breakdowns/{key}/bring-back")
    async def bring_back(key: str, body: BringBackBody, request: Request) -> dict[str, Any]:
        """Re-run one downed step of a drill from its checkpoint; the rest is kept (SPEC 6)."""
        record = breakdowns.get(key) if KEY.fullmatch(key) else None
        if record is None or not record.get("drill"):
            raise HTTPException(404, "no failure drill with this key")
        async with locks[key]:
            record = breakdowns.get(key)
            drill = record["drill"]
            if body.step not in drill["pending"]:
                raise HTTPException(409, f"the {body.step} is not waiting to be brought back")
            if not (drills_dir / key).is_dir():
                raise HTTPException(410, "this drill's checkpoints are gone: run the drill again")
            drill_allowed(request)
            m = await match_or_404(record["match"])
            asked = record["result"]["request"]
            down = [d for d in drill["down"] if d != body.step]
            try:
                run = await run_crew(m.ctx, client=client, personas=tuple(asked["personas"]),
                                     languages=tuple(asked["languages"]), down=down,
                                     checkpoints=FileCheckpointStorage(drills_dir / key),
                                     bring_back=body.step)  # fmt: skip
            except NotWaiting as e:
                raise HTTPException(410, f"{e}: run the drill again") from e
            record = {**record, "result": run.result.model_dump(mode="json", by_alias=True),
                      "drill": {"down": down, "pending": run.pending}}  # fmt: skip
            breakdowns.put(key, record)
        return _drill_response(key, record)

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
