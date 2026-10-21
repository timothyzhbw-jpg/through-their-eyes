"""Shots and keepers (SPEC 3.3 shot outcomes, 3.6 hero expansion pack, Module A).

Used only in scenarios with `Scenario.shots`; every other run is unchanged.

Save model (Bransen, Janssen & Davis 2025, arXiv:2505.24629, eq. 2 and Appendix C, fitted by
Brier score on real penalties with the keeper in the correct corner):
    P_save(d, r) = rho                             d <= r - mu
                 = rho * (1/2 - (d - r) / (2 mu))  r - mu < d < r + mu
                 = 0                               d >= r + mu
d is the lateral distance from the keeper (where he stood when he first saw the ball) to where
the ball crosses his line; low shots only, so height is ignored.

Reach for the time he has, T = t_cross - t_seen:
    r(T) = clip(r_late + v_dive * (T - t_pen), r_body, r_early)
r_late (a dive set off on the kick) and r_early come from the same fit; t_pen is the middle of
the 500-600 ms penalty flight time Bransen et al. cite (Dicks et al. 2010; Zheng et al. 2021).
The keeper's reaction is inside r_late, as a penalty keeper also reacts to the kick. v_dive has no
verified source: evals must hold across V_DIVE_SWEEP.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from sim.ball import BallParams, flight_time
from sim.config import HALF_LENGTH

GOAL_HALF_WIDTH = 3.66  # m (Laws of the Game: 7.32 m)
V_DIVE_SWEEP = (2.5, 4.0)  # m/s, the range every keeper eval must hold across


@dataclass(frozen=True)
class KeeperParams:
    r_late: float = 2.8  # m, Bransen et al. 2025
    r_early: float = 3.1  # m, Bransen et al. 2025
    mu: float = 0.7  # m, Bransen et al. 2025
    rho: float = 0.7  # Bransen et al. 2025
    t_pen: float = 0.55  # s, penalty flight time 500-600 ms (cited by Bransen et al.)
    v_dive: float = 3.0  # m of reach per extra second; no verified source, see V_DIVE_SWEEP
    r_body: float = 0.3  # m, the vision model's body radius: a ball at him is blocked
    depth: float = 1.5  # m off his line, bisector rule (convention, tunable)
    react_render_s: float = 0.2  # render only: when the dive starts after he sees the ball
    arm: float = 0.5  # m, his hands beyond his centre of mass (render only)
    dive_hold_s: float = 0.4  # s the dive's limits last after the ball reaches his line
    v_dive_max: float = 4.0  # m/s, tracking limit in a dive window (tunable, uncited)
    a_dive_max: float = 15.0  # m/s^2, tracking limit in a dive window (tunable, uncited)


@dataclass(frozen=True)
class ShotParams:
    speed: tuple[float, float] = (24.0, 30.0)  # m/s; inside 18-35 m/s (Kellis & Katis 2007)
    sigma_theta: float = math.radians(2.5)  # lateral aim error (tunable; shape: Hunter et al.)
    m_in: float = 0.5  # m inside the post


KEEPER = KeeperParams()
SHOT = ShotParams()


def reach(t: float, kp: KeeperParams | None = None) -> float:
    """How far (m) he can reach with `t` seconds from seeing the ball to its reaching his line."""
    kp = KEEPER if kp is None else kp
    if not math.isfinite(t):
        return kp.r_early
    return float(np.clip(kp.r_late + kp.v_dive * (t - kp.t_pen), kp.r_body, kp.r_early))


def p_save(d: float | np.ndarray, r: float, kp: KeeperParams | None = None) -> np.ndarray:
    kp = KEEPER if kp is None else kp
    d = np.asarray(d, dtype=float)
    band = kp.rho * (0.5 - (d - r) / (2.0 * kp.mu))
    return np.where(d <= r - kp.mu, kp.rho, np.where(d >= r + kp.mu, 0.0, band))


def _phi(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def p_on_target(y_aim: float, distance: float, sp: ShotParams | None = None) -> float:
    """P(the ball crosses the line between the posts), lateral aim error only."""
    sp = SHOT if sp is None else sp
    s = max(distance * math.tan(sp.sigma_theta), 1e-6)
    return float(_phi((GOAL_HALF_WIDTH - y_aim) / s) - _phi((-GOAL_HALF_WIDTH - y_aim) / s))


_GH_X, _GH_W = np.polynomial.hermite_e.hermegauss(9)  # probabilists' Gauss-Hermite


def expected_p_save(y_aim: float, y_keeper: float, spread: float, r: float,
                    kp: KeeperParams | None = None) -> float:  # fmt: skip
    """E[P_save] over the keeper's lateral position ~ N(y_keeper, spread^2)."""
    ys = y_keeper + spread * _GH_X
    return float(np.sum(_GH_W * p_save(np.abs(y_aim - ys), r, kp)) / np.sum(_GH_W))


def near_post_sign(shooter_y: float, from_y: float) -> float:
    """+1 or -1: the side of the goal's centreline the near post is on."""
    if abs(shooter_y) >= 1.0:
        return math.copysign(1.0, shooter_y)
    return math.copysign(1.0, from_y) if from_y else 1.0


def aim_y(placement: str, near_sign: float, sp: ShotParams | None = None) -> float:
    sp = SHOT if sp is None else sp
    inside = GOAL_HALF_WIDTH - sp.m_in
    return near_sign * inside if placement == "near" else -near_sign * inside


def crossing(
    ball: np.ndarray, target: np.ndarray, x_line: float, speed: float, bp: BallParams = BallParams()
) -> tuple[float, float]:
    """Where a ground shot from `ball` toward `target` crosses the line x = x_line (its y), and
    when (s, rolling physics of `sim.ball`; inf if it stops first, 0 if it starts past it)."""
    ball, target = np.asarray(ball, dtype=float), np.asarray(target, dtype=float)
    u = (target - ball) / max(float(np.linalg.norm(target - ball)), 1e-9)
    if abs(u[0]) < 1e-9:
        return float(ball[1]), math.inf
    s = (x_line - ball[0]) / u[0]
    if s <= 0.0:
        return float(ball[1]), 0.0
    return float(ball[1] + s * u[1]), float(flight_time(speed, s, bp))


def goal_x(attack_sign: int) -> float:
    return attack_sign * HALF_LENGTH


def bisector_point(ball: np.ndarray, attack_sign_of_shooter: int,
                   kp: KeeperParams | None = None) -> np.ndarray:  # fmt: skip
    """Where the keeper of the goal at attack_sign * x stands: on the bisector of the angle the
    ball makes with the two posts, kp.depth off his line (a convention, not a cited model)."""
    kp = KEEPER if kp is None else kp
    gx = goal_x(attack_sign_of_shooter)
    posts = np.array([[gx, GOAL_HALF_WIDTH], [gx, -GOAL_HALF_WIDTH]])
    u = posts - ball
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    bis = u.sum(axis=0)
    bis /= max(float(np.linalg.norm(bis)), 1e-9)
    line_x = gx - attack_sign_of_shooter * kp.depth
    if abs(bis[0]) < 1e-9:
        return np.array([line_x, 0.0])
    t = (line_x - ball[0]) / bis[0]
    return ball + t * bis
