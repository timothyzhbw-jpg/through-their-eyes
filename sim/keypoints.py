"""A synthetic limb-tracking stream (SPEC 4.7): body keypoints for every player and frame of a
finished run, in the open schema `analytics/keypoints.py` ingests.

Keypoints are placed from the run's truth: the position, the torso yaw (`body_yaw`) and the head
yaw (`head_yaw`), with a fixed, upright body (no lean); limbs other than shoulders and hips are
not in the schema. Noise is the sim's tracking noise carried into keypoint space: by default every
keypoint coordinate gets independent Gaussian noise whose size makes the head yaw recovered from
the keypoints as noisy as the sim's own tracked head yaw (`SimParams.sensor_noise`, 2 degrees),
about 4.7 mm. Draws are keyed by (match seed, "keypoint_noise", frame) like every sim draw (SPEC
3.7), so a stream is reproducible and independent of every other draw. Generating one changes
nothing in the run or in any export.
"""

from __future__ import annotations

import numpy as np

from analytics.keypoints import EAR_SPAN, KEYPOINTS, NOSE_AHEAD, K, KeypointStream, keypoint_sigma
from sim.config import SimParams
from sim.rng import KeyedRng
from sim.run import MatchRun

# Body geometry, m: half widths across the body and heights above the grass.
SHOULDER_HALF = 0.20
HIP_HALF = 0.15
HEIGHT = {
    "nose": 1.62,
    "left_ear": 1.64,
    "right_ear": 1.64,
    "left_shoulder": 1.42,
    "right_shoulder": 1.42,
    "left_hip": 0.95,
    "right_hip": 0.95,
}


def keypoint_stream(
    run: MatchRun, sigma: float | None = None, params: SimParams = SimParams()
) -> KeypointStream:
    """Keypoints of every player and frame of `run`. `sigma`: noise per axis (m); None matches the
    head yaw's noise to `params.sensor_noise`; 0 gives the exact geometry."""
    sigma = keypoint_sigma(params.sensor_noise) if sigma is None else float(sigma)
    frames, n = run.head_yaw.shape
    x, y = run.pos[..., 0], run.pos[..., 1]
    xyz = np.empty((frames, n, len(KEYPOINTS), 3))

    def put(name: str, px: np.ndarray, py: np.ndarray) -> None:
        xyz[:, :, K[name], 0] = px
        xyz[:, :, K[name], 1] = py
        xyz[:, :, K[name], 2] = HEIGHT[name]

    h, b = run.head_yaw, run.body_yaw
    lx, ly = -np.sin(h), np.cos(h)  # the head's left
    put("nose", x + NOSE_AHEAD * np.cos(h), y + NOSE_AHEAD * np.sin(h))
    put("left_ear", x + EAR_SPAN / 2 * lx, y + EAR_SPAN / 2 * ly)
    put("right_ear", x - EAR_SPAN / 2 * lx, y - EAR_SPAN / 2 * ly)
    for part, half in (("shoulder", SHOULDER_HALF), ("hip", HIP_HALF)):
        bx, by = -half * np.sin(b), half * np.cos(b)  # the torso's left
        put(f"left_{part}", x + bx, y + by)
        put(f"right_{part}", x - bx, y - by)
    if sigma > 0:
        rng = KeyedRng(run.seed)
        for f in range(frames):
            xyz[f] += sigma * rng.generator("keypoint_noise", f).standard_normal(xyz[f].shape)
    return KeypointStream(dt=run.dt, players=run.ids, xyz=xyz, sigma=sigma)
