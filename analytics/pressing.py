"""Pressing intensity (SPEC 4.3), after Bekkers (2025), *Pressing Intensity*, arXiv:2501.04712.

Reimplemented from the paper. For every defender d and every attacker a (and the ball):
    p[d, a] = P(d reaches a within T) = logistic(pi / (sqrt(3) * sigma) * (T - TTI[d, a])),
with TTI from `analytics.tti.time_to_intercept` (keep current velocity for the reaction time, then
run at v_max to the target's current position). As in the paper, the ball carrier's column takes
the larger of the pressure on his body and on the ball.

Aggregate pressure on the ball carrier (our choice, the paper leaves aggregation open): the
probability that at least one defender gets there in time, 1 - prod_d (1 - p[d, carrier]),
treating defenders as independent. It is 0 with nobody near and rises with every extra presser.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from analytics.pitch_control import logistic
from analytics.tti import REACTION_S, V_MAX, time_to_intercept

TIME_THRESHOLD_S = 1.5  # T: reaching the target within this time counts as pressing it
SIGMA_S = 0.45  # spread of the logistic, as in pitch control


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
) -> np.ndarray:
    """(D, M) probability that each of D defenders reaches each of M targets within T."""
    tti = time_to_intercept(def_pos, def_vel, targets, reaction, v_max)
    return intercept_probability(tti, threshold, sigma)


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
    **kernel,
) -> PressingFrame:
    """Pressing intensity of one frame. The carrier's team is pressed; with a free ball, pass
    `pressed_team`. `kernel` forwards threshold, sigma, reaction and v_max."""
    pos, vel, team = np.asarray(pos, float), np.asarray(vel, float), np.asarray(team)
    ball = np.asarray(ball, dtype=float)[:2]
    if carrier >= 0:
        pressed_team = int(team[carrier])
    if pressed_team is None:
        raise ValueError("free ball: say which team is pressed")
    attackers = np.flatnonzero(team == pressed_team)
    defenders = np.flatnonzero(team != pressed_team)
    targets = np.vstack([pos[attackers], ball[None]])
    p = pressing_intensity(pos[defenders], vel[defenders], targets, **kernel)
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
    **kernel,
) -> np.ndarray:
    """Aggregate pressure on the ball carrier per frame ((F, N, 2), (F, 2), (F,)) -> (F,);
    nan where the ball is free. This is the live overlay value."""
    out = np.full(len(owner), np.nan)
    for f in np.flatnonzero(np.asarray(owner) >= 0):
        out[f] = frame_pressing(pos[f], vel[f], team, ball[f], int(owner[f]), **kernel).on_carrier
    return out
