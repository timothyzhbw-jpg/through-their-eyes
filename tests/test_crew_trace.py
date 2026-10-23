"""Acceptance checks for the crew trace (SPEC 6): one run of the crew as a timeline.

- The schema is strict JSON, and a trace round-trips through it.
- The workflow records every step: start and end (telemetry), the typed message it handled and
  the ones it sent, the evidence it read and the state it wrote, model calls or its template, the
  Analyst's MCP tool calls with arguments and results, and the Verifier's rejections with the
  rewrites they asked for. No model call is made for it.
- The failure drill shows on it: an agent taken down, its fallback, its request to be brought
  back, the checkpoints with the state they saved, and the bring-back resuming from one.
- A run interrupted mid-workflow continues its trace from the checkpoint.
- Nothing private is in it: no prompt, no instructions, no key.
"""

import asyncio
import copy
import json
from pathlib import Path

import pytest
from agent_framework import FileCheckpointStorage
from pydantic import ValidationError

from agents.context import MomentContext
from agents.crewtrace import MAX_RESULT, CrewTrace, Recorder, TraceStep, tool_calls
from agents.testing import FakeChatClient
from agents.workflow import STEPS, run_crew
from tests.test_agents import _good_replies

ONE = {"personas": ("analyst",), "languages": ("en",)}


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def replies(ctx):
    return _good_replies(ctx)


def _run(coro):
    return asyncio.run(coro)


def _by_step(trace: CrewTrace, run: int = 0) -> dict[str, list[TraceStep]]:
    out: dict[str, list[TraceStep]] = {}
    for s in trace.steps:
        if s.run == run:
            out.setdefault(s.step, []).append(s)
    return out


def _one(trace: CrewTrace, step: str, run: int = 0) -> TraceStep:
    (s,) = _by_step(trace, run)[step]
    return s


# --- the schema -----------------------------------------------------------------------------------


def test_a_trace_round_trips_through_its_schema(ctx):
    run = _run(run_crew(ctx, **ONE))
    data = json.loads(run.trace.model_dump_json())
    assert CrewTrace.model_validate(data) == run.trace
    assert data["version"] == 1 and data["story"] == "breakdown" and data["subject"] == ctx.card.id
    with pytest.raises(ValidationError):
        CrewTrace.model_validate({**data, "extra": 1})


# --- the workflow writes it -----------------------------------------------------------------------


def test_every_step_is_on_the_timeline_with_its_typed_input_and_output(ctx):
    run = _run(run_crew(ctx, **ONE))
    t = run.trace
    assert [s.step for s in t.steps] == [
        "director",
        "analyst",
        "telestrator",
        "narration",
        "verifier",
        "voice",
    ] or set(  # the lanes may swap
        s.step for s in t.steps
    ) == set(STEPS)
    assert len(t.steps) == len(STEPS)
    (r,) = t.runs
    assert r.kind == "run" and r.total_ms >= run.result.total_ms and r.model == "offline"
    for s in t.steps:
        assert 0 <= s.start_ms <= s.end_ms <= r.total_ms + 1, s
    types = {s.step: (s.input.type, [o.type for o in s.output]) for s in t.steps}
    assert types == {
        "director": ("Job", ["BreakdownRequest"]),
        "analyst": ("BreakdownRequest", ["Findings"]),
        "telestrator": ("Findings", ["TelestrationPlan"]),
        "narration": ("Findings", ["Drafts"]),
        "verifier": ("Drafts", ["Approved"]),
        "voice": ("Approved", ["BreakdownResult"]),
    }
    analyst = _one(t, "analyst")
    assert analyst.output[0].data["findings"]["headline"] == run.result.findings.headline
    plan = _one(t, "telestrator").output[0]
    assert plan.data["plan"] == run.result.plan.to_web() and plan.data["source"] == "template"
    # The step order follows the graph: the Director first, Voice last.
    assert t.steps[0].step == "director" and t.steps[-1].step == "voice"


def test_sources_attempts_and_errors_match_the_breakdowns_own_trace(ctx, replies):
    run = _run(run_crew(ctx, client=FakeChatClient(replies), **ONE))
    for entry in run.result.trace:
        s = _one(run.trace, entry.step)
        assert (s.source, s.attempts, s.error) == (entry.source, entry.attempts, entry.error)
    director = _one(run.trace, "director")
    assert [(c.role, c.source, c.attempts) for c in director.calls] == [("director", "llm", 1)]
    narration = _one(run.trace, "narration")
    assert sorted((c.role, c.persona, c.language, c.source) for c in narration.calls) == [
        ("color", "analyst", "en", "llm"),
        ("pbp", "analyst", "en", "llm"),
    ]
    assert _one(run.trace, "verifier").calls == [] and _one(run.trace, "verifier").source == "code"


def test_offline_steps_say_they_ran_on_their_templates(ctx):
    run = _run(run_crew(ctx, **ONE))
    for step in ("director", "analyst", "telestrator", "narration"):
        s = _one(run.trace, step)
        assert s.source == "template" and s.attempts == 0
    narration = _one(run.trace, "narration")
    assert {(c.role, c.source) for c in narration.calls} == {
        ("pbp", "template"),
        ("color", "template"),
    }


def test_each_step_names_the_shared_state_it_read_and_wrote(ctx):
    run = _run(run_crew(ctx, **ONE))
    writes = {s.step: s.writes for s in run.trace.steps}
    assert writes == {
        "director": ["request"],
        "analyst": ["findings"],
        "telestrator": ["plan"],
        "narration": ["drafts"],
        "verifier": ["scripts"],
        "voice": ["voice"],
    }
    reads = {s.step: set(s.reads) for s in run.trace.steps}
    assert all(r and all(k.startswith("evidence.") for k in r) for r in reads.values()), reads
    assert "evidence.card" in reads["director"]
    assert "evidence.supported" in reads["analyst"]
    assert {"evidence.claims", "evidence.verdicts"} <= reads["verifier"]
    assert "evidence.card" in reads["voice"]  # the delivery tier comes from the card


def test_the_telestrator_and_narration_lanes_overlap_on_the_timeline(ctx, replies):
    fake = FakeChatClient(replies, delays={"telestrator": 0.4, "pbp": 0.2, "color": 0.2})
    run = _run(run_crew(ctx, client=fake, **ONE))
    tele, narr = _one(run.trace, "telestrator"), _one(run.trace, "narration")
    assert tele.start_ms < narr.end_ms and narr.start_ms < tele.end_ms  # concurrent
    assert tele.end_ms - tele.start_ms >= 380  # telemetry follows the model's latency
    assert _one(run.trace, "voice").start_ms >= max(tele.end_ms, narr.end_ms) - 1


def test_the_analysts_mcp_tool_calls_have_their_arguments_and_results(ctx, replies):
    from agents.testing import Call, ToolCallingFakeChatClient

    replies = dict(replies)
    replies["analyst"] = [
        Call("get_moment"),
        Call("run_counterfactual", scan_id="cf1"),
        replies["analyst"],
    ]
    fake = ToolCallingFakeChatClient(replies=replies)
    run = _run(run_crew(ctx, client=fake, use_mcp=True, **ONE))
    mcp = _one(run.trace, "mcp")
    assert mcp.source == "code" and mcp.error is None
    assert {"get_moment", "run_counterfactual", "list_claims"} <= set(mcp.output[0].data["tools"])
    analyst = _one(run.trace, "analyst")
    assert [(c.name, c.arguments) for c in analyst.tools] == [
        ("get_moment", {}),
        ("run_counterfactual", {"scan_id": "cf1"}),
    ]
    card, refused = analyst.tools
    assert json.loads(card.result)["id"] == ctx.card.id and not card.truncated
    answer = json.loads(refused.result)  # the server's answer, as the model got it
    assert answer["key_scan"] == ctx.cf.scan_id and "not a scan" in answer["error"]
    assert mcp.end_ms <= analyst.start_ms  # the server starts before the crew runs


def test_the_verifier_loop_shows_rejections_and_rewrites(ctx, replies):
    stale = copy.copy(ctx)
    stale.claims = dict(ctx.claims)
    stale.claims["blind_side"] = ctx.claims["blind_side"].model_copy(
        update={"template": "{runner} ran on the blind side of {player} today."}
    )
    replies = dict(replies)
    # The analyst's persona rules (agents/persona_rules.py) ask for the look's value, the belief
    # error, the options' chances and the space he saw (the play-by-play opens on when he
    # scanned): the first draft keeps them, so the stale line is the only thing to rewrite (a
    # script that also breaks a rule is redrafted whole instead).
    replies["color"] = [
        {
            "lines": [
                {"claim": "blind_side", "connective": None},
                {"claim": "cf_value", "connective": None},
                {"claim": "belief_error", "connective": None},
                {"claim": "pass_success", "connective": None},
                {"claim": "observed_share", "connective": None},
            ]
        },
        {"lines": [{"claim": "cf_pass", "connective": None}]},
    ]
    run = _run(run_crew(stale, client=FakeChatClient(replies), **ONE))
    steps = _by_step(run.trace)
    assert [s.round for s in steps["verifier"]] == [0, 1]
    assert [s.round for s in steps["narration"]] == [0, 1]
    first, second = steps["verifier"]
    assert [o.type for o in first.output] == ["Rewrite"] and first.writes == ["verdicts"]
    (rejected,) = first.rejected
    assert (rejected.persona, rejected.language, rejected.speaker) == ("analyst", "en", "color")
    assert rejected.problems and rejected.problems[0].startswith("stale_claim")
    rewrite = steps["narration"][1]
    assert rewrite.input.type == "Rewrite" and [o.type for o in rewrite.output] == ["Drafts"]
    (line,) = rewrite.rewritten
    assert line.line == rejected.line and line.claims_before == ["blind_side"]
    assert line.claims_after == ["cf_pass"] and line.after != line.before
    assert [c.role for c in rewrite.calls] == ["color"]
    assert second.rejected == [] and [o.type for o in second.output] == ["Approved"]
    order = [(s.step, s.round) for s in run.trace.steps if s.step in ("narration", "verifier")]
    assert order == [("narration", 0), ("verifier", 0), ("narration", 1), ("verifier", 1)]


def test_the_trace_is_recorded_without_any_extra_model_call(ctx, replies):
    plain, traced = FakeChatClient(replies), FakeChatClient(replies)
    _run(run_crew(ctx, client=plain, **ONE))
    run = _run(run_crew(ctx, client=traced, **ONE))
    assert dict(traced.calls) == dict(plain.calls) and run.trace.steps


def test_nothing_private_is_in_the_trace(ctx, replies):
    fake = FakeChatClient(replies)
    run = _run(run_crew(ctx, client=fake, **ONE))
    text = run.trace.model_dump_json()
    assert "ROLE:" not in text  # no agent instructions
    for prompts in fake.prompts.values():
        for prompt in prompts:
            assert prompt[:80] not in text  # no prompt
    for word in ("InstrumentationKey", "AccountKey", "connection_string", "api_key", "Bearer"):
        assert word not in text


# --- the failure drill ----------------------------------------------------------------------------


def test_a_drill_shows_down_fallback_waiting_and_the_checkpoints(ctx, replies, tmp_path):
    run = _run(
        run_crew(
            ctx,
            client=FakeChatClient(replies),
            down={"telestrator"},
            checkpoints=FileCheckpointStorage(tmp_path),
            **ONE,
        )
    )
    t = run.trace
    (r,) = t.runs
    assert r.down == ["telestrator"] and r.pending == ["telestrator"]
    kinds = [(e.kind, e.step) for e in t.events if e.kind != "checkpoint"]
    assert kinds == [
        ("down", "telestrator"),
        ("fallback", "telestrator"),
        ("waiting", "telestrator"),
    ]
    down, fallback, waiting = (e for e in t.events if e.kind != "checkpoint")
    assert down.t_ms <= fallback.t_ms <= waiting.t_ms
    assert "AgentDown" in fallback.detail and "2 attempts" in fallback.detail
    tele = _one(t, "telestrator")
    assert tele.source == "template" and tele.error.startswith("AgentDown:")
    assert [c.attempts for c in tele.calls] == [2]
    checkpoints = [e for e in t.events if e.kind == "checkpoint"]
    assert len(checkpoints) >= 4 and all(e.checkpoint for e in checkpoints)
    assert [e.superstep for e in checkpoints] == sorted(e.superstep for e in checkpoints)
    last = checkpoints[-1]
    assert {"request", "findings", "plan", "drafts", "scripts", "voice"} <= set(last.keys)
    assert "executor.telestrator" in last.keys and "down:telestrator" in last.detail


def test_a_bring_back_resumes_from_its_checkpoint_on_the_same_timeline(ctx, replies, tmp_path):
    first = _run(
        run_crew(
            ctx,
            client=FakeChatClient(replies),
            down={"telestrator"},
            checkpoints=FileCheckpointStorage(tmp_path),
            **ONE,
        )
    )
    fake = FakeChatClient(replies)
    back = _run(
        run_crew(
            ctx,
            client=fake,
            checkpoints=FileCheckpointStorage(tmp_path),
            bring_back="telestrator",
            trace=first.trace,
            **ONE,
        )
    )
    assert dict(fake.calls) == {"telestrator": 1}
    t = back.trace
    assert [(r.index, r.kind, r.step) for r in t.runs] == [
        (0, "run", None),
        (1, "bring_back", "telestrator"),
    ]
    assert t.runs[1].pending == [] and t.runs[1].down == []
    assert [s.model_dump() for s in t.steps if s.run == 0] == [
        s.model_dump() for s in first.trace.steps
    ]  # the first run's steps are kept as they were
    assert sorted(s.step for s in t.steps if s.run == 1) == ["telestrator", "voice"]
    tele = _one(t, "telestrator", run=1)
    assert tele.resumed and tele.source == "llm" and tele.input.type == "Findings"
    (event,) = [e for e in t.events if e.kind == "back"]
    assert event.run == 1 and event.step == "telestrator" and event.checkpoint
    assert event.checkpoint in {e.checkpoint for e in first.trace.events if e.kind == "checkpoint"}


def test_an_interrupted_run_continues_its_trace_from_the_checkpoint(ctx, replies, tmp_path):
    slow = FakeChatClient({**replies, "pbp": FakeChatClient.SLOW})

    async def interrupted():
        task = asyncio.create_task(
            run_crew(
                ctx,
                client=slow,
                step_timeout_s=60,
                checkpoints=FileCheckpointStorage(tmp_path),
                **ONE,
            )
        )
        while slow.calls["pbp"] == 0:
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    _run(interrupted())
    run = _run(
        run_crew(
            ctx, client=FakeChatClient(replies), checkpoints=FileCheckpointStorage(tmp_path), **ONE
        )
    )
    t = run.trace
    assert [(r.kind, r.total_ms is None) for r in t.runs] == [("run", True), ("resume", False)]
    assert {s.step for s in t.steps if s.run == 0} >= {"director", "analyst"}
    assert {s.step for s in t.steps if s.run == 1} >= {"telestrator", "narration", "voice"}
    (event,) = [e for e in t.events if e.kind == "resumed"]
    assert event.run == 1 and event.checkpoint


# --- the recap crew -------------------------------------------------------------------------------


def test_the_recap_crew_records_its_trace_too():
    from agents.recap import run_recap_crew
    from agents.recap_context import RecapContext

    rc = RecapContext.for_match(1)
    run = _run(run_recap_crew(rc, personas=("casual",), languages=("en",)))
    t = run.trace
    assert t.story == "recap" and t.subject == rc.match_id
    types = {s.step: (s.input.type, [o.type for o in s.output]) for s in t.steps}
    assert types["director"] == ("Job", ["RecapRequest"])
    assert types["telestrator"] == ("RecapFindings", ["RecapReel"])
    assert types["voice"] == ("Approved", ["RecapResult"])
    director = _one(t, "director")
    assert director.writes == ["evidence", "request"]  # it focuses the crew on its key moments
    assert "evidence.candidates" in director.reads


def test_a_long_tool_result_keeps_its_start_and_says_it_was_cut():
    from agent_framework import ChatResponse, Content, Message

    call = Content.from_function_call("c1", "list_claims", arguments='{"language": "en"}')
    long = json.dumps({"result": "x" * (MAX_RESULT + 10)})
    result = Content.from_function_result("c1", result=long)
    response = ChatResponse(messages=[Message(role="assistant", contents=[call]),
                                      Message(role="tool", contents=[result])])  # fmt: skip
    (tool,) = tool_calls(response)
    assert tool.name == "list_claims" and tool.arguments == {"language": "en"}
    assert tool.truncated and tool.result == "x" * MAX_RESULT


def test_a_recorder_numbers_steps_per_run():
    rec = Recorder("breakdown", "m", "offline", [])
    with rec.step("director"):
        pass
    with rec.step("analyst"):
        pass
    trace = rec.finish([], None)
    assert [s.id for s in trace.steps] == ["r0.0", "r0.1"]


def test_the_webs_fixture_is_a_trace_of_this_schema():
    """web/src/crewtrace/fixture.json, written by `python -m agents.crewtrace`: the web's tests
    render it, so it must stay a valid trace of the schema the API serves."""
    path = Path(__file__).parent.parent / "web" / "src" / "crewtrace" / "fixture.json"
    trace = CrewTrace.model_validate_json(path.read_text())
    assert [(r.kind, r.step) for r in trace.runs] == [("run", None), ("bring_back", "telestrator")]
    kinds = {e.kind for e in trace.events}
    assert {"down", "fallback", "waiting", "checkpoint", "back"} <= kinds
    assert any(s.tools for s in trace.steps) and any(s.rejected for s in trace.steps)
    assert any(s.rewritten for s in trace.steps)


# --- what the Crew trace view cites from the crew-vs-single eval ---------------------------------

ROOT = Path(__file__).parent.parent
REPORT = ROOT / "eval" / "reports" / "crew_vs_single.md"


@pytest.mark.skipif(
    not REPORT.exists(), reason="the crew-vs-single eval report is not on this branch"
)
def test_the_trace_view_cites_the_eval_as_the_report_reads():
    """Each figure web/src/crewtrace/eval.ts shows is in eval/reports/crew_vs_single.md, so a
    re-run that changes one fails here until the view is updated (SPEC 6)."""
    report = REPORT.read_text()
    cited = (ROOT / "web" / "src" / "crewtrace" / "eval.ts").read_text()
    backing = {
        # one agent down: 3 of 4 roles from the model for the crew, 0 of 4 for one agent
        "3 of 4 roles from the model": "crew: 3 of 3 aired a valid, verified breakdown with 3",
        "fell back entirely, 0 of 4": "single: 3 of 3 aired a valid, verified breakdown with 0",
        "3 of 3 drills": "3 of 3 aired a valid, verified breakdown",
        # bring-back cost: the Telestrator alone vs the single agent's whole call
        "1 model request, about 2.1k tokens": "| telestrator | crew | 3 | 3 of 3 |",
        "about 11.7k": "1.7 [1.0, 2.0] · 11747",
        "11 requests": "11.0 · 21627",
        # step length against the deployed timeout
        "0 of 66 crew agent runs": "0 of 66 crew agent runs would have timed out, and 6 of 6",
        # the same quality, a higher cost
        "groundedness 5.00 in both": "groundedness 5.00 vs 5.00",
        "0 wrong facts aired": "wrong facts aired 0 vs 0",
        "12.0 vs 1.8 model requests": "1.8 vs 12.0 model requests",
        "$0.0090 vs $0.0046": "$0.0046 vs $0.0090 per breakdown",
    }
    for phrase, evidence in backing.items():
        assert phrase in cited, phrase
        assert evidence in report, evidence
    assert "1.0 · 2129" in report  # the Telestrator's bring-back: one request, ~2.1k tokens
