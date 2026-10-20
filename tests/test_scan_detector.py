"""Scan detector (SPEC 4.7): recover scans from head yaw plus player and ball positions only."""

import ast
import inspect

import numpy as np
import pytest

from analytics import scan_detector
from analytics.scan_detector import ScanDetectorParams, detect_all, detect_scans

DT = 0.04
PARAMS = ScanDetectorParams(omega_threshold=np.deg2rad(200.0), min_excursion=np.deg2rad(60.0))


def _scene(frames: int, ball=(10.0, 0.0)):
    """A player at the centre spot looking at a static ball."""
    pos = np.zeros((frames, 2))
    ball = np.tile(np.asarray(ball, dtype=float), (frames, 1))
    yaw = np.full(frames, np.arctan2(ball[0, 1], ball[0, 0]))
    return yaw, pos, ball


def _turn(yaw, start, amplitude_deg, out=3, dwell=3, back=3):
    """Head turns by `amplitude_deg` over `out` frames, holds, and comes back over `back` frames."""
    yaw = yaw.copy()
    a = np.deg2rad(amplitude_deg)
    profile = np.concatenate(
        [np.linspace(0, a, out + 1)[1:], np.full(dwell, a), np.linspace(a, 0, back + 1)[1:]]
    )
    yaw[start + 1 : start + 1 + len(profile)] += profile
    return yaw


def test_a_fast_turn_away_and_back_is_one_scan_with_its_start_and_end():
    yaw, pos, ball = _scene(100)
    yaw = _turn(yaw, 40, 90.0)
    scans = detect_scans(yaw, pos, ball, DT, PARAMS)
    assert len(scans) == 1
    s = scans[0]
    assert s.start == 40
    assert 47 <= s.end <= 50
    assert s.side == 1
    assert np.isclose(s.amplitude, np.deg2rad(90.0))


def test_a_scan_across_the_pi_boundary_is_found():
    yaw, pos, ball = _scene(80, ball=(-10.0, 0.01))  # ball direction just below +pi
    yaw = _turn(yaw, 20, 80.0)  # turns through +pi into negative angles
    yaw = np.angle(np.exp(1j * yaw))
    scans = detect_scans(yaw, pos, ball, DT, PARAMS)
    assert [s.start for s in scans] == [20]


def test_scans_to_either_side_are_found():
    yaw, pos, ball = _scene(140)
    yaw = _turn(_turn(yaw, 20, 100.0), 80, -100.0)
    scans = detect_scans(yaw, pos, ball, DT, PARAMS)
    assert [(s.start, s.side) for s in scans] == [(20, 1), (80, -1)]


def test_slow_drift_away_from_the_ball_is_not_a_scan():
    yaw, pos, ball = _scene(150)
    yaw = yaw + np.deg2rad(np.clip(np.arange(150) - 20, 0, 60) * 1.0)  # 25 deg/s up to 60 deg
    assert detect_scans(yaw, pos, ball, DT, PARAMS) == []


def test_a_part_way_turn_that_comes_straight_back_is_not_a_scan():
    yaw, pos, ball = _scene(100)
    yaw = _turn(yaw, 40, 35.0, out=1, dwell=0, back=1)
    assert detect_scans(yaw, pos, ball, DT, PARAMS) == []


def test_tracking_a_fast_ball_is_not_a_scan():
    frames = 75
    t = np.arange(frames) * DT
    angle = np.deg2rad(300.0) * t  # ball circling the player at 300 deg/s
    ball = 5.0 * np.stack([np.cos(angle), np.sin(angle)], axis=-1)
    pos = np.zeros((frames, 2))
    yaw = np.concatenate([[angle[0]], angle[:-1]])  # head one frame behind the ball
    omega = np.diff(yaw) / DT
    assert np.abs(omega).max() > PARAMS.omega_threshold  # fast head motion, but on the ball
    assert detect_scans(yaw, pos, ball, DT, PARAMS) == []


def test_sensor_noise_alone_is_not_a_scan_even_at_the_lowest_threshold():
    yaw, pos, ball = _scene(2000)
    yaw = yaw + np.random.default_rng(0).normal(0.0, np.deg2rad(2.0), 2000)
    low = ScanDetectorParams(omega_threshold=np.deg2rad(125.0), min_excursion=np.deg2rad(60.0))
    assert detect_scans(yaw, pos, ball, DT, low) == []


def test_without_an_excursion_gate_the_lowest_threshold_over_counts_noise():
    # The velocity-only reading of the literature threshold: noise spikes become "scans".
    yaw, pos, ball = _scene(2000)
    yaw = yaw + np.random.default_rng(0).normal(0.0, np.deg2rad(2.0), 2000)
    velocity_only = ScanDetectorParams(
        omega_threshold=np.deg2rad(125.0), min_excursion=0.0, return_tolerance=np.deg2rad(2.0)
    )
    assert len(detect_scans(yaw, pos, ball, DT, velocity_only)) > 20


def test_detect_all_runs_every_player_of_a_tracking_array():
    yaw0, pos0, ball = _scene(100)
    yaw = np.stack([_turn(yaw0, 30, 90.0), yaw0, _turn(yaw0, 60, -120.0)], axis=1)  # (F, 3)
    pos = np.repeat(pos0[:, None, :], 3, axis=1)
    found = detect_all(yaw, pos, np.concatenate([ball, np.zeros((100, 1))], axis=1), DT, PARAMS)
    assert [[s.start for s in player] for player in found] == [[30], [], [60]]


def test_the_detector_sees_tracking_arrays_only_and_never_imports_the_sim():
    tree = ast.parse(inspect.getsource(scan_detector))
    modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    assert not any(m and (m == "sim" or m.startswith("sim.")) for m in modules)
    signature = inspect.signature(detect_scans)
    assert list(signature.parameters)[:4] == ["head_yaw", "player_pos", "ball_pos", "dt"]


# --- matching and the SPEC 4.7 acceptance check on held-out sim seeds ---------------------


def test_matching_is_one_to_one_within_the_tolerance():
    from eval.scan_detector import match

    matched, false_pos, missed = match(truth=[10, 50, 90], detected=[11, 12, 52, 200], tolerance=3)
    assert matched == [(10, 11), (50, 52)]
    assert false_pos == [12, 200]
    assert missed == [90]


@pytest.mark.parametrize(
    "scenario,seeds", [("possession_play", (100, 101)), ("blind_side_run", range(100, 110))]
)
def test_f1_on_held_out_seeds_with_nuisance_on_meets_the_spec(scenario, seeds):
    from eval.scan_detector import POSSESSION_PARAMS, score, simulate
    from sim.config import SimParams

    params = POSSESSION_PARAMS if scenario == "possession_play" else SimParams()
    samples = [simulate(scenario, seed, params) for seed in seeds]
    counts = score(samples, ScanDetectorParams())  # the chosen defaults
    assert counts.tp > 50
    assert counts.f1 >= 0.85
