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


def _offered(prompt: str) -> tuple[set[str], dict]:
    """The claim ids a narration prompt offers, and its persona rules."""
    data, _ = json.JSONDecoder().raw_decode(prompt)
    keys = ("headline_claims", "supporting_claims", "other_claims")
    return {c["id"] for key in keys for c in data.get(key, [])}, data.get("rules", {})


def _good_pbp(prompt: str) -> dict:
    """The play-by-play: the shoulder check; for audio description, where it happened first."""
    offered, rules = _offered(prompt)
    if start := rules.get("start_with"):
        return {"lines": [{"claim": start[0], "connective": None}]}
    return {"lines": [{"claim": "scan_before_reception", "connective": "Watch this."}]}


def _good_color(prompt: str) -> dict:
    """The co-commentator: the counterfactual, then one claim of each group of the persona rules
    the play-by-play left missing (agents/persona_rules.py), as a model following them would."""
    offered, rules = _offered(prompt)
    ids = ["cf_pass"] if "cf_pass" in offered else []
    ids += [g["one_of"][0] for g in rules.get("still_missing", []) if g["one_of"][0] not in ids]
    return {"lines": [{"claim": cid, "connective": None} for cid in ids]}


def _good_replies(ctx):
    """Valid structured outputs for every role, as a model would return them."""
    plan = template_plan(ctx).model_dump(by_alias=True)
    return {
        "director": {"priority": "high", "reason": "The look over the shoulder decides the pass."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "belief_error"],
                    "supporting": ["cf_pass", "blind_side"], "angle": "He saw the runner."},
        "telestrator": plan,
        "pbp": _good_pbp,
        "color": _good_color,
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
    assert r.tier == "clutch"


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
    assert [line.text for line in script.payload.lines][:2] == [
        "Watch this. J. Ferriday checked his shoulder before the ball reached him.",
        "Without that look, J. Ferriday would have passed to K. Annersley.",
    ]
    # The analyst's rules (agents/persona_rules.py): the look's xT, belief error, scan timing.
    assert [line.claims for line in script.lines] == [
        ["scan_before_reception"], ["cf_pass"], ["cf_value"], ["belief_error"],
        ["scans_before_reception"],
    ]  # fmt: skip
    assert [line.speaker for line in script.lines] == ["pbp"] + ["color"] * 4
    assert script.rewrites == 0


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
    """A stale claim (changed after verification) fails the render check: rewrite, then drop.
    Casual: the replies below follow its persona rules once the stale line is gone."""
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
    r = breakdown(stale, client=FakeChatClient(replies), personas=("casual",), languages=("en",))
    assert r.plan_source == "agent"  # the plan waits at the join while narration is rewritten
    (script,) = r.scripts
    assert script.rewrites == 1 and script.dropped == []
    assert "Without that look, J. Ferriday would have passed to K. Annersley." in [
        line.text for line in script.payload.lines
    ]
    replies["color"] = {"lines": [{"claim": "blind_side", "connective": None}]}
    r = breakdown(stale, client=FakeChatClient(replies), personas=("casual",), languages=("en",))
    (script,) = r.scripts
    assert script.rewrites == 2 and [d.reason for d in script.dropped] == ["stale_claim"]
    # Without the stale line the script lacks its counterfactual: a verified template line adds it.
    assert script.lines[-1].claims == ["cf_pass"]


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
    k = len(bad["steps"]) - 1
    assert {f"steps.{k} (pov): unknown_player", f"steps.{k} (pov): pov_too_long"} <= set(
        r.plan_errors
    )


def test_plan_errors_in_the_trace_never_repeat_the_models_text(ctx):
    """The trace and `plan_errors` are public (SPEC 5.3, 6): an invalid plan is reported as a
    location and a fixed reason, never with a value the model wrote, words, digits or times."""
    replies = _good_replies(ctx)
    plan = template_plan(ctx).model_dump(by_alias=True)
    end = plan["duration_s"]
    plan["moment"] = "m:quokka marmalade 4242"
    plan["steps"] += [
        {"t": end, "do": "scan_marker", "scan": "zebra 31337 eleven", "label_claim": "okapi 2718"},
        {"t": end, "do": "ghost", "kind": "counterfactual", "cf": "narwhal 16180"},
        {"t": end, "do": "voice", "line": "L8675309 tangerine"},
        {"t": end, "do": "rewind", "to": 58.7654321},
        {"t": end, "do": "pov", "player": "H8", "from": -41.2718281, "to": -37.1414213,
         "speed": 0.5},
        {"t": 0.0314159, "do": "freeze"},
    ]  # fmt: skip
    replies["telestrator"] = plan
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    assert r.plan_source == "template"
    (telestrator,) = [s for s in r.trace if s.step == "telestrator"]
    assert telestrator.source == "llm" and telestrator.error is None
    k = len(plan["steps"]) - 6
    assert set(r.plan_errors) == {
        "moment: wrong_moment",
        f"steps.{k} (scan_marker): unknown_scan",
        f"steps.{k} (scan_marker): unsupported_claim",
        f"steps.{k + 1} (ghost): unknown_counterfactual",
        f"steps.{k + 2} (voice): unknown_line",
        f"steps.{k + 3} (rewind).to: outside_clip",
        f"steps.{k + 4} (pov).from: outside_clip",
        f"steps.{k + 4} (pov).to: outside_clip",
        f"steps.{k + 4} (pov): pov_too_long",
        f"steps.{k + 5} (freeze): goes_back_in_time",
    }
    assert telestrator.notes == [f"invalid plan, template used: {e}" for e in r.plan_errors]
    public = json.dumps(
        [s.model_dump(exclude={"ms"}) for s in r.trace] + r.plan_errors, ensure_ascii=False
    )
    model_text = ["quokka", "marmalade", "4242", "zebra", "31337", "eleven", "okapi", "2718",
                  "narwhal", "16180", "8675309", "tangerine", "7654321", "2718281", "1414213",
                  "4.13", "314159"]  # fmt: skip
    assert [w for w in model_text if w in public] == []


def test_plan_shape_errors_name_the_field_and_type_only(ctx):
    from pydantic import ValidationError

    from agents.plan import shape_errors
    from agents.schemas import TelestrationPlan

    data = template_plan(ctx).model_dump(by_alias=True)
    data["duration_s"] = 4242.0
    data["steps"][0]["quokka 31337"] = "marmalade"
    with pytest.raises(ValidationError) as e:
        TelestrationPlan.model_validate(data)
    public = [p.public for p in shape_errors(e.value)]
    assert public == ["duration_s: less_than_equal", "steps.0.freeze: extra_forbidden"]
    assert [p.public for p in validate_plan(data, ctx)] == public


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


def test_after_a_timeout_in_the_tool_loop_the_retry_still_reaches_the_mcp_server(ctx):
    """The first attempt calls a tool, then the model stalls past the timeout; the retry calls
    another tool on the same server and answers."""
    from agents.testing import Call, ToolCallingFakeChatClient

    replies = _good_replies(ctx)
    replies["analyst"] = [Call("get_moment"), FakeChatClient.SLOW, Call("list_claims"),
                          replies["analyst"]]  # fmt: skip
    fake = ToolCallingFakeChatClient(replies=replies)
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",), use_mcp=True,
                  step_timeout_s=1.0)  # fmt: skip
    analyst = next(s for s in r.trace if s.step == "analyst")
    assert analyst.source == "llm" and analyst.attempts == 2
    assert analyst.notes == ["MCP tools called: list_claims"]
    assert len(fake.tool_results["analyst"]) == 2


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
    for mode in ("split", "pov", "tactical", "broadcast"):  # the cameras of SPEC 7 that exist
        assert errors_with({"t": end, "do": "camera", "mode": mode}) == []
    assert errors_with({"t": end, "do": "camera", "mode": "drone"})
    assert errors_with({"t": end, "do": "camera", "mode": "player_lock"})  # not built yet


# --- delivery: tiers from rules, SSML only with supported styles ----------------------------------


def test_delivery_tier_is_rule_based(ctx):
    assert delivery_tier(ctx.card) == "clutch"
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
    # An open line asks for sports-commentary, then cheerful. Prosody wraps the words either way.
    with_style = ssml_for_line(line, "en", "excited", styles={"sports-commentary"})
    without = ssml_for_line(line, "en", "excited", styles=set())
    refused = ssml_for_line(line, "en", "excited", styles={"excited"})
    for ssml in (with_style, without, refused):
        root = ET.fromstring(ssml)
        assert root.tag.endswith("speak")
        assert "".join(root.itertext()) == line.text
        assert "&lt;H8&gt; &amp;" in ssml
        assert "<prosody" in ssml
    assert "express-as" in with_style and 'style="sports-commentary"' in with_style
    assert "express-as" not in without and "express-as" not in refused
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


# --- audio description: the moment told to blind and low-vision viewers (SPEC 1, 6) --------------

AD = "audio_description"
# Who, where, which way he looked, what he could and couldn't see; and what he did with it.
DESCRIBING = {"reception_zone", "blind_side", "scan_side", "scan_before_reception",
              "seen_in_scan", "pass_to_runner", "runner_received", "gap_to_marker", "unmarked",
              "cf_pass"}  # fmt: skip
NUMBERS_FOR_ANALYSTS = {"cf_value", "pass_success", "cf_pass_success", "observed_share",
                        "pressure_at_pass"}  # fmt: skip
# Every speaking style a voice might offer; audio description must pick only a calm one.
ALL_STYLES = {"sports-commentary", "sports-commentary-excited", "excited", "cheerful", "shouting",
              "narration-professional", "documentary-narration", "narration-relaxed", "calm",
              "newscast", "chat"}  # fmt: skip
EXCITED_STYLES = {"sports-commentary", "sports-commentary-excited", "excited", "cheerful",
                  "shouting"}  # fmt: skip


@pytest.fixture(scope="module")
def described(ctx):
    return breakdown(ctx, client=None, personas=(AD,), languages=("en", "zh"))


def _script(result, persona, language):
    return next(s for s in result.scripts if (s.persona, s.language) == (persona, language))


def test_audio_description_is_a_persona_end_to_end(ctx, described):
    from typing import get_args

    from agents import fallbacks, prompts
    from agents.schemas import BreakdownRequest, Persona

    assert AD in get_args(Persona)
    assert AD in prompts.PERSONAS and AD in fallbacks.SEQUENCES
    BreakdownRequest(moment="m", personas=[AD], languages=["en"], priority="low", reason="-")
    assert described.request.personas == [AD]
    assert {(s.persona, s.language) for s in described.scripts} == {(AD, "en"), (AD, "zh")}
    assert [s.step for s in described.trace] == STEPS


def test_the_audio_description_template_script_is_fully_verified(ctx, described):
    from agents import fallbacks

    for script in described.scripts:
        template = fallbacks.narration(ctx, AD, script.language)
        assert script.dropped == [] and script.rewrites == 0
        assert len(script.payload.lines) == len(template) >= 5  # every template line airs
        assert check_payload(script.payload) == []
        claims = {c.id: c for c in script.payload.claims}
        assert all(claims[cid].verdict == "supported" for line in script.lines
                   for cid in line.claims)  # fmt: skip
        assert len(script.voice) == len(script.payload.lines)


def test_audio_description_says_who_where_which_way_and_what_he_saw(described):
    en, zh = _script(described, AD, "en"), _script(described, AD, "zh")
    claims = [cid for line in en.lines for cid in line.claims]
    assert {"reception_zone", "scan_side", "seen_in_scan", "blind_side"} <= set(claims)
    assert set(claims) <= DESCRIBING and not set(claims) & NUMBERS_FOR_ANALYSTS
    assert [line.text for line in en.payload.lines] == [
        "J. Ferriday received the ball in the opponents' half, right of centre.",
        "N. Varnhall's run was on J. Ferriday's blind side.",
        "Before the ball reached him, J. Ferriday looked over his right shoulder.",
        "When J. Ferriday looked over his shoulder before the ball arrived, he saw N. Varnhall.",
        "J. Ferriday found N. Varnhall with a 38-metre pass.",
        "Without that look, J. Ferriday would have passed to K. Annersley.",
    ]
    assert [line.text for line in zh.payload.lines] == [
        "J. Ferriday在对方半场中路偏右接球。",
        "N. Varnhall的跑位在J. Ferriday的盲区。",
        "球到之前，J. Ferriday扭头看向了右后方。",
        "球到之前回头的那一眼，J. Ferriday看到了N. Varnhall。",
        "J. Ferriday一脚38米的传球找到了N. Varnhall。",
        "如果没有那一眼，J. Ferriday会把球传给K. Annersley。",
    ]
    assert [line.claims for line in zh.lines] == [line.claims for line in en.lines]


def test_the_model_is_asked_for_describing_claims_first(ctx):
    """With a model, the narration prompt lists the describing claims, in telling order."""
    from agents import fallbacks
    from agents.prompts import PREFERRED_CLAIMS, narration_prompt

    findings = fallbacks.analyst(ctx)
    data = json.loads(narration_prompt(ctx, findings, AD, "en", "pbp"))
    preferred = [c["id"] for c in data["preferred_claims"]]
    assert preferred == [c for c in PREFERRED_CLAIMS[AD] if c in ctx.supported]
    assert preferred[:2] == ["reception_zone", "blind_side"]
    assert set(preferred) <= DESCRIBING and not set(preferred) & NUMBERS_FOR_ANALYSTS
    assert "preferred_claims" not in json.loads(
        narration_prompt(ctx, findings, "analyst", "en", "pbp")
    )


def test_a_model_draft_for_audio_description_still_airs_only_verified_claims(ctx):
    """The two voices interleave, so whom he saw can air before the line that tells the look: its
    sentence names the look itself, in both languages, and never leans on an earlier line."""
    replies = _good_replies(ctx)
    replies["pbp"] = {"lines": [{"claim": "reception_zone", "connective": None},
                                {"claim": "scan_side", "connective": None}]}  # fmt: skip
    replies["color"] = {"lines": [{"claim": "seen_in_scan", "connective": None}]}
    for language, texts in {
        "zh": ["J. Ferriday在对方半场中路偏右接球。",
               "球到之前回头的那一眼，J. Ferriday看到了N. Varnhall。",
               "球到之前，J. Ferriday扭头看向了右后方。"],
        "en": ["J. Ferriday received the ball in the opponents' half, right of centre.",
               "When J. Ferriday looked over his shoulder before the ball arrived, he saw "
               "N. Varnhall.",
               "Before the ball reached him, J. Ferriday looked over his right shoulder."],
    }.items():  # fmt: skip
        r = breakdown(ctx, client=FakeChatClient(replies), personas=(AD,), languages=(language,))
        (script,) = r.scripts
        assert [line.claims for line in script.lines] == [
            ["reception_zone"],
            ["seen_in_scan"],
            ["scan_side"],
        ]
        assert [line.text for line in script.payload.lines] == texts
        assert check_payload(script.payload) == []


def test_audio_description_never_airs_xt_or_probabilities_even_when_the_model_picks_them(ctx):
    """Enforced in code, not only in the prompt: the schema of audio description has no xT or
    probability id, so a reply that picks one is refused and the template airs, while the analyst
    still hears them from the same model reply. (tidy and the Verifier drop such a line too:
    tests/test_persona_rules.py and the next test.)"""
    from agents.delivery import ANALYST_NUMBERS

    assert ANALYST_NUMBERS >= NUMBERS_FOR_ANALYSTS
    picked = ["pass_success", "cf_value", "observed_share"]
    assert set(picked) <= set(ctx.supported)  # else the test proves nothing
    replies = _good_replies(ctx)
    replies["pbp"] = {"lines": [{"claim": "reception_zone", "connective": None},
                                {"claim": "pass_success", "connective": None}]}  # fmt: skip
    replies["color"] = {"lines": [{"claim": "cf_value", "connective": None},
                                  {"claim": "blind_side", "connective": None},
                                  {"claim": "observed_share", "connective": None}]}  # fmt: skip
    r = breakdown(ctx, client=FakeChatClient(replies), personas=(AD, "analyst"), languages=("en",))
    ad, analyst = _script(r, AD, "en"), _script(r, "analyst", "en")
    aired = [cid for line in ad.lines for cid in line.claims]
    assert aired[0] == "reception_zone" and not set(aired) & ANALYST_NUMBERS
    assert not {c.id for c in ad.payload.claims} & ANALYST_NUMBERS
    assert not any("chance" in t or "expected threat" in t or "%" in t
                   for t in (line.text for line in ad.payload.lines))  # fmt: skip
    assert check_payload(ad.payload) == []
    notes = next(s for s in r.trace if s.step == "narration").notes
    assert any("fell back to templates" in n for n in notes)  # the audio-description calls
    # The analyst is not filtered: the same reply airs its numbers there.
    assert set(picked) <= {cid for line in analyst.lines for cid in line.claims}


def test_the_verifier_refuses_xt_or_probabilities_for_audio_description_after_a_rewrite(ctx):
    """A rewrite can bring a withheld claim back past tidy(): the Verifier is the last gate."""
    from agents.workflow import Approved, Briefing, Crew, Drafts, Verifier

    crew = Crew(ctx=ctx, client=None)
    lines = [
        ScriptLine(id="L1", speaker="pbp", text=ctx.claims["reception_zone"].template_for("en"),
                   claims=["reception_zone"]),
        ScriptLine(id="L2", speaker="color", text=ctx.claims["cf_value"].template_for("en"),
                   claims=["cf_value"]),
    ]  # fmt: skip
    drafts = Drafts(Briefing(None, None), {(AD, "en"): list(lines), ("analyst", "en"): list(lines)})
    msg, _ = Verifier(crew)._round(drafts)
    assert isinstance(msg, Approved)
    by = {(s.persona, s.language): s for s in msg.scripts}
    assert [line.id for line in by[(AD, "en")].lines] == ["L1"]
    assert [(d.id, d.reason) for d in by[(AD, "en")].dropped] == [("L2", "persona")]
    analyst = by[("analyst", "en")]
    assert {"L1", "L2"} <= {line.id for line in analyst.lines} and analyst.dropped == []
    # Repaired for the analyst's rules: belief error and scan timing added from templates.
    assert {"belief_error", "scans_before_reception"} <= {
        c for line in analyst.lines for c in line.claims
    }


@pytest.mark.parametrize("tier", ["calm", "excited", "clutch"])
@pytest.mark.parametrize("language", ["en", "zh"])
def test_audio_description_is_voiced_calm_and_slower_whatever_the_tier(tier, language):
    line = ScriptLine(id="L1", speaker="pbp", text="H8 looked over his right shoulder.", claims=[])
    for styles in (ALL_STYLES, EXCITED_STYLES, set()):
        ssml = ssml_for_line(line, language, tier, styles, persona=AD, role="peak",
                             counterfactual=True)  # fmt: skip
        root = ET.fromstring(ssml)
        (prosody,) = [e for e in root.iter() if e.tag.endswith("prosody")]
        assert prosody.get("rate") == "-10%" and prosody.get("pitch") == "+0%"
        assert prosody.get("volume") is None  # no emphasis, even on "looked over his shoulder"
        assert "<break" not in ssml and "styledegree" not in ssml
        assert not any(f'style="{s}"' in ssml for s in EXCITED_STYLES)
        if styles == ALL_STYLES:
            assert 'style="narration-relaxed"' in ssml
        else:
            assert "express-as" not in ssml  # no calm style on offer: prosody only
    other = ssml_for_line(line, language, tier, set(), persona="casual")
    assert 'rate="+6%"' in other and 'pitch="+3%"' in other  # open, not the AD rate
    assert 'rate="-10%"' not in other


def _with_delta(ctx, delta: float):
    import copy

    out = copy.copy(ctx)
    out.card = ctx.card.model_copy(deep=True)
    for lens in out.card.lenses:
        if lens.delta_xt is not None:
            lens.delta_xt = delta if lens.lens == out.card.selected_lens else 0.001
    out.card.tags = [t for t in out.card.tags if t != "line_breaking_pass"]
    return out


@pytest.mark.parametrize("delta, tier", [(0.001, "calm"), (0.2, "clutch")])
def test_the_voice_step_reads_audio_description_calmly_on_any_moment(ctx, delta, tier):
    from agents.delivery import VOICES

    moment = _with_delta(ctx, delta)
    styles = {voice: ALL_STYLES for voice in VOICES.values()}
    r = breakdown(moment, client=None, personas=("casual", AD), languages=("en", "zh"),
                  voice_styles=styles)  # fmt: skip
    assert r.tier == tier
    for language in ("en", "zh"):
        casual, ad = _script(r, "casual", language), _script(r, AD, language)
        assert {cue.style for cue in ad.voice} == {"narration-relaxed"}
        assert {cue.style for cue in casual.voice} != {"narration-relaxed"}
        for cue in ad.voice:
            ET.fromstring(cue.ssml)
            assert 'rate="-' in cue.ssml and cue.voice == VOICES[(language, cue.speaker)]
            assert cue.style not in EXCITED_STYLES
    assert len({cue.cache_key for s in r.scripts for cue in s.voice}) == sum(
        len(s.voice) for s in r.scripts
    )  # an audio-description clip is never the commentary clip of the same line


# --- broadcast delivery: roles, emphasis, the reveal break (SPEC 6) ------------------------------

# Styles best first, styledegree or none, then rate and pitch, at tier clutch (the hero moment's
# scan lens is worth more than 0.15 xT since its run is onside, SPEC 3.9).
_LINE = {
    "open": (("sports-commentary", "cheerful"), None, "+6%", "+3%"),
    "build": (("sports-commentary-excited", "excited", "cheerful"), None, "+8%", "+3%"),
    "peak": (("sports-commentary-excited", "excited", "cheerful"), "2", "+14%", "+6%"),
    "why": (("cheerful", "excited"), None, "+2%", "+2%"),
}
_AD_LINE = (("narration-relaxed", "narration-professional", "calm", "newscast"), "-10%", "+0%")
_EMPH = {"pbp": ("+0%", "+8%", "+15%"), "color": ("-10%", "+5%", "+10%")}
# persona, language, text, role, emphasis span (audio description: none), counterfactual
_SNAPSHOT_LINES = (
    ("casual", "en", "What did he see?", "open", None, False),
    ("casual", "en", "J. Ferriday checked his shoulder before the ball reached him.", "build",
     "checked his shoulder", False),
    ("casual", "en", "N. Varnhall's run was on J. Ferriday's blind side.", "why", "blind side",
     False),
    ("casual", "en", "Without that look, J. Ferriday would have passed to K. Annersley.", "why",
     "that look", True),
    ("analyst", "en", "J. Ferriday found N. Varnhall with a 38-metre pass.", "peak", None, False),
    ("casual", "zh", "他看到了什么？", "open", None, False),
    ("casual", "zh", "球到之前，J. Ferriday先回头看了一眼。", "build", "回头看了一眼", False),
    ("casual", "zh", "N. Varnhall的跑位在J. Ferriday的盲区。", "why", "盲区", False),
    ("casual", "zh", "如果没有那一眼，J. Ferriday会把球传给K. Annersley。", "why", "那一眼", True),
    ("analyst", "zh", "J. Ferriday一脚38米的传球找到了N. Varnhall。", "peak", None, False),
    (AD, "en", "N. Varnhall's run was on J. Ferriday's blind side.", "why", None, False),
    (AD, "zh", "N. Varnhall的跑位在J. Ferriday的盲区。", "why", None, False),
)  # fmt: skip
_PERSONAS = ("casual", "analyst", "player_fan", "coach", AD)
_SCAN_CLAIMS = {"scan_before_reception", "scans_before_reception", "scan_side",
                "time_since_last_scan"}  # fmt: skip
_PEAK_CLAIMS = {"pass_to_runner", "runner_received", "pressure_at_pass"}
_PEAK_LINES = (
    "found N. Varnhall with a 38-metre pass",
    "took the pass",
    "Pressing intensity on K. Annersley was 95% when he released the ball",
)


def _spoken(ssml):
    """(voice name, style, styledegree, [(kind, text, attrib), ...]) under the voice element."""
    root = ET.fromstring(ssml)
    voice = next(e for e in root if e.tag.endswith("voice"))
    nodes = list(voice)
    style = degree = None
    if len(nodes) == 1 and nodes[0].tag.endswith("express-as"):
        style, degree = nodes[0].get("style"), nodes[0].get("styledegree")
        nodes = list(nodes[0])
    events = []
    for node in nodes:
        if node.tag.endswith("break"):
            events.append(("break", "", dict(node.attrib)))
        else:
            assert node.tag.endswith("prosody")
            events.append(("prosody", "".join(node.itertext()), dict(node.attrib)))
    return voice.get("name"), style, degree, events


def _assert_spoken(ssml, voice, speaker, text, role, emphasis, counterfactual, persona):
    from agents.delivery import VOICE_STYLES

    name, style, degree, events = _spoken(ssml)
    assert name == voice
    assert "".join(piece for kind, piece, _ in events if kind == "prosody") == text
    if persona == AD:
        prefs, rate, pitch = _AD_LINE
        want_degree = None
    else:
        prefs, want_degree, rate, pitch = _LINE[role]
    assert style == next((s for s in prefs if s in VOICE_STYLES[voice]), None)
    assert degree == (want_degree if style else None)
    if persona == AD:
        assert style not in EXCITED_STYLES
    emph = [piece for kind, piece, attrs in events if kind == "prosody" and "volume" in attrs]
    plain = [attrs for kind, _, attrs in events if kind == "prosody" and "volume" not in attrs]
    assert emph == ([emphasis] if emphasis else [])
    assert plain and all(a.get("rate") == rate and a.get("pitch") == pitch for a in plain)
    er, ep, ev = _EMPH[speaker]
    for kind, _, attrs in events:
        if kind == "prosody" and "volume" in attrs:
            assert (attrs.get("rate"), attrs.get("pitch"), attrs.get("volume")) == (er, ep, ev)
    sep = None
    for index, _token in ((text.find(", "), ", "), (text.find("，"), "，")):
        if index != -1 and (sep is None or index < sep[0]):
            sep = (index, _token)
    breaks = [i for i, (kind, _, _) in enumerate(events) if kind == "break"]
    if persona == AD or not counterfactual or sep is None:
        assert breaks == []
        return
    (at,) = breaks
    before = "".join(piece for kind, piece, _ in events[:at] if kind == "prosody")
    after = "".join(piece for kind, piece, _ in events[at + 1 :] if kind == "prosody")
    assert before == text[: sep[0] + 1] and after == text[sep[0] + 1 :]
    assert events[at][2]["time"] == "250ms"


@pytest.fixture(scope="module")
def booth():
    return {
        (scenario, seed): breakdown(
            MomentContext.load(scenario, seed), client=None, personas=_PERSONAS,
            languages=("en", "zh"),
        )
        for scenario, seed in (("blind_side_run", 3), ("press_escape", 0))
    }  # fmt: skip


def _cue_for(result, persona, language, text):
    script = _script(result, persona, language)
    line = next((line for line in script.payload.lines if line.text == text), None)
    assert line is not None, (persona, language, [line.text for line in script.payload.lines])
    cue = next(cue for cue in script.voice if cue.line == line.id)
    return line, cue


def test_line_role_matches_the_decision_event_by_player_and_frame():
    from agents.delivery import line_role

    moment = "m:decision_after_scan:H8:0075"
    evidence = {
        "pass_to_runner": ["pass:H8:0075"],
        "scan": ["scan:H8:0060", "reception:H8:0057"],
        "other": ["pass:H9:0075"],
        "unpadded": ["pass:H8:75"],
    }
    assert line_role("color", ["pass_to_runner"], evidence, moment) == "why"
    assert line_role("pbp", [], evidence, moment) == "open"
    assert line_role("pbp", ["scan"], evidence, moment) == "build"
    assert line_role("pbp", ["other"], evidence, moment) == "build"
    assert line_role("pbp", ["pass_to_runner"], evidence, moment) == "peak"
    assert line_role("pbp", ["unpadded"], evidence, moment) == "peak"
    assert line_role("pbp", ["scan", "unpadded"], evidence, moment) == "peak"


def test_peak_prosody_follows_the_tier():
    """Calm peak uses the build style. Excited and clutch add styledegree when a style fits."""
    from agents.delivery import VOICE_STYLES, VOICES

    line = ScriptLine(id="L1", speaker="pbp", text="H8 found H9 with a 38-metre pass.",
                      claims=["pass_to_runner"])  # fmt: skip
    for language in ("en", "zh"):
        styles = VOICE_STYLES[VOICES[(language, "pbp")]]
        calm = ssml_for_line(line, language, "calm", styles, role="peak")
        build = ssml_for_line(line, language, "excited", styles, role="build")
        _, calm_style, calm_degree, calm_events = _spoken(calm)
        _, build_style, _, _ = _spoken(build)
        assert calm_style == build_style and calm_degree is None
        assert all(
            attrs.get("rate") == "+8%" and attrs.get("pitch") == "+3%"
            for _, _, attrs in calm_events
        )
        _, _, degree, events = _spoken(
            ssml_for_line(line, language, "excited", styles, role="peak")
        )
        assert degree == "1.5"
        assert all(
            attrs.get("rate") == "+10%" and attrs.get("pitch") == "+4%" for _, _, attrs in events
        )
        _, _, degree, events = _spoken(ssml_for_line(line, language, "clutch", styles, role="peak"))
        assert degree == "2"
        assert all(
            attrs.get("rate") == "+14%" and attrs.get("pitch") == "+6%" for _, _, attrs in events
        )
    bare = ssml_for_line(line, "en", "clutch", styles=set(), role="peak")
    assert "express-as" not in bare and "styledegree" not in bare and 'rate="+14%"' in bare


def test_the_reveal_break_follows_the_first_comma_only():
    none = ScriptLine(id="L1", speaker="color", text="No comma here at all.", claims=["cf"])
    assert "<break" not in ssml_for_line(none, "en", "excited", role="why", counterfactual=True)
    both = ScriptLine(id="L2", speaker="color", text="First, pause, then more.", claims=["cf"])
    _, _, _, events = _spoken(ssml_for_line(both, "en", "excited", role="why", counterfactual=True))
    (at,) = [i for i, (kind, _, _) in enumerate(events) if kind == "break"]
    before = "".join(piece for kind, piece, _ in events[:at] if kind == "prosody")
    after = "".join(piece for kind, piece, _ in events[at + 1 :] if kind == "prosody")
    assert before == "First," and after == " pause, then more." and events[at][2]["time"] == "250ms"
    zh = ScriptLine(id="L3", speaker="color", text="先说，再, 说。", claims=["cf"])
    _, _, _, events = _spoken(ssml_for_line(zh, "zh", "excited", role="why", counterfactual=True))
    (at,) = [i for i, (kind, _, _) in enumerate(events) if kind == "break"]
    before = "".join(piece for kind, piece, _ in events[:at] if kind == "prosody")
    assert before == "先说，"


def test_broadcast_lines_follow_the_role_table(booth):
    from agents.delivery import VOICES

    hero = booth[("blind_side_run", 3)]
    for persona, language, text, role, emphasis, counterfactual in _SNAPSHOT_LINES:
        line, cue = _cue_for(hero, persona, language, text)
        _assert_spoken(
            cue.ssml, VOICES[(language, cue.speaker)], cue.speaker, line.text, role, emphasis,
            counterfactual, persona,
        )  # fmt: skip


def test_voice_ssml_snapshots(booth):
    """Exact SSML for the broadcast lines. Regenerate with UPDATE_SNAPSHOTS=1."""
    import os
    from pathlib import Path

    hero = booth[("blind_side_run", 3)]
    got = {}
    for persona, language, text, _, _, _ in _SNAPSHOT_LINES:
        line, cue = _cue_for(hero, persona, language, text)
        got[f"{persona}/{language}/{line.id}"] = cue.ssml
    assert len(got) == len(_SNAPSHOT_LINES)
    path = Path(__file__).parent / "snapshots" / "voice_ssml.json"
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(got, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
    assert json.loads(path.read_text()) == got


def test_every_cue_speaks_the_payload_line(booth):
    from agents.delivery import VOICE_STYLES, VOICES

    for result in booth.values():
        for script in result.scripts:
            payload = {line.id: line.text for line in script.payload.lines}
            speakers = {line.id: line.speaker for line in script.lines}
            for cue in script.voice:
                assert cue.speaker == speakers[cue.line]
                assert cue.voice == VOICES[(script.language, cue.speaker)]
                assert "".join(ET.fromstring(cue.ssml).itertext()) == payload[cue.line]
                if cue.style is None:
                    assert "express-as" not in cue.ssml
                else:
                    assert cue.style in VOICE_STYLES[cue.voice]
                if script.persona != AD:
                    continue
                assert "<break" not in cue.ssml and "volume=" not in cue.ssml
                assert cue.style not in EXCITED_STYLES
                prosody = [e for e in ET.fromstring(cue.ssml).iter() if e.tag.endswith("prosody")]
                assert prosody and all(
                    e.get("rate") == "-10%" and e.get("pitch") == "+0%" and e.get("volume") is None
                    for e in prosody
                )  # fmt: skip


def test_line_roles_on_the_offline_breakdowns(booth):
    from agents.delivery import line_role

    seen, opens, scans = set(), 0, 0
    for result in booth.values():
        for script in result.scripts:
            evidence = {c.id: c.evidence for c in script.payload.claims}
            speakers = {line.id: line.speaker for line in script.lines}
            for line in script.payload.lines:
                speaker = speakers[line.id]
                role = line_role(speaker, line.claims, evidence, script.payload.moment)
                if speaker == "color":
                    assert role == "why", line.text
                elif not line.claims:
                    assert role == "open" and speaker == "pbp", line.text
                    opens += 1
                elif set(line.claims) & _PEAK_CLAIMS:
                    assert role == "peak", line.text
                elif set(line.claims) & _SCAN_CLAIMS:
                    assert role == "build", line.text
                    scans += 1
                for marker in _PEAK_LINES:
                    if marker in line.text:
                        assert role == "peak" and speaker == "pbp", line.text
                        seen.add(marker)
    assert seen == set(_PEAK_LINES) and opens > 0 and scans > 0


def test_revoice_agrees_with_the_voice_step_and_repairs_old_cues(offline):
    from copy import deepcopy

    from agents.delivery import revoice

    fresh = offline.model_dump(mode="json", by_alias=True)
    assert revoice(fresh) == fresh
    bare = {"tier": "excited"}
    assert revoice(bare) is bare
    novoice = {"source": "offline", "result": {"tier": "calm", "scripts": [{"voice": None}]}}
    assert revoice(novoice) is novoice
    old = deepcopy(fresh)
    for script in old["scripts"]:
        for cue in script["voice"]:
            cue["ssml"] = "<speak>old prosody only</speak>"
            cue["style"] = None
            cue["cache_key"] = "0123456789abcdef"
    repaired = revoice(old)
    assert repaired["plan"] == old["plan"] == fresh["plan"]
    assert repaired["trace"] == old["trace"] and repaired["findings"] == fresh["findings"]
    for before, after, original in zip(old["scripts"], repaired["scripts"], fresh["scripts"],
                                       strict=True):  # fmt: skip
        assert after["payload"] == before["payload"] == original["payload"]
        assert [c["t"] for c in after["voice"]] == [c["t"] for c in before["voice"]]
        assert after["voice"] == original["voice"] != before["voice"]
    again = revoice(repaired)
    assert again["scripts"] == repaired["scripts"]


def test_known_voices_use_the_table_and_a_given_map_overrides_it(ctx):
    from agents.delivery import VOICES

    plain = breakdown(ctx, client=None, personas=("casual",), languages=("en",))
    assert next(s.notes for s in plain.trace if s.step == "voice") == ["tier clutch"]
    assert any(cue.style for script in plain.scripts for cue in script.voice)
    styles = {voice: set() for voice in VOICES.values()}
    forced = breakdown(ctx, client=None, personas=("casual",), languages=("en",),
                       voice_styles=styles)  # fmt: skip
    notes = next(s.notes for s in forced.trace if s.step == "voice")
    assert "voice styles unknown: prosody only" not in notes
    assert all(cue.style is None and "<prosody" in cue.ssml
               for script in forced.scripts for cue in script.voice)  # fmt: skip
