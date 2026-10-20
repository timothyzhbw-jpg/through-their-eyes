"""Second hero scenario: playing out of a high press (SPEC 3.6, 5.2).

The acceptance check on held-out seeds is `eval/hero_lens.py` (report in
eval/reports/hero_lens_press_escape.md). These checks run on design seeds.
"""

import pytest

from explain.lenses import explain_moment
from explain.moments import (
    PRESSED_THRESHOLD,
    detect_moments,
    detect_pressed_decisions,
    pressure_on_carrier,
)
from sim.counterfactual import hero_counterfactual, possession_result
from sim.engine import Simulation
from sim.scenarios import SCENARIOS
from tests.test_moments import TOY, _decision, _event, _pass, _toy_run

SCENARIO = "press_escape"
DESIGN_SEEDS = [0, 1, 2, 3, 4, 5]


@pytest.fixture(scope="module")
def runs():
    return {s: hero_counterfactual(SCENARIO, s) for s in DESIGN_SEEDS}


def _hero_card(run):
    d = run.hero_decision()
    return next(c for c in detect_moments(run) if (c.actor, c.anchor_frame) == (d.player, d.frame))


def test_the_scenario_names_its_lens_and_intervention():
    cls = SCENARIOS[SCENARIO]
    assert cls.lens == "pressure"
    assert cls.intervention == "force:carry"
    assert cls.tackles
    assert SCENARIOS["blind_side_run"].lens == "scan"
    assert SCENARIOS["blind_side_run"].intervention == "drop_scan"


def test_tackles_are_off_in_the_other_scenarios():
    assert not SCENARIOS["blind_side_run"].tackles
    assert not SCENARIOS["possession_play"].tackles


def test_same_seed_twice_in_the_same_environment_is_byte_identical():
    a = Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert a == Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert a != Simulation.from_scenario(SCENARIO, seed=8).run().to_bytes()


def test_resume_from_snapshot_without_overrides_reproduces_the_run():
    full = Simulation.from_scenario(SCENARIO, seed=2).run().to_bytes()
    sim = Simulation.from_scenario(SCENARIO, seed=2)
    sim.run_until(20)
    assert Simulation.resume(sim.snapshot()).run().to_bytes() == full


def test_the_hero_decides_under_heavy_pressure(runs):
    for seed, cf in runs.items():
        d = cf.factual.hero_decision()
        assert d is not None and d.player == "H4", seed
        assert pressure_on_carrier(cf.factual, d.frame) >= PRESSED_THRESHOLD, seed


def test_the_hero_decision_is_a_pressed_decision_moment(runs):
    for seed, cf in runs.items():
        card = _hero_card(cf.factual)
        assert card.kind == "pressed_decision", seed
        assert card.id.startswith("m:pressed_decision:H4:")
        assert {"reception", "action"} <= set(card.anchors)
        assert card.metrics["pressure_on_carrier"] >= PRESSED_THRESHOLD


def test_the_pressure_lens_explains_most_design_seeds(runs):
    picked = 0
    for cf in runs.values():
        card = explain_moment(_hero_card(cf.factual), cf.factual)
        picked += card.selected_lens == "pressure"
        pressure = card.lens("pressure")
        assert pressure.available and pressure.delta_xt > 0  # the pass escaped the press
    assert picked >= 0.6 * len(runs)


def test_holding_the_ball_under_the_press_loses_it(runs):
    lost = 0
    for seed, cf in runs.items():
        assert cf.counterfactual_action == "carry", seed
        assert possession_result(cf.factual) == "kept", seed
        if possession_result(cf.counterfactual) == "lost":
            lost += 1
            tackle = next(e for e in cf.counterfactual.events if e.type == "tackle")
            assert tackle.attrs["won_from"] == "H4"
            assert tackle.team == 1
            change = next(e for e in cf.counterfactual.events if e.type == "possession_change")
            assert (change.frame, change.player) == (tackle.frame, tackle.player)
            assert cf.counterfactual.owner[tackle.frame] == cf.counterfactual.index(tackle.player)
    assert lost >= 0.6 * len(runs)


def test_forcing_the_carry_leaves_every_draw_of_other_players_unchanged():
    from sim.counterfactual import force_action_counterfactual

    result = force_action_counterfactual(SCENARIO, 3, "carry", record_draws=True)
    for player in ("H2", "A9", "H6", "A1"):
        f, c = result.factual.draws_for(player), result.counterfactual.draws_for(player)
        common = f.keys() & c.keys()
        assert len(common) > 0.5 * min(len(f), len(c))
        assert all(f[k] == c[k] for k in common)


def test_the_hero_flip_scenario_keeps_its_scan_story():
    cf = hero_counterfactual("blind_side_run", 3)
    assert cf.scan_id.startswith("scan:H8:")
    assert cf.factual_action != cf.counterfactual_action


# --- the detector on toy runs ------------------------------------------------------------


def _pressed_run(gap: float):
    """H8 receives at frame 30 and passes at 35, with A6 `gap` metres in front of him."""
    run = _toy_run(120, [_event("reception", "H8", 30), _pass(35, 75)], [_decision(35)])
    run.pos[:, [p for p, *_ in TOY].index("A6")] = [gap, 0.0]
    run.owner[30:36] = 0
    run.ball_pos[:, :2] = run.pos[:, 0]
    return run


def test_a_decision_under_heavy_pressure_is_a_moment():
    (card,) = detect_pressed_decisions(_pressed_run(gap=1.5))
    assert card.kind == "pressed_decision"
    assert card.anchor_frame == 35
    assert card.anchors["reception"] == "reception:H8:0030"
    assert card.anchors["action"] == "pass:H8:0035"
    assert card.metrics["pressure_on_carrier"] >= PRESSED_THRESHOLD
    assert card.metrics["main_presser"] == "A6"
    assert card.candidate_lenses == ["scan", "space", "pressure"]


def test_a_decision_with_space_around_him_is_not_a_pressed_decision():
    assert detect_pressed_decisions(_pressed_run(gap=15.0)) == []


def test_a_pressed_decision_after_a_scan_is_one_card_with_both_tags():
    run = _pressed_run(gap=1.5)
    run.events.append(_event("scan", "H8", 20, end=26, key=False))
    (card,) = [c for c in detect_moments(run) if not c.live_only]
    assert card.kind == "pressed_decision"
    assert {"pressed_decision", "decision_after_scan"} <= set(card.tags)
    assert card.metrics["scans_in_window"] == 1  # merged from the scan detector
    assert card.anchors["last_scan"] == "scan:H8:0020"
