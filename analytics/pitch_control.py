"""Pitch control (SPEC 4.2): closed-form approximation of Spearman (2018).

P_att(x) = 1 / (1 + exp(-pi / (sqrt(3) * sigma) * (T_def(x) - T_att(x)))),
where T_team(x) is the smallest time to intercept over that team's players.
"""

from __future__ import annotations

import numpy as np

from analytics.tti import REACTION_S, V_MAX, time_to_intercept

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
SIGMA_S = 0.45


def pitch_grid(cell: float = 1.0) -> np.ndarray:
    """Cell centres over the pitch, shape (ny * nx, 2); x varies fastest."""
    nx, ny = round(PITCH_LENGTH / cell), round(PITCH_WIDTH / cell)
    xs = -PITCH_LENGTH / 2 + cell * (np.arange(nx) + 0.5)
    ys = -PITCH_WIDTH / 2 + cell * (np.arange(ny) + 0.5)
    gx, gy = np.meshgrid(xs, ys)
    return np.stack([gx.ravel(), gy.ravel()], axis=-1)


def logistic(z: np.ndarray) -> np.ndarray:
    """Numerically stable logistic with logistic(z) + logistic(-z) == 1."""
    return 0.5 * (1.0 + np.tanh(0.5 * np.asarray(z, dtype=float)))


def control_from_times(t_att: np.ndarray, t_def: np.ndarray, sigma: float = SIGMA_S) -> np.ndarray:
    return logistic(np.pi / (np.sqrt(3.0) * sigma) * (t_def - t_att))


def pitch_control(
    points: np.ndarray,
    att_pos: np.ndarray,
    att_vel: np.ndarray,
    def_pos: np.ndarray,
    def_vel: np.ndarray,
    sigma: float = SIGMA_S,
    reaction: float = REACTION_S,
    v_max: float = V_MAX,
) -> np.ndarray:
    """Probability that the attacking team controls each point ((M, 2)) -> (M,)."""
    t_att = time_to_intercept(att_pos, att_vel, points, reaction, v_max).min(axis=0)
    t_def = time_to_intercept(def_pos, def_vel, points, reaction, v_max).min(axis=0)
    return control_from_times(t_att, t_def, sigma)
