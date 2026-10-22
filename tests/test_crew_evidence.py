"""Acceptance checks for the crew-evidence eval (SPEC 6, Best Multi-Agent System).

eval/crew_evidence.py measures what the crew's architecture buys, offline: what still airs with an
agent down and what bringing it back re-runs, what the Verifier keeps off the air, whether every
aired line traces back to its claims and the agent that chose it, and what running the two lanes
at once saves. Each check below is one claim its report makes, on the flagship hero moment; the
eval itself runs them on every hero moment the site serves.
"""

import asyncio
import dataclasses
import re
from pathlib import Path

import pytest
from agent_framework import InMemoryCheckpointStorage

from agents.context import MomentContext
from agents.schemas import DirectorChoice, analyst_model, anchored_draft_model
from agents.workflow import AGENTS, run_crew
from eval import crew_evidence as ce

ALL = ("casual", "analyst", "player_fan", "coach", "audio_description")
LANGS = ("en", "zh")


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", 3)


@pytest.fixture(scope="module")
def normal(ctx):
    model = ce.ScriptedModel(ce.replies(ctx))
    run = asyncio.run(run_crew(ctx, client=model, personas=ALL, languages=LANGS))
    return run, model.requests


def test_the_served_hero_moments_are_the_sample():
    """Every hero moment the site serves (its standalone heroes and those of its stitched
    matches), once each, in a fixed order."""
    assert ce.served_moments() == [
        ("blind_side_run", 3), ("corner_blind_side", 0), ("press_escape", 0),
        ("far_post_finish", 11), ("press_escape", 1), ("corner_blind_side", 2),
        ("blind_side_run", 11),
    ]  # fmt: skip


def test_the_scripted_model_answers_every_role_as_a_model_would(ctx, normal):
    """Through Agent Framework and the role's own schema: every agent step is from the model,
    the plan is the agent's, nothing is rewritten or dropped, and every number aired is verified."""
    run, requests = normal
    r = run.result
    assert {s.step: s.source for s in r.trace} == {
        "director": "llm", "analyst": "llm", "telestrator": "llm", "narration": "llm",
        "verifier": "code", "voice": "code",
    }  # fmt: skip
    assert r.plan_source == "agent" and run.pending == []
    assert {(s.persona, s.language) for s in r.scripts} == {(p, lg) for p in ALL for lg in LANGS}
    assert all(s.rewrites == 0 and not s.dropped and s.lines for s in r.scripts)
    assert requests == 3 + 2 * len(ALL) * len(LANGS)  # director, analyst, telestrator, 2 voices
    numbers, unverified = ce.aired_numbers(ctx, r.scripts)
    assert numbers > 0 and unverified == []


def test_the_aired_number_check_flags_a_number_the_model_wrote(ctx, normal):
    """The check is independent of the Verifier: it re-renders the cited claims' verified
    sentences and accepts only their numbers."""
    script = normal[0].result.scripts[0]
    line = script.payload.lines[-1]
    planted = line.model_copy(update={"text": line.text + " It was the 89th minute."})
    bad = script.model_copy(
        update={"payload": script.payload.model_copy(update={"lines": [planted]})}
    )
    assert ce.aired_numbers(ctx, [bad])[1] == ["89"]


@pytest.mark.parametrize("agent", AGENTS)
def test_one_agent_down_still_airs_and_comes_back_to_the_same_breakdown(ctx, normal, agent):
    """With one agent down the breakdown still airs, verified, with the other three agents' work
    from the model; the downed agent waits. Bringing it back re-runs only the steps that read its
    output, and the breakdown is then the one a fault-free run makes."""
    row = asyncio.run(ce.drill(ctx, "crew", (agent,), ALL, LANGS, normal=normal[0].result))
    assert row.delivered == row.asked == len(ALL) * len(LANGS)
    assert row.plan_valid and row.unverified == [] and row.numbers > 0
    assert row.from_model == [a for a in AGENTS if a != agent]
    assert row.pending == [agent]
    assert [e for e in row.events if e[1] == agent] == [
        ("down", agent),
        ("fallback", agent),
        ("waiting", agent),
    ]
    (back,) = row.backs
    voices = 2 * len(ALL) * len(LANGS)
    rerun = {
        "director": ["director", "analyst", "telestrator", "narration", "verifier", "voice"],
        "analyst": ["analyst", "telestrator", "narration", "verifier", "voice"],
        "telestrator": ["telestrator", "voice"],
        "narration": ["narration", "verifier", "voice"],
    }[agent]
    requests = {"director": 3 + voices, "analyst": 2 + voices, "telestrator": 1,
                "narration": voices}[agent]  # fmt: skip
    assert back.step == agent and sorted(back.reran) == sorted(rerun)
    assert back.requests == requests and back.pending == []
    assert row.recovered  # equal to the fault-free breakdown


def test_every_agent_down_still_airs_the_templates(ctx, normal):
    row = asyncio.run(ce.drill(ctx, "crew", AGENTS, ALL, LANGS, normal=normal[0].result))
    assert row.delivered == row.asked and row.unverified == [] and row.from_model == []
    assert row.pending == list(AGENTS)
    assert row.recovered and [b.step for b in row.backs] == list(AGENTS)


def test_the_single_agent_loses_every_role_with_any_one_down(ctx):
    """One call does the four jobs: any role down takes the call down, so the breakdown airs on
    templates only. Bringing it back is one request that re-runs everything."""
    model = ce.ScriptedModel(ce.replies(ctx))
    base = asyncio.run(run_crew(ctx, client=model, personas=ALL, languages=LANGS,
                                story=ce.story("single")))  # fmt: skip
    assert model.requests == 1 and base.result.plan_source == "agent"
    row = asyncio.run(ce.drill(ctx, "single", ("telestrator",), ALL, LANGS, normal=base.result))
    assert row.delivered == row.asked and row.unverified == []
    assert row.from_model == [] and row.pending == ["director"]  # the step that makes the call
    (back,) = row.backs
    assert back.requests == 1 and row.recovered


def test_a_model_outage_is_survived_by_every_step(ctx):
    """The model service itself fails (every call raises): each agent retries once, then runs on
    its template, and the breakdown airs verified."""
    model = ce.ScriptedModel(ce.replies(ctx), outage=True)
    run = asyncio.run(run_crew(ctx, client=model, personas=("casual",), languages=("en",),
                               checkpoints=InMemoryCheckpointStorage()))  # fmt: skip
    assert all(s.source in ("template", "code") for s in run.result.trace)
    assert ce.in_order(run.pending) == list(AGENTS) and run.result.scripts[0].lines
    assert ce.aired_numbers(ctx, run.result.scripts)[1] == []
    assert model.requests == 2 * (3 + 2)  # every call and its retry


def test_free_text_fields_reject_any_number():
    """The only fields a model writes in its own words (the Director's reason, the Analyst's angle)
    reject a number in any of its forms; a narration line can only be a verified claim id or an
    allowed connective."""
    rows = ce.fuzz_schemas(["scan_before_reception", "cf_pass"])
    assert {r.field for r in rows} == {"director.reason", "analyst.angle", "narration.claim",
                                       "narration.connective"}  # fmt: skip
    assert all(r.rejected == r.tried > 0 for r in rows)
    DirectorChoice(priority="high", reason=ce.REASON)  # the scripted texts themselves pass
    analyst_model(["cf_pass"])(lens="scan", headline=["cf_pass"], supporting=[], angle=ce.ANGLE)
    anchored_draft_model(["cf_pass"], "en")(lines=[{"claim": "cf_pass", "connective": None}])


@pytest.mark.parametrize("kind", ce.PERTURBATIONS)
def test_the_verifier_catches_each_perturbation_that_airs_without_it(ctx, normal, kind):
    """A line as a model writing its own words, a bug or a tampered claim store could make it:
    with the Verifier it never airs; without it, it airs unless tidy (shared by both) drops it.
    The same lines unperturbed pass both: no false alarm."""
    scripts = normal[0].result.scripts
    outcomes = ce.perturbations(ctx, scripts, kinds=(kind,))
    assert outcomes, kind
    for o in outcomes:
        assert not o.with_verifier.airs, (kind, o)
        assert o.without_verifier.airs != (o.without_verifier.stage == "tidy"), o
    without = [o for o in outcomes if o.without_verifier.airs]
    if kind == "forbidden_claim":
        assert without == []  # tidy drops it in both structures
    else:
        assert without and all(o.without_verifier.error for o in without), kind
    controls = ce.perturbations(ctx, scripts, kinds=("none",))
    assert controls and all(o.with_verifier.airs and o.without_verifier.airs for o in controls)


def test_a_tampered_claim_airs_its_false_value_without_the_verifier(ctx, normal):
    (o, *_) = ce.perturbations(ctx, normal[0].result.scripts, kinds=("claim_tampered",))
    assert o.with_verifier.stage == "verifier" and "stale_claim" in o.with_verifier.kinds
    assert o.without_verifier.airs and o.without_verifier.text != o.original


def test_every_aired_line_traces_to_its_claims_tools_and_agent(ctx):
    """With the Analyst on our MCP server: every aired line traces to verified claims with an
    audit record, the Analyst's tool results, the voice call that chose it, the Verifier round
    that passed it and its voice cue."""
    run = asyncio.run(ce.mcp_run(ctx, ("casual", "analyst"), LANGS))
    chains = ce.trace_lines(ctx, run)
    assert chains and all(c.linked for c in chains), [c for c in chains if not c.linked]
    assert any(c.complete for c in chains if c.picked_by != "connective")
    # A claim not found in the tool results is one the trace cut: it keeps the first
    # MAX_RESULT characters of each result (a finding the report states).
    tools = next(s for s in run.trace.steps if s.step == "analyst").tools
    assert all(c.tools in ("named", "cut") for c in chains)
    if any(c.tools == "cut" for c in chains):
        assert any(t.truncated for t in tools)
    assert {c.picked_by for c in chains} <= {"analyst", "voice", "connective"}
    steps = ce.step_fields(run.trace)
    assert steps and all(s.complete for s in steps), [s for s in steps if not s.complete]
    assert [t.name for t in tools] == ["get_moment", "list_claims"]
    # A broken link is caught: drop the voice calls from the trace.
    broken = run.trace.model_copy(deep=True)
    for s in broken.steps:
        if s.step == "narration":
            s.calls = []
    cut = dataclasses.replace(run, trace=broken)
    assert not any(c.linked for c in ce.trace_lines(ctx, cut))


def test_the_two_lanes_overlap_and_more_audiences_cost_requests_not_time(ctx):
    """With every model call taking time, the Telestrator and narration run at once, and the
    voices of every audience run at once: ten scripts take about as long as one, while the model
    requests grow by two per script. One call at a time takes much longer."""
    latency = {role: 0.1 for role in ("director", "analyst", "telestrator", "pbp", "color")}
    one = asyncio.run(ce.timed(ctx, ("casual",), ("en",), latency, scale=1.0))
    ten = asyncio.run(ce.timed(ctx, ALL, LANGS, latency, scale=1.0))
    serial = asyncio.run(ce.timed(ctx, ("casual", "analyst"), LANGS, latency, scale=1.0,
                                  serial=True))  # fmt: skip
    assert one.overlap_s > 0 and ten.overlap_s > 0
    assert ten.requests - one.requests == 2 * (10 - 1)
    assert ten.narration_s < 2 * one.narration_s  # twenty calls, two calls' time
    assert ten.peak >= 2 * 5 and one.peak == 2  # all first voices, and the plan, at once
    assert serial.wall_s > 2 * one.wall_s


def test_cached_foundry_drafts_are_rescored_by_todays_verifier():
    """The crew-vs-single cache (gpt-4.1-mini on Foundry): anchored drafts are claim ids, so
    today's Verifier finds no wrong fact in them; free-text drafts carry the model's own numbers,
    which air without a Verifier and never with it."""
    cache = ce.load_cache()
    assert cache.model == "gpt-4.1-mini" and len(cache.runs) >= 12
    rows = ce.rescore(cache, {("blind_side_run", 3): MomentContext.load("blind_side_run", 3)})
    anchored = [r for r in rows if r.lines == "anchored"]
    free = [r for r in rows if r.lines == "free_text"]
    assert anchored and free
    assert sum(r.wrong_without for r in anchored) == 0
    assert sum(r.wrong_without for r in free) > 0
    assert all(r.violations_with == 0 for r in rows)
    assert sum(r.rejected for r in free) > 0


def test_the_quoted_crew_vs_single_figures_are_in_its_report():
    """The honest-limits section quotes eval/reports/crew_vs_single.md; each quote is found there,
    so the report can name the line it comes from."""
    text = (Path(ce.REPORTS) / "crew_vs_single.md").read_text()
    for key, phrase in ce.QUOTES.items():
        assert phrase in text, key
    assert all(n > 0 for n in ce.quote_lines().values())


def test_the_provenance_ladder(tmp_path):
    """What a viewer gets through the API as limits and faults pile up: a live run, the cache, a
    drill and its bring-back, then rate-limited and capped requests, then a model outage."""
    rows = ce.ladder(tmp_path)
    kinds = [(r.step, r.status, r.kind, r.reason) for r in rows]
    assert kinds == [
        ("first view", 200, "live", None),
        ("same view, another viewer", 200, "cached", None),
        ("drill: telestrator down", 200, "live", None),
        ("bring the telestrator back", 200, "live", None),
        ("new view, viewer over its limit", 200, "template", "rate_limited"),
        ("new view, another viewer", 200, "live", None),
        ("new view, daily cap reached", 200, "template", "capped"),
        ("cached view, daily cap reached", 200, "cached", None),
        ("model outage, new view", 200, "live", None),
        ("model outage, same view again", 200, "cached", None),
    ]
    assert all(r.unverified == [] and r.lines > 0 for r in rows)
    by = {r.step: r for r in rows}
    assert by["drill: telestrator down"].from_model == 3
    assert by["bring the telestrator back"].from_model == 4
    assert by["model outage, new view"].from_model == 0  # aired, every step on its template
    assert by["model outage, same view again"].from_model == 0


def test_the_committed_report_cites_the_lines_it_quotes():
    """The report names the lines of crew_vs_single.md it quotes: when that report changes,
    regenerate this one (`uv run python -m eval.crew_evidence`, in python:3.11-slim)."""
    text = (Path(ce.REPORTS) / "crew_evidence.md").read_text()
    for heading in ("## Headline", "## 1. Fault tolerance", "## 2. Verification by construction",
                    "## 3. Auditability", "## 4. Parallelism and latency",
                    "## 5. What this does not show"):  # fmt: skip
        assert heading in text
    lines = ce.quote_lines()
    section = text.split("## 5. What this does not show")[1].split("\n## ")[0]
    cited = {int(n) for n in re.findall(r"\(line (\d+)\)", section)}
    assert cited and cited <= set(lines.values())
    for phrase in ce.QUOTES.values():
        assert phrase in section
