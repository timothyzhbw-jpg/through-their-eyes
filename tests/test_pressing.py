"""Acceptance checks for the pressing-intensity kernel (SPEC 4.3)."""

import numpy as np

from analytics.pressing import (
    frame_pressing,
    intercept_probability,
    pressing_intensity,
    pressure_over_frames,
)
from sim.engine import Simulation


def _random_frame(seed: int):
    rng = np.random.default_rng(seed)
    half = np.array([52.5, 34.0])
    pos = rng.uniform(-half, half, size=(22, 2))
    vel = rng.normal(0.0, 3.0, size=(22, 2))
    team = np.repeat([0, 1], 11)
    carrier = int(rng.integers(0, 22))
    ball = pos[carrier] + np.array([0.3, 0.0])
    return pos, vel, team, ball, carrier


def test_intercept_probability_is_one_half_at_the_time_threshold():
    p = intercept_probability(np.array([0.5, 1.5, 3.0]), threshold=1.5)
    assert np.isclose(p[1], 0.5)
    assert p[0] > 0.9 and p[2] < 0.01


def test_pressing_values_are_probabilities():
    for seed in range(5):
        pos, vel, team, ball, carrier = _random_frame(seed)
        pf = frame_pressing(pos, vel, team, ball, carrier)
        for values in (pf.matrix, pf.ball, np.array([pf.on_carrier, pf.on_ball])):
            assert values.min() >= 0.0 and values.max() <= 1.0
        assert pf.matrix.shape == (11, 11)
        assert set(pf.defenders) | set(pf.attackers) == set(range(22))
        assert all(team[d] != team[carrier] for d in pf.defenders)


def test_pressure_rises_as_a_defender_closes_in():
    att, ball = np.zeros(2), np.array([0.3, 0.0])
    pressures = []
    for d in np.linspace(20.0, 0.5, 40):
        pos = np.array([att, [d, 0.0]])
        pf = frame_pressing(pos, np.zeros((2, 2)), np.array([0, 1]), ball, carrier=0)
        pressures.append(pf.on_carrier)
    assert np.all(np.diff(pressures) >= 0.0)
    assert pressures[0] < 0.01 and pressures[-1] > 0.9


def test_a_defender_running_at_the_carrier_presses_harder_than_one_running_away():
    pos = np.array([[0.0, 0.0], [6.0, 0.0]])
    team, ball = np.array([0, 1]), np.array([0.3, 0.0])
    toward = frame_pressing(pos, np.array([[0.0, 0.0], [-4.0, 0.0]]), team, ball, 0)
    away = frame_pressing(pos, np.array([[0.0, 0.0], [4.0, 0.0]]), team, ball, 0)
    assert toward.on_carrier > away.on_carrier + 0.3


def test_more_defenders_mean_more_pressure():
    team, ball = np.array([0, 1, 1]), np.array([0.3, 0.0])
    pos = np.array([[0.0, 0.0], [4.0, 0.0], [40.0, 0.0]])
    one = frame_pressing(pos, np.zeros((3, 2)), team, ball, 0).on_carrier
    pos[2] = [0.0, 4.0]
    two = frame_pressing(pos, np.zeros((3, 2)), team, ball, 0).on_carrier
    assert two > one


def test_pressing_is_symmetric_under_team_swap_and_pitch_flip():
    for seed in range(5):
        pos, vel, team, ball, carrier = _random_frame(seed)
        pf = frame_pressing(pos, vel, team, ball, carrier)
        # The other team has the ball on a pitch rotated by 180 degrees.
        sw = frame_pressing(-pos, -vel, 1 - team, -ball, carrier)
        np.testing.assert_array_equal(pf.defenders, sw.defenders)
        np.testing.assert_array_equal(pf.attackers, sw.attackers)
        np.testing.assert_allclose(sw.matrix, pf.matrix, atol=1e-12)
        np.testing.assert_allclose(sw.ball, pf.ball, atol=1e-12)
        assert np.isclose(sw.on_carrier, pf.on_carrier, atol=1e-12)


def test_the_carrier_column_includes_pressure_on_the_ball():
    # The defender is closer to the ball than to the carrier's body: the ball counts.
    pos = np.array([[0.0, 0.0], [4.0, 0.0]])
    team, vel = np.array([0, 1]), np.zeros((2, 2))
    near_ball = frame_pressing(pos, vel, team, np.array([2.0, 0.0]), 0)
    assert near_ball.matrix[0, 0] == near_ball.ball[0]
    body = pressing_intensity(pos[1:], vel[1:], pos[:1])
    assert near_ball.matrix[0, 0] > body[0, 0]


def test_a_free_ball_has_no_carrier_pressure():
    pos, vel, team, ball, _ = _random_frame(0)
    pf = frame_pressing(pos, vel, team, ball, carrier=-1, pressed_team=0)
    assert np.isnan(pf.on_carrier)
    assert 0.0 <= pf.on_ball <= 1.0


def test_pressure_over_a_run_is_nan_exactly_when_the_ball_is_free():
    run = Simulation.from_scenario("blind_side_run", seed=3).run()
    team = np.array([p.team for p in run.players])
    pressure = pressure_over_frames(run.pos, run.vel, team, run.ball_pos[:, :2], run.owner)
    assert pressure.shape == run.owner.shape
    np.testing.assert_array_equal(np.isnan(pressure), run.owner < 0)
    owned = pressure[run.owner >= 0]
    assert owned.min() >= 0.0 and owned.max() <= 1.0
