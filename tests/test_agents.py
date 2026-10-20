"""Acceptance checks for the agent crew (SPEC 6): typed handoffs, verified narration, fallbacks."""

import asyncio
import json
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
        "director": {"personas": ["casual", "analyst"], "languages": ["en", "zh"],
                     "priority": "high", "reason": "The look over the shoulder decides the pass."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "made_up_claim"],
                    "supporting": ["belief_error", "cf_pass"], "angle": "He saw the runner."},
        "telestrator": plan,
        "pbp": {"lines": [{"text": "{player} checked his shoulder before the ball reached him.",
                           "claims": ["scan_before_reception"]}]},
        "color": {"lines": [{"text": "Without that look, {player} would have passed to "
                                     "{cf_receiver}.", "claims": ["cf_pass"]}]},
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
    strip = {"trace"}
    assert again.model_dump(exclude=strip) == offline.model_dump(exclude=strip)


def test_breakdown_result_is_json(offline):
    data = json.loads(offline.model_dump_json(by_alias=True))
    assert data["plan"]["moment"] == data["request"]["moment"]


# --- with a model: agent outputs are used, but only through verified claims ----------------------


def test_agent_outputs_are_used_but_unknown_claims_are_dropped(ctx):
    fake = FakeChatClient(_good_replies(ctx))
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",))
    assert all(s.source == "llm" for s in r.trace if s.step not in ("verifier", "voice"))
    assert r.plan_source == "agent"
    assert "made_up_claim" not in r.findings.headline
    assert any("made_up_claim" in note for s in r.trace for note in s.notes)
    (script,) = r.scripts
    texts = [line.text for line in script.payload.lines]
    assert "H8 checked his shoulder before the ball reached him." in texts
    assert "Without that look, H8 would have passed to H4." in texts


def test_a_line_with_a_literal_number_is_rewritten_then_kept(ctx):
    replies = _good_replies(ctx)
    replies["pbp"] = [
        {"lines": [{"text": "{player} scanned 1 time.", "claims": ["scans_before_reception"]}]},
        {"lines": [{"text": "{player} scanned {n:times} in the {window_s|second|seconds} before "
                            "receiving.", "claims": ["scans_before_reception"]}]},
    ]  # fmt: skip
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    (script,) = r.scripts
    assert script.rewrites == 1
    assert "H8 scanned once in the 2 seconds before receiving." in [
        line.text for line in script.payload.lines
    ]
    assert script.dropped == []


def test_a_line_that_stays_wrong_is_dropped_after_two_rewrites(ctx):
    replies = _good_replies(ctx)
    replies["color"] = {
        "lines": [{"text": "It was a mistake by {marker}.", "claims": ["gap_to_marker"]}]
    }
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    (script,) = r.scripts
    assert script.rewrites == 2
    assert [d.reason for d in script.dropped] == ["banned"]
    assert all("mistake" not in line.text for line in script.payload.lines)
    assert script.payload.lines  # the play-by-play line survives


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
