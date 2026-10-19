"""Vision map (SPEC 3.4, 4.4), after Bekkers (2026), *Wide Open Gazes*.

V(x) = FOV(x; head_yaw, speed) * (1 - Occlusion(x)).
- FOV: a 120 degree binocular cone around the head direction with a Gaussian fall-off outside it,
  narrowed by running speed, times a Gaussian decay with distance.
- Occlusion: every player closer than the target blocks a soft angular sector the width of a body.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class VisionParams:
    half_cone: float = np.deg2rad(60.0)
    edge_sigma: float = np.deg2rad(15.0)
    narrowing_per_mps: float = np.deg2rad(2.5)
    min_half_cone: float = np.deg2rad(30.0)
    distance_sigma: float = 50.0  # m
    body_radius: float = 0.3  # m, half-width of an occluding body
    occlusion_max: float = 0.9
    depth_margin: float = 0.5  # m, an occluder must be this much closer than the target
    depth_softness: float = 0.2  # m


def wrap_angle(a: np.ndarray) -> np.ndarray:
    """Wrap angles to [-pi, pi)."""
    return (np.asarray(a) + np.pi) % (2.0 * np.pi) - np.pi


def field_of_view(
    observer: np.ndarray,
    head_yaw: float,
    speed: float,
    targets: np.ndarray,
    params: VisionParams = VisionParams(),
) -> np.ndarray:
    """FOV term only, (M,)."""
    rel = np.asarray(targets, dtype=float) - observer
    dist = np.hypot(rel[:, 0], rel[:, 1])
    offset = np.abs(wrap_angle(np.arctan2(rel[:, 1], rel[:, 0]) - head_yaw))
    half = max(params.min_half_cone, params.half_cone - params.narrowing_per_mps * speed)
    angular = np.where(
        offset <= half, 1.0, np.exp(-0.5 * ((offset - half) / params.edge_sigma) ** 2)
    )
    return angular * np.exp(-0.5 * (dist / params.distance_sigma) ** 2)


def transmission(
    observer: np.ndarray,
    targets: np.ndarray,
    occluders: np.ndarray,
    params: VisionParams = VisionParams(),
) -> np.ndarray:
    """1 - Occlusion for each target, (M,)."""
    targets = np.asarray(targets, dtype=float)
    occluders = np.asarray(occluders, dtype=float).reshape(-1, 2)
    if occluders.shape[0] == 0:
        return np.ones(targets.shape[0])
    rel = targets - observer
    dist = np.hypot(rel[:, 0], rel[:, 1])
    ang = np.arctan2(rel[:, 1], rel[:, 0])
    orel = occluders - observer
    odist = np.maximum(np.hypot(orel[:, 0], orel[:, 1]), 1e-6)
    oang = np.arctan2(orel[:, 1], orel[:, 0])
    width = np.arctan2(params.body_radius, odist)  # angular half-width of each body
    dtheta = wrap_angle(ang[:, None] - oang[None, :])
    in_front = 0.5 * (
        1.0
        + np.tanh((dist[:, None] - odist[None, :] - params.depth_margin) / params.depth_softness)
    )
    blocked = params.occlusion_max * np.exp(-0.5 * (dtheta / width[None, :]) ** 2) * in_front
    return np.prod(1.0 - blocked, axis=1)


def player_visibility(
    pos: np.ndarray, head_yaw: np.ndarray, speed: np.ndarray, params: VisionParams = VisionParams()
) -> np.ndarray:
    """(N, N) visibility of player j for observer i, occluded by every other player.

    Same model as `visibility`, vectorised over observers, with the observer and the target
    excluded from the occluders. V[i, i] = 1.
    """
    pos = np.asarray(pos, dtype=float)
    n = pos.shape[0]
    idx = np.arange(n)
    rel = pos[None, :, :] - pos[:, None, :]  # [i, j] = pos_j - pos_i
    dist = np.hypot(rel[..., 0], rel[..., 1])
    ang = np.arctan2(rel[..., 1], rel[..., 0])
    offset = np.abs(wrap_angle(ang - np.asarray(head_yaw)[:, None]))
    half = np.maximum(
        params.min_half_cone, params.half_cone - params.narrowing_per_mps * np.asarray(speed)
    )[:, None]
    angular = np.where(
        offset <= half, 1.0, np.exp(-0.5 * ((offset - half) / params.edge_sigma) ** 2)
    )
    fov = angular * np.exp(-0.5 * (dist / params.distance_sigma) ** 2)
    width = np.arctan2(params.body_radius, np.maximum(dist, 1e-6))  # [i, k]
    dtheta = wrap_angle(ang[:, :, None] - ang[:, None, :])  # [i, j, k]
    in_front = 0.5 * (
        1.0
        + np.tanh(
            (dist[:, :, None] - dist[:, None, :] - params.depth_margin) / params.depth_softness
        )
    )
    blocked = params.occlusion_max * np.exp(-0.5 * (dtheta / width[:, None, :]) ** 2) * in_front
    blocked[idx, :, idx] = 0.0  # the observer does not occlude
    blocked[:, idx, idx] = 0.0  # a target does not occlude itself
    v = fov * np.prod(1.0 - blocked, axis=2)
    v[idx, idx] = 1.0
    return v


def visibility(
    observer: np.ndarray,
    head_yaw: float,
    speed: float,
    targets: np.ndarray,
    occluders: np.ndarray,
    params: VisionParams = VisionParams(),
) -> np.ndarray:
    """Probabilistic visibility of each target ((M, 2)) for one observer -> (M,) in [0, 1]."""
    observer = np.asarray(observer, dtype=float)
    return field_of_view(observer, head_yaw, speed, targets, params) * transmission(
        observer, targets, occluders, params
    )
