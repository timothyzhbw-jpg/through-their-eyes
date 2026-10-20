"""He thought vs it was (SPEC 5.1): P(success) of a pass on the belief and on the true state."""

import pytest

from explain.builders import hero_claims
from explain.functions import EvalContext, Inconclusive, Refuted, same_target_on_truth, true_options
from explain.moments import detect_moments
from explain.render import render_claim
from explain.verifier import Verifier
from sim.counterfactual import drop_scan_counterfactual


@pytest.fixture(scope="module")
def world():
    cf = drop_scan_counterfactual("blind_side_run", 3)
    cards = {c.id: c for c in detect_moments(cf.factual)}
    ctx = EvalContext(cf.factual, counterfactuals={cf.scan_id: cf}, cards=cards)
    return cf, ctx, hero_claims(ctx, cf), Verifier(ctx)


def _option(run, action):
    d = run.hero_decision()
    return d, next(o for o in d.options if o.action == action)


def test_claims_have_the_right_kind_verify_and_render(world):
    _, _, claims, verifier = world
    assert claims["pass_success"].kind == "computed"
    assert claims["cf_pass_success"].kind == "counterfactual"
    for kind in ("pass_success", "cf_pass_success"):
        verdict = verifier.verify(claims[kind])
        assert verdict.status == "supported", verdict.reason
        for lang in ("en", "zh"):
            out = render_claim(claims[kind], verdict, lang)
            assert out.ok, out.violations


def test_without_the_look_he_underrated_the_runner(world):
    cf, _, claims, _ = world
    c = claims["cf_pass_success"]
    assert c.slots["receiver"].ref == "H9"
    assert c.slots["p_belief"].value < 0.1
    assert c.slots["p_true"].value - c.slots["p_belief"].value > 0.5
    d, belief = _option(cf.counterfactual, "pass:H9")
    assert true_options(cf.counterfactual, d)["pass:H9"].p_success > 0.8 > belief.p_success


def test_with_the_look_the_chosen_pass_was_as_good_as_he_thought_or_better(world):
    cf, _, claims, _ = world
    c = claims["pass_success"]
    assert cf.factual.hero_decision().chosen == f"pass:{c.slots['receiver'].ref}"
    assert c.slots["p_true"].value >= c.slots["p_belief"].value
    d, chosen = _option(cf.factual, "pass:H9")
    # He saw the runner: the believed target is good on the truth too.
    assert same_target_on_truth(cf.factual, d, chosen) == pytest.approx(
        true_options(cf.factual, d)["pass:H9"].p_success, abs=0.02
    )


def test_holding_a_misplaced_target_fixed_says_nothing_about_the_runner(world):
    cf, *_ = world
    d, h9 = _option(cf.counterfactual, "pass:H9")
    assert same_target_on_truth(cf.counterfactual, d, h9) < 0.01  # H9 is not where he thought


def test_perturbed_values_and_receivers_are_refuted(world):
    _, _, claims, verifier = world
    c = claims["pass_success"]
    wrong_p = c.model_copy(
        update={"slots": {**c.slots, "p_true": c.slots["p_true"].model_copy(update={"value": 0.7})}}
    )
    assert verifier.verify(wrong_p).status == "refuted"
    swapped = c.model_copy(
        update={
            "slots": {**c.slots, "receiver": c.slots["receiver"].model_copy(update={"ref": "H4"})}
        }
    )
    assert verifier.verify(swapped).status == "refuted"


def test_metric_errors(world):
    _, ctx, _, _ = world
    d = ctx.run.hero_decision()
    at = f"pass:H8:{d.frame:04d}"

    def value(**args):
        return ctx.value({"fn": "metric_at", "args": {"metric": "pass_success", "player": "H8",
                                                      "anchor": at, **args}})  # fmt: skip

    assert value(receiver="H9") == pytest.approx(_option(ctx.run, "pass:H9")[1].p_success)
    with pytest.raises(Refuted):
        value(receiver="H99")
    with pytest.raises(Refuted):
        value(receiver="H8")  # he does not pass to himself
    with pytest.raises(Inconclusive):
        value(receiver="H9", state="dreamt")
