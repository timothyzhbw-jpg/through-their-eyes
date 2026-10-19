"""Moment detection (SPEC 5.1): rule-based detectors over a finished `MatchRun`.

- `line_breaking_pass`: a completed pass that takes the ball past at least two outfield opponents,
  each goal-side of the ball when it is played and behind it when it is received.
- `decision_after_scan`: a reception followed by a decision of the receiver, with a scan of his
  ending at most `SCAN_JUST_BEFORE_S` before the reception (or during the first touch).
- `sprint`: speed above 7.0 m/s (SPEC 4.6) for at least `MIN_SPRINT_S`; a live overlay tag only.

Cards that describe the same action (anchor "action", e.g. the hero's pass) are merged into one
card: the primary kind is the first in `PRIORITY`, `tags` lists every detector that fired. Goal,
big chance and counter-press detectors need shots and turnovers the sim does not produce yet (M4).
"""

from __future__ import annotations

import numpy as np

from analytics.xt import xt_for
from explain.cards import LensName, MomentCard, MomentKind, Scalar
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
PRIORITY: tuple[MomentKind, ...] = ("decision_after_scan", "line_breaking_pass", "sprint")
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
    cards = detect_decisions_after_scan(run) + detect_line_breaking_passes(run)
    cards += detect_sprints(run)
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
