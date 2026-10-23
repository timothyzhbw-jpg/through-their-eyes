"""Formation-based team shape (sim/team_shape.py, SPEC 3.2), behind `Scenario.team_shape`.

The geometry is checked on `spots` directly; the behaviour on possession_play runs, measured from
tracking only (analytics/team_shape.py). How the measured shape compares with published values is
the realism report's job (eval/realism.py, team shape), not these tests'.
"""

from dataclasses import replace

import numpy as np
import pytest

from analytics import team_shape as metrics
from sim import team_shape as ts
from sim.config import DT, HALF_LENGTH, HALF_WIDTH, SimParams
from sim.engine import Simulation
from sim.scenarios import SCENARIOS
from sim.scenarios.possession_play import SLOTS

LONG = replace(SimParams(), max_duration_s=45.0)
SEEDS = range(100, 106)
WARM_UP = round(5.0 / DT)  # the first seconds, while the players settle from their setup spots
TRANSITION = round(5.0 / DT)


@pytest.fixture(scope="module")
def form() -> ts.Formation:
    sim = Simulation.from_scenario("possession_play", 0)
    return sim.formation


def _team(form, t):
    return form.team == t


def _named(form, team, name):
    slots = ts.FORMATIONS[("4-3-3", "4-2-3-1")[team]]
    return [i for i, s in enumerate(form.slots) if form.team[i] == team and s is slots[name]]


# --- geometry -----------------------------------------------------------------------------


def test_only_possession_play_keeps_a_team_shape():
    on = sorted(name for name, cls in SCENARIOS.items() if cls.team_shape)
    # Heroes and open_play (the xT fit) keep their runs; the away variant is the same open play
    # with the away team on the first ball (SPEC 3.1).
    assert on == ["possession_play", "possession_play_away"]
    assert set(SLOTS.values()) <= set(ts.FORMATIONS["4-3-3"]) | set(ts.FORMATIONS["4-2-3-1"])


def test_the_defending_back_four_is_one_line_that_steps_up_and_drops_with_the_ball(form):
    d = ts.SHAPE.defence
    # Out of possession the line is Castellano & Alvarez's (2013) regression on the ball.
    assert (d.line_at_goal, d.line_slope) == (6.30, 0.46)
    defenders = [i for i, s in enumerate(form.slots) if form.team[i] == 1 and s.line == "defence"]
    depths = []
    for ball_x in (-40.0, -20.0, 0.0, 20.0, 40.0):  # home on the ball; away defends +x
        p = ts.spots(form, np.array([ball_x, 0.0]), possession=0)
        depth = HALF_LENGTH - p[defenders, 0]
        assert np.ptp(depth) < 1e-9  # one line
        ball_depth = HALF_LENGTH - ball_x
        line = d.line_at_goal + d.line_slope * ball_depth
        assert depth[0] == pytest.approx(np.clip(line, d.line_min, d.line_max))
        depths.append(depth[0])
    # As the ball comes toward the away goal the line drops; as it goes away it steps up.
    assert np.all(np.diff(depths) <= 1e-9) and depths[0] > depths[-1]


def test_in_possession_the_full_backs_push_on_and_the_line_steps_up(form):
    ball = np.array([10.0, 0.0])
    attack = ts.spots(form, ball, possession=0)
    defend = ts.spots(form, ball, possession=1)
    rb, rcb = _named(form, 0, "RB")[0], _named(form, 0, "RCB")[0]
    assert attack[rb, 0] > attack[rcb, 0] + 5.0
    assert defend[rb, 0] == pytest.approx(defend[rcb, 0])


def test_out_of_possession_the_far_side_wide_player_tucks_in(form):
    ball = np.array([0.0, -25.0])  # on the home team's right
    p = ts.spots(form, ball, possession=1)  # home defends
    near, far = _named(form, 0, "RW")[0], _named(form, 0, "LW")[0]
    centre = ts.SHAPE.defence.shift * ball[1]
    assert abs(p[far, 1] - centre) < abs(p[near, 1] - centre) * 0.6
    attacking = ts.spots(form, ball, possession=0)  # in possession both stay wide
    a = ts.SHAPE.attack
    room = HALF_WIDTH - a.width / 2.0 - ts.SHAPE.margin
    centre = (attacking[far, 1] + attacking[near, 1]) / 2.0
    assert centre == pytest.approx(np.clip(a.shift * ball[1], -room, room))


def test_the_defending_block_is_shorter_and_narrower_and_shifts_to_the_ball(form):
    for ball in (np.array([0.0, 0.0]), np.array([0.0, 20.0]), np.array([-30.0, -30.0])):
        p = ts.spots(form, ball, possession=0)
        for t in (0, 1):
            out = _team(form, t) & np.array([s.line != "keeper" for s in form.slots])
            assert np.all(np.abs(p[out, 1]) <= HALF_WIDTH - ts.SHAPE.margin + 1e-9)
        away = _team(form, 1) & np.array([s.line != "keeper" for s in form.slots])
        home = _team(form, 0) & np.array([s.line != "keeper" for s in form.slots])
        assert np.ptp(p[away, 1]) < np.ptp(p[home, 1])
        if ball[1] != 0:  # the defending block's centre moves toward the ball's side
            assert np.sign(p[away, 1].mean()) == np.sign(ball[1])


def test_no_slot_is_beyond_the_opponents_back_line_unless_the_ball_is(form):
    for ball_x in np.linspace(-45.0, 45.0, 19):
        ball = np.array([ball_x, 5.0])
        p = ts.spots(form, ball, possession=0)
        away_line = p[[i for i, s in enumerate(form.slots) if form.team[i] == 1
                       and s.line == "defence"], 0].max()  # fmt: skip
        home = _team(form, 0)
        assert p[home, 0].max() <= max(away_line, ball_x) + ts.MIN_LENGTH + 1e-9


def test_the_keeper_stands_on_the_bisector_of_the_balls_angle_to_his_posts_inside_his_area(form):
    """`sim.keeper` places him (SPEC 3.2): the ray from the ball through him splits the angle
    between his posts, unless his spot is clipped to the area's side."""
    keeper = _named(form, 0, "GK")[0]
    posts = [np.array([-HALF_LENGTH, 3.66]), np.array([-HALF_LENGTH, -3.66])]
    for ball in (np.array([0.0, 0.0]), np.array([-30.0, 25.0]), np.array([-50.0, -30.0])):
        for possession in (0, 1):
            spot = ts.spots(form, ball, possession)[keeper]
            depth, y = spot[0] + HALF_LENGTH, spot[1]
            assert 0.0 < depth <= ts.PENALTY_DEPTH - ts.KEEPER_INSIDE + 1e-9
            assert abs(y) <= ts.PENALTY_HALF_WIDTH - ts.KEEPER_INSIDE + 1e-9
            if abs(y) == pytest.approx(ts.PENALTY_HALF_WIDTH - ts.KEEPER_INSIDE):
                continue
            a0, a1 = (np.arctan2(*(p - ball)[::-1]) for p in posts)
            a = np.arctan2(*(spot - ball)[::-1])

            def wrap(d):
                return abs((d + np.pi) % (2 * np.pi) - np.pi)

            assert wrap(a - a0) == pytest.approx(wrap(a1 - a), abs=1e-9)


# --- runs ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def runs():
    return [Simulation.from_scenario("possession_play", s, params=LONG).run() for s in SEEDS]


def _measured(run):
    """Per team: shape series, phase per frame, and the ball."""
    team = np.array([p.team for p in run.players])
    keeper = np.array([p.role == "GK" for p in run.players])
    owner_team = np.where(run.owner >= 0, team[np.maximum(run.owner, 0)], -1)
    possession = metrics.possession_by_frame(owner_team)
    out = []
    for t, sign in ((0, 1), (1, -1)):
        mine = team == t
        s = metrics.shape(run.pos[:, mine], keeper[mine], sign, metrics.spells(possession))
        phase = metrics.phases(possession, t, TRANSITION)
        phase[:WARM_UP] = ""
        out.append((s, phase, sign))
    return out


def test_same_seed_twice_is_byte_identical_with_team_shape():
    a = Simulation.from_scenario("possession_play", 7).run().to_bytes()
    assert a == Simulation.from_scenario("possession_play", 7).run().to_bytes()


def test_speed_and_acceleration_limits_hold_with_team_shape(runs):
    for run in runs:
        speed = np.linalg.norm(run.vel, axis=-1)
        assert np.all(speed <= np.array([p.v_max for p in run.players]) + 1e-9)
        acc = np.linalg.norm(np.diff(run.vel, axis=0), axis=-1) / run.dt
        assert np.all(acc <= np.array([p.d_max for p in run.players]) + 1e-6)
        up = np.diff(speed, axis=0) > 1e-9
        a_max = np.broadcast_to(np.array([p.a_max for p in run.players]), acc.shape)
        assert np.all(acc[up] <= a_max[up] + 1e-6)


def test_keepers_stay_in_their_penalty_area(runs):
    # Their targets never leave it; a keeper running out when his spot moves back can carry on
    # past it for up to his stopping distance, as a real one steps out of his area.
    overshoot = 1.0  # m
    for run in runs:
        for i, p in enumerate(run.players):
            if p.role != "GK":
                continue
            sign = 1 if p.team == 0 else -1
            depth = HALF_LENGTH + sign * run.pos[:, i, 0]
            assert depth.min() >= -0.3 and depth.max() <= ts.PENALTY_DEPTH + overshoot
            assert np.abs(run.pos[:, i, 1]).max() <= ts.PENALTY_HALF_WIDTH + overshoot


def test_a_team_is_shorter_and_narrower_out_of_possession_than_in_it(runs):
    pooled = {metrics.ATTACK: {"length": [], "width": []},
              metrics.DEFENCE: {"length": [], "width": []}}  # fmt: skip
    for run in runs:
        for s, phase, _ in _measured(run):
            for ph, values in pooled.items():
                for k in values:
                    values[k].append(s[k][phase == ph])
    mean = {ph: {k: np.concatenate(v).mean() for k, v in d.items()} for ph, d in pooled.items()}
    # Castellano et al. (2013, Table 1): 1.7-3.3 m shorter and 4.5-4.8 m narrower without the ball.
    assert mean[metrics.DEFENCE]["length"] < mean[metrics.ATTACK]["length"] - 2.0
    assert mean[metrics.DEFENCE]["width"] < mean[metrics.ATTACK]["width"] - 2.0


def test_the_defending_block_follows_the_ball_across_and_along_the_pitch(runs):
    left, right, near, far = [], [], [], []
    for run in runs:
        for s, phase, sign in _measured(run):
            defending = phase == metrics.DEFENCE
            # The block slides to the ball's side (it follows the ball smoothed over a second).
            left.append(s["centroid_y"][defending & (run.ball_pos[:, 1] > 12.0)])
            right.append(s["centroid_y"][defending & (run.ball_pos[:, 1] < -12.0)])
            # Ball depth from the defending team's goal line: near its goal, or far from it.
            ball_depth = HALF_LENGTH + sign * run.ball_pos[:, 0]
            near.append(s["line_height"][defending & (ball_depth < 45.0)])
            far.append(s["line_height"][defending & (ball_depth > 65.0)])
    left, right = np.concatenate(left), np.concatenate(right)
    assert left.size > 100 and right.size > 100
    assert left.mean() > right.mean() + 6.0
    # The line drops as the ball comes toward its goal.
    near, far = np.concatenate(near), np.concatenate(far)
    assert near.size > 100 and far.size > 100
    assert near.mean() < far.mean() - 5.0


def test_full_backs_play_higher_than_centre_backs_in_possession(runs):
    gaps = []
    for run in runs:
        for t, sign in ((0, 1), (1, -1)):
            fb = [i for i, p in enumerate(run.players) if p.team == t and p.role == "FB"]
            cb = [i for i, p in enumerate(run.players) if p.team == t and p.role == "CB"]
            team = np.array([p.team for p in run.players])
            owner_team = np.where(run.owner >= 0, team[np.maximum(run.owner, 0)], -1)
            phase = metrics.phases(metrics.possession_by_frame(owner_team), t, TRANSITION)
            on = (phase == metrics.ATTACK) & (np.arange(len(phase)) >= WARM_UP)
            if on.sum() < round(5.0 / DT):
                continue
            depth = HALF_LENGTH + sign * run.pos[on, :, 0]
            gaps.append(depth[:, fb].mean() - depth[:, cb].mean())
    assert np.mean(gaps) > 5.0


def test_the_away_team_can_have_the_first_ball_with_the_same_draws():
    """`start_team` (for restarts the Laws award to the away team): the mirrored build-up player
    has the ball and the away team starts in its attacking shape."""
    from sim.scenarios.possession_play import PossessionPlay

    home = Simulation.from_scenario("possession_play", 5)
    scenario = PossessionPlay()
    scenario.start_team = 1
    away = Simulation(scenario, 5)
    first = home.ids[home.owner]
    assert first in ("H4", "H5", "H6") and away.ids[away.owner] == "A" + first[1:]
    assert away.possession_team() == 1
    spots = away.formation_spots()
    rb, rcb = away.index("A2"), away.index("A4")  # the away full-back pushes on with the ball
    assert abs(spots[rb, 0] - spots[rcb, 0]) > 5.0
