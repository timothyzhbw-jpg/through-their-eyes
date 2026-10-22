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
    bounds: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """One step for N players. speed_cap already includes the role v_max. Returns (pos, vel).

    With `bounds` (half extents of the pitch), a player brakes for the lines: along each axis his
    speed toward the line ahead is at most what d_max stops within the room left, so he ends at
    most on the line. Steering alone can carry him over: a target on a line does not stop the
    sideways drift of a player who turns along it.
    """
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
    if bounds is not None:
        new_vel = _brake_for_lines(pos, vel, new_vel, a_max, d_max, dt, bounds)
    return pos + new_vel * dt, new_vel


def _brake_for_lines(
    pos: np.ndarray,
    vel: np.ndarray,
    new_vel: np.ndarray,
    a_max: np.ndarray,
    d_max: np.ndarray,
    dt: float,
    bounds: np.ndarray,
) -> np.ndarray:
    """`new_vel` with the speed toward each line ahead cut to what d_max still stops in the room
    left. Slowing by b = d_max dt a frame, the n + 1 steps v, v - b, ..., v - n b cover
    (n + 1)(v - n b / 2) dt <= room, where n b <= v < (n + 1) b: n is the whole number of steps
    n (n + 1) b dt / 2 fits in. The cut shares the frame's limit with the rest of the step: braking
    takes what it needs (all of d_max dt on the envelope), and the rest keeps what is left of
    d_max dt, or of a_max dt when he ends up faster than he was."""
    ahead = np.sign(new_vel)
    room = np.maximum(bounds - ahead * pos, 0.0)
    b = d_max[:, None] * dt
    n = np.floor(0.5 * (np.sqrt(1.0 + 8.0 * room / (b * dt)) - 1.0))
    stoppable = room / ((n + 1.0) * dt) + 0.5 * n * b
    over = np.abs(new_vel) > stoppable
    if not over.any():
        return new_vel
    change = np.where(over, ahead * stoppable, new_vel) - vel
    braking = np.where(over, change, 0.0)
    rest = change - braking
    rest_norm = np.linalg.norm(rest, axis=-1)
    braked = (braking**2).sum(axis=-1)

    def within(limit: np.ndarray) -> np.ndarray:
        left = np.sqrt(np.maximum(limit**2 - braked, 0.0))
        keep = np.minimum(
            1.0, np.divide(left, rest_norm, out=np.ones_like(left), where=rest_norm > 0)
        )
        return vel + braking + rest * keep[:, None]

    out = within(d_max * dt)
    faster = np.linalg.norm(out, axis=-1) > np.linalg.norm(vel, axis=-1)
    return np.where(faster[:, None], within(a_max * dt), out) if faster.any() else out


def turn_toward(angle: np.ndarray, target: np.ndarray, max_step: float) -> np.ndarray:
    delta = (target - angle + np.pi) % (2.0 * np.pi) - np.pi
    return angle + np.clip(delta, -max_step, max_step)
