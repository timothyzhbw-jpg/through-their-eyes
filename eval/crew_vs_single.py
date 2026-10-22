"""Crew vs single agent (SPEC 6, Best Multi-Agent System): is it the crew or the Verifier?

    uv run --group eval --env-file .env python -m eval.crew_vs_single

The narration ablation (eval/narration_ablation.py) shows what the deterministic Verifier
catches. This eval separates the Verifier from the collaboration of agents, with four arms on the
same moments, audiences, model, MCP tools, schemas and deterministic code:
- A. single agent, no Verifier: one Foundry call does the four agents' jobs (eval/single_agent.py),
  and its lines air as drafted;
- B. single agent + the Verifier, with the crew's rewrite budget (two rounds, then drops);
  "the Verifier" here checks lines (`eval.single_agent.LineVerifier`): the persona rules'
  whole-script checks (agents/persona_rules.py, SPEC 6) are off, as when this eval was measured;
- C. the crew without the Verifier loop: Director → Analyst → Telestrator ∥ narration → Voice;
- D. the full crew, as deployed (agents/workflow.py).
A and B are one run (B's first draft is what A airs), and so are C and D: the Verifier runs after
the drafts are written and changes nothing upstream, so each pair compares the same samples.

Then the failure drill: the Analyst or the Telestrator taken down (`run_crew(down=...)`), whether a
valid, verified breakdown still airs, and what bringing the agent back costs.

Every model request goes through a chat middleware that records its role, tokens, latency, whether
the reply fits the schema it was asked for, and the numbers in its free text, and caches the
reply under out/crew_vs_single/requests/ by the request's content. A request already made is
answered from that cache, never twice: a drill re-uses the normal run's replies for every step it
does not change, and a re-run of the eval makes no model call. Run records and groundedness
scores are cached too, and the report is scored from them by the current code.
Writes eval/reports/crew_vs_single.md.
"""

from __future__ import annotations

import argparse
import asyncio
import contextvars
import datetime as dt
import hashlib
import json
import os
import re
import time
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import numpy as np
from agent_framework import ChatMiddleware, ChatResponse, InMemoryCheckpointStorage
from pydantic import BaseModel, ValidationError

from agents.context import MomentContext
from agents.llm import _validation_error, describe
from agents.plan import validate_plan
from agents.schemas import PLAYER_ID, BreakdownResult, Language, Persona, ScriptLine
from agents.workflow import (
    AGENTS,
    BREAKDOWN,
    NAME,
    Narration,
    Story,
    Voice,
    run_crew,
)
from eval.free_text import FreeTextNarration
from eval.narration_ablation import Line, _check
from eval.single_agent import REJECTED, Lines, LineVerifier, solo_story
from explain.numbers import number_tokens
from explain.render import render_claim

Structure = Literal["single", "crew"]
Arm = Literal["A", "B", "C", "D"]
Fault = Literal["none", "analyst", "telestrator"]
ARMS: dict[Arm, tuple[Structure, bool]] = {  # arm -> (structure, verified)
    "A": ("single", False), "B": ("single", True), "C": ("crew", False), "D": ("crew", True),
}  # fmt: skip
LABEL: dict[Arm, str] = {
    "A": "A · single agent", "B": "B · single + Verifier",
    "C": "C · crew, no Verifier", "D": "D · crew (deployed)",
}  # fmt: skip
PERSONAS: tuple[Persona, ...] = ("casual", "analyst")  # the API's default audiences
LANGUAGES: tuple[Language, ...] = ("en", "zh")

# The three hero moments the deployed site serves, which are also match-1's three hero
# possessions (sim.match.match_heroes(1)); the shot hero on main, not deployed; and
# one held-out seed of the two open-play heroes (their design seeds are 0-99, SPEC 3.6).
MOMENTS = "blind_side_run:3,press_escape:0,corner_blind_side:0,far_post_finish:0," \
          "blind_side_run:100,press_escape:200"  # fmt: skip
DRILLS = "blind_side_run:3,press_escape:0,corner_blind_side:0"
FREE_TEXT = "blind_side_run:3"
DEPLOYED = {("blind_side_run", 3), ("press_escape", 0), ("corner_blind_side", 0)}
FAULTS: tuple[Fault, ...] = ("analyst", "telestrator")

TIMEOUT_S = 30.0  # per agent run, every arm; the deployed crew uses 8 s per step (DEPLOYED_STEP_S)
DEPLOYED_STEP_S = 8.0
MAX_CALLS = 240
# gpt-4.1-mini, Azure OpenAI Global Standard list price, USD per million tokens.
PRICE = {"input": 0.40, "cached": 0.10, "output": 1.60}
# What a run can cost in new model requests, to stop before one would pass the budget.
ESTIMATE = {("single", "anchored"): 6, ("crew", "anchored"): 20, ("single", "free_text"): 9,
            ("crew", "free_text"): 30, "drill": 12, "back": 2}  # fmt: skip
REPORTS = Path(__file__).parent / "reports"
CACHE = Path("out") / "crew_vs_single"
BOOT = 10_000  # bootstrap resamples, over moments
FREE_FIELDS = ("reason", "angle", "text")  # the reply fields a model fills with its own words


# --- recording every model request ---------------------------------------------------------------


class Request(BaseModel):
    role: str  # the agent's ROLE line: director, analyst, telestrator, pbp, color, solo
    rewrite: bool  # a rewrite round's call
    kind: Literal["reply", "tool_call", "error"]
    cached: bool  # answered from the request cache: no model call
    ms: float  # the model's time (as recorded when the call was made)
    input_tokens: int = 0
    cached_tokens: int = 0  # of the input, served from the provider's prompt cache
    output_tokens: int = 0
    valid: bool | None = None  # a reply that fits the schema it was asked for
    error: str | None = None  # why it does not fit, or why the call failed (class and field)
    digits: list[str] = []  # numbers the model wrote in its own words (`FREE_FIELDS`)

    @property
    def cost(self) -> float:
        fresh = self.input_tokens - self.cached_tokens
        return (fresh * PRICE["input"] + self.cached_tokens * PRICE["cached"]
                + self.output_tokens * PRICE["output"]) / 1e6  # fmt: skip


@dataclass
class RunState:
    """What one run records, shared by the middleware and the recording executors."""

    t0: float
    requests: list[Request] = field(default_factory=list)
    first_drafts: dict[str, list[ScriptLine]] | None = None  # what the Verifier first checks
    t_first_drafts: float | None = None
    t_planned: float | None = None
    seen: Counter = field(default_factory=Counter)  # request contents asked so far in this run


RUN: contextvars.ContextVar[RunState | None] = contextvars.ContextVar("run", default=None)
_ROLE = re.compile(r"ROLE:\s*(\w+)")


def _role(context: Any) -> str:
    m = _ROLE.search(str((context.options or {}).get("instructions") or ""))
    return m.group(1) if m else "?"


def _canonical(context: Any) -> str:
    """Everything that decides the reply, as stable JSON.

    A tool round's follow-up is keyed by the conversation it continues (the server holds the
    first request and its tool calls) and the calls it answers. Its messages are the tool
    results, which our MCP server returns the same for the same calls, but Agent Framework gives
    each result a random id (`af-call-…`), so they cannot be part of the key."""
    opts = context.options or {}
    answered = sorted(c.call_id for m in context.messages for c in m.contents
                      if c.type == "function_result")  # fmt: skip
    if opts.get("conversation_id") and answered:
        return json.dumps({"follows": opts["conversation_id"], "answers": answered})
    schema = opts.get("response_format")
    data = {
        "model": opts.get("model"),
        "instructions": opts.get("instructions"),
        "conversation_id": opts.get("conversation_id"),
        "tool_choice": str(opts.get("tool_choice")),
        "tools": sorted(getattr(t, "name", str(t)) for t in opts.get("tools") or []),
        "schema": schema.model_json_schema() if isinstance(schema, type) else str(schema),
        "messages": [m.to_dict() for m in context.messages],
    }
    return json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)


def digits_in(text: str) -> list[str]:
    """Numbers in the free-text fields of a reply (player ids are not numbers, as `no_numbers`)."""
    try:
        data: Any = json.loads(text)
    except ValueError:
        data = {"text": text}
    found: list[str] = []

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                if k in FREE_FIELDS and isinstance(v, str):
                    found.extend(t.text for t in number_tokens(PLAYER_ID.sub("X", v)))
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(data)
    return found


def _digits_in_errors(e: ValidationError) -> list[str]:
    """Numbers in the free-text fields a reply failed on: Foundry parses the structured output
    itself and raises, so the fields' values are only in the validation error."""
    found: list[str] = []
    for err in e.errors():
        if err["loc"] and err["loc"][-1] in FREE_FIELDS and isinstance(err.get("input"), str):
            found += [t.text for t in number_tokens(PLAYER_ID.sub("X", err["input"]))]
    return found


class Recorder(ChatMiddleware):
    """Records every model request of the current run (`RUN`) and caches each reply by the
    request's content. `offline`: answer from the cache only; a request not in it fails."""

    def __init__(self, folder: Path | None, offline: bool = False) -> None:
        self.folder = folder
        self.offline = offline
        self.calls = 0  # model calls made (not answered from the cache)

    def _path(self, key: str) -> Path | None:
        return self.folder / key[:2] / f"{key}.json" if self.folder is not None else None

    async def process(self, context: Any, call_next: Callable[[], Any]) -> None:
        state = RUN.get()
        role = _role(context)
        last = context.messages[-1] if context.messages else None
        rewrite = REJECTED in str(getattr(last, "text", "") or "")
        content = _canonical(context)
        # The n-th identical request of a run (a retry asks the same again) is its own sample:
        # a retry is a new call, and a drill replays the normal run's first ask and its retry.
        n = state.seen[content] if state is not None else 0
        if state is not None:
            state.seen[content] += 1
        key = hashlib.sha256((content + (f"#{n}" if n else "")).encode()).hexdigest()
        path = self._path(key)
        if path is not None and path.exists():
            hit = json.loads(path.read_text())
            context.result = ChatResponse.from_dict(hit["response"])
            entry = self._entry(context, role, rewrite, True, hit["ms"])
        else:
            if self.offline:
                raise RuntimeError("not in the request cache (--cached-only)")
            self.calls += 1
            started = time.perf_counter()
            try:
                await call_next()
            except BaseException as e:  # a timeout cancels the call: it was still made
                ms = (time.perf_counter() - started) * 1000
                if state is not None:
                    failed = Request(role=role, rewrite=rewrite, kind="error", cached=False,
                                     ms=ms, error=describe(e))  # fmt: skip
                    if (invalid := _validation_error(e)) is not None:  # a reply that does not fit
                        failed.valid, failed.digits = False, _digits_in_errors(invalid)
                    state.requests.append(failed)
                raise
            ms = (time.perf_counter() - started) * 1000
            entry = self._entry(context, role, rewrite, False, ms)
            if path is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps({"role": role, "ms": ms,
                                            "response": context.result.to_dict()},
                                           ensure_ascii=False))  # fmt: skip
        if state is not None:
            state.requests.append(entry)

    @staticmethod
    def _entry(context: Any, role: str, rewrite: bool, cached: bool, ms: float) -> Request:
        result: ChatResponse = context.result
        usage = result.usage_details or {}
        entry = Request(
            role=role, rewrite=rewrite, kind="reply", cached=cached, ms=round(ms, 1),
            input_tokens=int(usage.get("input_token_count") or 0),
            cached_tokens=int(usage.get("openai.cached_input_tokens") or 0),
            output_tokens=int(usage.get("output_token_count") or 0),
        )  # fmt: skip
        calls = [c for m in result.messages for c in m.contents if c.type == "function_call"]
        if calls:
            entry.kind = "tool_call"
            return entry
        text = result.text or ""
        entry.digits = digits_in(text)
        schema = (context.options or {}).get("response_format")
        if isinstance(schema, type) and issubclass(schema, BaseModel):
            try:
                schema.model_validate_json(text)
                entry.valid = True
            except ValidationError as e:
                entry.valid, entry.error = False, describe(e)
        return entry


class RecordingVerifier(LineVerifier):
    """Keeps the first drafts it checks (what airs with no Verifier) and when they arrived."""

    def _round(self, drafts):
        state = RUN.get()
        if state is not None and drafts.round == 0 and state.first_drafts is None:
            state.first_drafts = {f"{p}/{lg}": [line.model_copy() for line in lines]
                                  for (p, lg), lines in drafts.scripts.items()}  # fmt: skip
            state.t_first_drafts = time.perf_counter()
        return super()._round(drafts)


class RecordingVoice(Voice):
    """Notes when the plan arrived (the other half of what airs with no Verifier)."""

    async def _join(self, ctx, msg=None) -> None:
        state = RUN.get()
        if state is not None and self.planned is not None and state.t_planned is None:
            state.t_planned = time.perf_counter()
        await super()._join(ctx, msg)


class _FreeTextCrewNarration(FreeTextNarration):
    pass


def story(structure: Structure, lines: Lines) -> Story:
    if structure == "single":
        return solo_story(lines, RecordingVerifier, RecordingVoice)
    narration: type[Narration] = Narration if lines == "anchored" else _FreeTextCrewNarration
    b = BREAKDOWN
    return Story(NAME, b.director, b.analyst, b.telestrator, narration, RecordingVerifier,
                 RecordingVoice)  # fmt: skip


# --- one run --------------------------------------------------------------------------------------


class RunRecord(BaseModel):
    scenario: str
    seed: int
    structure: Structure
    lines: Lines
    fault: Fault = "none"
    phase: Literal["run", "bring_back"] = "run"
    result: BreakdownResult
    first_drafts: dict[str, list[ScriptLine]]  # per persona/language, after tidy
    requests: list[Request]
    ms_first: float | None  # until the first drafts and the plan were ready: no Verifier
    ms_total: float  # until the breakdown aired, Verifier and rewrites included
    pending: list[str]  # steps waiting to be brought back
    date: str

    @property
    def moment(self) -> str:
        return f"{self.scenario}-{self.seed}"

    @property
    def live(self) -> bool:
        """Every request was a model call made in this run, so its times are wall times."""
        return all(not r.cached for r in self.requests)


@dataclass(frozen=True)
class Spec:
    scenario: str
    seed: int
    structure: Structure
    lines: Lines = "anchored"
    fault: Fault = "none"

    @property
    def name(self) -> str:
        return f"{self.scenario}-{self.seed}_{self.structure}_{self.lines}_{self.fault}"

    @property
    def back(self) -> str:
        """The step a drill brings back: the downed agent, or the single agent's one call."""
        return "director" if self.structure == "single" else self.fault


async def run_one(
    ctx: MomentContext,
    spec: Spec,
    client: Any,
    timeout_s: float = TIMEOUT_S,
    checkpoints: Any = None,
    bring_back: str | None = None,
    personas: Sequence[Persona] = PERSONAS,
    languages: Sequence[Language] = LANGUAGES,
    use_mcp: bool = True,
) -> RunRecord:
    state = RunState(time.perf_counter())
    token = RUN.set(state)
    try:
        down = [] if spec.fault == "none" or bring_back else [spec.fault]
        run = await run_crew(
            ctx, client=client, personas=tuple(personas), languages=tuple(languages),
            step_timeout_s=timeout_s, use_mcp=use_mcp, down=down, checkpoints=checkpoints,
            bring_back=bring_back, story=story(spec.structure, spec.lines),
        )  # fmt: skip
    finally:
        RUN.reset(token)
    end = time.perf_counter()
    first = None
    if state.t_first_drafts is not None and state.t_planned is not None:
        first = (max(state.t_first_drafts, state.t_planned) - state.t0) * 1000
    return RunRecord(
        scenario=spec.scenario, seed=spec.seed, structure=spec.structure, lines=spec.lines,
        fault=spec.fault, phase="bring_back" if bring_back else "run", result=run.result,
        first_drafts=state.first_drafts or {}, requests=state.requests,
        ms_first=round(first, 1) if first is not None else None,
        ms_total=round((end - state.t0) * 1000, 1), pending=run.pending,
        date=dt.date.today().isoformat(),
    )  # fmt: skip


# --- scoring --------------------------------------------------------------------------------------


class Aired(BaseModel):
    """One line as it reaches the viewer, checked by the Verifier's rules."""

    text: str
    claims: list[str]
    kinds: list[str]  # Verifier violations: an error that aired, when the arm does not verify
    made_up: list[str]  # ids and numbers outside slots that no cited claim holds


class Script(BaseModel):
    moment: str
    arm: Arm
    lines: Lines
    persona: str
    language: str
    aired: list[Aired]
    dropped: int
    rewrites: int
    headline: list[str]
    headline_spoken: list[str]
    context: list[str]  # the cited claims' own sentences, for the groundedness judge
    groundedness: float | None = None
    groundedness_reason: str | None = None

    @property
    def errors(self) -> int:
        return sum(bool(a.kinds) for a in self.aired)

    @property
    def response(self) -> str:
        return "\n".join(a.text for a in self.aired)


def _air(ctx: MomentContext, line: ScriptLine, language: str) -> Aired:
    checked: Line = _check(ctx, line, language)  # type: ignore[arg-type]
    return Aired(text=checked.preview, claims=line.claims, kinds=checked.kinds,
                 made_up=checked.made_up)  # fmt: skip


def scripts_of(ctx: MomentContext, rec: RunRecord, verified: bool) -> list[Script]:
    """What each audience gets: with the Verifier, the approved lines; without it, the first
    drafts as written (after tidy), placeholders filled where they resolve."""
    arm = next(a for a, (s, v) in ARMS.items() if s == rec.structure and v == verified)
    out = []
    for s in rec.result.scripts:
        key = f"{s.persona}/{s.language}"
        if verified:
            lines, dropped, rewrites = s.lines, len(s.dropped), s.rewrites
        else:
            lines, dropped, rewrites = rec.first_drafts.get(key, s.lines), 0, 0
        aired = [_air(ctx, line, s.language) for line in lines]
        cited = list(dict.fromkeys(c for a in aired for c in a.claims))
        context = [render_claim(ctx.claims[c], ctx.verdicts[c], s.language, ctx.names).text
                   for c in cited if c in ctx.supported]  # fmt: skip
        headline = list(rec.result.findings.headline)
        out.append(Script(
            moment=rec.moment, arm=arm, lines=rec.lines, persona=s.persona, language=s.language,
            aired=aired, dropped=dropped, rewrites=rewrites, headline=headline,
            headline_spoken=[c for c in headline if c in cited], context=[t for t in context if t],
        ))  # fmt: skip
    return out


@dataclass
class Breakdown:
    """One arm on one moment: its scripts and the run's numbers."""

    moment: str
    arm: Arm
    rec: RunRecord
    scripts: list[Script]

    @property
    def verified(self) -> bool:
        return ARMS[self.arm][1]

    @property
    def requests(self) -> list[Request]:
        """The run's model requests; without the Verifier, no rewrite was asked for."""
        return [r for r in self.rec.requests if self.verified or not r.rewrite]

    @property
    def replies(self) -> list[Request]:
        return [r for r in self.requests if r.kind != "tool_call"]  # an answer, or none (error)

    @property
    def seconds(self) -> float | None:
        if not self.rec.live:
            return None
        ms = self.rec.ms_total if self.verified else self.rec.ms_first
        return ms / 1000 if ms is not None else None

    @property
    def from_model(self) -> int:
        """Agent roles whose part of the breakdown came from the model (of the four)."""
        return sum(e.source == "llm" for e in self.rec.result.trace if e.step in AGENTS)

    @property
    def plan_model(self) -> bool:
        """The Telestrator's part came from the model (a reply to validate)."""
        return any(e.step == "telestrator" and e.source == "llm" for e in self.rec.result.trace)

    @property
    def repeats(self) -> int:
        notes = (n for e in self.rec.result.trace if e.step == "narration" for n in e.notes)
        return sum("repeats an earlier line" in n for n in notes)

    @property
    def lines(self) -> int:
        return sum(len(s.aired) for s in self.scripts)

    @property
    def errors(self) -> int:
        return sum(s.errors for s in self.scripts)

    @property
    def wrong(self) -> int:
        return sum(len(a.made_up) for s in self.scripts for a in s.aired)

    @property
    def grounded(self) -> list[float]:
        return [s.groundedness for s in self.scripts if s.groundedness is not None]


def breakdowns(records: Iterable[RunRecord], ctxs: dict[str, MomentContext]) -> list[Breakdown]:
    out = []
    for rec in records:
        if rec.fault != "none" or rec.phase != "run":
            continue
        for arm, (structure, verified) in ARMS.items():
            if structure == rec.structure:
                scripts = scripts_of(ctxs[rec.moment], rec, verified)
                out.append(Breakdown(rec.moment, arm, rec, scripts))
    return out


# --- statistics: 95% intervals ------------------------------------------------------------------


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


def boot(values: Sequence[float], seed: int = 0) -> tuple[float, float, float]:
    """Mean and its percentile bootstrap interval, resampling moments."""
    x = np.asarray(values, dtype=float)
    if x.size == 0:
        return (float("nan"),) * 3
    rng = np.random.default_rng(seed)
    means = x[rng.integers(0, x.size, size=(BOOT, x.size))].mean(axis=1)
    return float(x.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def _fmt(x: float, digits: int = 2) -> str:
    return "–" if x != x else f"{x:.{digits}f}"


def ci(values: Sequence[float], digits: int = 2) -> str:
    mean, lo, hi = boot(values)
    if mean != mean:
        return "–"
    if lo == hi:
        return _fmt(mean, digits)
    return f"{_fmt(mean, digits)} [{_fmt(lo, digits)}, {_fmt(hi, digits)}]"


def rate(k: int, n: int) -> str:
    lo, hi = wilson(k, n)
    return f"{k}/{n} ({100 * k / n:.0f}%) [{100 * lo:.0f}, {100 * hi:.0f}]" if n else "–"


# --- the groundedness judge -----------------------------------------------------------------------

Judge = Callable[[str, str], tuple[float, str, dict[str, int]]]


async def judge_all(
    scripts: list[Script], judge: Judge | None, folder: Path | None, pace_s: float = 0.0,
    budget: int | None = None,
) -> int:  # fmt: skip
    """Scores every aired script; identical scripts (A and B often air the same) are judged once,
    and at most `budget` new ones. Returns the judge calls made."""
    calls = 0
    for s in scripts:
        if not s.aired:
            continue
        path = _judged(s, folder)
        if path is not None and path.exists():
            hit = json.loads(path.read_text())
        elif judge is None or (budget is not None and calls >= budget):
            continue
        else:
            try:
                score, reason, usage = await asyncio.to_thread(judge, s.response,
                                                               "\n".join(s.context))  # fmt: skip
                hit = {"score": float(score), "reason": reason, "usage": usage}
            except Exception as e:  # recorded, not fatal: the Verifier's numbers still stand
                hit = {"score": None, "reason": f"judge error: {type(e).__name__}"[:200]}
            calls += 1
            if path is not None and hit["score"] is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(hit, ensure_ascii=False))
            await asyncio.sleep(pace_s)
        s.groundedness, s.groundedness_reason = hit["score"], hit["reason"]
    return calls


def _judged(s: Script, folder: Path | None) -> Path | None:
    """Where the script's score is cached: by its response and context."""
    key = hashlib.sha256(f"{s.response}\n--\n{chr(10).join(s.context)}".encode()).hexdigest()
    return folder / f"{key}.json" if folder is not None else None


def attach_scores(scripts: Iterable[Script], folder: Path | None) -> None:
    """The cached groundedness of every script judged so far."""
    for s in scripts:
        path = _judged(s, folder)
        if s.aired and path is not None and path.exists():
            hit = json.loads(path.read_text())
            s.groundedness, s.groundedness_reason = hit["score"], hit["reason"]


def judge_usage(folder: Path | None) -> Counter:
    total: Counter = Counter()
    for path in folder.glob("*.json") if folder is not None and folder.exists() else ():
        total.update(json.loads(path.read_text()).get("usage") or {})
    return total


EVALUATOR = "`azure-ai-evaluation` `GroundednessEvaluator`"


def foundry_judge() -> Judge:
    """`GroundednessEvaluator` on the crew's Foundry deployment, keyless, as in
    eval/narration_ablation.py; also returns the token counts it reports."""
    from azure.ai.evaluation import GroundednessEvaluator

    from agents.llm import sync_credential_from_env

    parts = urlsplit(os.environ["FOUNDRY_PROJECT_ENDPOINT"].strip())
    config = {"azure_endpoint": f"{parts.scheme}://{parts.netloc}",
              "azure_deployment": os.environ["FOUNDRY_MODEL"].strip()}  # fmt: skip
    evaluator = GroundednessEvaluator(config, credential=sync_credential_from_env())

    def judge(response: str, context: str) -> tuple[float, str, dict[str, int]]:
        out = evaluator(response=response, context=context)
        props = out.get("groundedness_properties") or {}
        usage = {k: int(props[k]) for k in ("prompt_tokens", "completion_tokens")
                 if isinstance(props.get(k), int | float)}  # fmt: skip
        return float(out["groundedness"]), str(out.get("groundedness_reason", "")), usage

    return judge


# --- the failure drill ----------------------------------------------------------------------------


@dataclass
class Drill:
    """One agent taken down on one moment, in one structure, and then brought back."""

    moment: str
    structure: Structure
    fault: Fault
    rec: RunRecord
    back: RunRecord | None
    ctx: MomentContext

    def valid(self, rec: RunRecord) -> bool:
        """It aired a breakdown a viewer can play: a valid plan, and every script has lines, each
        passing the Verifier's checks (re-run here on the approved lines: a stored payload does
        not keep its slot spans, which `check_payload` needs)."""
        if validate_plan(rec.result.plan, self.ctx):
            return False
        scripts = scripts_of(self.ctx, rec, verified=True)
        return all(s.aired and not s.errors for s in scripts)

    def from_model(self, rec: RunRecord) -> int:
        return sum(e.source == "llm" for e in rec.result.trace if e.step in AGENTS)

    def unverified_errors(self) -> int:
        """Lines that would air with a violation if this structure ran without the Verifier."""
        return sum(s.errors for s in scripts_of(self.ctx, self.rec, verified=False))

    @property
    def lines(self) -> int:
        return sum(len(s.lines) for s in self.rec.result.scripts)


async def drill(
    ctx: MomentContext, spec: Spec, client: Any, timeout_s: float
) -> tuple[RunRecord, RunRecord | None]:
    """The drill and its bring-back from the drill's own checkpoints."""
    from agents.workflow import NotWaiting

    checkpoints = InMemoryCheckpointStorage()
    rec = await run_one(ctx, spec, client, timeout_s, checkpoints=checkpoints)
    try:
        back = await run_one(ctx, spec, client, timeout_s, checkpoints=checkpoints,
                             bring_back=spec.back)  # fmt: skip
    except NotWaiting:
        back = None
    return rec, back


# --- the run plan ---------------------------------------------------------------------------------


def parse_moments(text: str) -> list[tuple[str, int]]:
    out = []
    for item in filter(None, (part.strip() for part in text.split(","))):
        scenario, _, seed = item.partition(":")
        out.append((scenario, int(seed)))
    return out


@dataclass
class Plan:
    moments: list[tuple[str, int]]
    drills: list[tuple[str, int]]
    free_text: list[tuple[str, int]]

    def specs(self) -> list[Spec]:
        main = [Spec(s, seed, st) for s, seed in self.moments for st in ("single", "crew")]
        free = [Spec(s, seed, st, "free_text") for s, seed in self.free_text
                for st in ("single", "crew")]  # fmt: skip
        return main + free

    def drill_specs(self) -> list[Spec]:
        return [Spec(s, seed, st, fault=f) for s, seed in self.drills for st in ("single", "crew")
                for f in FAULTS]  # fmt: skip

    def all_moments(self) -> list[tuple[str, int]]:
        return list(dict.fromkeys(self.moments + self.drills + self.free_text))


def _load(path: Path) -> RunRecord | None:
    return RunRecord.model_validate_json(path.read_text()) if path.exists() else None


def _save(path: Path, rec: RunRecord) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rec.model_dump_json(by_alias=True, indent=1))


async def evaluate(
    plan: Plan,
    ctxs: dict[str, MomentContext],
    client: Any,
    recorder: Recorder,
    cache_dir: Path,
    max_calls: int = MAX_CALLS,
    pace_s: float = 0.0,
    timeout_s: float = TIMEOUT_S,
    log: Callable[[str], None] = lambda _: None,
) -> tuple[list[RunRecord], list[tuple[RunRecord, RunRecord | None]], list[str]]:
    """Every run of the plan, from its cached record when there is one. A run that could take the
    model calls past `max_calls` is skipped, and so is one with no record and no client."""
    runs: list[RunRecord] = []
    drills: list[tuple[RunRecord, RunRecord | None]] = []
    skipped: list[str] = []

    def affordable(estimate: int) -> bool:
        return client is not None and recorder.calls + estimate <= max_calls

    folder = cache_dir / "runs"
    for spec in plan.specs():
        rec = _load(folder / f"{spec.name}.json")
        if rec is None:
            if not affordable(ESTIMATE[(spec.structure, spec.lines)]):
                skipped.append(spec.name)
                log(f"{spec.name}: skipped ({recorder.calls} calls made of {max_calls})")
                continue
            rec = await run_one(ctxs[f"{spec.scenario}-{spec.seed}"], spec, client, timeout_s)
            _save(folder / f"{spec.name}.json", rec)
            log(f"{spec.name}: {len(rec.requests)} requests, {rec.ms_total / 1000:.1f} s "
                f"({recorder.calls} calls made)")  # fmt: skip
            await asyncio.sleep(pace_s)
        runs.append(rec)
    for spec in plan.drill_specs():
        rec, back = _load(folder / f"{spec.name}.json"), _load(folder / f"{spec.name}_back.json")
        if rec is None or back is None:
            if not affordable(ESTIMATE["drill"] + ESTIMATE["back"]):
                skipped.append(spec.name)
                log(f"{spec.name}: skipped ({recorder.calls} calls made of {max_calls})")
                continue
            rec, back = await drill(ctxs[f"{spec.scenario}-{spec.seed}"], spec, client, timeout_s)
            _save(folder / f"{spec.name}.json", rec)
            if back is not None:
                _save(folder / f"{spec.name}_back.json", back)
            log(f"{spec.name}: drill {len(rec.requests)} requests, bring-back "
                f"{len(back.requests) if back else '–'} ({recorder.calls} calls made)")  # fmt: skip
            await asyncio.sleep(pace_s)
        drills.append((rec, back))
    return runs, drills, skipped


# --- the report -----------------------------------------------------------------------------------


@dataclass
class Meta:
    model: str
    date: str
    evaluator: str
    calls: int  # agent model calls made by the runs in the report
    judge_calls: int
    skipped: list[str]
    plan: Plan
    discarded: list[RunRecord] = field(default_factory=list)  # runs set aside, with why
    overhead: int = 0  # model calls made outside the runs reported (pilot, discarded runs)


def _arms(bds: list[Breakdown], lines: Lines) -> dict[Arm, list[Breakdown]]:
    return {a: [b for b in bds if b.arm == a and b.rec.lines == lines] for a in ARMS}


def _sum(bs: list[Breakdown], f: Callable[[Breakdown], float]) -> float:
    return sum(f(b) for b in bs)


def _verdicts(bs: list[Breakdown], ctxs: dict[str, MomentContext]) -> str:
    counts: Counter = Counter()
    for b in bs:
        verdicts = ctxs[b.moment].verdicts
        for s in b.scripts:
            for a in s.aired:
                counts.update(verdicts[c].status if c in verdicts else "unknown" for c in a.claims)
    return " · ".join(str(counts.get(k, 0)) for k in ("supported", "refuted", "inconclusive",
                                                     "unknown"))  # fmt: skip


def _plan_codes(bs: list[Breakdown]) -> str:
    codes = Counter(c.split(": ", 1)[-1] for b in bs for c in b.rec.result.plan_errors)
    return ", ".join(f"{k} ×{v}" for k, v in codes.most_common()) or "none"


def run_times(b: Breakdown) -> list[float]:
    """Seconds of each agent run: a reply (or failed ask) and the tool rounds before it."""
    times, pending = [], Counter()
    for r in b.requests:
        if r.kind == "tool_call":
            pending[r.role] += r.ms
            continue
        times.append((pending.pop(r.role, 0.0) + r.ms) / 1000)
    return times


def _over(bs: list[Breakdown], limit_s: float) -> str:
    """Agent runs, tool rounds included, slower than `limit_s`."""
    times = [t for b in bs if b.rec.live for t in run_times(b)]
    return f"{sum(t > limit_s for t in times)} of {len(times)}" if times else "–"


def _table(by_arm: dict[Arm, list[Breakdown]], ctxs: dict[str, MomentContext]) -> list[str]:
    def per(f: Callable[[Breakdown], float], digits: int = 2) -> Callable[[list[Breakdown]], str]:
        return lambda bs: ci([f(b) for b in bs], digits)

    def lines_rate(f: Callable[[Aired], bool]) -> Callable[[list[Breakdown]], str]:
        return lambda bs: rate(sum(f(a) for b in bs for s in b.scripts for a in s.aired),
                               sum(b.lines for b in bs))  # fmt: skip

    def grounded(bs: list[Breakdown]) -> str:
        xs = [g for b in bs for g in b.grounded]
        return f"{ci(xs)} (min {min(xs):.0f}, {len(xs)} scripts)" if xs else "–"

    def secs(bs: list[Breakdown]) -> str:
        xs = [b.seconds for b in bs if b.seconds is not None]
        return ci(xs, 1) if xs else "–"

    rows: list[tuple[str, Callable[[list[Breakdown]], str]]] = [
        ("breakdowns (moment × 4 audiences)", lambda bs: str(len(bs))),
        ("replies that fit their schema", lambda bs: rate(
            sum(bool(r.valid) for b in bs for r in b.replies), sum(len(b.replies) for b in bs))),
        ("agent roles from the model, of 4", per(lambda b: b.from_model)),
        ("plans from the model that validate", lambda bs: rate(
            sum(b.plan_model and not b.rec.result.plan_errors for b in bs),
            sum(b.plan_model for b in bs))),
        ("plan error codes", _plan_codes),
        ("lines aired per breakdown", per(lambda b: b.lines, 1)),
        ("lines per script: casual · analyst", lambda bs: " · ".join(
            ci([len(s.aired) for b in bs for s in b.scripts if s.persona == p], 1)
            for p in PERSONAS)),
        ("aired lines the Verifier rejects (a number, id or term outside a verified slot)",
         lines_rate(lambda a: bool(a.kinds))),
        ("**wrong facts aired**: ids and numbers no cited claim holds", lambda bs: str(int(
            _sum(bs, lambda b: sum(len(a.made_up) for s in b.scripts for a in s.aired))))),
        ("claims cited by aired lines: supported · refuted · inconclusive · unknown",
         lambda bs: _verdicts(bs, ctxs)),
        ("digits the model wrote in its own words: in replies · aired", lambda bs: (
            f"{int(_sum(bs, lambda b: sum(len(r.digits) for r in b.requests)))} · "
            f"{int(_sum(bs, lambda b: sum(k == 'number' for s in b.scripts for a in s.aired for k in a.kinds)))}")),  # noqa: E501
        ("lines dropped · rewrite rounds", lambda bs: (
            f"{int(_sum(bs, lambda b: sum(s.dropped for s in b.scripts)))} · "
            f"{int(_sum(bs, lambda b: sum(s.rewrites for s in b.scripts)))}")),
        ("headline claims spoken", lambda bs: rate(
            sum(len(s.headline_spoken) for b in bs for s in b.scripts),
            sum(len(s.headline) for b in bs for s in b.scripts))),
        ("lines restating an earlier one (dropped by tidy), per breakdown",
         per(lambda b: b.repeats, 1)),
        ("groundedness (1–5), per script", grounded),
        ("seconds to air", secs),
        ("model requests per breakdown (agent runs and tool rounds)",
         per(lambda b: len(b.requests), 1)),
        ("tokens per breakdown, in · out", lambda bs: (
            f"{ci([sum(r.input_tokens for r in b.requests) for b in bs], 0)} · "
            f"{ci([sum(r.output_tokens for r in b.requests) for b in bs], 0)}")),
        ("cost per breakdown, USD", per(lambda b: sum(r.cost for r in b.requests), 4)),
        (f"agent runs (tool rounds included) slower than the deployed {DEPLOYED_STEP_S:.0f} s "
         "step timeout",
         lambda bs: _over(bs, DEPLOYED_STEP_S)),
    ]  # fmt: skip
    head = "| | " + " | ".join(LABEL[a] for a in ARMS) + " |"
    return [head, "|---|" + "---:|" * len(ARMS),
            *(f"| {label} | " + " | ".join(f(by_arm[a]) for a in ARMS) + " |"
              for label, f in rows)]  # fmt: skip


def _share(b: Breakdown) -> float | None:
    """Headline claims an aired line cites, of the findings' headline; None without one."""
    total = sum(len(s.headline) for s in b.scripts)
    return sum(len(s.headline_spoken) for s in b.scripts) / total if total else None


METRICS: list[tuple[str, Callable[[Breakdown], float | None], int]] = [
    ("aired lines the Verifier rejects", lambda b: b.errors, 2),
    ("wrong facts aired (ids and numbers no cited claim holds)", lambda b: b.wrong, 2),
    ("lines aired", lambda b: b.lines, 2),
    ("headline claims spoken (share)", lambda b: _share(b), 2),
    ("groundedness, mean of the 4 scripts", lambda b: (
        sum(b.grounded) / len(b.grounded) if b.grounded else None), 2),
    ("agent roles from the model, of 4", lambda b: b.from_model, 2),
    ("plan from the model and valid (0/1)",
     lambda b: float(b.plan_model and not b.rec.result.plan_errors), 2),
    ("replies that do not fit their schema", lambda b: sum(r.valid is False for r in b.replies), 2),
    ("seconds to air", lambda b: b.seconds, 1),
    ("model requests", lambda b: len(b.requests), 1),
    ("tokens (in + out)", lambda b: sum(r.input_tokens + r.output_tokens for r in b.requests), 0),
    ("cost, USD", lambda b: sum(r.cost for r in b.requests), 4),
]  # fmt: skip
PAIRS: list[tuple[str, Arm, Arm]] = [
    ("verification, single (A→B)", "A", "B"), ("verification, crew (C→D)", "C", "D"),
    ("collaboration, no Verifier (A→C)", "A", "C"), ("collaboration, with it (B→D)", "B", "D"),
]  # fmt: skip


def delta(by_arm: dict[Arm, list[Breakdown]], f, x: Arm, y: Arm, digits: int) -> str:
    """Mean paired difference y − x over the moments both arms ran, with its interval."""
    left = {b.moment: f(b) for b in by_arm[x]}
    diffs = [f(b) - left[b.moment] for b in by_arm[y]
             if b.moment in left and f(b) is not None and left[b.moment] is not None]  # fmt: skip
    if not diffs:
        return "–"
    mean, lo, hi = boot(diffs)
    sign = lambda v: ("+" if v > 0 else "") + _fmt(v, digits)  # noqa: E731
    return sign(mean) if lo == hi else f"{sign(mean)} [{sign(lo)}, {sign(hi)}]"


def _attribution(by_arm: dict[Arm, list[Breakdown]]) -> list[str]:
    head = "| per breakdown | " + " | ".join(label for label, _, _ in PAIRS) + " |"
    return [head, "|---|" + "---:|" * len(PAIRS),
            *(f"| {name} | " + " | ".join(delta(by_arm, f, x, y, d) for _, x, y in PAIRS) + " |"
              for name, f, d in METRICS)]  # fmt: skip


def _drill_rows(drills: list[Drill], normal: dict[tuple[str, Structure], Breakdown]) -> list[str]:
    head = ["| agent down | structure | drills | valid breakdown aired | aired lines failing the "
            "Verifier · without it | roles from the model, of 4 (normal run) | lines aired "
            "(normal run) | waiting to be brought back | bring-back: model requests · tokens | "
            "after bring-back: roles from the model |", "|---|---|" + "---:|" * 8]  # fmt: skip
    rows = []
    for fault in FAULTS:
        for structure in ("single", "crew"):
            ds = [d for d in drills if d.fault == fault and d.structure == structure]
            if not ds:
                continue
            ref = [normal[(d.moment, structure)] for d in ds if (d.moment, structure) in normal]
            backs = [d.back for d in ds if d.back is not None]
            waiting = Counter(step for d in ds for step in d.rec.pending)
            verified_fail = sum(
                sum(bool(a.kinds) for s in scripts_of(d.ctx, d.rec, True) for a in s.aired)
                for d in ds
            )  # fmt: skip
            rows.append(
                f"| {fault} | {structure} | {len(ds)} | {sum(d.valid(d.rec) for d in ds)} of "
                f"{len(ds)} | {verified_fail} · {sum(d.unverified_errors() for d in ds)} | "
                f"{ci([d.from_model(d.rec) for d in ds], 1)} "
                f"({ci([b.from_model for b in ref], 1) if ref else '–'}) | "
                f"{ci([d.lines for d in ds], 1)} ({ci([b.lines for b in ref], 1) if ref else '–'})"
                f" | {', '.join(f'{k} ×{v}' for k, v in waiting.items()) or 'none'} | "
                f"{_back_cost(backs)} | "
                f"{ci([d.from_model(b) for d, b in ((d, d.back) for d in ds) if b], 1) if backs else '–'} |"  # noqa: E501
            )
    return head + rows


def _back_cost(backs: list[RunRecord]) -> str:
    if not backs:
        return "–"
    tokens = [sum(r.input_tokens + r.output_tokens for r in b.requests) for b in backs]
    return f"{ci([len(b.requests) for b in backs], 1)} · {ci(tokens, 0)}"


def _per_moment(bds: list[Breakdown]) -> list[str]:
    head = ["| moment | arm | roles from the model | plan | lines aired | aired with a "
            "violation | headline spoken | groundedness | seconds | requests | tokens |",
            "|---|---|" + "---:|" * 9]  # fmt: skip
    rows = []
    for b in sorted(bds, key=lambda b: (b.rec.lines, b.moment, b.arm)):
        g = f"{sum(b.grounded) / len(b.grounded):.2f}" if b.grounded else "–"
        spoken = sum(len(s.headline_spoken) for s in b.scripts)
        total = sum(len(s.headline) for s in b.scripts)
        rows.append(
            f"| {b.moment}{' (free text)' if b.rec.lines == 'free_text' else ''} | {b.arm} | "
            f"{b.from_model} | {b.rec.result.plan_source} | {b.lines} | {b.errors} | "
            f"{spoken}/{total} | {g} | {_fmt(b.seconds or float('nan'), 1)} | "
            f"{len(b.requests)} | {sum(r.input_tokens + r.output_tokens for r in b.requests)} |"
        )
    return head + rows


def _inputs(plan: Plan, ctxs: dict[str, MomentContext]) -> list[str]:
    rows = ["| moment | card | selected lens | supported claims | in | why |",
            "|---|---|---|---:|---|---|"]  # fmt: skip
    for scenario, seed in plan.all_moments():
        ctx = ctxs[f"{scenario}-{seed}"]
        parts = [name for name, group in (("comparison", plan.moments), ("drill", plan.drills),
                                          ("free text", plan.free_text))
                 if (scenario, seed) in group]  # fmt: skip
        why = ("served by the deployed site; one of match-1's three hero possessions"
               if (scenario, seed) in DEPLOYED else
               "the shot hero on main, not deployed" if scenario == "far_post_finish"
               else "a held-out seed of the same hero scenario")  # fmt: skip
        rows.append(
            f"| `{scenario}` seed {seed} | `{ctx.card.id}` | {ctx.card.selected_lens} | "
            f"{len(ctx.supported)} of {len(ctx.claims)} | {', '.join(parts)} | {why} |"
        )
    return rows


def _usage(records: Iterable[RunRecord]) -> tuple[int, int, int, float]:
    """Tokens and cost of the model calls made (each cached request counted once)."""
    seen: dict[tuple, Request] = {}
    for rec in records:
        for r in rec.requests:
            if not r.cached and r.kind != "error":
                seen[(rec.moment, rec.structure, rec.lines, rec.fault, rec.phase, len(seen))] = r
    rs = list(seen.values())
    return (sum(r.input_tokens for r in rs), sum(r.cached_tokens for r in rs),
            sum(r.output_tokens for r in rs), sum(r.cost for r in rs))  # fmt: skip


def _headline(
    by_arm: dict[Arm, list[Breakdown]], free: dict[Arm, list[Breakdown]], drills: list[Drill]
) -> list[str]:
    def mean(arm: Arm, f, arms=by_arm) -> float:
        xs = [v for b in arms[arm] if (v := f(b)) is not None]
        return sum(xs) / len(xs) if xs else float("nan")

    def total(arms, arm: Arm, f) -> int:
        return sum(f(b) for b in arms[arm])

    def rejected(arms, arm: Arm) -> str:
        return f"{total(arms, arm, lambda b: b.errors)} of {total(arms, arm, lambda b: b.lines)}"

    def plans(arm: Arm) -> str:
        made = [b for b in by_arm[arm] if b.plan_model]
        return f"{sum(not b.rec.result.plan_errors for b in made)} of {len(made)}"

    def slow(arm: Arm) -> str:
        return _over(by_arm[arm], DEPLOYED_STEP_S)

    def grounded(b: Breakdown) -> float | None:
        return _avg(b.grounded)

    def wrongs(arms, arm: Arm) -> int:
        return total(arms, arm, lambda b: b.wrong)

    changed = sum(b.errors != 0 or any(s.dropped or s.rewrites for s in b.scripts)
                  for a in ("B", "D") for b in by_arm[a])  # fmt: skip
    wrong = {a: total(by_arm, a, lambda b: b.wrong) for a in ARMS}
    fell = {a: sum(b.from_model < 4 for b in by_arm[a]) for a in ("B", "D")}
    out = [
        f"- **Verification, as shipped (A→B, C→D): nothing measurable.** Wrong facts aired: "
        f"{wrong['A']} · {wrong['B']} · {wrong['C']} · {wrong['D']} (A · B · C · D); lines the "
        f"Verifier rejects: {rejected(by_arm, 'A')} without it in the single agent, "
        f"{rejected(by_arm, 'C')} in the crew. "
        + ("Anchored lines are verified sentences, so the Verifier rejected no line and changed "
           "nothing that aired in either structure." if changed == 0 else
           "See the attribution table for what it removed."),
        f"- **Collaboration, as shipped (A→C, B→D): resilience, not measurably better lines.** "
        f"Single vs crew: wrong facts aired {wrong['B']} vs {wrong['D']}, groundedness "
        f"{mean('B', grounded):.2f} vs {mean('D', grounded):.2f}, plans from the model that "
        f"validate {plans('B')} vs {plans('D')}, "
        f"headline claims spoken {100 * mean('B', _share):.0f}% vs {100 * mean('D', _share):.0f}% "
        f"(per breakdown; the crew's scripts are longer, since each voice reads "
        f"the persona's length for itself: {mean('B', lambda b: b.lines):.0f} vs "
        f"{mean('D', lambda b: b.lines):.0f} lines per breakdown). Seconds to air "
        f"{mean('B', lambda b: b.seconds):.1f} vs {mean('D', lambda b: b.seconds):.1f}, no "
        f"measurable difference. The crew costs more: "
        f"{mean('B', lambda b: len(b.requests)):.1f} vs {mean('D', lambda b: len(b.requests)):.1f} "
        f"model requests and ${mean('B', lambda b: sum(r.cost for r in b.requests)):.4f} vs "
        f"${mean('D', lambda b: sum(r.cost for r in b.requests)):.4f} per breakdown. Its steps "
        f"are short: under the deployed {DEPLOYED_STEP_S:.0f} s step timeout, {slow('D')} crew "
        f"agent runs would have timed out, and {slow('B')} of the single agent's. Without any "
        f"fault, {fell['B']} single and {fell['D']} crew breakdowns had a role on its template.",
    ]  # fmt: skip
    for fault in FAULTS:
        parts = []
        for structure in ("single", "crew"):
            ds = [d for d in drills if d.fault == fault and d.structure == structure]
            if ds:
                kept = sum(d.from_model(d.rec) for d in ds) / len(ds)
                backs = [d.back for d in ds if d.back is not None]
                cost = sum(len(b.requests) for b in backs) / len(backs) if backs else float("nan")
                parts.append(
                    f"{structure}: {sum(d.valid(d.rec) for d in ds)} of {len(ds)} aired a valid, "
                    f"verified breakdown with {kept:.0f} of 4 roles from the model; bringing it "
                    f"back took {cost:.1f} model requests"
                )
        if parts:
            out.append(f"- **{fault.capitalize()} down.** " + "; ".join(parts) + ".")
    if any(free.values()):
        out.append(
            f"- **Free-text lines (sensitivity, {len(free['D'])} moment).** Without the Verifier "
            f"the voices' own sentences air: wrong facts {wrongs(free, 'A')} "
            f"(single) and {wrongs(free, 'C')} (crew); lines the Verifier "
            f"rejects {rejected(free, 'A')} and {rejected(free, 'C')}. With it, "
            f"{wrongs(free, 'B')} and {wrongs(free, 'D')} wrong "
            f"facts and {total(free, 'B', lambda b: b.errors)} and "
            f"{total(free, 'D', lambda b: b.errors)} rejected lines air: that is due to "
            "verification. The crew's separate voices did not write fewer wrong facts than the "
            "single agent, so none of it is due to collaboration."
            if wrongs(free, "C") >= wrongs(free, "A") else
            f"- **Free-text lines (sensitivity).** See the table: wrong facts "
            f"{wrongs(free, 'A')} (A), {wrongs(free, 'B')} (B), {wrongs(free, 'C')} (C), "
            f"{wrongs(free, 'D')} (D)."
        )  # fmt: skip
    return out


def _avg(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def report(
    records: list[RunRecord],
    drill_records: list[tuple[RunRecord, RunRecord | None]],
    ctxs: dict[str, MomentContext],
    meta: Meta,
    judged: Path | None = None,
) -> str:
    bds = breakdowns(records, ctxs)
    attach_scores((s for b in bds for s in b.scripts), judged)
    anchored, free = _arms(bds, "anchored"), _arms(bds, "free_text")
    normal = {(b.moment, b.rec.structure): b for b in bds
              if b.verified and b.rec.lines == "anchored"}  # fmt: skip
    drills = [Drill(r.moment, r.structure, r.fault, r, back, ctxs[r.moment])
              for r, back in drill_records]  # fmt: skip
    tin, tcached, tout, cost = _usage([*records, *(r for d in drill_records for r in d if r)])
    jusage = judge_usage(judged)
    judge_cost = (jusage["prompt_tokens"] * PRICE["input"]
                  + jusage["completion_tokens"] * PRICE["output"]) / 1e6  # fmt: skip
    n_moments = len({b.moment for b in anchored["D"]})
    lines = [
        "# Crew vs single agent — is it the crew or the Verifier? (SPEC 6)",
        "",
        f"Model: `{meta.model}` on Microsoft Foundry, for every agent and as the groundedness "
        f"judge. Evaluator: {meta.evaluator}. Date: {meta.date}.",
        f"Moments: {n_moments} in the four-arm comparison, {len(meta.plan.drills)} in the "
        f"failure drill, {len(meta.plan.free_text)} with free-text lines (listed below). "
        f"Audiences: {', '.join(PERSONAS)} × {', '.join(LANGUAGES)}, the API's default: four "
        "scripts per breakdown.",
        f"Model calls: {meta.calls + meta.judge_calls} ({meta.calls} by the agents, "
        f"{meta.judge_calls} by the groundedness judge)"
        + (
            f", and {meta.overhead} more spent on a pilot and on runs set aside (below)"
            if meta.overhead
            else ""
        )
        + f". Agent tokens: {tin:,} in ({tcached:,} "
        f"from the prompt cache), {tout:,} out: ${cost:.2f} at the list price "
        f"(${PRICE['input']:.2f} / ${PRICE['cached']:.2f} cached / ${PRICE['output']:.2f} per "
        "million tokens in, cached and out)"
        + (
            f"; the judge's {jusage['prompt_tokens']:,} in and {jusage['completion_tokens']:,} "
            f"out: ${judge_cost:.2f} more."
            if jusage
            else "."
        ),
    ]
    if meta.skipped:
        lines.append(f"Skipped to stay within the call budget: {', '.join(meta.skipped)}.")
    lines += ["", "## Headline", "", *_headline(anchored, free, drills), "",
              "## Inputs", "", *_inputs(meta.plan, ctxs), "",
              "## The four arms, on the shipped schema (anchored lines)", "",
              "Means per breakdown with 95% bootstrap intervals over moments; rates pooled over "
              "lines or replies with Wilson 95% intervals.", "", *_table(anchored, ctxs), "",
              "## What is due to verification, and what to collaboration", "",
              "Paired differences per breakdown (the later arm minus the earlier), mean over "
              "moments with a 95% bootstrap interval. A and B are one run, and so are C and D.",
              "", *_attribution(anchored), "",
              "## Failure drill: one agent down, then brought back", "",
              *_drill_rows(drills, normal), ""]  # fmt: skip
    if any(free.values()):
        lines += ["## Sensitivity: free-text lines", "",
                  "The same four arms when the voices write their own sentences with slot "
                  "placeholders (eval/free_text.py, the narration before anchoring); the crew's "
                  "Director, Analyst and Telestrator replies are the anchored run's (the same "
                  "requests).", "", *_table(free, ctxs), "", *_attribution(free), ""]  # fmt: skip
    lines += ["## Per moment", "", *_per_moment(bds), ""]
    if meta.discarded:
        lines += ["## Runs set aside", "", DISCARDED, "", *_discarded(meta.discarded), ""]
    lines.append(METHOD)
    return "\n".join(lines).rstrip() + "\n"


DISCARDED = """\
The first run of `far_post_finish` seed 0 hit a bug in this eval, fixed before the runs reported
above: the request cache answered a retry, which asks exactly what the failed first ask did,
with the first ask's cached tool round instead of a new call. The cache now keys the n-th
identical request of a run apart. Both runs of that moment were set aside (their records are in
`out/crew_vs_single/discarded/`) and run again from scratch. What they showed is kept here,
because it is the failure isolation the crew is for: in both structures the Analyst's `angle`
carried a number in both of its attempts, which the schema's `no_numbers` check rejects.

The first drills hit a second bug: Agent Framework gives every tool result a random id, so a
drill's tool round did not match the normal run's and was asked again, and the drill went on
from a new sample instead of the normal run's. Tool rounds are now keyed by the conversation
they continue; those drills (`out/crew_vs_single/discarded/drills/`) were run again. Their
model calls are counted in the total above.

`far_post_finish` seed 0 was run a third time after main gave the shot hero its own claims (the
look at the goal, the keeper it showed him, the placement) and with them the scan lens; the runs
on its earlier space-lens context are in `out/crew_vs_single/discarded/superseded/`. The other
five moments' contexts and prompts are byte-identical on that main, so their runs stand.

The set-aside runs of that moment, in order (first run, then the space-lens run):"""


def _discarded(records: list[RunRecord]) -> list[str]:
    out = []
    for rec in records:
        roles = {e.step: e.source for e in rec.result.trace if e.step in AGENTS}
        rejected = Counter((r.error or "invalid").split(": ", 2)[-1] for r in rec.requests
                           if r.valid is False or "ValidationError" in (r.error or ""))  # fmt: skip
        out.append(
            f"- `{rec.moment}` {rec.structure}: roles from the model "
            f"{', '.join(k for k, v in roles.items() if v == 'llm') or 'none'}; on templates "
            f"{', '.join(k for k, v in roles.items() if v != 'llm') or 'none'}; replies rejected: "
            + (", ".join(f"{k} ×{v}" for k, v in rejected.items()) or "none")
            + f"; {sum(not r.cached for r in rec.requests)} model calls."
        )
    return out


METHOD = f"""## Method

- **Same inputs for every arm.** Each moment's `MomentContext` (its run, counterfactual, cards and
  verified claims), the same audiences, the same Foundry deployment, the same MCP tool server
  (`agents/mcp_server.py`, the Analyst's tools in the crew, the single agent's tools here), the
  same structured-output schemas, and the same code after the model.
- **The single agent** (eval/single_agent.py) is one call whose reply holds the crew's four step
  schemas side by side: `DirectorChoice`, the Analyst's enum-constrained choice, `PlanDraft`, and
  per audience and voice the narration draft. Its instructions are the crew's role instructions
  joined, and its prompt holds what the four prompts hold, except what one agent hands the next
  (findings, the play-by-play lines), which it writes itself. It runs inside the crew's workflow
  graph: the first executor makes the call, and the Analyst, Telestrator and narration executors
  take their part of its reply and apply the crew's own checks (claim filtering, plan validation
  and the template plan, compose, tidy). A rewrite round is one more call of the same agent for
  every rejected line, at most two rounds, as the crew's Narrator ⇄ Verifier loop.
- **Without the Verifier** (A, C) the first drafts air as written after tidy, each placeholder
  filled where it resolves and left as written where it does not. They are the drafts the
  Verifier checked in round 0 of B and D, so A and B, and C and D, compare the same samples; A
  and C are timed until the drafts and the plan were both ready.
- **Errors reaching the viewer** are aired lines the Verifier's rules reject (number, entity,
  placeholder, banned, lexicon, unsupported or stale claim, unbacked line), checked as in
  eval/narration_ablation.py; **made up** counts ids and numbers outside slots that no cited
  claim holds. **Digits written** are number tokens (digits, number words, Chinese numerals) in
  the model's own words: `reason`, `angle` and free-text lines, in every reply, valid or not;
  player ids are not numbers.
- **Schema validity** is per reply: the agent's final answer, parsed against the schema it was
  asked for (a tool-call round is not a reply). A timeout or error counts as a reply that does
  not fit.
- **Plan validity** is `agents.plan.validate_plan` on the plan the model wrote; an invalid plan
  is replaced by the template plan in every arm, and its reason codes are listed.
- **Groundedness** is `azure-ai-evaluation`'s `GroundednessEvaluator` (1–5) per aired script: the
  response is its lines, the context the rendered sentences of the claims they cite. Identical
  scripts are judged once.
- **Timeouts.** Every agent run gets {TIMEOUT_S:.0f} s and one retry, in every arm, so a slow
  reply is scored rather than replaced by its template; the deployed crew uses
  {DEPLOYED_STEP_S:.0f} s per step, and the table counts the agent runs slower than that.
- **The drill** is the Producer desk's (`run_crew(down=...)`): the agent's model calls fail, the
  step retries once and runs on its template, and a workflow request waits for it to be brought
  back from the checkpoint. The single agent has one call, so taking down any of its roles takes
  the call down; bringing it back runs the call again. Requests that a drill makes exactly as the
  normal run made them are answered from the request cache (the same reply), so a drill costs
  only the requests it changes, and its times are not reported.
- **Intervals.** Per-breakdown means and paired differences resample moments (10,000 bootstrap
  draws, seed 0); pooled rates use Wilson intervals, which ignore that lines cluster within
  scripts and moments, so they are too narrow when lines of one script fail together.
- **Cost** is the agents' token usage as Foundry reports it, at the gpt-4.1-mini Global Standard
  list price, each request once; the judge's tokens are counted when the evaluator reports them.

## What this shows, and what it does not

- **What keeps wrong facts off the air is the anchored schema**, a choice either structure can
  make: the model picks verified claims and never writes the sentence. With it the Verifier
  had nothing to reject, in the crew or the single agent. It stays as the backstop for a model
  or prompt that writes its own words: with free-text lines it removed every rejected line and
  every wrong fact before air, in both structures, and that is verification's share.
- **What the crew adds is failure isolation**, not better lines. A failed role (an outage in the
  drill, or a reply the schema rejects, as the Analyst's `angle` with a number in it) costs the
  crew that role's part, while the other agents' work still airs and the role waits to be
  brought back; the single agent has one reply, so any failed part costs every part. Bringing a
  Telestrator back is one small request; bringing the Analyst back re-runs everything that read
  its findings, more than re-running the single agent. Short steps also fit the deployed
  {DEPLOYED_STEP_S:.0f} s step timeout; the single agent's one long call does not, so it needs a
  longer one and a stuck call is noticed later.
- It does not show that the crew writes better. Wrong facts and groundedness are the same; the
  crew's plans validated a little more often and it spoke more of its headline claims, but on
  six moments neither difference is clear of zero, and its scripts are also longer. With free
  text its separate voices wrote more wrong facts, not fewer. It is not faster, and it makes
  about six times the model requests, 1.7 times the tokens and twice the cost.

## Limitations

- A handful of moments, one sample per arm and moment, one model. The intervals are wide; a
  difference whose interval spans zero is not shown to exist.
- The free-text sensitivity is one moment (four scripts per arm): an illustration, not a rate.
  Its crew run replays the anchored run's Director, Analyst and Telestrator replies, so its
  latency is not reported.
- A reply that Foundry's client rejects while parsing (a field that fails its check) raises
  before its usage is returned: its tokens are not counted, so the cost is a slight
  underestimate, and its numbers are read from the validation error.
- The single agent is our design: the crew's schemas and instructions joined. A different
  single-agent prompt could do better or worse; it gets every input the crew gets, the same
  tools and the same deterministic code, so what differs is the decomposition into agents.
- The moments are the hero moments: the crew breaks down only a scenario hero's moment (its
  claims are built for it), so match-1's other lensed moments have no breakdown to compare. The
  sample is the three hero moments the site serves (match-1's hero possessions), the shot hero
  on main and held-out seeds of two of them. The hero scenarios that reached main after the
  sample was fixed (`cutback_scan`, `keeper_switch`, `screened_shot`) are not in it.
- Anchored lines are the crew's design, and both structures use them here. They leave the
  Verifier little to catch; the free-text sensitivity and eval/narration_ablation.py show what it
  catches when the voices write their own words.
- Latency depends on the deployment's load and the rate limit at the time of the run.
"""


# --- command line ---------------------------------------------------------------------------------


def recording_client(recorder: Recorder) -> tuple[Any | None, Callable[[], Any]]:
    """`agents.llm.client_from_env` with the recorder on every model request."""

    async def nothing() -> None:
        return None

    endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT", "").strip()
    model = os.environ.get("FOUNDRY_MODEL", "").strip()
    if not endpoint or not model:
        return None, nothing
    from agent_framework.foundry import FoundryChatClient

    from agents.llm import credential_from_env

    credential = credential_from_env()
    client = FoundryChatClient(project_endpoint=endpoint, model=model, credential=credential,
                               middleware=[recorder])  # fmt: skip
    return client, credential.close


async def main_async(args: argparse.Namespace) -> Path:
    plan = Plan(parse_moments(args.moments), parse_moments(args.drills),
                parse_moments(args.free_text))  # fmt: skip
    cache = Path(args.cache)
    recorder = Recorder(cache / "requests", offline=args.cached_only)
    client, close = (None, None) if args.cached_only else recording_client(recorder)
    if client is None and not args.cached_only:
        raise SystemExit("needs FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL (see .env.example)")
    ctxs = {f"{s}-{seed}": MomentContext.load(s, seed) for s, seed in plan.all_moments()}
    judging = not (args.cached_only or args.no_judge)
    try:
        runs, drill_records, skipped = await evaluate(
            plan, ctxs, client, recorder, cache, args.max_calls, args.pace, args.timeout, print
        )
        scripts = [s for b in breakdowns(runs, ctxs) for s in b.scripts]
        judge = foundry_judge() if judging else None
        judge_calls = await judge_all(scripts, judge, cache / "judge", args.pace / 4,
                                      max(0, args.max_calls - recorder.calls))  # fmt: skip
    finally:
        if close is not None:
            await close()
    records = [*runs, *(r for pair in drill_records for r in pair if r is not None)]
    listed = [*sorted((cache / "discarded").glob("*.json")),
              *sorted((cache / "discarded" / "superseded").glob("*.json"))]  # fmt: skip
    discarded = [RunRecord.model_validate_json(f.read_text()) for f in listed]
    set_aside = [RunRecord.model_validate_json(f.read_text())
                 for f in sorted((cache / "discarded").rglob("*.json"))
                 if f.parent.name != "requests"]  # fmt: skip
    judged = cache / "judge"
    meta = Meta(
        model=os.environ.get("FOUNDRY_MODEL", "").strip() or "gpt-4.1-mini",
        date=max((r.date for r in runs), default=dt.date.today().isoformat()),
        evaluator=EVALUATOR, calls=sum(not q.cached for r in records for q in r.requests),
        judge_calls=sum(1 for _ in judged.glob("*.json")) if judged.exists() else 0,
        skipped=skipped, plan=plan, discarded=discarded, overhead=args.overhead
        + sum(not q.cached for r in set_aside for q in r.requests),
    )  # fmt: skip
    REPORTS.mkdir(exist_ok=True)
    path = Path(args.out)
    path.write_text(report(runs, drill_records, ctxs, meta, judged))
    print(f"wrote {path} ({recorder.calls} agent calls and {judge_calls} judge calls this run)")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Crew vs single agent (SPEC 6).")
    parser.add_argument("--moments", default=MOMENTS, help="scenario:seed,...")
    parser.add_argument("--drills", default=DRILLS, help="moments for the failure drill")
    parser.add_argument("--free-text", default=FREE_TEXT, help="moments with free-text lines")
    parser.add_argument("--max-calls", type=int, default=MAX_CALLS, help="new model calls")
    parser.add_argument("--pace", type=float, default=2.0, help="seconds between runs")
    parser.add_argument("--timeout", type=float, default=TIMEOUT_S, help="seconds per agent run")
    parser.add_argument("--cache", default=str(CACHE))
    parser.add_argument("--out", default=str(REPORTS / "crew_vs_single.md"))
    parser.add_argument("--no-judge", action="store_true", help="skip new groundedness calls")
    parser.add_argument(
        "--overhead",
        type=int,
        default=0,
        help="model calls made outside the runs (a pilot), for the report",
    )
    parser.add_argument(
        "--cached-only",
        action="store_true",
        help="re-score from out/crew_vs_single without any model call",
    )
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
