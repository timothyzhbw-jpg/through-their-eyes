"""Acceptance checks for moment detection and the MomentCard (SPEC 5.1)."""

import json

import numpy as np
import pytest

from explain.cards import MomentCard
from explain.moments import (
    LINE_BREAK_MIN_OPPONENTS,
    SPRINT_SPEED,
    detect_moments,
    smoothed_speed,
)
from sim.counterfactual import drop_scan_counterfactual
from sim.engine import Simulation
from sim.model import Event
from sim.run import MatchRun
from sim.scenarios.base import make_player

SCENARIO = "blind_side_run"


@pytest.fixture(scope="module")
def hero_run():
    return Simulation.from_scenario(SCENARIO, seed=100).run()


@pytest.fixture(scope="module")
def hero_moments(hero_run):
    return detect_moments(hero_run)


def _kind(cards, kind):
    return [c for c in cards if c.kind == kind]


# --- toy runs: one pass from H1 to H2 past a few opponents -------------------------------


def _toy_run(opponents, outcome="complete", frames=30, vel=None):
    """H1 at x=-10 passes to H2 at x=20; opponents: list of (role, x)."""
    players = [make_player("H1", "CM"), make_player("H2", "ST")]
    players += [make_player(f"A{k + 2}", role) for k, (role, _) in enumerate(opponents)]
    start = np.array([[-10.0, 0.0], [20.0, 0.0]] + [[x, 5.0] for _, x in opponents])
    n = len(players)
    pos = np.broadcast_to(start, (frames, n, 2)).copy()
    vel = np.zeros((frames, n, 2)) if vel is None else vel
    owner = np.full(frames, -1)
    owner[:5] = 0
    pass_attrs = {
        "to": "H2", "start": [-10.0, 0.0], "target": [20.0, 0.0], "speed": 15.0,
        "distance": 30.0, "outcome": outcome, "end": 20, "end_at": [20.0, 0.0],
        "receiver": "H2" if outcome == "complete" else None,
    }  # fmt: skip
    events = [Event("pass:H1:0005", "pass", 5, 0.2, "H1", 0, pass_attrs)]
    if outcome == "complete":
        owner[20:] = 1
        events.append(Event("reception:H2:0020", "reception", 20, 0.8, "H2", 0, {}))
    zeros = np.zeros((frames, n))
    return MatchRun(
        scenario="toy", seed=0, dt=0.04, players=players, hero=None, pos=pos, vel=vel,
        body_yaw=zeros, head_yaw=zeros, head_yaw_observed=zeros,
        ball_pos=np.zeros((frames, 3)), ball_vel=np.zeros((frames, 3)), owner=owner,
        events=events, decisions=[],
    )  # fmt: skip


def test_a_completed_pass_past_two_opponents_is_line_breaking():
    assert LINE_BREAK_MIN_OPPONENTS == 2
    cards = _kind(detect_moments(_toy_run([("CB", 0.0), ("CB", 8.0)])), "line_breaking_pass")
    assert len(cards) == 1
    card = cards[0]
    assert card.metrics["opponents_bypassed"] == 2
    assert card.players[:2] == ["H1", "H2"] and set(card.players[2:]) == {"A2", "A3"}
    assert card.anchor_events == ["pass:H1:0005", "reception:H2:0020"]
    assert card.metrics["progression_m"] == pytest.approx(30.0)


@pytest.mark.parametrize(
    "opponents",
    [
        [("CB", 0.0), ("CB", 25.0)],  # only one between start and end
        [("CB", 0.0), ("GK", 8.0)],  # the goalkeeper is not a line
        [("CB", -12.0), ("CB", -11.0)],  # both behind the passer
    ],
)
def test_a_pass_past_fewer_than_two_outfield_opponents_is_not(opponents):
    assert not _kind(detect_moments(_toy_run(opponents)), "line_breaking_pass")


def test_an_intercepted_pass_is_not_line_breaking():
    run = _toy_run([("CB", 0.0), ("CB", 8.0)], outcome="intercepted")
    assert not _kind(detect_moments(run), "line_breaking_pass")


def test_a_short_burst_above_sprint_speed_is_not_a_sprint():
    frames = 60
    vel = np.zeros((frames, 4, 2))
    vel[10:15, 1, 0] = SPRINT_SPEED + 1.0  # 0.2 s: too short
    vel[30:55, 0, 0] = SPRINT_SPEED + 0.5  # 1.0 s
    run = _toy_run([("CB", 0.0), ("CB", 8.0)], frames=frames, vel=vel)
    cards = _kind(detect_moments(run), "sprint")
    assert [c.player for c in cards] == ["H1"]
    assert cards[0].live_only and not cards[0].candidate_lenses
    assert cards[0].metrics["duration_s"] == pytest.approx(1.0, abs=0.2)


def test_smoothed_speed_matches_a_constant_velocity():
    vel = np.zeros((20, 2, 2))
    vel[:, 0] = [3.0, 4.0]
    np.testing.assert_allclose(smoothed_speed(vel)[:, 0], 5.0)
    np.testing.assert_allclose(smoothed_speed(vel)[:, 1], 0.0)


# --- the hero run ------------------------------------------------------------------------


def test_hero_decision_after_scan_is_detected(hero_run, hero_moments):
    decision = hero_run.hero_decision()
    key = hero_run.key_scan()
    cards = _kind(hero_moments, "decision_after_scan")
    assert [c.player for c in cards] == ["H8"]
    card = cards[0]
    assert card.id == f"decision_after_scan:H8:{decision.frame:04d}"
    assert card.decision_frame == decision.frame
    reception = next(e for e in hero_run.events if e.type == "reception" and e.player == "H8")
    assert reception.id in card.anchor_events and key.id in card.anchor_events
    assert card.anchor_events[-1] == f"pass:H8:{decision.frame:04d}"
    assert card.players[:2] == ["H8", "H9"]
    assert card.metrics["scans_before_reception"] >= 1
    assert 0.0 <= card.metrics["time_since_last_scan_at_reception_s"] < 1.0
    assert card.window.frame_start < reception.frame <= decision.frame <= card.window.frame_end
    assert card.window.t_start == pytest.approx(card.window.frame_start * hero_run.dt)


def test_hero_pass_is_line_breaking(hero_run, hero_moments):
    decision = hero_run.hero_decision()
    cards = [c for c in _kind(hero_moments, "line_breaking_pass") if c.player == "H8"]
    assert len(cards) == 1
    assert cards[0].metrics["opponents_bypassed"] >= LINE_BREAK_MIN_OPPONENTS
    assert cards[0].decision_frame == decision.frame


def test_the_runner_sprints(hero_run, hero_moments):
    sprints = _kind(hero_moments, "sprint")
    runner = [c for c in sprints if c.player == "H9"]
    assert runner and all(c.live_only for c in sprints)
    assert runner[0].metrics["peak_speed_mps"] > SPRINT_SPEED


def test_without_the_key_scan_there_is_no_decision_after_scan():
    cf = drop_scan_counterfactual(SCENARIO, 100).counterfactual
    assert cf.hero_decision() is not None
    assert not _kind(detect_moments(cf), "decision_after_scan")


def test_detection_is_deterministic_and_ordered(hero_run, hero_moments):
    again = detect_moments(Simulation.from_scenario(SCENARIO, seed=100).run())
    assert [c.model_dump_json() for c in again] == [c.model_dump_json() for c in hero_moments]
    frames = [c.frame for c in hero_moments]
    assert frames == sorted(frames)
    assert len({c.id for c in hero_moments}) == len(hero_moments)


def test_cards_serialise_to_json_and_back(hero_moments):
    for card in hero_moments:
        text = card.model_dump_json()
        data = json.loads(text)
        assert {"id", "kind", "window", "players", "metrics", "candidate_lenses",
                "anchor_events"} <= data.keys()  # fmt: skip
        assert MomentCard.model_validate_json(text) == card
