"""Keeper sightline: a scripted shot, a droppable step, and a sight-frame override."""

import ast
import inspect
import pickle
from unittest.mock import patch

import numpy as np
import pytest

from analytics.vision import visibility
from sim import engine, shots
from sim.config import A_MAX, D_MAX, DT, SimParams
from sim.counterfactual import drop_step_counterfactual, hero_counterfactual
from sim.engine import Simulation
from sim.overrides import SightAt
from sim.scenarios import SCENARIOS
from sim.scenarios.base import Scenario
from sim.scenarios.screened_shot import SCREENERS, ScreenedShot

SCENARIO = "screened_shot"
SEEN = SimParams().perception_threshold


def _shot(run):
    return next(e for e in run.events if e.type == "shot")


def _ball_visibility(run, frame: int) -> float:
    k = run.index("H1")
    speed = float(np.linalg.norm(run.vel[frame, k]))
    return float(
        visibility(
            run.pos[frame, k],
            float(run.head_yaw[frame, k]),
            speed,
            run.ball_pos[frame, None, :2],
            np.delete(run.pos[frame], k, axis=0),
        )[0]
    )


def _dive_limits(sim):
    """Only an emitted keeper dive can grant the separate tracking limits."""
    active = np.zeros(len(sim.ids), dtype=bool)
    for k, (aim, start, until) in sim.dives.items():
        assert sim.players[k].role == "GK"
        assert any(e.type == "dive" and e.player == sim.ids[k] and e.frame == start
                   for e in sim.events)  # fmt: skip
        shot = next(e for e in reversed(sim.events)
                    if e.type == "shot" and e.attrs["keeper"] == sim.ids[k])  # fmt: skip
        origin = np.array(shot.attrs["start"])
        direction = np.array(shot.attrs["aim"]) - origin
        error = shot.attrs["error"]
        c, s = np.cos(error), np.sin(error)
        direction = np.array([[c, -s], [s, c]]) @ direction
        _, travel = shots.crossing(origin, origin + direction, aim[0], shot.attrs["speed"])
        assert until == shot.frame + round(travel / DT) + round(shots.KEEPER.dive_hold_s / DT)
        active[k] = start <= sim.frame <= until
    return active


@pytest.fixture(scope="module", params=range(6), ids=lambda seed: f"design-{seed}")
def design_case(request):
    """Keep the real steering inputs so A_MAX/D_MAX use its desired-speed convention."""
    movement = []
    current = []
    original_step, original_steer = Simulation.step, engine.steer

    def tracked_step(sim):
        current[:] = [sim]
        return original_step(sim)

    def tracked_steer(pos, vel, target, cap, a_max, d_max, dt, bounds=None):
        sim = current[0]
        diving = _dive_limits(sim)
        expected_a = np.full(len(sim.ids), A_MAX)
        expected_d = np.full(len(sim.ids), D_MAX)
        expected_a[diving] = expected_d[diving] = shots.KEEPER.a_dive_max
        np.testing.assert_array_equal(a_max, expected_a)
        np.testing.assert_array_equal(d_max, expected_d)
        # Steering classifies acceleration using the desired speed, which can differ from
        # simply testing whether the resulting speed increased while he turns.
        desired = np.minimum(cap, np.sqrt(2.0 * expected_d * np.linalg.norm(target - pos, axis=1)))
        accelerating = desired >= np.linalg.norm(vel, axis=1)
        acceleration_cap = np.where(accelerating, expected_a, expected_d)
        speed_cap = np.array([p.v_max for p in sim.players])
        speed_cap[diving] = shots.KEEPER.v_dive_max
        new_pos, new_vel = original_steer(pos, vel, target, cap, a_max, d_max, dt, bounds)
        movement.append(
            (
                sim.frame,
                np.linalg.norm(new_vel, axis=1),
                speed_cap,
                np.linalg.norm(new_vel - vel, axis=1) / dt,
                acceleration_cap,
            )
        )
        return new_pos, new_vel

    with (
        patch.object(Simulation, "step", tracked_step),
        patch.object(engine, "steer", tracked_steer),
    ):
        result = drop_step_counterfactual(SCENARIO, request.param)
    return result, movement


def test_scenario_never_writes_engine_state():
    source = ast.parse(inspect.getsource(ScreenedShot))
    for node in ast.walk(source):
        targets = node.targets if isinstance(node, ast.Assign) else []
        if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            targets = [node.target]
        for target in targets:
            while isinstance(target, (ast.Attribute, ast.Subscript)):
                target = target.value
            assert not (isinstance(target, ast.Name) and target.id == "sim")

    original = ScreenedShot.scripted_targets
    calls = 0

    def guarded(scenario, sim, frame):
        nonlocal calls
        # Scenario-local scheduling and appending an event are allowed; all engine state,
        # including nested tracking/history arrays, must survive the hook unchanged.
        state = {
            key: value for key, value in vars(sim).items() if key not in {"scenario", "events"}
        }
        before = pickle.dumps(state)
        prior_events = pickle.dumps(sim.events)
        count = len(sim.events)
        targets = original(scenario, sim, frame)
        after = {
            key: value for key, value in vars(sim).items() if key not in {"scenario", "events"}
        }
        assert pickle.dumps(after) == before
        assert pickle.dumps(sim.events[:count]) == prior_events
        calls += 1
        return targets

    with patch.object(ScreenedShot, "scripted_targets", guarded):
        drop_step_counterfactual(SCENARIO, 0)
    assert calls > 25


def test_every_player_respects_normal_limits_except_inside_a_keeper_dive(design_case):
    _, movement = design_case
    assert movement
    for frame, speed, speed_cap, acceleration, acceleration_cap in movement:
        assert np.all(speed <= speed_cap + 1e-9), f"speed at frame {frame}"
        assert np.all(acceleration <= acceleration_cap + 1e-9), f"acceleration at frame {frame}"


def test_recorded_velocities_agree_with_position_changes(design_case):
    result, _ = design_case
    for run in (result.factual, result.counterfactual):
        np.testing.assert_allclose(
            np.diff(run.pos, axis=0) / run.dt, run.vel[1:], atol=1e-10, rtol=0
        )


def test_all_players_and_screeners_remain_separated_until_the_strike(design_case):
    result, _ = design_case
    for run in (result.factual, result.counterfactual):
        frame = _shot(run).frame
        pos = run.pos[: frame + 1]
        distance = np.linalg.norm(pos[:, :, None] - pos[:, None, :], axis=-1)
        distance[:, np.arange(len(run.players)), np.arange(len(run.players))] = np.inf
        assert distance.min() >= 0.7 - 1e-9
        k = run.index("H1")
        screeners = [run.index(pid) for pid in SCREENERS]
        keeper_distance = np.linalg.norm(pos[:, screeners] - pos[:, k, None], axis=-1)
        assert keeper_distance.min() >= 1.5 - 1e-9
        reception = next(e for e in run.events if e.type == "pass" and e.attrs["to"] == "A10")
        assert reception.attrs["outcome"] == "complete"


def test_at_least_two_bodies_really_screen_the_starting_keeper_at_the_strike(design_case):
    result, _ = design_case
    run = result.counterfactual
    frame, k = _shot(run).frame, run.index("H1")
    origin = np.array(result.factual.key_step().attrs["start"])
    ball = run.ball_pos[frame, None, :2]
    yaw = float(np.arctan2(*(ball[0] - origin)[::-1]))
    blockers = 0
    for pid in SCREENERS:
        body = run.pos[frame, [run.index(pid)]]
        blockers += visibility(origin, yaw, 0.0, ball, body)[0] < SEEN
    assert blockers >= 2
    assert np.linalg.norm(run.pos[frame, k] - origin) < 0.05


def test_new_hooks_default_off_and_leave_other_scenarios_alone():
    bare = Scenario()
    assert bare.shots is False
    assert bare.forced_shot(None, 0) is None
    for name, cls in SCENARIOS.items():
        if name == SCENARIO:
            continue
        assert cls().forced_shot(None, 0) is None
        assert cls.shots is (name == "far_post_finish")


def test_ends_on_shot_matches_ends_on_pass_unless_a_scenario_overrides_it():
    sim = Simulation.from_scenario("far_post_finish", 0)
    for pid, expected in (("H9", True), ("H7", False)):
        i = sim.index(pid)
        assert sim.scenario.ends_on_shot(sim, i) is expected
        assert sim.scenario.ends_on_shot(sim, i) is sim.scenario.ends_on_pass(sim, i)


def test_screened_shot_registers_the_keeper_and_the_twenty_two():
    cls = SCENARIOS[SCENARIO]
    assert (cls.hero, cls.lens, cls.intervention, cls.shots) == ("H1", "sight", "drop_step", True)
    sim = Simulation.from_scenario(SCENARIO, 0)
    assert set(sim.ids) == {f"{team}{n}" for team in ("H", "A") for n in range(1, 12)}
    assert sim.players[sim.index("H1")].role == "GK"


def test_same_seed_is_byte_identical_and_resume_reproduces_it():
    full = Simulation.from_scenario(SCENARIO, 4).run()
    assert full.to_bytes() == Simulation.from_scenario(SCENARIO, 4).run().to_bytes()
    sim = Simulation.from_scenario(SCENARIO, 4)
    sim.run_until(12)
    assert Simulation.resume(sim.snapshot()).run().to_bytes() == full.to_bytes()


def test_forced_shot_matches_with_and_without_the_step():
    result = drop_step_counterfactual(SCENARIO, 7, record_draws=True)
    factual, counter = _shot(result.factual), _shot(result.counterfactual)
    assert factual.frame == counter.frame
    assert factual.player == counter.player == "A10"
    for key in ("start", "aim", "speed", "error"):
        assert factual.attrs[key] == counter.attrs[key], key
    assert abs(factual.attrs["aim"][1]) == pytest.approx(3.26)
    key = ("A10", "shot_error", factual.frame)
    assert result.factual.draws[key] == result.counterfactual.draws[key]


def test_drop_step_removes_the_step_and_nothing_before_it():
    result = hero_counterfactual(SCENARIO, 7)
    step = result.factual.key_step()
    assert result.scan_id == step.id == f"step:H1:{step.frame:04d}"
    assert step.attrs["key"] is True
    assert step.attrs["lateral_m"] == pytest.approx(
        abs(step.attrs["end"][1] - step.attrs["start"][1])
    )
    assert 0.6 <= step.attrs["lateral_m"] <= 1.0
    assert not any(e.type == "step" for e in result.counterfactual.events)
    start = step.frame
    assert np.array_equal(result.factual.pos[: start + 1], result.counterfactual.pos[: start + 1])
    assert np.array_equal(
        result.factual.ball_pos[: start + 1], result.counterfactual.ball_pos[: start + 1]
    )
    factual_before = [e.id for e in result.factual.events if e.frame < start]
    counter_before = [e.id for e in result.counterfactual.events if e.frame < start]
    assert factual_before == counter_before
    k = result.factual.index("H1")
    strike = _shot(result.factual).frame
    assert 0.6 <= (strike - start) * DT <= 0.95
    realised = abs(result.factual.pos[strike, k, 1] - step.attrs["start"][1])
    assert 0.6 <= realised <= 1.0
    assert result.factual.pos[strike, k, 1] == pytest.approx(step.attrs["end"][1], abs=0.05)
    assert abs(result.counterfactual.pos[strike, k, 1] - step.attrs["end"][1]) > 0.4


def test_the_step_opens_the_sightline_at_the_strike(design_case):
    result, _ = design_case
    factual, counter = _shot(result.factual), _shot(result.counterfactual)
    assert _ball_visibility(result.factual, factual.frame) >= SEEN
    assert _ball_visibility(result.counterfactual, counter.frame) < SEEN


def test_sight_at_moves_only_the_first_sight_and_what_follows():
    base = Simulation.from_scenario(SCENARIO, 4).run()
    shot = _shot(base)
    assert shot.attrs["seen"] is not None
    late = shot.attrs["seen"] + 6
    sim = Simulation.from_scenario(SCENARIO, 4)
    sim.run_until(shot.frame)
    snap = sim.snapshot()
    plain = Simulation.resume(snap).run()
    forced = Simulation.resume(snap, [SightAt("H1", late)]).run()
    assert plain.to_bytes() == base.to_bytes()
    plain_shot, forced_shot = _shot(plain), _shot(forced)
    for key in ("start", "aim", "speed", "error"):
        assert forced_shot.attrs[key] == plain_shot.attrs[key]
    assert forced_shot.attrs["seen"] == late
    assert plain_shot.attrs["seen"] == shot.attrs["seen"]
    assert np.array_equal(plain.pos[: shot.frame + 1], forced.pos[: shot.frame + 1])
    plain_dive = next(e for e in plain.events if e.type == "dive" and e.player == "H1")
    forced_dive = next(e for e in forced.events if e.type == "dive" and e.player == "H1")
    assert plain_dive.attrs["seen"] == shot.attrs["seen"]
    assert forced_dive.attrs["seen"] == late
    assert forced_dive.frame != plain_dive.frame
