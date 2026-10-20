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


# --- audio description: the moment told to blind and low-vision viewers (SPEC 1, 6) --------------

AD = "audio_description"
# Who, where, which way he looked, what he could and couldn't see; and what he did with it.
DESCRIBING = {"reception_zone", "blind_side", "scan_side", "scan_before_reception",
              "seen_in_scan", "pass_to_runner", "runner_received", "gap_to_marker", "unmarked",
              "cf_pass"}  # fmt: skip
NUMBERS_FOR_ANALYSTS = {"cf_value", "pass_success", "cf_pass_success", "observed_share",
                        "pressure_at_pass"}  # fmt: skip
# Every speaking style a voice might offer; audio description must pick only a calm one.
ALL_STYLES = {"sports_commentary", "sports_commentary_excited", "excited", "cheerful", "shouting",
              "narration-relaxed", "calm", "newscast", "chat"}  # fmt: skip
EXCITED_STYLES = {"sports_commentary", "sports_commentary_excited", "excited", "cheerful",
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
        "H8 received the ball in the opponents' half, right of centre.",
        "H9's run was on H8's blind side.",
        "Before the ball reached him, H8 looked over his right shoulder.",
        "When H8 looked over his shoulder before the ball arrived, he saw H9.",
        "H8 found H9 with a 42-metre pass.",
        "Without that look, H8 would have passed to H4.",
    ]
    assert [line.text for line in zh.payload.lines] == [
        "H8在对方半场中路偏右接球。",
        "H9的跑位在H8的盲区。",
        "球到之前，H8扭头看向了右后方。",
        "球到之前回头的那一眼，H8看到了H9。",
        "H8一脚42米的传球找到了H9。",
        "如果没有那一眼，H8会把球传给H4。",
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
        "zh": ["H8在对方半场中路偏右接球。", "球到之前回头的那一眼，H8看到了H9。",
               "球到之前，H8扭头看向了右后方。"],
        "en": ["H8 received the ball in the opponents' half, right of centre.",
               "When H8 looked over his shoulder before the ball arrived, he saw H9.",
               "Before the ball reached him, H8 looked over his right shoulder."],
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
    """Enforced in code, not only in the prompt: a line with an xT or probability claim is dropped
    for audio description, while the analyst still hears it from the same model reply."""
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
    assert aired == ["reception_zone", "blind_side"]
    assert not {c.id for c in ad.payload.claims} & ANALYST_NUMBERS
    assert not any("chance" in t or "expected threat" in t or "%" in t
                   for t in (line.text for line in ad.payload.lines))  # fmt: skip
    assert check_payload(ad.payload) == []
    notes = next(s for s in r.trace if s.step == "narration").notes
    assert any(f"{AD}/en" in n and "pass_success" in n for n in notes)
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
    assert [line.id for line in by[("analyst", "en")].lines] == ["L1", "L2"]


@pytest.mark.parametrize("tier", ["calm", "excited", "clutch"])
@pytest.mark.parametrize("language", ["en", "zh"])
def test_audio_description_is_voiced_calm_and_slower_whatever_the_tier(tier, language):
    from agents.delivery import PROSODY

    line = ScriptLine(id="L1", speaker="pbp", text="H8 looked over his right shoulder.", claims=[])
    for styles in (ALL_STYLES, EXCITED_STYLES, set()):
        ssml = ssml_for_line(line, language, tier, styles, persona=AD)
        root = ET.fromstring(ssml)
        (prosody,) = [e for e in root.iter() if e.tag.endswith("prosody")]
        assert float(prosody.get("rate").rstrip("%")) < 0  # slower than the voice's default
        assert float(prosody.get("pitch").rstrip("%")) == 0
        assert not any(f'style="{s}"' in ssml for s in EXCITED_STYLES)
        if styles == ALL_STYLES:
            assert 'style="narration-relaxed"' in ssml
        else:
            assert "express-as" not in ssml  # no calm style on offer: prosody only
    rate = float(PROSODY[tier][0].rstrip("%"))
    other = ssml_for_line(line, language, tier, set(), persona="casual")
    assert f'rate="{PROSODY[tier][0]}"' in other and rate >= 0  # other personas keep the tier


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
    from agents.delivery import STYLE_PREFERENCE, VOICES

    moment = _with_delta(ctx, delta)
    styles = {voice: ALL_STYLES for voice in VOICES.values()}
    r = breakdown(moment, client=None, personas=("casual", AD), languages=("en", "zh"),
                  voice_styles=styles)  # fmt: skip
    assert r.tier == tier
    for language in ("en", "zh"):
        casual, ad = _script(r, "casual", language), _script(r, AD, language)
        assert {cue.style for cue in casual.voice} == {STYLE_PREFERENCE[tier][0]}
        assert {cue.style for cue in ad.voice} == {"narration-relaxed"}
        for cue in ad.voice:
            ET.fromstring(cue.ssml)
            assert 'rate="-' in cue.ssml and cue.voice == VOICES[(language, cue.speaker)]
    assert len({cue.cache_key for s in r.scripts for cue in s.voice}) == sum(
        len(s.voice) for s in r.scripts
    )  # an audio-description clip is never the commentary clip of the same line
