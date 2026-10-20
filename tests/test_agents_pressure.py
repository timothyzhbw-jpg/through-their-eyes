"""The crew on a moment the pressure lens explains (SPEC 5.2, 5.3, 6): `press_escape`, seed 0.

Offline, so every agent step is its template; the model run is recorded in the PR, not here.
"""

import asyncio
import json

import pytest

from agents import tools
from agents.context import MomentContext
from agents.plan import template_plan, validate_plan
from agents.testing import FakeChatClient
from agents.whatif import answer_question
from agents.workflow import breakdown
from explain.render import check_caption, check_payload


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("press_escape", seed=0)


@pytest.fixture(scope="module")
def offline(ctx):
    return breakdown(ctx, client=None, personas=("casual", "analyst"), languages=("en", "zh"))


def test_the_moment_is_the_pressed_decision_and_its_counterfactual_keeps_the_ball(ctx):
    assert ctx.card.id.startswith("m:pressed_decision:H4:")
    assert ctx.card.selected_lens == "pressure"
    assert ctx.key_scan is None
    assert ctx.intervention == "force:carry"
    assert ctx.cf.counterfactual_action == "carry"
    assert all(v.status == "supported" for v in ctx.verdicts.values())
    assert {"heavy_pressure", "pressure_at_pass", "presser_distance", "cf_carry_lost",
            "cf_value"} <= set(ctx.supported)  # fmt: skip
    assert ctx.claims["cf_carry_lost"].kind == "counterfactual"
    assert ctx.claims["heavy_pressure"].terms == ["under heavy pressure"]


def test_offline_breakdown_tells_the_pressure_story(ctx, offline):
    r = offline
    assert r.request.moment == ctx.card.id
    assert r.findings.lens == "pressure"
    assert r.findings.headline[:2] == ["heavy_pressure", "cf_carry_lost"]
    assert validate_plan(r.plan, ctx) == []
    for script in r.scripts:
        assert check_payload(script.payload) == []
        claims = {c.id: c for c in script.payload.claims}
        assert all(c.verdict == "supported" for c in claims.values())
        assert "cf_carry_lost" in claims
        assert not script.dropped and script.rewrites == 0
        assert {line.speaker for line in script.lines} == {"pbp", "color"}
    casual_en = next(s for s in r.scripts if (s.persona, s.language) == ("casual", "en"))
    assert [line.text for line in casual_en.payload.lines] == [
        "Watch this.",
        "H4 was under heavy pressure when he released the ball.",
        "H7 took the pass from H4.",
        "Had H4 kept the ball, A11 would have won it off him.",
    ]


def test_the_template_plan_has_no_scan_marker_and_ghosts_the_forced_carry(ctx):
    plan = template_plan(ctx)
    assert validate_plan(plan, ctx) == []
    dos = [s.do for s in plan.steps]
    assert "scan_marker" not in dos and "pov" in dos
    ghost = next(s for s in plan.steps if s.do == "ghost" and s.kind == "counterfactual")
    assert ghost.cf == ctx.counterfactual_id
    pov = next(s for s in plan.steps if s.do == "pov")
    assert pov.from_ < 0 <= pov.to + 1e-9  # the moments before the decision


def test_a_model_plan_must_not_invent_a_scan_marker(ctx):
    plan = template_plan(ctx).model_dump(by_alias=True)
    plan["steps"].insert(3, {"t": 1.0, "do": "scan_marker", "scan": "scan:H4:0001",
                             "label_claim": None})  # fmt: skip
    assert any("unknown scan" in e for e in validate_plan(plan, ctx))


def test_the_lexicon_term_is_backed_only_by_its_claim(ctx):
    text = "Under heavy pressure, he played it out."
    assert [v.kind for v in check_caption(text, [])] == ["lexicon"]
    backed = {t for t in ctx.claims["heavy_pressure"].terms}
    assert check_caption(text, [], backed_terms=backed) == []


def test_agent_outputs_are_used_through_verified_claims(ctx):
    replies = {
        "director": {"priority": "high", "reason": "He gets the ball out before the press."},
        "analyst": {"lens": "pressure", "headline": ["heavy_pressure", "cf_carry_lost"],
                    "supporting": ["presser_distance"], "angle": "He beat the press."},
        "telestrator": template_plan(ctx).model_dump(by_alias=True),
        "pbp": {"lines": [{"claim": "heavy_pressure", "connective": "Watch this."}]},
        "color": {"lines": [{"claim": "cf_carry_lost", "connective": None}]},
    }  # fmt: skip
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    assert r.findings.lens == "pressure" and r.plan_source == "agent"
    (script,) = r.scripts
    assert [line.text for line in script.payload.lines] == [
        "Watch this. H4 was under heavy pressure when he released the ball.",
        "Had H4 kept the ball, A11 would have won it off him.",
    ]


def test_what_if_he_had_carried_it(ctx):
    a = asyncio.run(answer_question(ctx, "What if he carried it?", "en"))
    assert a.action == "carry"
    texts = [line.text for line in a.payload.lines]
    assert texts[0] == "If H4 had carried it, A11 would have won the ball off him."
    assert all(c.verdict == "supported" for c in a.payload.claims)


def test_the_mcp_counterfactual_tool_names_the_intervention(ctx):
    data = json.loads(tools.run_counterfactual(ctx))
    assert data["intervention"] == "force:carry"
    assert data["dropped_scan"] is None
    assert (data["factual_action"], data["counterfactual_action"]) == ("pass:H7", "carry")
    assert data["delta_xt"] > 0


# --- the verifier refutes false versions of the pressure claims (SPEC 5.3) -------------------


def _with(claim, **slots):
    return claim.model_copy(
        update={"slots": {**claim.slots, **{k: claim.slots[k].model_copy(update=v)
                                             for k, v in slots.items()}}}
    )  # fmt: skip


@pytest.mark.parametrize(
    ("cid", "slots"),
    [
        ("cf_carry_lost", {"tackler": {"ref": "A9"}}),
        ("cf_carry_lost", {"player": {"ref": "H5"}}),
        ("heavy_pressure", {"player": {"ref": "H7"}}),
        ("presser_distance", {"presser": {"ref": "A10"}}),
        ("presser_distance", {"gap": {"value": 6.2}}),
        ("presser_distance", {"player": {"ref": "H6"}}),
        ("receiver_pressure", {"receiver": {"ref": "H5"}}),
        ("cf_value", {"dxt": {"value": 0.08}}),
    ],
)
def test_a_false_pressure_claim_is_refuted(ctx, cid, slots):
    from explain.verifier import Verifier

    verifier = Verifier(ctx.evaluator)
    assert verifier.verify(ctx.claims[cid]).status == "supported"
    assert verifier.verify(_with(ctx.claims[cid], **slots)).status == "refuted"
