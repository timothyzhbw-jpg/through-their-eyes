"""Acceptance checks for lens selection by counterfactual impact (SPEC 5.2)."""

import json
import math

import numpy as np
import pytest

from explain.cards import LensResult, MomentCard
from explain.lenses import (
    LENS_PRECEDENCE,
    TIE_TOLERANCE_XT,
    compute_lenses,
    hero_card,
    most_informative_scan,
    replay_belief,
    select_lens,
)
from explain.moments import detect_moments
from sim.engine import Simulation

SCENARIO = "blind_side_run"
HERO_SEEDS = (100, 101, 102, 103, 104)


@pytest.fixture(scope="module")
def hero_cards():
    return {seed: hero_card(SCENARIO, seed) for seed in HERO_SEEDS}


# --- selection rule ----------------------------------------------------------------------


def _lens(name, delta, available=True):
    return LensResult(lens=name, available=available, delta_xt=delta if available else None)


def test_the_largest_absolute_delta_wins_even_when_negative():
    lenses = [_lens("scan", 0.02), _lens("space", 0.01), _lens("pressure", -0.05)]
    assert select_lens(lenses) == "pressure"


def test_near_ties_go_to_the_documented_precedence():
    assert LENS_PRECEDENCE == ("scan", "space", "pressure")
    eps = TIE_TOLERANCE_XT / 2
    assert select_lens([_lens("space", 0.04), _lens("scan", 0.04 - eps)]) == "scan"
    assert select_lens([_lens("pressure", 0.04), _lens("space", 0.04 - eps)]) == "space"
    assert select_lens([_lens("space", 0.04), _lens("scan", 0.04 - 3 * eps)]) == "space"


def test_unavailable_lenses_are_ignored():
    assert select_lens([_lens("scan", None, available=False), _lens("space", 0.001)]) == "space"
    assert select_lens([_lens("scan", None, available=False)]) is None
    assert select_lens([]) is None


# --- belief reconstruction ---------------------------------------------------------------


@pytest.mark.parametrize("seed", [100, 101])
def test_replayed_belief_matches_the_sim_at_the_decision(seed):
    run = Simulation.from_scenario(SCENARIO, seed).run()
    decision = run.hero_decision()
    beliefs = replay_belief(run, run.index(decision.player), decision.frame)
    pos, _, age = beliefs[decision.frame].estimate(decision.frame, run.dt)
    error = np.linalg.norm(pos - run.pos[decision.frame], axis=-1)
    for k, pid in enumerate(run.ids):
        if pid == decision.player:
            continue
        assert error[k] == pytest.approx(decision.belief_error[pid], abs=1e-9)
        assert age[k] == pytest.approx(decision.belief_age[pid], abs=1e-9)


@pytest.mark.parametrize("seed", HERO_SEEDS)
def test_the_most_informative_scan_is_the_key_scan(seed):
    run = Simulation.from_scenario(SCENARIO, seed).run()
    scan, update = most_informative_scan(run, run.hero_decision())
    assert scan.id == run.key_scan().id
    assert update > 5.0  # m: the runner was believed marked, then seen free


# --- the hero moment ---------------------------------------------------------------------


@pytest.mark.parametrize("seed", HERO_SEEDS)
def test_hero_card_records_all_three_lenses_and_the_scan_wins(hero_cards, seed):
    card = hero_cards[seed]
    assert card.kind == "decision_after_scan" and card.player == "H8"
    lenses = {lens.lens: lens for lens in card.candidate_lenses}
    assert set(lenses) == {"scan", "space", "pressure"}
    for lens in lenses.values():
        assert lens.available and math.isfinite(lens.delta_xt)
    assert card.selected_lens == "scan"
    scan = lenses["scan"]
    assert scan.metrics["counterfactual_action"] != scan.metrics["factual_action"]
    assert scan.metrics["decision_changed"] is True
    assert scan.delta_xt > 0.0
    assert scan.delta_xt >= lenses["space"].delta_xt - TIE_TOLERANCE_XT


def test_space_lens_compares_the_chosen_option_with_the_best_alternative(hero_cards):
    space = next(lens for lens in hero_cards[100].candidate_lenses if lens.lens == "space")
    m = space.metrics
    assert m["chosen_action"] == "pass:H9" and m["alternative_action"] != "pass:H9"
    assert space.delta_xt == pytest.approx(m["chosen_value"] - m["alternative_value"], abs=1e-4)
    assert 0.0 <= m["chosen_pitch_control"] <= 1.0
    assert m["chosen_xt"] > m["alternative_xt"]


def test_pressure_lens_is_the_value_the_action_saved_from_the_press(hero_cards):
    pressure = next(lens for lens in hero_cards[100].candidate_lenses if lens.lens == "pressure")
    m = pressure.metrics
    assert 0.0 <= m["pressure_on_carrier"] <= 1.0
    expected = m["pressure_on_carrier"] * (m["chosen_value"] - m["turnover_value"])
    assert pressure.delta_xt == pytest.approx(expected, abs=1e-4)


def test_lens_selection_is_deterministic_for_a_seed(hero_cards):
    again = hero_card(SCENARIO, 100)
    assert again.model_dump_json() == hero_cards[100].model_dump_json()


def test_hero_card_json_has_all_three_lenses(hero_cards):
    text = hero_cards[100].model_dump_json(indent=2)
    data = json.loads(text)
    assert [lens["lens"] for lens in data["candidate_lenses"]] == ["scan", "space", "pressure"]
    assert data["selected_lens"] == "scan"
    assert MomentCard.model_validate_json(text) == hero_cards[100]


def test_moments_without_a_decision_get_no_lenses():
    run = Simulation.from_scenario(SCENARIO, 100).run()
    cards = [c for c in detect_moments(run) if c.decision_frame is None]
    assert cards  # the sprints and the forced build-up pass
    for card in cards:
        out = compute_lenses(run, card)
        assert out.candidate_lenses == [] and out.selected_lens is None
