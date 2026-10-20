"""Acceptance checks for the pressing-intensity kernel (SPEC 4.3)."""

import numpy as np
import pytest

from analytics.pressing import (
    aggregate,
    frame_pressing,
    intercept_probability,
    pressing_intensity,
    pressure_over_frames,
)
from analytics.tti import time_to_intercept
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


# --- the paper's heading penalty, target lead and active-pressing filter ---------------------


def test_the_heading_penalty_is_speed_times_angle_over_pi():
    defender, target = np.array([[6.0, 0.0]]), np.array([[0.0, 0.0]])
    for vel in ([4.0, 0.0], [0.0, 3.0], [-2.0, 2.0]):
        v = np.array([vel])
        to_target = target[0] - defender[0]
        cos = v[0] @ to_target / (np.linalg.norm(v[0]) * np.linalg.norm(to_target))
        beta = np.arccos(np.clip(cos, -1.0, 1.0))
        tti = time_to_intercept(defender, v, target) + np.linalg.norm(v[0]) * beta / np.pi
        np.testing.assert_allclose(
            pressing_intensity(defender, v, target), intercept_probability(tti), rtol=1e-6
        )
        plain = pressing_intensity(defender, v, target, heading_penalty=False)
        np.testing.assert_allclose(
            plain, intercept_probability(time_to_intercept(defender, v, target))
        )


def test_running_toward_beats_standing_beats_running_across_beats_running_away():
    defender, target = np.array([[6.0, 0.0]]), np.array([[0.0, 0.0]])
    p = [
        pressing_intensity(defender, np.array([v]), target)[0, 0]
        for v in ([-4.0, 0.0], [0.0, 0.0], [0.0, 4.0], [4.0, 0.0])
    ]
    assert p[0] > p[1] > p[2] > p[3]
    assert p[3] < 0.01  # running away at 4 m/s adds 4 s


@pytest.mark.parametrize("distance", [12.0, 8.0, 5.0, 3.0])
def test_a_defender_running_straight_at_the_target_has_no_heading_penalty(distance):
    defender, v, target = np.array([[distance, 0.0]]), np.array([[-4.0, 0.0]]), np.zeros((1, 2))
    np.testing.assert_allclose(
        pressing_intensity(defender, v, target),
        pressing_intensity(defender, v, target, heading_penalty=False),
        atol=1e-9,
    )


def test_pressure_rises_as_a_running_defender_closes_in():
    target = np.zeros((1, 2))
    p = [
        pressing_intensity(np.array([[d, 0.0]]), np.array([[-4.0, 0.0]]), target)[0, 0]
        for d in (12.0, 8.0, 5.0, 3.0)
    ]
    assert all(b > a for a, b in zip(p, p[1:], strict=False))
    assert p[0] < 0.05 and p[-1] > 0.9


def test_the_target_is_pressed_where_it_will_be_one_second_ahead():
    defender, still = np.array([[6.0, 0.0]]), np.zeros((1, 2))
    target = np.zeros((1, 2))
    at = {
        sign: pressing_intensity(defender, still, target, target_vel=np.array([[sign * 5.0, 0.0]]))
        for sign in (1, -1)
    }
    assert at[1][0, 0] > 0.9 and at[-1][0, 0] < 0.01  # running into him vs away from him
    ahead = pressing_intensity(defender, still, np.array([[5.0, 0.0]]))  # 1 s at 5 m/s
    np.testing.assert_allclose(at[1], ahead)
    no_lead = pressing_intensity(
        defender, still, target, target_vel=np.array([[5.0, 0.0]]), target_lead_s=0.0
    )
    np.testing.assert_allclose(no_lead, pressing_intensity(defender, still, target))


def test_frame_pressing_leads_attackers_and_a_carried_ball_by_their_velocity():
    pos = np.array([[0.0, 0.0], [10.0, 5.0], [6.0, 0.0]])
    vel = np.array([[5.0, 0.0], [0.0, -3.0], [0.0, 0.0]])
    team, ball = np.array([0, 0, 1]), np.array([0.3, 0.0])
    pf = frame_pressing(pos, vel, team, ball, 0)
    body = pressing_intensity(pos[2:], vel[2:], pos[:2], target_vel=vel[:2])
    on_ball = pressing_intensity(pos[2:], vel[2:], ball[None], target_vel=vel[:1])
    np.testing.assert_allclose(pf.ball, on_ball[:, 0])
    np.testing.assert_allclose(pf.matrix[:, 0], np.maximum(body[:, 0], on_ball[:, 0]))
    np.testing.assert_allclose(pf.matrix[:, 1], body[:, 1])
    # The carried ball moves with its carrier unless its own velocity is given.
    same = frame_pressing(pos, vel, team, ball, 0, ball_vel=vel[0])
    np.testing.assert_array_equal(same.matrix, pf.matrix)
    still = frame_pressing(pos, vel, team, ball, 0, ball_vel=np.zeros(3))
    assert still.ball[0] < pf.ball[0]


def test_a_free_ball_is_not_extrapolated_unless_its_velocity_is_given():
    pos, vel, team, ball, _ = _random_frame(1)
    plain = frame_pressing(pos, vel, team, ball, -1, 0)
    resting = frame_pressing(pos, vel, team, ball, -1, 0, ball_vel=np.zeros(2))
    np.testing.assert_array_equal(plain.ball, resting.ball)
    rolling = frame_pressing(pos, vel, team, ball, -1, 0, ball_vel=np.array([8.0, 0.0]))
    assert not np.allclose(rolling.ball, plain.ball)


def test_the_active_pressing_filter_drops_slow_defenders_and_is_off_by_default():
    defenders = np.array([[2.0, 0.0], [0.0, 2.0]])
    vel = np.array([[-1.0, 0.0], [0.0, -3.0]])
    target = np.zeros((1, 2))
    default = pressing_intensity(defenders, vel, target)
    filtered = pressing_intensity(defenders, vel, target, active_speed=2.0)
    assert default[0, 0] > 0.5 and filtered[0, 0] == 0.0
    assert filtered[1, 0] == default[1, 0] > 0.5
    pos = np.vstack([np.zeros((1, 2)), defenders])
    team, all_vel = np.array([0, 1, 1]), np.vstack([np.zeros((1, 2)), vel])
    pf = frame_pressing(pos, all_vel, team, np.array([0.3, 0.0]), 0, active_speed=2.0)
    assert pf.matrix[0, 0] == 0.0 and pf.ball[0] == 0.0


def test_aggregate_is_one_minus_the_chance_that_no_defender_arrives():
    np.testing.assert_allclose(aggregate(np.array([[0.5, 0.1], [0.2, 0.0]])), [0.6, 0.1])
    np.testing.assert_array_equal(aggregate(np.zeros((0, 3))), np.zeros(3))


def test_a_free_ball_needs_the_pressed_team():
    pos, vel, team, ball, _ = _random_frame(0)
    with pytest.raises(ValueError):
        frame_pressing(pos, vel, team, ball, -1)
