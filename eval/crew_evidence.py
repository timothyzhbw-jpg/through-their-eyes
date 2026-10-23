"""Why a crew: what the multi-agent architecture measurably buys (SPEC 6, Best Multi-Agent System).

    uv run python -m eval.crew_evidence                  # offline, no model call, about 3 min
    uv run python -m eval.crew_evidence --extract-cache <worktree>/out/crew_vs_single/runs

eval/crew_vs_single.py compared the crew with one agent doing its four jobs on Foundry and found no
narration-quality win: what keeps wrong facts off the air is the anchored schema, which either
structure can use. This eval measures what the crew's architecture provides instead, and says
where it does not help:

1. Fault tolerance. Every hero moment the site serves × every persona and language, with each
   agent taken down in turn (the Producer desk's failure drill, `run_crew(down=...)`), then all
   four: what still airs, which roles stay on the model, whether an unverified number airs, and
   what bringing the agent back from its checkpoint re-runs and costs. The single agent of
   crew_vs_single (eval/single_agent.py) takes the same drills. Then the API's provenance as
   limits and faults pile up (`ladder`).
2. Verification by construction. The fields a model writes in its own words reject any number;
   every number aired is a verified slot's value. Perturbations of aired lines (a number or a
   player the model writes itself, an unbacked term, a broken placeholder, an unknown or
   forbidden claim, a claim tampered with after verification) go through the shipped gates with
   the Verifier and without it. The Foundry drafts cached by crew_vs_single
   (eval/fixtures/crew_vs_single_cache.json) are re-checked by today's Verifier, per persona and
   language.
3. Auditability. With the Analyst on our MCP server, does every aired line trace to verified
   claims with an audit record, the tool results the Analyst read, the voice call that chose it,
   the Verifier round that passed it and its voice cue (the crew trace, agents/crewtrace.py)?
4. Parallelism. The Telestrator and narration run at once, and so do every audience's voices.
   Model calls take the per-role median latency measured on Foundry (from the cache), scaled
   down; wall times are reported at Foundry scale.
5. Honest limits: crew_vs_single's quality result, quoted from its report with the line numbers.

The model is scripted (`ScriptedModel`): each agent answers with the choices its deterministic
template makes, through Agent Framework, the role's structured-output schema and the crew's own
code, as a model's reply would. So this measures the architecture (what airs, who answered, what
a fault costs, what recovery re-runs, what the gates stop), not how well a model writes.
Everything but the wall times is deterministic. The committed report is generated on Linux
(python:3.11-slim), the platform the live API computes on (CLAUDE.md).

Writes eval/reports/crew_evidence.md.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import os
import re
import statistics
import time
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, get_args

from agent_framework import InMemoryCheckpointStorage
from pydantic import ValidationError

from agents import fallbacks, prompts
from agents.context import MomentContext
from agents.llm import DEFAULT_TIMEOUT_S
from agents.persona_rules import forbidden
from agents.plan import template_plan, validate_plan
from agents.schemas import (
    CONNECTIVES,
    PLAYER_ID,
    BreakdownResult,
    DirectorChoice,
    Language,
    Persona,
    ScriptLine,
    analyst_model,
    anchored_draft_model,
)
from agents.testing import Call, ToolCallingFakeChatClient
from agents.workflow import AGENTS, BREAKDOWN, Crew, CrewRun, Story, Verifier, run_crew, tidy
from api.settings import DEFAULT_MATCHES
from api.tamper import TamperError, _tampered_slot, numeric
from eval.corruption import MEASURED
from eval.narration_ablation import _check, preview
from eval.single_agent import solo_story
from explain.claims import PLACEHOLDER
from explain.numbers import number_tokens
from explain.render import ScriptLine as RenderLine
from explain.render import render_claim, render_line
from explain.verifier import Verifier as ClaimVerifier
from sim.match import match_heroes

REPORTS = Path(__file__).parent / "reports"
CACHE_FIXTURE = Path(__file__).parent / "fixtures" / "crew_vs_single_cache.json"
PERSONAS: tuple[Persona, ...] = get_args(Persona)
LANGUAGES: tuple[Language, ...] = get_args(Language)
DEFAULT_AUDIENCE: tuple[tuple[Persona, ...], tuple[Language, ...]] = (
    ("casual", "analyst"),
    ("en", "zh"),
)  # what crew_vs_single measured on Foundry, and the latency medians come from
FAULTS: tuple[tuple[str, ...], ...] = tuple((a,) for a in AGENTS) + (AGENTS,)
STRUCTURES = ("crew", "single")
SCALE = 1.0  # model latencies are divided by this while timing; times are reported × it
# crew_vs_single's per-agent-run timeout, every arm: for runs a call longer than the deployed
# step timeout would otherwise cut short (the single agent's, or calls queued one at a time).
SINGLE_TIMEOUT_S = 30.0
MAX_BACKS = 8
# The scripted model's own words (the Director's reason, the Analyst's angle): no numbers.
REASON = "The lens that changes the outcome most tells this moment."
ANGLE = "What he saw before the ball arrived decided what he did with it."
PERSONA_OF = {text: key for key, text in prompts.PERSONAS.items()}


def served_moments() -> list[tuple[str, int]]:
    """Every hero moment the site serves: the standalone heroes and the stitched matches' heroes
    (api/settings.py DEFAULT_MATCHES), once each, in that order."""
    out: list[tuple[str, int]] = []
    for scenario, seed in DEFAULT_MATCHES:
        for moment in match_heroes(seed) if scenario == "match" else [(scenario, seed)]:
            if moment not in out:
                out.append(moment)
    return out


def label(ctx: MomentContext) -> str:
    return f"{ctx.scenario}-{ctx.seed}"


# --- the scripted model ---------------------------------------------------------------------------


def _first_json(text: str) -> Any:
    """The JSON object a prompt opens with (a rewrite prompt appends text after it)."""
    return json.JSONDecoder().raw_decode(text)[0]


def anchored_lines(ctx: MomentContext, persona: Persona, language: Language, speaker: str) -> dict:
    """One voice's template lines as the anchored reply a narration model returns: per line a
    verified claim id, an allowed connective, or both."""
    out = []
    for _, draft in fallbacks.narration(ctx, persona, language, speaker):  # type: ignore[arg-type]
        text = draft.text
        if not draft.claims:
            out.append({"claim": None, "connective": text})
            continue
        connective = next((c for c in CONNECTIVES[language]
                           if text.startswith(c) and len(text) > len(c)), None)  # fmt: skip
        out.append({"claim": draft.claims[0], "connective": connective})
    return {"lines": out}


def _analyst(ctx: MomentContext) -> dict:
    f = fallbacks.analyst(ctx)
    # The template may list more supporting claims than the model's schema allows (6).
    return {"lens": f.lens, "headline": f.headline[:3], "supporting": f.supporting[:6],
            "angle": ANGLE}  # fmt: skip


def replies(ctx: MomentContext, tools: bool = False) -> dict[str, Any]:
    """Every role's reply, as `agents.testing.FakeChatClient` routes them by the `ROLE:` line.

    The choices are the templates' (agents/fallbacks.py): the priority rule on the lens delta,
    the template findings, the template plan, the template lines per persona and language. With
    `tools`, the Analyst first reads the moment and its claims through our MCP server."""

    def voice(speaker: str):
        def answer(prompt: str) -> dict:
            data = _first_json(prompt)
            return anchored_lines(ctx, PERSONA_OF[data["persona"]], data["language"], speaker)

        return answer

    def solo(prompt: str) -> dict:
        data = _first_json(prompt)
        scripts = {
            f"{p}_{lg}": {s: anchored_lines(ctx, p, lg, s) for s in ("pbp", "color")}
            for p in data["allowed_personas"] for lg in data["allowed_languages"]
        }  # fmt: skip
        return {"director": director, "analyst": analyst, "plan": plan, "scripts": scripts}

    director = {"priority": fallbacks.priority_for(ctx), "reason": REASON}
    analyst = _analyst(ctx)
    plan = template_plan(ctx).model_dump(by_alias=True)
    return {
        "director": director,
        "analyst": [Call("get_moment"), Call("list_claims"), analyst] if tools else analyst,
        "telestrator": plan,
        "pbp": voice("pbp"),
        "color": voice("color"),
        "solo": solo,
    }


class ScriptedModel(ToolCallingFakeChatClient):
    """The scripted replies behind Agent Framework's chat client, so every agent call takes the
    real path: the structured-output schema, the tool loop, the timeout and retry.

    - `latency`: seconds per call, by role (a role not named answers at once);
    - `serial`: one call at a time, as with a model that serves one request at once;
    - `outage`: every call fails, as when the model service is down.
    It counts the requests (tool rounds included) and the most calls in flight at once."""

    def __init__(
        self,
        replies: dict[str, Any],
        latency: dict[str, float] | None = None,
        serial: bool = False,
        outage: bool = False,
    ) -> None:
        super().__init__(replies=replies)
        self.latency = latency or {}
        self.serial, self.outage = serial, outage
        self.gate: asyncio.Semaphore | None = None
        self.in_flight = self.peak = 0

    @property
    def requests(self) -> int:
        return sum(self.calls.values())

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        if self.outage:
            self.calls[self._role(messages, options)] += 1

            async def down():
                raise ConnectionError("the model service is unavailable")

            return down()
        role = self._role(messages, options)
        inner = super()._inner_get_response(
            messages=messages, stream=stream, options=options, **kwargs
        )

        async def answer():
            if self.serial and self.gate is None:
                self.gate = asyncio.Semaphore(1)
            async with self.gate if self.serial else nullcontext():
                self.in_flight += 1
                self.peak = max(self.peak, self.in_flight)
                try:
                    await asyncio.sleep(self.latency.get(role, 0.0))
                    return await inner
                finally:
                    self.in_flight -= 1
                    inner.close()  # a call timed out before it answered was never awaited

        return answer()


def story(structure: str) -> Story:
    """The crew as deployed, or crew_vs_single's single agent with the same (shipped) Verifier."""
    return BREAKDOWN if structure == "crew" else solo_story("anchored", verifier=Verifier)


# --- what airs ------------------------------------------------------------------------------------


def _aired(scripts: Iterable[Any]) -> Iterator[tuple[str, str, list[str]]]:
    """(language, text, claims) of every aired line, from results or their JSON."""
    for s in scripts:
        if isinstance(s, dict):
            lang, lines = s["language"], s["payload"]["lines"]
            yield from ((lang, x["text"], list(x["claims"])) for x in lines)
        else:
            yield from ((s.language, x.text, list(x.claims)) for x in s.payload.lines)


def aired_numbers(ctx: MomentContext, scripts: Iterable[Any]) -> tuple[int, list[str]]:
    """(numbers aired, those no verified slot holds). Independent of the crew's Verifier step:
    each cited claim is verified again against the event store, its verified sentence rendered,
    and a number in an aired line must be one of those sentences' numbers."""
    fresh = ClaimVerifier(ctx.evaluator)
    sentences: dict[tuple[str, str], Counter] = {}

    def numbers_of(cid: str, lang: str) -> Counter:
        if (cid, lang) not in sentences:
            claim, found = ctx.claims.get(cid), Counter()
            if claim is not None:
                verdict = fresh.verify(claim)
                if verdict.supported:
                    text = render_claim(claim, verdict, lang, ctx.names).text or ""
                    found = Counter(t.text for t in number_tokens(text))
            sentences[(cid, lang)] = found
        return sentences[(cid, lang)]

    total, bad = 0, []
    for lang, text, claims in _aired(scripts):
        allowed = sum((numbers_of(c, lang) for c in claims), Counter())
        for token in number_tokens(text):
            total += 1
            if allowed[token.text] > 0:
                allowed[token.text] -= 1
            else:
                bad.append(token.text)
    return total, bad


def from_model(result: BreakdownResult | dict) -> list[str]:
    """The agent roles whose part of the breakdown came from the model, in the graph's order."""
    trace = result["trace"] if isinstance(result, dict) else result.trace
    rows = [(e["step"], e["source"]) if isinstance(e, dict) else (e.step, e.source) for e in trace]
    llm = {step for step, source in rows if source == "llm"}
    return [a for a in AGENTS if a in llm]


def _shape(result: BreakdownResult) -> Any:
    """What a viewer gets from a breakdown, without its trace and timings."""
    return (
        result.request.model_dump(), result.findings.model_dump(), result.plan.model_dump(),
        result.plan_source,
        sorted((s.persona, s.language, [(x.id, x.speaker, x.text, x.claims) for x in s.lines],
                [x.text for x in s.payload.lines]) for s in result.scripts),
    )  # fmt: skip


def same_breakdown(a: BreakdownResult, b: BreakdownResult) -> bool:
    return _shape(a) == _shape(b)


def in_order(steps: Iterable[str]) -> list[str]:
    """Agent steps in the graph's order (the workflow lists them alphabetically)."""
    return sorted(steps, key=lambda s: AGENTS.index(s) if s in AGENTS else len(AGENTS))


# --- 1. fault tolerance ---------------------------------------------------------------------------


@dataclass
class Back:
    """One bring-back from the checkpoint."""

    step: str
    requests: int  # model requests it made
    reran: list[str]  # the steps that ran again
    from_model: list[str]  # roles from the model afterwards
    pending: list[str]  # still waiting afterwards


@dataclass
class DrillRow:
    structure: str
    moment: str
    fault: tuple[str, ...]
    asked: int  # scripts asked for (persona × language)
    delivered: int  # scripts that aired at least one line
    lines: int
    numbers: int
    unverified: list[str]  # numbers aired that no verified slot holds
    plan_valid: bool
    from_model: list[str]
    pending: list[str]
    events: list[tuple[str, str | None]]  # the drill's run events, checkpoints left out
    checkpoints: int  # checkpoints the drill's run saved
    requests: int  # model requests of the drill's run
    backs: list[Back]
    back_events: int  # bring-backs whose trace has a `back` event naming their checkpoint
    recovered: bool  # after the bring-backs: the breakdown of a fault-free run


async def drill(
    ctx: MomentContext,
    structure: str,
    fault: Sequence[str],
    personas: Sequence[Persona],
    languages: Sequence[Language],
    normal: BreakdownResult,
    latency: dict[str, float] | None = None,
) -> DrillRow:
    """The failure drill: a run with `fault` down, checkpointed, then every waiting step brought
    back in the graph's order until none waits. The single agent is one call, so bringing back
    the step that makes it brings back all its roles."""
    model = ScriptedModel(replies(ctx), latency=latency)
    kw = {"client": model, "personas": tuple(personas), "languages": tuple(languages),
          "checkpoints": InMemoryCheckpointStorage(), "story": story(structure)}  # fmt: skip
    run = await run_crew(ctx, down=tuple(fault), **kw)
    first, requests = run, model.requests
    events = [(e.kind, e.step) for e in run.trace.events if e.run == 0 and e.kind != "checkpoint"]
    checkpoints = sum(e.kind == "checkpoint" for e in run.trace.events if e.run == 0)
    down, backs, back_events = set(fault), [], 0
    while run.pending and len(backs) < MAX_BACKS:
        step = min(run.pending, key=AGENTS.index)
        down = set() if structure == "single" else down - {step}
        before = model.requests
        run = await run_crew(ctx, down=sorted(down), bring_back=step, trace=run.trace, **kw)
        index = run.trace.runs[-1].index
        reran = list(dict.fromkeys(s.step for s in run.trace.steps if s.run == index))
        back_events += any(e.kind == "back" and e.step == step and e.checkpoint
                           for e in run.trace.events if e.run == index)  # fmt: skip
        backs.append(Back(step, model.requests - before, reran, from_model(run.result),
                          in_order(run.pending)))  # fmt: skip
    asked = len(personas) * len(languages)
    scripts = first.result.scripts
    numbers, unverified = aired_numbers(ctx, scripts)
    return DrillRow(
        structure=structure, moment=label(ctx), fault=tuple(fault), asked=asked,
        delivered=sum(bool(s.payload.lines) for s in scripts),
        lines=sum(len(s.payload.lines) for s in scripts), numbers=numbers, unverified=unverified,
        plan_valid=validate_plan(first.result.plan, ctx) == [],
        from_model=from_model(first.result), pending=in_order(first.pending), events=events,
        checkpoints=checkpoints, requests=requests, backs=backs, back_events=back_events,
        recovered=same_breakdown(run.result, normal),
    )  # fmt: skip


@dataclass
class Normal:
    """A fault-free breakdown."""

    structure: str
    moment: str
    run: CrewRun
    requests: int
    numbers: int
    unverified: list[str]

    @property
    def result(self) -> BreakdownResult:
        return self.run.result


async def drills(
    ctxs: Sequence[MomentContext], personas: Sequence[Persona], languages: Sequence[Language]
) -> tuple[list[Normal], list[DrillRow]]:
    normals, rows = [], []
    for structure in STRUCTURES:
        for ctx in ctxs:
            model = ScriptedModel(replies(ctx))
            run = await run_crew(ctx, client=model, personas=tuple(personas),
                                 languages=tuple(languages), story=story(structure))  # fmt: skip
            numbers, unverified = aired_numbers(ctx, run.result.scripts)
            normals.append(Normal(structure, label(ctx), run, model.requests, numbers,
                                  unverified))  # fmt: skip
            for fault in FAULTS:
                rows.append(await drill(ctx, structure, fault, personas, languages, run.result))
    return normals, rows


# --- 1b. what a viewer gets through the API -------------------------------------------------------


@dataclass
class LadderRow:
    step: str
    viewer: str
    status: int
    kind: str | None  # provenance: live | cached | template
    reason: str | None
    from_model: int  # agent roles from the model, of 4
    pending: list[str]
    lines: int
    unverified: list[str]


LADDER_MATCH = ("blind_side_run", 3)


def ladder(cache_dir: Path) -> list[LadderRow]:
    """The API with the scripted model, a per-client limit of 2 per 10 min and a daily cap of 4
    model runs: what each request gets, in order. Then a model outage on a fresh day."""
    from fastapi.testclient import TestClient

    # An offline eval sends no telemetry: importing api.main configures tracing, and a `.env`
    # loaded into the environment would point it at the deployed Application Insights.
    os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"] = ""
    from api.main import create_app
    from api.settings import Settings, match_id

    ctx = MomentContext.load(*LADDER_MATCH)
    mid = match_id(*LADDER_MATCH)
    rows: list[LadderRow] = []

    def app(folder: str, model: ScriptedModel):
        settings = Settings(matches=[LADDER_MATCH], cache_dir=cache_dir / folder,
                            rate_limit=(2, 600.0), daily_model_cap=4, analyst_mcp=False,
                            web_origin="*")  # fmt: skip
        return TestClient(create_app(settings, client=model, model_id="scripted"))

    def ask(c, step: str, viewer: str, path: str, body: dict) -> dict:
        r = c.post(path, json=body, headers={"x-forwarded-for": viewer})
        data = r.json() if r.status_code == 200 else {}
        result = data.get("result") or {}
        prov = data.get("provenance") or {}
        scripts = result.get("scripts") or []
        rows.append(LadderRow(
            step=step, viewer=viewer, status=r.status_code, kind=prov.get("kind"),
            reason=prov.get("reason"), from_model=len(from_model(result)) if result else 0,
            pending=(data.get("drill") or {}).get("pending") or [],
            lines=sum(len(s["payload"]["lines"]) for s in scripts),
            unverified=aired_numbers(ctx, scripts)[1],
        ))  # fmt: skip
        return data

    def view(persona: str, language: str = "en", **extra: Any) -> dict:
        return {"match": mid, "personas": [persona], "languages": [language], **extra}

    path = "/api/breakdowns"
    with app("day1", ScriptedModel(replies(ctx))) as c:
        ask(c, "first view", "a", path, view("casual"))
        ask(c, "same view, another viewer", "b", path, view("casual"))
        drilled = ask(c, "drill: telestrator down", "a", path, view("casual", fail=["telestrator"]))
        ask(c, "bring the telestrator back", "b", f"{path}/{drilled['key']}/bring-back",
            {"step": "telestrator"})  # fmt: skip
        ask(c, "new view, viewer over its limit", "a", path, view("analyst"))
        ask(c, "new view, another viewer", "c", path, view("coach"))
        ask(c, "new view, daily cap reached", "d", path, view("player_fan"))
        ask(c, "cached view, daily cap reached", "d", path, view("casual"))
    with app("day2", ScriptedModel(replies(ctx), outage=True)) as c:
        ask(c, "model outage, new view", "e", path, view("casual", "zh"))
        ask(c, "model outage, same view again", "f", path, view("casual", "zh"))
    return rows


# --- 2. verification by construction --------------------------------------------------------------

# Numbers a model might write in its own words, in each form the Verifier's detector knows.
INJECTED = ("in the 89th minute", "with a 0.25 gain", "after two scans", "twice", "第89分钟",
            "扫视了两次")  # fmt: skip


@dataclass
class FuzzRow:
    field: str
    tried: int
    rejected: int


def fuzz_schemas(claim_ids: list[str]) -> list[FuzzRow]:
    """Every field of a model's reply that is not an enum, given text with a number: the reason
    and the angle reject it (`no_numbers`); a narration line accepts only a claim id or an allowed
    connective, so any other text is rejected."""
    analyst = analyst_model(claim_ids)
    attempts = {
        "director.reason": lambda n: DirectorChoice(priority="high", reason=f"{REASON} {n}"),
        "analyst.angle": lambda n: analyst(lens="scan", headline=[claim_ids[0]], supporting=[],
                                           angle=f"{ANGLE} {n}"),  # fmt: skip
        "narration.claim": lambda n: anchored_draft_model(claim_ids, "en")(
            lines=[{"claim": f"He scanned {n}", "connective": None}]),
        "narration.connective": lambda n: anchored_draft_model(claim_ids, "en")(
            lines=[{"claim": None, "connective": f"Watch this, {n}"}]),
    }  # fmt: skip
    rows = []
    for name, make in attempts.items():
        rejected = 0
        for text in INJECTED:
            try:
                make(text)
            except ValidationError:
                rejected += 1
        rows.append(FuzzRow(name, len(INJECTED), rejected))
    return rows


PERTURBATIONS = (
    "number_right", "number_wrong", "extra_number", "player_named", "player_swapped",
    "unbacked_term", "broken_placeholder", "unknown_claim", "forbidden_claim", "claim_tampered",
    "claim_refuted",
)  # fmt: skip
WHAT = {
    "number_right": "a slot's number written by the model itself, the right value",
    "number_wrong": "a slot's number written by the model, one off",
    "extra_number": "a number no claim holds added to the line",
    "player_named": "a player written by name instead of by his slot, the right player",
    "player_swapped": "a player written by name, the wrong player",
    "unbacked_term": "a lexicon term (unmarked, blind side, …) no cited claim backs",
    "broken_placeholder": "a placeholder naming no slot of its claim",
    "unknown_claim": "a line citing a claim id that does not exist",
    "forbidden_claim": "a claim the persona must not hear (xT, probabilities for casual)",
    "claim_tampered": "the cited claim's number changed after verification, not re-verified",
    "claim_refuted": "the cited claim's number changed and re-verified: now refuted",
}
# What the anchored schema leaves a model able to do: it returns claim ids and connectives from
# enums, so text-level perturbations cannot be written at all; a tampered claim store is not a
# model's output. The persona's forbidden claims are not in its enum either.
EXPRESSIBLE = {k: False for k in PERTURBATIONS} | {"claim_tampered": None, "claim_refuted": None}
# What a perturbed line says when it airs, by construction: false (a wrong number or player, or a
# claim its evidence refutes), unverified (a statement no claim backs), garbled (raw placeholder
# braces), or true but written by the model (it breaks only the slot-fill rule).
AIRS_AS = {"number_right": "true, model-written", "number_wrong": "false",
           "extra_number": "unverified", "player_named": "true, model-written",
           "player_swapped": "false", "unbacked_term": "unverified",
           "broken_placeholder": "garbled", "unknown_claim": "garbled", "forbidden_claim": "–",
           "claim_tampered": "false", "claim_refuted": "false"}  # fmt: skip
EXTRA_NUMBER = {"en": " It came in the 89th minute.", "zh": "那是第89分钟。"}
TERMS = {"en": {"unmarked": " He was unmarked.", "blind side": " It was on his blind side.",
                "under heavy pressure": " He was under heavy pressure.",
                "lost his man": " He lost his man."},
         "zh": {"unmarked": "他无人盯防。", "blind side": "那是他的盲区。",
                "under heavy pressure": "他在重压之下。",
                "lost his man": "他跟丢了。"}}  # fmt: skip


@dataclass
class Gate:
    """A line through one pipeline: does it air, and if not, which stage stopped it."""

    airs: bool
    stage: str  # tidy | verifier | aired
    kinds: list[str] = field(default_factory=list)  # Verifier violations of what airs or why not
    wrong: list[str] = field(default_factory=list)  # aired ids and numbers no cited claim holds
    text: str = ""

    @property
    def error(self) -> bool:
        return bool(self.kinds)


@dataclass
class Outcome:
    kind: str
    moment: str
    persona: str
    language: str
    line: str
    original: str  # the line as it aired, unperturbed
    with_verifier: Gate
    without_verifier: Gate


def _gates(
    ctx: MomentContext, line: ScriptLine, persona: Persona, language: Language
) -> tuple[Gate, Gate]:
    """The line through the shipped gates (tidy, then the Verifier step's line check) and through
    tidy alone, as the single agent without a Verifier airs it (crew_vs_single's arm A)."""
    kept, _ = tidy(ctx, [line], language, persona)
    if not kept:
        return Gate(False, "tidy"), Gate(False, "tidy")
    line = kept[0]
    checked = _check(ctx, line, language)
    without = Gate(True, "aired", checked.kinds, checked.made_up, preview(ctx, line, language))
    res = Verifier(Crew(ctx, None))._check(line, (persona, language))
    if res.ok:
        return Gate(True, "aired", [], [], res.text or ""), without
    return Gate(False, "verifier", [v.kind for v in res.violations]), without


def _spans(ctx: MomentContext, line: ScriptLine, language: Language) -> list[tuple[re.Match, str]]:
    """Each placeholder of a line that renders, with the text it renders to."""
    res = render_line(RenderLine(id=line.id, text=line.text, claims=line.claims), ctx.claims,
                      ctx.verdicts, language, ctx.names)  # fmt: skip
    if not res.ok:
        return []
    matches = list(PLACEHOLDER.finditer(line.text))
    return [(m, res.text[s.start : s.end]) for m, s in zip(matches, res.spans, strict=False)]


def _tamper(ctx: MomentContext, cid: str) -> tuple[Any, Any, str] | None:
    """The claim with a number changed so that it no longer holds, its verdict when verified
    again, and the slot; None when no change of its numbers makes it false. The slot that
    carries the claim's measured number goes first (eval/corruption.py), then the others."""
    claim = ctx.claims[cid]
    first = MEASURED.get(claim.kind)
    for name in sorted(claim.slots, key=lambda n: n != first):
        slot = claim.slots[name]
        if not numeric(slot):
            continue
        value = float(slot.value)
        for new in (value + 1, value * 1.2 + 1, value - 1, value / 2):
            if slot.decimals is not None:
                new = round(new, slot.decimals)
            elif isinstance(slot.value, int):
                new = float(round(new))
            if new == value:
                continue
            try:
                changed = _tampered_slot(slot, new)
            except TamperError:
                continue
            copy = claim.model_copy(update={"slots": {**claim.slots, name: changed}})
            verdict = ClaimVerifier(ctx.evaluator).verify(copy)
            if not verdict.supported:
                return copy, verdict, name
    return None


def perturb(
    ctx: MomentContext, line: ScriptLine, persona: Persona, language: Language, kind: str
) -> tuple[MomentContext, ScriptLine, str | None] | None:
    """The line, and the evidence it is checked against, with one perturbation of `kind`, and
    the claim slot it made false when the line itself is unchanged; None when it does not apply
    to this line."""
    made = _perturb(ctx, line, persona, language, kind)
    if made is None or len(made) == 3:
        return made
    return made[0], made[1], None


def _perturb(ctx: MomentContext, line: ScriptLine, persona: Persona, language: Language,
             kind: str) -> tuple | None:  # fmt: skip
    edit = line.model_copy
    spans = _spans(ctx, line, language) if line.claims else []
    names = set(ctx.names.values())
    if kind == "none":
        return ctx, line
    if kind in ("number_right", "number_wrong"):
        for m, value in spans:
            if number_tokens(value) and value not in names:
                if kind == "number_wrong":
                    if not re.search(r"\d", value):
                        continue
                    value = re.sub(r"\d+", lambda d: str(int(d[0]) + 1), value, count=1)
                return ctx, edit(update={"text": line.text[: m.start()] + value +
                                         line.text[m.end() :]})  # fmt: skip
        return None
    if kind in ("player_named", "player_swapped"):
        for m, value in spans:
            if value in names:
                if kind == "player_swapped":
                    value = next(n for n in sorted(names) if n != value)
                return ctx, edit(update={"text": line.text[: m.start()] + value +
                                         line.text[m.end() :]})  # fmt: skip
        return None
    if kind == "extra_number":
        return (ctx, edit(update={"text": line.text + EXTRA_NUMBER[language]})) if line.claims \
            else None  # fmt: skip
    if kind == "unbacked_term":
        if not line.claims:
            return None
        backed = {t for c in line.claims for t in ctx.verdicts[c].terms}
        term = next(t for t in TERMS[language] if t not in backed)
        return ctx, edit(update={"text": line.text + TERMS[language][term]})
    if kind == "broken_placeholder":
        if not spans:
            return None
        m = spans[0][0]
        return ctx, edit(update={"text": line.text[: m.start()] + "{" + m["name"] + "_value}" +
                                 line.text[m.end() :]})  # fmt: skip
    if kind == "unknown_claim":
        return (ctx, edit(update={"claims": ["made_up_claim"]})) if line.claims else None
    if kind == "forbidden_claim":
        off = [c for c in forbidden(persona) if c in ctx.supported]
        if not off or line.claims:  # one per script: replaces the script's first connective
            return None
        return ctx, edit(update={"text": ctx.claims[off[0]].template_for(language),
                                 "claims": [off[0]]})  # fmt: skip
    if kind in ("claim_tampered", "claim_refuted"):
        cid = next((c for c in line.claims
                    if any(numeric(s) for s in ctx.claims[c].slots.values())), None)  # fmt: skip
        tampered = _tamper(ctx, cid) if cid else None
        if tampered is None:
            return None
        claim, verdict, slot = tampered
        claims = {**ctx.claims, cid: claim}
        verdicts = {**ctx.verdicts, cid: verdict} if kind == "claim_refuted" else ctx.verdicts
        # Its line is unchanged; what it says is now false (`falsified`).
        return dataclasses.replace(ctx, claims=claims, verdicts=verdicts), line, f"{cid}.{slot}"
    raise ValueError(kind)


def perturbations(
    ctx: MomentContext, scripts: Iterable[Any], kinds: Sequence[str] = PERTURBATIONS
) -> list[Outcome]:
    """Every aired line of `scripts`, perturbed by each kind that applies to it, through both
    pipelines. `forbidden_claim` replaces a script's first connective line (one per script)."""
    out = []
    for s in scripts:
        persona, language = s.persona, s.language
        first_connective = next((x.id for x in s.lines if not x.claims), None)
        aired = {x.id: x.text for x in s.payload.lines}
        for line in s.lines:
            for kind in kinds:
                if kind == "forbidden_claim" and line.id != first_connective:
                    continue
                made = perturb(ctx, line, persona, language, kind)
                if made is None:
                    continue
                world, changed, falsified = made
                with_v, without = _gates(world, changed, persona, language)
                if falsified and without.airs:  # airs the changed value, which is false
                    without.wrong = [*without.wrong, falsified]
                out.append(Outcome(kind, label(ctx), persona, language, line.id,
                                   aired.get(line.id, line.text), with_v, without))  # fmt: skip
    return out


# --- 2b. Foundry drafts from the crew-vs-single cache, re-checked ---------------------------------


@dataclass
class Cache:
    model: str
    date: str
    source: str
    latency_ms: dict[str, float]  # median request by role (`<role>_tool`: a tool round)
    latency_n: dict[str, int]  # requests each median is of
    runs: list[dict[str, Any]]


def load_cache(path: Path = CACHE_FIXTURE) -> Cache:
    d = json.loads(path.read_text())
    return Cache(d["model"], d["date"], d["source"], d["latency_ms"], d["latency_n"], d["runs"])


def extract_cache(runs_dir: Path) -> dict[str, Any]:
    """The fixture from crew_vs_single's run records (`out/crew_vs_single/runs/`): per fault-free
    run, what the model wrote (the Director's reason, the Analyst's choice, every voice's first
    drafts, the numbers found in its own words) and the per-role median request latency."""
    runs, ms = [], defaultdict(list)
    for path in sorted(runs_dir.glob("*.json")):
        rec = json.loads(path.read_text())
        if rec["fault"] != "none" or rec["phase"] != "run":
            continue
        result = rec["result"]
        digits: dict[str, int] = defaultdict(int)
        for r in rec["requests"]:
            digits[r["role"]] += len(r.get("digits") or [])
            if rec["lines"] == "anchored" and not r["cached"] and not r["rewrite"]:
                ms[r["role"] + ("_tool" if r["kind"] == "tool_call" else "")].append(r["ms"])
        runs.append({
            "scenario": rec["scenario"], "seed": rec["seed"], "structure": rec["structure"],
            "lines": rec["lines"], "date": rec["date"],
            "reason": result["request"]["reason"], "priority": result["request"]["priority"],
            "findings": {k: result["findings"][k]
                         for k in ("lens", "headline", "supporting", "angle")},
            "digits_in_replies": dict(sorted(digits.items())),
            "drafts": rec["first_drafts"],
        })  # fmt: skip
    return {
        "model": "gpt-4.1-mini",
        "date": max(r["date"] for r in runs),
        "source": "eval/crew_vs_single.py run records (out/crew_vs_single/runs/): Microsoft "
        "Foundry, the fault-free runs of eval/reports/crew_vs_single.md",
        "latency_ms": {k: round(statistics.median(v)) for k, v in sorted(ms.items())},
        "latency_n": {k: len(v) for k, v in sorted(ms.items())},
        "runs": runs,
    }


@dataclass
class DraftRow:
    """One cached script's first drafts, re-checked by today's code."""

    structure: str
    lines: str  # anchored | free_text
    moment: str
    persona: str
    language: str
    drafted: int
    stale: int  # anchored lines citing a claim today's evidence no longer supports
    forbidden: int  # dropped by tidy: a claim the persona must not hear
    repeats: int  # dropped by tidy: restates an earlier line
    rejected: int  # lines the Verifier's line check sends back
    kinds: Counter
    problems: int  # persona-rule problems: the script goes back to both voices
    cut: int  # lines repair drops after the last rewrite
    added: int  # verified template lines repair adds
    aired_without: int  # lines that air without a Verifier (after tidy)
    violations_without: int  # of those, lines the Verifier would reject
    wrong_without: int  # ids and numbers in them that no cited claim holds
    aired_with: int
    violations_with: int  # aired with the Verifier and still failing its line check (must be 0)


def _redraft(ctx: MomentContext, line: dict, language: Language) -> ScriptLine | None:
    """An anchored draft line as the model returned it (a claim id and/or a connective), composed
    again with today's verified templates; None when today's evidence does not support its claim."""
    text, claims = line["text"], list(line["claims"])
    connective = next((c for c in CONNECTIVES[language] if text.startswith(c)), None)
    if not claims:
        return ScriptLine(id=line["id"], speaker=line["speaker"], text=connective or text,
                          claims=[])  # fmt: skip
    if claims[0] not in ctx.supported:
        return None
    parts = [p for p in (connective, ctx.claims[claims[0]].template_for(language)) if p]
    return ScriptLine(
        id=line["id"],
        speaker=line["speaker"],
        text=("" if language == "zh" else " ").join(parts),
        claims=claims[:1],
    )


def rescore(cache: Cache, ctxs: dict[tuple[str, int], MomentContext]) -> list[DraftRow]:
    """Each cached script's first drafts through today's tidy, the Verifier's line and script
    checks and its repair, and as they would air without a Verifier. Runs on moments not in
    `ctxs` are skipped."""
    rows = []
    for run in cache.runs:
        ctx = ctxs.get((run["scenario"], run["seed"]))
        if ctx is None:
            continue
        verifier = Verifier(Crew(ctx, None))
        for key, drafted in run["drafts"].items():
            persona, language = key.split("/")
            if run["lines"] == "anchored":
                redrafted = [_redraft(ctx, x, language) for x in drafted]
                lines = [x for x in redrafted if x is not None]
            else:
                lines = [ScriptLine(**x) for x in drafted]
            kept, notes = tidy(ctx, lines, language, persona)
            checks = [(x, verifier._check(x, (persona, language))) for x in kept]
            passed = [x for x, res in checks if res.ok]
            kinds = Counter(v.kind for _, res in checks for v in res.violations)
            problems = verifier.script_problems((persona, language), kept)
            repaired, cut, fixed = verifier.repair((persona, language), passed)
            seen = [_check(ctx, x, language) for x in kept]
            rows.append(DraftRow(
                structure=run["structure"], lines=run["lines"],
                moment=f"{run['scenario']}-{run['seed']}", persona=persona, language=language,
                drafted=len(drafted), stale=len(drafted) - len(lines),
                forbidden=sum("not for" in n for n in notes),
                repeats=sum("repeats an earlier line" in n for n in notes),
                rejected=sum(not res.ok for _, res in checks), kinds=kinds,
                problems=len(problems), cut=len(cut), added=sum(" added" in n for n in fixed),
                aired_without=len(kept), violations_without=sum(bool(c.kinds) for c in seen),
                wrong_without=sum(len(c.made_up) for c in seen), aired_with=len(repaired),
                violations_with=sum(not verifier._check(x, (persona, language)).ok
                                    for x in repaired),
            ))  # fmt: skip
    return rows


# --- 3. auditability ------------------------------------------------------------------------------


async def mcp_run(
    ctx: MomentContext, personas: Sequence[Persona], languages: Sequence[Language]
) -> CrewRun:
    """The crew with the Analyst on our MCP server (stdio), as the deployed API runs it."""
    model = ScriptedModel(replies(ctx, tools=True))
    return await run_crew(ctx, client=model, personas=tuple(personas), languages=tuple(languages),
                          use_mcp=True, checkpoints=InMemoryCheckpointStorage())  # fmt: skip


@dataclass
class LineChain:
    """One aired line and the links that trace it back."""

    moment: str
    persona: str
    language: str
    line: str
    speaker: str
    picked_by: (
        str  # analyst (in the findings) | voice (from the other verified claims) | connective
    )
    verified: bool  # every claim supported, unchanged since, with an audit record of its verdict
    # Every claim is named in a result of the Analyst's MCP tools as the trace stores them:
    # "named"; "cut": not in what the trace kept of a result it truncated (MAX_RESULT);
    # "missing": not there at all; None: the Analyst had no tools.
    tools: str | None
    voice_call: bool  # the call of this voice, persona and language is on the trace
    approved: bool  # the last Verifier round passed it
    cue: bool  # it has a voice cue

    @property
    def linked(self) -> bool:
        """Every link but the tool results."""
        return all((self.verified, self.voice_call, self.approved, self.cue))

    @property
    def complete(self) -> bool:
        return self.linked and self.tools in ("named", None)


def trace_lines(ctx: MomentContext, run: CrewRun) -> list[LineChain]:
    trace, result = run.trace, run.result
    audited = {(r.claim.get("id"), r.claim_fingerprint) for r in ctx.audit.records
               if r.verdict.get("status") == "supported"}  # fmt: skip
    tools = [t for s in trace.steps if s.step == "analyst" for t in s.tools]
    results = [t.result or "" for t in tools]
    cut = any(t.truncated for t in tools)

    def named(claims: list[str]) -> str | None:
        if not tools:
            return None
        if all(any(f'"{c}"' in r for r in results) for c in claims):
            return "named"
        return "cut" if cut else "missing"

    calls = {(c.role, c.persona, c.language) for s in trace.steps if s.step == "narration"
             for c in s.calls}  # fmt: skip
    verifier = max((s for s in trace.steps if s.step == "verifier"),
                   key=lambda s: (s.run, s.end_ms), default=None)  # fmt: skip
    sent_back = {(r.persona, r.language, r.line) for r in verifier.rejected} if verifier else set()
    picked = set(result.findings.headline) | set(result.findings.supporting)
    out = []
    for s in result.scripts:
        cued = {c.line for c in s.voice}
        for line in s.lines:
            claims = line.claims
            out.append(LineChain(
                moment=label(ctx), persona=s.persona, language=s.language, line=line.id,
                speaker=line.speaker,
                picked_by="connective" if not claims else
                "analyst" if set(claims) <= picked else "voice",
                verified=all(c in ctx.supported and (c, ctx.claims[c].fingerprint()) in audited
                             for c in claims),
                tools=named(claims),
                voice_call=(line.speaker, s.persona, s.language) in calls,
                approved=verifier is not None
                and (s.persona, s.language, line.id) not in sent_back,
                cue=line.id in cued,
            ))  # fmt: skip
    return out


AGENT_STEPS = set(AGENTS)
WRITES = {"director": "request", "analyst": "findings", "telestrator": "plan",
          "narration": "drafts", "voice": "voice"}  # fmt: skip


@dataclass
class StepFields:
    id: str
    step: str
    missing: list[str]

    @property
    def complete(self) -> bool:
        return not self.missing


def step_fields(trace) -> list[StepFields]:
    """Each crew step on the trace with what it should record: its times, the message it handled
    and those it sent, what it wrote on the shared state, the evidence it read, its model calls,
    and the Analyst's tool calls when it had tools. The MCP server's start is not a step."""
    out = []
    for s in trace.steps:
        if s.step == "mcp":
            continue
        missing = []
        if s.start_ms > s.end_ms:
            missing.append("times")
        if s.input is None:
            missing.append("input")
        if not s.output:
            missing.append("output")
        wanted = WRITES.get(s.step)
        if s.step == "verifier":
            if not set(s.writes) & {"verdicts", "scripts"}:
                missing.append("writes")
        elif wanted and wanted not in s.writes:
            missing.append("writes")
        if s.step in AGENT_STEPS:
            if not s.calls:
                missing.append("calls")
            if not s.reads:
                missing.append("reads")
        out.append(StepFields(s.id, s.step, missing))
    return out


# --- 4. parallelism and latency -------------------------------------------------------------------


def foundry_latency(cache: Cache) -> dict[str, float]:
    """Seconds per call by role: the median Foundry request of crew_vs_single's fault-free runs.
    The Analyst's call is its tool round and its answer (high priority: one round of MCP tools);
    the single agent's is likewise its tool round and its reply."""
    ms = cache.latency_ms
    return {"director": ms["director"] / 1000,
            "analyst": (ms["analyst_tool"] + ms["analyst"]) / 1000,
            "telestrator": ms["telestrator"] / 1000, "pbp": ms["pbp"] / 1000,
            "color": ms["color"] / 1000, "solo": (ms["solo_tool"] + ms["solo"]) / 1000}  # fmt: skip


@dataclass
class Timed:
    structure: str
    scripts: int
    serial: bool
    timeout_s: float  # each agent run's timeout (one retry, then its template)
    from_model: int  # agent roles whose part came from the model, of 4
    wall_s: float  # at Foundry scale
    telestrator_s: float  # the Telestrator's lane
    narration_s: float  # narration's first drafts, every audience's voices
    overlap_s: float  # time both lanes ran at once
    requests: int
    peak: int  # most model calls in flight at once


def _lane(trace, step: str) -> tuple[float, float] | None:
    rows = [s for s in trace.steps if s.run == 0 and s.step == step and (s.round or 0) == 0]
    return (min(s.start_ms for s in rows), max(s.end_ms for s in rows)) if rows else None


async def timed(
    ctx: MomentContext,
    personas: Sequence[Persona],
    languages: Sequence[Language],
    latency: dict[str, float],
    scale: float = SCALE,
    serial: bool = False,
    structure: str = "crew",
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> Timed:
    """One breakdown with every model call taking its role's latency ÷ `scale`; times × `scale`.
    `timeout_s`: each agent run's timeout, the deployed one by default."""
    model = ScriptedModel(replies(ctx), latency={r: s / scale for r, s in latency.items()},
                          serial=serial)  # fmt: skip
    started = time.perf_counter()
    run = await run_crew(ctx, client=model, personas=tuple(personas), languages=tuple(languages),
                         story=story(structure), step_timeout_s=timeout_s / scale)  # fmt: skip
    wall = time.perf_counter() - started
    tele, narr = _lane(run.trace, "telestrator"), _lane(run.trace, "narration")
    overlap = max(0.0, min(tele[1], narr[1]) - max(tele[0], narr[0])) if tele and narr else 0.0
    return Timed(
        structure=structure, scripts=len(personas) * len(languages), serial=serial,
        timeout_s=timeout_s, from_model=len(from_model(run.result)), wall_s=wall * scale,
        telestrator_s=(tele[1] - tele[0]) / 1000 * scale if tele else 0.0,
        narration_s=(narr[1] - narr[0]) / 1000 * scale if narr else 0.0,
        overlap_s=overlap / 1000 * scale, requests=model.requests, peak=model.peak,
    )  # fmt: skip


@dataclass
class Recovery:
    structure: str
    fault: str
    timeout_s: float
    drill_s: float
    back_s: float  # bringing the agent back
    requests: int  # its model requests
    from_model: int  # roles from the model after it, of 4
    fresh_s: float  # a fault-free breakdown from scratch, for scale


async def recovery(
    ctx: MomentContext, latency: dict[str, float], scale: float = SCALE
) -> list[Recovery]:
    """Wall time to bring each agent back, at Foundry scale, on the default audiences. The crew
    runs with the deployed step timeout; the single agent with crew_vs_single's 30 s, since its
    one call is longer than the deployed timeout and would never come back under it."""
    personas, languages = DEFAULT_AUDIENCE
    out = []
    for structure in STRUCTURES:
        timeout = DEFAULT_TIMEOUT_S if structure == "crew" else SINGLE_TIMEOUT_S
        fresh = await timed(ctx, personas, languages, latency, scale, structure=structure,
                            timeout_s=timeout)  # fmt: skip
        faults = AGENTS if structure == "crew" else ("telestrator",)
        for agent in faults:
            scaled = {r: s / scale for r, s in latency.items()}
            model = ScriptedModel(replies(ctx), latency=scaled)
            kw = {"client": model, "personas": personas, "languages": languages,
                  "checkpoints": InMemoryCheckpointStorage(), "story": story(structure),
                  "step_timeout_s": timeout / scale}  # fmt: skip
            t0 = time.perf_counter()
            run = await run_crew(ctx, down=(agent,), **kw)
            t1 = time.perf_counter()
            step, before = run.pending[0], model.requests
            back = await run_crew(ctx, bring_back=step, trace=run.trace, **kw)
            t2 = time.perf_counter()
            out.append(Recovery(structure, agent, timeout, (t1 - t0) * scale, (t2 - t1) * scale,
                                model.requests - before, len(from_model(back.result)),
                                fresh.wall_s))  # fmt: skip
    return out


# --- 5. what crew_vs_single found, quoted ---------------------------------------------------------

QUOTES = {
    "wrong_facts": "Wrong facts aired: 0 · 0 · 0 · 0 (A · B · C · D)",
    "rejected": "lines the Verifier rejects: 0 of 110 without it in the single agent, 0 of 141 "
    "in the crew",
    "quality": "wrong facts aired 0 vs 0, groundedness 5.00 vs 5.00",
    "headline": "headline claims spoken 81% vs 92%",
    "seconds": "Seconds to air 14.4 vs 13.8, no measurable difference",
    "cost": "1.8 vs 12.0 model requests and $0.0046 vs $0.0090 per breakdown",
    "timeouts": "0 of 66 crew agent runs would have timed out, and 6 of 6 of the single agent's",
    "free_text": "wrong facts 3 (single) and 12 (crew)",
    "not_collaboration": "The crew's separate voices did not write fewer wrong facts than the "
    "single agent, so none of it is due to collaboration",
    "analyst_back": "bringing it back took 11.0 model requests",
    "not_better": "It does not show that the crew writes better.",
    "angle": "carried a number in both of its attempts, which the schema's `no_numbers` check "
    "rejects",
}


def quote_lines(path: Path = REPORTS / "crew_vs_single.md") -> dict[str, int]:
    """The line of crew_vs_single.md each quote is on (0: not found)."""
    lines = path.read_text().splitlines()
    return {k: next((i + 1 for i, line in enumerate(lines) if q in line), 0)
            for k, q in QUOTES.items()}  # fmt: skip


# --- the evaluation -------------------------------------------------------------------------------


@dataclass
class Evidence:
    moments: list[str]
    personas: tuple[str, ...]
    languages: tuple[str, ...]
    normals: list[Normal]
    drills: list[DrillRow]
    ladder: list[LadderRow]
    fuzz: list[FuzzRow]
    aired: tuple[int, int, list[str]]  # (lines, numbers, unverified) over every run's aired lines
    free_text_digits: int  # numbers in the reasons and angles that reached a breakdown
    outcomes: list[Outcome]
    controls: list[Outcome]  # the same lines unperturbed
    cache: Cache
    drafts: list[DraftRow]
    chains: list[LineChain]
    single_chains: list[LineChain]  # the single agent's fault-free runs, traced the same way
    steps: list[StepFields]
    tools_called: Counter
    timed: list[Timed]
    recovery: list[Recovery]
    scale: float
    seconds: float = 0.0


async def evaluate(
    moments: Sequence[tuple[str, int]],
    personas: Sequence[Persona] = PERSONAS,
    languages: Sequence[Language] = LANGUAGES,
    scale: float = SCALE,
    workdir: Path | None = None,
    log=print,
) -> Evidence:
    import tempfile

    started = time.perf_counter()
    ctxs = {m: MomentContext.load(*m) for m in moments}
    ctxs_by_label = {label(c): c for c in ctxs.values()}
    log(f"loaded {len(ctxs)} hero moments")
    normals, rows = await drills(list(ctxs.values()), personas, languages)
    log(f"drills: {len(rows)}")
    with tempfile.TemporaryDirectory(dir=workdir) as tmp:
        steps = await asyncio.to_thread(ladder, Path(tmp))
    log("API ladder done")
    cache = load_cache()
    cached = {(r["scenario"], r["seed"]) for r in cache.runs}
    for m in sorted(cached - set(ctxs)):
        ctxs[m] = MomentContext.load(*m)
    drafts = rescore(cache, ctxs)
    log(f"cached drafts re-checked: {len(drafts)} scripts")
    crew_normals = {n.moment: n for n in normals if n.structure == "crew"}
    outcomes, controls, chains, fields, tools = [], [], [], [], Counter()
    for m in moments:
        ctx = ctxs[m]
        outcomes += perturbations(ctx, crew_normals[label(ctx)].result.scripts)
        controls += perturbations(ctx, crew_normals[label(ctx)].result.scripts, kinds=("none",))
        run = await mcp_run(ctx, personas, languages)
        chains += trace_lines(ctx, run)
        fields += step_fields(run.trace)
        tools.update(t.name for s in run.trace.steps if s.step == "analyst" for t in s.tools)
    log(f"perturbations: {len(outcomes)}; traced lines: {len(chains)}")
    lines = numbers = 0
    unverified: list[str] = []
    reasons = []
    for n in normals:
        lines += sum(len(s.payload.lines) for s in n.result.scripts)
        numbers += n.numbers
        unverified += n.unverified
        reasons += [n.result.request.reason, n.result.findings.angle]
    for r in rows:
        lines += r.lines
        numbers += r.numbers
        unverified += r.unverified
    free_digits = sum(len(number_tokens(PLAYER_ID.sub("X", t or ""))) for t in reasons)
    latency = foundry_latency(cache)
    hero = ctxs[moments[0]]
    timings = [
        await timed(hero, *DEFAULT_AUDIENCE, latency, scale),
        await timed(
            hero, *DEFAULT_AUDIENCE, latency, scale, serial=True, timeout_s=SINGLE_TIMEOUT_S
        ),
        await timed(
            hero, *DEFAULT_AUDIENCE, latency, scale, structure="single", timeout_s=SINGLE_TIMEOUT_S
        ),
        await timed(hero, *DEFAULT_AUDIENCE, latency, scale, structure="single"),
    ]
    for n in (1, 2, 4, 6, 8, 10):
        audience = [(p, lg) for p in PERSONAS for lg in LANGUAGES][:n]
        ps = tuple(dict.fromkeys(p for p, _ in audience))
        lgs = tuple(dict.fromkeys(lg for _, lg in audience))
        if len(ps) * len(lgs) == n:
            timings.append(await timed(hero, ps, lgs, latency, scale))
    rec = await recovery(hero, latency, scale)
    log("timings done")
    single_chains = [c for n in normals if n.structure == "single"
                     for c in trace_lines(ctxs_by_label[n.moment], n.run)]  # fmt: skip
    return Evidence(
        moments=[label(c) for c in (ctxs[m] for m in moments)], personas=tuple(personas),
        languages=tuple(languages), normals=normals, drills=rows, ladder=steps,
        fuzz=fuzz_schemas(list(hero.supported)), aired=(lines, numbers, unverified),
        free_text_digits=free_digits, outcomes=outcomes, controls=controls, cache=cache,
        drafts=drafts,
        chains=chains, single_chains=single_chains, steps=fields, tools_called=tools,
        timed=timings, recovery=rec, scale=scale,
        seconds=time.perf_counter() - started,
    )  # fmt: skip


# --- the report -----------------------------------------------------------------------------------


def _pct(k: int, n: int) -> str:
    return f"{k}/{n} ({100 * k / n:.0f}%)" if n else "–"


def _list(xs: Iterable[str]) -> str:
    xs = list(xs)
    return ", ".join(xs) if xs else "none"


def _s(x: float) -> str:
    return f"{x:.1f} s"


def _fault(fault: Sequence[str]) -> str:
    return "all four" if tuple(fault) == AGENTS else fault[0]


def _range(xs: Iterable[int]) -> str:
    xs = list(xs)
    return f"{min(xs)}" if min(xs) == max(xs) else f"{min(xs)}–{max(xs)}"


def _recorded(r: DrillRow) -> bool:
    """The drill's trace has the down, fallback and waiting events of every agent taken down."""
    return all((kind, a) in r.events for a in r.fault for kind in ("down", "fallback", "waiting"))


def _drill_table(ev: Evidence) -> list[str]:
    rows = ["| agent down | structure | drills | scripts aired | plans valid | roles from the "
            "model, of 4 | waiting | numbers aired · unverified | bring-back: model requests | "
            "bring-back: steps run again | after it: the fault-free breakdown |",
            "|---|---|---:|---:|---:|---:|---|---:|---:|---|---:|"]  # fmt: skip
    for fault in FAULTS:
        for structure in STRUCTURES:
            rs = [r for r in ev.drills if r.fault == fault and r.structure == structure]
            if not rs:
                continue
            waiting = Counter(tuple(r.pending) for r in rs)
            backs = Counter(sum(b.requests for b in r.backs) for r in rs)
            reran = Counter(f"{len(r.backs)} bring-backs: " + ", ".join(b.step for b in r.backs)
                            if len(r.backs) > 1 else " → ".join(r.backs[0].reran) if r.backs
                            else "–" for r in rs)  # fmt: skip
            rows.append(
                f"| {_fault(fault)} | {structure} | {len(rs)} | "
                f"{sum(r.delivered for r in rs)}/{sum(r.asked for r in rs)} | "
                f"{sum(r.plan_valid for r in rs)}/{len(rs)} | "
                f"{statistics.mean(len(r.from_model) for r in rs):.1f} | "
                f"{'; '.join(f'{_list(w)}' + (f' ×{n}' if n != len(rs) else '') for w, n in waiting.items())} | "  # noqa: E501
                f"{sum(r.numbers for r in rs)} · {sum(len(r.unverified) for r in rs)} | "
                f"{' · '.join(str(k) for k in sorted(backs))} | "
                f"{'; '.join(reran)} | {sum(r.recovered for r in rs)}/{len(rs)} |"
            )
    return rows


def _ladder_table(ev: Evidence) -> list[str]:
    rows = ["| request | viewer | HTTP | provenance | reason | roles from the model, of 4 | "
            "waiting | lines aired | unverified numbers |",
            "|---|---|---:|---|---|---:|---|---:|---:|"]  # fmt: skip
    for r in ev.ladder:
        rows.append(
            f"| {r.step} | {r.viewer} | {r.status} | `{r.kind}` | {r.reason or '–'} | "
            f"{r.from_model} | {_list(r.pending)} | {r.lines} | {len(r.unverified)} |"
        )
    return rows


def _outcome_rows(ev: Evidence) -> tuple[list[str], dict[str, int]]:
    by: dict[str, list[Outcome]] = defaultdict(list)
    for o in ev.outcomes:
        by[o.kind].append(o)
    rows = ["| perturbation | what changes | a model can write it under the anchored schema | "
            "lines | kept off by tidy | kept off by the Verifier | without a Verifier: aired · "
            "breaking a Verifier rule | what those lines say | with the Verifier: aired |",
            "|---|---|---|---:|---:|---:|---:|---|---:|"]  # fmt: skip
    total = Counter()
    for kind in PERTURBATIONS:
        os_ = by.get(kind, [])
        if not os_:
            continue
        expressible = {False: "no (enum)", None: "not a model's output"}[EXPRESSIBLE[kind]]
        if kind == "forbidden_claim":
            expressible = "no (not in the persona's enum)"
        tidy_n = sum(o.with_verifier.stage == "tidy" for o in os_)
        ver_n = sum(o.with_verifier.stage == "verifier" for o in os_)
        aired = [o for o in os_ if o.without_verifier.airs]
        bad = sum(o.without_verifier.error for o in aired)
        with_aired = sum(o.with_verifier.airs for o in os_)
        total.update(n=len(os_), tidy=tidy_n, verifier=ver_n, aired=len(aired), bad=bad,
                     with_aired=with_aired)  # fmt: skip
        if aired:
            total[AIRS_AS[kind]] += len(aired)
        rows.append(
            f"| `{kind}` | {WHAT[kind]} | {expressible} | {len(os_)} | {tidy_n} | {ver_n} "
            f"| {len(aired)} · {bad} | {AIRS_AS[kind] if aired else '–'} | {with_aired} |"
        )
    rows.append(
        f"| **all** | | | **{total['n']}** | {total['tidy']} | {total['verifier']} | "
        f"**{total['aired']} · {total['bad']}** | | **{total['with_aired']}** |"
    )
    return rows, dict(total)


def _persona_rows(ev: Evidence, controls: list[Outcome]) -> list[str]:
    rows = ["| persona | language | perturbed lines | kept off with the Verifier | aired "
            "without it | unperturbed lines passed (both pipelines) |",
            "|---|---|---:|---:|---:|---:|"]  # fmt: skip
    for persona in ev.personas:
        for lang in ev.languages:
            os_ = [o for o in ev.outcomes if o.persona == persona and o.language == lang]
            cs = [o for o in controls if o.persona == persona and o.language == lang]
            ok = sum(o.with_verifier.airs and o.without_verifier.airs and
                     not o.without_verifier.error for o in cs)  # fmt: skip
            rows.append(
                f"| {persona} | {lang} | {len(os_)} | "
                f"{sum(not o.with_verifier.airs for o in os_)} | "
                f"{sum(o.without_verifier.airs for o in os_)} | {ok}/{len(cs)} |"
            )
    return rows


def _draft_rows(ev: Evidence) -> list[str]:
    rows = ["| lines | structure | persona | language | scripts | lines drafted | dropped by "
            "tidy: forbidden · repeats | the Verifier's line check rejects | scripts breaking "
            "the persona's rules | repair adds · cuts | without a Verifier: aired · with a "
            "violation · wrong ids and numbers | with it: aired · failing |",
            "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]  # fmt: skip
    keys = sorted({(d.lines, d.structure, d.persona, d.language) for d in ev.drafts},
                  key=lambda k: (k[0], k[1], PERSONAS.index(k[2]), k[3]))  # fmt: skip
    for lines, structure, persona, lang in keys:
        ds = [d for d in ev.drafts if (d.lines, d.structure, d.persona, d.language)
              == (lines, structure, persona, lang)]  # fmt: skip

        def t(f: str, ds: list[DraftRow] = ds) -> int:
            return sum(getattr(d, f) for d in ds)

        kinds = sum((d.kinds for d in ds), Counter())
        named = ", ".join(f"{k} ×{n}" for k, n in kinds.most_common())
        rejected = f"{t('rejected')}" + (f" ({named})" if kinds else "")
        rows.append(
            f"| {lines.replace('_', ' ')} | {structure} | {persona} | {lang} | {len(ds)} | "
            f"{t('drafted')} | {t('forbidden')} · {t('repeats')} | {rejected} | "
            f"{sum(d.problems > 0 for d in ds)} | {t('added')} · {t('cut')} | "
            f"{t('aired_without')} · {t('violations_without')} · {t('wrong_without')} | "
            f"{t('aired_with')} · {t('violations_with')} |"
        )
    return rows


def _timed_rows(ev: Evidence) -> list[str]:
    rows = ["| run | step timeout | scripts | model requests | most calls at once | roles from "
            "the model, of 4 | Telestrator lane | narration lane | lanes overlapped | breakdown |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]  # fmt: skip
    for t in ev.timed:
        name = ("crew, one model call at a time" if t.serial else
                "single agent" if t.structure == "single" else "crew, as deployed")  # fmt: skip
        lanes = ("– | – | –" if t.structure == "single" else
                 f"{_s(t.telestrator_s)} | {_s(t.narration_s)} | {_s(t.overlap_s)}")  # fmt: skip
        lanes = f"{t.from_model} | {lanes}"
        name = f"{name} | {t.timeout_s:g} s"
        rows.append(
            f"| {name} | {t.scripts} | {t.requests} | {t.peak} | {lanes} | {_s(t.wall_s)} |"
        )
    return rows


def report(ev: Evidence) -> str:
    import platform
    import sys

    single_faults = [r for r in ev.drills if r.structure == "single" and len(r.fault) == 1]
    crew_drills = [r for r in ev.drills if r.structure == "crew"]
    crew_one = [r for r in ev.drills if r.structure == "crew" and len(r.fault) == 1]
    crew_all = [r for r in ev.drills if r.structure == "crew" and r.fault == AGENTS]
    lines, numbers, unverified = ev.aired
    outcome_rows, total = _outcome_rows(ev)
    controls = ev.controls
    control_ok = sum(o.with_verifier.airs and not o.without_verifier.error for o in controls)
    chains, claim_chains = ev.chains, [c for c in ev.chains if c.picked_by != "connective"]
    cut = sum(c.tools == "cut" for c in chains)
    by_pick = Counter(c.picked_by for c in chains)
    fuzz_tried, fuzz_rej = sum(f.tried for f in ev.fuzz), sum(f.rejected for f in ev.fuzz)
    anchored = [d for d in ev.drafts if d.lines == "anchored"]
    free = [d for d in ev.drafts if d.lines == "free_text"]
    free_by = {s: [d for d in free if d.structure == s] for s in STRUCTURES}
    rec = {(r.structure, r.fault): r for r in ev.recovery}
    crew_t, serial_t, single_t = ev.timed[0], ev.timed[1], ev.timed[2]
    single_8 = ev.timed[3]
    fan = ev.timed[4:]
    one, ten = fan[0], fan[-1]
    q = quote_lines()

    def back_cost(agent: str) -> str:
        rs = [r for r in crew_one if r.fault == (agent,)]
        req = sorted({r.backs[0].requests for r in rs})
        return "/".join(str(x) for x in req)

    out = [
        "# Why a crew — what the multi-agent architecture buys (SPEC 6)",
        "",
        "Offline: no model call. A scripted model (`ScriptedModel` in eval/crew_evidence.py) "
        "answers every agent with the choices its deterministic template makes, through "
        "Microsoft Agent Framework, the role's structured-output schema and the crew's own code, "
        "as a model's reply would; the single agent is eval/single_agent.py, given the same "
        "replies in one call. Sample: the "
        f"{len(ev.moments)} hero moments the site serves ({', '.join(f'`{m}`' for m in ev.moments)}), "  # noqa: E501
        f"each for every persona × language ({len(ev.personas)} × {len(ev.languages)} = "
        f"{len(ev.personas) * len(ev.languages)} scripts per breakdown). "
        f"Platform: {platform.system()} {platform.machine()}, Python "
        f"{sys.version.split()[0]}; the committed report is generated in python:3.11-slim, as "
        "the live API computes. Everything is deterministic except the wall times of section 4.",
        "",
        "## Headline",
        "",
        f"- **Fault tolerance.** With any one of the four agents down, "
        f"{sum(r.delivered for r in crew_one)}/{sum(r.asked for r in crew_one)} scripts still "
        f"aired in {len(crew_one)} drills ({len(ev.moments)} moments × 4 agents), every plan "
        f"valid, and the crew kept 3 of its 4 roles on the model; the single agent, whose one "
        f"call does all four jobs, kept 0 of 4 in each of its {len(single_faults)} drills. With "
        f"all four down, {sum(r.delivered for r in crew_all)}/{sum(r.asked for r in crew_all)} "
        f"scripts aired on templates. Of {numbers} numbers aired across {lines} lines (every "
        f"fault-free run and drill, both structures), {len(unverified)} were not a verified "
        "slot's value.",
        f"- **Recovery.** Bringing an agent back from its checkpoint runs again only the steps "
        f"that read its output, and gave the fault-free breakdown in "
        f"{sum(r.recovered for r in ev.drills)}/{len(ev.drills)} drills. The Telestrator "
        f"comes back with {back_cost('telestrator')} model request and narration with "
        f"{back_cost('narration')} (two per script); the Analyst and the Director re-run "
        f"everything after them ({back_cost('analyst')} and {back_cost('director')} requests "
        f"for {len(ev.personas) * len(ev.languages)} scripts). At Foundry's median latencies "
        f"(4 scripts), the Telestrator is back in {_s(rec[('crew', 'telestrator')].back_s)}, "
        f"narration in {_s(rec[('crew', 'narration')].back_s)}, the Analyst in "
        f"{_s(rec[('crew', 'analyst')].back_s)} and the Director in "
        f"{_s(rec[('crew', 'director')].back_s)}"
        + "; the single agent's only way back is its whole call, "
        f"{_s(rec[('single', 'telestrator')].back_s)} with crew_vs_single's "
        f"{SINGLE_TIMEOUT_S:g} s timeout (under the deployed {DEFAULT_TIMEOUT_S:g} s step "
        "timeout it times out again and never comes back).",
        f"- **Verification by construction.** No field a model writes in its own words accepts "
        f"a number ({fuzz_rej}/{fuzz_tried} injected numbers rejected), and a narration line can "
        f"only be a verified claim id or a connective. Of {total['n']} perturbed lines "
        f"({len([k for k in PERTURBATIONS if any(o.kind == k for o in ev.outcomes)])} kinds: a "
        "number or a player written by the model, an unbacked term, a broken placeholder, an "
        "unknown or forbidden claim, a claim tampered with after verification), "
        f"{total['n'] - total['with_aired']} were kept off the air with the Verifier "
        f"({total['tidy']} by tidy, {total['verifier']} by the Verifier); without it "
        f"{total['aired']} aired, every one breaking a Verifier rule: {total['false']} false (a "
        f"wrong number or player, a refuted claim), {total['unverified']} unverified, "
        f"{total['garbled']} garbled, {total['true, model-written']} true but written by the "
        "model. On the cached "
        f"Foundry drafts (gpt-4.1-mini, {ev.cache.date}), today's Verifier rejects "
        f"{sum(d.rejected for d in anchored)} of {sum(d.aired_without for d in anchored)} "
        "anchored lines; of the free-text drafts, "
        f"{sum(d.violations_without for d in free)} of {sum(d.aired_without for d in free)} "
        f"lines would air with a violation without it ("
        + " and ".join(
            f"{sum(d.wrong_without for d in free_by[k])} wrong ids and numbers from the {k}"
            for k in STRUCTURES
        )
        + "), 0 with it.",
        f"- **Auditability.** {_pct(sum(c.linked for c in chains), len(chains))} aired lines "
        "trace to verified claims with an audit record, the voice call that chose them, the "
        f"Verifier round that passed them and their voice cue; "
        f"{_pct(sum(s.complete for s in ev.steps), len(ev.steps))} step records hold their "
        "times, messages, writes, reads and model calls. The Analyst picked the claims of "
        f"{by_pick['analyst']} lines and the voices {by_pick['voice']} more from the other "
        f"verified claims. Gap found: the trace keeps 4,000 characters of a tool result, so for "
        f"{cut} of {len(claim_chains)} claim lines the stored `list_claims` result no longer "
        "names the claim.",
        f"- **Parallelism, not speed.** The Telestrator and narration overlapped for "
        f"{_s(crew_t.overlap_s)}, and every audience's voices run at once: narration took "
        f"{_s(ten.narration_s)} for {ten.scripts} scripts and {_s(one.narration_s)} for "
        f"{one.scripts}, while model requests grew {one.requests} → {ten.requests}. One call at "
        f"a time, the same breakdown takes {_s(serial_t.wall_s)} instead of {_s(crew_t.wall_s)}. "
        f"But the crew is not faster than one agent: {_s(crew_t.wall_s)} vs "
        f"{_s(single_t.wall_s)} here (the single agent given {single_t.timeout_s:g} s, as in "
        "crew_vs_single), and on Foundry crew_vs_single measured 13.8 vs 14.4 s. What the "
        f"short steps buy is the deployed {DEFAULT_TIMEOUT_S:g} s step timeout: the single "
        "agent's median call is longer, so under it the call times out twice and the breakdown "
        f"airs on templates after {_s(single_8.wall_s)} ({single_8.from_model} of 4 roles from "
        "the model).",
        "- **What it does not buy.** On Foundry the crew wrote no better than one agent (same "
        "wrong facts, 0, and groundedness, 5.00), at about six times the requests and twice the "
        "cost; with free text its separate voices wrote more wrong facts, not fewer "
        "(section 5).",
        "",
        "## 1. Fault tolerance",
        "",
        "Each agent taken down in turn, then all four, on every moment, through the Producer "
        "desk's failure drill (`run_crew(down=...)`, checkpointed in memory): a downed agent's "
        "calls raise as in an outage, it retries once and runs on its template, and a workflow "
        "request waits for it. Then every waiting step is brought back in the graph's order "
        "(`run_crew(bring_back=...)`) until none waits. *Scripts aired*: scripts with at least one "
        "aired line, of those asked. *Roles from the model*: of Director, Analyst, Telestrator "
        "and narration, those whose part came from the model. *Numbers aired · unverified*: each "
        "cited claim verified again against the event store and its sentence rendered; a number "
        "in an aired line must be one of its claims' numbers. *The fault-free breakdown*: the "
        "request, findings, plan and every script's lines equal a run with nothing down.",
        "",
        *_drill_table(ev),
        "",
        f"Fault-free, a breakdown of {len(ev.personas) * len(ev.languages)} scripts makes "
        f"{statistics.mean(n.requests for n in ev.normals if n.structure == 'crew'):.0f} model "
        "requests in the crew (Director, Analyst, Telestrator, two voices per script) and "
        f"{statistics.mean(n.requests for n in ev.normals if n.structure == 'single'):.0f} in "
        "the single agent. The single agent's one call is made by its first step, so a drill "
        "always leaves that step (`director`) waiting, whichever role was taken down.",
        "",
        "Every drill's crew trace records the drill: "
        f"{sum(_recorded(r) for r in crew_drills)}/{len(crew_drills)} crew drills have a "
        "`down`, a "
        "`fallback` and a `waiting` event for every agent taken down, "
        f"{sum(r.checkpoints > 0 for r in ev.drills)}/{len(ev.drills)} drills saved checkpoints "
        f"({_range(r.checkpoints for r in ev.drills)} per run), and "
        f"{sum(r.back_events for r in ev.drills)}/"
        f"{sum(len(r.backs) for r in ev.drills)} bring-backs have a `back` event naming the "
        "checkpoint they resumed from.",
        "",
        "### What a viewer gets through the API",
        "",
        "The API in-process (`api.main.create_app`) with the scripted model, a per-client limit "
        "of 2 per 10 minutes and a daily cap of 4 model runs, for one moment "
        f"(`{LADDER_MATCH[0]}-{LADDER_MATCH[1]}`), one persona and language per request as the "
        "web app asks; then, on a fresh day, the model service down (every call fails). "
        "*Provenance* is what the web shows (`live`: the crew ran for this request; `cached`; "
        "`template`: no model call, and why).",
        "",
        *_ladder_table(ev),
        "",
        "Every request was answered with a verified breakdown. **Finding:** in a model outage "
        "the crew airs on templates, but the API stores that run under the model's cache key "
        "and labels it `live`, then `cached`; only the per-step sources (the Producer desk, the "
        "crew trace) show that no agent reached the model. `infra.prewarm` reports such views "
        "as degraded and `--regenerate-degraded` runs them again.",
        "",
        "### Time to recover",
        "",
        "Each model call takes its role's median Foundry latency (section 4), for the API's "
        "default audiences (casual, analyst × en, zh). *Drill airs*: the run with the agent "
        "down; *bring-back*: until the revised breakdown is out.",
        "",
        "| structure | step timeout | agent down | drill airs in | bring-back | its model "
        "requests | roles from the model after it | a fault-free breakdown from scratch |",
        "|---|---:|---|---:|---:|---:|---:|---:|",
        *[
            f"| {r.structure} | {r.timeout_s:g} s | "
            f"{r.fault if r.structure == 'crew' else 'any (one call)'} | {_s(r.drill_s)} | "
            f"{_s(r.back_s)} | {r.requests} | {r.from_model} | {_s(r.fresh_s)} |"
            for r in ev.recovery
        ],  # fmt: skip
        "",
        "The single agent is timed with crew_vs_single's 30 s timeout: its median call (a tool "
        f"round and its reply) is longer than the deployed {DEFAULT_TIMEOUT_S:g} s step timeout, "
        "so under that timeout it would never come back.",
        "",
        "## 2. Verification by construction",
        "",
        "### What a model can write",
        "",
        "Every field of a model's reply that is not an enum, given text with a number "
        f"({', '.join(f'“{t}”' for t in INJECTED)}): the reason and the angle reject it "
        "(`no_numbers`, the Verifier's own number detector); a narration line is a claim id or "
        "a connective from enums, so any other text is rejected.",
        "",
        "| field | numbers tried | rejected |",
        "|---|---:|---:|",
        *[f"| `{f.field}` | {f.tried} | {f.rejected} |" for f in ev.fuzz],
        "",
        f"Every number that reached the air: {numbers} numbers in {lines} aired lines, "
        f"{len(unverified)} not a verified slot's value; the Directors' reasons and Analysts' "
        f"angles in those breakdowns hold {ev.free_text_digits} numbers.",
        "",
        "### Perturbed lines, with the Verifier and without it",
        "",
        "Every aired line of the crew's fault-free runs, perturbed as a model writing its own "
        "words, a bug or a tampered claim store could make it, then through the shipped gates "
        "(tidy, then the Verifier step's line check, `agents.workflow.Verifier._check`) and "
        "through tidy alone, as crew_vs_single's single agent without a Verifier airs it (its "
        "arm A). *A Verifier rule*: what its line check rejects. *What those lines say*, by "
        "construction: false (a wrong number or player, or a claim its evidence refutes), "
        "unverified (a statement no claim backs), garbled (raw placeholder braces), or true but "
        "written by the model. With anchored outputs a model cannot "
        "write any of these: the text is composed by code from verified templates. They are what "
        "the Verifier is for when that construction is broken: free-text lines, a prompt or code "
        "regression, a claim store changed after verification.",
        "",
        *outcome_rows,
        "",
        f"The same lines unperturbed: {_pct(control_ok, len(controls))} air through both "
        "pipelines with no violation, so the Verifier raised no false alarm.",
        "",
        *_persona_rows(ev, controls),
        "",
        "### Foundry drafts, checked again by today's code",
        "",
        f"The first drafts of crew_vs_single's fault-free runs ({ev.cache.model} on Microsoft "
        f"Foundry, {ev.cache.date}; eval/fixtures/crew_vs_single_cache.json, "
        f"{len(ev.cache.runs)} runs): anchored drafts composed again from the claim ids and "
        "connectives the model chose; free-text drafts as the model wrote them. Then today's "
        "tidy, the Verifier's line check, its persona-rule check (a script breaking it goes back "
        "to both voices) and the repair after the last rewrite (no rewrite is run here: no model "
        "call). The drafts predate the persona rules (agents/persona_rules.py), so the scripts "
        "breaking them and the lines repair adds reflect rules added since, not the model.",
        "",
        *_draft_rows(ev),
        "",
        f"Numbers the model wrote in its own words in those runs' replies: "
        f"{sum(v for r in ev.cache.runs if r['lines'] == 'anchored' for v in r['digits_in_replies'].values())}"  # noqa: E501
        " in the anchored runs, "
        f"{sum(v for r in ev.cache.runs if r['lines'] == 'free_text' for v in r['digits_in_replies'].values())}"  # noqa: E501
        " in the free-text runs (counted by crew_vs_single in the reason, angle and line text of "
        "every reply).",
        "",
        "## 3. Auditability",
        "",
        "The crew with the Analyst on our MCP server (`use_mcp`, stdio, as the deployed API runs "
        "it; the scripted Analyst calls `get_moment` and `list_claims`, then answers), every "
        "moment, every persona × language. Each aired line is traced through the crew trace "
        "(agents/crewtrace.py) and the breakdown it is stored with.",
        "",
        "| link | aired lines with it |",
        "|---|---:|",
        f"| every cited claim supported, unchanged since its verdict, with an audit record of it | "
        f"{_pct(sum(c.verified for c in chains), len(chains))} |",
        f"| the call of the voice that wrote it (speaker, persona, language) on the narration "
        f"step | {_pct(sum(c.voice_call for c in chains), len(chains))} |",
        f"| passed by the last Verifier round | {_pct(sum(c.approved for c in chains), len(chains))} |",  # noqa: E501
        f"| a voice cue | {_pct(sum(c.cue for c in chains), len(chains))} |",
        f"| **all of the above** | **{_pct(sum(c.linked for c in chains), len(chains))}** |",
        f"| claim lines whose claims a stored MCP tool result names | "
        f"{_pct(sum(c.tools == 'named' for c in claim_chains), len(claim_chains))} |",
        f"| claim lines whose claim the trace cut from the stored result (4,000 characters) | "
        f"{_pct(sum(c.tools == 'cut' for c in claim_chains), len(claim_chains))} |",
        "",
        f"Who chose what aired: the Analyst's findings hold the claims of {by_pick['analyst']} "
        f"lines; the voices picked {by_pick['voice']} more from the other verified claims "
        f"their prompts offer; {by_pick['connective']} are "
        f"connectives. The Analyst's tool calls: "
        f"{', '.join(f'`{k}` ×{v}' for k, v in sorted(ev.tools_called.items()))}.",
        "",
        f"Step records: {_pct(sum(s.complete for s in ev.steps), len(ev.steps))} have their "
        "start and end, the message they handled and those they sent, the shared state they "
        "wrote (`request`, `findings`, `plan`, `drafts`, `verdicts` or `scripts`, `voice`), and "
        "for the four agents the evidence they read and their model calls. Missing: "
        f"{_list(sorted({m for s in ev.steps for m in s.missing}))}. Span ids are empty offline "
        "(no telemetry exporter); deployed, each step's span is in Application Insights.",
        "",
        "The single agent's breakdowns traced the same way: "
        f"{_pct(sum(c.voice_call for c in ev.single_chains), len(ev.single_chains))} of its "
        "aired lines have a call of their own voice on the trace. Its one call writes all four "
        "parts, recorded on its first step; which part of the reply a line came from is not a "
        "separate record, and a part that fails takes the others with it (section 1).",
        "",
        "## 4. Parallelism and latency",
        "",
        "Every model call takes its role's median request latency on Foundry, from "
        f"crew_vs_single's fault-free anchored runs ({ev.cache.model}, {ev.cache.date}): "
        + ", ".join(
            f"{k.replace('_tool', ' (tool round)')} {v / 1000:.2f} s (n = {ev.cache.latency_n[k]})"
            for k, v in ev.cache.latency_ms.items()
        )
        + ". The Analyst's call is its tool round and its answer (at high priority it has "
        "the MCP tools), and so is the single agent's. Times are wall time of the real "
        f"workflow with these latencies{'' if ev.scale == 1 else f' ÷ {ev.scale:g}, reported × {ev.scale:g}'}; "  # noqa: E501
        "they include the crew's own code and vary a little from run to run. One moment "
        f"(`{ev.moments[0]}`). The crew runs with the deployed {DEFAULT_TIMEOUT_S:g} s step "
        f"timeout; one call at a time and the single agent get crew_vs_single's "
        f"{SINGLE_TIMEOUT_S:g} s, since a queued or a long call would otherwise time out, except "
        "in the last single-agent row, which shows what that timeout does to it.",
        "",
        *_timed_rows(ev),
        "",
        "The critical path is Director → Analyst → the slower of the two lanes (the Telestrator, "
        "or narration: the play-by-play, then the co-commentator who replies to it) → Verifier "
        "→ Voice. Adding audiences adds two requests each, not time; one call at a time adds "
        "every call's latency. The single agent's one call is about as long as the crew's "
        "critical path, so the crew is not faster: its steps are short (each under the "
        "deployed 8 s step timeout; the single call is not, as its row with that timeout shows and "
        "crew_vs_single measured), which is what the per-step timeout and the failure policy "
        "rely on.",
        "",
        "## 5. What this does not show",
        "",
        "eval/reports/crew_vs_single.md (Foundry, six moments, four audiences) found:",
        "",
        f"- Narration quality: “{QUOTES['quality']}” and “{QUOTES['headline']}” (line "
        f"{q['quality']}), “{QUOTES['not_better']}” (line {q['not_better']}).",
        f"- Verification, not collaboration, keeps wrong facts off the air: “{QUOTES['wrong_facts']}”,"  # noqa: E501
        f" “{QUOTES['rejected']}” (line {q['rejected']}); with free text, “{QUOTES['free_text']}”, "
        f"“{QUOTES['not_collaboration']}” (line {q['not_collaboration']}).",
        f"- Cost and speed: “{QUOTES['cost']}”, “{QUOTES['seconds']}” (line {q['cost']}).",
        f"- Recovery is not always cheaper: for the Analyst, “{QUOTES['analyst_back']}” (line "
        f"{q['analyst_back']}), more than re-running the single agent; here "
        f"{back_cost('analyst')} for {len(ev.personas) * len(ev.languages)} scripts.",
        f"- Short steps fit the deployed timeout: “{QUOTES['timeouts']}” (line {q['timeouts']}).",
        f"- A real failure the crew isolated: the Analyst's `angle` “{QUOTES['angle']}” (line "
        f"{q['angle']}): the crew lost that role only, the single agent all four.",
        "",
        "So the crew's case rests on isolation, recovery, a separate gate and a trace per role, "
        "measured above, not on better lines. The scripted model also means sections 1–4 test "
        "the architecture's guarantees, not a model's failure modes: a real model fails in "
        "other ways (a slow reply, a reply its schema rejects), which crew_vs_single sampled on "
        "Foundry. The Verifier rejected no anchored line there or here; its value shows when the "
        "construction around it is broken.",
        "",
        "## Method",
        "",
        "- **Scripted model.** `agents.testing.ToolCallingFakeChatClient` routed by each "
        "agent's `ROLE:` line: the Director answers the priority rule on the lens delta "
        "(`fallbacks.priority_for`) with a reason with no number; the Analyst the template "
        "findings (at most 6 supporting claims, as its schema allows); the Telestrator the "
        "template plan; each voice its template lines for the persona and language its prompt "
        "names, as anchored lines (a claim id and/or a connective). The single agent answers all "
        "of that in one reply (eval/single_agent.py, with the shipped Verifier). Every reply "
        "goes through Agent Framework's structured output parsing and the crew's code.",
        "- **Faults.** `run_crew(down=...)`: the downed agent's chat client is "
        "`agents.llm.Outage`. A model outage (`ScriptedModel(outage=True)`) makes every call "
        "raise instead.",
        "- **Gates.** With the Verifier: `agents.workflow.tidy`, then "
        "`agents.workflow.Verifier._check` (persona, render check: numbers, entities, "
        "placeholders, lexicon, banned words, unsupported and stale claims). Without: tidy, then "
        "the line as it would air, placeholders filled where they resolve "
        "(`eval.narration_ablation.preview`), judged by the same rules.",
        "- **Cached drafts.** `--extract-cache` rebuilds the fixture from crew_vs_single's run "
        "records (`out/crew_vs_single/runs/`).",
        "",
        "## Limitations",
        "",
        "- The scripted model always answers, and always validly, so the fault-free runs have no "
        "rewrites; Verifier rewrites on real model output are in crew_vs_single and "
        "eval/narration_ablation.py.",
        "- The cached drafts are from before the persona rules and before later sim changes on "
        "main; a claim today's evidence no longer supports would be counted as such (none was).",
        "- The perturbation suite is ours; it covers the error classes the Verifier's rules "
        "name, not every way a sentence can be wrong (grammar, a true number in the wrong role).",
        "- Latencies are medians from one day's runs; the single agent's call grows with the "
        "number of scripts it writes, so it is timed for the default four only.",
        "",
    ]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--out", type=Path, default=REPORTS / "crew_evidence.md")
    p.add_argument(
        "--scale",
        type=float,
        default=SCALE,
        help="divide model latencies by this while timing (reported × it)",
    )
    p.add_argument(
        "--moments", default="", help="scenario:seed,… (default: every hero moment the site serves)"
    )
    p.add_argument(
        "--extract-cache",
        type=Path,
        metavar="RUNS_DIR",
        help="rebuild the fixture from crew_vs_single's run records, then stop",
    )
    a = p.parse_args(argv)
    if a.extract_cache:
        CACHE_FIXTURE.write_text(json.dumps(extract_cache(a.extract_cache), ensure_ascii=False,
                                            indent=1) + "\n")  # fmt: skip
        print(f"wrote {CACHE_FIXTURE}")
        return
    moments = served_moments()
    if a.moments:
        moments = [(s, int(n)) for s, _, n in (m.partition(":") for m in a.moments.split(","))]
    ev = asyncio.run(evaluate(moments, scale=a.scale))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(report(ev))
    print(f"wrote {a.out} in {ev.seconds:.0f} s")


if __name__ == "__main__":
    main()
