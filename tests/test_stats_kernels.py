"""Acceptance checks for the live match stats kernels (SPEC 4.6, analytics/stats.py).

Hand-built tracks with known answers: speed, distance, sprints and milestones respect tracking
segments (a stitched match's possessions), the lane risk follows time to intercept, and the pass
difficulty is the documented formula.
"""

import numpy as np
import pytest

from analytics import stats
from analytics.pressing import intercept_probability
from analytics.tti import time_to_intercept

DT = 0.04


def _line(frames: int, speed: float, start=(0.0, 0.0), direction=(1.0, 0.0)) -> np.ndarray:
    """(F, 2): constant speed along `direction` from `start`."""
    t = np.arange(frames)[:, None] * DT
    return np.asarray(start) + t * speed * np.asarray(direction)


# --- thresholds and constants ---------------------------------------------------------------


def test_thresholds_are_the_cited_entry_speeds():
    # Gualtieri et al. (2023): 19.8 and 25.2 km/h are the most common entry speeds for men.
    assert pytest.approx(19.8) == stats.HSR_MPS * 3.6
    assert pytest.approx(25.2) == stats.SPRINT_MPS * 3.6
    assert stats.SPRINT_MIN_FRAMES == 10  # 0.4 s at 25 Hz, as the sprint moment
    assert stats.SMOOTH_FRAMES == 5 and stats.RELEASE_FRAMES == 5  # 0.2 s


def test_the_sprint_tag_and_the_sprint_moment_share_the_threshold_and_dwell():
    from explain.moments import MIN_SPRINT_S, SPRINT_MPS

    assert stats.SPRINT_MPS == SPRINT_MPS
    assert round(MIN_SPRINT_S / DT) == stats.SPRINT_MIN_FRAMES


# --- segments -------------------------------------------------------------------------------


def test_segment_starts_maps_every_frame_to_the_first_frame_of_its_segment():
    starts = stats.segment_starts(10, [0, 4, 7])
    assert starts.tolist() == [0, 0, 0, 0, 4, 4, 4, 7, 7, 7]
    assert stats.segment_starts(5, []).tolist() == [0] * 5  # no breaks: one segment
    assert stats.segment_starts(5, [3]).tolist() == [0, 0, 0, 3, 3]  # frame 0 always starts one


# --- speed ----------------------------------------------------------------------------------


def test_speed_of_a_constant_run_is_its_speed_and_zero_on_the_first_frame():
    track = _line(30, 6.0)[:, None, :]  # one player
    v = stats.smoothed_speed(track, DT)
    assert v.shape == (30, 1)
    assert v[0, 0] == 0.0
    assert np.allclose(v[1:, 0], 6.0)


def test_speed_averages_over_the_last_fifth_of_a_second():
    # Standing for 10 frames, then 5 m/s: the smoothed speed ramps up over 5 frames.
    x = np.concatenate([np.zeros(10), 5.0 * DT * np.arange(1, 11)])
    track = np.stack([x, np.zeros_like(x)], axis=-1)[:, None, :]
    v = stats.smoothed_speed(track, DT)[:, 0]
    assert np.allclose(v[:10], 0.0)
    assert np.allclose(v[10:15], 5.0 * np.arange(1, 6) / 5)
    assert np.allclose(v[15:], 5.0)


def test_speed_never_spans_a_segment_break():
    # The player teleports 40 m at frame 10 (a new possession): no speed spike there.
    a = _line(10, 4.0)
    b = _line(10, 4.0, start=(40.0, 0.0))
    track = np.concatenate([a, b])[:, None, :]
    v = stats.smoothed_speed(track, DT, breaks=[10])
    assert v[10, 0] == 0.0
    assert np.allclose(v[11:, 0], 4.0)
    assert v.max() < 4.0 + 1e-9


def test_speed_works_on_the_ball_track():
    ball = _line(20, 15.0)
    v = stats.smoothed_speed(ball, DT)
    assert v.shape == (20,)
    assert np.allclose(v[1:], 15.0)


def test_smoothed_velocity_points_along_the_run():
    track = _line(20, 5.0, direction=(0.6, 0.8))[:, None, :]
    vel = stats.smoothed_velocity(track, DT)
    assert vel.shape == (20, 1, 2)
    assert np.allclose(vel[5:, 0], [3.0, 4.0])
    assert np.allclose(np.linalg.norm(vel, axis=-1), stats.smoothed_speed(track, DT))


# --- distance -------------------------------------------------------------------------------


def test_distance_covered_sums_steps_and_skips_the_break():
    a = _line(26, 5.0)  # 25 steps of 0.2 m: 5 m
    b = _line(26, 2.5, start=(-30.0, 10.0))  # 25 steps of 0.1 m: 2.5 m
    track = np.concatenate([a, b])[:, None, :]
    d = stats.cumulative_distance(track, breaks=[26])
    assert d.shape == (52, 1)
    assert d[0, 0] == 0.0
    assert d[25, 0] == pytest.approx(5.0)
    assert d[26, 0] == pytest.approx(5.0)  # the jump to the new possession does not count
    assert d[-1, 0] == pytest.approx(7.5)
    assert np.all(np.diff(d[:, 0]) >= 0)


def test_distance_above_a_speed_counts_only_steps_that_end_above_it():
    x = np.concatenate([np.zeros(5), 8.0 * DT * np.arange(1, 26)])  # stand, then 8 m/s
    track = np.stack([x, np.zeros_like(x)], axis=-1)[:, None, :]
    v = stats.smoothed_speed(track, DT)
    total = stats.cumulative_distance(track)
    fast = stats.cumulative_distance(track, mask=v > stats.SPRINT_MPS)
    # Steps ending at frames whose 0.2 s average is above 7 m/s: from the 5th frame of the run.
    assert fast[-1, 0] == pytest.approx(total[-1, 0] - 4 * 8.0 * DT)
    assert np.all(fast <= total + 1e-12)


# --- runs above a threshold (sprints) and milestones ----------------------------------------


def test_runs_above_need_the_minimum_dwell_and_stop_at_a_break():
    v = np.zeros(40)
    v[2:8] = 8.0  # 6 frames: too short
    v[10:25] = 8.0  # 15 frames, split by a break at 20
    v[30:40] = 8.0  # 10 frames to the end of the data
    runs = stats.runs_above(v, 7.0, 10, breaks=[20])
    assert runs == [(10, 20), (30, 40)]  # end exclusive; (20, 25) is only 5 frames
    assert stats.runs_above(v, 7.0, 5, breaks=[20]) == [(2, 8), (10, 20), (20, 25), (30, 40)]


def test_milestones_mark_the_first_frame_at_each_step():
    cum = np.array([0.0, 100.0, 249.9, 250.0, 300.0, 520.0, 760.0, 760.0])
    assert stats.milestones(cum, 250.0) == [(3, 250), (5, 500), (6, 750)]
    assert stats.milestones(np.zeros(5), 250.0) == []


# --- release speed --------------------------------------------------------------------------


def test_release_speed_is_the_mean_ball_speed_over_the_first_fifth_of_a_second():
    ball = np.concatenate([np.zeros((3, 2)), _line(20, 18.0)[1:]])  # kicked at frame 2
    assert stats.release_speed(ball, kick=2, end=40, dt=DT) == pytest.approx(18.0)
    # Resolved after 3 frames: only those frames count.
    assert stats.release_speed(ball, kick=2, end=5, dt=DT) == pytest.approx(18.0)


def test_release_frame_is_five_frames_after_the_kick_or_the_resolution():
    assert stats.release_frame(kick=100, end=130) == 105
    assert stats.release_frame(kick=100, end=103) == 103


# --- lane risk ------------------------------------------------------------------------------


def _pass_path(length=20.0, speed=12.0):
    """The ball's path from the kick (t = 0) at `speed`, sampled every frame."""
    k = int(round(length / speed / DT))
    times = DT * np.arange(k + 1)
    path = np.stack([speed * times, np.zeros(k + 1)], axis=-1)
    return path, times


def test_lane_risk_is_zero_without_opponents_and_high_with_one_on_the_line():
    path, times = _pass_path()
    assert stats.lane_risk(np.empty((0, 2)), np.empty((0, 2)), path, times) == 0.0
    # Standing 0.5 m off the line, 6 m out: the ball runs into him before he reacts.
    on_line = stats.lane_risk(np.array([[6.0, 0.5]]), np.zeros((1, 2)), path, times)
    far = stats.lane_risk(np.array([[6.0, 25.0]]), np.zeros((1, 2)), path, times)
    assert on_line > 0.9 and far < 0.01


def test_lane_risk_is_the_reference_formula():
    """Per opponent the larger of two chances, as the decision model's P(win ball) (SPEC 3.5) on
    the tracked state: he reacts and reaches a point of the path before the ball (time to
    intercept, the logistic of Spearman et al. 2017), or the ball comes within the control radius
    of his run before he reacts (the run-in). Then 1 - prod(1 - p) over opponents."""
    from analytics.pitch_control import logistic
    from sim.decision import _run_in_miss

    path, times = _pass_path()
    pos = np.array([[8.0, 3.0], [15.0, -4.0], [2.0, 9.0], [3.0, 0.8]])
    vel = np.array([[0.0, -2.0], [1.0, 1.0], [0.0, 0.0], [1.5, 0.0]])
    tti = time_to_intercept(pos, vel, path)
    p_tti = intercept_probability(tti, threshold=times[None, :], sigma=stats.LANE_SIGMA_S)
    miss = _run_in_miss(pos, vel, times, path, stats.REACTION_S)
    k = np.pi / (np.sqrt(3.0) * stats.RUN_IN_SPREAD_M)
    p_run_in = logistic(k * (stats.CONTROL_RADIUS_M - miss))
    p = np.maximum(p_tti.max(axis=1), p_run_in)
    risk, per_opponent = stats.lane_risk(pos, vel, path, times, per_opponent=True)
    assert np.allclose(per_opponent, p)
    assert risk == pytest.approx(1.0 - np.prod(1.0 - p))
    assert stats.run_in_miss(pos, vel, times, path) == pytest.approx(miss)


def test_lane_risk_uses_the_decision_models_parameters():
    from sim.config import SimParams
    from sim.decision import DecisionParams

    d = DecisionParams()
    assert stats.LANE_SIGMA_S == d.sigma == 0.45  # Spearman et al. (2017), as in pitch control
    assert d.uncertainty0 == stats.RUN_IN_SPREAD_M  # a fresh sighting: the tracked truth
    assert SimParams().control_radius == stats.CONTROL_RADIUS_M
    assert d.reaction == stats.REACTION_S


def test_lane_risk_never_drops_when_an_opponent_is_added_or_comes_closer():
    path, times = _pass_path()
    one = stats.lane_risk(np.array([[10.0, 6.0]]), np.zeros((1, 2)), path, times)
    closer = stats.lane_risk(np.array([[10.0, 3.0]]), np.zeros((1, 2)), path, times)
    two = stats.lane_risk(np.array([[10.0, 6.0], [4.0, -7.0]]), np.zeros((2, 2)), path, times)
    assert closer > one and two >= one
    assert 0.0 <= one <= 1.0


# --- difficulty -----------------------------------------------------------------------------


def test_difficulty_is_the_documented_weighted_sum():
    w = stats.DIFFICULTY_WEIGHTS
    assert w == {"lane": 0.4, "passer": 0.2, "receiver": 0.2, "distance": 0.2}
    assert stats.DISTANCE_SCALE_M == 50.0
    value, parts = stats.pass_difficulty(lane=0.5, passer=0.25, receiver=1.0, distance_m=20.0)
    assert parts == {"lane": 0.5, "passer": 0.25, "receiver": 1.0, "distance": 0.4}
    assert value == pytest.approx(0.4 * 0.5 + 0.2 * 0.25 + 0.2 * 1.0 + 0.2 * 0.4)


def test_difficulty_stays_in_the_unit_interval_and_distance_saturates():
    assert stats.pass_difficulty(0.0, 0.0, 0.0, 0.0)[0] == 0.0
    assert stats.pass_difficulty(1.0, 1.0, 1.0, 80.0)[0] == pytest.approx(1.0)
    assert stats.pass_difficulty(0.0, 0.0, 0.0, 120.0)[1]["distance"] == 1.0


def test_difficulty_bands_for_viewers():
    assert [stats.difficulty_band(x) for x in (0.0, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 1.0)] == [
        "routine", "routine", "moderate", "moderate", "hard", "hard", "very hard", "very hard"
    ]  # fmt: skip
