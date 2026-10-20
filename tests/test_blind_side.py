"""Blind-side alerts (SPEC 4.4): from tracking only — observed head yaw plus positions."""

import ast
import inspect
from dataclasses import replace

import numpy as np
import pytest

from analytics import blind_side
from analytics.blind_side import BlindSideParams, detect_alerts

DT = 0.04
# SPEC 4.4 as written: move measured from the last sighting, no expectation; not the tuned values.
SPEC = BlindSideParams(min_unseen_s=1.0, min_moved_m=3.0, expect_s=0.0)


def _scene(frames: int, start: list, vel: list, head: list, owner: int, team: list):
    """Players moving at constant velocity with fixed head yaw; the ball at the owner's feet."""
    t = np.arange(frames)[:, None, None] * DT
    pos = np.asarray(start, dtype=float)[None] + t * np.asarray(vel, dtype=float)[None]
    vel = np.broadcast_to(np.asarray(vel, dtype=float), pos.shape).copy()
    yaw = np.broadcast_to(np.asarray(head, dtype=float), pos.shape[:2]).copy()
    ball = pos[:, owner] + np.array([0.3, 0.0])
    ball_vel = vel[:, owner]
    owners = np.full(frames, owner)
    return yaw, pos, vel, ball, ball_vel, owners, np.asarray(team)


def _pairs(result):
    return {(a.observer, a.target) for a in result.intervals}


def test_a_teammate_running_behind_the_carrier_raises_an_alert_after_a_second_unseen():
    # 0: carrier at the centre looking +x; 1: teammate behind him running away at 6 m/s.
    scene = _scene(60, [[0, 0], [-5, 2]], [[0, 0], [-6, 0]], [0.0, 0.0], owner=0, team=[0, 0])
    result = detect_alerts(*scene, DT, SPEC)
    assert len(result.intervals) == 1
    alert = result.intervals[0]
    assert (alert.observer, alert.target) == (0, 1)
    assert alert.start == 25  # last seen at frame 0 (everyone is known at the start), 1.0 s
    assert alert.end == 59  # still unseen when the data ends
    assert result.per_frame[24] == [] and result.per_frame[25] == [(0, 1)]


@pytest.mark.parametrize(
    "frames,start,vel,params",
    [
        (60, [[0, 0], [8, 1]], [[0, 0], [6, 0]], SPEC),  # in front of him: seen
        (60, [[0, 0], [-5, 2]], [[0, 0], [-3, 0]], SPEC),  # slower than 4 m/s
        (60, [[0, 0], [-40, 2]], [[0, 0], [-6, 0]], SPEC),  # beyond max_distance
        # unseen long enough, but only 2.5 m from where he was last seen
        (15, [[0, 0], [-5, 2]], [[0, 0], [0, 4.5]], replace(SPEC, min_unseen_s=0.4)),
    ],
)
def test_no_alert_when_a_condition_fails(frames, start, vel, params):
    scene = _scene(frames, start, vel, [0.0, 0.0], owner=0, team=[0, 0])
    assert detect_alerts(*scene, DT, params).intervals == []


def test_with_an_expectation_a_runner_who_carries_on_is_flagged_later():
    # 1 runs past the carrier's shoulder into his blind side at a steady 6 m/s.
    scene = _scene(80, [[0, 0], [3, 6]], [[0, 0], [-6, 0]], [0.0, 0.0], owner=0, team=[0, 0])
    plain = detect_alerts(*scene, DT, SPEC).intervals[0].start
    expecting = detect_alerts(*scene, DT, replace(SPEC, expect_s=1.0)).intervals[0].start
    assert expecting - plain >= round(0.5 / DT)  # 3 m off the expected spot only 0.5 s later


def test_with_an_expectation_a_runner_who_turns_is_flagged_as_early_as_without():
    yaw, pos, vel, ball, ball_vel, owner, team = _scene(
        80, [[0, 0], [3, 6]], [[0, 0], [-6, 0]], [0.0, 0.0], owner=0, team=[0, 0]
    )
    turn = 15  # out of his view by now; he turns and runs down behind the carrier's back
    pos[turn:, 1] = pos[turn, 1] + np.arange(80 - turn)[:, None] * DT * np.array([0.0, -6.0])
    vel[turn:, 1] = [0.0, -6.0]
    scene = (yaw, pos, vel, ball, ball_vel, owner, team)
    plain = detect_alerts(*scene, DT, SPEC).intervals[0].start
    expecting = detect_alerts(*scene, DT, replace(SPEC, expect_s=1.0)).intervals[0].start
    assert expecting == plain


def test_the_alert_stays_on_at_least_0_4_s_and_clears_when_the_target_is_seen():
    yaw, pos, vel, ball, ball_vel, owner, team = _scene(
        80, [[0, 0], [-5, 2]], [[0, 0], [-6, 0]], [0.0, 0.0], owner=0, team=[0, 0]
    )
    yaw[27:, 0] = np.pi  # he turns round 2 frames after the alert came on: seen at once
    result = detect_alerts(yaw, pos, vel, ball, ball_vel, owner, team, DT, SPEC)
    (alert,) = result.intervals
    assert alert.start == 25
    assert alert.end == 25 + 10 - 1  # held for 0.4 s, then cleared (he has been seen)
    yaw[:, 0] = 0.0
    yaw[50:, 0] = np.pi  # seen long after the onset: clears on that frame
    (alert,) = detect_alerts(yaw, pos, vel, ball, ball_vel, owner, team, DT, SPEC).intervals
    assert alert.end == 49


def test_only_the_four_defenders_nearest_the_ball_watch_opponents():
    # 0: carrier (team 0) on the ball, running +y at 5 m/s; defenders 1-5 (team 1) look along -x,
    # away from him, at growing distances from the ball.
    start = [[0, 0], [3, 0], [5, 0], [7, 0], [9, 0], [11, 0]]
    vel = [[0, 5]] + [[0, 0]] * 5
    head = [np.pi / 2] + [0.0] * 5
    scene = _scene(60, start, vel, head, owner=0, team=[0, 1, 1, 1, 1, 1])
    assert _pairs(detect_alerts(*scene, DT)) == {(1, 0), (2, 0), (3, 0), (4, 0)}


def test_the_intended_receiver_of_a_moving_ball_is_an_observer():
    # The ball is free, rolling from 0 toward 1; 2 (team 0) runs behind 1, who watches the ball.
    yaw, pos, vel, ball, ball_vel, owner, team = _scene(
        60, [[-10, 0], [10, 0], [14, 3]], [[0, 0], [0, 0], [6, 0]], [0.0, np.pi, 0.0],
        owner=0, team=[0, 0, 0],
    )  # fmt: skip
    owner[1:] = -1  # passed at frame 1
    ball[:] = np.linspace([-9.7, 0.0], [5.0, 0.0], 60)
    ball_vel[:] = [8.0, 0.0]
    result = detect_alerts(yaw, pos, vel, ball, ball_vel, owner, team, DT)
    assert (1, 2) in _pairs(result)
    assert all(a.observer != 0 for a in result.intervals)  # the passer is no longer an observer


def test_intervals_and_per_frame_list_agree():
    scene = _scene(80, [[0, 0], [-5, 2], [-4, -3]], [[0, 0], [-6, 0], [-5, -1]],
                   [0.0, 0.0, np.pi / 2], owner=0, team=[0, 0, 0])  # fmt: skip
    result = detect_alerts(*scene, DT)
    assert len(result.per_frame) == 80
    for f, pairs in enumerate(result.per_frame):
        covering = {(a.observer, a.target) for a in result.intervals if a.start <= f <= a.end}
        assert set(pairs) == covering


def test_blind_side_sees_tracking_arrays_only_and_never_imports_the_sim():
    tree = ast.parse(inspect.getsource(blind_side))
    modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    assert not any(m and (m == "sim" or m.startswith("sim.")) for m in modules)
    names = list(inspect.signature(detect_alerts).parameters)
    assert names[:8] == ["head_yaw", "pos", "vel", "ball_pos", "ball_vel", "owner", "team", "dt"]
