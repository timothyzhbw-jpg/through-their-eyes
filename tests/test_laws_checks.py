"""The Laws of the Game checkers (SPEC 3.9, `sim/laws.py`) on hand-built snapshots.

Every snapshot is a few players placed by hand; the home team (0) attacks +x, the away team (1)
attacks -x. Offside edge cases follow IFAB Laws of the Game, Law 11.1-11.3.
"""

import math

import numpy as np
import pytest

from analytics.vision import VisionParams
from analytics.xt import GOAL_X
from sim import config, laws, shots
from sim.ball import BallParams
from sim.config import SimParams
from sim.scenarios import SCENARIOS

R = laws.BALL_RADIUS


def snapshot(home, away):
    """(pos, team) from lists of (x, y): home first, then away."""
    pos = np.array([*home, *away], dtype=float)
    team = np.array([0] * len(home) + [1] * len(away))
    return pos, team


# --- Law 1, 2, 3: the sim's numbers agree with the Laws ------------------------------------------


def test_field_markings_follow_from_the_goal_and_the_law_1_distances():
    assert pytest.approx(7.32) == laws.GOAL_WIDTH
    assert pytest.approx(9.16) == laws.GOAL_AREA_HALF_WIDTH  # 5.5 m out from each post
    assert pytest.approx(20.16) == laws.PENALTY_AREA_HALF_WIDTH  # 16.5 m out from each post
    assert laws.penalty_mark(0) == pytest.approx([-41.5, 0.0])  # 11 m in front of his goal
    assert laws.penalty_mark(1) == pytest.approx([41.5, 0.0])
    # The penalty arc is the part of the 9.15 m circle around the mark outside the area.
    assert laws.PENALTY_ARC_RADIUS > laws.PENALTY_AREA_DEPTH - laws.PENALTY_MARK_DISTANCE


def test_the_sim_and_the_analytics_use_the_law_1_pitch_and_goal():
    assert (config.HALF_LENGTH, config.HALF_WIDTH) == (laws.HALF_LENGTH, laws.HALF_WIDTH)
    assert shots.GOAL_HALF_WIDTH == laws.GOAL_HALF_WIDTH
    assert GOAL_X == laws.HALF_LENGTH
    assert 100.0 <= laws.PITCH_LENGTH <= 110.0 and 64.0 <= laws.PITCH_WIDTH <= 75.0


def test_the_ball_is_a_law_2_ball():
    lo, hi = laws.BALL_RADIUS_RANGE
    assert lo == pytest.approx(0.68 / (2 * math.pi)) and hi == pytest.approx(0.70 / (2 * math.pi))
    assert lo <= BallParams().radius <= hi
    assert BallParams().radius == laws.BALL_RADIUS


def test_the_laws_reuse_the_sims_body_and_control_radius():
    assert VisionParams().body_radius == laws.BODY_RADIUS
    assert SimParams().control_radius == laws.CHALLENGE_RADIUS


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_every_scenario_fields_eleven_a_side_with_one_keeper(name):
    setup = SCENARIOS[name]().setup(np.random.default_rng(0))
    teams = [p.team for p in setup.players]
    roles = [p.role for p in setup.players]
    assert laws.team_sheet_breaches(teams, roles) == []


def test_a_team_sheet_with_two_keepers_or_ten_players_breaks_law_3():
    teams, roles = [0] * 11 + [1] * 10, ["GK", "GK", *["CB"] * 9, "GK", *["CB"] * 9]
    assert laws.team_sheet_breaches(teams, roles) == [
        "team 0 has 2 goalkeepers",
        "team 1 has 10 players",
    ]


def test_areas_include_their_lines():
    # The away team defends +x.
    assert laws.in_penalty_area([36.0, 20.16], 1)
    assert not laws.in_penalty_area([35.99, 0.0], 1)
    assert not laws.in_penalty_area([40.0, 20.17], 1)
    assert not laws.in_penalty_area([40.0, 0.0], 0)  # the other end
    assert laws.in_penalty_area([-36.0, -20.0], 0)
    assert laws.in_goal_area([47.0, 9.16], 1) and not laws.in_goal_area([46.99, 0.0], 1)
    assert laws.in_corner_area([-52.0, 33.5]) and not laws.in_corner_area([-51.0, 33.0])
    assert not laws.in_corner_area([-52.6, 33.9])  # off the field


# --- Law 9: out only when the whole ball has crossed ---------------------------------------------


@pytest.mark.parametrize(
    "ball, line",
    [
        ((52.5, 0.0, R), None),  # centre on the outer edge of the goal line: in play
        ((52.5 + R, 0.0, R), None),  # the far edge just touching the line: still in play
        ((52.5 + R + 1e-3, 0.0, R), "goal_line"),
        ((0.0, 34.0 + 0.05, R), None),  # half the ball over the touchline: in play
        ((0.0, -(34.0 + R + 1e-3), R), "touchline"),
        ((-60.0, 40.0, R), "goal_line"),  # beyond both lines
        ((10.0, 0.0, 3.0), None),  # in the air over the field
    ],
)
def test_the_ball_is_out_only_when_the_whole_ball_has_crossed_a_line(ball, line):
    assert laws.ball_out(np.array(ball)) == line


# --- Law 10: a goal only when the whole ball crosses between the posts and under the bar ---------


@pytest.mark.parametrize(
    "y, z, verdict",
    [
        (0.0, R, "goal"),
        (3.66 - R - 0.01, R, "goal"),  # the ball's edge 1 cm inside the post
        (3.60, R, "post"),  # its outer part would hit the post
        (-3.70, R, "post"),
        (3.66 + 0.12 + R + 0.01, R, "wide"),  # 1 cm clear of the outside of the post
        (0.0, 2.44 - R, "goal"),  # just under the bar
        (0.0, 2.40, "post"),  # into the bar
        (0.0, 2.44 + 0.12 + R + 0.01, "over"),
    ],
)
def test_whole_ball_goal_line_crossings_are_goal_post_wide_or_over(y, z, verdict):
    crossing = laws.goal_line_crossing(np.array([52.0, y, z]), np.array([53.0, y, z]))
    assert crossing is not None and crossing.end == 1
    assert crossing.verdict == verdict
    assert crossing.fraction == pytest.approx((52.5 + R - 52.0) / 1.0)


def test_a_ball_that_passed_inside_the_posts_is_a_goal_wherever_it_ends():
    # Angled outward: inside the posts as it passes them, past 3.55 m once wholly over.
    a, b = np.array([51.94, 3.10, R]), np.array([53.04, 3.87, R])
    crossing = laws.goal_line_crossing(a, b)
    assert crossing.verdict == "goal" and crossing.y > 3.66 - R and crossing.y_posts < 3.55


def test_a_ball_rolling_along_the_goal_line_meets_the_post_from_outside():
    a, b = np.array([52.7, 6.0, R]), np.array([52.62, 0.0, R])  # beyond the line, toward goal
    assert laws.goal_line_crossing(a, b) is None  # it never crosses the line from the field
    a, b = np.array([52.3, 6.0, R]), np.array([52.9, 0.0, R])
    assert laws.goal_line_crossing(a, b).verdict == "post"


def test_the_posts_stand_on_the_goal_line_with_their_inner_edges_7_32_m_apart():
    assert laws.POSTS.shape == (4, 2)
    inner = 2 * (laws.POST_Y - laws.POST_RADIUS)
    assert inner == pytest.approx(7.32)
    assert pytest.approx(laws.HALF_LENGTH) == laws.POST_X + laws.POST_RADIUS


def test_a_ball_half_over_the_goal_line_has_not_crossed_it():
    assert laws.goal_line_crossing(np.array([52.0, 0.0, R]), np.array([52.55, 0.0, R])) is None
    crossing = laws.goal_line_crossing(np.array([-52.0, 1.0, R]), np.array([-53.0, 1.0, R]))
    assert crossing is not None and crossing.end == -1 and crossing.verdict == "goal"


def test_a_crossing_is_read_where_the_path_crosses_the_line():
    # Diagonal: the centre crosses x = 52.61 at y = 3.0, inside the posts.
    a, b = np.array([52.11, 2.5, R]), np.array([53.11, 3.5, R])
    crossing = laws.goal_line_crossing(a, b)
    assert crossing.y == pytest.approx(3.0) and crossing.verdict == "goal"


# --- Law 11: offside position --------------------------------------------------------------------

# A base snapshot: home attacks +x. Away keeper on his line, away back line at x = 30.
AWAY_DEEP = [(52.0, 0.0), (30.0, -5.0), (30.0, 5.0), (25.0, 0.0)]


def offside(attacker, ball=(0.0, 0.0), away=AWAY_DEEP, kicker=None):
    pos, team = snapshot([attacker, ball], away)  # the passer stands on the ball
    return bool(laws.offside_positions(pos, team, np.array(ball), 0, kicker=1)[0])


def test_beyond_the_second_last_opponent_in_his_half_and_ahead_of_the_ball_is_offside():
    assert offside((31.0, 0.0))


def test_level_with_the_second_last_opponent_is_onside():
    assert not offside((30.0, 2.0))
    assert not offside((30.0 + 0.0009, 2.0))  # within the 1 mm resolution
    assert offside((30.0 + 0.002, 2.0))


def test_level_with_the_last_two_opponents_is_onside():
    away = [(40.0, 0.0), (40.0, 6.0), (20.0, 0.0)]
    assert not offside((40.0, -3.0), away=away)
    assert offside((40.01, -3.0), away=away)


def test_in_his_own_half_he_is_never_offside():
    # The away line has pushed into the home half: the halfway line is the offside line.
    away = [(52.0, 0.0), (-10.0, -5.0), (-10.0, 5.0)]
    assert not offside((-1.0, 0.0), ball=(-20.0, 0.0), away=away)
    assert not offside((0.0, 0.0), ball=(-20.0, 0.0), away=away)  # on the halfway line
    assert offside((0.5, 0.0), ball=(-20.0, 0.0), away=away)


def test_behind_or_level_with_the_ball_he_is_onside():
    assert not offside((31.0, 0.0), ball=(33.0, 0.0))  # the ball is nearer the goal line
    assert not offside((31.0, 0.0), ball=(31.0, 4.0))  # level with the ball
    assert offside((31.0, 0.0), ball=(30.5, 4.0))


def test_the_keeper_need_not_be_one_of_the_last_two():
    # The keeper has come out to x = 30; the last two are outfield players at 50 and 45.
    away = [(30.0, 0.0), (50.0, 0.0), (45.0, 3.0), (20.0, 0.0)]
    assert not offside((44.0, -3.0), away=away)
    assert offside((46.0, -3.0), away=away)


def test_off_the_field_players_count_as_on_the_line():
    # Two defenders on their goal line; an attacker behind it counts as on it: level, onside.
    away = [(52.5, 1.0), (52.5, -1.0), (30.0, 0.0)]
    assert not offside((53.5, 0.0), away=away)
    # A defender who has drifted behind his goal line counts as on it.
    away = [(54.0, 0.0), (51.0, 2.0), (30.0, 0.0)]
    assert offside((52.0, -2.0), away=away)  # beyond the second-last (51), whatever the keeper
    assert not offside((51.0, -2.0), away=away)


def test_the_away_team_attacking_minus_x_is_mirrored():
    home = [(-52.0, 0.0), (-30.0, 5.0), (-30.0, -5.0)]
    pos, team = snapshot(home, [(-31.0, 0.0), (-30.0, 2.0), (0.0, 0.0)])
    flags = laws.offside_positions(pos, team, np.array([0.0, 0.0]), 1, kicker=5)
    assert flags.tolist() == [False, False, False, True, False, False]
    margins = laws.offside_margins(pos, team, np.array([0.0, 0.0]), 1)
    assert margins[3] == pytest.approx(1.0) and margins[4] == pytest.approx(0.0)
    assert np.isneginf(margins[:3]).all()


def test_the_player_playing_the_ball_is_never_offside():
    pos, team = snapshot([(35.0, 0.0)], AWAY_DEEP)
    assert not laws.offside_positions(pos, team, np.array([35.0, 0.3]), 0, kicker=0)[0]


def test_second_last_depth_counts_toward_the_attacked_goal():
    pos, team = snapshot([(0.0, 0.0)], AWAY_DEEP)
    assert laws.second_last_depth(pos, team, 0) == pytest.approx(30.0)
    pos, team = snapshot([(-52.0, 0.0), (-20.0, 0.0), (-35.0, 0.0)], [(0.0, 0.0)])
    assert laws.second_last_depth(pos, team, 1) == pytest.approx(35.0)


# --- Law 11: offside offence ---------------------------------------------------------------------


def test_an_offside_position_is_an_offence_only_when_he_becomes_involved():
    assert laws.offside_offence(True) is None
    assert laws.offside_offence(True, played_ball=True) == "played the ball"
    assert laws.offside_offence(True, challenged=True) == "challenged an opponent"
    assert laws.offside_offence(True, blocked_view=True) == "blocked the keeper's view"
    assert laws.offside_offence(False, played_ball=True) is None


@pytest.mark.parametrize("restart", ["goal_kick", "throw_in", "corner"])
def test_receiving_directly_from_a_goal_kick_throw_in_or_corner_is_no_offence(restart):
    assert laws.offside_offence(True, restart=restart, played_ball=True) is None


@pytest.mark.parametrize("restart", ["free_kick", "kick_off", None])
def test_receiving_directly_from_a_free_kick_can_be_offside(restart):
    assert laws.offside_offence(True, restart=restart, played_ball=True) == "played the ball"


def test_a_player_between_the_keeper_and_the_ball_obstructs_his_view():
    keeper, ball = np.array([52.0, 0.0]), np.array([36.0, 2.0])
    assert laws.obstructs_view(keeper, ball, np.array([48.0, 0.5]))
    assert not laws.obstructs_view(keeper, ball, np.array([48.0, 1.0]))  # 0.5 m off the line
    assert not laws.obstructs_view(keeper, ball, np.array([53.0, 0.0]))  # behind the keeper
    assert not laws.obstructs_view(keeper, ball, np.array([34.0, 2.2]))  # beyond the ball


# --- Law 12 --------------------------------------------------------------------------------------


def test_a_keeper_handles_only_inside_his_own_penalty_area():
    assert laws.keeper_may_handle([50.0, 3.0], 1)
    assert laws.keeper_may_handle([36.0, -20.16], 1)
    assert not laws.keeper_may_handle([35.5, 0.0], 1)
    assert not laws.keeper_may_handle([53.0, 0.0], 1)  # behind his goal line: off the field
    assert not laws.keeper_may_handle([-50.0, 0.0], 1)


def test_a_tackle_is_ball_first_when_the_tackler_is_nearer_the_ball_than_the_man():
    carrier, ball = np.array([0.0, 0.0]), np.array([0.3, 0.0])  # the ball 0.3 m ahead of him
    assert laws.ball_first(np.array([1.0, 0.2]), carrier, ball)  # from the front
    assert laws.ball_first(np.array([0.3, 0.9]), carrier, ball)  # from the side, on the ball
    assert not laws.ball_first(np.array([-0.6, 0.0]), carrier, ball)  # through him from behind


# --- Laws 8 and 13-17: restarts ------------------------------------------------------------------


def rules(breaches):
    return sorted((b.law, b.rule, b.player) for b in breaches)


def test_kick_off_everyone_in_his_half_and_opponents_outside_the_circle():
    pos, team = snapshot(
        [(0.0, 0.0), (-5.0, 3.0), (1.0, 20.0)], [(9.2, 0.0), (8.0, 4.0), (-1.0, 30.0)]
    )
    found = laws.restart_breaches("kick_off", np.array([0.0, 0.0]), pos, team, 0)
    assert rules(found) == [
        ("8.1", "every player in his own half", 2),
        ("8.1", "every player in his own half", 5),
        ("8.1", "opponents 9.15 m from the ball", 4),
    ]
    found = laws.restart_breaches("kick_off", np.array([2.0, 0.0]), pos, team, 0)
    assert ("8.1", "ball on the centre mark", None) in rules(found)


def test_corner_from_the_arc_with_opponents_9_15_m_from_the_arc():
    corner = np.array([-52.5, 34.0])
    pos, team = snapshot([(-46.0, 28.0), (-51.0, 23.9)], [(-52.0, 33.5), (-49.0, 25.0)])
    found = laws.restart_breaches("corner", np.array([-52.2, 33.6]), pos, team, 2)
    # H1 is 8.8 m from the corner, 7.8 m from the arc: too close; H2 is 9.2 m from the arc.
    assert rules(found) == [("17.2", "opponents 9.15 m from the corner arc", 0)]
    assert found[0].value == pytest.approx(np.hypot(6.5, 6.0) - 1.0)
    off_arc = laws.restart_breaches("corner", corner + [2.0, -1.0], pos[1:], team[1:], 1)
    assert ("17.2", "ball in the corner area", None) in rules(off_arc)


def test_throw_in_from_where_the_ball_left_with_opponents_2_m_off():
    pos, team = snapshot([(10.0, 33.9)], [(11.5, 33.0), (10.0, 31.0)])
    found = laws.restart_breaches("throw_in", np.array([10.0, 34.0]), pos, team, 0,
                                  out_at=np.array([10.4, 34.2]))  # fmt: skip
    assert rules(found) == [("15.2", "opponents 2 m from the throw", 1)]
    found = laws.restart_breaches("throw_in", np.array([14.0, 34.0]), pos, team, 0,
                                  out_at=np.array([10.4, 34.2]))  # fmt: skip
    assert ("15.2", "thrown from where the ball left the field", None) in rules(found)


def test_goal_kick_from_the_goal_area_with_opponents_outside_the_penalty_area():
    pos, team = snapshot([(-50.0, 2.0)], [(-38.0, 5.0), (-30.0, 0.0)])
    found = laws.restart_breaches("goal_kick", np.array([-48.0, 4.0]), pos, team, 0)
    assert rules(found) == [("16.2", "opponents outside the penalty area", 1)]
    found = laws.restart_breaches("goal_kick", np.array([-45.0, 4.0]), pos, team, 0)
    assert ("16.2", "ball in the goal area", None) in rules(found)


def test_free_kick_opponents_9_15_m_unless_on_their_goal_line_between_the_posts():
    pos, team = snapshot([(46.0, 0.0)], [(52.5, 1.0), (52.5, 5.0), (40.0, 0.0)])
    found = laws.restart_breaches("free_kick", np.array([46.0, 0.0]), pos, team, 0)
    # A1 stands on his line between the posts; A2 is on the line outside them, 7.8 m away.
    assert rules(found) == [
        ("13.2", "opponents 9.15 m from the ball", 2),
        ("13.2", "opponents 9.15 m from the ball", 3),
    ]


def test_a_free_kick_in_his_own_area_keeps_opponents_out_of_it():
    pos, team = snapshot([(-48.0, 0.0)], [(-30.0, 0.0), (-37.0, 15.0)])
    found = laws.restart_breaches("free_kick", np.array([-48.0, 0.0]), pos, team, 0)
    assert rules(found) == [("13.2", "opponents outside the penalty area", 2)]


def test_an_unknown_restart_is_refused():
    pos, team = snapshot([(0.0, 0.0)], [(10.0, 0.0)])
    with pytest.raises(ValueError):
        laws.restart_breaches("penalty", np.zeros(2), pos, team, 0)
