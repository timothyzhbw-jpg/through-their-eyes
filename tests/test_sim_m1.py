"""M1 acceptance checks for the hero slice of the sim (SPEC 3.4, 3.5, 3.6, 3.7)."""

import numpy as np
import pytest

from sim.ball import G
from sim.counterfactual import drop_scan_counterfactual
from sim.decision import DecisionContext, evaluate_options
from sim.engine import Simulation
from sim.perception import BeliefStore
from sim.rng import KeyedRng

SCENARIO = "blind_side_run"
HERO = "H8"
RUNNER = "H9"


@pytest.fixture(scope="module")
def run3():
    return Simulation.from_scenario(SCENARIO, seed=3).run()


# --- 3.7 determinism and counterfactual plumbing ----------------------------------------


def test_keyed_draws_do_not_depend_on_call_order():
    a, b = KeyedRng(9), KeyedRng(9)
    first = a.uniform("scan_trigger", frame=40, n=22)
    b.uniform("sensor_noise", frame=12, n=22)  # an unrelated draw first
    np.testing.assert_array_equal(first, b.uniform("scan_trigger", frame=40, n=22))
    assert not np.array_equal(first, a.uniform("scan_trigger", frame=41, n=22))
    assert not np.array_equal(first, KeyedRng(10).uniform("scan_trigger", frame=40, n=22))


def test_same_seed_twice_in_the_same_environment_is_byte_identical():
    a = Simulation.from_scenario(SCENARIO, seed=11).run().to_bytes()
    b = Simulation.from_scenario(SCENARIO, seed=11).run().to_bytes()
    assert a == b
    assert a != Simulation.from_scenario(SCENARIO, seed=12).run().to_bytes()


def test_resume_from_snapshot_without_overrides_reproduces_the_run():
    full = Simulation.from_scenario(SCENARIO, seed=5).run().to_bytes()
    sim = Simulation.from_scenario(SCENARIO, seed=5)
    sim.run_until(30)
    snap = sim.snapshot()
    assert Simulation.resume(snap).run().to_bytes() == full
    assert Simulation.resume(snap).run().to_bytes() == full  # a snapshot is reusable


def test_an_override_on_one_player_leaves_every_draw_of_other_players_unchanged():
    result = drop_scan_counterfactual(SCENARIO, seed=5, record_draws=True)
    factual, counterfactual = result.factual, result.counterfactual
    assert result.scan_id.startswith(f"scan:{HERO}:")
    for player in (RUNNER, "A5", "H4", "A1"):
        f, c = factual.draws_for(player), counterfactual.draws_for(player)
        common = f.keys() & c.keys()
        assert len(common) > 0.9 * min(len(f), len(c))
        assert all(f[k] == c[k] for k in common)


# --- physical plausibility --------------------------------------------------------------


def test_players_respect_role_speed_and_acceleration_limits(run3):
    speed = np.linalg.norm(run3.vel, axis=-1)
    v_max = np.array([p.v_max for p in run3.players])
    a_max = np.array([p.a_max for p in run3.players])
    d_max = np.array([p.d_max for p in run3.players])
    assert np.all(speed <= v_max + 1e-9)
    acc = np.linalg.norm(np.diff(run3.vel, axis=0), axis=-1) / run3.dt
    assert np.all(acc <= d_max + 1e-6)
    speeding_up = np.diff(speed, axis=0) > 1e-9
    assert np.all(acc[speeding_up] <= np.broadcast_to(a_max, acc.shape)[speeding_up] + 1e-6)


def test_ball_energy_never_increases_between_contacts(run3):
    energy = 0.5 * np.sum(run3.ball_vel**2, axis=-1) + G * run3.ball_pos[:, 2]
    free = run3.owner == -1
    kicks = {e.frame for e in run3.events if e.type in ("pass", "shot")}
    checked = 0
    for k in range(1, len(energy)):
        if free[k] and free[k - 1] and k not in kicks:
            assert energy[k] <= energy[k - 1] + 1e-9
            checked += 1
    assert checked > 20


# --- 3.4 perception ---------------------------------------------------------------------


def test_scans_are_ground_truth_events_and_the_key_scan_turns_away_from_the_ball(run3):
    scans = [e for e in run3.events if e.type == "scan"]
    assert scans and all(e.attrs["end"] > e.frame for e in scans)
    key = run3.key_scan()
    assert key.player == HERO and key.attrs["key"] is True
    i = run3.index(HERO)
    frames = range(key.frame, key.attrs["end"] + 1)
    to_ball = run3.ball_pos[frames, :2] - run3.pos[frames, i]
    ball_dir = np.arctan2(to_ball[:, 1], to_ball[:, 0])
    offset = np.abs(np.angle(np.exp(1j * (run3.head_yaw[frames, i] - ball_dir))))
    assert offset.max() > np.deg2rad(90)


def test_belief_is_the_last_sighting_extrapolated_up_to_a_horizon():
    store = BeliefStore(n=3, frame=0, pos=np.zeros((3, 2)), vel=np.zeros((3, 2)))
    seen = np.zeros((3, 3), dtype=bool)
    seen[0, 1] = True
    store.update(
        seen,
        frame=10,
        pos=np.array([[0, 0], [5, 0], [9, 9]]),
        vel=np.array([[0, 0], [2, 0], [0, 0]]),
    )
    pos, vel, age = store.estimate(observer=0, frame=35, dt=0.04, horizon_s=0.5)
    np.testing.assert_allclose(pos[1], [5 + 2 * 0.5, 0])  # 1 s old, extrapolated for 0.5 s
    np.testing.assert_allclose(pos[2], [0, 0])  # never seen since the start
    np.testing.assert_allclose(age[1:], [1.0, 1.4])


# --- 3.5 decisions on belief -------------------------------------------------------------


def test_decision_values_follow_the_belief_state():
    # Carrier H at the centre, one teammate ahead, one opponent. Only the belief changes.
    team = np.array([0, 0, 1])
    carrier = 0
    free = np.array([[0.0, 0.0], [20.0, 0.0], [20.0, 15.0]])
    marked = np.array([[0.0, 0.0], [20.0, 0.0], [21.0, 0.5]])
    zeros = np.zeros((3, 2))
    ages = np.zeros(3)

    def pass_value(positions):
        ctx = DecisionContext(carrier=carrier, team=team, pos=positions, vel=zeros, age_s=ages)
        options = evaluate_options(ctx)
        return next(o for o in options if o.action == "pass:1")

    assert pass_value(free).p_complete > pass_value(marked).p_complete + 0.4
    assert pass_value(free).value > pass_value(marked).value


def test_without_the_key_scan_the_runner_is_believed_where_he_was_last_seen():
    result = drop_scan_counterfactual(SCENARIO, seed=3)
    f, c = result.factual_decision, result.counterfactual_decision
    assert f.player == c.player == HERO and f.frame == c.frame
    assert c.belief_error[RUNNER] > f.belief_error[RUNNER] + 3.0


# --- 3.6 hero scenario: scanning changes information, which changes decisions -------------


def test_dropping_the_key_scan_changes_the_chosen_action_in_most_held_out_seeds():
    results = [drop_scan_counterfactual(SCENARIO, seed=s) for s in range(100, 120)]
    changed = sum(r.factual_action != r.counterfactual_action for r in results)
    to_runner = sum(r.factual_action == f"pass:{RUNNER}" for r in results)
    assert changed / len(results) >= 0.6
    assert to_runner / len(results) >= 0.6
    assert all(np.isfinite(r.delta_xt) for r in results)
