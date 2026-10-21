"""The shot hero in the app (SPEC 3.6, 5, 6): the striker's look at the keeper, a placed shot.

`far_post_finish`'s hero H9 picks `shot:far` because one look showed him the keeper at the near
post. A placed shot is valued on the truth (its chance of a goal with the keeper where he is), so
the scan lens tells that story; the claims, narration and what-ifs say it in words.
"""

import asyncio

import pytest

from agents.context import MomentContext
from agents.delivery import ANALYST_NUMBERS
from agents.whatif import answer_question
from agents.workflow import run_breakdown
from explain.functions import true_decision_context
from sim.decision import placed_shot_value

SCENARIO, DEMO, HERO, KEEPER = "far_post_finish", 11, "H9", "A1"
PERSONAS = ("casual", "analyst", "player_fan", "coach", "audio_description")
SHOT_CLAIMS = {"scan_at_goal", "keeper_seen_in_scan", "keeper_near_side", "shot_placement", "goal",
               "shot_speed", "shot_thought_vs_was", "cf_shot", "cf_keeper_age",
               "cf_shot_value"}  # fmt: skip


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load(SCENARIO, DEMO)


@pytest.fixture(scope="module")
def breakdown(ctx):
    return asyncio.run(run_breakdown(ctx, client=None, personas=PERSONAS, languages=("en", "zh")))


def test_the_scan_lens_values_the_placed_shot_on_the_truth(ctx):
    card = ctx.card
    assert card.selected_lens == "scan"
    scan = card.lens("scan")
    m = scan.metrics
    assert m["scan_id"] == ctx.key_scan.id
    assert (m["factual_action"], m["counterfactual_action"]) == ("shot:far", "shot:near")
    d = ctx.run.hero_decision()
    truth = true_decision_context(ctx.run, ctx.run.index(HERO), d.frame)
    assert m["factual_value_xt"] == pytest.approx(placed_shot_value(truth, "far"), abs=1e-6)
    assert scan.delta_xt > 0.3  # far post on the truth against the near post he picks without it
    # The space lens's best alternative is the near post too: the tie goes to scan (SPEC 5.2).
    assert card.lens("space").delta_xt == scan.delta_xt


def test_the_old_shot_value_is_kept_for_heroes_without_placed_shots():
    ctx = MomentContext.load("blind_side_run", 3)
    assert ctx.card.selected_lens == "scan"
    assert not any(c.startswith(("shot_", "cf_shot", "keeper_")) for c in ctx.claims)


def test_every_shot_claim_is_built_and_supported(ctx):
    assert set(ctx.claims) >= SHOT_CLAIMS
    assert "cf_value" not in ctx.claims  # a goal's possession value is an outcome, not a chance
    assert all(v.status == "supported" for v in ctx.verdicts.values())
    kinds = {cid: ctx.claims[cid].kind for cid in SHOT_CLAIMS}
    assert kinds["shot_placement"] == kinds["goal"] == kinds["keeper_near_side"] == "observed"
    assert kinds["keeper_seen_in_scan"] == kinds["shot_thought_vs_was"] == "computed"
    assert {c for c, k in kinds.items() if k == "counterfactual"} == {
        "cf_shot", "cf_keeper_age", "cf_shot_value"
    }  # fmt: skip


def test_the_counterfactual_shot_is_saved_and_the_chance_matches_the_lens(ctx):
    cf_shot = ctx.claims["cf_shot"]
    assert cf_shot.slots["keeper"].ref == KEEPER and "saves it" in cf_shot.template
    m = ctx.card.lens("scan").metrics
    value = ctx.claims["cf_shot_value"].slots
    assert value["p1"].value == round(m["factual_value_xt"], 2)
    assert value["p0"].value == round(m["counterfactual_value_xt"], 2)


def test_every_persona_tells_the_finish_in_both_languages(breakdown):
    assert breakdown.findings.lens == "scan"
    assert breakdown.findings.headline[0] == "keeper_seen_in_scan"
    for script in breakdown.scripts:
        lines = script.payload.lines
        claims = {c for line in lines for c in line.claims}
        assert lines and not script.dropped, (script.persona, script.language)
        if script.persona == "audio_description":
            assert not claims & ANALYST_NUMBERS
            assert {"shot_placement", "goal"} <= claims


@pytest.mark.parametrize(
    "question,action",
    [("What if he had gone near post?", "shot:near"), ("如果他打近角呢？", "shot:near"),
     ("What if he had shot far post?", "shot:far"), ("What if he had passed to H7?", "pass:H7")],
)  # fmt: skip
def test_what_if_he_had_placed_it_elsewhere(ctx, question, action):
    answer = asyncio.run(answer_question(ctx, question))
    assert answer.action == action
    lines = answer.payload.lines
    assert lines and all(c["verdict"] == "supported" for c in answer.payload.model_dump()["claims"])
    if action == "shot:near":
        assert [line.claims for line in lines] == [["whatif_outcome"], ["whatif_chance"]]
        assert "would have saved it" in lines[0].text
