"""Acceptance checks for the agent crew (SPEC 6): typed handoffs, verified narration, fallbacks."""

import asyncio
import json
import sys
import xml.etree.ElementTree as ET

import pytest

from agents.context import MomentContext
from agents.delivery import delivery_tier, ssml_for_line
from agents.plan import template_plan, validate_plan
from agents.schemas import ScriptLine
from agents.testing import FakeChatClient
from agents.workflow import breakdown
from explain.render import check_payload

STEPS = ["director", "analyst", "telestrator", "narration", "verifier", "voice"]


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def offline(ctx):
    return breakdown(ctx, client=None, personas=("casual", "analyst"), languages=("en", "zh"))


def _good_replies(ctx):
    """Valid structured outputs for every role, as a model would return them."""
    plan = template_plan(ctx).model_dump(by_alias=True)
    return {
        "director": {"priority": "high", "reason": "The look over the shoulder decides the pass."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "belief_error"],
                    "supporting": ["cf_pass", "blind_side"], "angle": "He saw the runner."},
        "telestrator": plan,
        "pbp": {"lines": [{"claim": "scan_before_reception", "connective": "Watch this."}]},
        "color": {"lines": [{"claim": "cf_pass", "connective": None}]},
    }  # fmt: skip


# --- the offline crew: every step falls back to its deterministic template -----------------------


def test_offline_breakdown_of_the_hero_moment(ctx, offline):
    r = offline
    assert r.request.moment == ctx.card.id == "m:decision_after_scan:H8:0075"
    assert r.findings.lens == ctx.card.selected_lens == "scan"
    assert validate_plan(r.plan, ctx) == []
    assert r.plan_source == "template"
    assert [s.step for s in r.trace] == STEPS
    assert {s.step: s.source for s in r.trace} == {
        "director": "template", "analyst": "template", "telestrator": "template",
        "narration": "template", "verifier": "code", "voice": "code",
    }  # fmt: skip
    assert {(s.persona, s.language) for s in r.scripts} == {
        (p, lang) for p in ("casual", "analyst") for lang in ("en", "zh")
    }
    for script in r.scripts:
        assert len(script.payload.lines) >= 3
        assert {line.speaker for line in script.lines} == {"pbp", "color"}
        assert check_payload(script.payload) == []
        claims = {c.id: c for c in script.payload.claims}
        for line in script.payload.lines:
            assert all(claims[cid].verdict == "supported" for cid in line.claims)
        assert len(script.voice) == len(script.payload.lines)
    assert r.tier == "excited"


def test_offline_breakdown_is_deterministic(ctx, offline):
    again = breakdown(ctx, client=None, personas=("casual", "analyst"), languages=("en", "zh"))
    strip = {"trace", "total_ms"}
    assert again.model_dump(exclude=strip) == offline.model_dump(exclude=strip)


def test_breakdown_result_is_json(offline):
    data = json.loads(offline.model_dump_json(by_alias=True))
    assert data["plan"]["moment"] == data["request"]["moment"]


# --- with a model: agent outputs are used, but only through verified claims ----------------------


def test_agent_outputs_are_used_through_verified_claims(ctx):
    fake = FakeChatClient(_good_replies(ctx))
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",))
    assert all(s.source == "llm" for s in r.trace if s.step not in ("verifier", "voice"))
    assert r.plan_source == "agent"
    assert r.findings.headline == ["scan_before_reception", "belief_error"]
    (script,) = r.scripts
    assert [line.text for line in script.payload.lines] == [
        "Watch this. H8 checked his shoulder before the ball reached him.",
        "Without that look, H8 would have passed to H4.",
    ]
    assert [line.speaker for line in script.lines] == ["pbp", "color"]


@pytest.mark.parametrize("telestrator_s, voice_s", [(1.2, 0.4), (0.4, 0.6)])
def test_telestrator_and_narration_run_concurrently(ctx, telestrator_s, voice_s):
    """Both read only the Analyst's findings, so the crew waits for the slower lane, not both.

    A narration lane is two calls in a row (the co-commentator replies to the play-by-play), so it
    takes `2 * voice_s`. The trace keeps its documented order whichever lane finishes first.
    """
    delays = {"telestrator": telestrator_s, "pbp": voice_s, "color": voice_s}
    fake = FakeChatClient(_good_replies(ctx), delays=delays)
    r = breakdown(ctx, client=fake, personas=("casual", "analyst"), languages=("en",))
    assert all(s.source == "llm" for s in r.trace if s.step not in ("verifier", "voice"))
    assert r.plan_source == "agent" and len(r.scripts) == 2
    assert all(len(script.voice) == len(script.payload.lines) for script in r.scripts)
    assert [s.step for s in r.trace] == STEPS
    slower, serial = max(telestrator_s, 2 * voice_s), telestrator_s + 2 * voice_s
    total_s = r.total_ms / 1000
    assert slower <= total_s < (slower + serial) / 2, (total_s, slower, serial)


def test_a_model_cannot_add_its_own_words_or_unknown_claims(ctx):
    replies = _good_replies(ctx)
    replies["analyst"] = {**replies["analyst"], "headline": ["made_up_claim"]}
    replies["pbp"] = {"lines": [{"claim": None, "connective": "It was a mistake by A5."}]}
    replies["color"] = {"lines": [{"claim": "made_up_claim", "connective": None}]}
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    steps = {s.step: s for s in r.trace}
    assert steps["analyst"].source == "template" and "ValidationError" in steps["analyst"].error
    assert steps["narration"].source == "template"
    (script,) = r.scripts
    texts = " ".join(line.text for line in script.payload.lines)
    assert "mistake" not in texts and texts  # the template script airs instead
    assert check_payload(script.payload) == []


def test_a_line_the_verifier_rejects_is_rewritten_or_dropped(ctx):
    """A stale claim (changed after verification) fails the render check: rewrite, then drop."""
    import copy

    stale = copy.copy(ctx)
    stale.claims = dict(ctx.claims)
    stale.claims["blind_side"] = ctx.claims["blind_side"].model_copy(
        update={"template": "{runner} ran on the blind side of {player} today."}
    )
    replies = _good_replies(ctx)
    replies["color"] = [
        {"lines": [{"claim": "blind_side", "connective": None}]},
        {"lines": [{"claim": "cf_pass", "connective": None}]},
    ]
    r = breakdown(stale, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    assert r.plan_source == "agent"  # the plan waits at the join while narration is rewritten
    (script,) = r.scripts
    assert script.rewrites == 1 and script.dropped == []
    assert "Without that look, H8 would have passed to H4." in [
        line.text for line in script.payload.lines
    ]
    replies["color"] = {"lines": [{"claim": "blind_side", "connective": None}]}
    r = breakdown(stale, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    (script,) = r.scripts
    assert script.rewrites == 2 and [d.reason for d in script.dropped] == ["stale_claim"]


def test_a_voice_keeps_at_most_two_connectives(ctx):
    from agents.schemas import anchored_draft_model
    from agents.workflow import MAX_CONNECTIVES, compose

    draft = anchored_draft_model(list(ctx.supported), "en").model_validate({"lines": [
        {"claim": "scan_before_reception", "connective": "Watch this."},
        {"claim": "cf_pass", "connective": "Here's why."},
        {"claim": "blind_side", "connective": "Look again."},
        {"claim": None, "connective": "Now watch."},
    ]})  # fmt: skip
    lines = compose(ctx, draft, "en")
    assert [d.claims for d in lines] == [["scan_before_reception"], ["cf_pass"], ["blind_side"]]
    assert (
        sum(d.text.startswith(("Watch", "Here", "Look", "Now")) for d in lines) == MAX_CONNECTIVES
    )


def test_connectives_pass_the_lexicon():
    from agents.schemas import CONNECTIVES
    from explain.lexicon import is_connective

    assert all(is_connective(c) for lang in CONNECTIVES for c in CONNECTIVES[lang])


def test_a_failing_or_slow_agent_falls_back_to_its_template(ctx):
    replies = _good_replies(ctx)
    replies["telestrator"] = RuntimeError("model unavailable")
    replies["director"] = FakeChatClient.SLOW
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",),
                  step_timeout_s=0.2)  # fmt: skip
    steps = {s.step: s for s in r.trace}
    assert steps["telestrator"].source == "template" and steps["telestrator"].attempts == 2
    assert "model unavailable" in steps["telestrator"].error
    assert steps["director"].source == "template" and "Timeout" in steps["director"].error
    assert r.plan_source == "template"
    assert validate_plan(r.plan, ctx) == []


def test_an_invalid_agent_plan_is_replaced_by_the_template(ctx):
    replies = _good_replies(ctx)
    bad = template_plan(ctx).model_dump(by_alias=True)
    bad["steps"].append({"t": bad["duration_s"] - 0.5, "do": "pov", "player": "H99",
                         "from": -3.0, "to": 2.0, "speed": 0.5})  # fmt: skip
    replies["telestrator"] = bad
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    assert r.plan_source == "template"
    assert any("H99" in e for e in r.plan_errors) and any("longer than" in e for e in r.plan_errors)


def test_the_analyst_gets_the_mcp_tools_over_stdio(ctx):
    fake = FakeChatClient(_good_replies(ctx))
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",), use_mcp=True)
    assert set(fake.tools["analyst"]) >= {"get_moment", "list_claims", "run_counterfactual"}
    assert fake.tools["director"] == []
    assert r.plan_source == "agent"


def test_the_analyst_calls_tools_over_mcp_and_its_trace_names_them(ctx):
    """A real round trip over stdio. Seen live on Foundry: the Analyst passed an id that is not a
    scan to run_counterfactual, and the tool raised; now it answers with the valid ids."""
    from agents.testing import Call, ToolCallingFakeChatClient

    replies = _good_replies(ctx)
    replies["analyst"] = [Call("get_moment"), Call("run_counterfactual", scan_id="cf1"),
                          replies["analyst"]]  # fmt: skip
    fake = ToolCallingFakeChatClient(replies=replies)
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",), use_mcp=True)
    analyst = next(s for s in r.trace if s.step == "analyst")
    assert analyst.source == "llm" and analyst.attempts == 1
    assert analyst.notes == ["MCP tools called: get_moment, run_counterfactual"]
    results = fake.tool_results["analyst"].values()
    card, refused = (json.loads(json.loads(text)["result"]) for text in results)
    assert card["id"] == ctx.card.id
    assert refused["key_scan"] == ctx.cf.scan_id and "not a scan" in refused["error"]


def test_the_analyst_answers_without_tools_when_the_mcp_server_cannot_start(ctx, monkeypatch):
    monkeypatch.setattr(sys, "executable", "/nonexistent/python")
    fake = FakeChatClient(_good_replies(ctx))
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",), use_mcp=True)
    analyst = next(s for s in r.trace if s.step == "analyst")
    assert fake.tools["analyst"] == [] and analyst.source == "llm"
    assert analyst.notes and analyst.notes[0].startswith("MCP tools unavailable")
    assert r.scripts and r.plan_source == "agent"


def test_tidy_restores_placeholder_forms_and_drops_repeated_claims(ctx):
    from agents.workflow import tidy

    lines = [
        ScriptLine(id="L1", speaker="pbp", text="{player} scanned {n} in the {window_s} before "
                   "receiving.", claims=["scans_before_reception"]),
        ScriptLine(id="L2", speaker="color", text="{player} scanned {n:times} again.",
                   claims=["scans_before_reception"]),
        ScriptLine(id="L3", speaker="color", text="What did he see?", claims=[]),
        ScriptLine(id="L4", speaker="pbp", text="What did he see?", claims=[]),
    ]  # fmt: skip
    kept, notes = tidy(ctx, lines, "en")
    assert [line.id for line in kept] == ["L1", "L3"]
    assert kept[0].text == ("{player} scanned {n:times} in the {window_s|second|seconds} before "
                            "receiving.")  # fmt: skip
    assert len(notes) == 2


def test_tidy_keeps_each_connective_once_across_both_voices(ctx):
    """Seen live: both voices opened with "Watch this." — the second keeps only its claim."""
    from agents.workflow import tidy

    lines = [
        ScriptLine(id="L1", speaker="pbp", text="Watch this. {player} checked his shoulder.",
                   claims=["scan_before_reception"]),
        ScriptLine(id="L2", speaker="color", text="Watch this. That look was worth {dxt}.",
                   claims=["cf_value"]),
        ScriptLine(id="L3", speaker="pbp", text="注意看。", claims=[]),
    ]  # fmt: skip
    kept, notes = tidy(ctx, lines, "en")
    assert [line.text for line in kept] == [
        "Watch this. {player} checked his shoulder.", "That look was worth {dxt}.", "注意看。",
    ]  # fmt: skip
    assert notes == ["L2: repeated connective removed"]
    zh = [
        ScriptLine(id="L1", speaker="pbp", text="注意看。球到之前，{player}先回头看了一眼。",
                   claims=["scan_before_reception"]),
        ScriptLine(id="L2", speaker="color", text="注意看。那一眼带来了{dxt}的预期威胁（xT）。",
                   claims=["cf_value"]),
    ]  # fmt: skip
    kept, _ = tidy(ctx, zh, "zh")
    assert kept[1].text == "那一眼带来了{dxt}的预期威胁（xT）。"


# --- plan validation mirrors web/src/plan/validate.ts ---------------------------------------------


def test_plan_validation_matches_the_web_rules(ctx):
    plan = template_plan(ctx)
    assert validate_plan(plan, ctx) == []
    data = plan.model_dump(by_alias=True)

    def errors_with(step):
        bad = json.loads(json.dumps(data))
        bad["steps"].append(step)
        return validate_plan(bad, ctx)

    end = data["duration_s"]
    assert errors_with({"t": end, "do": "scan_marker", "scan": "scan:H8:9999"})
    assert errors_with({"t": end, "do": "ghost", "kind": "counterfactual", "cf": "cf9"})
    assert errors_with({"t": end, "do": "voice", "line": "L99"})
    assert errors_with({"t": end, "do": "rewind", "to": 99.0})
    same_time = data["steps"][-1]["t"]
    assert errors_with({"t": same_time, "do": "freeze"}) == []  # same time as the last step: fine
    bad = json.loads(json.dumps(data))
    bad["steps"][-1]["t"] = 0.1  # goes back in time
    assert validate_plan(bad, ctx)
    assert validate_plan({"moment": data["moment"], "steps": []}, ctx)  # shape


# --- delivery: tiers from rules, SSML only with supported styles ----------------------------------


def test_delivery_tier_is_rule_based(ctx):
    assert delivery_tier(ctx.card) == "excited"
    quiet = ctx.card.model_copy(deep=True)
    for lens in quiet.lenses:
        lens.delta_xt = 0.001 if lens.delta_xt is not None else None
    quiet.tags = [t for t in quiet.tags if t != "line_breaking_pass"]
    assert delivery_tier(quiet) == "calm"
    big = ctx.card.model_copy(deep=True)
    for lens in big.lenses:
        if lens.lens == big.selected_lens:
            lens.delta_xt = 0.2
    assert delivery_tier(big) == "clutch"


def test_ssml_is_well_formed_and_uses_a_style_only_when_the_voice_has_it():
    line = ScriptLine(id="L1", speaker="pbp", text="<H8> & 'H9'", claims=[])
    with_style = ssml_for_line(line, "en", "excited", styles={"excited"})
    without = ssml_for_line(line, "en", "excited", styles=set())
    for ssml in (with_style, without):
        root = ET.fromstring(ssml)
        assert root.tag.endswith("speak")
        assert "&lt;H8&gt; &amp;" in ssml
    assert "express-as" in with_style and 'style="excited"' in with_style
    assert "express-as" not in without and "<prosody" in without
    calm = ssml_for_line(line, "zh", "calm", styles=set())
    assert "zh-CN" in calm


# --- the MCP tool server the Analyst uses ---------------------------------------------------------


def test_mcp_server_exposes_the_analyst_tools(ctx):
    from mcp.shared.memory import create_connected_server_and_client_session

    from agents.mcp_server import build_server

    server = build_server(ctx)

    async def go():
        async with create_connected_server_and_client_session(server._mcp_server) as session:
            tools = {t.name for t in (await session.list_tools()).tools}
            card = await session.call_tool("get_moment", {})
            claims = await session.call_tool("list_claims", {})
            vision = await session.call_tool("get_vision", {"player": "H8", "frame": 57})
            return tools, card, claims, vision

    tools, card, claims, vision = asyncio.run(go())
    assert {"get_moment", "list_claims", "get_vision", "get_pitch_control", "get_xt",
            "get_pressing", "run_counterfactual"} <= tools  # fmt: skip
    assert json.loads(card.content[0].text)["id"] == ctx.card.id
    listed = json.loads(claims.content[0].text)
    assert len(listed) == len(ctx.claims) and {c["verdict"] for c in listed} == {"supported"}
    assert "H9" in json.loads(vision.content[0].text)["in_sight"]


# --- free text from a model never carries numbers (CLAUDE.md: LLMs never write digits) -----------


def test_model_free_text_with_a_number_is_rejected():
    """Seen live: the Director's reason said "(+0.09881)", the lens delta, in a public response."""
    from pydantic import ValidationError

    from agents.schemas import AnalystChoice, DirectorChoice, analyst_model

    with pytest.raises(ValidationError):
        DirectorChoice(priority="high", reason="The scan lens raised expected threat (+0.09881).")
    with pytest.raises(ValidationError):
        DirectorChoice(priority="high", reason="He scanned twice before the ball arrived.")
    ok = DirectorChoice(priority="high", reason="H8's look found H9 on his blind side.")
    assert ok.reason.startswith("H8")  # player ids are names, not numbers
    with pytest.raises(ValidationError):
        AnalystChoice(lens="scan", headline=["a"], supporting=[], angle="It was worth 0.1 xT.")
    model = analyst_model(["scan_before_reception"])
    with pytest.raises(ValidationError):
        model(lens="scan", headline=["scan_before_reception"], supporting=[], angle="一共3次。")


def test_a_director_reason_with_a_number_falls_back_to_the_template(ctx):
    replies = _good_replies(ctx)
    replies["director"] = {"priority": "high", "reason": "Big swing (+0.09881 xT)."}
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    steps = {s.step: s for s in r.trace}
    assert steps["director"].source == "template"
    assert "0.09881" not in r.request.reason and not any(
        ch.isdigit() for ch in r.request.reason.replace("H8", "")
    )
    assert "0.09881" not in r.model_dump_json()
