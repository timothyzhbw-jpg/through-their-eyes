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
    assert on == ["possession_play"]  # heroes and open_play (the xT fit) keep their runs
    assert set(SLOTS.values()) <= set(ts.FORMATIONS["4-3-3"]) | set(ts.FORMATIONS["4-2-3-1"])


def test_the_defending_back_four_is_one_line_that_steps_up_and_drops_with_the_ball(form):
    d = ts.SHAPE.defence
    defenders = [i for i, s in enumerate(form.slots) if form.team[i] == 1 and s.line == "defence"]
    depths = []
    for ball_x in (-40.0, -20.0, 0.0, 20.0, 40.0):  # home on the ball; away defends +x
        p = ts.spots(form, np.array([ball_x, 0.0]), possession=0)
        depth = HALF_LENGTH - p[defenders, 0]
        assert np.ptp(depth) < 1e-9  # one line
        ball_depth = HALF_LENGTH - ball_x
        assert depth[0] == pytest.approx(np.clip(ball_depth - d.gap, d.line_min, d.line_max))
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


def test_the_keeper_stands_between_ball_and_goal_centre_inside_his_area(form):
    keeper = _named(form, 0, "GK")[0]
    for ball in (np.array([0.0, 0.0]), np.array([-30.0, 25.0]), np.array([-50.0, -30.0])):
        for possession in (0, 1):
            x, y = ts.spots(form, ball, possession)[keeper]
            depth = x + HALF_LENGTH
            assert ts.KEEPER_INSIDE - 1e-9 <= depth <= ts.PENALTY_DEPTH - ts.KEEPER_INSIDE + 1e-9
            assert abs(y) <= ts.PENALTY_HALF_WIDTH - ts.KEEPER_INSIDE + 1e-9
            # On the line from the goal's centre to the ball (unless clipped to the area's side).
            to_ball = ball - np.array([-HALF_LENGTH, 0.0])
            cross = to_ball[0] * y - to_ball[1] * depth
            assert abs(cross) < 1e-6 or abs(y) == pytest.approx(ts.PENALTY_HALF_WIDTH - 1.0)


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
    assert mean[metrics.DEFENCE]["length"] < mean[metrics.ATTACK]["length"] - 3.0
    assert mean[metrics.DEFENCE]["width"] < mean[metrics.ATTACK]["width"] - 3.0


def test_the_defending_block_follows_the_ball_across_and_along_the_pitch(runs):
    across, near, far = [], [], []
    for run in runs:
        for s, phase, sign in _measured(run):
            defending = phase == metrics.DEFENCE
            if defending.sum() < round(5.0 / DT):
                continue
            across.append(np.corrcoef(s["centroid_y"][defending],
                                      run.ball_pos[defending, 1])[0, 1])  # fmt: skip
            # Ball depth from the defending team's goal line: near its goal, or far from it.
            ball_depth = HALF_LENGTH + sign * run.ball_pos[:, 0]
            near.append(s["line_height"][defending & (ball_depth < 45.0)])
            far.append(s["line_height"][defending & (ball_depth > 65.0)])
    assert np.median(across) > 0.5  # the block slides to the ball's side
    # The line drops as the ball comes toward its goal (it is capped at line_max further out).
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
