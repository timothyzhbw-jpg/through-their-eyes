"""The API service (SPEC 2): live match stream, moments, stats, cached breakdowns, what-if, TTS,
and tamper checks (the verifier on a claim with one number changed, SPEC 7).

    uv run uvicorn api.main:app --reload

Live play never waits on a model: the stream and the moments are deterministic. Breakdowns and
what-if answers are computed once and cached by a content hash of everything that shapes them
(moment card, personas, languages, prompt version, model deployment). With a model configured,
regeneration is rate-limited per client and capped per UTC day across all clients
(`TTE_DAILY_MODEL_CAP`, SPEC 8); past either, the cached answer or the offline template is served,
flagged `rate_limited` or `capped`. With a model, the Analyst inspects the moment through our MCP
tool server, a subprocess per breakdown (`TTE_ANALYST_MCP`, on unless set to 0); at most
`TTE_CREW_CONCURRENCY` crew runs with a model run at once. A what-if question the model mapped
is kept by its normalised text, so asking it again costs no model call and no unit of the cap.

Speech speaks only voice cues the crew wrote, by key (api/tts.py); a cached breakdown is re-voiced
on read before those cues are recorded. The live stream, request bodies and response headers are
bounded for a public service (api/live.py, api/guard.py), and every response body and live
message counts against a per-client and a daily egress budget (api/egress.py).

Failure drill (SPEC 6): a breakdown request with `fail` takes those agents down for one fresh run,
kept under its own key and never under the cache keys of normal breakdowns. It counts against
the per-client limit and, with a model, the daily model cap; offline, drills have their own daily
cap (`DAILY_OFFLINE_DRILLS`). No model is called for a downed step.
`POST /api/breakdowns/{key}/bring-back` re-runs one downed step from the run's checkpoint, at most
`MAX_BRING_BACKS` times per drill. Every drill and bring-back is recorded (api/recorded.py). A
limited one is never a dead end: the recording of the same drill in the same state is replayed,
labelled with when it ran, else the crew runs without the model (counted against the offline
drills' cap), flagged `rate_limited` or `capped`. Only past that cap too: 429.

End-of-match recap (SPEC 6): `POST /api/recaps` runs the crew on a whole stitched match, cached
and limited exactly like a breakdown (the same per-client limit and daily model cap; past them,
the cached model recap or the offline template). `GET /api/recaps/{key}/cues` serves one script's
overlay cue sheet, the machine-readable cues a graphics engine renders. The live stream's `end`
says `full_time` when it reached the last frame: the web app opens the recap then.

Crew trace (SPEC 6): every crew run records its timeline (agents/crewtrace.py), stored with the
cached breakdown or recap (and a drill's record) and served by key from `GET
/api/breakdowns/{key}/trace` and `GET /api/recaps/{key}/trace`; a POST answer says whether it has
one (`traced`) but does not carry it. One cached before traces were recorded answers
`recorded: false`, "trace not recorded for this cached run".

Every breakdown, drill and recap answer says where it came from (`provenance`): `live` (the crew
ran for this request), `cached` (a crew run from `ran_at`), or `template` (no model call: this
client is rate-limited, today's cap is reached, or the service has no model). The web shows it as
given and never works it out from the other fields.

Every crew run checkpoints to files under the cache directory (`checkpoints/`), so a normal
breakdown interrupted mid-workflow, by a restart too, resumes from its last completed step. Its
checkpoints are deleted once it is cached. A drill keeps its record and checkpoints on this
replica's disk (`DrillStore`), the most recent `DRILLS_KEPT` only. A restart onto a new disk
(every redeploy) drops them: bring-back then answers 404, "run the drill again". One crew run
per key at a time.

Started from the environment, the service loads every match before it opens its port
(`TTE_WARM`, default on; 0, false or off turns it off), so the first export after a redeploy or
a restart is answered at once.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import re
import shutil
import unicodedata
import uuid
from contextlib import AbstractAsyncContextManager, asynccontextmanager, nullcontext, suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from agent_framework import FileCheckpointStorage
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import HTTPConnection
from fastapi.responses import Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from agents import whatif
from agents.context import MomentContext
from agents.crewtrace import CrewTrace
from agents.llm import client_from_env, sync_credential_from_env
from agents.prompts import PROMPT_VERSION
from agents.recap import RECAP_PROMPT_VERSION, run_recap_crew
from agents.schemas import AgentStep, Language, Persona
from agents.telemetry import configure_tracing
from agents.workflow import PIPELINE_VERSION, NotWaiting, run_crew
from api import guard, tts
from api.egress import MB, Egress, EgressLimit
from api.live import Slots, stream
from api.names import Renamed, rename
from api.recorded import Recordings, now, recording_key
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
RECORDINGS_KEPT = 200  # recorded drills and bring-backs, served when a viewer is limited
LIMITED = ("rate_limited", "capped")
KEY = re.compile(r"[0-9a-f]{32}")  # content_key()
WHATIF_VERSION = hashlib.sha256(whatif.WHATIF.encode()).hexdigest()[:12]
MAX_LIST = 8  # personas or languages in one request, before duplicates are dropped
NOT_RECORDED = "trace not recorded for this cached run"


def _unique(items: list) -> list:
    return list(dict.fromkeys(items))


Name = Annotated[str, Field(max_length=100)]  # a match or moment id
Personas = Annotated[
    list[Persona], Field(min_length=1, max_length=MAX_LIST), AfterValidator(_unique)
]
Languages = Annotated[
    list[Language], Field(min_length=1, max_length=MAX_LIST), AfterValidator(_unique)
]


class BreakdownBody(BaseModel):
    match: Name
    moment: Name | None = None
    personas: Personas = Field(default_factory=lambda: ["casual", "analyst"])
    languages: Languages = Field(default_factory=lambda: ["en", "zh"])
    regenerate: bool = False
    fail: list[AgentStep] = Field(default_factory=list, max_length=4)  # agents to take down


class BringBackBody(BaseModel):
    step: AgentStep


class RecapBody(BaseModel):
    match: Name
    personas: Personas = Field(default_factory=lambda: ["casual", "analyst"])
    languages: Languages = Field(default_factory=lambda: ["en", "zh"])
    regenerate: bool = False


class WhatIfBody(BaseModel):
    match: Name
    moment: Name | None = None  # which hero moment, in a match with several; default the first
    question: str = Field(min_length=1, max_length=300)
    language: Language = "en"
    persona: Persona = "analyst"


class TtsBody(BaseModel):
    """A voice cue to speak, by the `cache_key` the crew gave it; never SSML."""

    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=f"^{tts.KEY.pattern}$")


class VerifyBody(BaseModel):
    match: Name
    moment: Name | None = None  # which hero moment, in a match with several; default the first
    claim: str = Field(max_length=100)
    slot: str = Field(max_length=100)
    value: float = Field(strict=True, allow_inf_nan=False)  # a JSON number: no strings, no bools
    language: Language = "en"


def _question(text: str) -> str:
    """A what-if question as its mapping is cached: case, spacing and the closing punctuation do
    not change what it asks."""
    text = " ".join(unicodedata.normalize("NFKC", text).casefold().split())
    return text.rstrip(" ?!.")


NO_LIMITS = {"rate_limited": False, "capped": False}


def _ran_at(value: dict[str, Any]) -> str | None:
    """When the crew run that wrote a stored result started (UTC, ISO 8601): as stored with it,
    else its trace's last run; None for one cached before either was recorded."""
    if value.get("ran_at"):
        return value["ran_at"]
    runs = (value.get("trace") or {}).get("runs") or ()
    return runs[-1].get("started") if runs else None


def _provenance(value: dict[str, Any], cached: bool, limits: dict[str, bool]) -> dict[str, Any]:
    """Where an answer came from, for the web to show as it is (SPEC 2, 6): `live`, the crew ran
    for this request; `cached`, a crew run from `ran_at`; `template`, no model call, and why:
    this client is rate-limited, today's cap is reached, or the service has no model."""
    if value.get("source") == "offline":
        reason = ("rate_limited" if limits.get("rate_limited") else
                  "capped" if limits.get("capped") else "model_unavailable")  # fmt: skip
        return {"kind": "template", "ran_at": _ran_at(value), "reason": reason}
    return {"kind": "cached" if cached else "live", "ran_at": _ran_at(value), "reason": None}


def _answer(
    key: str, value: dict[str, Any], cached: bool, limits: dict[str, bool] = NO_LIMITS
) -> dict[str, Any]:
    """A stored crew result as a POST answers it: its key, whether it was cached and why a
    regeneration did not run, where it came from, and whether it has a crew trace (not the trace,
    which has its own endpoint)."""
    public = {k: v for k, v in value.items() if k not in ("trace", "ran_at")}
    return {"key": key, "cached": cached, **NO_LIMITS, **limits, **public,
            "traced": value.get("trace") is not None,
            "provenance": _provenance(value, cached, limits)}  # fmt: skip


def _traced(key: str, value: dict[str, Any]) -> dict[str, Any]:
    """GET …/trace: the crew trace stored with a cached result, or why there is none."""
    trace = value.get("trace")
    if trace is None:
        return {"key": key, "recorded": False, "trace": None, "detail": NOT_RECORDED}
    return {"key": key, "recorded": True, "trace": trace}


def _trace_of(record: dict[str, Any]) -> CrewTrace | None:
    """A drill's crew trace so far, for its bring-back to continue; None if it has none."""
    try:
        return CrewTrace.model_validate(record["trace"]) if record.get("trace") else None
    except ValidationError:
        return None


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
    # Values cached before players and clubs had names are renamed when read (api/names.py).
    breakdowns = cues.recording(tts.Revoiced(Renamed(storage.breakdowns)))
    answers = Renamed(storage.answers)
    recaps = cues.recording(Renamed(storage.recaps, clubs=True))  # its lines may be spoken too
    limiter = RateLimiter(*settings.rate_limit)
    verify_limiter = RateLimiter(*settings.verify_rate_limit)
    cap = DailyCap(settings.daily_model_cap)
    drill_cap = DailyCap(DAILY_OFFLINE_DRILLS)  # offline drills; with a model, `cap` applies
    checkpoint_dir = Path(settings.cache_dir) / "checkpoints"
    runs_dir = checkpoint_dir / "runs"
    drills = DrillStore(checkpoint_dir / "drills", DRILLS_KEPT)
    recordings = Recordings(checkpoint_dir / "recordings", RECORDINGS_KEPT)
    locks = KeyedLocks()  # one crew run per key at a time
    speech_limiter = RateLimiter(*settings.tts_rate_limit)  # POST /api/tts per client
    speech_cap = DailyCap(settings.daily_tts_cap)  # Azure Speech syntheses per UTC day
    speech_calls = asyncio.Semaphore(settings.tts_concurrency)  # Azure Speech calls in flight
    synthesizing = KeyedLocks()  # one synthesis per cue key at a time
    slots = Slots(settings.live_per_client, settings.live_max_total)
    per_client_mb, egress_window_s = settings.egress_per_client
    egress = Egress(per_client_mb * MB, egress_window_s, int(settings.daily_egress_gb * 1000 * MB))
    # Crew runs with a model at once: each starts an MCP server subprocess (about 90 MB).
    crew_slots = asyncio.Semaphore(settings.crew_concurrency)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # uvicorn opens the port after this: a new revision gets no traffic until its matches
        # are loaded, which takes longer than the web app waits for the first export.
        if settings.warm:
            await store.warm()
        yield
        storage.close()
        if close is not None:
            await close()

    app = FastAPI(title="Through Their Eyes", version=VERSION, lifespan=lifespan)
    app.add_middleware(EgressLimit, egress=egress, client_ip=_client_ip)
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
        On the judging window's UTC days, its limits apply (`Settings.limits_on`).
        """
        (limiter.count, limiter.window_s), cap.count = settings.limits_on(datetime.now(UTC).date())
        if cap.left() <= 0:
            return "capped"
        if not limiter.allow(_client_ip(request)):
            return "rate_limited"
        cap.take()
        return "model"

    def crew_slot(llm: Any) -> AbstractAsyncContextManager[Any]:
        """A slot for a crew run with a model (`crew_slots`); a run without one needs none."""
        return crew_slots if llm is not None else nullcontext()

    def drill_verdict(request: Request) -> str:
        """Whether a drill or a bring-back may run the crew now: "model", "offline",
        "rate_limited" or "capped". It counts against the per-client limit and a daily cap, the
        model's or, offline, the drills' own."""
        if client is not None:
            return regeneration(request)
        if drill_cap.left() <= 0:
            return "capped"
        if not limiter.allow(_client_ip(request)):
            return "rate_limited"
        drill_cap.take()
        return "offline"

    def limited_run(verdict: str, rk: str) -> dict[str, Any] | None:
        """A limited drill or bring-back is never a dead end: the recording of the same drill in
        the same state if there is one, else None and the crew runs offline (no model, counted
        against the offline drills' cap). Past that cap too: 429."""
        if (shown := replay(rk, verdict)) is not None:
            return shown
        if not drill_cap.take():
            if verdict == "rate_limited":
                raise HTTPException(429, "rate_limited: try again in a few minutes")
            raise HTTPException(429, "capped: today's budget is used up; try again tomorrow (UTC)")
        return None

    def flags(verdict: str) -> dict[str, bool]:
        return {"rate_limited": verdict == "rate_limited", "capped": verdict == "capped"}

    def rec_parts(ctx: MomentContext, asked: dict[str, Any], down0: list[str]) -> dict[str, Any]:
        """What shapes a drill's recordings, but for its path (api/recorded.py)."""
        return {"card": ctx.card.content_hash(), "personas": asked["personas"],
                "languages": asked["languages"], "prompts": PROMPT_VERSION,
                "pipeline": PIPELINE_VERSION, "down": down0}  # fmt: skip

    def replay(rk: str, verdict: str) -> dict[str, Any] | None:
        """Recording `rk`, labelled with the time it ran. Its pending agents are the ones whose
        bring-back was recorded too, so every button it offers leads somewhere."""
        rec = recordings.get(rk)
        if rec is None:
            return None
        response = rec["response"]
        cues.add_drill(response)  # its voice cues may be spoken, like any served breakdown

        def recorded(step: str) -> bool:
            return recordings.has(recording_key(**rec["parts"], path=[*rec["path"], step]))

        pending = [step for step in response["drill"]["pending"] if recorded(step)]
        ran = {"source": response["source"], "ran_at": rec["at"]}
        return {**response, "key": rk, "cached": True, **flags(verdict),
                "drill": {**response["drill"], "pending": pending},
                "provenance": _provenance(ran, cached=True, limits=flags(verdict)),
                "recorded": {"at": rec["at"]}}  # fmt: skip

    def record_run(ctx: MomentContext, record: dict[str, Any], response: dict[str, Any]) -> None:
        """Record a drill or a bring-back that ran, under the drill's history."""
        parts = rec_parts(ctx, record["result"]["request"], record["history"]["down0"])
        path = record["history"]["path"]
        public = {k: v for k, v in response.items()
                  if k not in ("key", "rate_limited", "capped", "provenance")}  # fmt: skip
        recordings.put(recording_key(**parts, path=path),
                       {"at": record.get("ran_at") or now(), "parts": parts, "path": path,
                        "response": public, "trace": record.get("trace")})  # fmt: skip

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "version": VERSION, "model": model, "speech": tts.configured(),
                "analyst_mcp": client is not None and settings.analyst_mcp}  # fmt: skip

    @app.get("/api/matches")
    async def matches() -> list[dict[str, Any]]:
        return [{"id": mid, "scenario": s, "seed": seed}
                for mid in store.listed for s, seed in [store.known[mid]]]  # fmt: skip

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
    async def match_export(mid: str, request: Request) -> Response:
        m = await match_or_404(mid)
        headers = {"Vary": "Accept-Encoding"}
        if "gzip" in request.headers.get("accept-encoding", "").lower():
            headers["Content-Encoding"] = "gzip"
            return Response(m.export_gzip, media_type="application/json", headers=headers)
        return Response(m.export_json, media_type="application/json", headers=headers)

    @app.get("/api/matches/{mid}/moments")
    async def match_moments(mid: str) -> list[dict[str, Any]]:
        return (await match_or_404(mid)).cards

    @app.get("/api/matches/{mid}/stats")
    async def match_stats(
        mid: str,
        frame: Annotated[int | None, Query(ge=0)] = None,
        tracks: bool = False,
    ) -> dict[str, Any]:
        """Live match stats (SPEC 4.6): the snapshot at `frame` (default: the last), measured
        from the tracking and events this service streams. `tracks` adds what viewers draw."""
        m = await match_or_404(mid)
        if m.stats is None:
            raise HTTPException(503, f"no stats for {mid}")
        return m.stats.snapshot(frame, tracks=tracks).model_dump(mode="json")

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
        if refused := egress.refused(ip) or slots.take(ip):
            await ws.send_json({"type": "error", "detail": refused})
            await ws.close(code=4429)
            return
        try:
            await stream(ws, match, speed, start, settings.live_max_s,
                         sent=lambda n: egress.charge(ip, n))  # fmt: skip
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
            down = sorted(set(body.fail))
            verdict = drill_verdict(request)
            asked = {"personas": body.personas, "languages": body.languages}
            rk = recording_key(**rec_parts(ctx, asked, down), path=[])
            if verdict in LIMITED and (shown := limited_run(verdict, rk)) is not None:
                return shown
            llm = client if verdict == "model" else None
            k = key(model if llm is not None else "offline", fail=down, run=uuid.uuid4().hex)
            return await _drill(m, ctx, body, down, k, where, llm, flags(verdict))
        # The Analyst's tools shape a model breakdown, so they are part of its key.
        model_key = key(model, analyst_tools="mcp") if settings.analyst_mcp else key(model)
        offline_key = key("offline")
        candidates = ([model_key] if client is not None else []) + [offline_key]
        # With a model, only a model result is a cache hit up front: a template served while a
        # client was limited must not stand in for the model on later requests.
        if not body.regenerate and (hit := breakdowns.get(candidates[0])) is not None:
            return {**_answer(candidates[0], hit, cached=True), "drill": None, **where}
        limits = dict(NO_LIMITS)
        if client is not None:
            verdict = regeneration(request)
            if verdict == "model":
                return {**await _compute(ctx, body, client, "model", model_key), **where}
            limits[verdict] = True
            for k in candidates:
                if (hit := breakdowns.get(k)) is not None:
                    return {**_answer(k, hit, cached=True, limits=limits), "drill": None, **where}
        return {**await _compute(ctx, body, None, "offline", offline_key, limits), **where}

    async def _compute(
        ctx: MomentContext,
        body: BreakdownBody,
        llm,
        source: str,
        k: str,
        limits: dict[str, bool] = NO_LIMITS,
    ) -> dict[str, Any]:
        """Run the crew and cache the result. A run of this key that was interrupted resumes from
        its checkpoint; once the result is cached, the checkpoints go."""
        async with locks.hold(k), crew_slot(llm):
            run = await run_crew(ctx, client=llm, personas=tuple(body.personas),
                                 languages=tuple(body.languages), use_mcp=settings.analyst_mcp,
                                 checkpoints=FileCheckpointStorage(runs_dir / k))  # fmt: skip
            value = {"source": source, "result": run.result.model_dump(mode="json", by_alias=True),
                     "trace": run.trace.model_dump(mode="json"),
                     "ran_at": run.trace.runs[-1].started}  # fmt: skip
            breakdowns.put(k, value)
            shutil.rmtree(runs_dir / k, ignore_errors=True)
            for empty in (runs_dir, checkpoint_dir):  # a finished run leaves nothing on disk
                with suppress(OSError):
                    empty.rmdir()
        return {**_answer(k, value, cached=False, limits=limits), "drill": None}

    def _drill_response(
        k: str, record: dict[str, Any], limits: dict[str, bool] = NO_LIMITS
    ) -> dict[str, Any]:
        public = {name: record[name] for name in ("source", "result", "drill")}
        cues.add_drill(public)  # its voice cues may be spoken, like any served breakdown
        where = {"possession": record["possession"]} if "possession" in record else {}
        stored = {**public, "trace": record.get("trace"), "ran_at": record.get("ran_at")}
        # Every drill runs the crew afresh; `limits`: why it ran without the model.
        return {**_answer(k, stored, cached=False, limits=limits), **where}

    async def _drill(
        m: Match,
        ctx: MomentContext,
        body: BreakdownBody,
        down: list[str],
        k: str,
        where: dict[str, Any],
        llm: Any,
        limits: dict[str, bool] = NO_LIMITS,
    ) -> dict[str, Any]:
        """The crew with `down` taken down, checkpointed for a bring-back and recorded (SPEC 6).
        `llm`: the model, or None for an offline run."""
        async with locks.hold(k), crew_slot(llm):
            run = await run_crew(ctx, client=llm, personas=tuple(body.personas),
                                 languages=tuple(body.languages), use_mcp=settings.analyst_mcp,
                                 down=down, checkpoints=drills.checkpoints(k))  # fmt: skip
            record = {"source": "model" if llm is not None else "offline",
                      "result": run.result.model_dump(mode="json", by_alias=True),
                      "drill": {"down": down, "pending": run.pending}, "match": m.id,
                      "moment": body.moment, "bring_backs": 0,
                      "history": {"down0": down, "path": []},
                      "trace": run.trace.model_dump(mode="json"),
                      "ran_at": run.trace.runs[-1].started, **where}  # fmt: skip
            drills.put(k, record)
        response = _drill_response(k, record, limits)
        record_run(ctx, record, response)
        return response

    @app.post("/api/breakdowns/{key}/bring-back")
    async def bring_back(key: str, body: BringBackBody, request: Request) -> dict[str, Any]:
        """Re-run one downed step of a drill from its checkpoint; the rest is kept (SPEC 6).

        Limited, it replays the recording of the same bring-back, else runs it offline. On a
        recorded drill (its key is a recording's), it replays the recorded bring-back."""
        if KEY.fullmatch(key) and drills.get(key) is None and (rec := recordings.get(key)):
            child = recording_key(**rec["parts"], path=[*rec["path"], body.step])
            if (shown := replay(child, "")) is None:
                raise HTTPException(404, f"this recorded run has no bring-back of the "
                                         f"{body.step}: run a new drill")  # fmt: skip
            return shown
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
            verdict = drill_verdict(request)
            m = await match_or_404(record["match"])
            ctx = m.context(record.get("moment"))
            if ctx is None:
                raise HTTPException(410, "this drill's moment is no longer served: run it again")
            asked = record["result"]["request"]
            history = record.get("history") or {"down0": drill["down"], "path": []}
            path = [*history["path"], body.step]
            rk = recording_key(**rec_parts(ctx, asked, history["down0"]), path=path)
            if verdict in LIMITED and (shown := limited_run(verdict, rk)) is not None:
                return shown
            llm = client if verdict == "model" else None  # limited: the step comes back offline
            down = [d for d in drill["down"] if d != body.step]
            try:
                async with crew_slot(llm):
                    run = await run_crew(ctx, client=llm, personas=tuple(asked["personas"]),
                                         languages=tuple(asked["languages"]),
                                         use_mcp=settings.analyst_mcp, down=down,
                                         checkpoints=drills.checkpoints(key),
                                         bring_back=body.step, trace=_trace_of(record))  # fmt: skip
            except NotWaiting as e:
                raise HTTPException(410, f"{e}: run the drill again") from e
            on_model = llm is not None and record["source"] == "model"
            record = {**record, "result": run.result.model_dump(mode="json", by_alias=True),
                      "source": "model" if on_model else "offline",
                      "drill": {"down": down, "pending": run.pending},
                      "bring_backs": record["bring_backs"] + 1,
                      "history": {"down0": history["down0"], "path": path},
                      "trace": run.trace.model_dump(mode="json"),
                      "ran_at": run.trace.runs[-1].started}  # fmt: skip
            drills.put(key, record)
        response = _drill_response(key, record, flags(verdict))
        record_run(ctx, record, response)
        return response

    @app.get("/api/breakdowns/{key}/trace")
    async def breakdown_trace(key: str) -> dict[str, Any]:
        """The crew trace of a breakdown or a drill this service ran (SPEC 6)."""
        value = None
        if KEY.fullmatch(key):  # a drill, a cached breakdown, or a recorded drill (api/recorded.py)
            value = drills.get(key) or storage.breakdowns.get(key) or recordings.get(key)
        if value is None:
            raise HTTPException(404, "no breakdown with this key: request it with "
                                     "POST /api/breakdowns")  # fmt: skip
        return _traced(key, value)

    @app.get("/api/recaps/{key}/trace")
    async def recap_trace(key: str) -> dict[str, Any]:
        """The crew trace of an end-of-match recap this service ran (SPEC 6)."""
        value = storage.recaps.get(key) if KEY.fullmatch(key) and storage.recaps else None
        if value is None:
            raise HTTPException(404, "no recap with this key: request it with POST /api/recaps")
        return _traced(key, value)

    @app.post("/api/recaps")
    async def recap(body: RecapBody, request: Request) -> dict[str, Any]:
        """The end-of-match recap of a stitched match (agents/recap.py), cached by the content
        hash of its evidence, personas, languages, prompt version and model."""
        m = await match_or_404(body.match)
        if m.stitched is None:
            raise HTTPException(404, f"recaps are for stitched matches, not {m.id}")
        async with locks.hold(f"recap-evidence:{m.id}"):
            rc = await asyncio.to_thread(m.recap)

        def key(model_name: str, **extra: Any) -> str:
            return content_key(kind="recap", match=rc.content_hash(),
                               personas=sorted(body.personas), languages=sorted(body.languages),
                               prompts=RECAP_PROMPT_VERSION, pipeline=PIPELINE_VERSION,
                               model=model_name, **extra)  # fmt: skip

        model_key = key(model, analyst_tools="mcp") if settings.analyst_mcp else key(model)
        offline_key = key("offline")
        candidates = ([model_key] if client is not None else []) + [offline_key]
        if not body.regenerate and (hit := recaps.get(candidates[0])) is not None:
            return _answer(candidates[0], hit, cached=True)
        limits = dict(NO_LIMITS)
        if client is not None:
            verdict = regeneration(request)
            if verdict == "model":
                return await _compute_recap(rc, body, client, "model", model_key)
            limits[verdict] = True
            for k in candidates:
                if (hit := recaps.get(k)) is not None:
                    return _answer(k, hit, cached=True, limits=limits)
        return await _compute_recap(rc, body, None, "offline", offline_key, limits)

    async def _compute_recap(
        rc, body: RecapBody, llm, source: str, k: str, limits: dict[str, bool] = NO_LIMITS
    ) -> dict[str, Any]:
        async with locks.hold(k):
            if (hit := recaps.get(k)) is not None and not body.regenerate:  # made while waiting
                return _answer(k, hit, cached=True, limits=limits)
            if llm is not None and settings.analyst_mcp:  # the MCP server reads the evidence
                folder = Path(settings.cache_dir) / "recap_evidence"
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / f"{rc.content_hash()[:32]}.json"
                if not path.exists():
                    path.write_text(json.dumps(rc.evidence(), ensure_ascii=False))
                rc = dataclasses.replace(rc, evidence_path=str(path))
            async with crew_slot(llm):
                run = await run_recap_crew(rc, client=llm, personas=tuple(body.personas),
                                           languages=tuple(body.languages),
                                           use_mcp=settings.analyst_mcp)  # fmt: skip
            # Its claims say Home and Away (their templates are in the cache key): name the clubs.
            value = rename({"source": source, "result": run.result.model_dump(mode="json"),
                            "trace": run.trace.model_dump(mode="json"),
                            "ran_at": run.trace.runs[-1].started}, clubs=True)  # fmt: skip
            recaps.put(k, value)
        return _answer(k, value, cached=False, limits=limits)

    @app.get("/api/recaps/{key}/cues")
    async def recap_cues(key: str, persona: Persona, language: Language) -> dict[str, Any]:
        """One script's overlay cue sheet: timed, machine-readable cues (agents/recap.py)."""
        hit = recaps.get(key) if KEY.fullmatch(key) else None
        if hit is None:
            raise HTTPException(404, "no recap with this key: request it with POST /api/recaps")
        for script in hit["result"]["scripts"]:
            if (script["persona"], script["language"]) == (persona, language):
                return script["cues"]
        raise HTTPException(404, f"this recap has no {persona} script in {language}")

    @app.post("/api/whatif")
    async def what_if(body: WhatIfBody, request: Request) -> dict[str, Any]:
        m = await match_or_404(body.match)
        ctx = m.context(body.moment)
        if ctx is None:
            raise HTTPException(404, f"what-ifs are available for {', '.join(m.contexts)}")
        # The model maps a question once: asked again, in any case or spacing, its mapping is
        # read back, with no model call and no unit of the daily cap.
        qkey = content_key(kind="whatif-question", match=m.id, moment=ctx.card.id,
                           question=_question(body.question), version=WHATIF_VERSION,
                           model=model)  # fmt: skip
        if client is not None and (known := answers.get(qkey)) is not None:
            verdict, (action, source) = "mapped", (known["action"], "llm")
        else:
            verdict = regeneration(request) if client is not None else "offline"
            llm = client if verdict == "model" else None
            action, source = await whatif.map_question(ctx, body.question, llm)
            if source == "llm":
                answers.put(qkey, {"action": action})
        capped = verdict == "capped"
        if action is not None:
            # A match with one hero keeps its cache keys; with several, the moment is part of it.
            moment = {"moment": ctx.card.id} if len(m.contexts) > 1 else {}
            k = content_key(match=m.id, action=action, language=body.language,
                            persona=body.persona, version=WHATIF_VERSION, **moment)  # fmt: skip
            if (hit := answers.get(k)) is not None:
                return {"key": k, "cached": True, "capped": capped,
                        "answer": {**hit, "question": body.question}}  # fmt: skip
        answer = await whatif.answer_question(ctx, body.question, body.language, body.persona,
                                              mapped=(action, source))  # fmt: skip
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
