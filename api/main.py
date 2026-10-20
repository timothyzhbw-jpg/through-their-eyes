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

Speech speaks only voice cues the crew wrote, by key (api/tts.py); the live stream, request
bodies and response headers are bounded for a public service (api/live.py, api/guard.py).

Failure drill (SPEC 6): a breakdown request with `fail` takes those agents down for one fresh run,
kept under its own key and never under the cache keys of normal breakdowns. It counts against
the per-client limit and, with a model, the daily model cap; offline, drills have their own daily
cap (`DAILY_OFFLINE_DRILLS`). Past any of them: 429. No model is called for a downed step.
`POST /api/breakdowns/{key}/bring-back` re-runs one downed step from the run's checkpoint, at most
`MAX_BRING_BACKS` times per drill.

Every crew run checkpoints to files under the cache directory (`checkpoints/`), so a normal
breakdown interrupted mid-workflow, by a restart too, resumes from its last completed step. Its
checkpoints are deleted once it is cached. A drill keeps its record and checkpoints on this
replica's disk (`DrillStore`), the most recent `DRILLS_KEPT` only. A restart onto a new disk
(every redeploy) drops them: bring-back then answers 404, "run the drill again". One crew run
per key at a time.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated, Any

from agent_framework import FileCheckpointStorage
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import HTTPConnection
from fastapi.responses import Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from agents import whatif
from agents.context import MomentContext
from agents.llm import client_from_env, sync_credential_from_env
from agents.prompts import PROMPT_VERSION
from agents.schemas import AgentStep, Language, Persona
from agents.telemetry import configure_tracing
from agents.workflow import PIPELINE_VERSION, NotWaiting, run_crew
from api import guard, tts
from api.live import Slots, stream
from api.settings import Settings
from api.store import (
    DailyCap,
    DrillStore,
    KeyedLocks,
    Match,
    MatchStore,
    RateLimiter,
    content_key,
    open_storage,
)
from api.tamper import TamperError, tamper

VERSION = "0.5.0"
DRILLS_KEPT = 50  # failure drills kept on disk for a bring-back
MAX_BRING_BACKS = 5  # per drill; with at most 8 supersteps each, well under MAX_SUPERSTEPS
DAILY_OFFLINE_DRILLS = 200  # drills and bring-backs per UTC day without a model, all clients
KEY = re.compile(r"[0-9a-f]{32}")  # content_key()
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
    fail: list[AgentStep] = Field(default_factory=list, max_length=4)  # agents to take down


class BringBackBody(BaseModel):
    step: AgentStep


class WhatIfBody(BaseModel):
    match: str
    moment: str | None = None  # which hero moment, in a match with several; default the first
    question: str = Field(min_length=1, max_length=300)
    language: Language = "en"
    persona: Persona = "analyst"


class TtsBody(BaseModel):
    """A voice cue to speak, by the `cache_key` the crew gave it; never SSML."""

    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=f"^{tts.KEY.pattern}$")


class VerifyBody(BaseModel):
    match: str
    moment: str | None = None  # which hero moment, in a match with several; default the first
    claim: str = Field(max_length=100)
    slot: str = Field(max_length=100)
    value: float = Field(strict=True, allow_inf_nan=False)  # a JSON number: no strings, no bools
    language: Language = "en"


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
    verify_limiter = RateLimiter(*settings.verify_rate_limit)
    cap = DailyCap(settings.daily_model_cap)
    drill_cap = DailyCap(DAILY_OFFLINE_DRILLS)  # offline drills; with a model, `cap` applies
    checkpoint_dir = Path(settings.cache_dir) / "checkpoints"
    runs_dir = checkpoint_dir / "runs"
    drills = DrillStore(checkpoint_dir / "drills", DRILLS_KEPT)
    locks = KeyedLocks()  # one crew run per key at a time
    speech_limiter = RateLimiter(*settings.tts_rate_limit)  # POST /api/tts per client
    speech_cap = DailyCap(settings.daily_tts_cap)  # Azure Speech syntheses per UTC day
    speech_calls = asyncio.Semaphore(settings.tts_concurrency)  # Azure Speech calls in flight
    synthesizing = KeyedLocks()  # one synthesis per cue key at a time
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

    def drill_allowed(request: Request) -> None:
        """A drill or a bring-back runs the crew: it counts against the per-client limit and a
        daily cap, the model's or, offline, the drills' own. Past any of them: 429."""
        if client is not None:
            verdict = regeneration(request)
        elif drill_cap.left() <= 0:
            verdict = "capped"
        elif not limiter.allow(_client_ip(request)):
            verdict = "rate_limited"
        else:
            drill_cap.take()
            verdict = "offline"
        if verdict == "rate_limited":
            raise HTTPException(429, "rate_limited: try again in a few minutes")
        if verdict == "capped":
            raise HTTPException(429, "capped: today's budget is used up; try again tomorrow (UTC)")

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
        ctx = m.context(body.moment)
        if ctx is None:
            raise HTTPException(404, f"breakdowns are available for {', '.join(m.contexts)}")
        where = {"possession": m.where[body.moment]} if body.moment in m.where else {}

        def key(model_name: str, **extra: Any) -> str:
            return content_key(card=ctx.card.content_hash(), personas=sorted(body.personas),
                               languages=sorted(body.languages), prompts=PROMPT_VERSION,
                               pipeline=PIPELINE_VERSION, model=model_name,
                               **extra)  # fmt: skip

        if body.fail:  # a fresh run under its own key: never a cache hit, never cached for others
            drill_allowed(request)
            down = sorted(set(body.fail))
            k = key(model, fail=down, run=uuid.uuid4().hex)
            return await _drill(m, ctx, body, down, k, where)
        # The Analyst's tools shape a model breakdown, so they are part of its key.
        model_key = key(model, analyst_tools="mcp") if settings.analyst_mcp else key(model)
        offline_key = key("offline")
        candidates = ([model_key] if client is not None else []) + [offline_key]
        # With a model, only a model result is a cache hit up front: a template served while a
        # client was limited must not stand in for the model on later requests.
        if not body.regenerate and (hit := breakdowns.get(candidates[0])) is not None:
            return {"key": candidates[0], "cached": True, "rate_limited": False, "capped": False,
                    "drill": None, **hit, **where}  # fmt: skip
        limits = {"rate_limited": False, "capped": False}
        if client is not None:
            verdict = regeneration(request)
            if verdict == "model":
                return {**await _compute(ctx, body, client, "model", model_key), **where}
            limits[verdict] = True
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {"key": k, "cached": True, **limits, "drill": None, **hit, **where}
        out = await _compute(ctx, body, None, "offline", offline_key)
        return {**out, **limits, **where}

    async def _compute(
        ctx: MomentContext, body: BreakdownBody, llm, source: str, k: str
    ) -> dict[str, Any]:
        """Run the crew and cache the result. A run of this key that was interrupted resumes from
        its checkpoint; once the result is cached, the checkpoints go."""
        async with locks.hold(k):
            run = await run_crew(ctx, client=llm, personas=tuple(body.personas),
                                 languages=tuple(body.languages), use_mcp=settings.analyst_mcp,
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
        public = {name: record[name] for name in ("source", "result", "drill")}
        breakdowns.record(k, public)  # its voice cues may be spoken, like any served breakdown
        where = {"possession": record["possession"]} if "possession" in record else {}
        return {"key": k, "cached": False, "rate_limited": False, "capped": False, **public,
                **where}  # fmt: skip

    async def _drill(
        m: Match,
        ctx: MomentContext,
        body: BreakdownBody,
        down: list[str],
        k: str,
        where: dict[str, Any],
    ) -> dict[str, Any]:
        """The crew with `down` taken down, checkpointed for a bring-back (SPEC 6)."""
        async with locks.hold(k):
            run = await run_crew(ctx, client=client, personas=tuple(body.personas),
                                 languages=tuple(body.languages), use_mcp=settings.analyst_mcp,
                                 down=down, checkpoints=drills.checkpoints(k))  # fmt: skip
            record = {"source": "model" if client is not None else "offline",
                      "result": run.result.model_dump(mode="json", by_alias=True),
                      "drill": {"down": down, "pending": run.pending}, "match": m.id,
                      "moment": body.moment, "bring_backs": 0, **where}  # fmt: skip
            drills.put(k, record)
        return _drill_response(k, record)

    @app.post("/api/breakdowns/{key}/bring-back")
    async def bring_back(key: str, body: BringBackBody, request: Request) -> dict[str, Any]:
        """Re-run one downed step of a drill from its checkpoint; the rest is kept (SPEC 6)."""
        if not KEY.fullmatch(key) or drills.get(key) is None:
            raise HTTPException(404, "no failure drill with this key (drills last until the API "
                                     "restarts or redeploys): run the drill again")  # fmt: skip
        async with locks.hold(key):
            record = drills.get(key)
            if record is None:  # pruned while this request waited
                raise HTTPException(404, "no failure drill with this key: run the drill again")
            drill = record["drill"]
            if body.step not in drill["pending"]:
                raise HTTPException(409, f"the {body.step} is not waiting to be brought back")
            if record["bring_backs"] >= MAX_BRING_BACKS:
                raise HTTPException(409, f"this drill was brought back {MAX_BRING_BACKS} times: "
                                         "run a new drill")  # fmt: skip
            if not drills.has_checkpoints(key):
                raise HTTPException(410, "this drill's checkpoints are gone: run the drill again")
            drill_allowed(request)
            m = await match_or_404(record["match"])
            ctx = m.context(record.get("moment"))
            if ctx is None:
                raise HTTPException(410, "this drill's moment is no longer served: run it again")
            asked = record["result"]["request"]
            down = [d for d in drill["down"] if d != body.step]
            try:
                run = await run_crew(ctx, client=client, personas=tuple(asked["personas"]),
                                     languages=tuple(asked["languages"]),
                                     use_mcp=settings.analyst_mcp, down=down,
                                     checkpoints=drills.checkpoints(key),
                                     bring_back=body.step)  # fmt: skip
            except NotWaiting as e:
                raise HTTPException(410, f"{e}: run the drill again") from e
            record = {**record, "result": run.result.model_dump(mode="json", by_alias=True),
                      "drill": {"down": down, "pending": run.pending},
                      "bring_backs": record["bring_backs"] + 1}  # fmt: skip
            drills.put(key, record)
        return _drill_response(key, record)

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
    app.state.locks = locks
    app.state.cues = cues
    return app


configure_tracing()  # Application Insights when its connection string is set (SPEC 8)
app = create_app()
