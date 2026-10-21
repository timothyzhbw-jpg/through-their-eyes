"""Limb-tracking ingest (SPEC 4.7): body keypoints back into the signals the analytics read.

Limb tracking reports body keypoints per player and frame. This adapter takes a generic, open
schema: a named subset of the COCO keypoints (nose, ears, shoulders, hips), in metres in pitch
coordinates (origin at the centre spot, x along the pitch, y across it, z up). It returns, per
player and frame, the position, the head yaw and the torso yaw, so the scan detector can run on
limb tracking as it runs on the sim's own tracking output. It is an offline adapter: nothing in
api/, agents/, explain/ or web/ calls it yet. It uses no sim state; `sim/keypoints.py` generates a
synthetic stream to feed it.

- Head yaw: the ear axis (left ear minus right ear) turned a quarter turn clockwise points where
  the face points; the nose's offset from the ear midpoint points the same way. The two are
  combined with inverse-variance weights for equal, independent noise on every keypoint (see
  `_fuse`). Torso yaw: the shoulder and hip axes, combined the same way.
- Position: the hip midpoint, else the shoulder midpoint.
- Untracked keypoints (NaN or infinite) and collapsed ones (an axis shorter than MIN_LENGTH) give
  no direction. A quantity with none tracked holds its last estimate, and leading frames take the
  first one (offline only).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

import numpy as np
from pydantic import BaseModel

KeypointName = Literal[
    "nose", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_hip", "right_hip"
]
KEYPOINTS: tuple[KeypointName, ...] = (
    "nose", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_hip", "right_hip",
)  # fmt: skip
K = {name: k for k, name in enumerate(KEYPOINTS)}

# Nominal head geometry (m), for the noise model only: the adapter measures the actual distances.
EAR_SPAN = 0.15  # ear to ear
NOSE_AHEAD = 0.10  # nose in front of the ear midpoint
MIN_LENGTH = 1e-6  # m: a shorter direction vector means collapsed keypoints, not a direction


def keypoint_sigma(yaw_sigma: float) -> float:
    """Keypoint noise (m, per axis) under which the fused head yaw has noise `yaw_sigma` (rad).

    The head-yaw variance is sigma^2 / (EAR_SPAN^2 / 2 + NOSE_AHEAD^2 / 1.5): the ear axis has
    noise variance 2 sigma^2 per axis, the nose's offset from the ear midpoint 1.5 sigma^2.
    """
    return float(yaw_sigma * np.sqrt(EAR_SPAN**2 / 2 + NOSE_AHEAD**2 / 1.5))


@dataclass(frozen=True)
class KeypointStream:
    dt: float  # s per frame
    players: list[str]
    xyz: np.ndarray  # (F, N, len(KEYPOINTS), 3) m, pitch coordinates, z up; NaN = untracked
    sigma: float = 0.0  # m, the noise it was generated with (0 when unknown or noise-free)

    def with_xyz(self, xyz: np.ndarray) -> KeypointStream:
        return replace(self, xyz=xyz)


@dataclass(frozen=True)
class Pose:
    pos: np.ndarray  # (F, N, 2) m
    head_yaw: np.ndarray  # (F, N) rad, counter-clockwise from +x
    torso_yaw: np.ndarray  # (F, N) rad


def _xy(xyz: np.ndarray, name: KeypointName) -> np.ndarray:
    return xyz[..., K[name], :2]


def _facing(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """A left-to-right axis turned a quarter turn clockwise: the way the body part faces."""
    a = left - right
    return np.stack([a[..., 1], -a[..., 0]], axis=-1)


def _fuse(vectors: list[tuple[np.ndarray, float]]) -> np.ndarray:
    """Direction estimates (vector, noise variance per axis in units of the keypoint variance)
    combined so that each angle is weighted by length^2 / variance (inverse variance, to first
    order): vector v of length L counts as v * L / variance. A vector shorter than MIN_LENGTH has
    no direction and counts as untracked, like a non-finite one; NaN where none is tracked."""
    total = np.zeros(vectors[0][0].shape)
    tracked = np.zeros(vectors[0][0].shape[:-1], dtype=bool)
    for v, var in vectors:
        ok = np.all(np.isfinite(v), axis=-1)
        length = np.linalg.norm(np.where(ok[..., None], v, 0.0), axis=-1)
        ok &= length >= MIN_LENGTH
        total += np.where(ok[..., None], v * length[..., None] / var, 0.0)
        tracked |= ok
    yaw = np.arctan2(total[..., 1], total[..., 0])
    return np.where(tracked, yaw, np.nan)


def _hold(x: np.ndarray) -> np.ndarray:
    """Fill NaN along time (axis 0) with the last estimate. Leading NaN take the first later
    estimate (a backward fill), so this suits offline, whole-clip ingest; a live stream would only
    hold forward."""
    out = x.copy()
    for f in range(1, len(out)):
        missing = np.isnan(out[f])
        out[f][missing] = out[f - 1][missing]
    for f in range(len(out) - 2, -1, -1):
        missing = np.isnan(out[f])
        out[f][missing] = out[f + 1][missing]
    return out


def pose_from_keypoints(stream: KeypointStream) -> Pose:
    xyz = np.where(np.isfinite(stream.xyz), stream.xyz, np.nan)  # an infinite point is untracked
    ear_mid = (_xy(xyz, "left_ear") + _xy(xyz, "right_ear")) / 2
    head = _fuse([
        (_facing(_xy(xyz, "left_ear"), _xy(xyz, "right_ear")), 2.0),
        (_xy(xyz, "nose") - ear_mid, 1.5),
    ])  # fmt: skip
    torso = _fuse([
        (_facing(_xy(xyz, "left_shoulder"), _xy(xyz, "right_shoulder")), 2.0),
        (_facing(_xy(xyz, "left_hip"), _xy(xyz, "right_hip")), 2.0),
    ])  # fmt: skip
    hips = (_xy(xyz, "left_hip") + _xy(xyz, "right_hip")) / 2
    shoulders = (_xy(xyz, "left_shoulder") + _xy(xyz, "right_shoulder")) / 2
    pos = np.where(np.isfinite(hips).all(axis=-1, keepdims=True), hips, shoulders)
    return Pose(pos=_hold(pos), head_yaw=_hold(head), torso_yaw=_hold(torso))


# ---------- the wire format: one message per frame ----------

Point = tuple[float, float, float]


class PlayerKeypoints(BaseModel):
    player: str
    keypoints: dict[KeypointName, Point | None]  # m, pitch coordinates; None = untracked


class KeypointFrame(BaseModel):
    frame: int
    t: float  # s
    players: list[PlayerKeypoints]


def frames_of(stream: KeypointStream) -> list[KeypointFrame]:
    def point(p: np.ndarray) -> Point | None:
        return None if np.isnan(p).any() else (float(p[0]), float(p[1]), float(p[2]))

    def player(f: int, j: int) -> PlayerKeypoints:
        points = {name: point(stream.xyz[f, j, k]) for k, name in enumerate(KEYPOINTS)}
        return PlayerKeypoints(player=stream.players[j], keypoints=points)

    return [
        KeypointFrame(
            frame=f,
            t=round(f * stream.dt, 6),
            players=[player(f, j) for j in range(len(stream.players))],
        )
        for f in range(len(stream.xyz))
    ]


def stream_of(frames: list[KeypointFrame], dt: float) -> KeypointStream:
    """Frames in order, every frame with the same players; a missing keypoint is untracked."""
    players = [p.player for p in frames[0].players]
    xyz = np.full((len(frames), len(players), len(KEYPOINTS), 3), np.nan)
    for f, frame in enumerate(frames):
        if [p.player for p in frame.players] != players:
            raise ValueError(f"frame {frame.frame}: players differ from the first frame")
        for j, p in enumerate(frame.players):
            for name, point in p.keypoints.items():
                if point is not None:
                    xyz[f, j, K[name]] = point
    return KeypointStream(dt=dt, players=players, xyz=xyz)
