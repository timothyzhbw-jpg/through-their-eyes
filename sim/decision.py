"""Decision model (SPEC 3.5). The ball carrier evaluates options on his belief, never on truth.

Value of an option = expected threat after the action:
    P(success | belief) * xT(target) - (1 - P(success | belief)) * xT_opp(where it is lost)
(the current xT is common to every option and drops out of the softmax).
P(completion) of a pass = P(no opponent intercepts along the ball path) * pitch control of the
receiver's team at the target. Older beliefs are less certain: each player's timing uncertainty
grows with the age of his last sighting.

An opponent wins the ball in either of two ways, both from the time-to-intercept motion model
(SPEC 4.1: he keeps his velocity for the reaction time, then runs at v_max):
- he reacts and gets to a point of the ball's path before the ball does (time to intercept);
- before he reacts, the ball comes within the control radius of where his run takes him at that
  same moment (the run-in). A presser sprinting at the carrier, or an opponent standing on the
  passing lane, is in the ball's way without reacting to anything; the closed-form time to
  intercept only counts arrivals after the reaction time, so it misses him. The sim wins the ball
  by the same radius (`SimParams.control_radius`: control of a free ball, tackles).
"""

from __future__ import annotations

import dataclasses
import math
from dataclasses import dataclass, field

import numpy as np

from analytics.pitch_control import control_from_times, logistic
from analytics.tti import REACTION_S, V_MAX, time_to_intercept
from analytics.xt import GOAL_X, xt_for
from sim import shots
from sim.ball import BallParams, flight_time, launch_speed, path_distances
from sim.config import HALF_LENGTH, HALF_WIDTH, SimParams


@dataclass(frozen=True)
class DecisionParams:
    reaction: float = REACTION_S
    v_max: float = V_MAX
    sigma: float = 0.45  # s, timing uncertainty of a fresh sighting
    uncertainty0: float = 0.3  # m
    uncertainty_growth: float = 1.0  # m per second of belief age
    control_radius: float = SimParams.control_radius  # m, an opponent this close wins the ball
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
    # A defender's decision (scenarios with `Scenario.defender_decides`, hero expansion C3), all
    # *tunable* on design seeds: he is valued as if he had run this long toward his option's
    # point; he only cuts lanes that pass within this range of him; leaving his spot in the line
    # costs this much threat (xT), so with nothing to read he holds.
    defend_lookahead_s: float = 0.5
    defend_range_m: float = 10.0
    defend_cost: float = 0.02


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
    # Placed shots and the keeper's save model (`sim.shots`, scenarios with `Scenario.shots`).
    shots: bool = False
    keeper: int = -1  # the opponents' keeper
    from_y: float = 0.0  # where the last pass came from: the near post when he is central


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


def _run_in_miss(
    pos: np.ndarray, vel: np.ndarray, times: np.ndarray, path: np.ndarray, reaction: float
) -> np.ndarray:
    """Closest approach (m) of each of N players to the ball while he has not reacted yet.

    He keeps his velocity (pos + vel * t, as in time to intercept); the ball is at `path` ((K, 2))
    at `times` ((K,), ascending, from t = 0) and moves linearly in between. Only t <= reaction
    counts. Both move linearly on each piece, so the closest approach is exact for the sampled
    path. inf when the path starts after the reaction time.
    """
    k = int(np.searchsorted(times, reaction, side="right"))
    if k == 0:
        return np.full(len(pos), np.inf)
    t, b = times[:k], path[:k]
    if k < len(times) and t[-1] < reaction:  # close the window at the reaction time
        frac = (reaction - t[-1]) / (times[k] - t[-1])
        t = np.append(t, reaction)
        b = np.vstack([b, path[k - 1] + frac * (path[k] - path[k - 1])])
    gap = b[None, :, :] - (pos[:, None, :] + vel[:, None, :] * t[None, :, None])  # (N, K, 2)
    if len(t) == 1:
        return np.linalg.norm(gap[:, 0], axis=-1)
    start, step = gap[:, :-1], np.diff(gap, axis=1)
    s = -np.einsum("nkd,nkd->nk", start, step) / np.maximum(
        np.einsum("nkd,nkd->nk", step, step), 1e-12
    )
    closest = start + np.clip(s, 0.0, 1.0)[..., None] * step
    return np.linalg.norm(closest, axis=-1).min(axis=1)


def _p_run_in(ctx: DecisionContext, players: np.ndarray, miss: np.ndarray) -> np.ndarray:
    """P(the ball comes within the control radius of a player's run before he reacts).

    Before the reaction his path is fixed by the belief, so the only uncertainty is where he is:
    the belief's position uncertainty (m), the same that `_sigma` turns into time.
    """
    p = ctx.params
    spread = p.uncertainty0 + p.uncertainty_growth * ctx.age_s[players]
    return logistic(np.pi / (np.sqrt(3.0) * spread) * (p.control_radius - miss))


def _p_win_ball(
    ctx: DecisionContext, opp: np.ndarray, ball: np.ndarray, times: np.ndarray, path: np.ndarray
) -> np.ndarray:
    """P(each opponent wins the ball on its way), (N,). The ball starts at `ball` at t = 0 and is
    at `path` ((K, 2)) at `times` ((K,), ascending, > 0). The larger of two chances: he reacts and
    gets to a point of the path before the ball (time to intercept), or the ball runs into his
    run before he reacts (the run-in, from t = 0)."""
    p = ctx.params
    tti = time_to_intercept(ctx.pos[opp], ctx.vel[opp], path, p.reaction, p.v_max)
    sig = _sigma(ctx, opp)[:, None]
    p_tti = logistic(np.pi / (np.sqrt(3.0) * sig) * (times[None, :] - tti)).max(axis=1)
    miss = _run_in_miss(
        ctx.pos[opp], ctx.vel[opp], np.append(0.0, times), np.vstack([ball, path]), p.reaction
    )
    return np.maximum(p_tti, _p_run_in(ctx, opp, miss))


def _p_keep_carry(
    ctx: DecisionContext, ball: np.ndarray, target: np.ndarray, opp: np.ndarray
) -> float:
    """P(no opponent wins the ball on a carry from `ball` to `target` in `carry_time`), scored
    along the carry like a pass along its path. While the carry is no faster than v_max the time
    to intercept is worst at its endpoint; the samples cover a faster one."""
    p = ctx.params
    times = np.append(np.arange(p.path_step_s, p.carry_time, p.path_step_s), p.carry_time)
    path = ball + (times / p.carry_time)[:, None] * (target - ball)
    return float(np.prod(1.0 - _p_win_ball(ctx, opp, ball, times, path)))


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
        p_clear = float(np.prod(1.0 - _p_win_ball(ctx, opp, ball, times, path)))
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
    p_keep = _p_keep_carry(ctx, ball, carry_target, opp)
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
    if d_goal <= p.shot_range and ctx.shots and ctx.keeper >= 0:
        options.extend(_placed_shot(ctx, ball, placement) for placement in PLACEMENTS)
    elif d_goal <= p.shot_range:
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


def evaluate_defender_options(ctx: DecisionContext, defender: int) -> list[OptionEval]:
    """A defender's options against the carrier's passes, on the defender's belief (C3).

    `ctx` is the carrier's decision as the defender believes it (carrier = the passer). Options:
    `hold` (stay where he is) and `cut:<attacker>` for each pass of the carrier's whose believed
    lane, from the ball to the pass's target, passes within `defend_range_m` of him between its
    ends: its nearest point. Each is valued by moving the defender `defend_lookahead_s` toward
    its point at his top speed and re-running the carrier's own model: V = -sum_k q_k V_k, the
    expected threat of the carrier's pick, with a minus sign; a cut also pays `defend_cost`.
    Softmax probabilities at the context's temperature.
    """
    p = ctx.params
    passes = [o for o in evaluate_options(ctx) if o.kind == "pass"]
    ball = ctx.pos[ctx.carrier] if ctx.ball is None else np.asarray(ctx.ball, dtype=float)
    me = ctx.pos[defender].copy()

    def threat(at: np.ndarray, vel: np.ndarray) -> float:
        pos, vels = ctx.pos.copy(), ctx.vel.copy()
        pos[defender], vels[defender] = at, vel
        opts = evaluate_options(dataclasses.replace(ctx, pos=pos, vel=vels))
        return float(sum(o.prob * o.value for o in opts))

    reach = p.v_max * p.defend_lookahead_s
    hold = OptionEval("hold", "defend", None, (float(me[0]), float(me[1])), 1.0,
                      -threat(me, ctx.vel[defender]))  # fmt: skip
    options = [hold]
    for o in passes:
        lane = np.asarray(o.target, dtype=float) - ball
        t = float(np.dot(me - ball, lane) / max(float(np.dot(lane, lane)), 1e-9))
        point = ball + t * lane
        step = point - me
        dist = float(np.linalg.norm(step))
        if not 0.0 < t < 1.0 or dist > p.defend_range_m or dist < 1e-6:
            continue
        heading = step / dist
        at = point if dist <= reach else me + heading * reach
        value = -threat(at, heading * p.v_max) - p.defend_cost
        options.append(OptionEval(f"cut:{o.target_player}", "defend", o.target_player,
                                  (float(point[0]), float(point[1])), 1.0, value))  # fmt: skip
    temperature = ctx.temperature if ctx.temperature is not None else p.temperature
    values = np.array([o.value for o in options])
    z = (values - values.max()) / temperature
    probs = np.exp(z) / np.exp(z).sum()
    return [
        OptionEval(o.action, o.kind, o.target_player, o.target, o.p_success, o.value, float(q))
        for o, q in zip(options, probs, strict=True)
    ]


def option_success(ctx: DecisionContext, action: str, target: tuple[float, float]) -> float | None:
    """P(success) of one option with its target held fixed, on the state `ctx` holds.

    `evaluate_options` picks each target on the carrier's belief; this re-scores that same target
    on another state, e.g. the truth (true positions and velocities, belief age 0) for "he thought
    vs it was" (SPEC 5.1). Same functions, so on the belief context it returns the option's own
    p_success. None when a pass is not playable from the ball.
    """
    n = len(ctx.team)
    c = ctx.carrier
    ball = ctx.pos[c] if ctx.ball is None else np.asarray(ctx.ball, dtype=float)
    point = np.asarray(target, dtype=float)
    opp = np.flatnonzero(ctx.team != ctx.team[c])
    if action.startswith("pass:"):
        ids = ctx.ids or [str(i) for i in range(n)]
        mates = np.flatnonzero((ctx.team == ctx.team[c]) & (np.arange(n) != c))
        return _pass_success(ctx, ids.index(action[5:]), ball, point, opp, mates)
    if action == "carry":
        return _p_keep_carry(ctx, ball, point, opp)
    if action == "shot":
        d_goal = float(np.linalg.norm(point - ball))
        return float(min(0.6, 0.35 * math.exp(-(d_goal - 6.0) / 7.0)))
    if action.startswith("shot:") and ctx.keeper >= 0:
        return _placed_shot(ctx, ball, action[5:]).p_success
    raise ValueError(f"unknown action {action!r}")


PLACEMENTS = ("near", "far")


def placed_shot_value(ctx: DecisionContext, placement: str) -> float:
    """P(success) of `shot:near` or `shot:far` with `placement`, on the state `ctx` holds.

    The public counterpart of `_placed_shot` for re-scoring a chosen placement on another state,
    e.g. the truth (`explain.functions.true_decision_context`). `ctx.keeper` must be the opposing
    keeper's index.
    """
    ball = ctx.pos[ctx.carrier] if ctx.ball is None else np.asarray(ctx.ball, dtype=float)
    return _placed_shot(ctx, ball, placement).p_success


def _placed_shot(ctx: DecisionContext, ball: np.ndarray, placement: str) -> OptionEval:
    """`shot:near` or `shot:far`, valued on the shooter's belief (SPEC 3.3, Module A):
    P(on target) x (1 - E[P(save)]) over where he believes the keeper is, with the belief's
    position uncertainty (`_sigma`'s 0.3 m + 1 m per second of age). He assumes the keeper sees
    the strike, so the keeper's reach is for the ball's flight time to the keeper's line."""
    p, sp, kp = ctx.params, shots.SHOT, shots.KEEPER
    gx = shots.goal_x(ctx.attack_sign)
    y_aim = shots.aim_y(placement, shots.near_post_sign(float(ball[1]), ctx.from_y), sp)
    target = np.array([gx, y_aim])
    k = ctx.keeper
    y_cross, t_cross = shots.crossing(ball, target, float(ctx.pos[k][0]), float(np.mean(sp.speed)),
                                      ctx.ball_params)  # fmt: skip
    spread = p.uncertainty0 + p.uncertainty_growth * float(ctx.age_s[k])
    saved = shots.expected_p_save(y_cross, float(ctx.pos[k][1]), spread, shots.reach(t_cross, kp))
    value = shots.p_on_target(y_aim, float(np.linalg.norm(target - ball)), sp) * (1.0 - saved)
    return OptionEval(f"shot:{placement}", "shot", None, (float(gx), float(y_aim)), value, value)


def gumbel(u: float) -> float:
    u = min(max(u, 1e-12), 1.0 - 1e-12)
    return -math.log(-math.log(u))


def choose(options: list[OptionEval], noise: dict[str, float], temperature: float) -> OptionEval:
    """Gumbel-max sampling: argmax(value / T + g_option), which is exactly softmax(value / T).

    Each option has its own keyed noise, so in a counterfactual an option whose value did not
    change keeps the same noise (a Gumbel-max structural causal model, Oberst & Sontag 2019).
    """
    return max(options, key=lambda o: o.value / temperature + noise[o.action])
