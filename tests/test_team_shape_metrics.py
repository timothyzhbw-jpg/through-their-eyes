"""Team-shape metrics from tracking (analytics/team_shape.py, SPEC 3.8), on hand-made frames."""

import numpy as np
import pytest

from analytics import team_shape as ts

KEEPER = np.array([True, False, False, False, False, False, False])


def _frame(points):
    return np.array([points], dtype=float)  # (1, n, 2)


def test_length_width_line_height_of_a_team_attacking_plus_x():
    # Keeper at -50 is left out. Two defenders at -30 and -26, two midfielders at -12 and -8, two
    # forwards at +4 and +8.
    pos = _frame([(-50, 0), (-30, -5), (-26, 20), (-12, 3), (-8, -14), (4, 1), (8, 6)])
    s = ts.shape(pos, KEEPER, attack_sign=1)
    assert s["length"][0] == pytest.approx(38.0)  # -30 to +8
    assert s["width"][0] == pytest.approx(34.0)  # -14 to +20
    assert s["lpw"][0] == pytest.approx(38.0 / 34.0)
    assert s["line_height"][0] == pytest.approx(22.5)  # the deepest outfield player
    assert s["defence_midfield"][0] == pytest.approx(-10.0 - -28.0)
    assert s["midfield_attack"][0] == pytest.approx(6.0 - -10.0)
    assert s["centroid_depth"][0] == pytest.approx(52.5 + np.mean([-30, -26, -12, -8, 4, 8]))


def test_depths_are_measured_from_the_goal_line_the_team_defends_when_it_attacks_minus_x():
    mirrored = _frame([(50, 0), (30, 5), (26, -20), (12, -3), (8, 14), (-4, -1), (-8, -6)])
    s = ts.shape(mirrored, KEEPER, attack_sign=-1)
    assert s["line_height"][0] == pytest.approx(22.5)
    assert s["length"][0] == pytest.approx(38.0)
    assert s["defence_midfield"][0] == pytest.approx(18.0)
    assert s["midfield_attack"][0] == pytest.approx(16.0)


def test_kmeans_lines_split_the_depths_into_the_three_tightest_runs():
    depth = np.array([30.0, 10.0, 11.0, 29.0, 20.0, 9.0, 21.0, 12.0, 19.0, 31.0])
    assert ts.kmeans_lines(depth).tolist() == [2, 0, 0, 2, 1, 0, 1, 0, 1, 2]
    # A 4-4-1-1: the deeper striker joins the midfield line, the front one is a line alone.
    lines = ts.kmeans_lines(np.array([0, 0, 0, 0, 10, 10, 10, 10, 15, 30.0]))
    assert lines.tolist() == [0, 0, 0, 0, 1, 1, 1, 1, 1, 2]


def test_lines_are_found_once_per_possession_spell():
    # One team of a keeper and six outfield players over four frames, two spells. In the first
    # spell the player at index 3 plays in midfield, in the second up front.
    depth_first = [-50, -40, -40, -25, -25, -10, -10]
    depth_second = [-50, -40, -40, -25, -10, -10, -10]
    frames = [depth_first, depth_first, depth_second, depth_second]
    pos = np.array([[(x, 0.0) for x in f] for f in frames])
    s = ts.shape(pos, KEEPER, attack_sign=1, spell=np.array([0, 0, 1, 1]))
    assert s["defence_midfield"].tolist() == [15.0, 15.0, 15.0, 15.0]
    assert s["midfield_attack"].tolist() == [15.0, 15.0, 15.0, 15.0]
    # Each spell's lines come from its own mean depths, not from the other spell's.
    s = ts.shape(pos, KEEPER, attack_sign=1, spell=np.array([0, 0, 0, 0]))
    assert s["midfield_attack"][2] != pytest.approx(15.0)


def test_a_free_ball_belongs_to_the_team_that_last_had_it():
    owner_team = np.array([-1, 0, 0, -1, -1, 1, -1, 0])
    assert ts.possession_by_frame(owner_team).tolist() == [-1, 0, 0, 0, 0, 1, 1, 0]
    assert ts.spells(ts.possession_by_frame(owner_team)).tolist() == [-1, 0, 0, 0, 0, 1, 1, 2]


def test_phases_mark_the_seconds_after_each_change_of_possession_as_transition():
    possession = np.array([-1, 0, 0, 0, 1, 1, 1, 1, 0, 0])
    home = ts.phases(possession, team=0, transition_frames=2).tolist()
    away = ts.phases(possession, team=1, transition_frames=2).tolist()
    a, d, ta, td = ts.ATTACK, ts.DEFENCE, ts.TRANSITION_ATTACK, ts.TRANSITION_DEFENCE
    assert home == ["", a, a, a, td, td, d, d, ta, ta]
    assert away == ["", d, d, d, ta, ta, a, a, td, td]
    # The first possession is not a change: nobody had the ball before it.
    assert ts.phases(np.array([-1, -1, 0, 0]), 0, 5).tolist() == ["", "", a, a]
