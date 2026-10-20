"""Predicate functions (SPEC 5.3), evaluated against a sim run and its counterfactuals.

Functions: count_events, metric_at, metric_delta, event_attr, distance, scans_in_window,
observed_share, cf_delta. Every function accepts `cf: <scan id>` to evaluate on the
counterfactual run without that scan instead of the factual run, or `cf: force:<player>:<frame>:
<action>` for the what-if run with that decision forced (SPEC 3.7).

Time is anchored on events: `anchor` is an event id ("<type>:<player>:<frame>") or a moment
anchor "<card id>.<name>" (SPEC 5.1, e.g. "m:decision_after_scan:H8:0075.reception"), and offsets
(`at`, `from`, `to`, `window_s`) are seconds relative to it, converted to whole frames.

Two ways to fail, never a guessed value:
- `Inconclusive`: cannot be computed (unknown function or metric, a window outside the recorded
  run, a kernel that does not exist yet). The claim does not render.
- `Refuted`: the claim refers to something that did not happen (an event or player that is not in
  the run). The claim is false.
"""

from __future__ import annotations

import inspect
import keyword
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from functools import cached_property
from typing import Any

import numpy as np

from analytics.pitch_control import pitch_control, pitch_grid
from analytics.pressing import aggregate, frame_pressing
from analytics.vision import VisionParams, player_visibility, visibility, wrap_angle
from analytics.xt import xt_for
from explain.cards import MomentCard
from sim.counterfactual import (
    WHAT_IF_PREFIX,
    CounterfactualResult,
    WhatIfResult,
    drop_scan_counterfactual,
    what_if_from_id,
)
from sim.model import Decision, Event
from sim.run import MatchRun

EVENT_ID = re.compile(r"^[a-z_]+:[A-Za-z]+\d+:\d+$")
BALL = "ball"


class Inconclusive(Exception):
    """The value cannot be computed (yet)."""


class Refuted(Exception):
    """The claim refers to something that is not in the run."""


def is_number(x: Any) -> bool:
    return isinstance(x, int | float | np.integer | np.floating) and not isinstance(
        x, bool | np.bool_
    )


@dataclass
class EvalContext:
    """What claims are checked against: one factual run, plus counterfactuals by dropped scan.

    Counterfactuals not supplied are re-simulated on demand from the run's scenario and seed
    (deterministic, SPEC 3.7) unless `resimulate` is False. `cards` resolve moment anchors.
    """

    run: MatchRun
    counterfactuals: dict[str, CounterfactualResult] = field(default_factory=dict)
    cards: dict[str, MomentCard] = field(default_factory=dict)
    resimulate: bool = True
    vision: VisionParams = VisionParams()
    _events: dict[int, dict[str, Event]] = field(default_factory=dict, repr=False)
    _vis: dict[tuple, np.ndarray] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        for scan_id, result in self.counterfactuals.items():
            same = (result.factual.scenario, result.factual.seed) == (self.run.scenario,
                                                                       self.run.seed)  # fmt: skip
            if not same or result.scan_id != scan_id:
                raise ValueError(f"counterfactual {scan_id} does not belong to this run")

    @cached_property
    def run_hash(self) -> str:
        return self.run.output_hash()

    @property
    def match(self) -> str:
        return f"{self.run.scenario}:{self.run.seed}"

    def value(self, operand: Any, slots: Mapping[str, Any] | None = None) -> Any:
        """Evaluate one operand on the factual run (used to build claims from ground truth)."""
        return Evaluator(self, slots or {}).value(operand, self.run)

    # --- lookups -------------------------------------------------------------------------

    def event(self, run: MatchRun, event_id: Any) -> Event:
        if not isinstance(event_id, str):
            raise Inconclusive(f"event reference must be an id, got {event_id!r}")
        index = self._events.get(id(run))
        if index is None:
            index = self._events[id(run)] = {e.id: e for e in run.events}
        if event_id in index:
            return index[event_id]
        if EVENT_ID.match(event_id):
            raise Refuted(f"no event {event_id} in this run")
        card_id, _, name = event_id.rpartition(".")
        if card_id in self.cards:
            anchor = self.cards[card_id].anchors.get(name)
            if anchor is None:
                raise Refuted(f"moment {card_id} has no {name!r} anchor")
            return self.event(run, anchor)
        raise Inconclusive(
            f"cannot resolve {event_id!r}: not an event id, nor an anchor of a supplied card"
        )

    def player(self, run: MatchRun, player_id: Any) -> int:
        if not isinstance(player_id, str):
            raise Inconclusive(f"player reference must be an id, got {player_id!r}")
        if player_id not in run.ids:
            raise Refuted(f"no player {player_id} in this match")
        return run.index(player_id)

    def frame(self, run: MatchRun, anchor: Any, offset_s: Any = 0.0) -> int:
        if not is_number(offset_s):
            raise Inconclusive(f"time offset must be a number, got {offset_s!r}")
        f = self.event(run, anchor).frame + round(float(offset_s) / run.dt)
        if f < 0:
            raise Inconclusive(f"{anchor}{offset_s:+} s is before the recorded run")
        if f >= len(run.owner):
            raise Inconclusive(f"{anchor}{offset_s:+} s is after the recorded run")
        return f

    def counterfactual(self, scan_ref: Any) -> CounterfactualResult | WhatIfResult:
        """The run without one scan (an event id or a moment anchor such as `<card>.last_scan`),
        or a what-if with one decision forced (`force:<player>:<frame>:<action>`, SPEC 3.7)."""
        if isinstance(scan_ref, str) and scan_ref.startswith(WHAT_IF_PREFIX):
            if scan_ref not in self.counterfactuals:
                if not self.resimulate:
                    raise Inconclusive(f"no what-if {scan_ref} was supplied")
                try:
                    result = what_if_from_id(self.run.scenario, self.run.seed, scan_ref)
                except ValueError as e:
                    raise Refuted(str(e)) from None
                self.counterfactuals[scan_ref] = result
            return self.counterfactuals[scan_ref]
        scan = self.event(self.run, scan_ref)
        if scan.type != "scan":
            raise Refuted(f"{scan.id} is not a scan; counterfactuals drop scans")
        if scan.id not in self.counterfactuals:
            if not self.resimulate:
                raise Inconclusive(f"no counterfactual without {scan.id} was supplied")
            result = drop_scan_counterfactual(self.run.scenario, self.run.seed, scan.id)
            self.counterfactuals[scan.id] = result
        return self.counterfactuals[scan.id]

    def visibility_matrix(self, run: MatchRun, f: int) -> np.ndarray:
        key = ("players", id(run), f)
        if key not in self._vis:
            speed = np.linalg.norm(run.vel[f], axis=-1)
            self._vis[key] = player_visibility(run.pos[f], run.head_yaw[f], speed, self.vision)
        return self._vis[key]

    def vision_map(self, run: MatchRun, i: int, f: int, grid: np.ndarray) -> np.ndarray:
        key = ("grid", id(run), i, f, grid.shape)
        if key not in self._vis:
            others = np.delete(run.pos[f], i, axis=0)
            speed = float(np.linalg.norm(run.vel[f, i]))
            self._vis[key] = visibility(
                run.pos[f, i], float(run.head_yaw[f, i]), speed, grid, others, self.vision
            )
        return self._vis[key]


class Evaluator:
    """Resolves operands for one claim; records which counterfactuals it used."""

    def __init__(self, ctx: EvalContext, slots: Mapping[str, Any]) -> None:
        self.ctx = ctx
        self.slots = slots  # name -> raw value (a Slot's ref or value)
        self.used_counterfactuals: list[str] = []

    def value(self, operand: Any, run: MatchRun) -> Any:
        if isinstance(operand, list):
            return [self.value(v, run) for v in operand]
        if isinstance(operand, dict):
            if "fn" in operand:
                return self.call(operand["fn"], operand.get("args", {}), run)
            if "slot" in operand:
                return self.slot(operand)
            if "event" in operand:
                return self.ctx.event(run, self.value(operand["event"], run)).t
            return {k: self.value(v, run) for k, v in operand.items()}
        return operand

    def slot(self, operand: dict[str, Any]) -> Any:
        name = operand["slot"]
        if name not in self.slots:
            raise Inconclusive(f"unknown slot {name!r}")
        value = self.slots[name]
        scale = operand.get("scale")
        if scale is not None:
            if not (is_number(value) and is_number(scale)):
                raise Inconclusive(f"cannot scale slot {name!r} = {value!r}")
            value = value * scale
        return value

    def counterfactual(self, scan_ref: Any) -> CounterfactualResult:
        result = self.ctx.counterfactual(scan_ref)
        if result.scan_id not in self.used_counterfactuals:
            self.used_counterfactuals.append(result.scan_id)
        return result

    def call(self, name: Any, raw_args: dict[str, Any], run: MatchRun) -> Any:
        if name == "cf_delta":
            return self.cf_delta(raw_args, run)
        func = FUNCTIONS.get(name)
        if func is None:
            raise Inconclusive(f"unknown function {name!r}")
        if "cf" in raw_args:
            run = self.counterfactual(self.value(raw_args["cf"], run)).counterfactual
        args = {k: self.value(v, run) for k, v in raw_args.items() if k != "cf"}
        return _apply(name, func, self.ctx, run, args)

    def cf_delta(self, raw_args: dict[str, Any], run: MatchRun) -> float:
        """`of` evaluated on the factual run minus the same on the counterfactual run.

        `of` is a function operand, or "possession_value": the xT after the hero's action
        (SPEC 3.7, `CounterfactualResult.delta_xt`).
        """
        unknown = set(raw_args) - {"of", "scan"}
        if unknown or "of" not in raw_args or "scan" not in raw_args:
            raise Inconclusive(f"cf_delta takes `of` and `scan`, got {sorted(raw_args)}")
        result = self.counterfactual(self.value(raw_args["scan"], run))
        of = raw_args["of"]
        if of == "possession_value":
            return float(result.delta_xt)
        if not (isinstance(of, dict) and "fn" in of):
            raise Inconclusive(f"cf_delta cannot compare {of!r}")
        a, b = self.value(of, result.factual), self.value(of, result.counterfactual)
        if not (is_number(a) and is_number(b)):
            raise Inconclusive(f"cf_delta needs numbers, got {a!r} and {b!r}")
        return float(a) - float(b)


def _apply(name: str, func: Callable, ctx: EvalContext, run: MatchRun, args: dict) -> Any:
    args = {(f"{k}_" if keyword.iskeyword(k) else k): v for k, v in args.items()}
    try:
        inspect.signature(func).bind(ctx, run, **args)
    except TypeError as e:
        raise Inconclusive(f"{name}: {e}") from None
    return func(ctx, run, **args)


# --- functions ---------------------------------------------------------------------------


def count_events(
    ctx: EvalContext,
    run: MatchRun,
    type: str,
    anchor: str,
    from_: float = 0.0,
    to: float = 0.0,
    player: str | None = None,
    team: int | None = None,
    where: dict | None = None,
) -> int:
    """Events of a type (optionally by player / team / attributes) with anchor+from ≤ t ≤ to."""
    lo, hi = ctx.frame(run, anchor, from_), ctx.frame(run, anchor, to)
    if lo > hi:
        raise Inconclusive(f"empty window: from {from_} s is after to {to} s")
    if player is not None:
        ctx.player(run, player)
    where = where or {}
    return sum(
        e.type == type
        and lo <= e.frame <= hi
        and (player is None or e.player == player)
        and (team is None or e.team == team)
        and all(e.attrs.get(k) == v for k, v in where.items())
        for e in run.events
    )


def scans_in_window(
    ctx: EvalContext, run: MatchRun, player: str, anchor: str, window_s: float = 10.0
) -> int:
    """Scans the player started in the `window_s` seconds up to the anchor (SPEC 4.4)."""
    if not is_number(window_s) or window_s < 0:
        raise Inconclusive(f"window_s must be a non-negative number, got {window_s!r}")
    return count_events(ctx, run, "scan", anchor, from_=-window_s, to=0.0, player=player)


def event_attr(ctx: EvalContext, run: MatchRun, event: str, attr: str) -> Any:
    """A recorded attribute, or a derived one: t, frame, player, team, type, duration_s."""
    e = ctx.event(run, event)
    derived = {"t": e.t, "frame": e.frame, "player": e.player, "team": e.team, "type": e.type}
    if attr in derived:
        return derived[attr]
    if attr == "duration_s":
        end = e.attrs.get("end")
        if end is None:
            raise Inconclusive(f"{event} has no end frame")
        return (int(end) - e.frame) * run.dt
    if attr not in e.attrs:
        raise Inconclusive(f"{e.type} events have no attribute {attr!r}")
    return e.attrs[attr]


def distance(
    ctx: EvalContext, run: MatchRun, a: str, b: str, anchor: str, at: float = 0.0
) -> float:
    """Metres between two players (or a player and "ball") at anchor + at."""
    return _distance(ctx, run, ctx.frame(run, anchor, at), a, b)


def metric_at(
    ctx: EvalContext, run: MatchRun, metric: str, anchor: str, at: float = 0.0, **args: Any
) -> Any:
    func = METRICS.get(metric)
    if func is None:
        raise Inconclusive(f"unknown metric {metric!r}")
    f = ctx.frame(run, anchor, at)
    try:
        inspect.signature(func).bind(ctx, run, f, **args)
    except TypeError as e:
        raise Inconclusive(f"metric {metric}: {e}") from None
    return func(ctx, run, f, **args)


def metric_delta(
    ctx: EvalContext,
    run: MatchRun,
    metric: str,
    anchor: str,
    from_: float,
    to: float = 0.0,
    **args: Any,
) -> float:
    """metric(anchor + to) − metric(anchor + from)."""
    a = metric_at(ctx, run, metric, anchor, at=to, **args)
    b = metric_at(ctx, run, metric, anchor, at=from_, **args)
    if not (is_number(a) and is_number(b)):
        raise Inconclusive(f"metric {metric} is not numeric")
    return float(a) - float(b)


def observed_share(
    ctx: EvalContext,
    run: MatchRun,
    player: str,
    anchor: str,
    at: float = 0.0,
    window_s: float | None = None,
) -> float:
    """observed_defended_share (SPEC 4.4): Σ V·P_def / Σ P_def over the pitch.

    V is the player's vision map (FOV × occlusion, `analytics.vision`); with `window_s` it is the
    most he saw of each cell over [at − window_s, at]. P_def is the opponents' pitch control at
    `at`, so the share is of the space the opponents controlled when it mattered.
    """
    return _observed_share(ctx, run, ctx.frame(run, anchor, at), player, window_s)


_GRID: list[np.ndarray] = []


def _grid() -> np.ndarray:
    if not _GRID:
        _GRID.append(pitch_grid())
    return _GRID[0]


FUNCTIONS: dict[str, Callable[..., Any]] = {
    "count_events": count_events,
    "metric_at": metric_at,
    "metric_delta": metric_delta,
    "event_attr": event_attr,
    "distance": distance,
    "scans_in_window": scans_in_window,
    "observed_share": observed_share,
    # "cf_delta" is evaluated lazily by `Evaluator.cf_delta`: its `of` runs on two runs.
}


# --- metrics for metric_at / metric_delta: (ctx, run, frame, **args) ----------------------


def _point(ctx: EvalContext, run: MatchRun, f: int, who: str) -> np.ndarray:
    if who == BALL:
        return run.ball_pos[f, :2]
    return run.pos[f, ctx.player(run, who)]


def _distance(ctx: EvalContext, run: MatchRun, f: int, a: str, b: str) -> float:
    return float(np.linalg.norm(_point(ctx, run, f, a) - _point(ctx, run, f, b)))


def _speed(ctx: EvalContext, run: MatchRun, f: int, player: str) -> float:
    return float(np.linalg.norm(run.vel[f, ctx.player(run, player)]))


def _ball_speed(ctx: EvalContext, run: MatchRun, f: int) -> float:
    return float(np.linalg.norm(run.ball_vel[f, :2]))


def _opponents(run: MatchRun, i: int) -> np.ndarray:
    team = np.array([p.team for p in run.players])
    return np.flatnonzero(team != team[i])


def _nearest_opponent_distance(ctx: EvalContext, run: MatchRun, f: int, player: str) -> float:
    i = ctx.player(run, player)
    return float(np.linalg.norm(run.pos[f, _opponents(run, i)] - run.pos[f, i], axis=1).min())


def _nearest_opponent(ctx: EvalContext, run: MatchRun, f: int, player: str) -> str:
    i = ctx.player(run, player)
    opp = _opponents(run, i)
    return run.ids[opp[int(np.argmin(np.linalg.norm(run.pos[f, opp] - run.pos[f, i], axis=1)))]]


def _last_scan(ctx: EvalContext, run: MatchRun, f: int, player: str) -> Event:
    ctx.player(run, player)
    scans = [e for e in run.events if e.type == "scan" and e.player == player and e.frame <= f]
    if not scans:
        raise Inconclusive(f"no scan by {player} recorded up to frame {f}")
    return max(scans, key=lambda e: e.frame)


def _time_since_last_scan(ctx: EvalContext, run: MatchRun, f: int, player: str) -> float:
    """Seconds since the player's last scan started (SPEC 4.4)."""
    return (f - _last_scan(ctx, run, f, player).frame) * run.dt


def _visibility(ctx: EvalContext, run: MatchRun, f: int, observer: str, target: str) -> float:
    i, j = ctx.player(run, observer), ctx.player(run, target)
    return float(ctx.visibility_matrix(run, f)[i, j])


def _blind_side(ctx: EvalContext, run: MatchRun, f: int, observer: str, target: str) -> bool:
    """The target was outside the observer's vision cone when his last scan began.

    At the first frame of a scan the head still points at the ball (baseline gaze), so this is
    "outside what he sees without turning his head" (SPEC 5.3 lexicon: `blind side`).
    """
    i, j = ctx.player(run, observer), ctx.player(run, target)
    g = _last_scan(ctx, run, f, observer).frame
    rel = run.pos[g, j] - run.pos[g, i]
    offset = abs(float(wrap_angle(np.arctan2(rel[1], rel[0]) - run.head_yaw[g, i])))
    vp = ctx.vision
    speed = float(np.linalg.norm(run.vel[g, i]))
    half = max(vp.min_half_cone, vp.half_cone - vp.narrowing_per_mps * speed)
    return bool(offset > half)


def _decision(ctx: EvalContext, run: MatchRun, f: int, player: str) -> Decision:
    ctx.player(run, player)
    d = next((d for d in run.decisions if d.player == player and d.frame == f), None)
    if d is None:
        raise Inconclusive(
            f"no decision by {player} at frame {f}; beliefs are recorded only at decisions"
        )
    return d


def _belief_error(ctx: EvalContext, run: MatchRun, f: int, observer: str, target: str) -> float:
    ctx.player(run, target)
    return float(_decision(ctx, run, f, observer).belief_error[target])


def _belief_age(ctx: EvalContext, run: MatchRun, f: int, observer: str, target: str) -> float:
    ctx.player(run, target)
    return float(_decision(ctx, run, f, observer).belief_age[target])


def _chosen(ctx: EvalContext, run: MatchRun, f: int, player: str) -> str:
    return _decision(ctx, run, f, player).chosen


def _option_prob(ctx: EvalContext, run: MatchRun, f: int, player: str, action: str) -> float:
    d = _decision(ctx, run, f, player)
    option = next((o for o in d.options if o.action == action), None)
    if option is None:
        raise Refuted(f"{player} did not consider {action!r} at frame {f}")
    return float(option.prob)


def _pitch_control(ctx: EvalContext, run: MatchRun, f: int, player: str) -> float:
    """His team's pitch control at his position (SPEC 4.2)."""
    i = ctx.player(run, player)
    team = np.array([p.team for p in run.players])
    mates, opps = np.flatnonzero(team == team[i]), np.flatnonzero(team != team[i])
    p = pitch_control(run.pos[f, i][None], run.pos[f, mates], run.vel[f, mates],
                      run.pos[f, opps], run.vel[f, opps])  # fmt: skip
    return float(p[0])


def _xt(ctx: EvalContext, run: MatchRun, f: int, player: str) -> float:
    """xT of his position for his team (home attacks +x, SPEC 3.1)."""
    i = ctx.player(run, player)
    return float(xt_for(run.pos[f, i], 1 if run.players[i].team == 0 else -1))


def _pressing_intensity(ctx: EvalContext, run: MatchRun, f: int, player: str) -> float:
    """Aggregate pressing intensity on a player of the team in possession (SPEC 4.3).

    For the carrier it includes pressure on the ball. Nothing is pressed while the ball is free,
    and the defending team is not pressed: both are inconclusive rather than zero.
    """
    i = ctx.player(run, player)
    carrier = int(run.owner[f])
    team = np.array([p.team for p in run.players])
    if carrier < 0:
        raise Inconclusive(f"no pressing intensity at frame {f}: the ball is free")
    if team[i] != team[carrier]:
        raise Inconclusive(f"{player} is not on the team in possession at frame {f}")
    pf = frame_pressing(run.pos[f], run.vel[f], team, run.ball_pos[f], carrier)
    return pf.on_carrier if i == carrier else float(aggregate(pf.column(i)))


def _observed_share(
    ctx: EvalContext, run: MatchRun, f: int, player: str, window_s: float | None = None
) -> float:
    i = ctx.player(run, player)
    start = f
    if window_s is not None:
        if not is_number(window_s) or window_s < 0:
            raise Inconclusive(f"window_s must be a non-negative number, got {window_s!r}")
        start = f - round(float(window_s) / run.dt)
        if start < 0:
            raise Inconclusive(f"a {window_s} s window up to frame {f} is before the recorded run")
    grid = _grid()
    seen = np.max([ctx.vision_map(run, i, g, grid) for g in range(start, f + 1)], axis=0)
    team = np.array([p.team for p in run.players])
    mates, opps = np.flatnonzero(team == team[i]), np.flatnonzero(team != team[i])
    p_def = pitch_control(grid, run.pos[f, opps], run.vel[f, opps], run.pos[f, mates],
                          run.vel[f, mates])  # fmt: skip
    return float((seen * p_def).sum() / p_def.sum())


METRICS: dict[str, Callable[..., Any]] = {
    "distance": _distance,
    "speed": _speed,
    "ball_speed": _ball_speed,
    "nearest_opponent_distance": _nearest_opponent_distance,
    "nearest_opponent": _nearest_opponent,
    "time_since_last_scan": _time_since_last_scan,
    "visibility": _visibility,
    "blind_side": _blind_side,
    "belief_error": _belief_error,
    "belief_age": _belief_age,
    "chosen": _chosen,
    "option_prob": _option_prob,
    "pitch_control": _pitch_control,
    "xt": _xt,
    "pressing_intensity": _pressing_intensity,
    "observed_share": _observed_share,
}
