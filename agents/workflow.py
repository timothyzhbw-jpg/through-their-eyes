"""The production crew as a Microsoft Agent Framework workflow (SPEC 6).

    Director → Analyst (⇄ MCP tools) ┬→ Telestrator ───────────────────────────────────┐
                                     └→ Narration (Commentator + Co-commentator)        ├→ Voice
                                        → Verifier ⇄ Narration (rewrite, at most twice) ┘
                                                                     Voice → BreakdownResult

Each executor handles one typed message and sends the next one, so every handoff is a typed edge
of the workflow graph. Agent steps call a model when one is configured, with a timeout and one
retry, and fall back to a deterministic template otherwise. The Verifier and Voice steps are code.
Every breakdown is one trace: a span per step under a "breakdown" span (agents/telemetry.py).

The Telestrator and narration both read only the Analyst's findings, so a fan-out edge runs them
concurrently. Voice places the approved lines on the plan's clock, so it joins the two lanes: it
speaks once it holds a plan and approved scripts from the same findings. The framework runs in
supersteps: the Verifier starts once the slower of the two lanes is done, and a rewrite round runs
after the Telestrator has finished rather than alongside it.

Failure drill and recovery (SPEC 6). An agent step can be taken down (`run_crew(down=...)`): its
model calls raise, as in an outage, so it retries once and runs on its template. A step that fell
back after an error then asks for the agent to be brought back (a workflow request, `AgentDown`).
With `checkpoints`, the workflow checkpoints at every superstep. Each executor checkpoints the last
message it handled and its trace entry. `bring_back` resumes the run from its latest checkpoint
with the answer (`AgentBack`): that step runs again on its last input. Only the steps that read its
output follow, and Voice speaks the revised breakdown. A run that was interrupted resumes from its
last completed superstep the same way.
"""

from __future__ import annotations

import asyncio
import sys
import time
from collections.abc import Collection
from dataclasses import dataclass, field
from typing import Any

from agent_framework import (
    CheckpointStorage,
    Executor,
    WorkflowBuilder,
    WorkflowCheckpointException,
    WorkflowContext,
    handler,
    register_checkpoint_type,
    response_handler,
)
from pydantic import BaseModel, ValidationError

from agents import fallbacks, prompts, schemas, telemetry
from agents.context import MomentContext
from agents.delivery import VOICES, cache_key, delivery_tier, pick_style, ssml_for_line
from agents.llm import DEFAULT_TIMEOUT_S, Attempt, Outage, ask
from agents.plan import template_plan, validate_plan, voice_times
from agents.schemas import (
    CONNECTIVES,
    AgentStep,
    AnalystChoice,
    BreakdownRequest,
    BreakdownResult,
    DirectorChoice,
    DraftLine,
    DroppedLine,
    Findings,
    Language,
    Persona,
    PlanDraft,
    ScriptLine,
    ScriptResult,
    Speaker,
    StepTrace,
    TelestrationPlan,
    VoiceCue,
    analyst_model,
    anchored_draft_model,
)
from explain import render
from explain.claims import PLACEHOLDER
from explain.render import ScriptLine as RenderLine
from explain.render import build_payload, render_line

MAX_REWRITES = 2  # SPEC 6: refuted line → rewrite (max 2) → drop the line
# Bump when code that shapes a breakdown changes without a prompt change: it is part of the
# API's cache key, so cached breakdowns from the older code are not served again.
PIPELINE_VERSION = 2  # 2: tidy() keeps each connective once across both voices

# The order of `BreakdownResult.trace`: the graph's order, the Telestrator before narration. The two
# lanes finish in either order, so the trace is sorted into this order before it is returned.
STEPS = ("director", "analyst", "telestrator", "narration", "verifier", "voice")
AGENTS: tuple[AgentStep, ...] = ("director", "analyst", "telestrator", "narration")  # model steps
ROLE_STEP = {"pbp": "narration", "color": "narration"}  # narration's two voices
NAME = "breakdown"  # the workflow's name, under which its checkpoints are filed
BACK = "re-run from the checkpoint: the agent is back"

Key = tuple[Persona, Language]


# --- messages on the edges ------------------------------------------------------------------------


@dataclass
class Job:
    personas: tuple[Persona, ...]
    languages: tuple[Language, ...]


@dataclass
class Analyze:
    request: BreakdownRequest


@dataclass
class Briefing:
    """The Analyst's findings, sent to the Telestrator and to narration at once."""

    request: BreakdownRequest
    findings: Findings
    rev: int = 0  # which Briefing: the Analyst counts them, and a re-run sends a new one


@dataclass
class Planned:
    plan: TelestrationPlan
    plan_source: str
    plan_errors: list[str]
    rev: int = 0  # the Briefing it was planned from


@dataclass
class Drafts:
    base: Briefing
    scripts: dict[Key, list[ScriptLine]]
    round: int = 0
    rewrites: dict[Key, int] = field(default_factory=dict)


@dataclass
class Rewrite:
    drafts: Drafts
    failed: dict[Key, list[tuple[ScriptLine, list[str]]]]


@dataclass
class Approved:
    base: Briefing
    scripts: list[ScriptResult]


@dataclass
class AgentDown:
    """A workflow request: this agent step fell back after an error. The run waits for
    `AgentBack`, which re-runs the step from the checkpoint."""

    step: str
    error: str


@dataclass
class AgentBack:
    """The answer to `AgentDown`: the agent is back."""


# --- shared state of one breakdown ----------------------------------------------------------------


@dataclass
class Crew:
    ctx: MomentContext
    client: Any | None
    step_timeout_s: float = DEFAULT_TIMEOUT_S
    analyst_tools: list[Any] | None = None
    voice_styles: dict[str, set[str]] = field(default_factory=dict)  # voice -> speaking styles
    trace: list[StepTrace] = field(default_factory=list)
    span: Any | None = None  # the breakdown's span; every step span is its child
    down: frozenset[str] = frozenset()  # agent steps taken down (the failure drill)

    @property
    def model(self) -> str:
        return telemetry.model_name(self.client)

    def uses_model(self, step: str) -> bool:
        """Whether `step` calls a model: one is configured, or the step is down and its calls
        fail as in an outage."""
        return self.client is not None or step in self.down

    def client_for(self, role: str) -> Any | None:
        step = ROLE_STEP.get(role, role)
        return Outage(step) if step in self.down else self.client

    def step(self, name: str, llm: bool = True, **attributes: Any):
        """The span of one workflow step; `llm` steps also name the model."""
        if llm:
            attributes["model"] = self.model
        return telemetry.span(name, self.span, moment=self.ctx.card.id, **attributes)

    async def ask(self, role: str, instructions: str, prompt: str, schema, tools=None) -> Attempt:
        return await ask(
            self.client_for(role), name=role, instructions=instructions, prompt=prompt,
            schema=schema, timeout_s=self.step_timeout_s, tools=tools,
        )  # fmt: skip

    def entry(self, step: str) -> StepTrace | None:
        return next((e for e in self.trace if e.step == step), None)

    def put(self, entry: StepTrace) -> None:
        """The step's trace entry, replacing the one from an earlier run of the step."""
        self.trace = [e for e in self.trace if e.step != entry.step] + [entry]

    def record(
        self, step: str, attempt: Attempt | None, notes: list[str], used_llm: bool, span=None
    ) -> None:
        entry = StepTrace(
            step=step,
            source="llm" if used_llm else "template",
            attempts=attempt.attempts if attempt else 0,
            ms=round(attempt.ms, 1) if attempt else 0.0,
            error=attempt.error if attempt else None,
            notes=notes,
        )
        self.put(entry)
        if span is not None:
            telemetry.annotate(span, source=entry.source, attempts=entry.attempts, ms=entry.ms,
                               error=entry.error)  # fmt: skip


# --- executors ------------------------------------------------------------------------------------


class Step(Executor):
    """An executor of the crew. It checkpoints the last message it handled and its trace entry, so
    a run resumed from a checkpoint (in another process too) can run the step again on the same
    input and still reports every step."""

    def __init__(self, crew: Crew, name: str) -> None:
        super().__init__(name)
        self.crew = crew
        self.last: Any = None

    async def on_checkpoint_save(self) -> dict[str, Any]:
        return {"last": self.last, "trace": self.crew.entry(self.id)}

    async def on_checkpoint_restore(self, state: dict[str, Any]) -> None:
        self.last = state.get("last")
        if (entry := state.get("trace")) is not None:
            self.crew.put(entry)

    async def wait_if_down(self, attempts: list[Attempt | None], ctx: WorkflowContext) -> None:
        """After a fallback forced by an error, ask for the agent to be brought back. One request
        per step: a later one replaces it."""
        errors = [a.error for a in attempts if a is not None and a.value is None and a.error]
        if errors:
            await ctx.request_info(AgentDown(self.id, errors[0]), AgentBack,
                                   request_id=f"down:{self.id}")  # fmt: skip


class Director(Step):
    def __init__(self, crew: Crew) -> None:
        super().__init__(crew, "director")

    @handler
    async def run(self, job: Job, ctx: WorkflowContext[Analyze]) -> None:
        self.last = job
        await self._direct(job, ctx)

    @response_handler
    async def back(self, down: AgentDown, back: AgentBack, ctx: WorkflowContext[Analyze]) -> None:
        await self._direct(self.last, ctx, resumed=True)

    async def _direct(self, job: Job, ctx: WorkflowContext[Analyze], resumed: bool = False) -> None:
        crew, mc = self.crew, self.crew.ctx
        with crew.step("director", resumed=resumed or None) as span:
            request = fallbacks.director(mc, list(job.personas), list(job.languages))
            attempt, notes = None, [BACK] if resumed else []
            if crew.uses_model("director"):
                attempt = await crew.ask(
                    "director", prompts.DIRECTOR,
                    prompts.director_prompt(mc, list(job.personas), list(job.languages)),
                    DirectorChoice,
                )  # fmt: skip
                if attempt.value is not None:
                    choice: DirectorChoice = attempt.value
                    request = request.model_copy(
                        update={"priority": choice.priority, "reason": choice.reason}
                    )
            used = attempt is not None and attempt.value is not None
            crew.record("director", attempt, notes, used, span)
        await ctx.send_message(Analyze(request))
        await self.wait_if_down([attempt], ctx)


class Analyst(Step):
    def __init__(self, crew: Crew) -> None:
        super().__init__(crew, "analyst")
        self.sent = 0  # Briefings sent so far: the next one's rev

    async def on_checkpoint_save(self) -> dict[str, Any]:
        return {**await super().on_checkpoint_save(), "sent": self.sent}

    async def on_checkpoint_restore(self, state: dict[str, Any]) -> None:
        await super().on_checkpoint_restore(state)
        self.sent = state.get("sent", 0)

    @handler
    async def run(self, msg: Analyze, ctx: WorkflowContext[Briefing]) -> None:
        self.last = msg
        await self._analyze(msg, ctx)

    @response_handler
    async def back(self, down: AgentDown, back: AgentBack, ctx: WorkflowContext[Briefing]) -> None:
        await self._analyze(self.last, ctx, resumed=True)

    async def _analyze(
        self, msg: Analyze, ctx: WorkflowContext[Briefing], resumed: bool = False
    ) -> None:
        crew, mc = self.crew, self.crew.ctx
        with crew.step("analyst", resumed=resumed or None) as span:
            findings = fallbacks.analyst(mc)
            attempt, notes, used = None, [BACK] if resumed else [], False
            if crew.uses_model("analyst"):
                attempt = await crew.ask(
                    "analyst", prompts.ANALYST, prompts.analyst_prompt(mc, msg.request),
                    analyst_model(list(mc.supported)), tools=crew.analyst_tools,
                )  # fmt: skip
                if attempt.value is not None:
                    choice = AnalystChoice.model_validate(attempt.value.model_dump())
                    supported = mc.supported
                    unknown = [c for c in choice.headline + choice.supporting if c not in supported]
                    if unknown:
                        notes.append(f"dropped unknown or unsupported claims: {', '.join(unknown)}")
                    headline = [c for c in choice.headline if c in supported]
                    available = {lens.lens for lens in mc.card.lenses if lens.available}
                    if headline and choice.lens in available:
                        findings = Findings(
                            moment=mc.card.id, lens=choice.lens, headline=headline,
                            supporting=[c for c in choice.supporting if c in supported],
                            angle=choice.angle,
                        )  # fmt: skip
                        used = True
                    else:
                        notes.append("no usable headline or lens: template findings")
            crew.record("analyst", attempt, notes, used, span)
        await ctx.send_message(Briefing(msg.request, findings, rev=self.sent))
        self.sent += 1
        await self.wait_if_down([attempt], ctx)


class Telestrator(Step):
    def __init__(self, crew: Crew) -> None:
        super().__init__(crew, "telestrator")

    @handler
    async def run(self, msg: Briefing, ctx: WorkflowContext[Planned]) -> None:
        self.last = msg
        await self._plan(msg, ctx)

    @response_handler
    async def back(self, down: AgentDown, back: AgentBack, ctx: WorkflowContext[Planned]) -> None:
        await self._plan(self.last, ctx, resumed=True)

    async def _plan(
        self, msg: Briefing, ctx: WorkflowContext[Planned], resumed: bool = False
    ) -> None:
        crew, mc = self.crew, self.crew.ctx
        with crew.step("telestrator", resumed=resumed or None) as span:
            template = template_plan(mc)
            plan, source, errors, attempt, used = template, "template", [], None, False
            if crew.uses_model("telestrator"):
                attempt = await crew.ask(
                    "telestrator", prompts.TELESTRATOR,
                    prompts.telestrator_prompt(mc, msg.findings, template.to_web()), PlanDraft,
                )  # fmt: skip
                if attempt.value is not None:
                    used = True
                    try:
                        candidate = attempt.value.to_plan()
                        errors = validate_plan(candidate, mc)
                    except ValidationError as e:
                        candidate = None
                        errors = [f"plan shape: {err['msg']}" for err in e.errors()]
                    if not errors:
                        plan, source = candidate, "agent"
            notes = [BACK] if resumed else []
            notes += [f"invalid plan, template used: {e}" for e in errors]
            crew.record("telestrator", attempt, notes, used, span)
        await ctx.send_message(Planned(plan, source, errors, rev=msg.rev))
        await self.wait_if_down([attempt], ctx)


class Narration(Step):
    """Commentator (play-by-play) and Co-commentator (analysis) for every persona × language.

    What a voice is asked and how its reply becomes lines are the five methods below: anchored
    lines (SPEC 6). Only the narration ablation overrides them (eval/free_text.py); the crew
    always runs this class.
    """

    def __init__(self, crew: Crew) -> None:
        super().__init__(crew, "narration")
        self.resumed = False  # drafting again after the narration agents came back

    def instructions(self, speaker: Speaker) -> str:
        return prompts.narration_instructions(speaker)

    def prompt(
        self,
        findings: Findings,
        persona: Persona,
        language: Language,
        speaker: Speaker,
        pbp: list[ScriptLine] | None = None,
    ) -> str:
        return prompts.narration_prompt(self.crew.ctx, findings, persona, language, speaker, pbp)

    def rewrite_prompt(self, base: str, failed: list[tuple[ScriptLine, list[str]]]) -> str:
        return prompts.rewrite_prompt(base, failed)

    def schema(self, language: Language) -> type[BaseModel]:
        return anchored_draft_model(list(self.crew.ctx.supported), language)

    def to_lines(self, value: Any, language: Language) -> list[DraftLine]:
        return compose(self.crew.ctx, value, language)

    async def _speaker(
        self, base: Briefing, key: Key, speaker: Speaker, pbp: list[ScriptLine] | None
    ) -> tuple[list[DraftLine], Attempt | None]:
        crew, mc = self.crew, self.crew.ctx
        persona, language = key
        template = [line for _, line in fallbacks.narration(mc, persona, language, speaker)]
        if not crew.uses_model("narration"):
            return template, None
        prompt = self.prompt(base.findings, persona, language, speaker, pbp)
        schema = self.schema(language)
        instructions = self.instructions(speaker)
        attrs = {"persona": persona, "language": language, "speaker": speaker,
                 "resumed": self.resumed or None}  # fmt: skip
        with crew.step("narration", **attrs) as span:
            attempt = await crew.ask(speaker, instructions, prompt, schema)
            lines = self.to_lines(attempt.value, language) if attempt.value is not None else []
            if not lines:
                attempt.value = None  # nothing usable: counts as a fallback
            telemetry.annotate(span, source="llm" if lines else "template",
                               attempts=attempt.attempts, ms=round(attempt.ms, 1),
                               error=attempt.error, lines=len(lines or template))  # fmt: skip
        return (lines or template), attempt

    async def _script(
        self, base: Briefing, key: Key
    ) -> tuple[list[ScriptLine], list[Attempt | None]]:
        persona, language = key
        if not self.crew.uses_model("narration"):  # the template already has the speaking order
            ordered = fallbacks.narration(self.crew.ctx, persona, language)
            for speaker in ("pbp", "color"):
                attrs = {"persona": persona, "language": language, "speaker": speaker}
                with self.crew.step("narration", **attrs) as span:
                    telemetry.annotate(span, source="template", attempts=0, ms=0.0,
                                       lines=sum(who == speaker for who, _ in ordered))  # fmt: skip
            return [
                ScriptLine(id=f"L{i + 1}", speaker=who, text=d.text, claims=d.claims)
                for i, (who, d) in enumerate(ordered)
            ], [None]
        pbp, a1 = await self._speaker(base, key, "pbp", None)
        pbp_lines = [ScriptLine(id="", speaker="pbp", text=d.text, claims=d.claims) for d in pbp]
        color, a2 = await self._speaker(base, key, "color", pbp_lines)
        ordered: list[tuple[Speaker, DraftLine]] = []
        for i in range(max(len(pbp), len(color))):
            ordered += [("pbp", pbp[i])] if i < len(pbp) else []
            ordered += [("color", color[i])] if i < len(color) else []
        return [
            ScriptLine(id=f"L{i + 1}", speaker=who, text=d.text, claims=d.claims)
            for i, (who, d) in enumerate(ordered)
        ], [a1, a2]

    @handler
    async def draft(self, base: Briefing, ctx: WorkflowContext[Drafts]) -> None:
        self.last = base
        await self._draft(base, ctx)

    @response_handler
    async def back(self, down: AgentDown, back: AgentBack, ctx: WorkflowContext[Drafts]) -> None:
        self.resumed = True
        try:
            await self._draft(self.last, ctx)
        finally:
            self.resumed = False

    async def _draft(self, base: Briefing, ctx: WorkflowContext[Drafts]) -> None:
        keys = [(p, lg) for p in base.request.personas for lg in base.request.languages]
        results = await asyncio.gather(*(self._script(base, k) for k in keys))
        attempts = [a for _, atts in results for a in atts if a is not None]
        fell_back = [a for a in attempts if a.value is None]
        notes = [BACK] if self.resumed else []
        if fell_back:
            n = len(fell_back)
            notes.append(f"{n} of {len(attempts)} narration calls fell back to templates")
        summary = None
        if attempts:
            error = fell_back[0].error if fell_back else None
            total = sum(a.attempts for a in attempts)
            summary = Attempt(None, total, error, max(a.ms for a in attempts))
        scripts = {}
        for key, (lines, _) in zip(keys, results, strict=True):
            scripts[key], dropped = tidy(self.crew.ctx, lines, key[1])
            notes += [f"{key[0]}/{key[1]} {d}" for d in dropped]
        self.crew.record("narration", summary, notes, bool(attempts) and not fell_back)
        await ctx.send_message(Drafts(base, scripts))
        await self.wait_if_down(attempts, ctx)

    @handler
    async def rewrite(self, msg: Rewrite, ctx: WorkflowContext[Drafts]) -> None:
        drafts = msg.drafts
        jobs = []
        for key, failed in msg.failed.items():
            for speaker in ("pbp", "color"):
                mine = [(line, problems) for line, problems in failed if line.speaker == speaker]
                if mine:
                    jobs.append((key, speaker, mine))

        async def redo(key: Key, speaker: Speaker, mine) -> tuple[Key, dict[str, DraftLine]]:
            persona, language = key
            base = self.prompt(drafts.base.findings, persona, language, speaker)
            attrs = {"persona": persona, "language": language, "speaker": speaker,
                     "round": drafts.round + 1}  # fmt: skip
            with self.crew.step("narration", **attrs) as span:
                attempt = await self.crew.ask(
                    speaker, self.instructions(speaker), self.rewrite_prompt(base, mine),
                    self.schema(language),
                )  # fmt: skip
                new = self.to_lines(attempt.value, language) if attempt.value else []
                # A failed rewrite replaces nothing; the Verifier then drops the line.
                telemetry.annotate(span, source="llm", attempts=attempt.attempts,
                                   ms=round(attempt.ms, 1), error=attempt.error,
                                   lines=min(len(new), len(mine)))  # fmt: skip
            return key, {line.id: d for (line, _), d in zip(mine, new, strict=False)}

        for key, replaced in await asyncio.gather(*(redo(*job) for job in jobs)):
            drafts.scripts[key] = [
                _replace(line, replaced[line.id]) if line.id in replaced else line
                for line in drafts.scripts[key]
            ]
        drafts.round += 1
        await ctx.send_message(drafts)


def tidy(
    ctx: MomentContext, lines: list[ScriptLine], language: Language
) -> tuple[list[ScriptLine], list[str]]:
    """Deterministic clean-up of model lines before the Verifier.

    - A bare placeholder ({n}) is given the full form its claim's template uses ({n:times}): same
      slot, so the value is unchanged, only its wording.
    - A line that only restates claims an earlier line already stated is dropped, and so is a
      repeated connective. A claim line that opens with a connective an earlier line already
      used keeps only its claim: the two voices pick connectives without seeing each other's.
    """
    out, notes, stated, texts, opened = [], [], set(), set(), set()
    for line in lines:
        if line.claims:
            for c in CONNECTIVES[language]:
                if line.text.startswith(c) and len(line.text) > len(c):
                    if c in opened:
                        line = line.model_copy(update={"text": line.text[len(c) :].lstrip()})
                        notes.append(f"{line.id}: repeated connective removed")
                    opened.add(c)
                    break
        forms: dict[str, str] = {}
        for cid in line.claims:
            claim = ctx.claims.get(cid)
            if claim is None:
                continue
            for m in PLACEHOLDER.finditer(claim.template_for(language)):
                if m["fmt"] or m["one"] is not None:
                    forms.setdefault(m["name"], m[0])

        def full_form(m, forms=forms) -> str:
            bare = not (m["claim"] or m["fmt"] or m["one"] is not None)
            return forms.get(m["name"], m[0]) if bare else m[0]

        text = PLACEHOLDER.sub(full_form, line.text)
        claims = set(line.claims)
        if (claims and claims <= stated) or (not claims and text in texts):
            notes.append(f"{line.id} dropped: repeats an earlier line")
            continue
        stated |= claims
        texts.add(text)
        if not claims:
            opened.add(text)
        out.append(line.model_copy(update={"text": text}) if text != line.text else line)
    return out, notes


MAX_CONNECTIVES = 2  # per voice


def compose(ctx: MomentContext, draft: Any, language: Language) -> list[DraftLine]:
    """Anchored model lines → text: a claim speaks its verified template, a connective itself.

    A model line with both is one spoken line, the connective first. Connectives after the first
    `MAX_CONNECTIVES` are left out, so the voice does not open every line with one.
    """
    out, used = [], 0
    for line in draft.lines:
        claim = line.claim if line.claim in ctx.supported else None
        parts = []
        if line.connective and used < MAX_CONNECTIVES:
            parts, used = [line.connective], used + 1
        if claim:
            parts.append(ctx.claims[claim].template_for(language))
        if parts:
            text = ("" if language == "zh" else " ").join(parts)
            out.append(DraftLine(text=text, claims=[claim] if claim else []))
    return out


def _replace(line: ScriptLine, draft: DraftLine) -> ScriptLine:
    return line.model_copy(update={"text": draft.text, "claims": draft.claims})


class Verifier(Step):
    """Deterministic: verified claims and the render check decide what may air (SPEC 5.3)."""

    def __init__(self, crew: Crew) -> None:
        super().__init__(crew, "verifier")

    def _check(self, line: ScriptLine, language: Language):
        mc = self.crew.ctx
        render = RenderLine(id=line.id, text=line.text, claims=line.claims)
        return render_line(render, mc.claims, mc.verdicts, language, mc.names)

    @handler
    async def check(self, drafts: Drafts, ctx: WorkflowContext[Rewrite | Approved]) -> None:
        started = time.perf_counter()
        with self.crew.step("verifier", llm=False, round=drafts.round) as span:
            message, failing = self._round(drafts)
            approved = isinstance(message, Approved)
            telemetry.annotate(
                span, source="code", ms=round((time.perf_counter() - started) * 1000, 1),
                failed=failing, rewrites=sum(drafts.rewrites.values()),
                dropped=sum(len(s.dropped) for s in message.scripts) if approved else 0,
            )  # fmt: skip
        await ctx.send_message(message)

    def _round(self, drafts: Drafts) -> tuple[Rewrite | Approved, int]:
        """One round: the failing lines go back for a rewrite, or the rest airs. Also returns
        how many lines failed."""
        mc = self.crew.ctx
        failed: dict[Key, list[tuple[ScriptLine, list[str]]]] = {}
        for key, lines in drafts.scripts.items():
            bad = [(line, res) for line in lines if not (res := self._check(line, key[1])).ok]
            if bad:
                failed[key] = [
                    (line, [f"{v.kind}: {v.detail}" for v in res.violations]) for line, res in bad
                ]
        failing = sum(len(lines) for lines in failed.values())
        if failed and drafts.round < MAX_REWRITES and self.crew.uses_model("narration"):
            for key in failed:
                drafts.rewrites[key] = drafts.rewrites.get(key, 0) + 1
            return Rewrite(drafts, failed), failing

        notes, results = [], []
        for (persona, language), lines in drafts.scripts.items():
            kept, dropped = [], []
            for line in lines:
                res = self._check(line, language)
                if res.ok:
                    kept.append(line)
                else:
                    first = res.violations[0]
                    dropped.append(DroppedLine(id=line.id, speaker=line.speaker, text=line.text,
                                               reason=first.kind, detail=first.detail))  # fmt: skip
                    notes.append(f"{persona}/{language} {line.id} dropped: {first.kind}")
            built = build_payload(
                mc.card.id, persona, language,
                [RenderLine(id=line.id, text=line.text, claims=line.claims) for line in kept],
                mc.claims, mc.verdicts, mc.names,
            )  # fmt: skip
            results.append(
                ScriptResult(
                    persona=persona,
                    language=language,
                    lines=kept,
                    payload=built.payload,
                    dropped=dropped,
                    rewrites=drafts.rewrites.get((persona, language), 0),
                    voice=[],
                )  # fmt: skip
            )
        rounds = Attempt(None, drafts.round + 1, None, 0.0)
        self.crew.put(StepTrace(step="verifier", source="code", attempts=rounds.attempts, ms=0.0,
                                error=None, notes=notes))  # fmt: skip
        return Approved(drafts.base, results), failing


class Voice(Step):
    """SSML per approved line: one voice per speaker and language, styled by the delivery tier.

    The join of the two lanes: it speaks once it holds a plan and approved scripts from the same
    Briefing. It speaks again when a step brought back revises either: a new plan from the
    Telestrator, new scripts from narration, or both after a new Briefing.
    """

    def __init__(self, crew: Crew) -> None:
        super().__init__(crew, "voice")
        self.planned: Planned | None = None
        self.approved: Approved | None = None

    async def on_checkpoint_save(self) -> dict[str, Any]:
        state = await super().on_checkpoint_save()
        return {**state, "planned": self.planned, "approved": self.approved}

    async def on_checkpoint_restore(self, state: dict[str, Any]) -> None:
        await super().on_checkpoint_restore(state)
        self.planned, self.approved = state.get("planned"), state.get("approved")

    @handler
    async def plan(self, msg: Planned, ctx: WorkflowContext[None, BreakdownResult]) -> None:
        self.planned = msg
        await self._join(ctx)

    @handler
    async def scripts(self, msg: Approved, ctx: WorkflowContext[None, BreakdownResult]) -> None:
        self.approved = msg
        await self._join(ctx)

    async def _join(self, ctx: WorkflowContext[None, BreakdownResult]) -> None:
        planned, approved = self.planned, self.approved
        if planned is None or approved is None or planned.rev != approved.base.rev:
            return  # the other lane has not answered this Briefing yet
        started = time.perf_counter()
        with self.crew.step("voice", llm=False) as span:
            result = self._speak(planned, approved)
            telemetry.annotate(span, source="code", attempts=1,
                               ms=round((time.perf_counter() - started) * 1000, 1),
                               lines=sum(len(s.voice) for s in result.scripts))  # fmt: skip
        await ctx.yield_output(result)

    def _speak(self, planned: Planned, msg: Approved) -> BreakdownResult:
        started = time.perf_counter()
        crew, mc = self.crew, self.crew.ctx
        tier = delivery_tier(mc.card)
        scripts = []
        for script in msg.scripts:
            speaker_of = {line.id: line.speaker for line in script.lines}
            times = voice_times(planned.plan, len(script.payload.lines))
            cues = []
            for t, line in zip(times, script.payload.lines, strict=True):
                spoken = ScriptLine(
                    id=line.id, speaker=speaker_of[line.id], text=line.text, claims=line.claims
                )
                voice = VOICES[(script.language, spoken.speaker)]
                styles = crew.voice_styles.get(voice, set())
                ssml = ssml_for_line(spoken, script.language, tier, styles)
                style = pick_style(tier, styles)
                cues.append(
                    VoiceCue(line=line.id, speaker=spoken.speaker, t=t, voice=voice, style=style,
                             ssml=ssml, cache_key=cache_key(ssml))
                )  # fmt: skip
            scripts.append(script.model_copy(update={"voice": cues}))
        notes = [f"tier {tier}"] + (
            [] if crew.voice_styles else ["voice styles unknown: prosody only"]
        )
        crew.put(StepTrace(step="voice", source="code", attempts=1,
                           ms=round((time.perf_counter() - started) * 1000, 1), error=None,
                           notes=notes))  # fmt: skip
        trace = sorted(crew.trace, key=lambda s: STEPS.index(s.step))
        return BreakdownResult(
            request=msg.base.request, findings=msg.base.findings, plan=planned.plan,
            plan_source=planned.plan_source, plan_errors=planned.plan_errors, tier=tier,
            scripts=scripts, trace=trace, total_ms=0.0,
        )  # fmt: skip


# --- running a breakdown --------------------------------------------------------------------------


MAX_SUPERSTEPS = 60  # a first run takes at most 9; each bring-back adds at most 8


def build_workflow(
    crew: Crew, narration: type[Narration] = Narration, checkpoints: CheckpointStorage | None = None
):
    """The breakdown graph. `narration` is replaced only by the narration ablation's free-text
    mode (eval/narration_ablation.py); `run_breakdown` always uses the default. With
    `checkpoints`, the workflow checkpoints there at the end of every superstep."""
    director, analyst, telestrator = Director(crew), Analyst(crew), Telestrator(crew)
    narration, verifier, voice = narration(crew), Verifier(crew), Voice(crew)
    return (
        WorkflowBuilder(
            max_iterations=MAX_SUPERSTEPS,
            name=NAME,
            start_executor=director,
            checkpoint_storage=checkpoints,
        )  # fmt: skip
        .add_edge(director, analyst)
        .add_fan_out_edges(analyst, [telestrator, narration])  # both lanes get the findings
        .add_edge(narration, verifier)
        .add_edge(verifier, narration)  # rewrite requests
        .add_edge(telestrator, voice)  # the plan ...
        .add_edge(verifier, voice)  # ... and the approved scripts: Voice joins them
        .build()
    )


@dataclass
class CrewRun:
    result: BreakdownResult
    pending: list[str]  # agent steps that fell back after an error and wait to be brought back


class NotWaiting(LookupError):
    """`bring_back` named a step that is not waiting to be brought back, or there is no run."""


async def run_breakdown(ctx: MomentContext, **kwargs: Any) -> BreakdownResult:
    """The breakdown of the moment; `run_crew` takes the same arguments."""
    return (await run_crew(ctx, **kwargs)).result


async def run_crew(
    ctx: MomentContext,
    client: Any | None = None,
    personas: tuple[Persona, ...] = ("casual", "analyst"),
    languages: tuple[Language, ...] = ("en", "zh"),
    step_timeout_s: float = DEFAULT_TIMEOUT_S,
    use_mcp: bool = False,
    voice_styles: dict[str, set[str]] | None = None,
    down: Collection[str] = (),
    checkpoints: CheckpointStorage | None = None,
    bring_back: str | None = None,
) -> CrewRun:
    """Run the crew on the moment.

    - `down`: agent steps taken down for this run (the failure drill).
    - `checkpoints`: where the workflow checkpoints. If its latest checkpoint is from a run that
      did not finish, that run resumes from it instead of starting over.
    - `bring_back`: resume the run in `checkpoints` that waits on this step; the step runs again.
      Raises `NotWaiting` if no run there waits on it.
    """
    crew = Crew(ctx, client, step_timeout_s, voice_styles=voice_styles or {},
                down=frozenset(down))  # fmt: skip
    job = Job(tuple(personas), tuple(languages))
    start = await _start(checkpoints, bring_back, job)
    attrs = {"moment": ctx.card.id, "personas": personas, "languages": languages,
             "model": crew.model, "down": sorted(down) or None, "bring_back": bring_back,
             "resumed": "checkpoint_id" in start or None}  # fmt: skip
    with telemetry.span(NAME, **attrs) as span:
        crew.span = span
        if use_mcp and client is not None:
            from agent_framework import MCPStdioTool

            tool = MCPStdioTool(
                name="moment", command=sys.executable,
                args=["-m", "agents.mcp_server", "--scenario", ctx.scenario, "--seed",
                      str(ctx.seed)],
            )  # fmt: skip
            async with tool:
                crew.analyst_tools = [tool]
                out = await _run(crew, start, job, checkpoints)
        else:
            out = await _run(crew, start, job, checkpoints)
        result = out.result
        result.trace_id = _trace_id(span)
        telemetry.annotate(span, ms=result.total_ms,
                           rewrites=sum(s.rewrites for s in result.scripts),
                           dropped=sum(len(s.dropped) for s in result.scripts))  # fmt: skip
    return out


async def _start(
    checkpoints: CheckpointStorage | None, bring_back: str | None, job: Job
) -> dict[str, Any]:
    """How `Workflow.run` starts: a new run, a resumed one, or one resumed with an answer."""
    latest = await checkpoints.get_latest(workflow_name=NAME) if checkpoints else None
    if bring_back is not None:
        request = f"down:{bring_back}"
        if latest is None or request not in latest.pending_request_info_events:
            raise NotWaiting(f"the {bring_back} is not waiting to be brought back")
        return {"checkpoint_id": latest.checkpoint_id, "responses": {request: AgentBack()}}
    if latest is not None and any(latest.messages.values()):  # messages in flight: unfinished
        return {"checkpoint_id": latest.checkpoint_id}
    return {"message": job}


async def _run(
    crew: Crew, start: dict[str, Any], job: Job, checkpoints: CheckpointStorage | None
) -> CrewRun:
    started = time.perf_counter()
    try:
        result = await build_workflow(crew, checkpoints=checkpoints).run(**start)
    except WorkflowCheckpointException:
        if "responses" in start or "message" in start:
            raise
        # The checkpoint no longer fits the graph (the code changed): start over.
        result = await build_workflow(crew, checkpoints=checkpoints).run(job)
    outputs = result.get_outputs()
    if not outputs:
        raise RuntimeError("the breakdown workflow produced no output")
    out: BreakdownResult = outputs[-1]
    out.total_ms = round((time.perf_counter() - started) * 1000, 1)
    if checkpoints is not None:  # what still waits after this run, in its last checkpoint
        latest = await checkpoints.get_latest(workflow_name=NAME)
        waiting = list(latest.pending_request_info_events.values()) if latest else []
    else:
        waiting = result.get_request_info_events()
    return CrewRun(out, sorted({e.source_executor_id for e in waiting}))


def _trace_id(span: Any) -> str | None:
    context = span.get_span_context()
    return format(context.trace_id, "032x") if context.is_valid else None


def breakdown(ctx: MomentContext, **kwargs: Any) -> BreakdownResult:
    """Synchronous wrapper around `run_breakdown`."""
    return asyncio.run(run_breakdown(ctx, **kwargs))


def _register_checkpoint_types() -> None:
    """File checkpoints are pickles, read back through Agent Framework's allowlist of types. Allow
    every class a crew message can hold. The checkpoint directory belongs to the service and is
    never filled from user input."""
    for module in (sys.modules[__name__], schemas, render):
        for value in vars(module).values():
            if isinstance(value, type) and value.__module__ == module.__name__:
                register_checkpoint_type(value)


_register_checkpoint_types()
