"""Placed-shot acceptance checks (hero expansion Module A and C1, design seeds only)."""

import math
from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest

from analytics.vision import visibility
from eval import hero_shot
from sim import shots
from sim.config import HALF_LENGTH
from sim.counterfactual import drop_scan_counterfactual
from sim.decision import DecisionContext, _placed_shot, evaluate_options
from sim.engine import Simulation
from sim.match import restart_after
from sim.model import Decision, Event
from sim.overrides import DropScan
from sim.scenarios import SCENARIOS
from sim.scenarios.base import Scenario, Setup, make_player

SCENARIO = "far_post_finish"
DESIGN_SEEDS = tuple(range(10))


def test_save_probability_matches_the_cited_piecewise_model():
    kp, r = shots.KEEPER, 2.8
    np.testing.assert_allclose(
        shots.p_save(np.array([r - kp.mu, r, r + kp.mu]), r),
        [kp.rho, kp.rho / 2, 0.0],
        atol=1e-15,
    )


def test_reach_is_monotone_clipped_and_matches_penalty_flight_time():
    assert shots.reach(0.55) == 2.8
    times = np.linspace(-10.0, 10.0, 501)
    reach = np.array([shots.reach(float(t)) for t in times])
    assert np.all(np.diff(reach) >= 0.0)
    assert np.all((reach >= 0.3) & (reach <= 3.1))
    assert reach[0] == 0.3
    assert reach[-1] == shots.reach(math.inf) == 3.1


def _fresh_context(side: float = -1.0) -> DecisionContext:
    return DecisionContext(
        carrier=0,
        team=np.array([0, 1]),
        pos=np.array([[41.0, side * 4.0], [51.0, side * 1.8]]),
        vel=np.zeros((2, 2)),
        age_s=np.zeros(2),
        ids=["H9", "A1"],
        shots=True,
        keeper=1,
        from_y=side * 20.0,
    )


def test_fresh_near_post_sighting_prefers_far_and_mirrors_in_y():
    original, mirrored = [
        {o.action: o for o in evaluate_options(_fresh_context(side)) if o.kind == "shot"}
        for side in (-1.0, 1.0)
    ]
    for options in (original, mirrored):
        assert set(options) == {"shot:near", "shot:far"}
        assert options["shot:far"].value > options["shot:near"].value
    for action in original:
        assert original[action].value == pytest.approx(mirrored[action].value)
        assert original[action].target[0] == mirrored[action].target[0]
        assert original[action].target[1] == -mirrored[action].target[1]


def test_decision_reads_keeper_and_shot_globals_at_call_time(monkeypatch):
    ctx = _fresh_context()
    ctx.pos[1, 1] = -0.8  # both reach settings lie in the transition band
    low = replace(shots.KEEPER, v_dive=2.5)
    high = replace(shots.KEEPER, v_dive=4.0)
    monkeypatch.setattr(shots, "KEEPER", low)
    slow = _placed_shot(ctx, ctx.pos[0], "near")
    monkeypatch.setattr(shots, "KEEPER", high)
    fast = _placed_shot(ctx, ctx.pos[0], "near")
    assert slow.value != fast.value
    monkeypatch.setattr(shots, "SHOT", replace(shots.SHOT, m_in=0.8))
    assert _placed_shot(ctx, ctx.pos[0], "near").target != fast.target


@pytest.fixture(scope="module")
def design_pairs():
    return {
        seed: drop_scan_counterfactual(SCENARIO, seed, record_draws=True) for seed in DESIGN_SEEDS
    }


def test_c1_registers_the_striker_and_preserves_stitched_match_player_ids():
    cls = SCENARIOS[SCENARIO]
    assert (cls.hero, cls.lens, cls.intervention, cls.shots) == ("H9", "scan", "drop_scan", True)
    sim = Simulation.from_scenario(SCENARIO, 0)
    assert set(sim.ids) == {f"{team}{n}" for team in ("H", "A") for n in range(1, 12)}
    assert sim.players[sim.index("H9")].role == "ST"


@pytest.mark.parametrize("seed", DESIGN_SEEDS)
def test_c1_shot_speed_and_resolution_events_agree_with_the_outcome(design_pairs, seed):
    pair = design_pairs[seed]
    for run in (pair.factual, pair.counterfactual):
        shot_events = [e for e in run.events if e.type == "shot"]
        assert shot_events, (seed, run.hero_decision())
        for shot in shot_events:
            assert 18.0 <= shot.attrs["speed"] <= 35.0
            assert shot.attrs["outcome"] in {"goal", "saved", "wide", "blocked"}
            end = shot.attrs["end"]
            assert end is not None and end > shot.frame
            goals = [
                e
                for e in run.events
                if e.type == "goal" and e.player == shot.player and shot.frame < e.frame <= end
            ]
            saves = [e for e in run.events if e.type == "save" and e.attrs.get("shot") == shot.id]
            assert bool(goals) == (shot.attrs["outcome"] == "goal"), (seed, shot)
            assert bool(saves) == (shot.attrs["outcome"] == "saved"), (seed, shot)
            if goals:
                assert len(goals) == 1
                goal = goals[0]
                sign = 1 if shot.team == 0 else -1
                before = run.ball_pos[goal.frame - 1, :2]
                after = run.ball_pos[goal.frame, :2]
                assert sign * before[0] <= HALF_LENGTH < sign * after[0]
                fraction = (sign * HALF_LENGTH - before[0]) / (after[0] - before[0])
                crossing_y = before[1] + fraction * (after[1] - before[1])
                assert abs(crossing_y) < shots.GOAL_HALF_WIDTH
                assert crossing_y == pytest.approx(shot.attrs["goal_line_y"], abs=1e-9)


@pytest.mark.parametrize("seed", DESIGN_SEEDS)
def test_keeper_never_takes_shots_by_the_free_ball_control_radius(design_pairs, seed):
    pair = design_pairs[seed]
    for run in (pair.factual, pair.counterfactual):
        for shot in (e for e in run.events if e.type == "shot"):
            keeper = shot.attrs["keeper"]
            start, end = shot.frame, shot.attrs["end"]
            assert not any(
                e.player == keeper
                and e.type in ("reception", "interception")
                and start < e.frame <= end
                for e in run.events
            ), (seed, shot)
            # The save model may give him possession on the resolution frame itself.
            assert np.all(run.owner[start + 1 : end] != run.index(keeper))


def test_drop_scan_shares_shot_error_and_keeper_save_uniform_at_the_same_strike_frame(design_pairs):
    compared = 0
    for seed, pair in design_pairs.items():
        factual = next((e for e in pair.factual.events if e.type == "shot"), None)
        counterfactual = next((e for e in pair.counterfactual.events if e.type == "shot"), None)
        if factual is None or counterfactual is None or factual.frame != counterfactual.frame:
            continue
        assert factual.player == counterfactual.player == "H9"
        assert factual.attrs["error"] == counterfactual.attrs["error"], seed
        assert factual.attrs["speed"] == counterfactual.attrs["speed"], seed
        error_key = ("H9", "shot_error", factual.frame)
        assert error_key in pair.factual.draws and error_key in pair.counterfactual.draws
        assert pair.factual.draws[error_key] == pair.counterfactual.draws[error_key], seed
        key = ("A1", "save", factual.frame)
        assert key in pair.factual.draws and key in pair.counterfactual.draws
        assert pair.factual.draws[key] == pair.counterfactual.draws[key], seed
        compared += 1
    assert compared > 0, "No same-frame factual/counterfactual strikes exercised the keyed draws"


class _OccludedShot(Scenario):
    """A stationary wall hides the strike, but a placed shot bends the sightline past it."""

    name = "test_occluded_shot"
    hero = "H9"
    shots = True

    def setup(self, gen):
        players = [make_player("H9", "ST"), make_player("A1", "GK")]
        players += [make_player(f"A{n}", "CB") for n in (2, 3, 4)]
        self.spots = np.array([[38.0, 0.0], [51.0, 0.0], [47.0, -0.6], [47.0, 0.0], [47.0, 0.6]])
        return Setup(players, self.spots.copy(), 0)

    def scripted_targets(self, sim, frame):
        return {i: (spot, 0.0) for i, spot in enumerate(self.spots)}

    def scan_suppressed(self, sim, frame):
        return np.ones(len(sim.ids), dtype=bool)


def _keeper_ball_visibility(sim):
    k = sim.index("A1")
    return float(
        visibility(
            sim.pos[k],
            sim.head_yaw[k],
            np.linalg.norm(sim.vel[k]),
            sim.ball_pos[None, :2],
            np.delete(sim.pos, k, axis=0),
        )[0]
    )


def test_occluded_keeper_cannot_start_a_dive_before_he_first_sees_the_ball():
    sim = Simulation(_OccludedShot(), seed=0)
    assert _keeper_ball_visibility(sim) < 0.5
    ctx = DecisionContext(
        carrier=0,
        team=sim.team,
        pos=sim.pos,
        vel=sim.vel,
        age_s=np.zeros(len(sim.ids)),
        shots=True,
        keeper=sim.index("A1"),
        from_y=1.0,
    )
    sim._kick_shot(0, _placed_shot(ctx, sim.ball_pos[:2], "near"), sim.frame)
    first_seen = None
    hidden_frames = 0
    while sim.shot_in_flight is not None:
        sim.step()
        if _keeper_ball_visibility(sim) >= 0.5 and first_seen is None:
            first_seen = sim.frame
        if first_seen is None:
            hidden_frames += 1
            assert not any(e.type == "dive" for e in sim.events)
    dives = [e for e in sim.events if e.type == "dive"]
    assert hidden_frames >= 1, "The wall must hide more than only the frame-0 strike"
    assert first_seen is not None and dives, "The shot must emerge from behind the wall"
    assert all(e.frame >= first_seen and e.attrs["seen"] == first_seen for e in dives)


def test_control_radius_does_not_bypass_the_keeper_save_model():
    sim = Simulation(_OccludedShot(), seed=0)
    ctx = DecisionContext(
        carrier=0,
        team=sim.team,
        pos=sim.pos,
        vel=sim.vel,
        age_s=np.zeros(len(sim.ids)),
        shots=True,
        keeper=sim.index("A1"),
        from_y=1.0,
    )
    sim._kick_shot(0, _placed_shot(ctx, sim.ball_pos[:2], "near"), sim.frame)
    k = sim.index("A1")
    sim.ball_pos[:2] = sim.pos[k]
    sim.frame += 1
    before = len(sim.events)
    sim._check_control()
    assert sim.owner == -1
    assert sim.shot_in_flight is not None
    assert len(sim.events) == before


@pytest.mark.parametrize(
    ("start_y", "crossing_y", "outcome"),
    [(0.0, 3.65, "goal"), (6.0, 3.7, "wide")],
)
def test_goal_uses_the_line_crossing_instead_of_the_overshot_frame_position(
    monkeypatch, start_y, crossing_y, outcome
):
    monkeypatch.setattr(shots, "SHOT", replace(shots.SHOT, sigma_theta=0.0))
    sim = Simulation(_OccludedShot(), seed=0)
    sim.pos[0, 1] = start_y
    sim._attach_ball()
    ctx = DecisionContext(
        carrier=0,
        team=sim.team,
        pos=sim.pos,
        vel=sim.vel,
        age_s=np.zeros(len(sim.ids)),
        shots=True,
        keeper=sim.index("A1"),
        from_y=1.0,
    )
    option = replace(_placed_shot(ctx, sim.ball_pos[:2], "near"), target=(HALF_LENGTH, crossing_y))
    start = sim.ball_pos[:2].copy()
    sim._kick_shot(0, option, sim.frame)
    shot = sim.shot_in_flight["event"]
    assert shot.attrs["goal_line_y"] == pytest.approx(crossing_y)
    # One frame can carry the ball beyond the line and across a post's y coordinate.
    x_after = HALF_LENGTH + 1.0
    y_after = start_y + (crossing_y - start_y) * (x_after - start[0]) / (HALF_LENGTH - start[0])
    sim.ball_pos[:2] = (x_after, y_after)
    sim.frame += 1
    assert (abs(y_after) < shots.GOAL_HALF_WIDTH) != (outcome == "goal")
    assert sim._check_out()
    assert shot.attrs["outcome"] == outcome
    assert any(e.type == "goal" for e in sim.events) == (outcome == "goal")


def test_keeper_who_sees_the_strike_gets_the_strike_frame_as_first_sight():
    sim = Simulation(_OccludedShot(), seed=0)
    sim.pos[2:, 1] += 20.0
    assert _keeper_ball_visibility(sim) >= 0.5
    ctx = DecisionContext(
        carrier=0,
        team=sim.team,
        pos=sim.pos,
        vel=sim.vel,
        age_s=np.zeros(len(sim.ids)),
        shots=True,
        keeper=sim.index("A1"),
        from_y=1.0,
    )
    sim._kick_shot(0, _placed_shot(ctx, sim.ball_pos[:2], "near"), sim.frame)
    assert sim.shot_in_flight is not None
    assert sim.shot_in_flight["seen"] == 0
    assert any(e.type == "dive" and e.attrs["seen"] == 0 for e in sim.events)


class _WallWithUnscriptedKeeper(_OccludedShot):
    def scripted_targets(self, sim, frame):
        return {i: (spot, 0.0) for i, spot in enumerate(self.spots) if sim.players[i].role != "GK"}


def test_hidden_shot_cannot_move_the_keeper_toward_an_unseen_ball():
    sim = Simulation(_WallWithUnscriptedKeeper(), seed=0)
    k = sim.index("A1")
    strike_position = sim.pos[k].copy()
    ctx = DecisionContext(
        carrier=0,
        team=sim.team,
        pos=sim.pos,
        vel=sim.vel,
        age_s=np.zeros(len(sim.ids)),
        shots=True,
        keeper=k,
        from_y=1.0,
    )
    sim._kick_shot(0, _placed_shot(ctx, sim.ball_pos[:2], "near"), sim.frame)
    sim._roll_ball()
    sim.frame += 1
    assert _keeper_ball_visibility(sim) < 0.5
    assert sim.shot_in_flight["seen"] is None
    assert not sim.dives
    target, _ = sim._movement_targets(sim.frame)
    np.testing.assert_allclose(target[k], strike_position, atol=1e-12)


def test_a_goal_has_one_terminal_event_and_a_kickoff_after_its_tail():
    sim = Simulation(_OccludedShot(), seed=0)
    ctx = DecisionContext(
        carrier=0,
        team=sim.team,
        pos=sim.pos,
        vel=sim.vel,
        age_s=np.zeros(len(sim.ids)),
        shots=True,
        keeper=sim.index("A1"),
        from_y=1.0,
    )
    sim._kick_shot(0, _placed_shot(ctx, sim.ball_pos[:2], "near"), sim.frame)
    assert abs(sim.shot_in_flight["event"].attrs["goal_line_y"]) < shots.GOAL_HALF_WIDTH
    sim.ball_pos[:2] = (HALF_LENGTH + 0.1, 3.0)
    sim.frame += 1
    assert sim._check_out()
    sim._record()
    run = sim.run()
    assert run.events[0].type == "shot"
    terminal = [e for e in run.events if e.type in ("goal", "out")]
    assert len(terminal) == 1
    assert terminal[0].type == "goal"
    assert len(run.owner) - 1 == terminal[0].frame + round(sim.params.tail_s / run.dt)
    assert restart_after(run) == "kick_off"


class _KeeperPassLane(Scenario):
    """A keeper is the earliest interceptor, but his positioning still follows the bisector."""

    shots = True

    def __init__(self, with_outfield):
        self.with_outfield = with_outfield

    def setup(self, gen):
        players = [make_player("H9", "ST"), make_player("H7", "W"), make_player("A1", "GK")]
        pos = [[38.0, 0.0], [51.0, 0.0], [48.0, 0.0]]
        if self.with_outfield:
            players.append(make_player("A2", "CB"))
            pos.append([-20.0, 20.0])
        return Setup(players, np.array(pos), 0)


@pytest.mark.parametrize("with_outfield", [False, True])
def test_in_flight_pass_interception_does_not_override_the_keeper_bisector(with_outfield):
    sim = Simulation(_KeeperPassLane(with_outfield), seed=0)
    sim._kick_pass(sim.index("H9"), np.array([51.0, 0.0]), sim.index("H7"), sim.frame)
    target, _ = sim._movement_targets(sim.frame)
    expected = shots.bisector_point(sim.ball_pos[:2], attack_sign_of_shooter=1)
    np.testing.assert_allclose(target[sim.index("A1")], expected)


def test_shot_runs_are_byte_identical_for_the_same_seed():
    first = Simulation.from_scenario(SCENARIO, seed=3).run().to_bytes()
    assert first == Simulation.from_scenario(SCENARIO, seed=3).run().to_bytes()


def test_resume_before_the_scan_and_during_the_shot_reproduces_the_run():
    full = Simulation.from_scenario(SCENARIO, seed=3).run()
    shot = next(e for e in full.events if e.type == "shot")
    assert shot.attrs["end"] > shot.frame + 2
    for frame in (full.key_scan().frame, shot.frame + 2):
        sim = Simulation.from_scenario(SCENARIO, seed=3)
        sim.run_until(frame)
        snapshot = sim.snapshot()
        assert Simulation.resume(snapshot).run().to_bytes() == full.to_bytes()
        assert Simulation.resume(snapshot).run().to_bytes() == full.to_bytes()


def test_eval_truth_probability_matches_the_engine_context_at_each_decision(design_pairs):
    pair = design_pairs[0]
    for run, decision, overrides in (
        (pair.factual, pair.factual_decision, []),
        (pair.counterfactual, pair.counterfactual_decision, [DropScan(pair.scan_id)]),
    ):
        assert decision.chosen.startswith("shot:")
        sim = Simulation.from_scenario(SCENARIO, seed=0)
        sim = Simulation.resume(sim.snapshot(), overrides)
        sim.run_until(decision.frame)
        i = sim.index(decision.player)
        np.testing.assert_array_equal(sim.pos, run.pos[decision.frame])
        np.testing.assert_array_equal(sim.vel, run.vel[decision.frame])
        np.testing.assert_array_equal(sim.ball_pos, run.ball_pos[decision.frame])
        ctx = DecisionContext(
            carrier=i,
            team=sim.team,
            pos=sim.pos,
            vel=sim.vel,
            age_s=np.zeros(len(sim.ids)),
            ids=sim.ids,
            attack_sign=1,
            ball=sim.ball_pos[:2],
            **sim._shot_context(i),
        )
        expected = _placed_shot(ctx, ctx.ball, decision.chosen.partition(":")[2]).p_success
        assert hero_shot.truth_p_goal(run, decision) == expected


def test_eval_keeper_sweep_restores_the_original_parameters_if_a_run_fails(monkeypatch):
    original = shots.KEEPER

    def fail_during_sweep(scenario, seed):
        assert shots.KEEPER.v_dive == shots.V_DIVE_SWEEP[0]
        raise RuntimeError("synthetic sweep failure")

    monkeypatch.setattr(hero_shot, "drop_scan_counterfactual", fail_during_sweep)
    with pytest.raises(RuntimeError, match="synthetic sweep failure"):
        hero_shot._sweep(SCENARIO, [0])
    assert shots.KEEPER is original


def test_eval_design_rule_includes_the_counterfactual_decision_frame(monkeypatch):
    sim = Simulation(_OccludedShot(), seed=0)
    sim.pos[2:, 1] += 20.0  # clear the real sightline rather than replacing visibility
    sim.head_yaw[0] = np.pi
    sim.frame = 1
    sim._record()
    sim.head_yaw[0] = 0.0  # he sees A1 for the first time on the decision frame
    sim.frame = 2
    sim._record()
    decision = Decision(2, "H9", [], "carry", {}, {}, {})
    sim.events.append(
        Event("scan:H9:0002", "scan", 2, 2 * sim.result().dt, "H9", 0, {"key": True, "end": 3})
    )
    run = sim.result()
    pair = SimpleNamespace(
        factual=run,
        counterfactual=replace(run, events=[]),
        factual_decision=decision,
        counterfactual_decision=decision,
    )
    monkeypatch.setattr(hero_shot, "drop_scan_counterfactual", lambda scenario, seed: pair)
    monkeypatch.setitem(SCENARIOS, sim.scenario.name, _OccludedShot)
    assert hero_shot._not_seen(run, "H9", "A1", stop=2)
    assert not hero_shot._not_seen(run, "H9", "A1", stop=3)
    assert not hero_shot.evaluate_seed(sim.scenario.name, 0)["design_rule"]
