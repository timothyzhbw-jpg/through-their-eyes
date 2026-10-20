"""Acceptance checks for lens selection by counterfactual impact (SPEC 5.2)."""

import json
import math

import numpy as np
import pytest

from analytics.pitch_control import pitch_control
from analytics.vision import wrap_angle
from analytics.xt import xt_for
from explain.cards import LensResult
from explain.lenses import (
    LENS_ORDER,
    believed_position,
    explain_moment,
    pick_lens,
    scan_candidates,
    scan_lens,
)
from explain.moments import detect_moments
from sim.counterfactual import drop_scan_counterfactual
from sim.engine import Simulation
from sim.perception import ForcedScan
from sim.scenarios import SCENARIOS
from sim.scenarios.blind_side_run import BlindSideRun

SCENARIO = "blind_side_run"
HERO, RUNNER = "H8", "H9"


def _hero(run):
    card = next(c for c in detect_moments(run) if c.kind == "decision_after_scan")
    return explain_moment(card, run)


@pytest.fixture(scope="module")
def run3():
    return Simulation.from_scenario(SCENARIO, seed=3).run()


@pytest.fixture(scope="module")
def hero3(run3):
    return _hero(run3)


def test_the_hero_card_records_all_three_lenses_in_xt(hero3):
    assert [lens.lens for lens in hero3.lenses] == list(LENS_ORDER)
    for lens in hero3.lenses:
        assert lens.available and lens.unit == "xT"
        assert math.isfinite(lens.delta_xt)
    data = json.loads(hero3.model_dump_json())
    assert data["selected_lens"] == "scan"
    assert [entry["lens"] for entry in data["lenses"]] == ["scan", "space", "pressure"]


def test_the_scan_lens_drops_the_key_scan_and_matches_the_counterfactual(run3, hero3):
    scan = hero3.lens("scan")
    assert scan.metrics["scan_id"] == run3.key_scan().id
    result = drop_scan_counterfactual(SCENARIO, 3, scan.metrics["scan_id"])
    assert scan.metrics["realized_delta_xt"] == pytest.approx(result.delta_xt, abs=1e-6)
    m = scan.metrics
    assert scan.delta_xt == pytest.approx(
        m["factual_value_xt"] - m["counterfactual_value_xt"], abs=1e-6
    )
    assert scan.metrics["factual_action"] == "pass:H9"
    assert scan.metrics["counterfactual_action"] == result.counterfactual_action
    assert scan.metrics["decision_changed"] is True
    assert scan.metrics["scan_id"] in scan.evidence


def test_the_reconstructed_belief_matches_the_sim_at_the_decision(run3):
    decision = run3.hero_decision()
    for j, pid in enumerate(run3.ids):
        if pid == HERO:
            continue
        believed = believed_position(run3, HERO, pid, decision.frame)
        error = float(np.linalg.norm(believed - run3.pos[decision.frame, j]))
        assert error == pytest.approx(decision.belief_error[pid], abs=1e-9)


def test_the_key_scan_carries_the_largest_belief_update_about_the_runner(run3):
    decision = run3.hero_decision()
    candidates = scan_candidates(run3, decision)
    best = max(candidates, key=lambda c: c["belief_update_m"])
    assert best["scan_id"] == run3.key_scan().id
    assert best["belief_update_m"] > 5.0


class IdleLookFirst(BlindSideRun):
    """The hero scenario plus one early look by H8 to the side away from the runner."""

    name = "blind_side_run_idle_look"
    idle_frame = 2

    def forced_scans(self, sim, frame):
        if frame != self.idle_frame:
            return super().forced_scans(sim, frame)
        me = sim.pos[self.i_hero]
        ball = float(np.arctan2(*(sim.ball_pos[:2] - me)[::-1]))
        runner = float(np.arctan2(*(sim.pos[self.i_runner] - me)[::-1]))
        away = -np.sign(wrap_angle(runner - ball))
        return {self.i_hero: ForcedScan(target_yaw=ball + away * np.deg2rad(80.0), dwell_s=0.1)}


def test_a_scan_that_changes_nothing_has_no_impact_and_loses_to_space(monkeypatch):
    monkeypatch.setitem(SCENARIOS, IdleLookFirst.name, IdleLookFirst)
    run = Simulation.from_scenario(IdleLookFirst.name, seed=3).run()
    hero = _hero(run)
    decision = run.hero_decision()
    early = min(scan_candidates(run, decision), key=lambda c: c["start_frame"])
    assert early["start_frame"] == IdleLookFirst.idle_frame
    assert early["scan_id"] != run.key_scan().id and early["belief_update_m"] == 0.0
    idle = scan_lens(run, decision, early["scan_id"])
    assert idle.metrics["decision_changed"] is False
    assert idle.delta_xt == pytest.approx(0.0, abs=1e-6)
    assert pick_lens([idle, hero.lens("space"), hero.lens("pressure")]) == "space"


def test_the_space_lens_compares_the_chosen_option_with_the_best_alternative(run3, hero3):
    space = hero3.lens("space")
    decision = run3.hero_decision()
    rows = {row["action"]: row for row in space.rows}
    assert set(rows) == {o.action for o in decision.options}
    best_alt = max(v["value_xt"] for a, v in rows.items() if a != decision.chosen)
    assert space.delta_xt == pytest.approx(rows[decision.chosen]["value_xt"] - best_alt, abs=1e-6)
    assert space.metrics["best_alternative"] != decision.chosen
    # Recompute the chosen pass's value from the kernels.
    f, team = decision.frame, np.array([p.team for p in run3.players])
    target = np.array([next(o.target for o in decision.options if o.action == "pass:H9")])
    pc = pitch_control(target, run3.pos[f, team == 0], run3.vel[f, team == 0],
                       run3.pos[f, team == 1], run3.vel[f, team == 1])[0]  # fmt: skip
    value = pc * xt_for(target[0], 1) - (1 - pc) * xt_for(target[0], -1)
    assert rows["pass:H9"]["value_xt"] == pytest.approx(value, abs=1e-6)


def test_the_pressure_lens_is_the_drop_in_expected_turnover_cost(hero3):
    m = hero3.lens("pressure").metrics
    assert 0.0 <= m["pressure_before"] <= 1.0 and 0.0 <= m["pressure_after"] <= 1.0
    assert m["cost_before_xt"] == pytest.approx(
        m["pressure_before"] * m["stake_before_xt"], abs=1e-6
    )
    assert m["cost_after_xt"] == pytest.approx(m["pressure_after"] * m["stake_after_xt"], abs=1e-6)
    delta = m["cost_before_xt"] - m["cost_after_xt"]
    assert hero3.lens("pressure").delta_xt == pytest.approx(delta, abs=1e-6)


def test_pick_lens_takes_the_largest_absolute_delta_with_a_fixed_tie_order():
    def lens(name, delta, available=True):
        return LensResult(lens=name, available=available, delta_xt=delta)

    assert pick_lens([lens("scan", 0.02), lens("space", -0.05), lens("pressure", 0.01)]) == "space"
    assert pick_lens([lens("pressure", 0.03), lens("space", 0.03), lens("scan", -0.03)]) == "scan"
    assert pick_lens([lens("scan", 0.9, False), lens("pressure", 0.01)]) == "pressure"
    assert pick_lens([lens("scan", None, False)]) is None


def test_lens_selection_is_deterministic_for_a_seed():
    a = _hero(Simulation.from_scenario(SCENARIO, seed=11).run())
    b = _hero(Simulation.from_scenario(SCENARIO, seed=11).run())
    assert a.model_dump_json() == b.model_dump_json()


@pytest.mark.parametrize("seed", [100, 107, 119, 124, 138])
def test_the_hero_moment_is_a_scan_story(seed):
    card = _hero(Simulation.from_scenario(SCENARIO, seed=seed).run())
    assert card.selected_lens == "scan"
    scan = card.lens("scan")
    others = [abs(lens.delta_xt) for lens in card.lenses if lens.lens != "scan"]
    assert abs(scan.delta_xt) > max(others)


def test_a_moment_without_a_decision_falls_back_to_the_lenses_it_has(run3):
    card = next(c for c in detect_moments(run3) if c.actor == "H4")  # the scripted first pass
    card = explain_moment(card, run3)
    assert not card.lens("scan").available and card.lens("scan").note
    assert not card.lens("space").available
    assert card.lens("pressure").available
    assert card.selected_lens == "pressure"


def test_live_only_moments_get_no_lenses(run3):
    sprint = next(c for c in detect_moments(run3) if c.kind == "sprint")
    explained = explain_moment(sprint, run3)
    assert explained.lenses == [] and explained.selected_lens is None
