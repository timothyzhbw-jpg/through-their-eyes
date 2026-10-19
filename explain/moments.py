"""Rule-based moment detection over a finished sim run (SPEC 5.1).

Each detection yields a `MomentCard`:
- `line_breaking_pass`: a completed pass that takes the ball past at least two outfield
  opponents' x positions (where they stood when the ball was played), in the attacking direction.
- `decision_after_scan`: a reception followed by the receiver's decision, with a scan by him
  shortly before the reception or during his first touch.
- `sprint`: smoothed speed above 7.0 m/s (SPEC 4.6) for at least half a second. A live overlay
  tag only (`live_only`), never a breakdown.

Moments of one action may overlap (a scan-led decision that is also a line-breaking pass); they
share `action_event`, so a consumer can group them.
"""

from __future__ import annotations

import numpy as np

from analytics.pressing import frame_pressing
from analytics.xt import xt_for
from explain.cards import MomentCard, TimeWindow, rounded
from sim.model import Decision, Event
from sim.run import MatchRun

LINE_BREAK_MIN_OPPONENTS = 2
SPRINT_SPEED = 7.0  # m/s (SPEC 4.6)
SPRINT_MIN_S = 0.5  # tunable
SPEED_SMOOTHING_FRAMES = 5  # centred moving average of velocity, 0.2 s at 25 Hz
SCAN_BEFORE_RECEPTION_S = 2.0  # a scan this close before the reception "leads" the decision
DECISION_AFTER_RECEPTION_S = 1.0
SCANS_WINDOW_S = 10.0  # scans_in_window(t - 10 s, t) at reception (SPEC 4.4)
PRE_ROLL_S = 6.0  # a replay window starts this long before the action (SPEC 5.3, 6)


def attack_sign(team: int) -> int:
    """+1 for the home team (attacks +x in the first half), -1 for the away team."""
    return 1 if team == 0 else -1


def smoothed_speed(vel: np.ndarray, frames: int = SPEED_SMOOTHING_FRAMES) -> np.ndarray:
    """Speed from a centred moving average of velocity ((F, N, 2) -> (F, N)); edges use fewer
    frames."""
    n_frames = vel.shape[0]
    half = frames // 2
    csum = np.concatenate([np.zeros((1, *vel.shape[1:])), np.cumsum(vel, axis=0)])
    idx = np.arange(n_frames)
    lo, hi = np.clip(idx - half, 0, n_frames), np.clip(idx + half + 1, 0, n_frames)
    mean = (csum[hi] - csum[lo]) / (hi - lo)[:, None, None]
    return np.linalg.norm(mean, axis=-1)


def pressure_on_carrier(run: MatchRun, frame: int) -> float:
    """Pressing intensity on the ball carrier at a frame (SPEC 4.3); NaN when the ball is free."""
    owner = int(run.owner[frame])
    if owner < 0:
        return float("nan")
    team = np.array([p.team for p in run.players])
    return frame_pressing(
        run.pos[frame], run.vel[frame], team, run.ball_pos[frame], run.ball_vel[frame], owner
    ).on_carrier


def decision_at(run: MatchRun, player: str, frame: int) -> Decision | None:
    return next((d for d in run.decisions if d.player == player and d.frame == frame), None)


def action_event(run: MatchRun, decision: Decision) -> Event | None:
    """The pass or shot a decision produced; None for a carry."""
    return next(
        (e for e in run.events if e.player == decision.player and e.frame == decision.frame
         and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip


def chosen_option(decision: Decision):
    return next(o for o in decision.options if o.action == decision.chosen)


def _window(run: MatchRun, start: int, end: int) -> TimeWindow:
    last = len(run.owner) - 1
    start, end = max(0, min(start, last)), max(0, min(end, last))
    return TimeWindow(
        frame_start=start,
        frame_end=end,
        t_start=rounded(start * run.dt),
        t_end=rounded(end * run.dt),
    )


def _frames(run: MatchRun, seconds: float) -> int:
    return round(seconds / run.dt)


def _metric(value: float | None) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return rounded(value)


def detect_line_breaking_passes(run: MatchRun) -> list[MomentCard]:
    cards = []
    for e in run.events:
        if e.type != "pass" or e.attrs.get("outcome") != "complete":
            continue
        sign = attack_sign(e.team)
        start, end = np.array(e.attrs["start"]), np.array(e.attrs["end_at"])
        x0, x1 = sign * start[0], sign * end[0]
        opponents = [k for k, p in enumerate(run.players) if p.team != e.team and p.role != "GK"]
        xs = {k: sign * run.pos[e.frame, k, 0] for k in opponents}
        bypassed = [run.ids[k] for k in sorted(opponents, key=xs.get) if x0 < xs[k] <= x1]
        if len(bypassed) < LINE_BREAK_MIN_OPPONENTS:
            continue
        receiver = e.attrs.get("receiver") or e.attrs["to"]
        end_frame = int(e.attrs["end"])
        reception = f"reception:{receiver}:{end_frame:04d}"
        anchors = [e.id] + [reception for ev in run.events if ev.id == reception]
        decision = decision_at(run, e.player, e.frame)
        xt0, xt1 = float(xt_for(start, sign)), float(xt_for(end, sign))
        cards.append(
            MomentCard(
                id=f"line_breaking_pass:{e.player}:{e.frame:04d}",
                kind="line_breaking_pass",
                scenario=run.scenario,
                seed=run.seed,
                frame=e.frame,
                t=rounded(e.frame * run.dt),
                window=_window(run, e.frame - _frames(run, PRE_ROLL_S), end_frame),
                player=e.player,
                team=e.team,
                players=[e.player, receiver, *bypassed],
                anchor_events=anchors,
                decision_frame=None if decision is None else decision.frame,
                action_event=e.id,
                metrics={
                    "opponents_bypassed": len(bypassed),
                    "pass_distance_m": rounded(np.linalg.norm(end - start)),
                    "progression_m": rounded(x1 - x0),
                    "pass_speed_mps": rounded(e.attrs["speed"]),
                    "xt_start": rounded(xt0),
                    "xt_end": rounded(xt1),
                    "xt_gain": rounded(xt1 - xt0),
                    "pressure_on_passer": _metric(pressure_on_carrier(run, e.frame)),
                    "pressure_on_receiver": _metric(pressure_on_carrier(run, end_frame)),
                },
            )
        )
    return cards


def detect_decisions_after_scan(run: MatchRun) -> list[MomentCard]:
    cards = []
    scans = [e for e in run.events if e.type == "scan"]
    for r in (e for e in run.events if e.type == "reception"):
        decision = next(
            (d for d in run.decisions if d.player == r.player
             and r.frame <= d.frame <= r.frame + _frames(run, DECISION_AFTER_RECEPTION_S)),
            None,
        )  # fmt: skip
        if decision is None:
            continue
        mine = sorted((s for s in scans if s.player == r.player), key=lambda s: (s.frame, s.id))
        leading = [
            s
            for s in mine
            if r.frame - _frames(run, SCAN_BEFORE_RECEPTION_S) <= s.frame <= decision.frame
        ]
        if not leading:
            continue
        before = [s for s in mine if r.frame - _frames(run, SCANS_WINDOW_S) <= s.frame < r.frame]
        since_last = (
            max(0, r.frame - max(int(s.attrs["end"]) for s in before)) * run.dt if before else None
        )
        action = action_event(run, decision)
        option = chosen_option(decision)
        target = option.target_player
        anchors = [(s.frame, s.id) for s in leading] + [(r.frame, r.id)]
        if action is not None:
            anchors.append((action.frame, action.id))
        end = (
            int(action.attrs["end"])
            if action is not None and action.attrs.get("end") is not None
            else decision.frame + _frames(run, 1.0)
        )
        cards.append(
            MomentCard(
                id=f"decision_after_scan:{r.player}:{decision.frame:04d}",
                kind="decision_after_scan",
                scenario=run.scenario,
                seed=run.seed,
                frame=decision.frame,
                t=rounded(decision.frame * run.dt),
                window=_window(run, decision.frame - _frames(run, PRE_ROLL_S), end),
                player=r.player,
                team=r.team,
                players=[r.player] + ([target] if target else []),
                anchor_events=[i for _, i in sorted(anchors)],
                decision_frame=decision.frame,
                action_event=None if action is None else action.id,
                metrics={
                    "chosen_action": decision.chosen,
                    "chosen_prob": rounded(option.prob),
                    "chosen_value": rounded(option.value),
                    "n_options": len(decision.options),
                    "scans_before_reception": len(before),
                    "scans_leading": len(leading),
                    "time_since_last_scan_at_reception_s": _metric(since_last),
                    "first_touch_s": rounded((decision.frame - r.frame) * run.dt),
                    "belief_error_target_m": _metric(decision.belief_error.get(target))
                    if target
                    else None,
                    "belief_age_target_s": _metric(decision.belief_age.get(target))
                    if target
                    else None,
                    "pressure_on_carrier": _metric(pressure_on_carrier(run, decision.frame)),
                },
            )
        )
    return cards


def detect_sprints(run: MatchRun) -> list[MomentCard]:
    cards = []
    speed = smoothed_speed(run.vel)
    min_frames = _frames(run, SPRINT_MIN_S)
    for k, player in enumerate(run.players):
        fast = np.concatenate([[False], speed[:, k] > SPRINT_SPEED, [False]])
        edges = np.flatnonzero(np.diff(fast.astype(np.int8)))
        for start, stop in zip(edges[::2], edges[1::2], strict=True):  # [start, stop)
            if stop - start < min_frames:
                continue
            peak = start + int(np.argmax(speed[start:stop, k]))
            cards.append(
                MomentCard(
                    id=f"sprint:{player.id}:{start:04d}",
                    kind="sprint",
                    scenario=run.scenario,
                    seed=run.seed,
                    frame=int(peak),
                    t=rounded(peak * run.dt),
                    window=_window(run, int(start), int(stop) - 1),
                    player=player.id,
                    team=player.team,
                    players=[player.id],
                    anchor_events=[],
                    live_only=True,
                    metrics={
                        "peak_speed_mps": rounded(speed[peak, k]),
                        "duration_s": rounded((stop - start) * run.dt),
                        "distance_m": rounded(speed[start:stop, k].sum() * run.dt),
                    },
                )
            )
    return cards


def detect_moments(run: MatchRun) -> list[MomentCard]:
    """Every moment in a run, in time order (ties by kind, then id)."""
    cards = (
        detect_decisions_after_scan(run) + detect_line_breaking_passes(run) + detect_sprints(run)
    )
    return sorted(cards, key=lambda c: (c.frame, c.kind, c.id))
