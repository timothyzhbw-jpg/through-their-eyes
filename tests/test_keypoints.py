"""Limb-tracking ingest (SPEC 4.7): a synthetic keypoint stream in a generic open schema (a
COCO-named subset: nose, ears, shoulders, hips) turned back into position, head yaw and torso yaw,
which feed the scan detector unchanged."""

import ast
import inspect
import json

import numpy as np
import pytest

from analytics import keypoints as adapter
from analytics.keypoints import (
    KEYPOINTS,
    KeypointFrame,
    frames_of,
    keypoint_sigma,
    pose_from_keypoints,
    stream_of,
)
from analytics.scan_detector import detect_scans
from analytics.vision import wrap_angle
from sim.config import SimParams
from sim.engine import Simulation
from sim.keypoints import keypoint_stream

# Round-trip tolerances, stated: with the sim's sensor noise (2 degrees on head yaw), the yaw
# recovered from the keypoints has an RMS error within 15% of 2 degrees and never exceeds 5 sigma.
SENSOR = np.rad2deg(SimParams().sensor_noise)
RMS_TOLERANCE = 0.15
MAX_SIGMAS = 5.0


@pytest.fixture(scope="module")
def run():
    return Simulation.from_scenario("blind_side_run", 3).run()


def _rms_deg(err: np.ndarray) -> float:
    return float(np.rad2deg(np.sqrt(np.mean(np.square(err)))))


def test_the_schema_is_a_named_subset_of_the_coco_keypoints():
    coco = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder",
            "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip",
            "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]  # fmt: skip
    assert set(KEYPOINTS) <= set(coco)
    assert KEYPOINTS == (
        "nose", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_hip", "right_hip",
    )  # fmt: skip


def test_without_noise_the_round_trip_is_exact(run):
    stream = keypoint_stream(run, sigma=0.0)
    assert stream.xyz.shape == (len(run.owner), len(run.players), len(KEYPOINTS), 3)
    pose = pose_from_keypoints(stream)
    assert np.abs(wrap_angle(pose.head_yaw - run.head_yaw)).max() < 1e-9
    assert np.abs(wrap_angle(pose.torso_yaw - run.body_yaw)).max() < 1e-9
    assert np.abs(pose.pos - run.pos).max() < 1e-9


def test_with_the_sims_noise_the_head_yaw_comes_back_within_the_stated_tolerance(run):
    stream = keypoint_stream(run)  # default: keypoint noise matched to the sim's sensor noise
    assert stream.sigma == pytest.approx(keypoint_sigma(SimParams().sensor_noise))
    pose = pose_from_keypoints(stream)
    head = wrap_angle(pose.head_yaw - run.head_yaw)
    torso = wrap_angle(pose.torso_yaw - run.body_yaw)
    assert abs(_rms_deg(head) - SENSOR) <= RMS_TOLERANCE * SENSOR
    assert np.rad2deg(np.abs(head).max()) <= MAX_SIGMAS * SENSOR
    assert _rms_deg(torso) < SENSOR  # shoulders and hips are wider apart than the ears
    assert abs(float(np.rad2deg(head.mean()))) < 0.2  # unbiased
    assert np.sqrt(np.mean(np.sum((pose.pos - run.pos) ** 2, axis=-1))) < 0.01  # m


def test_the_stream_is_deterministic_keyed_and_leaves_the_run_alone(run):
    before = run.to_bytes()
    a = keypoint_stream(run)
    b = keypoint_stream(run)
    assert np.array_equal(a.xyz, b.xyz)
    assert run.to_bytes() == before  # generating keypoints changes nothing the sim exports
    other = Simulation.from_scenario("blind_side_run", 4).run()
    assert not np.allclose(
        keypoint_stream(other).xyz[0] - keypoint_stream(other, sigma=0.0).xyz[0],
        a.xyz[0] - keypoint_stream(run, sigma=0.0).xyz[0],
    )  # another match seed, other noise


def test_keypoint_derived_yaw_feeds_the_scan_detector_unchanged(run):
    pose = pose_from_keypoints(keypoint_stream(run))
    j = run.index("H8")
    key = run.key_scan()
    scans = detect_scans(pose.head_yaw[:, j], pose.pos[:, j], run.ball_pos[:, :2], run.dt)
    assert any(abs(s.start - key.frame) <= 3 for s in scans)


def test_untracked_keypoints_hold_the_last_estimate(run):
    stream = keypoint_stream(run, sigma=0.0)
    xyz = stream.xyz.copy()
    ear = KEYPOINTS.index("left_ear")
    xyz[30:35, :, ear] = np.nan  # an ear occluded for five frames: no head estimate there
    hips = [KEYPOINTS.index("left_hip"), KEYPOINTS.index("right_hip")]
    xyz[40, :, hips] = np.nan  # hips lost for a frame: torso from the shoulders alone
    pose = pose_from_keypoints(stream.with_xyz(xyz))
    assert np.allclose(pose.head_yaw[30:35], run.head_yaw[29])
    assert np.abs(wrap_angle(pose.head_yaw[35] - run.head_yaw[35])).max() < 1e-9
    assert np.abs(wrap_angle(pose.torso_yaw[40] - run.body_yaw[40])).max() < 1e-9
    assert np.abs(pose.pos[40] - run.pos[40]).max() < 1e-9  # shoulder midpoint stands in


def test_frames_round_trip_through_json(run):
    stream = keypoint_stream(run)
    stream.xyz[3, 0, KEYPOINTS.index("nose")] = np.nan  # an untracked point travels as null
    frames = frames_of(stream)
    assert len(frames) == len(run.owner)
    wire = json.dumps([f.model_dump(mode="json") for f in frames])
    back = stream_of([KeypointFrame.model_validate(f) for f in json.loads(wire)], stream.dt)
    assert back.players == stream.players
    assert np.array_equal(np.isnan(back.xyz), np.isnan(stream.xyz))
    assert np.allclose(back.xyz, stream.xyz, equal_nan=True)


def test_the_adapter_uses_no_sim_state():
    tree = ast.parse(inspect.getsource(adapter))
    imported = [
        n.module if isinstance(n, ast.ImportFrom) else a.name
        for n in ast.walk(tree)
        if isinstance(n, ast.Import | ast.ImportFrom)
        for a in (n.names if isinstance(n, ast.Import) else [n])
    ]
    assert not [m for m in imported if m and m.split(".")[0] == "sim"]
