"""Time to intercept (SPEC 4.1), after Spearman (2018) as simplified by Shaw.

A player keeps his current velocity for the reaction time, then runs straight to the target at
`v_max`. `v_max` is a deliberately conservative model parameter, not a real sprint speed.
"""

from __future__ import annotations

import numpy as np

REACTION_S = 0.7
V_MAX = 5.0


def time_to_intercept(
    pos: np.ndarray,
    vel: np.ndarray,
    targets: np.ndarray,
    reaction: float | np.ndarray = REACTION_S,
    v_max: float | np.ndarray = V_MAX,
) -> np.ndarray:
    """Seconds for each of N players (pos, vel: (N, 2)) to reach each of M targets ((M, 2)).

    `reaction` and `v_max` are scalars or per-player arrays of shape (N,). Returns (N, M).
    """
    pos = np.asarray(pos, dtype=float)
    vel = np.asarray(vel, dtype=float)
    targets = np.asarray(targets, dtype=float)
    reaction = np.asarray(reaction, dtype=float)
    v_max = np.asarray(v_max, dtype=float)
    r = reaction.reshape(-1, 1) if reaction.ndim else reaction
    vm = v_max.reshape(-1, 1) if v_max.ndim else v_max
    after = pos + vel * r
    dist = np.linalg.norm(targets[None, :, :] - after[:, None, :], axis=-1)
    return r + dist / vm
