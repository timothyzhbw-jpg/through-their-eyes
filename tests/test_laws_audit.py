"""The Laws of the Game audit (SPEC 3.9, `eval/laws.py`) on hand-built runs.

Each run is a few frames of a made-up possession: what the audit must find in it, and how it
tells a breach the referee called from one he did not.
"""

import numpy as np

from eval.laws import audit_run, expected_restart
from sim.model import Event, PlayerInfo
from sim.run import MatchRun

R = 0.11
# Home attacks +x. The away keeper and two defenders; H9 is the home runner, H8 the passer.
PLAYERS = [("H8", "CM"), ("H9", "ST"), ("H1", "GK"), ("A1", "GK"), ("A4", "CB"), ("A5", "CB")]


def make_run(pos, ball, owner, events, scenario="test"):
    infos = [
        PlayerInfo(pid, 0 if pid[0] == "H" else 1, role, int(pid[1:]), 8.0, 3.5, 5.0, 0.5, 0.01)
        for pid, role in PLAYERS
    ]
    pos, ball = np.asarray(pos, dtype=float), np.asarray(ball, dtype=float)
    return MatchRun(
        scenario=scenario,
        seed=0,
        dt=0.04,
        players=infos,
        hero=None,
        pos=pos,
        vel=np.zeros_like(pos),
        body_yaw=np.zeros(pos.shape[:2]),
        head_yaw=np.zeros(pos.shape[:2]),
        head_yaw_observed=np.zeros(pos.shape[:2]),
        ball_pos=ball,
        ball_vel=np.zeros_like(ball),
        owner=np.asarray(owner, dtype=np.int64),
        events=events,
        decisions=[],
    )


def event(etype, frame, player, team, **attrs):
    return Event(f"{etype}:{player}:{frame:04d}", etype, frame, frame * 0.04, player, team, attrs)


def through_ball(runner_x=33.0, extra=()):
    """H8 at (0, 0) plays H9 in behind A4 (31) and A5 (30) at frame 1; H9 receives at frame 4."""
    base = np.array(
        [[0.0, 0.0], [runner_x, -5.0], [-50.0, 0.0], [52.0, 0.0], [31.0, 3.0], [30.0, -3.0]]
    )
    pos = np.repeat(base[None], 6, axis=0)
    ball = np.array([[0.3, 0.0, R], [0.3, 0.0, R], [10.0, -2.0, R], [25.0, -4.0, R],
                     [runner_x, -5.0, R], [runner_x + 0.3, -5.0, R]])  # fmt: skip
    owner = [0, 0, -1, -1, 1, 1]
    events = [
        event("pass", 1, "H8", 0, to="H9", start=[0.3, 0.0], target=[runner_x, -5.0]),
        event("reception", 4, "H9", 0, at=[runner_x, -5.0]),
        *extra,
    ]
    return make_run(pos, ball, owner, events)


def found(audit):
    """Findings other than the line-up (these runs field three a side)."""
    return [f for f in audit.findings if f.kind != "team sheet"]


def kinds(audit):
    return [(f.kind, f.player, f.called) for f in found(audit)]


def test_a_receiver_beyond_the_second_last_defender_commits_an_offside_offence():
    audit = audit_run(through_ball(), "t", "design")
    assert kinds(audit) == [("offside offence", "H9", False)]
    finding = found(audit)[0]
    assert finding.frame == 4 and finding.unpunished
    assert "2.00 m beyond the second-last opponent A4" in finding.detail


def test_level_with_the_second_last_defender_is_onside():
    assert kinds(audit_run(through_ball(runner_x=31.0), "t", "design")) == []


def test_an_offside_whistle_at_the_reception_calls_it():
    whistle = event("offside", 4, "H9", 0, at=[33.0, -5.0])
    audit = audit_run(through_ball(extra=[whistle]), "t", "design")
    assert kinds(audit) == [("offside offence", "H9", True)]
    assert not found(audit)[0].unpunished


def test_a_whistle_without_an_offence_is_a_wrong_call():
    whistle = event("offside", 4, "H9", 0, at=[31.0, -5.0])
    audit = audit_run(through_ball(runner_x=31.0, extra=[whistle]), "t", "design")
    assert kinds(audit) == [("offside called without an offence", "H9", False)]


def test_no_offence_receiving_straight_from_a_corner():
    def offences(restart):
        audit = audit_run(through_ball(), "t", "design", restart=restart)
        return [k for k in kinds(audit) if k[0] == "offside offence"]

    assert offences("corner") == [] and offences("throw_in") == []
    assert offences("free_kick") == [("offside offence", "H9", False)]


def test_an_offside_runner_who_challenges_the_defender_for_the_ball_is_involved():
    run = through_ball()
    run.events[1] = event("interception", 4, "A4", 1, at=[33.0, -5.0])
    run.pos[4, 4] = [33.5, -5.0]  # A4 gets there, H9 is 0.3 m from the ball
    audit = audit_run(run, "t", "design")
    assert kinds(audit) == [("offside offence", "H9", False)]
    assert found(audit)[0].detail.startswith("challenged an opponent")


def test_a_ball_carried_over_the_touchline_is_out_even_if_nobody_called_it():
    pos = np.repeat(
        np.array([[0.0, 33.0], [20, 0], [-50, 0], [52, 0], [31, 3], [30, -3]])[None], 4, 0
    )
    ball = np.array([[0.0, 33.8, R], [0.0, 34.05, R], [0.0, 34.2, R], [0.0, 34.4, R]])
    audit = audit_run(make_run(pos, ball, [0, 0, 0, 0], []), "t", "design")
    out = [f for f in audit.findings if f.kind == "ball out, play on"]
    assert len(out) == 1 and out[0].frame == 2 and out[0].player == "H8"
    assert "carried by H8" in out[0].detail


def test_out_called_with_part_of_the_ball_still_on_the_line_is_early():
    pos = np.repeat(
        np.array([[0.0, 30.0], [20, 0], [-50, 0], [52, 0], [31, 3], [30, -3]])[None], 3, 0
    )
    ball = np.array([[0.0, 33.0, R], [0.0, 33.8, R], [0.0, 34.05, R]])
    out = event("out", 2, "H8", 0, at=[0.0, 34.05])
    audit = audit_run(make_run(pos, ball, [-1, -1, -1], [out]), "t", "design")
    assert kinds(audit) == [("out called before the whole ball crossed", "H8", False)]
    assert expected_restart(make_run(pos, ball, [-1, -1, -1], [out])) == ("throw_in", 1)


def test_a_ball_rolling_in_between_the_posts_called_out_is_a_goal_not_given():
    pos = np.repeat(
        np.array([[40.0, 0.0], [20, 0], [-50, 0], [50, 5], [31, 3], [30, -3]])[None], 3, 0
    )
    ball = np.array([[51.0, 1.0, R], [52.0, 1.0, R], [53.0, 1.0, R]])
    out = event("out", 2, "H8", 0, at=[53.0, 1.0])
    run = make_run(pos, ball, [-1, -1, -1], [out])
    audit = audit_run(run, "t", "design")
    assert kinds(audit) == [("goal not given", None, False)]
    assert expected_restart(run) == ("goal_kick", 1)  # what the sim would award instead


def test_a_save_outside_the_penalty_area_is_handling():
    pos = np.repeat(
        np.array([[20.0, 0.0], [25, 0], [-50, 0], [35.0, 0], [31, 3], [30, -3]])[None], 2, 0
    )
    ball = np.array([[30.0, 0.0, R], [35.0, 0.0, R]])
    save = event("save", 1, "A1", 1, at=[35.0, 0.0])
    audit = audit_run(make_run(pos, ball, [-1, 3], [save]), "t", "design")
    assert kinds(audit) == [("keeper handled outside his area", "A1", False)]
