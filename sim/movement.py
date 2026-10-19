"""Player steering with speed and acceleration limits (SPEC 3.2).

Each frame the velocity moves toward a desired velocity (arrive behaviour) by at most a_max * dt
when speeding up and d_max * dt when slowing down. The new velocity lies on the segment between
the old and the desired velocity, so speed never exceeds the role maximum.
"""

from __future__ import annotations

import numpy as np


def steer(
    pos: np.ndarray,
    vel: np.ndarray,
    target: np.ndarray,
    speed_cap: np.ndarray,
    a_max: np.ndarray,
    d_max: np.ndarray,
    dt: float,
) -> tuple[np.ndarray, np.ndarray]:
    """One step for N players. speed_cap already includes the role v_max. Returns (pos, vel)."""
    to_target = target - pos
    dist = np.linalg.norm(to_target, axis=-1)
    arrive = np.sqrt(2.0 * d_max * dist)
    desired_speed = np.minimum(speed_cap, arrive)
    direction = np.divide(
        to_target, dist[:, None], out=np.zeros_like(to_target), where=dist[:, None] > 1e-9
    )
    desired = direction * desired_speed[:, None]
    dv = desired - vel
    dv_norm = np.linalg.norm(dv, axis=-1)
    speeding_up = desired_speed >= np.linalg.norm(vel, axis=-1)
    limit = np.where(speeding_up, a_max, d_max) * dt
    scale = np.minimum(1.0, np.divide(limit, dv_norm, out=np.ones_like(limit), where=dv_norm > 0))
    new_vel = vel + dv * scale[:, None]
    return pos + new_vel * dt, new_vel


def turn_toward(angle: np.ndarray, target: np.ndarray, max_step: float) -> np.ndarray:
    delta = (target - angle + np.pi) % (2.0 * np.pi) - np.pi
    return angle + np.clip(delta, -max_step, max_step)
