"""The single-agent baseline for eval/crew_vs_single.py: one model call does the crew's four jobs.

One Foundry call, with the crew's MCP tools, returns the whole breakdown in one JSON reply: the
Director's priority and reason, the Analyst's lens and claims, the Telestrator's plan, and both
voices' lines for every audience. The schema is the crew's own, part by part: `DirectorChoice`,
the Analyst's enum-constrained choice, `PlanDraft`, and per voice the narration draft (anchored
lines, or the free-text lines of eval/free_text.py). The instructions are the crew's role
instructions, joined; the prompt holds what the four roles' prompts hold, except what one role
hands the next (the findings, the play-by-play lines), which the single agent writes itself.

It runs inside the crew's own workflow graph (`solo_story`), so everything after the model is the
crew's code: the Analyst's claim filtering, plan validation and the template plan, compose and
tidy, the Verifier with at most two rewrite rounds, Voice, the failure policy (one retry, then
templates), the failure drill and bring-back from a checkpoint. The first executor makes the one
call; the Analyst, Telestrator and narration executors only take their part of its reply, and a
rewrite round is one more call of the same agent. It has one call, so taking down any of its roles
takes the call down: it then runs on the crew's templates, and bringing it back runs the call again.

Used only by eval/crew_vs_single.py. The API never runs it, and the API image has no eval/.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from agent_framework import WorkflowContext, handler
from pydantic import BaseModel, ValidationError, create_model

from agents import fallbacks, prompts
from agents.llm import Attempt, Outage, ask
from agents.plan import shape_errors, template_plan, validate_plan
from agents.schemas import (
    CONNECTIVES,
    AnalystChoice,
    DirectorChoice,
    DraftLine,
    Findings,
    Language,
    NarrationDraft,
    Persona,
    PlanDraft,
    ScriptLine,
    Speaker,
    Strict,
    analyst_model,
    anchored_draft_model,
)
from agents.workflow import (
    BACK,
    NAME,
    Analyst,
    Analyze,
    Briefing,
    Director,
    Drafts,
    Job,
    Key,
    Narration,
    Planned,
    Rewrite,
    Story,
    Telestrator,
    Verifier,
    Voice,
    _replace,
    tidy,
)
from eval import free_text

Lines = Literal["anchored", "free_text"]
ROLE = "solo"
SPEAKERS: tuple[Speaker, ...] = ("pbp", "color")
REJECTED = "The Verifier rejected these lines."  # also opens the crew's rewrite prompts


def audience(persona: Persona, language: Language) -> str:
    """The field of an audience's script in the reply: `casual_en`."""
    return f"{persona}_{language}"


def _role_text(instruction: str) -> str:
    """A crew instruction without its `ROLE:` line and the shared crew text."""
    return instruction.split(prompts.CREW + "\n", 1)[1]


def instructions(lines: Lines) -> str:
    """The crew's role instructions as one agent's (agents/prompts.py, eval/free_text.py)."""
    rules = prompts.NARRATION_RULES if lines == "anchored" else free_text.NARRATION_RULES
    return f"""ROLE: {ROLE}
{prompts.CREW}
You are the whole production crew in one agent. In one reply you do the work of the Director, the
Analyst, the Telestrator and both narration voices, for every audience in `audiences`. Fill every
part of the reply, in order: `director`, `analyst`, `plan`, `scripts`.

As the Director (`director`):
{_role_text(prompts.DIRECTOR)}

As the Analyst (`analyst`):
{_role_text(prompts.ANALYST)}

As the Telestrator (`plan`, from the `telestrator` part of the prompt):
{_role_text(prompts.TELESTRATOR)}

As the narration voices (`scripts`): one script per audience, with the play-by-play lines (`pbp`)
and the co-commentator's lines (`color`).
- `pbp`: {prompts.SPEAKERS["pbp"]}
- `color`: {prompts.SPEAKERS["color"]}
{rules}"""


def _claims(ctx, lines: Lines, languages: list[Language]) -> list[dict]:
    """Supported claims as the crew's agents see them, in every language of the request."""
    out = []
    for cid, claim in ctx.supported.items():
        text = {lg: claim.template_for(lg) for lg in languages}
        if lines == "anchored":
            out.append({"id": cid, "kind": claim.kind, "verdict": "supported", "sentence": text})
        else:  # as eval/free_text.py shows them: the template and its slot names
            out.append({"id": cid, "kind": claim.kind, "verdict": "supported", "template": text,
                        "slots": sorted(claim.slots)})  # fmt: skip
    return out


def prompt(ctx, personas: list[Persona], languages: list[Language], lines: Lines) -> str:
    """What the four roles' prompts hold, once (agents/prompts.py)."""
    key = ctx.key_scan
    audiences = {}
    for persona in personas:
        for language in languages:
            entry: dict[str, Any] = {"persona": prompts.PERSONAS[persona], "language": language}
            if lines == "anchored":
                entry["allowed_connectives"] = list(CONNECTIVES[language])
                if persona in prompts.PREFERRED_CLAIMS:
                    entry["preferred_claims"] = [
                        c for c in prompts.PREFERRED_CLAIMS[persona] if c in ctx.supported
                    ]
            audiences[audience(persona, language)] = entry
    return prompts._dump(
        {
            "allowed_personas": personas,
            "allowed_languages": languages,
            "card": prompts._card_summary(ctx),
            "claims": _claims(ctx, lines, languages),
            "telestrator": {
                "moment": ctx.card.id,
                "clip": [round(ctx.rel(0), 2), round(ctx.rel(ctx.frames - 1), 2)],
                "decision_at": 0.0,
                "hero": ctx.hero,
                "players": ctx.players,
                "key_scan": None if key is None else {
                    "id": key.id, "from": round(ctx.rel(key.frame), 2),
                    "to": round(ctx.rel(key.attrs["end"]), 2)},
                "counterfactual": ctx.counterfactual_id,
                "intervention": ctx.intervention,
                "claims_for_labels": list(ctx.supported),
                "example_plan": template_plan(ctx).to_web(),
            },
            "audiences": audiences,
        }
    )  # fmt: skip


def voice_model(ctx, lines: Lines, language: Language) -> type[BaseModel]:
    """One voice's lines: the schema the crew's narration asks for (`Narration.schema`)."""
    if lines == "anchored":
        return anchored_draft_model(list(ctx.supported), language)
    return NarrationDraft


def reply_model(
    ctx, lines: Lines, personas: list[Persona], languages: list[Language]
) -> type[BaseModel]:
    """The reply: the crew's step schemas side by side, a script per audience and, per voice, the
    narration's own draft schema."""
    scripts = {}
    for language in languages:
        voice = voice_model(ctx, lines, language)
        script = create_model(f"Script_{language}", __base__=Strict,
                              pbp=(voice, ...), color=(voice, ...))  # fmt: skip
        for persona in personas:
            scripts[audience(persona, language)] = (script, ...)
    return create_model(
        "SoloBreakdown", __base__=Strict,
        director=(DirectorChoice, ...), analyst=(analyst_model(list(ctx.supported)), ...),
        plan=(PlanDraft, ...), scripts=(create_model("Scripts", __base__=Strict, **scripts), ...),
    )  # fmt: skip


def rewrite_model(ctx, lines: Lines, failed: list[tuple[Key, Speaker]]) -> type[BaseModel]:
    fields = {f"{audience(*key)}_{speaker}": (voice_model(ctx, lines, key[1]), ...)
              for key, speaker in failed}  # fmt: skip
    return create_model("SoloRewrite", __base__=Strict, **fields)


Failed = dict[tuple[Key, Speaker], list[tuple[ScriptLine, list[str]]]]


def rewrite_prompt(base: str, failed: Failed) -> str:
    rejected = [
        {"script": audience(*key), "voice": speaker,
         "claim": line.claims[0] if line.claims else None, "text": line.text, "problems": problems}
        for (key, speaker), mine in failed.items() for line, problems in mine
    ]  # fmt: skip
    return (
        base + f"\n\n{REJECTED} Rewrite each of them, in the same order, so it follows the rules; "
        "return exactly one line per rejected line, under `<script>_<voice>`.\n"
        + prompts._dump(rejected)
    )


# --- the executors: one call, then the crew's code on each part of the reply ----------------------


async def _ask(crew, lines: Lines, prompt_text: str, schema) -> Attempt:
    """The single agent's call. Any role down is the agent down: it is one call."""
    client = Outage(ROLE) if crew.down else crew.client
    return await ask(client, name=ROLE, instructions=instructions(lines),
                     prompt=prompt_text, schema=schema, timeout_s=crew.step_timeout_s,
                     tools=crew.analyst_tools)  # fmt: skip


class SoloDirector(Director):
    """Makes the one call and keeps its reply (plain JSON, so it checkpoints) on the crew; then
    the Director's part of it, as `Director` does with its own reply."""

    lines: Lines = "anchored"

    async def on_checkpoint_save(self) -> dict[str, Any]:
        return {**await super().on_checkpoint_save(), "solo": getattr(self.crew, "solo", None)}

    async def on_checkpoint_restore(self, state: dict[str, Any]) -> None:
        await super().on_checkpoint_restore(state)
        self.crew.solo = state.get("solo")

    async def _direct(self, job: Job, ctx: WorkflowContext[Analyze], resumed: bool = False) -> None:
        crew, mc = self.crew, self.crew.ctx
        personas, languages = list(job.personas), list(job.languages)
        with crew.step("director", resumed=resumed or None) as span:
            request = fallbacks.director(mc, personas, languages)
            attempt, notes, reply = None, [BACK] if resumed else [], None
            if crew.client is not None or crew.down:
                schema = reply_model(mc, self.lines, personas, languages)
                attempt = await _ask(crew, self.lines, prompt(mc, personas, languages, self.lines),
                                     schema)  # fmt: skip
                if attempt.tools_called:
                    notes.append(f"MCP tools called: {', '.join(attempt.tools_called)}")
                if attempt.value is not None:
                    reply = attempt.value.model_dump(by_alias=True)
                    choice = DirectorChoice.model_validate(reply["director"])
                    request = request.model_copy(
                        update={"priority": choice.priority, "reason": choice.reason}
                    )
            crew.solo = reply
            crew.record("director", attempt, notes, reply is not None, span)
        await ctx.send_message(Analyze(request))
        await self.wait_if_down([attempt], ctx)


class SoloAnalyst(Analyst):
    """The Analyst's part of the reply, filtered as `Analyst` filters its own."""

    async def _analyze(
        self, msg: Analyze, ctx: WorkflowContext[Briefing], resumed: bool = False
    ) -> None:
        crew, mc = self.crew, self.crew.ctx
        reply = getattr(crew, "solo", None)
        with crew.step("analyst", llm=False):
            findings, notes, used = fallbacks.analyst(mc), [], False
            if reply is not None:
                choice = AnalystChoice.model_validate(reply["analyst"])
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
            crew.record("analyst", None, notes, used)
        await ctx.send_message(Briefing(msg.request, findings, rev=self.sent))
        self.sent += 1


class SoloTelestrator(Telestrator):
    """The plan in the reply, validated as `Telestrator` validates its own."""

    async def _plan(
        self, msg: Briefing, ctx: WorkflowContext[Planned], resumed: bool = False
    ) -> None:
        crew, mc = self.crew, self.crew.ctx
        reply = getattr(crew, "solo", None)
        with crew.step("telestrator", llm=False):
            template = template_plan(mc)
            plan, source, errors = template, "template", []
            if reply is not None:
                try:
                    candidate = PlanDraft.model_validate(reply["plan"]).to_plan()
                    errors = validate_plan(candidate, mc)
                except ValidationError as e:
                    candidate, errors = None, shape_errors(e)
                if not errors:
                    plan, source = candidate, "agent"
            public = [e.public for e in errors]
            notes = [f"invalid plan, template used: {e}" for e in public]
            crew.record("telestrator", None, notes, reply is not None)
        await ctx.send_message(Planned(plan, source, public, rev=msg.rev))


class SoloNarration(Narration):
    """Both voices' lines from the reply (a voice with no usable lines takes its template, as in
    `Narration`), composed, interleaved and tidied by the crew's code. A rewrite round is one call
    of the single agent for every rejected line."""

    lines: Lines = "anchored"

    def _voice(self, reply: dict, key: Key, speaker: Speaker) -> list[DraftLine] | None:
        """The voice's lines in the reply; None when it has none usable."""
        language = key[1]
        draft = self.schema(language).model_validate(reply["scripts"][audience(*key)][speaker])
        return self.to_lines(draft, language) or None

    async def _draft(self, base: Briefing, ctx: WorkflowContext[Drafts]) -> None:
        crew = self.crew
        reply = getattr(crew, "solo", None)
        keys = [(p, lg) for p in base.request.personas for lg in base.request.languages]
        scripts, notes, fell_back = {}, [], 0
        for key in keys:
            if reply is None:
                ordered = self.template(*key)
            else:
                voices = []
                for speaker in SPEAKERS:
                    lines = self._voice(reply, key, speaker)
                    if lines is None:
                        fell_back += 1
                        lines = [line for _, line in self.template(*key, speaker)]
                    voices.append(lines)
                pbp, color = voices
                ordered = []
                for i in range(max(len(pbp), len(color))):
                    ordered += [("pbp", pbp[i])] if i < len(pbp) else []
                    ordered += [("color", color[i])] if i < len(color) else []
            lines = [ScriptLine(id=f"L{i + 1}", speaker=who, text=d.text, claims=d.claims)
                     for i, (who, d) in enumerate(ordered)]  # fmt: skip
            scripts[key], dropped = tidy(crew.ctx, lines, key[1], key[0])
            notes += [f"{key[0]}/{key[1]} {d}" for d in dropped]
        if fell_back:
            notes.insert(0, f"{fell_back} of {2 * len(keys)} voices fell back to templates")
        crew.record("narration", None, notes, reply is not None and not fell_back)
        await ctx.send_message(Drafts(base, scripts))

    @handler
    async def rewrite(self, msg: Rewrite, ctx: WorkflowContext[Drafts]) -> None:
        drafts, crew = msg.drafts, self.crew
        failed: Failed = {}
        for key, rejected in msg.failed.items():
            for speaker in SPEAKERS:
                mine = [(line, problems) for line, problems in rejected if line.speaker == speaker]
                if mine:
                    failed[(key, speaker)] = mine
        req = drafts.base.request
        base = prompt(crew.ctx, list(req.personas), list(req.languages), self.lines)
        with crew.step("narration", round=drafts.round + 1):
            attempt = await _ask(crew, self.lines, rewrite_prompt(base, failed),
                                 rewrite_model(crew.ctx, self.lines, list(failed)))  # fmt: skip
        for (key, speaker), mine in failed.items():
            value = getattr(attempt.value, f"{audience(*key)}_{speaker}", None)
            new = self.to_lines(value, key[1]) if value is not None else []
            replaced = {line.id: d for (line, _), d in zip(mine, new, strict=False)}
            # A failed rewrite replaces nothing; the Verifier then drops the line.
            drafts.scripts[key] = [_replace(line, replaced[line.id]) if line.id in replaced
                                   else line for line in drafts.scripts[key]]  # fmt: skip
        drafts.round += 1
        await ctx.send_message(drafts)


class FreeTextSoloNarration(SoloNarration, free_text.FreeTextNarration):
    lines: Lines = "free_text"


class FreeTextSoloDirector(SoloDirector):
    lines: Lines = "free_text"


def solo_story(
    lines: Lines = "anchored", verifier: type[Verifier] = Verifier, voice: type[Voice] = Voice
) -> Story:
    """The single agent in the crew's graph: its call, then the crew's code for each part."""
    if lines == "anchored":
        return Story(NAME, SoloDirector, SoloAnalyst, SoloTelestrator, SoloNarration, verifier,
                     voice)  # fmt: skip
    return Story(NAME, FreeTextSoloDirector, SoloAnalyst, SoloTelestrator, FreeTextSoloNarration,
                 verifier, voice)  # fmt: skip


def run(ctx, lines: Lines = "anchored", **kwargs: Any):
    """`agents.workflow.run_crew` with the single agent (tests, scripts)."""
    from agents.workflow import run_crew

    return asyncio.run(run_crew(ctx, story=solo_story(lines), **kwargs))
