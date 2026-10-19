"""Acceptance checks for moment detection and the MomentCard (SPEC 5.1)."""

import json

import numpy as np
import pytest

from explain.cards import MomentCard
from explain.moments import (
    bypassed_opponents,
    detect_decisions_after_scan,
    detect_line_breaking_passes,
    detect_moments,
    detect_sprints,
)
from sim.config import DT
from sim.decision import OptionEval
from sim.engine import Simulation
from sim.model import Decision, Event
from sim.run import MatchRun
from sim.scenarios.base import make_player

SCENARIO = "blind_side_run"


@pytest.fixture(scope="module")
def run3():
    return Simulation.from_scenario(SCENARIO, seed=3).run()


@pytest.fixture(scope="module")
def moments3(run3):
    return detect_moments(run3)


def _hero_card(moments):
    return next(c for c in moments if c.kind == "decision_after_scan")


# --- toy runs ----------------------------------------------------------------------------

TOY = [("H8", "CM", (0.0, 0.0)), ("H9", "ST", (30.0, 0.0)), ("A6", "DM", (10.0, 3.0)),
       ("A5", "CB", (20.0, -2.0)), ("A1", "GK", (45.0, 0.0))]  # fmt: skip


def _toy_run(frames: int = 60, events=(), decisions=(), vel=None) -> MatchRun:
    players = [make_player(pid, role) for pid, role, _ in TOY]
    n = len(players)
    pos = np.tile(np.array([xy for *_, xy in TOY], dtype=float), (frames, 1, 1))
    zeros = np.zeros((frames, n))
    return MatchRun(
        scenario="toy", seed=0, dt=DT, players=players, hero=None, pos=pos,
        vel=np.zeros((frames, n, 2)) if vel is None else vel, body_yaw=zeros, head_yaw=zeros,
        head_yaw_observed=zeros, ball_pos=np.zeros((frames, 3)), ball_vel=np.zeros((frames, 3)),
        owner=np.full(frames, -1), events=list(events), decisions=list(decisions),
    )  # fmt: skip


def _pass(frame: int, end: int, outcome: str = "complete", to_x: float = 30.0) -> Event:
    receiver = "H9" if outcome == "complete" else None
    attrs = {"to": "H9", "start": [0.0, 0.0], "target": [to_x, 0.0], "speed": 15.0,
             "distance": to_x, "outcome": outcome, "end": end, "end_at": [to_x, 0.0],
             "receiver": receiver}  # fmt: skip
    return Event(f"pass:H8:{frame:04d}", "pass", frame, frame * DT, "H8", 0, attrs)


def _event(etype: str, player: str, frame: int, **attrs) -> Event:
    team = 0 if player.startswith("H") else 1
    return Event(f"{etype}:{player}:{frame:04d}", etype, frame, frame * DT, player, team, attrs)


def _decision(frame: int) -> Decision:
    option = OptionEval("pass:H9", "pass", "H9", (30.0, 0.0), 0.8, 0.07, 1.0)
    ids = [pid for pid, *_ in TOY]
    return Decision(frame, "H8", [option], "pass:H9", {"pass:H9": 0.0},
                    dict.fromkeys(ids, 0.0), dict.fromkeys(ids, 0.0))  # fmt: skip


# --- line-breaking pass ------------------------------------------------------------------


def test_a_completed_forward_pass_past_two_opponents_is_line_breaking():
    run = _toy_run(events=[_pass(10, 40), _event("reception", "H9", 40)])
    assert bypassed_opponents(run, run.events[0]) == ["A5", "A6"]
    (card,) = detect_line_breaking_passes(run)
    assert card.kind == "line_breaking_pass"
    assert card.actor == "H8" and card.receiver == "H9"
    assert card.anchors == {"action": "pass:H8:0010", "completion": "reception:H9:0040"}
    assert card.metrics["opponents_bypassed"] == 2


def test_a_defender_who_drops_behind_the_ball_in_time_is_not_bypassed():
    run = _toy_run(events=[_pass(10, 40), _event("reception", "H9", 40)])
    run.pos[25:, 2, 0] = 35.0  # A6 recovers goal-side of the receiver before the ball arrives
    assert bypassed_opponents(run, run.events[0]) == ["A5"]
    assert detect_line_breaking_passes(run) == []


def test_intercepted_and_short_passes_are_not_line_breaking():
    lost = _toy_run(events=[_pass(10, 40, outcome="intercepted")])
    short = _toy_run(events=[_pass(10, 20, to_x=8.0), _event("reception", "H9", 20)])
    assert detect_line_breaking_passes(lost) == []
    assert detect_line_breaking_passes(short) == []


# --- sprint tag --------------------------------------------------------------------------


def test_sprints_are_tagged_for_the_live_overlay_only():
    vel = np.zeros((60, len(TOY), 2))
    vel[5:31, 1, 0] = 8.0  # H9: 26 frames above 7 m/s
    vel[40:43, 1, 0] = 7.5  # a 3-frame spike is not a sprint
    (card,) = detect_sprints(_toy_run(vel=vel))
    assert card.kind == "sprint" and card.live_only
    assert card.actor == "H9" and card.candidate_lenses == []
    assert (card.frame_start, card.frame_end) == (5, 30)
    assert card.metrics["peak_speed_mps"] == pytest.approx(8.0)


# --- decision after a scan ---------------------------------------------------------------


def _decision_run(scan_frame: int | None, reception: int = 30, frames: int = 120) -> MatchRun:
    events = [_event("reception", "H8", reception), _pass(reception + 5, reception + 40)]
    if scan_frame is not None:
        events.append(_event("scan", "H8", scan_frame, end=scan_frame + 8, key=False))
    return _toy_run(frames, events, [_decision(reception + 5)])


def test_a_decision_right_after_a_scan_is_a_moment():
    (card,) = detect_decisions_after_scan(_decision_run(scan_frame=10))
    assert card.kind == "decision_after_scan"
    assert card.anchors["reception"] == "reception:H8:0030"
    assert card.anchors["action"] == "pass:H8:0035"
    assert card.anchors["last_scan"] == "scan:H8:0010"
    assert card.anchor_frame == 35
    assert card.candidate_lenses == ["scan", "space", "pressure"]
    assert card.metrics["time_since_last_scan_at_reception_s"] == pytest.approx(12 * DT)


def test_no_scan_or_a_stale_scan_is_not_a_decision_after_a_scan():
    assert detect_decisions_after_scan(_decision_run(scan_frame=None)) == []
    assert detect_decisions_after_scan(_decision_run(scan_frame=0, reception=100)) == []


# --- the hero run ------------------------------------------------------------------------


def test_the_hero_decision_is_one_moment_with_both_tags(run3, moments3):
    card = _hero_card(moments3)
    decision = run3.hero_decision()
    assert card.actor == "H8" and card.receiver == "H9"
    assert set(card.tags) == {"decision_after_scan", "line_breaking_pass"}
    assert card.anchors["action"] == f"pass:H8:{decision.frame:04d}"
    assert card.anchors["last_scan"] == run3.key_scan().id
    assert card.anchors["reception"].startswith("reception:H8:")
    assert card.anchors["completion"].startswith("reception:H9:")
    assert card.metrics["opponents_bypassed"] >= 2
    assert card.metrics["scans_in_window"] >= 1
    assert card.metrics["chosen"] == "pass:H9"
    # One card per action: no second card for the same pass.
    actions = [c.anchors.get("action") for c in moments3 if c.anchors.get("action")]
    assert len(actions) == len(set(actions))


def test_the_card_window_covers_its_events(run3, moments3):
    card = _hero_card(moments3)
    frames = [run3.event(e).frame for e in card.events]
    assert card.frame_start <= min(frames) and card.frame_end >= max(frames)
    assert card.frame_start <= card.anchor_frame <= card.frame_end
    assert card.t_start == pytest.approx(card.frame_start * DT)
    assert set(card.anchors.values()) <= set(card.events)


def test_the_runner_is_tagged_as_a_sprint(moments3):
    sprints = [c for c in moments3 if c.kind == "sprint"]
    assert any(c.actor == "H9" for c in sprints)
    assert all(c.live_only and c.candidate_lenses == [] for c in sprints)


def test_moment_cards_serialise_to_json_and_back(moments3):
    for card in moments3:
        text = card.model_dump_json()
        assert json.loads(text)["id"] == card.id
        assert MomentCard.model_validate_json(text) == card


def test_detection_is_deterministic_for_a_seed():
    a = detect_moments(Simulation.from_scenario(SCENARIO, seed=7).run())
    b = detect_moments(Simulation.from_scenario(SCENARIO, seed=7).run())
    assert [c.model_dump_json() for c in a] == [c.model_dump_json() for c in b]
    assert len({c.id for c in a}) == len(a)
