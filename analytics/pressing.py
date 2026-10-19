"""Pressing intensity (SPEC 4.3), after Bekkers (2025), *Pressing Intensity* (arXiv:2501.04712).

For every defender i and attacker j, the probability that i reaches j within a time window T:

    p_ij = 1 / (1 + exp(-pi / (sqrt(3) * sigma) * (T - T_ij)))

T_ij is the time to intercept of `analytics.tti` (keep the current velocity for the reaction
time, then run straight at v_max) toward where the target will be one second ahead
(d_j = r_j + v_j, as in the paper), plus the paper's heading penalty |v_i| * beta / pi for a
defender whose velocity points away from the target (beta: angle between his velocity and the
direction to the target). For the ball carrier, a defender's pressure is the larger of his
pressure on the carrier and on the ball. A defender slower than `active_speed` can be dropped
(the paper's "active pressing" filter; off by default).

Aggregate pressure on attacker j: 1 - prod_i (1 - p_ij), the chance that at least one defender
gets there in time, assuming independence as the paper does.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from analytics.pitch_control import logistic
from analytics.tti import REACTION_S, V_MAX, time_to_intercept

TIME_THRESHOLD_S = 1.5
SIGMA_S = 0.45


@dataclass(frozen=True)
class PressingParams:
    reaction: float = REACTION_S
    v_max: float = V_MAX
    time_threshold: float = TIME_THRESHOLD_S  # T: reach the target within this many seconds
    sigma: float = SIGMA_S
    target_lead_s: float = 1.0  # the target is extrapolated this far along its velocity
    heading_penalty: bool = True
    active_speed: float = 0.0  # m/s; defenders slower than this exert no pressure (0 = off)
    eps: float = 1e-5


DEFAULT_PARAMS = PressingParams()


def pressing_tti(
    def_pos: np.ndarray,
    def_vel: np.ndarray,
    tgt_pos: np.ndarray,
    tgt_vel: np.ndarray,
    params: PressingParams = DEFAULT_PARAMS,
) -> np.ndarray:
    """Seconds for each defender ((D, 2)) to reach each moving target ((M, 2)) -> (D, M)."""
    def_pos = np.asarray(def_pos, dtype=float).reshape(-1, 2)
    def_vel = np.asarray(def_vel, dtype=float).reshape(-1, 2)
    targets = np.asarray(tgt_pos, dtype=float).reshape(-1, 2)
    targets = targets + np.asarray(tgt_vel, dtype=float).reshape(-1, 2) * params.target_lead_s
    t = time_to_intercept(def_pos, def_vel, targets, params.reaction, params.v_max)
    if params.heading_penalty:
        to_target = targets[None, :, :] - def_pos[:, None, :]
        speed = np.linalg.norm(def_vel, axis=-1)[:, None]
        cos = np.einsum("dk,dmk->dm", def_vel, to_target) / (
            speed * np.linalg.norm(to_target, axis=-1) + params.eps
        )
        beta = np.arccos(np.clip(cos, -1.0, 1.0))
        t = t + speed * beta / np.pi
    return t


def intercept_probability(tti: np.ndarray, params: PressingParams = DEFAULT_PARAMS) -> np.ndarray:
    return logistic(np.pi / (np.sqrt(3.0) * params.sigma) * (params.time_threshold - tti))


def pressing_matrix(
    def_pos: np.ndarray,
    def_vel: np.ndarray,
    att_pos: np.ndarray,
    att_vel: np.ndarray,
    *,
    ball_pos: np.ndarray | None = None,
    ball_vel: np.ndarray | None = None,
    carrier: int | None = None,
    params: PressingParams = DEFAULT_PARAMS,
) -> np.ndarray:
    """(D, A) probability that defender i reaches attacker j within the time window.

    With `carrier` (an attacker index) and the ball, the carrier's column is the larger of the
    pressure on him and on the ball.
    """
    p = intercept_probability(pressing_tti(def_pos, def_vel, att_pos, att_vel, params), params)
    if carrier is not None and ball_pos is not None:
        ball_vel = np.zeros(2) if ball_vel is None else ball_vel
        on_ball = intercept_probability(
            pressing_tti(def_pos, def_vel, ball_pos, ball_vel, params), params
        )[:, 0]
        p[:, carrier] = np.maximum(p[:, carrier], on_ball)
    if params.active_speed > 0.0:
        slow = np.linalg.norm(np.asarray(def_vel, dtype=float).reshape(-1, 2), axis=-1)
        p[slow < params.active_speed, :] = 0.0
    return p


def pressure_on(matrix: np.ndarray) -> np.ndarray:
    """Aggregate pressure on each attacker: 1 - prod over defenders of (1 - p) -> (A,)."""
    return 1.0 - np.prod(1.0 - np.asarray(matrix, dtype=float), axis=0)


@dataclass(frozen=True)
class FramePressing:
    defenders: np.ndarray  # (D,) player indices
    attackers: np.ndarray  # (A,) player indices
    matrix: np.ndarray  # (D, A)
    pressure: np.ndarray  # (A,) aggregate pressure on each attacker
    carrier: int | None  # player index of the ball carrier

    @property
    def on_carrier(self) -> float:
        """Aggregate pressure on the ball carrier; NaN when the ball is free."""
        if self.carrier is None:
            return float("nan")
        return float(self.pressure[np.flatnonzero(self.attackers == self.carrier)[0]])


def frame_pressing(
    pos: np.ndarray,
    vel: np.ndarray,
    team: np.ndarray,
    ball_pos: np.ndarray,
    ball_vel: np.ndarray,
    owner: int,
    attacking_team: int | None = None,
    params: PressingParams = DEFAULT_PARAMS,
) -> FramePressing:
    """Pressing of one frame. The attacking team is the owner's; pass it when the ball is free."""
    team = np.asarray(team)
    carrier = int(owner) if owner >= 0 else None
    if carrier is not None:
        attacking_team = int(team[carrier])
    elif attacking_team is None:
        raise ValueError("the ball is free: pass attacking_team")
    attackers = np.flatnonzero(team == attacking_team)
    defenders = np.flatnonzero(team != attacking_team)
    pos, vel = np.asarray(pos, dtype=float), np.asarray(vel, dtype=float)
    matrix = pressing_matrix(
        pos[defenders],
        vel[defenders],
        pos[attackers],
        vel[attackers],
        ball_pos=np.asarray(ball_pos, dtype=float)[:2],
        ball_vel=np.asarray(ball_vel, dtype=float)[:2],
        carrier=None if carrier is None else int(np.flatnonzero(attackers == carrier)[0]),
        params=params,
    )
    return FramePressing(defenders, attackers, matrix, pressure_on(matrix), carrier)
