"""Goalkeeper positioning (SPEC 3.2, `sim/keeper.py`): where a keeper stands when no script does.

On the bisector of the ball's angle to his posts, his depth off the goal line following his
defensive line by the published FIFA tracking anchors, inside his penalty area and never past the
ball; and he leaves his spot for a pass only to claim it inside his own area.
"""

import numpy as np
import pytest

from sim import keeper, laws
from sim.config import SimParams
from sim.engine import Simulation

AWAY = -1.0  # the sign of the team that attacks -x: it defends the goal at +52.5
HOME = 1.0  # attacks +x, defends -52.5


def angle_to(point, target):
    d = np.asarray(target, dtype=float) - np.asarray(point, dtype=float)
    return np.arctan2(d[1], d[0])


@pytest.mark.parametrize("ball", [(20.0, 10.0), (35.0, -18.0), (0.0, 0.0), (40.0, 15.0)])
def test_the_keeper_stands_on_the_bisector_of_the_balls_angle_to_his_posts(ball):
    spot = keeper.keeper_spot(np.array(ball), defensive_line=30.0, sign=AWAY)
    posts = [(laws.HALF_LENGTH, laws.GOAL_HALF_WIDTH), (laws.HALF_LENGTH, -laws.GOAL_HALF_WIDTH)]
    a0, a1 = (angle_to(ball, p) for p in posts)
    a_keeper = angle_to(ball, spot)
    # The ray from the ball through the keeper splits the angle between the posts in two.
    assert abs((a_keeper - a0 + np.pi) % (2 * np.pi) - np.pi) == pytest.approx(
        abs((a1 - a_keeper + np.pi) % (2 * np.pi) - np.pi), abs=1e-9
    )


def test_his_depth_follows_his_defensive_line_by_the_fifa_anchors():
    """20.4 m behind the line (World Cup 2022), never closer than 4.8 m to his goal line (the
    Club World Cup 2021 keeper behind a 17.4 m line)."""
    far = np.array([0.0, 0.0])

    def depth(line):
        return laws.HALF_LENGTH - keeper.keeper_spot(far, line, AWAY)[0]

    assert depth(33.5) == pytest.approx(13.1)  # the World Cup 2022 averages: 33.5 - 20.4
    assert depth(17.4) == pytest.approx(4.8)  # the Club World Cup line: on the floor
    assert depth(60.0) == pytest.approx(laws.PENALTY_AREA_DEPTH - keeper.KEEPER_INSIDE)


def test_he_is_never_past_the_ball_and_always_in_his_area():
    near = keeper.keeper_spot(np.array([49.0, 1.0]), defensive_line=12.0, sign=AWAY)
    assert near[0] > 49.0  # between the ball and his goal
    wide = keeper.keeper_spot(np.array([50.0, 33.0]), defensive_line=40.0, sign=AWAY)
    assert laws.in_penalty_area(wide, 1)
    # Near the corner the bisector runs outside the area: he holds its edge, not the bisector.
    corner = keeper.keeper_spot(np.array([44.0, 25.0]), defensive_line=30.0, sign=AWAY)
    assert corner[1] == pytest.approx(laws.PENALTY_AREA_HALF_WIDTH - keeper.KEEPER_INSIDE)
    home = keeper.keeper_spot(np.array([-30.0, 5.0]), defensive_line=30.0, sign=HOME)
    assert laws.in_penalty_area(home, 0) and home[0] < -laws.HALF_LENGTH + 16.5


def test_the_defensive_line_is_his_teams_deepest_outfield_player():
    team = np.array([0, 0, 0, 1, 1, 1])
    roles = ["GK", "CB", "ST", "GK", "CB", "CB"]
    pos = np.array([[-50.0, 0], [-30.0, 0], [10.0, 0], [50.0, 0], [20.0, 0], [35.0, 0]])
    assert keeper.defensive_line(pos, team, roles, 0) == pytest.approx(22.5)  # H CB at -30
    assert keeper.defensive_line(pos, team, roles, 1) == pytest.approx(17.5)  # A CB at 35


def test_engine_keepers_take_their_spot_when_no_script_moves_them():
    sim = Simulation.from_scenario("blind_side_run", 3)
    spots = sim.formation_spots()
    roles = [p.role for p in sim.players]
    for k in (sim.index("H1"), sim.index("A1")):
        t = int(sim.team[k])
        line = keeper.defensive_line(sim.pos, sim.team, roles, t)
        expected = keeper.keeper_spot(sim.ball_pos[:2], line, laws.attack_sign(t))
        np.testing.assert_allclose(spots[k], expected)


def test_a_keeper_never_leaves_his_area_to_chase_a_pass():
    """The away keeper chases the through ball only where he can claim it, in his area."""
    for seed in range(5):
        run = Simulation.from_scenario("possession_play", seed,
                                       params=SimParams(max_duration_s=20.0)).run()  # fmt: skip
        team = np.array([p.team for p in run.players])
        for k, p in enumerate(run.players):
            if p.role == "GK":
                inside = laws.in_penalty_area(run.pos[:, k], int(team[k]))
                assert inside.mean() > 0.95, (seed, p.id)
