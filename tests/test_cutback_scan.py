"""Acceptance checks for the winger's cutback scan (SPEC 3.4–3.7).

The scene is designed on seeds 0–99. Its held-out decision gate belongs to
`eval.hero_flip`; these geometry and perception checks use design seeds only.
"""

import numpy as np
import pytest

from analytics.vision import player_visibility
from sim.ball import BallParams
from sim.config import DT, SimParams
from sim.engine import Simulation
from sim.overrides import DropScan
from sim.scenarios import SCENARIOS

SCENARIO = "cutback_scan"
HERO = "H7"
RUNNER = "H8"
DESIGN_SEEDS = (0, 1, 2, 3)


@pytest.fixture(scope="module")
def design_runs():
    runs = {}
    for seed in DESIGN_SEEDS:
        sim = Simulation.from_scenario(SCENARIO, seed=seed)
        factual = sim.run()
        key = factual.key_scan()
        before_scan = Simulation.from_scenario(SCENARIO, seed=seed)
        before_scan.run_until(key.frame)
        counterfactual = Simulation.resume(before_scan.snapshot(), [DropScan(key.id)]).run()
        runs[seed] = (sim.scenario, factual, counterfactual)
    return runs


def _runner_visibility(run):
    hero, runner = run.index(HERO), run.index(RUNNER)
    return np.array(
        [
            player_visibility(pos, yaw, np.linalg.norm(vel, axis=-1))[hero, runner]
            for pos, yaw, vel in zip(run.pos, run.head_yaw, run.vel, strict=True)
        ]
    )


def _nearest_opponent_distance(run, frame, player):
    i = run.index(player)
    opponents = [j for j, p in enumerate(run.players) if p.team != run.players[i].team]
    return float(np.min(np.linalg.norm(run.pos[frame, opponents] - run.pos[frame, i], axis=-1)))


def test_the_scenario_names_its_hero_runner_lens_and_intervention():
    cls = SCENARIOS[SCENARIO]
    assert (cls.hero, cls.runner, cls.lens, cls.intervention) == (HERO, RUNNER, "scan", "drop_scan")


def test_same_seed_twice_in_the_same_environment_is_byte_identical():
    first = Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert first == Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert first != Simulation.from_scenario(SCENARIO, seed=8).run().to_bytes()


def test_resume_from_snapshot_without_overrides_reproduces_the_run(design_runs):
    _, full, _ = design_runs[2]
    key = full.key_scan()
    for frame in (1, key.frame, full.hero_decision().frame):
        sim = Simulation.from_scenario(SCENARIO, seed=2)
        sim.run_until(frame)
        snapshot = sim.snapshot()
        assert Simulation.resume(snapshot).run().to_bytes() == full.to_bytes(), frame
        assert Simulation.resume(snapshot).run().to_bytes() == full.to_bytes(), frame


def test_the_same_twenty_two_players_take_part(design_runs):
    expected = {f"{team}{number}" for team in ("H", "A") for number in range(1, 12)}
    for seed, (_, factual, counterfactual) in design_runs.items():
        assert len(factual.ids) == len(counterfactual.ids) == 22, seed
        assert set(factual.ids) == set(counterfactual.ids) == expected, seed
        assert all(p.team == (0 if p.id.startswith("H") else 1) for p in factual.players), seed


def test_only_the_key_scan_shows_the_late_run_on_design_seeds(design_runs):
    threshold = SimParams().perception_threshold
    for seed, (scenario, factual, counterfactual) in design_runs.items():
        key = factual.key_scan()
        decision = factual.hero_decision()
        alternative = counterfactual.hero_decision()
        assert key.player == HERO and key.attrs["key"], seed
        assert 0 <= scenario.run_start < key.frame < decision.frame, seed
        assert key.frame < key.attrs["end"], seed
        visible = _runner_visibility(factual)
        assert np.all(visible[scenario.run_start : key.frame] < threshold), seed
        assert np.any(visible[key.frame : key.attrs["end"] + 1] >= threshold), seed
        assert np.all(visible[key.attrs["end"] + 1 : decision.frame + 1] < threshold), seed
        blind = _runner_visibility(counterfactual)
        assert np.all(blind[scenario.run_start : alternative.frame + 1] < threshold), seed
        assert not any(e.id == key.id for e in counterfactual.events), seed
        # Dropping the scan preserves the complete state before it starts.
        np.testing.assert_array_equal(
            factual.pos[: key.frame + 1], counterfactual.pos[: key.frame + 1]
        )
        np.testing.assert_array_equal(
            factual.head_yaw[: key.frame + 1], counterfactual.head_yaw[: key.frame + 1]
        )


def test_the_last_actual_sighting_shows_the_runner_marked_during_the_earlier_scan(design_runs):
    threshold = SimParams().perception_threshold
    for seed, (scenario, factual, _) in design_runs.items():
        visible = _runner_visibility(factual)
        # Frame zero's initial mental map is not an actual sighting by the engine.
        previous = np.flatnonzero(visible[1 : scenario.run_start] >= threshold) + 1
        assert previous.size, seed
        last = int(previous[-1])
        earlier_scans = [
            e for e in factual.events if e.type == "scan" and e.player == HERO
            and not e.attrs.get("key") and e.frame < scenario.run_start
        ]  # fmt: skip
        assert any(e.frame <= last <= e.attrs["end"] for e in earlier_scans), seed
        assert _nearest_opponent_distance(factual, last, RUNNER) <= 2.0, seed


def test_the_near_post_run_is_marked_and_the_late_runner_is_free_at_both_decisions(design_runs):
    for seed, (_, factual, counterfactual) in design_runs.items():
        for run in (factual, counterfactual):
            decision = run.hero_decision()
            near = run.index("H9")
            marker = run.index("A5")
            assert np.linalg.norm(run.pos[decision.frame, near] - run.pos[0, near]) >= 2.0, seed
            assert (
                np.linalg.norm(run.pos[decision.frame, near] - run.pos[decision.frame, marker])
                <= 1.5
            ), seed
            assert _nearest_opponent_distance(run, decision.frame, RUNNER) > 5.0, seed


def test_the_winger_makes_both_decisions_in_the_byline_area(design_runs):
    for seed, (_, factual, counterfactual) in design_runs.items():
        for run in (factual, counterfactual):
            x, y = run.pos[run.hero_decision().frame, run.index(HERO)]
            assert 47.0 <= x <= 49.0 and -18.5 <= y <= -13.5, (seed, x, y)


def test_players_respect_role_speed_and_acceleration_limits(design_runs):
    for seed, (_, factual, counterfactual) in design_runs.items():
        for run in (factual, counterfactual):
            speed = np.linalg.norm(run.vel, axis=-1)
            v_max = np.array([p.v_max for p in run.players])
            a_max = np.array([p.a_max for p in run.players])
            d_max = np.array([p.d_max for p in run.players])
            assert np.all(speed <= v_max + 1e-9), seed
            acceleration = np.linalg.norm(np.diff(run.vel, axis=0), axis=-1) / run.dt
            assert np.all(acceleration <= d_max + 1e-6), seed
            speeding_up = np.diff(speed, axis=0) > 1e-9
            assert np.all(
                acceleration[speeding_up]
                <= np.broadcast_to(a_max, acceleration.shape)[speeding_up] + 1e-6
            ), seed


def test_every_pair_stays_at_least_point_seven_metres_apart_before_the_hero_acts(design_runs):
    for seed, (_, factual, counterfactual) in design_runs.items():
        for run in (factual, counterfactual):
            decision = run.hero_decision()
            assert decision is not None, seed
            pos = run.pos[: decision.frame + 1]
            gap = np.linalg.norm(pos[:, :, None, :] - pos[:, None, :, :], axis=-1)
            gap[:, np.arange(22), np.arange(22)] = np.inf
            frame, first, second = np.unravel_index(np.argmin(gap), gap.shape)
            assert gap[frame, first, second] >= 0.7 - 1e-9, (
                seed,
                frame,
                run.ids[first],
                run.ids[second],
                gap[frame, first, second],
            )


def test_a_cutback_uses_the_ground_pass_and_ends_with_its_reception(design_runs):
    cutbacks = []
    for seed, (_, factual, _) in design_runs.items():
        decision = factual.hero_decision()
        assert decision.player == HERO, seed
        assert len(factual.decisions) == 1, seed
        if decision.chosen != f"pass:{RUNNER}":
            continue
        event = next(
            e for e in factual.events if e.type == "pass" and e.player == HERO
            and e.frame == decision.frame
        )  # fmt: skip
        cutbacks.append(event)
        assert event.attrs["to"] == RUNNER, seed
        assert event.attrs["target"][0] < event.attrs["start"][0], seed
        assert event.attrs["outcome"] == "complete", seed
        assert event.attrs["receiver"] == RUNNER, seed
        end = event.attrs["end"]
        assert any(
            e.type == "reception" and e.player == RUNNER and e.frame == end for e in factual.events
        ), seed
        np.testing.assert_allclose(
            factual.ball_pos[decision.frame : end + 1, 2], BallParams().radius, atol=1e-12
        )
        np.testing.assert_array_equal(factual.ball_vel[decision.frame : end + 1, 2], 0.0)
        assert len(factual.owner) - 1 == end + round(SimParams().tail_s / DT), seed
    assert cutbacks, "The factual design runs must include the intended cutback."
