"""Keeper switch acceptance checks on design seeds only (SPEC 3.4–3.7).

The held-out decision gate is run once with ``eval.hero_flip --scenario keeper_switch``.
These checks establish the scene's information gap and physical plausibility independently
of that gate.
"""

import numpy as np
import pytest

from analytics.vision import visibility
from sim.config import DT, SimParams
from sim.counterfactual import drop_scan_counterfactual
from sim.engine import Simulation
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

SCENARIO = "keeper_switch"
HERO = "H1"
RUNNER = "H3"
MARKER = "A7"
DESIGN_SEEDS = (0, 1, 2, 3)
SEEN = SimParams().perception_threshold


@pytest.fixture(scope="module")
def results():
    return {seed: drop_scan_counterfactual(SCENARIO, seed) for seed in DESIGN_SEEDS}


@pytest.fixture(scope="module")
def scenes():
    return {seed: Simulation.from_scenario(SCENARIO, seed).scenario for seed in DESIGN_SEEDS}


def _visibility(run: MatchRun, target: str) -> np.ndarray:
    """The engine's visibility kernel for this one observer, using true head yaw."""
    hero, receiver = run.index(HERO), run.index(target)
    others = [i for i in range(len(run.players)) if i not in (hero, receiver)]
    speed = np.linalg.norm(run.vel[:, hero], axis=-1)
    return np.array(
        [
            visibility(
                run.pos[f, hero],
                run.head_yaw[f, hero],
                speed[f],
                run.pos[f, [receiver]],
                run.pos[f, others],
            )[0]
            for f in range(len(run.owner))
        ]
    )


@pytest.fixture(scope="module")
def runner_visibility(results):
    return {
        seed: (_visibility(result.factual, RUNNER), _visibility(result.counterfactual, RUNNER))
        for seed, result in results.items()
    }


def test_the_scenario_names_its_hero_runner_lens_and_intervention():
    cls = SCENARIOS[SCENARIO]
    assert (cls.hero, cls.runner, cls.lens, cls.intervention) == (
        HERO,
        RUNNER,
        "scan",
        "drop_scan",
    )
    assert (cls.passer, cls.marker) == ("H4", MARKER)


def test_the_scenario_keeps_all_twenty_two_player_ids(results):
    expected = {f"{team}{number}" for team in ("H", "A") for number in range(1, 12)}
    for seed, result in results.items():
        for run in (result.factual, result.counterfactual):
            assert len(run.players) == 22 and set(run.ids) == expected, seed
            assert run.players[run.index(HERO)].role == "GK", seed
            assert run.players[run.index(RUNNER)].role == "FB", seed


def test_same_seed_twice_in_the_same_environment_is_byte_identical(results):
    full = Simulation.from_scenario(SCENARIO, seed=2).run().to_bytes()
    assert full == Simulation.from_scenario(SCENARIO, seed=2).run().to_bytes()
    assert full == results[2].factual.to_bytes()
    assert full != Simulation.from_scenario(SCENARIO, seed=3).run().to_bytes()


@pytest.mark.parametrize("when", ["before_key_scan", "backpass_in_flight"])
def test_resume_from_a_reusable_snapshot_reproduces_the_run(results, when):
    sim = Simulation.from_scenario(SCENARIO, seed=2)
    frame = (
        sim.scenario.scan_frame - 1 if when == "before_key_scan" else sim.scenario.kick_frame + 1
    )
    sim.run_until(frame)
    assert sim.frame == frame and not sim.done
    if when == "backpass_in_flight":
        assert sim.owner == -1
    snapshot = sim.snapshot()
    full = results[2].factual.to_bytes()
    assert Simulation.resume(snapshot).run().to_bytes() == full
    assert Simulation.resume(snapshot).run().to_bytes() == full


def test_only_the_key_scan_reveals_the_free_runner(results, scenes, runner_visibility):
    for seed, result in results.items():
        run, scene = result.factual, scenes[seed]
        key, decision = run.key_scan(), run.hero_decision()
        factual, counterfactual = runner_visibility[seed]
        assert (key.player, key.frame) == (HERO, scene.scan_frame), seed
        assert 0 < scene.run_start < key.frame < decision.frame, seed
        assert np.all(factual[scene.run_start : key.frame] < SEEN), seed
        assert np.any(factual[key.frame : min(key.attrs["end"], decision.frame) + 1] >= SEEN), seed
        assert np.all(factual[key.attrs["end"] + 1 : decision.frame + 1] < SEEN), seed
        assert np.all(
            counterfactual[scene.run_start : result.counterfactual_decision.frame + 1] < SEEN
        ), seed


def test_the_last_pre_scan_sighting_really_shows_the_runner_marked(
    results, scenes, runner_visibility
):
    for seed, result in results.items():
        run, scene = result.factual, scenes[seed]
        visible = np.flatnonzero(runner_visibility[seed][0][: scene.scan_frame] >= SEEN)
        # Frame zero seeds every belief; demand a later, literal sighting as well.
        assert len(visible) > 0 and visible[-1] > 0, seed
        last = int(visible[-1])
        assert last < scene.run_start, seed
        gap = np.linalg.norm(run.pos[last, run.index(RUNNER)] - run.pos[last, run.index(MARKER)])
        assert gap <= 3.0, (seed, last, gap)


def test_dropping_the_scan_preserves_the_old_picture_and_devalues_the_switch(results):
    for seed, result in results.items():
        factual, counterfactual = result.factual_decision, result.counterfactual_decision
        assert factual.frame == counterfactual.frame, seed
        assert counterfactual.belief_age[RUNNER] > factual.belief_age[RUNNER] + 1.0, seed
        assert counterfactual.belief_error[RUNNER] > factual.belief_error[RUNNER] + 3.0, seed
        f = next(o for o in factual.options if o.action == f"pass:{RUNNER}")
        c = next(o for o in counterfactual.options if o.action == f"pass:{RUNNER}")
        assert f.p_complete > c.p_complete + 0.4, seed
        assert f.prob > c.prob + 0.4, seed
    assert sum(r.factual_action != r.counterfactual_action for r in results.values()) >= 3


def test_spontaneous_keeper_scans_are_suppressed_until_he_acts(results):
    for seed, result in results.items():
        sim = Simulation.from_scenario(SCENARIO, seed)
        hero = sim.index(HERO)
        assert sim.scenario.scan_suppressed(sim, 0)[hero], seed
        decision = result.factual_decision
        sim.run_until(decision.frame)
        assert not sim.hero_acted and sim.scenario.scan_suppressed(sim, sim.frame)[hero], seed
        for run in (result.factual, result.counterfactual):
            action_frame = run.hero_decision().frame
            assert not any(
                event.type == "head_turn" and event.player == HERO and event.frame < action_frame
                for event in run.events
            ), seed
        prior = [
            event
            for event in result.factual.events
            if event.type == "scan" and event.player == HERO and event.frame < decision.frame
        ]
        assert sum(bool(event.attrs["key"]) for event in prior) == 1, seed
        assert any(not event.attrs["key"] for event in prior), seed
        assert not any(
            event.type == "scan" and event.player == HERO and event.attrs["key"]
            for event in result.counterfactual.events
        ), seed


def test_the_backpass_reaches_the_keeper_and_only_he_decides(results):
    for seed, result in results.items():
        for run in (result.factual, result.counterfactual):
            passes = sorted(
                (event for event in run.events if event.type == "pass"), key=lambda e: e.frame
            )
            backpass = passes[0]
            assert (backpass.player, backpass.attrs["to"]) == ("H4", HERO), seed
            assert (backpass.attrs["outcome"], backpass.attrs["receiver"]) == ("complete", HERO), (
                seed
            )
            assert len(run.decisions) == 1 and run.decisions[0].player == HERO, seed
            assert backpass.attrs["end"] < run.hero_decision().frame, seed


def test_the_switch_story_ends_at_the_reception_with_the_standard_tail(results):
    switches = 0
    for seed, result in results.items():
        run = result.factual
        if result.factual_action != f"pass:{RUNNER}":
            continue
        switches += 1
        switch = next(
            event
            for event in run.events
            if event.type == "pass"
            and event.player == HERO
            and event.frame == result.factual_decision.frame
        )
        assert (switch.attrs["outcome"], switch.attrs["receiver"]) == ("complete", RUNNER), seed
        assert any(
            event.type == "reception"
            and event.player == RUNNER
            and event.frame == switch.attrs["end"]
            for event in run.events
        ), seed
        assert len(run.owner) - 1 == switch.attrs["end"] + round(SimParams().tail_s / DT), seed
    assert switches > len(results) / 2


def test_players_respect_role_speed_and_acceleration_limits(results):
    for seed, result in results.items():
        for run in (result.factual, result.counterfactual):
            speed = np.linalg.norm(run.vel, axis=-1)
            v_max = np.array([player.v_max for player in run.players])
            a_max = np.array([player.a_max for player in run.players])
            d_max = np.array([player.d_max for player in run.players])
            assert np.all(speed <= v_max + 1e-9), seed
            acceleration = np.linalg.norm(np.diff(run.vel, axis=0), axis=-1) / run.dt
            assert np.all(acceleration <= d_max + 1e-6), seed
            speeding_up = np.diff(speed, axis=0) > 1e-9
            assert np.all(
                acceleration[speeding_up]
                <= np.broadcast_to(a_max, acceleration.shape)[speeding_up] + 1e-6
            ), seed


def test_every_pair_stays_at_least_point_seven_metres_apart_before_the_keeper_acts(results):
    for seed, result in results.items():
        for run in (result.factual, result.counterfactual):
            positions = run.pos[: run.hero_decision().frame + 1]
            separation = np.linalg.norm(positions[:, :, None] - positions[:, None, :], axis=-1)
            indices = np.arange(len(run.players))
            separation[:, indices, indices] = np.inf
            frame, left, right = np.unravel_index(np.argmin(separation), separation.shape)
            closest = separation[frame, left, right]
            assert closest >= 0.7 - 1e-9, (seed, frame, run.ids[left], run.ids[right], closest)
