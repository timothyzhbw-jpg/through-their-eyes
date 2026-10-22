"""The crew trace (SPEC 6): one run of the crew as a timeline, for the web's "Crew trace" view.

The workflow (agents/workflow.py) records it as it runs, and the API stores it with the cached
breakdown, so showing it costs no model call. Per step:
- when it started and ended: telemetry, ms of wall time since the run started, never a claim;
- the typed message it handled and the ones it sent, each summarised, with its JSON;
- the shared state it read and wrote. Reads are the evidence every agent works from (the
  `MomentContext`, built and verified by code before any model runs), noted as the step reads
  them. Writes are its output on the workflow's state (Agent Framework `State`), which every
  checkpoint saves;
- its model calls, or that it ran on its template or is code; the MCP tools the Analyst called,
  with their arguments and results; the lines the Verifier sent back and how they were rewritten;
- its step span's id: the run's trace id is operation_Id in Application Insights.
Run events show the failure drill: an agent taken down, its fallback, its request to be brought
back, every checkpoint with the state it saved, and the bring-back resuming from one.

The trace is public, like the breakdown it comes with: ids, counts, verified templates, reason
codes and error classes. Model text appears only where the breakdown already shows it (the
Director's reason and the Analyst's angle, both checked for numbers) and in tool-call arguments,
labelled as the model's. Never a prompt, a key or a connection string.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, JsonValue

TRACE_VERSION = 1
STATE_KEY = "crew_trace"  # the trace so far, on the workflow's state: a resumed run continues it
MAX_JSON = 24_000  # characters of one message's JSON; past it only the summary is kept
MAX_RESULT = 4_000  # characters of one tool result

Source = Literal["llm", "template", "code"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Payload(Strict):
    """A typed message on an edge of the graph: its type, one line about it, and its JSON."""

    type: str
    summary: str
    data: JsonValue = None
    truncated: bool = False  # the JSON was too long to keep


class ModelCall(Strict):
    """One call of an agent step: narration makes one per persona × language × voice."""

    role: str  # director, analyst, telestrator, pbp (play-by-play), color (co-commentator)
    persona: str | None = None
    language: str | None = None
    source: Literal["llm", "template"]
    attempts: int
    ms: float  # telemetry
    error: str | None = None


class ToolCall(Strict):
    """A tool the Analyst called on our MCP server: the arguments are the model's, the result is
    the server's answer as the model got it."""

    name: str
    arguments: dict[str, JsonValue]
    result: str | None = None
    error: str | None = None
    truncated: bool = False


class Rejected(Strict):
    """A line the Verifier sent back: the draft (claim templates, placeholders unfilled) and why."""

    persona: str
    language: str
    line: str
    speaker: str
    text: str
    problems: list[str]


class Rewritten(Strict):
    """A line the voice that wrote it rewrote after the Verifier sent it back."""

    persona: str
    language: str
    line: str
    speaker: str
    before: str
    after: str | None  # None: the rewrite gave no line, so the Verifier drops it
    claims_before: list[str]
    claims_after: list[str]


class TraceStep(Strict):
    id: str  # "r<run>.<n>": unique in the trace
    run: int  # 0: the first run; then each bring-back or resumed run
    step: str  # mcp, director, analyst, telestrator, narration, verifier, voice
    round: int | None = None  # narration and the Verifier: 0 for the draft, then each rewrite
    start_ms: float  # telemetry: ms since the run started
    end_ms: float
    source: Source
    attempts: int = 0
    error: str | None = None  # describe()d: a class and a message with no model text
    resumed: bool = False  # re-run from the checkpoint after its agent was brought back
    input: Payload | None = None
    output: list[Payload] = []
    reads: list[str] = []  # shared state read: "evidence.<field>"
    writes: list[str] = []  # shared state written: keys on the workflow's state
    calls: list[ModelCall] = []
    tools: list[ToolCall] = []
    rejected: list[Rejected] = []
    rewritten: list[Rewritten] = []
    notes: list[str] = []
    span_id: str | None = None  # the step span in Application Insights; None: tracing off


class TraceEvent(Strict):
    run: int
    t_ms: float  # telemetry: ms since its run started
    kind: Literal["down", "fallback", "waiting", "checkpoint", "back", "resumed"]
    step: str | None = None
    detail: str
    checkpoint: str | None = None  # a checkpoint id
    superstep: int | None = None
    keys: list[str] = []  # a checkpoint: the shared state it saved


class TraceRun(Strict):
    index: int
    kind: Literal["run", "bring_back", "resume"]
    step: str | None = None  # the step brought back
    started: str  # ISO 8601, UTC
    total_ms: float | None = None  # telemetry, from the MCP server's start; None: unfinished
    model: str  # the model deployment, or "offline"
    down: list[str] = []  # agents down during this run
    pending: list[str] = []  # agents waiting to be brought back after it
    trace_id: str | None = None  # operation_Id in Application Insights


class CrewTrace(Strict):
    version: Literal[1] = TRACE_VERSION
    story: str  # "breakdown" or "recap"
    subject: str  # the moment, or the match
    runs: list[TraceRun] = []
    steps: list[TraceStep] = []
    events: list[TraceEvent] = []


# --- recording ------------------------------------------------------------------------------------


@dataclass
class StepRecord:
    """A step while it runs; `Recorder.step` turns it into a `TraceStep`."""

    step: str
    start_ms: float
    round: int | None = None
    resumed: bool = False
    input: Payload | None = None
    output: list[Payload] = field(default_factory=list)
    reads: set[str] = field(default_factory=set)
    writes: list[str] = field(default_factory=list)
    calls: list[ModelCall] = field(default_factory=list)
    tools: list[ToolCall] = field(default_factory=list)
    rejected: list[Rejected] = field(default_factory=list)
    rewritten: list[Rewritten] = field(default_factory=list)
    source: Source = "code"
    attempts: int = 0
    error: str | None = None
    notes: list[str] = field(default_factory=list)
    span_id: str | None = None


_current: ContextVar[StepRecord | None] = ContextVar("tte_crew_step", default=None)


def current() -> StepRecord | None:
    """The step being recorded in this task, if any; concurrent steps run in their own tasks."""
    return _current.get()


def call(entry: ModelCall) -> None:
    """Note a model call (or its template) on the step being recorded."""
    if (rec := current()) is not None:
        rec.calls.append(entry)


class Watched:
    """The evidence as one step sees it: every field it reads is noted on its trace entry. Only
    attribute reads go through; what they return is the evidence's own value."""

    __slots__ = ("_of", "_seen")

    def __init__(self, of: Any, seen: set[str]) -> None:
        object.__setattr__(self, "_of", of)
        object.__setattr__(self, "_seen", seen)

    def __getattr__(self, name: str) -> Any:
        if not name.startswith("_"):
            self._seen.add(name)
        return getattr(self._of, name)

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(self._of, name, value)


def watched(value: Any) -> Any:
    """`value` as the step being recorded reads it, or `value` itself outside a step."""
    rec = current()
    if rec is None or value is None or isinstance(value, Watched):
        return value
    return Watched(value, rec.reads)


class Recorder:
    """The trace of one crew run, continuing `previous` (the trace of the runs before it)."""

    def __init__(
        self,
        story: str,
        subject: str,
        model: str,
        down: list[str],
        kind: Literal["run", "bring_back", "resume"] = "run",
        step: str | None = None,
        previous: CrewTrace | None = None,
    ) -> None:
        self.trace = (
            previous.model_copy(deep=True) if previous else CrewTrace(story=story, subject=subject)
        )
        self.run = len(self.trace.runs)
        self.t0 = time.perf_counter()
        self.started = datetime.now(UTC)
        self.trace.runs.append(
            TraceRun(
                index=self.run,
                kind=kind,
                step=step,
                model=model,
                down=sorted(down),
                started=self.started.isoformat(),
            )
        )
        for agent in sorted(down):
            self.event(
                "down",
                agent,
                "taken down for this run: its model calls fail as in an "
                "outage, so no model is called for it",
            )

    def now(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 1)

    def event(self, kind: str, step: str | None, detail: str, **fields: Any) -> None:
        t = fields.pop("t_ms", None)
        self.trace.events.append(
            TraceEvent(
                run=self.run,
                t_ms=self.now() if t is None else t,
                kind=kind,
                step=step,
                detail=detail,
                **fields,
            )
        )

    @contextmanager
    def step(
        self,
        name: str,
        message: Any = None,
        round: int | None = None,
        resumed: bool = False,
        reads: set[str] | None = None,
    ) -> Iterator[StepRecord]:
        """Record one step while the block runs: it is the task's current step, so the evidence
        it reads and the calls it makes are noted on it. `reads`: the set that collects them."""
        rec = StepRecord(
            step=name,
            start_ms=self.now(),
            round=round,
            resumed=resumed,
            input=payload(message) if message is not None else None,
        )
        if reads is not None:
            rec.reads = reads
        token = _current.set(rec)
        try:
            yield rec
        finally:
            _current.reset(token)
            self._close(rec)

    def _close(self, rec: StepRecord) -> None:
        n = sum(1 for s in self.trace.steps if s.run == self.run)
        self.trace.steps.append(
            TraceStep(
                id=f"r{self.run}.{n}",
                run=self.run,
                step=rec.step,
                round=rec.round,
                start_ms=rec.start_ms,
                end_ms=self.now(),
                source=rec.source,
                attempts=rec.attempts,
                error=rec.error,
                resumed=rec.resumed,
                input=rec.input,
                output=rec.output,
                reads=sorted(f"evidence.{r}" for r in rec.reads),
                writes=rec.writes,
                calls=rec.calls,
                tools=rec.tools,
                rejected=rec.rejected,
                rewritten=rec.rewritten,
                notes=rec.notes,
                span_id=rec.span_id,
            )
        )

    def finish(self, pending: list[str], trace_id: str | None) -> CrewTrace:
        """The trace once this run is done: its wall time (the MCP server's start included), the
        steps still waiting, its trace id."""
        run = self.trace.runs[self.run]
        run.total_ms, run.pending, run.trace_id = self.now(), sorted(pending), trace_id
        self.trace.steps.sort(key=lambda s: (s.run, s.start_ms, s.end_ms))
        self.trace.events.sort(key=lambda e: (e.run, e.t_ms))
        return self.trace

    def checkpoints(self, saved: list[Any]) -> None:
        """Events for the checkpoints this run saved (Agent Framework `WorkflowCheckpoint`)."""
        for cp in sorted(saved, key=lambda c: c.timestamp):
            try:
                at = datetime.fromisoformat(cp.timestamp)
            except (TypeError, ValueError):
                continue
            if at < self.started:
                continue  # an earlier run's
            state = cp.state or {}
            keys = sorted(k for k in state if not k.startswith("_") and k != STATE_KEY)
            executors = sorted((state.get("_executor_state") or {}).keys())
            waiting = sorted(getattr(cp, "pending_request_info_events", None) or {})
            detail = f"saved after superstep {cp.iteration_count}"
            if waiting:
                detail += f"; waiting: {', '.join(waiting)}"
            self.event(
                "checkpoint",
                None,
                detail,
                checkpoint=cp.checkpoint_id,
                superstep=cp.iteration_count,
                keys=keys + [f"executor.{e}" for e in executors],
                t_ms=round((at - self.started).total_seconds() * 1000, 1),
            )


def span_id(span: Any) -> str | None:
    context = span.get_span_context() if span is not None else None
    return format(context.span_id, "016x") if context is not None and context.is_valid else None


# --- what a message says --------------------------------------------------------------------------


def _dump(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    return value


def _bounded(type_: str, summary: str, data: Any) -> Payload:
    text = json.dumps(data, ensure_ascii=False, default=str)
    if len(text) > MAX_JSON:
        return Payload(type=type_, summary=summary, data=None, truncated=True)
    return Payload(type=type_, summary=summary, data=json.loads(text))


def _lines(lines: list[Any]) -> list[dict[str, Any]]:
    return [
        {"id": x.id, "speaker": x.speaker, "text": x.text, "claims": list(x.claims)} for x in lines
    ]


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def payload(msg: Any) -> Payload:
    """A message of the crew's graph as the trace shows it. The crew's own message classes are
    matched by name, so this module needs nothing from agents/workflow.py."""
    name = type(msg).__name__
    if name == "Job":
        summary = f"{', '.join(msg.personas)} × {', '.join(msg.languages)}"
        return _bounded(
            name, summary, {"personas": list(msg.personas), "languages": list(msg.languages)}
        )
    if name == "Analyze":
        r = msg.request
        summary = f"priority {r.priority}"
        if moments := getattr(r, "moments", None):
            summary += f" · {_plural(len(moments), 'key moment')}"
        type_ = type(r).__name__
        return _bounded(
            type_, f"{summary} · {', '.join(r.personas)} × {', '.join(r.languages)}", _dump(r)
        )
    if name == "Briefing":
        f = msg.findings
        lens = getattr(f, "lens", None)
        summary = (f"lens {lens} · " if lens else "") + f"headline {', '.join(f.headline)}"
        return _bounded(
            type(f).__name__, f"{summary} · rev {msg.rev}", {"findings": _dump(f), "rev": msg.rev}
        )
    if name == "Planned":
        plan = msg.plan
        clips = getattr(plan, "clips", None)
        what = (
            _plural(len(clips), "clip") if clips is not None else _plural(len(plan.steps), "step")
        )
        source = "the Telestrator agent" if msg.plan_source == "agent" else "its template"
        data = plan.to_web() if hasattr(plan, "to_web") else _dump(plan)
        return _bounded(
            type(plan).__name__,
            f"{what} · from {source}",
            {
                "plan": data,
                "source": msg.plan_source,
                "errors": list(msg.plan_errors),
                "rev": msg.rev,
            },
        )
    if name == "Drafts":
        n = sum(len(v) for v in msg.scripts.values())
        summary = (
            f"round {msg.round} · {_plural(len(msg.scripts), 'script')} · {_plural(n, 'line')}"
        )
        scripts = {f"{p}/{lg}": _lines(v) for (p, lg), v in msg.scripts.items()}
        return _bounded("Drafts", summary, {"round": msg.round, "scripts": scripts})
    if name == "Rewrite":
        n = sum(len(v) for v in msg.failed.values())
        failed = {
            f"{p}/{lg}": [{**_lines([line])[0], "problems": problems} for line, problems in v]
            for (p, lg), v in msg.failed.items()
        }
        return _bounded(
            "Rewrite",
            f"{_plural(n, 'line')} sent back for a rewrite",
            {"round": msg.drafts.round, "failed": failed},
        )
    if name == "Approved":
        aired = sum(len(s.lines) for s in msg.scripts)
        dropped = sum(len(s.dropped) for s in msg.scripts)
        scripts = [
            {
                "persona": s.persona,
                "language": s.language,
                "lines": [x.id for x in s.lines],
                "rewrites": s.rewrites,
                "dropped": [{"id": d.id, "reason": d.reason} for d in s.dropped],
            }
            for s in msg.scripts
        ]
        summary = f"{_plural(len(msg.scripts), 'script')} · {aired} aired · {dropped} dropped"
        return _bounded("Approved", summary, {"scripts": scripts, "rev": msg.base.rev})
    if name in ("BreakdownResult", "RecapResult"):
        cues = sum(len(s.voice) for s in msg.scripts)
        scripts = [
            {
                "persona": s.persona,
                "language": s.language,
                "cues": [
                    {
                        "line": c.line,
                        "speaker": c.speaker,
                        "t": c.t,
                        "voice": c.voice,
                        "style": c.style,
                    }
                    for c in s.voice
                ],
            }
            for s in msg.scripts
        ]
        return _bounded(
            name,
            f"tier {msg.tier} · {_plural(cues, 'voice cue')}",
            {"tier": msg.tier, "scripts": scripts},
        )
    if name == "AgentDown":
        return _bounded(
            name, f"the {msg.step} waits to be brought back", {"step": msg.step, "error": msg.error}
        )
    return _bounded(name, name, None)


def tool_calls(response: Any) -> list[ToolCall]:
    """The tools a run called, in order, each with the result it got back (function-call and
    function-result contents, paired by call id)."""
    calls: dict[str, ToolCall] = {}
    for m in getattr(response, "messages", None) or []:
        for c in m.contents:
            kind = getattr(c, "type", None)
            if kind == "function_call" and c.name:
                calls[c.call_id or str(len(calls))] = ToolCall(
                    name=c.name, arguments=_arguments(c.arguments)
                )
            elif kind == "function_result" and (call := calls.get(c.call_id)) is not None:
                exception = getattr(c, "exception", None)
                if exception:
                    call.error = str(exception).split(":", 1)[0][:100]
                text = _unwrapped(c.result if isinstance(c.result, str) else _text(c.result))
                if text is not None and len(text) > MAX_RESULT:
                    text, call.truncated = text[:MAX_RESULT], True
                call.result = text
    return list(calls.values())


def _arguments(raw: Any) -> dict[str, JsonValue]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return {"_unparsed": raw[:200]}
    if not isinstance(raw, dict):
        return {}
    return json.loads(json.dumps(raw, default=str))


def _unwrapped(text: str | None) -> str | None:
    """An MCP tool's own answer: Agent Framework wraps it as {"result": "<the answer>"}."""
    try:
        data = json.loads(text) if text else None
    except json.JSONDecodeError:
        return text
    if isinstance(data, dict) and list(data) == ["result"] and isinstance(data["result"], str):
        return data["result"]
    return text


def _text(result: Any) -> str | None:
    """An MCP result as text: its text contents joined, else its JSON."""
    if result is None:
        return None
    if isinstance(result, list):
        texts = [getattr(x, "text", None) for x in result]
        if texts and all(isinstance(t, str) for t in texts):
            return "\n".join(texts)
    return json.dumps(result, ensure_ascii=False, default=str)


# --- the web's fixture ----------------------------------------------------------------------------


async def _fixture(out: str) -> None:
    """A failure drill on the hero moment with a scripted model (no Foundry): the Analyst calls
    two MCP tools, the Verifier sends a line back once, the Telestrator is down, then it is brought
    back from the checkpoint. The web's Crew trace tests render it (web/src/crewtrace/)."""
    import copy
    import tempfile
    from pathlib import Path

    from agent_framework import FileCheckpointStorage

    from agents.context import MomentContext
    from agents.plan import template_plan
    from agents.testing import Call, ToolCallingFakeChatClient
    from agents.workflow import run_crew

    ctx = MomentContext.load("blind_side_run", 3)
    stale = copy.copy(ctx)  # a claim changed after verification: the Verifier sends it back
    stale.claims = dict(ctx.claims)
    stale.claims["blind_side"] = ctx.claims["blind_side"].model_copy(
        update={"template": "{runner} ran on the blind side of {player} today."}
    )
    analyst = {"lens": "scan", "headline": ["scan_before_reception", "belief_error"],
               "supporting": ["cf_pass", "blind_side"], "angle": "He saw the runner."}  # fmt: skip
    replies = {
        "director": {"priority": "high", "reason": "The look over the shoulder decides the pass."},
        "analyst": [Call("get_moment"), Call("run_counterfactual"), analyst],
        "telestrator": template_plan(ctx).model_dump(by_alias=True),
        "pbp": {"lines": [{"claim": "scan_before_reception", "connective": "Watch this."}]},
        "color": [{"lines": [{"claim": "blind_side", "connective": None}]},
                  {"lines": [{"claim": "cf_pass", "connective": None}]}],
    }  # fmt: skip
    one = {"personas": ("analyst",), "languages": ("en",), "use_mcp": True}
    with tempfile.TemporaryDirectory() as folder:
        first = await run_crew(
            stale, client=ToolCallingFakeChatClient(replies=replies), down={"telestrator"},
            checkpoints=FileCheckpointStorage(folder), **one,
        )  # fmt: skip
        back = await run_crew(
            stale, client=ToolCallingFakeChatClient(replies=replies), bring_back="telestrator",
            checkpoints=FileCheckpointStorage(folder), trace=first.trace, **one,
        )  # fmt: skip
    Path(out).write_text(back.trace.model_dump_json(indent=1) + "\n")
    print(f"wrote {out}: {len(back.trace.steps)} steps, {len(back.trace.events)} events")


def main() -> None:
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Write the web's Crew trace fixture.")
    parser.add_argument("--fixture", default="web/src/crewtrace/fixture.json")
    asyncio.run(_fixture(parser.parse_args().fixture))


if __name__ == "__main__":
    main()
