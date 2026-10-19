"""Acceptance checks for the pressing-intensity kernel (SPEC 4.3, after Bekkers 2025)."""

import numpy as np
import pytest

from analytics.pressing import (
    PressingParams,
    frame_pressing,
    pressing_matrix,
    pressure_on,
)
from sim.engine import Simulation


def _random_frame(seed: int, n: int = 22) -> tuple[np.ndarray, ...]:
    gen = np.random.default_rng(seed)
    pos = gen.uniform([-52.5, -34.0], [52.5, 34.0], (n, 2))
    vel = gen.normal(0.0, 3.0, (n, 2))
    team = np.repeat([0, 1], n // 2)
    owner = int(gen.integers(0, n))
    ball_pos = pos[owner] + np.array([0.3, 0.0])
    ball_vel = vel[owner].copy()
    return pos, vel, team, ball_pos, ball_vel, owner


@pytest.mark.parametrize("seed", range(10))
def test_values_are_probabilities(seed):
    pos, vel, team, ball_pos, ball_vel, owner = _random_frame(seed)
    frame = frame_pressing(pos, vel, team, ball_pos, ball_vel, owner)
    assert frame.matrix.shape == (11, 11)
    assert np.all(frame.matrix >= 0.0) and np.all(frame.matrix <= 1.0)
    assert np.all(frame.pressure >= 0.0) and np.all(frame.pressure <= 1.0)
    assert 0.0 <= frame.on_carrier <= 1.0


def test_values_are_probabilities_on_a_sim_run():
    run = Simulation.from_scenario("blind_side_run", seed=3).run()
    team = np.array([p.team for p in run.players])
    for f in range(0, len(run.owner), 5):
        frame = frame_pressing(
            run.pos[f], run.vel[f], team, run.ball_pos[f, :2], run.ball_vel[f, :2],
            int(run.owner[f]), attacking_team=0,
        )  # fmt: skip
        assert np.all((frame.matrix >= 0.0) & (frame.matrix <= 1.0))


@pytest.mark.parametrize(
    ("speed", "distances"),
    [(0.0, (12.0, 8.0, 5.0, 3.0, 1.5, 0.5)), (4.0, (12.0, 8.0, 5.0, 3.0))],
)
def test_pressure_rises_as_a_defender_closes_in(speed, distances):
    attacker, still = np.array([[0.0, 0.0]]), np.zeros((1, 2))
    toward = np.array([[-speed, 0.0]])  # standing, or running straight at the attacker
    values = [
        pressing_matrix(np.array([[d, 0.0]]), toward, attacker, still)[0, 0] for d in distances
    ]
    assert all(b > a for a, b in zip(values, values[1:], strict=False))
    assert values[0] < 0.05 and values[-1] > 0.9


def test_a_defender_running_away_presses_less_than_one_running_toward():
    attacker, still = np.array([[0.0, 0.0]]), np.zeros((1, 2))
    defender = np.array([[4.0, 0.0]])
    toward = pressing_matrix(defender, np.array([[-4.0, 0.0]]), attacker, still)[0, 0]
    standing = pressing_matrix(defender, np.zeros((1, 2)), attacker, still)[0, 0]
    away = pressing_matrix(defender, np.array([[4.0, 0.0]]), attacker, still)[0, 0]
    assert toward > standing > away


@pytest.mark.parametrize("seed", range(5))
def test_symmetric_under_team_swap_and_pitch_flip(seed):
    pos, vel, team, ball_pos, ball_vel, owner = _random_frame(seed)
    a = frame_pressing(pos, vel, team, ball_pos, ball_vel, owner)
    b = frame_pressing(-pos, -vel, 1 - team, -ball_pos, -ball_vel, owner)
    np.testing.assert_array_equal(a.defenders, b.defenders)
    np.testing.assert_array_equal(a.attackers, b.attackers)
    np.testing.assert_allclose(a.matrix, b.matrix, atol=1e-12)
    assert a.on_carrier == pytest.approx(b.on_carrier, abs=1e-12)


def test_carrier_column_is_the_max_of_pressure_on_him_and_on_the_ball():
    attackers = np.array([[0.0, 0.0], [10.0, 10.0]])
    defenders = np.array([[3.0, 0.0], [-3.0, 0.0]])
    att_vel, def_vel = np.zeros((2, 2)), np.zeros((2, 2))
    ball = np.array([2.0, 0.0])  # nearer the first defender than the carrier is
    plain = pressing_matrix(defenders, def_vel, attackers, att_vel)
    with_ball = pressing_matrix(
        defenders, def_vel, attackers, att_vel, ball_pos=ball, ball_vel=np.zeros(2), carrier=0
    )
    ball_only = pressing_matrix(defenders, def_vel, ball[None], np.zeros((1, 2)))[:, 0]
    np.testing.assert_allclose(with_ball[:, 0], np.maximum(plain[:, 0], ball_only))
    np.testing.assert_array_equal(with_ball[:, 1], plain[:, 1])
    assert with_ball[0, 0] > plain[0, 0]


def test_aggregate_is_one_minus_the_chance_that_no_defender_arrives():
    matrix = np.array([[0.5, 0.1], [0.2, 0.0], [0.0, 0.0]])
    np.testing.assert_allclose(pressure_on(matrix), [1 - 0.5 * 0.8, 0.1])
    assert pressure_on(np.zeros((0, 3))).tolist() == [0.0, 0.0, 0.0]


def test_active_pressing_threshold_drops_slow_defenders():
    attacker, still = np.array([[0.0, 0.0]]), np.zeros((1, 2))
    defenders = np.array([[2.0, 0.0], [0.0, 2.0]])
    vel = np.array([[-1.0, 0.0], [0.0, -3.0]])
    params = PressingParams(active_speed=2.0)
    p = pressing_matrix(defenders, vel, attacker, still, params=params)
    assert p[0, 0] == 0.0 and p[1, 0] > 0.5


def test_free_ball_has_no_carrier():
    pos, vel, team, ball_pos, ball_vel, _ = _random_frame(0)
    frame = frame_pressing(pos, vel, team, ball_pos, ball_vel, -1, attacking_team=1)
    assert frame.carrier is None and np.isnan(frame.on_carrier)
    assert set(team[frame.attackers]) == {1}
    with pytest.raises(ValueError):
        frame_pressing(pos, vel, team, ball_pos, ball_vel, -1)
