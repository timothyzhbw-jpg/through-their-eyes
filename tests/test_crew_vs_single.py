"""Crew vs single agent (SPEC 6, eval/crew_vs_single.py), offline.

The single agent is one call in the crew's own graph, so after the model it runs the crew's code:
the same checks, the same Verifier and rewrite budget, the same failure drill. The recorder
caches every request by its content, so a second run makes no model call. Scripted replies
(agents/testing.py) stand in for Foundry; no test calls a model or azure-ai-evaluation.
"""

import asyncio
import json

import pytest
from agent_framework import ChatMiddlewareLayer, InMemoryCheckpointStorage

from agents import prompts
from agents.context import MomentContext
from agents.plan import template_plan, validate_plan
from agents.schemas import DirectorChoice, PlanDraft, anchored_draft_model
from agents.testing import Call, FakeChatClient, ToolCallingFakeChatClient
from agents.workflow import breakdown, run_crew
from eval import crew_vs_single as cvs
from eval import single_agent as solo

AUDIENCES = [(p, lg) for p in ("casual", "analyst") for lg in ("en", "zh")]


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


def _voice(*claims, connective=None):
    return {"lines": [{"claim": c, "connective": connective if i == 0 else None}
                      for i, c in enumerate(claims)]}  # fmt: skip


def solo_reply(ctx, plan=None, reason="The look decides it.", scripts=None):
    return {
        "director": {"priority": "high", "reason": reason},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "cf_pass"],
                    "supporting": ["blind_side"], "angle": "He saw the runner."},
        "plan": plan or template_plan(ctx).model_dump(by_alias=True),
        "scripts": scripts or {
            solo.audience(p, lg): {"pbp": _voice("scan_before_reception", connective=None),
                                   "color": _voice("blind_side", "cf_pass")}
            for p, lg in AUDIENCES
        },
    }  # fmt: skip


def crew_replies(ctx):
    return {
        "director": {"priority": "high", "reason": "The look decides it."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "cf_pass"],
                    "supporting": ["blind_side"], "angle": "He saw the runner."},
        "telestrator": template_plan(ctx).model_dump(by_alias=True),
        "pbp": _voice("scan_before_reception"),
        "color": _voice("blind_side", "cf_pass"),
    }  # fmt: skip


class RecordedFake(ChatMiddlewareLayer, FakeChatClient):
    """A scripted client with chat middleware, as the Foundry client has."""

    def __init__(self, replies, recorder):
        FakeChatClient.__init__(self, replies)
        self.chat_middleware = [recorder]
        self._cached_chat_middleware_pipeline = None


def run(ctx, spec, client, **kwargs):
    return asyncio.run(cvs.run_one(ctx, spec, client, use_mcp=False, **kwargs))


# --- the single agent: one call, the crew's schemas, instructions and code ----------------------


def test_one_call_does_the_four_jobs(ctx):
    fake = FakeChatClient({"solo": solo_reply(ctx)})
    r = solo.run(ctx, client=fake).result
    assert dict(fake.calls) == {"solo": 1}
    sources = {e.step: e.source for e in r.trace}
    assert sources == {"director": "llm", "analyst": "llm", "telestrator": "llm",
                       "narration": "llm", "verifier": "code", "voice": "code"}  # fmt: skip
    assert r.request.priority == "high" and r.findings.headline == ["scan_before_reception",
                                                                    "cf_pass"]  # fmt: skip
    assert r.plan_source == "agent" and not r.plan_errors
    (casual_en,) = [s for s in r.scripts if (s.persona, s.language) == ("casual", "en")]
    # Both voices' lines, interleaved and composed from the claims' verified sentences.
    assert [line.claims for line in casual_en.lines] == [["scan_before_reception"], ["blind_side"],
                                                         ["cf_pass"]]  # fmt: skip
    assert casual_en.lines[0].text == ctx.claims["scan_before_reception"].template_for("en")


def test_same_instructions_and_inputs_as_the_crew(ctx):
    text = solo.instructions("anchored")
    for role in (prompts.DIRECTOR, prompts.ANALYST, prompts.TELESTRATOR):
        assert solo._role_text(role) in text
    assert prompts.NARRATION_RULES in text and prompts.SPEAKERS["color"] in text
    data = json.loads(solo.prompt(ctx, ["casual", "analyst"], ["en", "zh"], "anchored"))
    assert {c["id"] for c in data["claims"]} == set(ctx.supported)
    assert data["telestrator"]["example_plan"] == template_plan(ctx).to_web()
    assert set(data["audiences"]) == {solo.audience(p, lg) for p, lg in AUDIENCES}
    assert data["audiences"]["casual_zh"]["persona"] == prompts.PERSONAS["casual"]


def test_reply_schema_is_the_crews_step_schemas(ctx):
    model = solo.reply_model(ctx, "anchored", ["casual"], ["en"])
    fields = model.model_fields
    assert fields["director"].annotation is DirectorChoice
    assert fields["plan"].annotation is PlanDraft
    script = fields["scripts"].annotation.model_fields["casual_en"].annotation
    crew_voice = anchored_draft_model(list(ctx.supported), "en").model_json_schema()
    assert script.model_fields["pbp"].annotation.model_json_schema() == crew_voice
    assert fields["analyst"].annotation.model_json_schema()["properties"]["headline"]["items"][
        "enum"
    ] == list(ctx.supported)


def test_an_invalid_plan_gets_the_crews_reason_codes(ctx):
    plan = template_plan(ctx).model_dump(by_alias=True)
    plan["steps"][1]["to"] = -59.0  # outside the clip
    fake = FakeChatClient({"solo": solo_reply(ctx, plan=plan)})
    r = solo.run(ctx, client=fake).result
    expected = [e.public for e in validate_plan(PlanDraft.model_validate(plan).to_plan(), ctx)]
    assert expected and r.plan_source == "template" and r.plan_errors == expected
    crew = FakeChatClient({**crew_replies(ctx), "telestrator": plan})
    assert breakdown(ctx, client=crew).plan_errors == expected


def test_a_digit_in_its_free_text_fails_the_whole_reply(ctx):
    """The crew's validators apply: a number in the Director's reason invalidates the reply, and
    the single agent has only one, so every role falls back after the retry."""
    fake = FakeChatClient({"solo": solo_reply(ctx, reason="Two looks decide it, 2 in all.")})
    out = solo.run(ctx, client=fake)
    assert fake.calls["solo"] == 2  # the call and its one retry
    assert {e.step: e.source for e in out.result.trace if e.step in cvs.AGENTS} == {
        "director": "template", "analyst": "template", "telestrator": "template",
        "narration": "template"}  # fmt: skip
    assert out.pending == ["director"]  # it fell back after an error: waiting to be brought back


def test_free_text_rewrites_take_one_call_per_round(ctx):
    bad = {"lines": [{"text": "He looked 2 times.", "claims": ["scans_before_reception"]}]}
    good = {"lines": [{"text": "{player} checked his shoulder before the ball reached him.",
                       "claims": ["scan_before_reception"]}]}  # fmt: skip
    scripts = {solo.audience(p, lg): {"pbp": bad, "color": good} for p, lg in AUDIENCES}
    rewrite = {f"{solo.audience(p, lg)}_pbp": good for p, lg in AUDIENCES}
    fake = FakeChatClient({"solo": [solo_reply(ctx, scripts=scripts), rewrite]})
    r = solo.run(ctx, "free_text", client=fake).result
    assert fake.calls["solo"] == 2 and solo.REJECTED in fake.prompts["solo"][1]
    assert all(s.rewrites == 1 and not s.dropped for s in r.scripts)


def test_rewrites_stop_after_the_crews_budget(ctx):
    bad = {"lines": [{"text": "He looked 2 times.", "claims": ["scans_before_reception"]}]}
    worse = {"lines": [{"text": "He was free by 3 metres.", "claims": ["unmarked"]}]}
    scripts = {solo.audience(p, lg): {"pbp": bad, "color": worse} for p, lg in AUDIENCES}
    still = {f"{solo.audience(p, lg)}_{s}": v for p, lg in AUDIENCES
             for s, v in (("pbp", bad), ("color", worse))}  # fmt: skip
    fake = FakeChatClient({"solo": [solo_reply(ctx, scripts=scripts), still]})
    r = solo.run(ctx, "free_text", client=fake).result
    assert fake.calls["solo"] == 3  # the draft, then two rounds (MAX_REWRITES), one call each
    assert all(s.rewrites == 2 and len(s.dropped) == 2 and not s.lines for s in r.scripts)


def test_it_reads_the_moment_through_the_mcp_tools(ctx):
    reply = solo_reply(ctx)
    fake = ToolCallingFakeChatClient(replies={"solo": [Call("get_moment"), reply]})
    r = asyncio.run(run_crew(ctx, client=fake, story=solo.solo_story(), use_mcp=True)).result
    assert "get_moment" in fake.tools["solo"] and "list_claims" in fake.tools["solo"]
    assert ctx.card.id in next(iter(fake.tool_results["solo"].values()))
    (director,) = [e for e in r.trace if e.step == "director"]
    assert "MCP tools called: get_moment" in director.notes


# --- the failure drill ----------------------------------------------------------------------------


def test_any_role_down_takes_the_single_call_down(ctx):
    fake = FakeChatClient({"solo": solo_reply(ctx)})
    store = InMemoryCheckpointStorage()
    down = solo.run(ctx, client=fake, down=["telestrator"], checkpoints=store)
    assert not fake.calls and down.pending == ["director"]
    assert all(e.source == "template" for e in down.result.trace if e.step in cvs.AGENTS)
    back = solo.run(ctx, client=fake, checkpoints=store, bring_back="director")
    assert dict(fake.calls) == {"solo": 1} and not back.pending
    assert all(e.source == "llm" for e in back.result.trace if e.step in cvs.AGENTS)


def test_the_crew_keeps_the_other_roles(ctx):
    rec = cvs.Recorder(None)
    fake = RecordedFake(crew_replies(ctx), rec)
    spec = cvs.Spec("blind_side_run", 3, "crew", fault="telestrator")
    store = InMemoryCheckpointStorage()
    down = run(ctx, spec, fake, checkpoints=store)
    assert {e.step: e.source for e in down.result.trace if e.step in cvs.AGENTS} == {
        "director": "llm",
        "analyst": "llm",
        "telestrator": "template",
        "narration": "llm",
    }
    assert down.pending == ["telestrator"] and "telestrator" not in fake.calls
    back = run(ctx, spec, fake, checkpoints=store, bring_back=spec.back)
    assert [r.role for r in back.requests] == ["telestrator"]
    assert back.result.plan_source == "agent"


# --- the recorder: every request once, scored as it was made --------------------------------------


def test_requests_are_recorded_and_answered_once(ctx, tmp_path):
    rec = cvs.Recorder(tmp_path)
    fake = RecordedFake({"solo": solo_reply(ctx)}, rec)
    spec = cvs.Spec("blind_side_run", 3, "single")
    first = run(ctx, spec, fake)
    assert rec.calls == 1 and fake.calls["solo"] == 1
    (req,) = first.requests
    assert (req.role, req.kind, req.valid, req.cached, req.digits) == ("solo", "reply", True,
                                                                     False, [])  # fmt: skip
    again = run(ctx, spec, fake)
    assert rec.calls == 1 and fake.calls["solo"] == 1 and again.requests[0].cached
    assert not again.live and first.live
    assert again.result.model_dump(exclude={"total_ms", "trace"}) == first.result.model_dump(
        exclude={"total_ms", "trace"}
    )


def test_a_reply_that_does_not_fit_is_recorded_with_its_digits(ctx):
    rec = cvs.Recorder(None)
    fake = RecordedFake({"solo": solo_reply(ctx, reason="It took 3 looks and H8 saw two.")}, rec)
    out = run(ctx, cvs.Spec("blind_side_run", 3, "single"), fake)
    assert [r.valid for r in out.requests] == [False, False]
    assert out.requests[0].digits == ["3", "two"]  # H8 is a player id, not a number
    assert "ValidationError" in out.requests[0].error


def test_digits_are_counted_only_in_the_models_own_words():
    reply = {
        "reason": "A 2-second look.",
        "angle": "H8 saw H9.",
        "plan": {"duration_s": 12.0},
        "lines": [{"text": "Twice he looked.", "claims": []}, {"claim": "cf_pass"}],
    }
    assert cvs.digits_in(json.dumps(reply)) == ["2", "Twice"]


# --- scoring: what reaches the viewer in each arm -------------------------------------------------


def test_without_the_verifier_the_first_drafts_air(ctx, tmp_path):
    bad = {"lines": [{"text": "He looked 2 times.", "claims": ["scans_before_reception"]}]}
    good = {"lines": [{"text": "{player} checked his shoulder before the ball reached him.",
                       "claims": ["scan_before_reception"]}]}  # fmt: skip
    scripts = {solo.audience(p, lg): {"pbp": bad, "color": good} for p, lg in AUDIENCES}
    rewrite = {f"{solo.audience(p, lg)}_pbp": good for p, lg in AUDIENCES}
    rec = cvs.Recorder(None)
    fake = RecordedFake({"solo": [solo_reply(ctx, scripts=scripts), rewrite]}, rec)
    record = run(ctx, cvs.Spec("blind_side_run", 3, "single", "free_text"), fake)
    assert sum(r.rewrite for r in record.requests) == 1
    a, b = (cvs.Breakdown(record.moment, arm, record, cvs.scripts_of(ctx, record, arm == "B"))
            for arm in ("A", "B"))  # fmt: skip
    assert a.errors == 4 and b.errors == 0  # one line per script airs with a digit without it
    assert {k for s in a.scripts for x in s.aired for k in x.kinds} == {"number"}
    assert "He looked 2 times." in a.scripts[0].response
    assert len(a.requests) == 1 and len(b.requests) == 2  # no rewrite asked for without it
    assert record.ms_first is not None and record.ms_first <= record.ms_total


def test_the_report_renders_from_records(ctx, tmp_path, monkeypatch):
    rec = cvs.Recorder(tmp_path / "requests")
    replies = {**crew_replies(ctx), "solo": solo_reply(ctx)}
    fake = RecordedFake(replies, rec)
    plan = cvs.Plan([("blind_side_run", 3)], [("blind_side_run", 3)], [])
    ctxs = {"blind_side_run-3": ctx}
    original = cvs.run_one

    async def offline(*args, **kwargs):  # the moment's MCP server is not needed here
        return await original(*args, use_mcp=False, **kwargs)

    monkeypatch.setattr(cvs, "run_one", offline)
    runs, drills, skipped = asyncio.run(cvs.evaluate(plan, ctxs, fake, rec, tmp_path))
    assert not skipped and len(runs) == 2 and len(drills) == 4
    calls = rec.calls
    again = asyncio.run(cvs.evaluate(plan, ctxs, None, rec, tmp_path))  # all from the records
    assert rec.calls == calls and len(again[0]) == 2

    def judge(response, context):
        return 5.0, "grounded", {"prompt_tokens": 10}

    scripts = [s for b in cvs.breakdowns(runs, ctxs) for s in b.scripts]
    unique = {(s.response, tuple(s.context)) for s in scripts}
    assert len(scripts) == 16 and asyncio.run(
        cvs.judge_all(scripts, judge, tmp_path / "judge")
    ) == len(unique)  # identical scripts are judged once
    assert all(s.groundedness == 5.0 for s in scripts)
    meta = cvs.Meta("fake", "2026-10-21", cvs.EVALUATOR, calls, len(unique), [], plan,
                    discarded=[runs[0]], overhead=3)  # fmt: skip
    text = cvs.report(runs, drills, ctxs, meta, tmp_path / "judge")
    for heading in (
        "## Headline",
        "## The four arms",
        "## What is due to verification",
        "## Failure drill",
        "## Per moment",
        "## Runs set aside",
        "spent on a pilot and on runs set aside",
        "## Method",
        "## Limitations",
    ):
        assert heading in text
    assert "| telestrator | crew | 1 | 1 of 1 |" in text


def test_a_retry_is_a_new_call_and_replays_as_one(ctx, tmp_path):
    """The retry asks exactly what the first ask did; it must not be answered with the same
    (rejected) reply. A second run replays both asks in order."""
    rec = cvs.Recorder(tmp_path)
    bad = solo_reply(ctx, reason="Three looks decide it.")
    fake = RecordedFake({"solo": [bad, solo_reply(ctx)]}, rec)
    spec = cvs.Spec("blind_side_run", 3, "single")
    first = run(ctx, spec, fake)
    assert [(r.valid, r.cached) for r in first.requests] == [(False, False), (True, False)]
    assert first.requests[0].digits == ["Three"] and fake.calls["solo"] == 2
    assert all(e.source == "llm" for e in first.result.trace if e.step in cvs.AGENTS)
    again = run(ctx, spec, fake)
    assert [(r.valid, r.cached) for r in again.requests] == [(False, True), (True, True)]
    assert fake.calls["solo"] == 2 and rec.calls == 2


def test_digits_are_read_from_a_reply_the_client_rejected():
    """Foundry parses structured output itself and raises: the values are in the error."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as e:
        DirectorChoice.model_validate({"priority": "high", "reason": "H8 looked 2 times."})
    assert cvs._digits_in_errors(e.value) == ["2"]


def test_a_tool_round_is_keyed_by_the_conversation_it_continues():
    """Agent Framework gives each tool result a random id; the key must not depend on it, or a
    drill would ask its tool rounds again instead of replaying the normal run's."""
    from types import SimpleNamespace

    from agent_framework import Content, Message

    def follow_up(random_id, conversation="resp_1"):
        result = Content.from_function_result(call_id="call_1", id=random_id, result="{}")
        return SimpleNamespace(options={"conversation_id": conversation, "instructions": "x"},
                               messages=[Message(role="tool", contents=[result])])  # fmt: skip

    assert cvs._canonical(follow_up("af-call-1")) == cvs._canonical(follow_up("af-call-2"))
    assert cvs._canonical(follow_up("af-call-1")) != cvs._canonical(follow_up("af-1", "resp_2"))
