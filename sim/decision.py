"""Decision model (SPEC 3.5). The ball carrier evaluates options on his belief, never on truth.

Value of an option = expected threat after the action:
    P(success | belief) * xT(target) - (1 - P(success | belief)) * xT_opp(where it is lost)
(the current xT is common to every option and drops out of the softmax).
P(completion) of a pass = P(no opponent intercepts along the ball path) * pitch control of the
receiver's team at the target. Older beliefs are less certain: each player's timing uncertainty
grows with the age of his last sighting.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from analytics.pitch_control import control_from_times, logistic
from analytics.tti import REACTION_S, V_MAX, time_to_intercept
from analytics.xt import GOAL_X, xt_for
from sim.ball import BallParams, flight_time, launch_speed, path_distances
from sim.config import HALF_LENGTH, HALF_WIDTH


@dataclass(frozen=True)
class DecisionParams:
    reaction: float = REACTION_S
    v_max: float = V_MAX
    sigma: float = 0.45  # s, timing uncertainty of a fresh sighting
    uncertainty0: float = 0.3  # m
    uncertainty_growth: float = 1.0  # m per second of belief age
    arrival_speed_per_m: float = 0.35  # longer passes arrive faster
    arrival_speed_range: tuple[float, float] = (6.0, 12.0)
    max_pass_speed: float = 30.0
    pass_range: tuple[float, float] = (4.0, 50.0)
    path_step_s: float = 0.08
    path_fraction: float = 0.9  # the end of the path is covered by pitch control at the target
    lead_times_s: tuple[float, ...] = (0.0, 0.5, 1.0, 1.5, 2.0)  # targets along a believed run
    reach_slack_s: float = 0.5  # the receiver may arrive this long after the ball
    carry_distance: float = 5.0
    carry_time: float = 1.0
    shot_range: float = 30.0
    temperature: float = 0.01


@dataclass
class DecisionContext:
    """What the carrier believes. pos/vel/age_s are beliefs, except the carrier's own entries."""

    carrier: int
    team: np.ndarray  # (N,)
    pos: np.ndarray  # (N, 2)
    vel: np.ndarray  # (N, 2)
    age_s: np.ndarray  # (N,)
    ids: list[str] | None = None
    attack_sign: int = 1
    ball: np.ndarray | None = None  # ball position; defaults to the carrier's
    temperature: float | None = None
    params: DecisionParams = field(default_factory=DecisionParams)
    ball_params: BallParams = field(default_factory=BallParams)


@dataclass(frozen=True)
class OptionEval:
    action: str  # "pass:<id>", "carry", "shot"
    kind: str
    target_player: str | None
    target: tuple[float, float]
    p_success: float
    value: float
    prob: float = 0.0

    @property
    def p_complete(self) -> float:
        return self.p_success


def _clip_to_pitch(p: np.ndarray) -> np.ndarray:
    return np.clip(
        p, [-HALF_LENGTH + 0.5, -HALF_WIDTH + 0.5], [HALF_LENGTH - 0.5, HALF_WIDTH - 0.5]
    )


def _sigma(ctx: DecisionContext, players: np.ndarray) -> np.ndarray:
    p = ctx.params
    return p.sigma + (p.uncertainty0 + p.uncertainty_growth * ctx.age_s[players]) / p.v_max


def pass_speed(
    distance: float, p: DecisionParams = DecisionParams(), bp: BallParams = BallParams()
) -> float:
    """Launch speed of a ground pass over `distance`; longer passes are played to arrive faster."""
    lo_v, hi_v = p.arrival_speed_range
    arrival = min(max(p.arrival_speed_per_m * distance, lo_v), hi_v)
    return min(launch_speed(distance, arrival, bp), p.max_pass_speed)


def _pass_success(
    ctx: DecisionContext,
    j: int,
    ball: np.ndarray,
    target: np.ndarray,
    opp: np.ndarray,
    mates: np.ndarray,
) -> float | None:
    """P(pass to `target` reaches teammate j) on the carrier's belief; None if not playable."""
    p, bp = ctx.params, ctx.ball_params
    dist = float(np.linalg.norm(target - ball))
    if not p.pass_range[0] <= dist <= p.pass_range[1]:
        return None
    v0 = pass_speed(dist, p, bp)
    t_flight = flight_time(v0, dist, bp)
    if not math.isfinite(t_flight):
        return None
    direction = (target - ball) / dist
    times = np.arange(p.path_step_s, p.path_fraction * t_flight, p.path_step_s)
    p_clear = 1.0
    if len(times):
        path = ball + path_distances(v0, times, bp)[:, None] * direction
        tti = time_to_intercept(ctx.pos[opp], ctx.vel[opp], path, p.reaction, p.v_max)
        sig = _sigma(ctx, opp)[:, None]
        p_int = logistic(np.pi / (np.sqrt(3.0) * sig) * (times[None, :] - tti)).max(axis=1)
        p_clear = float(np.prod(1.0 - p_int))
    t_att = time_to_intercept(ctx.pos[mates], ctx.vel[mates], target[None], p.reaction, p.v_max)
    t_def = time_to_intercept(ctx.pos[opp], ctx.vel[opp], target[None], p.reaction, p.v_max)
    sigma_j = float(_sigma(ctx, np.array([j]))[0])
    control = float(control_from_times(t_att.min(), t_def.min(), sigma_j))
    # The receiver must get there before the ball has rolled on too far.
    t_receiver = float(t_att[list(mates).index(j), 0])
    reach = float(
        logistic(np.pi / (np.sqrt(3.0) * sigma_j) * (t_flight + p.reach_slack_s - t_receiver))
    )
    return p_clear * control * reach


def _pass_option(
    ctx: DecisionContext, j: int, ball: np.ndarray, opp: np.ndarray, mates: np.ndarray, xt, xt_opp
) -> tuple[np.ndarray, float, float] | None:
    """Best (target, P, value) over a few lead times along teammate j's believed run."""
    best = None
    for lead in ctx.params.lead_times_s:
        target = _clip_to_pitch(ctx.pos[j] + ctx.vel[j] * lead)
        ps = _pass_success(ctx, j, ball, target, opp, mates)
        if ps is None:
            continue
        value = ps * xt(target) - (1.0 - ps) * xt_opp(target)
        if best is None or value > best[2]:
            best = (target, ps, value)
        if not np.any(ctx.vel[j]):
            break  # a standing receiver has one target
    return best


def evaluate_options(ctx: DecisionContext) -> list[OptionEval]:
    """Every option with its success probability, value and softmax probability."""
    p = ctx.params
    n = len(ctx.team)
    ids = ctx.ids or [str(i) for i in range(n)]
    c = ctx.carrier
    ball = ctx.pos[c] if ctx.ball is None else np.asarray(ctx.ball, dtype=float)
    own = ctx.team[c]
    opp = np.flatnonzero(ctx.team != own)
    mates = np.flatnonzero((ctx.team == own) & (np.arange(n) != c))
    sign = ctx.attack_sign

    def xt(point):
        return float(xt_for(point, sign))

    def xt_opp(point):
        return float(xt_for(point, -sign))

    options: list[OptionEval] = []
    for j in mates:
        result = _pass_option(ctx, j, ball, opp, mates, xt, xt_opp)
        if result is None:
            continue
        target, ps, value = result
        options.append(
            OptionEval(
                f"pass:{ids[j]}", "pass", ids[j], (float(target[0]), float(target[1])), ps, value
            )
        )

    carry_target = _clip_to_pitch(ball + np.array([sign * p.carry_distance, 0.0]))
    tti = time_to_intercept(ctx.pos[opp], ctx.vel[opp], carry_target[None], p.reaction, p.v_max)
    sig = _sigma(ctx, opp)
    p_lose = logistic(np.pi / (np.sqrt(3.0) * sig) * (p.carry_time - tti[:, 0]))
    p_keep = float(np.prod(1.0 - p_lose))
    options.append(
        OptionEval(
            "carry",
            "carry",
            None,
            (float(carry_target[0]), float(carry_target[1])),
            p_keep,
            p_keep * xt(carry_target) - (1.0 - p_keep) * xt_opp(ball),
        )
    )

    goal = np.array([sign * GOAL_X, 0.0])
    d_goal = float(np.linalg.norm(goal - ball))
    if d_goal <= p.shot_range:
        xg = float(min(0.6, 0.35 * math.exp(-(d_goal - 6.0) / 7.0)))
        options.append(OptionEval("shot", "shot", None, (float(goal[0]), 0.0), xg, xg))

    temperature = ctx.temperature if ctx.temperature is not None else p.temperature
    values = np.array([o.value for o in options])
    z = (values - values.max()) / temperature
    probs = np.exp(z) / np.exp(z).sum()
    return [
        OptionEval(o.action, o.kind, o.target_player, o.target, o.p_success, o.value, float(q))
        for o, q in zip(options, probs, strict=True)
    ]


def gumbel(u: float) -> float:
    u = min(max(u, 1e-12), 1.0 - 1e-12)
    return -math.log(-math.log(u))


def choose(options: list[OptionEval], noise: dict[str, float], temperature: float) -> OptionEval:
    """Gumbel-max sampling: argmax(value / T + g_option), which is exactly softmax(value / T).

    Each option has its own keyed noise, so in a counterfactual an option whose value did not
    change keeps the same noise (a Gumbel-max structural causal model, Oberst & Sontag 2019).
    """
    return max(options, key=lambda o: o.value / temperature + noise[o.action])
