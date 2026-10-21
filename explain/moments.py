"""Moment detection (SPEC 5.1): rule-based detectors over a finished `MatchRun`.

- `line_breaking_pass`: a completed pass that takes the ball past at least two outfield opponents,
  each goal-side of the ball when it is played and behind it when it is received.
- `decision_after_scan`: a reception followed by a decision of the receiver, with a scan of his
  ending at most `SCAN_JUST_BEFORE_S` before the reception (or during the first touch).
- `pressed_decision`: a decision taken on the ball under heavy pressure, pressing intensity on
  the carrier at least `PRESSED_THRESHOLD` (SPEC 4.3) — the lexicon's own threshold for "under
  heavy pressure" (SPEC 5.3), so the card and its narration agree.
- `sprint`: speed above 7.0 m/s (SPEC 4.6) for at least `MIN_SPRINT_S`; a live overlay tag only.
- `blind_side_pass` (M4): a pass to the target of a blind-side alert (SPEC 4.4), played while the
  alert is on or at most `BLIND_SIDE_PASS_S` after it cleared. Run on its own with
  `detect_blind_side_passes`; not part of `detect_moments` yet, so existing cards are unchanged.
- `marker_scan`: a defender's look over his shoulder at the man he marks, before a pass to that
  man (a hero with no decision on the ball, `corner_blind_side`). All of these hold: the pass's
  intended receiver R is in the defender's own third when it is played; the defender D is R's
  nearest outfield opponent then, goal-side of him; D starts a scan at most `SCAN_JUST_BEFORE_S`
  before the pass with R within `MARKED_M` (the lexicon's `unmarked` threshold: he is marking
  him); R has been out of D's sight for the `MARKER_UNSEEN_S` before it (the blind-side alert's
  own unseen time, SPEC 4.4) and is seen during it. The anchor is the pass's resolution, where
  the look pays off or not.
- `keeper_step`: a keeper's step for a sightline (`step` events, `screened_shot`) followed within
  `STEP_TO_SHOT_S` by an opponent's shot at his goal. The anchor is the shot's resolution (a save,
  a goal, wide or blocked). Its only lens is `sight` (`explain.lenses.sight_lens`).

Cards that describe the same action (anchor "action", e.g. the hero's pass) are merged into one
card: the primary kind is the first in `PRIORITY`, `tags` lists every detector that fired. Goal,
big chance and counter-press detectors need shots and turnovers the sim does not produce yet (M4).
"""

from __future__ import annotations

import numpy as np

from analytics.blind_side import DEFAULT_PARAMS, BlindSideAlerts, BlindSideParams, detect_alerts
from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from analytics.xt import xt_for
from explain.cards import LensName, MomentCard, MomentKind, Scalar
from explain.lexicon import TERMS
from sim.config import HALF_LENGTH, SimParams
from sim.model import Decision, Event
from sim.run import MatchRun

SPRINT_MPS = 7.0
MIN_SPRINT_S = 0.4
MIN_BYPASSED = 2
SCAN_WINDOW_S = 10.0  # scans_in_window(t - 10 s, t) (SPEC 4.4)
SCAN_JUST_BEFORE_S = 2.0
MAX_TOUCH_S = 1.0  # longest reception-to-decision gap that still counts as one moment
PRE_ROLL_S = 6.0  # replay window before the anchor
POST_ROLL_S = 1.0  # and after the action is resolved
BLIND_SIDE_PASS_S = 3.0  # a pass this soon after a blind-side alert cleared is its moment
PRESSED_THRESHOLD = float(TERMS["under heavy pressure"].threshold)
MARKED_M = float(TERMS["unmarked"].threshold)  # a defender this close to his man is marking him
MARKER_UNSEEN_S = DEFAULT_PARAMS.min_unseen_s  # out of sight this long: on his blind side
OWN_THIRD_X = 2 * HALF_LENGTH / 6  # 17.5 m from halfway, the edge of a team's own third
SEEN = SimParams().perception_threshold  # visibility from which the sim counts a player as seen
STEP_TO_SHOT_S = 3.0  # a keeper's step this long before a shot is his moment
PRIORITY: tuple[MomentKind, ...] = (
    "pressed_decision",
    "decision_after_scan",
    "line_breaking_pass",
    "sprint",
    "marker_scan",
    "keeper_step",
)
ALL_LENSES: list[LensName] = ["scan", "space", "pressure"]


def _r(x: float, digits: int = 4) -> float:
    return round(float(x), digits)


def _attack_sign(team: int) -> int:
    return 1 if team == 0 else -1


def _frames(run: MatchRun, seconds: float) -> int:
    return round(seconds / run.dt)


def _sorted_events(run: MatchRun, etype: str | None = None) -> list[Event]:
    events = sorted(run.events, key=lambda e: (e.frame, e.id))
    return [e for e in events if etype is None or e.type == etype]


def _card(
    run: MatchRun,
    kind: MomentKind,
    actor: str,
    anchor_frame: int,
    window: tuple[int, int],
    *,
    receiver: str | None = None,
    players: list[str] | None = None,
    anchors: dict[str, str] | None = None,
    events: list[Event] = (),
    metrics: dict[str, Scalar] | None = None,
    live_only: bool = False,
) -> MomentCard:
    last = len(run.owner) - 1
    lo, hi = max(0, min(window[0], anchor_frame)), min(last, max(window[1], anchor_frame))
    involved = [actor] + [p for p in (players or [receiver]) if p and p != actor]
    return MomentCard(
        id=f"m:{kind}:{actor}:{anchor_frame:04d}",
        kind=kind,
        tags=[kind],
        scenario=run.scenario,
        seed=run.seed,
        live_only=live_only,
        frame_start=lo,
        frame_end=hi,
        anchor_frame=anchor_frame,
        t_start=_r(lo * run.dt),
        t_end=_r(hi * run.dt),
        anchor_t=_r(anchor_frame * run.dt),
        actor=actor,
        receiver=receiver,
        players=list(dict.fromkeys(involved)),
        anchors=anchors or {},
        events=[e.id for e in sorted(events, key=lambda e: (e.frame, e.id))],
        metrics=metrics or {},
        candidate_lenses=[] if live_only else list(ALL_LENSES),
    )


def _resolution(run: MatchRun, action: Event) -> tuple[str, Event] | None:
    """How a pass or shot ended: ("completion", reception) or ("turnover", interception/out)."""
    end = action.attrs.get("end")
    if end is None:
        return None
    for e in _sorted_events(run):
        if e.frame == end and e.type in ("reception", "interception", "out"):
            return ("completion" if e.type == "reception" else "turnover"), e
    return None


# --- line-breaking pass ------------------------------------------------------------------


def bypassed_opponents(run: MatchRun, event: Event) -> list[str]:
    """Outfield opponents goal-side of the ball when the pass is played and behind it (relative
    to the passer's attacking direction) when it is received. Sorted by id."""
    end, end_at = event.attrs.get("end"), event.attrs.get("end_at")
    if end is None or end_at is None:
        return []
    s = _attack_sign(event.team)
    x0, x1 = s * float(event.attrs["start"][0]), s * float(end_at[0])
    f0, f1 = event.frame, min(int(end), len(run.owner) - 1)
    out = [
        p.id
        for j, p in enumerate(run.players)
        if p.team != event.team and p.role != "GK"
        and s * run.pos[f0, j, 0] > x0 and s * run.pos[f1, j, 0] < x1
    ]  # fmt: skip
    return sorted(out)


def _pass_metrics(run: MatchRun, event: Event, bypassed: list[str]) -> dict[str, Scalar]:
    start, end = np.array(event.attrs["start"]), np.array(event.attrs["end_at"])
    s = _attack_sign(event.team)
    return {
        "opponents_bypassed": len(bypassed),
        "pass_distance_m": _r(np.linalg.norm(end - start), 2),
        "pass_progression_m": _r(s * (end[0] - start[0]), 2),
        "pass_speed_mps": _r(event.attrs["speed"], 2),
        "pass_xt_gain": _r(xt_for(end, s) - xt_for(start, s)),
    }


def detect_line_breaking_passes(run: MatchRun) -> list[MomentCard]:
    cards = []
    for e in _sorted_events(run, "pass"):
        if e.attrs.get("outcome") != "complete":
            continue
        bypassed = bypassed_opponents(run, e)
        if len(bypassed) < MIN_BYPASSED:
            continue
        anchors, events = {"action": e.id}, [e]
        resolved = _resolution(run, e)
        if resolved:
            anchors[resolved[0]] = resolved[1].id
            events.append(resolved[1])
        receiver = e.attrs.get("receiver")
        end = int(e.attrs["end"])
        cards.append(
            _card(
                run, "line_breaking_pass", e.player, e.frame,
                (e.frame - _frames(run, PRE_ROLL_S), end + _frames(run, POST_ROLL_S)),
                receiver=receiver, players=[receiver, *bypassed], anchors=anchors,
                events=events, metrics=_pass_metrics(run, e, bypassed),
            )
        )  # fmt: skip
    return cards


# --- sprint tag --------------------------------------------------------------------------


def _runs_above(mask: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) of every run of True."""
    padded = np.concatenate([[False], mask, [False]]).astype(np.int8)
    edges = np.flatnonzero(np.diff(padded))
    return [(int(a), int(b) - 1) for a, b in zip(edges[::2], edges[1::2], strict=True)]


def detect_sprints(run: MatchRun) -> list[MomentCard]:
    """Speed is the sim's velocity, which is already smooth (no sensor noise on positions)."""
    speed = np.linalg.norm(run.vel, axis=-1)
    min_frames = _frames(run, MIN_SPRINT_S)
    cards = []
    for j, player in enumerate(run.players):
        for a, b in _runs_above(speed[:, j] > SPRINT_MPS):
            if b - a + 1 < min_frames:
                continue
            peak = a + int(np.argmax(speed[a : b + 1, j]))
            metrics = {
                "peak_speed_mps": _r(speed[peak, j], 2),
                "duration_s": _r((b - a + 1) * run.dt, 2),
                "distance_m": _r(speed[a : b + 1, j].sum() * run.dt, 1),
            }
            cards.append(
                _card(run, "sprint", player.id, peak, (a, b), metrics=metrics, live_only=True)
            )
    return cards


# --- decision after a scan ---------------------------------------------------------------


def _decision_metrics(
    run: MatchRun, decision: Decision, reception: Event, scans: list[Event]
) -> dict[str, Scalar]:
    chosen = next(o for o in decision.options if o.action == decision.chosen)
    ended = [int(s.attrs["end"]) for s in scans if int(s.attrs["end"]) <= reception.frame]
    since = (reception.frame - max(ended)) * run.dt if ended else 0.0
    metrics: dict[str, Scalar] = {
        "scans_in_window": len(scans),
        "scan_window_s": SCAN_WINDOW_S,
        "time_since_last_scan_at_reception_s": _r(since, 2),
        "time_to_decision_s": _r((decision.frame - reception.frame) * run.dt, 2),
        "chosen": decision.chosen,
        "chosen_prob": _r(chosen.prob),
        "options": len(decision.options),
    }
    if chosen.target_player is not None:
        metrics["belief_error_receiver_m"] = _r(decision.belief_error[chosen.target_player], 2)
        metrics["belief_age_receiver_s"] = _r(decision.belief_age[chosen.target_player], 2)
    return metrics


def detect_decisions_after_scan(run: MatchRun) -> list[MomentCard]:
    receptions = _sorted_events(run, "reception")
    all_scans = _sorted_events(run, "scan")
    cards = []
    for d in run.decisions:
        rec = [
            e for e in receptions
            if e.player == d.player and 0 <= d.frame - e.frame <= _frames(run, MAX_TOUCH_S)
        ]  # fmt: skip
        if not rec:
            continue
        reception = rec[-1]
        lo = reception.frame - _frames(run, SCAN_WINDOW_S)
        scans = [s for s in all_scans if s.player == d.player and lo <= s.frame <= d.frame]
        if not scans:
            continue
        last = max(scans, key=lambda s: (s.frame, s.id))
        if int(last.attrs["end"]) < reception.frame - _frames(run, SCAN_JUST_BEFORE_S):
            continue
        anchors = {"reception": reception.id, "last_scan": last.id}
        events = [reception, *scans]
        end = d.frame + _frames(run, MAX_TOUCH_S)
        action = next(
            (e for e in run.events
             if e.player == d.player and e.frame == d.frame and e.type in ("pass", "shot")),
            None,
        )  # fmt: skip
        if action is not None:
            anchors["action"] = action.id
            events.append(action)
            resolved = _resolution(run, action)
            if resolved:
                anchors[resolved[0]] = resolved[1].id
                events.append(resolved[1])
                end = resolved[1].frame
        receiver = next(o.target_player for o in d.options if o.action == d.chosen)
        start = min(scans[0].frame, d.frame - _frames(run, PRE_ROLL_S))
        cards.append(
            _card(
                run, "decision_after_scan", d.player, d.frame,
                (start, end + _frames(run, POST_ROLL_S)),
                receiver=receiver, anchors=anchors, events=events,
                metrics=_decision_metrics(run, d, reception, scans),
            )
        )  # fmt: skip
    return cards


# --- decision under heavy pressure -------------------------------------------------------


def _team(run: MatchRun) -> np.ndarray:
    return np.array([p.team for p in run.players])


def pressure_on_carrier(run: MatchRun, frame: int) -> float:
    """Pressing intensity on the ball carrier at a frame (SPEC 4.3); 0 while the ball is free."""
    carrier = int(run.owner[frame])
    if carrier < 0:
        return 0.0
    pf = frame_pressing(run.pos[frame], run.vel[frame], _team(run), run.ball_pos[frame], carrier)
    return float(pf.on_carrier)


def detect_pressed_decisions(run: MatchRun) -> list[MomentCard]:
    """Decisions on the ball with pressing intensity on the carrier >= PRESSED_THRESHOLD."""
    receptions = _sorted_events(run, "reception")
    team = _team(run)
    cards = []
    for d in run.decisions:
        i = run.index(d.player)
        if int(run.owner[d.frame]) != i:
            continue
        f = d.frame
        pf = frame_pressing(run.pos[f], run.vel[f], team, run.ball_pos[f], i)
        if pf.on_carrier < PRESSED_THRESHOLD:
            continue
        presser = int(pf.defenders[int(np.argmax(pf.column(i)))])
        anchors, events, end = {}, [], f + _frames(run, MAX_TOUCH_S)
        touch = _frames(run, MAX_TOUCH_S)
        rec = [e for e in receptions if e.player == d.player and 0 <= f - e.frame <= touch]
        if rec:
            anchors["reception"] = rec[-1].id
            events.append(rec[-1])
        action = next(
            (e for e in run.events
             if e.player == d.player and e.frame == f and e.type in ("pass", "shot")),
            None,
        )  # fmt: skip
        if action is not None:
            anchors["action"] = action.id
            events.append(action)
            resolved = _resolution(run, action)
            if resolved:
                anchors[resolved[0]] = resolved[1].id
                events.append(resolved[1])
                end = resolved[1].frame
        chosen = next(o for o in d.options if o.action == d.chosen)
        metrics: dict[str, Scalar] = {
            "pressure_on_carrier": _r(pf.on_carrier),
            "main_presser": run.ids[presser],
            "presser_distance_m": _r(np.linalg.norm(run.pos[f, presser] - run.pos[f, i]), 2),
            "chosen": d.chosen,
            "chosen_prob": _r(chosen.prob),
            "options": len(d.options),
        }
        if rec:
            metrics["time_to_decision_s"] = _r((f - rec[-1].frame) * run.dt, 2)
        cards.append(
            _card(
                run, "pressed_decision", d.player, f,
                (f - _frames(run, PRE_ROLL_S), end + _frames(run, POST_ROLL_S)),
                receiver=chosen.target_player, players=[chosen.target_player, run.ids[presser]],
                anchors=anchors, events=events, metrics=metrics,
            )
        )  # fmt: skip
    return cards


# --- pass to the target of a blind-side alert (M4) -------------------------------------------


def blind_side_alerts(run: MatchRun, params: BlindSideParams = DEFAULT_PARAMS) -> BlindSideAlerts:
    """Blind-side alerts (SPEC 4.4) from the run's tracking: observed head yaw and positions."""
    team = np.array([p.team for p in run.players])
    return detect_alerts(
        run.head_yaw_observed, run.pos, run.vel, run.ball_pos, run.ball_vel, run.owner, team,
        run.dt, params,
    )  # fmt: skip


def detect_blind_side_passes(
    run: MatchRun, alerts: BlindSideAlerts | None = None
) -> list[MomentCard]:
    alerts = alerts if alerts is not None else blind_side_alerts(run)
    within = _frames(run, BLIND_SIDE_PASS_S)
    cards = []
    for action in _sorted_events(run, "pass"):
        o, t = run.index(action.player), run.index(action.attrs["to"])
        hits = [
            a for a in alerts.intervals
            if (a.observer, a.target) == (o, t) and a.start <= action.frame <= a.end + within
        ]  # fmt: skip
        if not hits:
            continue
        alert = max(hits, key=lambda a: a.start)
        cleared = alert.end + 1  # the first frame without the alert
        anchors, events, end = {"action": action.id}, [action], action.frame
        resolved = _resolution(run, action)
        if resolved:
            anchors[resolved[0]] = resolved[1].id
            events.append(resolved[1])
            end = resolved[1].frame
        cards.append(
            _card(
                run, "blind_side_pass", action.player, action.frame,
                (alert.start, end + _frames(run, POST_ROLL_S)),
                receiver=action.attrs["to"], anchors=anchors, events=events,
                metrics={
                    "alert_start_t": _r(alert.start * run.dt),
                    "alert_end_t": _r(cleared * run.dt),
                    "alert_to_pass_s": _r(max(0, action.frame - cleared) * run.dt),
                },
            )
        )  # fmt: skip
    return cards


# --- the marker's look (a hero with no decision on the ball) ---------------------------------


def _sighted(run: MatchRun, observer: int, target: int, frames: range) -> list[bool]:
    """Whether the observer saw the target on each frame (the sim's perception, SPEC 3.4)."""
    speed = np.linalg.norm(run.vel, axis=-1)
    return [
        bool(player_visibility(run.pos[f], run.head_yaw[f], speed[f])[observer, target] >= SEEN)
        for f in frames
    ]


def detect_marker_scans(run: MatchRun) -> list[MomentCard]:
    team = _team(run)
    scans = _sorted_events(run, "scan")
    last = len(run.owner) - 1
    cards = []
    for action in _sorted_events(run, "pass"):
        r, f = run.index(action.attrs["to"]), action.frame
        defend = 1 if team[r] == 1 else -1  # +1: the defenders' own goal is at x = -52.5
        if -defend * run.pos[f, r, 0] < OWN_THIRD_X:
            continue  # not in the defending team's own third
        opp = [j for j in np.flatnonzero(team != team[r]) if run.players[j].role != "GK"]
        d = opp[int(np.argmin(np.linalg.norm(run.pos[f, opp] - run.pos[f, r], axis=1)))]
        if -defend * run.pos[f, d, 0] <= -defend * run.pos[f, r, 0]:
            continue  # not goal-side of him
        lo = f - _frames(run, SCAN_JUST_BEFORE_S)
        for scan in scans:
            if scan.player != run.ids[d] or not lo <= scan.frame <= f:
                continue
            g, end = scan.frame, min(int(scan.attrs["end"]), last)
            unseen_from = g - _frames(run, MARKER_UNSEEN_S)
            marked = float(np.linalg.norm(run.pos[g, d] - run.pos[g, r]))
            if unseen_from < 1 or marked > MARKED_M:
                continue
            if any(_sighted(run, d, r, range(unseen_from, g))):
                continue
            if not any(_sighted(run, d, r, range(g, end + 1))):
                continue
            anchors, events, resolved_at = {"scan": scan.id, "pass": action.id}, [scan, action], f
            resolved = _resolution(run, action)
            if resolved:
                anchors[resolved[0]] = resolved[1].id
                events.append(resolved[1])
                resolved_at = resolved[1].frame
            anchor = resolved_at if resolved else min(int(action.attrs.get("end") or last), last)
            sep = float(np.linalg.norm(run.pos[anchor, d] - run.pos[anchor, r]))
            cards.append(
                _card(
                    run, "marker_scan", run.ids[d], anchor,
                    (min(g, anchor - _frames(run, PRE_ROLL_S)), anchor + _frames(run, POST_ROLL_S)),
                    receiver=run.ids[r], players=[run.ids[r], action.player], anchors=anchors,
                    events=events,
                    metrics={
                        "marker_distance_at_scan_m": _r(marked, 2),
                        "unseen_before_scan_s": MARKER_UNSEEN_S,
                        "scan_to_pass_s": _r((f - g) * run.dt, 2),
                        "separation_at_resolution_m": _r(sep, 2),
                    },
                )
            )  # fmt: skip
    return cards


# --- the keeper's step for a sightline ------------------------------------------------------


def detect_keeper_steps(run: MatchRun) -> list[MomentCard]:
    team = _team(run)
    last = len(run.owner) - 1
    shots = _sorted_events(run, "shot")
    cards = []
    for step in _sorted_events(run, "step"):
        k = run.index(step.player)
        if run.players[k].role != "GK":
            continue
        lo, hi = step.frame, step.frame + _frames(run, STEP_TO_SHOT_S)
        shot = next((e for e in shots if lo <= e.frame <= hi and team[run.index(e.player)]
                     != team[k]), None)  # fmt: skip
        if shot is None:
            continue
        end = min(int(shot.attrs.get("end") or last), last)
        outcome = next((e for e in _sorted_events(run) if e.frame == end
                        and e.type in ("save", "goal", "out")), None)  # fmt: skip
        anchors = {"step": step.id, "shot": shot.id}
        events = [step, shot]
        if outcome is not None:
            anchors["outcome"] = outcome.id
            events.append(outcome)
        card = _card(
            run, "keeper_step", step.player, end,
            (min(step.frame, end - _frames(run, PRE_ROLL_S)), end + _frames(run, POST_ROLL_S)),
            receiver=None, players=[shot.player], anchors=anchors, events=events,
            metrics={
                "step_m": _r(step.attrs["lateral_m"], 2),
                "step_to_shot_s": _r((shot.frame - step.frame) * run.dt, 2),
                "outcome": shot.attrs.get("outcome"),
            },
        )  # fmt: skip
        card.candidate_lenses = ["sight"]
        cards.append(card)
    return cards


# --- all moments -------------------------------------------------------------------------


def _absorb(primary: MomentCard, other: MomentCard) -> None:
    """Merge a lower-priority card about the same action into `primary`."""
    primary.tags = [k for k in PRIORITY if k in {*primary.tags, *other.tags}]
    primary.anchors = {**other.anchors, **primary.anchors}
    primary.metrics = {**other.metrics, **primary.metrics}
    primary.players = list(dict.fromkeys([*primary.players, *other.players]))
    primary.receiver = primary.receiver or other.receiver
    if other.frame_start < primary.frame_start:
        primary.frame_start, primary.t_start = other.frame_start, other.t_start
    if other.frame_end > primary.frame_end:
        primary.frame_end, primary.t_end = other.frame_end, other.t_end
    ids = set(primary.events) | set(other.events)
    primary.events = sorted(ids, key=lambda e: (int(e.rsplit(":", 1)[1]), e))


def detect_moments(run: MatchRun) -> list[MomentCard]:
    """Every moment of a run, one card per action, sorted by anchor frame."""
    cards = detect_pressed_decisions(run) + detect_decisions_after_scan(run)
    cards += detect_line_breaking_passes(run) + detect_sprints(run) + detect_marker_scans(run)
    cards += detect_keeper_steps(run)
    by_action: dict[str, MomentCard] = {}
    merged: list[MomentCard] = []
    for card in sorted(cards, key=lambda c: PRIORITY.index(c.kind)):
        action = card.anchors.get("action")
        if action in by_action:
            _absorb(by_action[action], card)
            continue
        if action is not None:
            by_action[action] = card
        merged.append(card)
    return sorted(merged, key=lambda c: (c.anchor_frame, c.id))


def hero_card(run: MatchRun, cards: list[MomentCard] | dict[str, MomentCard]) -> MomentCard | None:
    """The scenario hero's moment among `cards`: the card on his decision, or, for a hero with no
    decision on the ball, his `marker_scan` or `keeper_step`. None when none was detected."""
    if run.hero is None:
        return None
    pool = [c for c in (cards.values() if isinstance(cards, dict) else cards) if not c.live_only]
    decision = run.hero_decision()
    if decision is not None:
        return next(
            (c for c in pool if (c.actor, c.anchor_frame) == (decision.player, decision.frame)),
            None,
        )
    return next(
        (c for c in pool if c.kind in ("marker_scan", "keeper_step") and c.actor == run.hero), None
    )
