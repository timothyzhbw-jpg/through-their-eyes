"""Blind-side alerts on the hero scenario, and the moment they trigger (SPEC 4.4, 5.1)."""

import pytest

from explain.moments import (
    BLIND_SIDE_PASS_S,
    blind_side_alerts,
    detect_blind_side_passes,
    detect_moments,
)
from sim.counterfactual import drop_scan_counterfactual

SCENARIO = "blind_side_run"
SEEDS = range(100, 120)


@pytest.fixture(scope="module")
def results():
    return [drop_scan_counterfactual(SCENARIO, seed) for seed in SEEDS]


def _alerts(run, observer: str, target: str):
    o, t = run.index(observer), run.index(target)
    return [a for a in blind_side_alerts(run).intervals if (a.observer, a.target) == (o, t)]


def test_the_alert_for_h9_behind_h8_is_on_before_the_key_scan_and_clears_during_it(results):
    for r in results:
        run = r.factual
        key = run.key_scan()
        # On by the frame the key scan starts (on some seeds it comes on that very frame).
        on_at_scan = [a for a in _alerts(run, "H8", "H9") if a.start <= key.frame <= a.end]
        assert len(on_at_scan) == 1, run.seed
        cleared = on_at_scan[0].end + 1  # the first frame without the alert
        assert key.frame < cleared <= key.attrs["end"], run.seed


def test_without_the_key_scan_the_alert_stays_on_until_he_passes(results):
    for r in results:
        run, key = r.counterfactual, r.factual.key_scan()
        decision = run.hero_decision().frame
        on = [a for a in _alerts(run, "H8", "H9") if a.start <= key.frame <= a.end]
        assert len(on) == 1 and on[0].end >= decision - 1, run.seed


def test_a_pass_to_the_target_of_a_blind_side_alert_is_a_moment(results):
    played = [r.factual for r in results if r.factual_action == "pass:H9"]
    assert len(played) >= 0.6 * len(results)  # the hero gate (SPEC 3.6) on these seeds
    for run in played:
        (card,) = detect_blind_side_passes(run)
        decision = run.hero_decision()
        assert card.kind == "blind_side_pass" and card.tags == ["blind_side_pass"]
        assert card.id == f"m:blind_side_pass:H8:{decision.frame:04d}"
        assert (card.actor, card.receiver) == ("H8", "H9")
        assert card.anchors["action"] == f"pass:H8:{decision.frame:04d}"
        assert card.anchors["completion"].startswith("reception:H9:")
        assert 0.0 <= card.metrics["alert_to_pass_s"] <= BLIND_SIDE_PASS_S
        assert card.metrics["alert_start_t"] < card.metrics["alert_end_t"]
        assert card.frame_start <= round(card.metrics["alert_start_t"] / run.dt)


def test_only_passes_to_the_alert_target_are_moments(results):
    for r in results:
        run = r.counterfactual  # without the key scan he plays safe (except in rare seeds)
        cards = detect_blind_side_passes(run)
        to_h9 = run.hero_decision().chosen == "pass:H9"
        assert len(cards) == int(to_h9), run.seed


def test_existing_moments_do_not_include_the_new_detector(results):
    for r in results[:5]:
        assert all(c.kind != "blind_side_pass" for c in detect_moments(r.factual))
        assert all("blind_side_pass" not in c.tags for c in detect_moments(r.factual))
