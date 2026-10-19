"""Pressing intensity (SPEC 4.3), after Bekkers (2025), *Pressing Intensity*, arXiv:2501.04712.

Reimplemented from the paper. For every defender d and every attacker a (and the ball):
    p[d, a] = P(d reaches a within T) = logistic(pi / (sqrt(3) * sigma) * (T - TTI[d, a])),
    TTI[d, a] = time_to_intercept(d -> r_a + v_a * 1 s) + |v_d| * beta / pi.
- Time to intercept from `analytics.tti` (keep the current velocity for the reaction time, then run
  at v_max), toward where the target will be one second ahead along its velocity (the paper's
  d_j = r_j + v_j).
- Heading penalty |v_d| * beta / pi (the paper's tau_beta), with beta the angle between the
  defender's velocity and the direction from him to that point: a defender running away from the
  target is slower to press it than one running at it.
- Active pressing (the paper's optional filter, off by default): defenders slower than
  `active_speed` exert no pressure.
As in the paper, the ball carrier's column takes the larger of the pressure on his body and on the
ball; a carried ball moves with its carrier unless its own velocity is given.

Aggregate pressure on a player, as in the paper: the probability that at least one defender gets
there in time, 1 - prod_d (1 - p[d, a]), treating defenders as independent. It is 0 with nobody
near and rises with every extra presser.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from analytics.pitch_control import logistic
from analytics.tti import REACTION_S, V_MAX, time_to_intercept

TIME_THRESHOLD_S = 1.5  # T: reaching the target within this time counts as pressing it
SIGMA_S = 0.45  # spread of the logistic, as in pitch control
TARGET_LEAD_S = 1.0  # the target is pressed where it will be this far ahead (d_j = r_j + v_j)
# Keeps the heading angle finite for a standing defender. The paper adds epsilon to the
# denominator; a floor does the same without a small penalty on a defender running straight at
# the target.
EPS = 1e-5


def intercept_probability(
    tti: np.ndarray, threshold: float = TIME_THRESHOLD_S, sigma: float = SIGMA_S
) -> np.ndarray:
    """P(TTI < threshold) for a time to intercept with logistic uncertainty."""
    return logistic(np.pi / (np.sqrt(3.0) * sigma) * (threshold - np.asarray(tti, dtype=float)))


def pressing_intensity(
    def_pos: np.ndarray,
    def_vel: np.ndarray,
    targets: np.ndarray,
    threshold: float = TIME_THRESHOLD_S,
    sigma: float = SIGMA_S,
    reaction: float = REACTION_S,
    v_max: float = V_MAX,
    *,
    target_vel: np.ndarray | None = None,
    target_lead_s: float = TARGET_LEAD_S,
    heading_penalty: bool = True,
    active_speed: float = 0.0,
) -> np.ndarray:
    """(D, M) probability that each of D defenders reaches each of M targets within T.

    `target_vel` ((M, 2)) moves each target `target_lead_s` ahead; without it the targets stand
    still. `active_speed` > 0 zeroes the rows of defenders slower than it.
    """
    def_pos = np.asarray(def_pos, dtype=float).reshape(-1, 2)
    def_vel = np.asarray(def_vel, dtype=float).reshape(-1, 2)
    targets = np.asarray(targets, dtype=float).reshape(-1, 2)
    if target_vel is not None:
        targets = targets + np.asarray(target_vel, dtype=float).reshape(-1, 2) * target_lead_s
    tti = time_to_intercept(def_pos, def_vel, targets, reaction, v_max)
    speed = np.linalg.norm(def_vel, axis=-1)
    if heading_penalty:
        to_target = targets[None, :, :] - def_pos[:, None, :]
        norms = speed[:, None] * np.linalg.norm(to_target, axis=-1)
        cos = np.einsum("dk,dmk->dm", def_vel, to_target) / np.maximum(norms, EPS)
        tti = tti + speed[:, None] * np.arccos(np.clip(cos, -1.0, 1.0)) / np.pi
    p = intercept_probability(tti, threshold, sigma)
    if active_speed > 0.0:
        p[speed < active_speed] = 0.0
    return p


def aggregate(p: np.ndarray, axis: int = 0) -> np.ndarray:
    """P(at least one presser arrives in time), over `axis`."""
    return 1.0 - np.prod(1.0 - np.asarray(p, dtype=float), axis=axis)


@dataclass
class PressingFrame:
    defenders: np.ndarray  # (D,) player indices of the pressing team, ascending
    attackers: np.ndarray  # (A,) player indices of the pressed team, ascending
    matrix: np.ndarray  # (D, A) pressing intensity; the carrier's column includes the ball
    ball: np.ndarray  # (D,) pressing intensity on the ball
    carrier: int  # player index, -1 when the ball is free
    on_carrier: float  # aggregate pressure on the carrier; nan when the ball is free
    on_ball: float  # aggregate pressure on the ball

    def column(self, player: int) -> np.ndarray:
        """Pressure of every defender on one attacker (player index)."""
        return self.matrix[:, int(np.flatnonzero(self.attackers == player)[0])]


def frame_pressing(
    pos: np.ndarray,
    vel: np.ndarray,
    team: np.ndarray,
    ball: np.ndarray,
    carrier: int,
    pressed_team: int | None = None,
    *,
    ball_vel: np.ndarray | None = None,
    **kernel,
) -> PressingFrame:
    """Pressing intensity of one frame. The carrier's team is pressed; with a free ball, pass
    `pressed_team`. `kernel` forwards threshold, sigma, reaction, v_max, target_lead_s,
    heading_penalty and active_speed. Without `ball_vel`, a carried ball moves with its carrier
    and a free ball is pressed where it is."""
    pos, vel, team = np.asarray(pos, float), np.asarray(vel, float), np.asarray(team)
    ball = np.asarray(ball, dtype=float)[:2]
    if carrier >= 0:
        pressed_team = int(team[carrier])
    if pressed_team is None:
        raise ValueError("free ball: say which team is pressed")
    if ball_vel is not None:
        ball_vel = np.asarray(ball_vel, dtype=float)[:2]
    else:
        ball_vel = vel[carrier] if carrier >= 0 else np.zeros(2)
    attackers = np.flatnonzero(team == pressed_team)
    defenders = np.flatnonzero(team != pressed_team)
    targets = np.vstack([pos[attackers], ball[None]])
    target_vel = np.vstack([vel[attackers], ball_vel[None]])
    p = pressing_intensity(pos[defenders], vel[defenders], targets, target_vel=target_vel, **kernel)
    matrix, on_ball = p[:, :-1].copy(), p[:, -1]
    on_carrier = float("nan")
    if carrier >= 0:
        k = int(np.flatnonzero(attackers == carrier)[0])
        matrix[:, k] = np.maximum(matrix[:, k], on_ball)
        on_carrier = float(aggregate(matrix[:, k]))
    return PressingFrame(
        defenders, attackers, matrix, on_ball, int(carrier), on_carrier, float(aggregate(on_ball))
    )


def pressure_over_frames(
    pos: np.ndarray,
    vel: np.ndarray,
    team: np.ndarray,
    ball: np.ndarray,
    owner: np.ndarray,
    *,
    ball_vel: np.ndarray | None = None,
    **kernel,
) -> np.ndarray:
    """Aggregate pressure on the ball carrier per frame ((F, N, 2), (F, 2), (F,)) -> (F,);
    nan where the ball is free. This is the live overlay value. `ball_vel` is (F, 2) or None."""
    out = np.full(len(owner), np.nan)
    for f in np.flatnonzero(np.asarray(owner) >= 0):
        bv = None if ball_vel is None else ball_vel[f]
        out[f] = frame_pressing(
            pos[f], vel[f], team, ball[f], int(owner[f]), ball_vel=bv, **kernel
        ).on_carrier
    return out
