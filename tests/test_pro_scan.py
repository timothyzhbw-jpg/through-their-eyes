"""Teaching scenario `pro_scan` (SPEC 3.6, "Teaching"): back to goal, the coach's sequence: the
forward view, a look left that drops him back, a look right that sets the half-turn. On design
seeds (0-99): the looks start at their scripted times in their order, there is no other look, the
two rules act on his belief at fixed times and never on the truth, dropping looks leaves every
other player's random draws alone, and the other scenarios are untouched by its engine hooks.
"""

import numpy as np
import pytest

from analytics.vision import wrap_angle
from eval.pro_scan import LOST, RUNS, Row, RunRow, _reading
from explain.functions import EvalContext, metric_at
from sim.config import SimParams
from sim.counterfactual import reception_frame, run_counterfactual
from sim.engine import Simulation
from sim.overrides import DropScan, scan_direction_deg
from sim.perception import scan_turn
from sim.scenarios import SCENARIOS
from sim.scenarios.base import Scenario
from sim.scenarios.pro_scan import (
    DROP_CONE_DEG,
    HALF_TURN_M,
    KEY,
    LOOKS,
    MAX_SHIFT_M,
    NEAR_M,
    OPEN_DEG,
    ProScan,
    body_angle,
    half_turn_side,
    half_turn_yaw,
    look_ids,
    receiving_spot,
    run_with_looks,
)

P = SimParams()
DESIGN = range(6)


@pytest.fixture(scope="module")
def runs():
    """Per design seed, the four runs of the eval: run, scenario."""
    return {seed: {name: run_with_looks(seed, keep) for name, keep in RUNS.items()}
            for seed in DESIGN}  # fmt: skip


# --- the hooks leave every other scenario alone ------------------------------------------------


def test_the_engine_hooks_are_empty_unless_a_scenario_fills_them():
    sim = Simulation.from_scenario("blind_side_run", 3)
    assert Scenario.receiver_targets(sim.scenario, sim, 0) == {}
    assert Scenario.body_targets(sim.scenario, sim, 0) == {}
    teaching = sorted(name for name, cls in SCENARIOS.items() if cls.teaching)
    assert teaching == ["pro_scan"]


def test_same_seed_twice_is_byte_identical():
    a = Simulation.from_scenario("pro_scan", 7).run().to_bytes()
    assert a == Simulation.from_scenario("pro_scan", 7).run().to_bytes()
    assert a != Simulation.from_scenario("pro_scan", 8).run().to_bytes()


# --- the coach's sequence: forward view, left, right ------------------------------------------


def test_the_sequence_is_left_then_right_and_nothing_else():
    assert [label for label, _, _ in LOOKS] == ["L", "R"]
    (_, left, t_left), (_, right, t_right) = LOOKS
    assert int(left) > 0 > int(right)  # left is counter-clockwise from where his body faces
    assert t_left > t_right  # left first
    assert KEY == "R"


def test_he_starts_facing_the_ball_with_his_back_to_goal(runs):
    for seed, r in runs.items():
        run, sc = r["both"]
        i = run.index("H8")
        to_ball = run.ball_pos[0, :2] - run.pos[0, i]
        assert abs(float(wrap_angle(run.head_yaw[0, i] - np.arctan2(to_ball[1], to_ball[0])))) < 0.2
        facing = np.array([np.cos(run.body_yaw[1, i]), np.sin(run.body_yaw[1, i])])
        assert facing[0] < -0.9, seed  # toward his own half: his back to the goal he attacks


def test_each_look_starts_at_its_scripted_frame_in_its_direction(runs):
    for seed, r in runs.items():
        run, sc = r["both"]
        i = run.index("H8")
        for (label, direction, before_s), sid in zip(LOOKS, look_ids(sc), strict=True):
            f = sc.look_frames[label]
            assert f == sc.reception_frame - round(before_s / run.dt)
            scan = run.event(sid)
            assert scan.type == "scan" and scan.frame == f, (seed, label)
            assert scan.attrs["key"] is (label == KEY)
            # As `ForceScans` turns a look: from where his body faces, at most the widest scan.
            to_ball = run.ball_pos[f, :2] - run.pos[f, i]
            base = float(np.arctan2(to_ball[1], to_ball[0]))
            turn = scan_turn(run.body_yaw[f, i] + np.deg2rad(scan_direction_deg(int(direction)))
                             - base, P)  # fmt: skip
            assert scan.attrs["direction"] == pytest.approx(float(wrap_angle(base + turn)),
                                                            abs=1e-9)  # fmt: skip
            # Over his left shoulder for L, his right for R, against the ball.
            side = float(wrap_angle(scan.attrs["direction"] - base))
            assert (side > 0) is (label == "L"), (seed, label)
            # The look is over before its rule acts on what it showed.
            rule = "drop_back" if label == "L" else "half_turn"
            assert int(scan.attrs["end"]) < sc.rule_frames[rule], (seed, label)
        # No other look: the scripted ones are all he takes before he plays.
        decided = run.hero_decision().frame
        turns = ("scan", "head_turn")
        own = [e.id for e in run.events
               if e.type in turns and e.player == "H8" and e.frame < decided]  # fmt: skip
        assert own == look_ids(sc)


def test_the_drop_back_rule_acts_before_the_pass_is_played(runs):
    for seed, r in runs.items():
        _, sc = r["both"]
        assert sc.rule_frames["drop_back"] < sc.kick_frame < sc.rule_frames["half_turn"], seed


def test_each_run_takes_exactly_its_looks(runs):
    for seed, r in runs.items():
        _, sc = r["both"]
        first = min(sc.look_frames.values())
        for name, keep in RUNS.items():
            run, _ = r[name]
            assert np.array_equal(run.pos[: first + 1], r["both"][0].pos[: first + 1])
            f = run.hero_decision().frame if run.hero_decision() else len(run.owner)
            scans = [e.id for e in run.events
                     if e.type == "scan" and e.player == "H8" and e.frame < f]  # fmt: skip
            assert scans == look_ids(sc, keep), (seed, name)


def test_dropping_looks_leaves_every_other_players_draws_unchanged():
    sc = Simulation.from_scenario("pro_scan", 3).scenario
    first = min(sc.look_frames.values())
    factual, none = run_counterfactual("pro_scan", 3, first,
                                       [DropScan(s) for s in look_ids(sc, "LR")],
                                       record_draws=True)  # fmt: skip
    for player in ("A5", "H9", "H4", "A1", "A6"):
        f, c = factual.draws_for(player), none.draws_for(player)
        common = f.keys() & c.keys()
        assert len(common) > 0.9 * min(len(f), len(c))
        assert all(f[k] == c[k] for k in common)


def test_players_respect_role_speed_and_acceleration_limits(runs):
    for r in runs.values():
        for run, _ in r.values():
            speed = np.linalg.norm(run.vel, axis=-1)
            assert np.all(speed <= np.array([p.v_max for p in run.players]) + 1e-9)
            acc = np.linalg.norm(np.diff(run.vel, axis=0), axis=-1) / run.dt
            assert np.all(acc <= np.array([p.d_max for p in run.players]) + 1e-6)


# --- rule 1: the drop-back, after the left look, on his belief ---------------------------------


def test_receiving_spot_drops_back_toward_the_ball_away_from_who_he_believes_is_near():
    spot, ball = np.array([0.0, 0.0]), np.array([-20.0, 0.0])
    assert receiving_spot(spot, spot, np.array([[NEAR_M + 1.0, 0.0]]), ball) is None
    new = receiving_spot(spot, spot, np.array([[2.0, -4.0]]), ball)  # behind his left (-y)
    shift = new - spot
    assert np.linalg.norm(shift) <= MAX_SHIFT_M + 1e-9 and shift[0] < -1.0  # back, toward the ball
    angle = abs(float(np.rad2deg(wrap_angle(np.arctan2(shift[1], shift[0]) - np.pi))))
    assert angle <= DROP_CONE_DEG + 1e-6
    assert shift[1] > 0  # and away from him


def test_the_drop_back_follows_the_left_look(runs):
    """Rule 1 acts at the same frame in every run, on what he believes: with the left look he has
    seen A6 come in behind his left shoulder and drops back; without it he has not, and stays."""
    dropped = 0
    for seed, r in runs.items():
        for name in ("both", "left"):
            call = r[name][1].calls["drop_back"]
            assert call.nearest == "A6", (seed, name, call)
            assert (call.spot is not None) is (call.nearest_m <= NEAR_M), (seed, name, call)
            dropped += call.spot is not None
        for name in ("none", "right"):
            call = r[name][1].calls["drop_back"]
            assert call.spot is None and call.nearest_m > NEAR_M, (seed, name, call)
            # A6 is truly as close: the rule reads his belief, not the truth.
            run, sc = r[name]
            j, i = run.index("A6"), run.index("H8")
            f = call.frame
            assert float(np.linalg.norm(run.pos[f, j] - run.pos[f, i])) <= NEAR_M + 2.0
    assert dropped >= 2 * (len(DESIGN) - 1)


# --- rule 2: the half-turn, after the right look, on his belief --------------------------------


def test_half_turn_opens_away_from_the_presser_he_believes_in():
    me, ball_from = np.array([0.0, 0.0]), np.array([-20.0, 0.0])
    assert half_turn_side(me, ball_from, np.array([[HALF_TURN_M + 1.0, 3.0]])) == 0
    assert abs(half_turn_yaw(me, ball_from, 0)) == pytest.approx(np.pi)
    side = half_turn_side(me, ball_from, np.array([[2.0, 2.0]]))  # behind his right
    assert side != 0 and 45.0 <= OPEN_DEG <= 90.0
    turn = float(wrap_angle(half_turn_yaw(me, ball_from, side) - np.pi))
    assert abs(np.rad2deg(turn)) == pytest.approx(OPEN_DEG)
    presser = float(wrap_angle(np.arctan2(2.0, 2.0) - np.pi))
    assert turn * presser < 0  # turned away from him


def test_the_half_turn_follows_the_right_look(runs):
    """With the right look he has seen A5 step out and receives side-on, away from him; without
    it he believes A5 is still back in the lane and receives square, though A5 is truly close."""
    for seed, r in runs.items():
        for name in ("both", "right"):
            run, sc = r[name]
            call = sc.calls["half_turn"]
            assert call.side != 0 and call.nearest == "A5", (seed, name, call)
            assert body_angle(run, sc, reception_frame(run, "H8")) >= 45.0
        for name in ("none", "left"):
            run, sc = r[name]
            assert sc.calls["half_turn"].side == 0, (seed, name)
            f = sc.calls["half_turn"].frame
            i, j = run.index("H8"), run.index("A5")
            assert float(np.linalg.norm(run.pos[f, j] - run.pos[f, i])) <= HALF_TURN_M + 3.0
            if run.hero_decision() is not None:
                assert body_angle(run, sc, reception_frame(run, "H8")) < 45.0


# --- the verifier's metrics for the beats -------------------------------------------------------


def test_body_open_and_depth_metrics_read_the_run(runs):
    run, sc = runs[0]["both"]
    ctx = EvalContext(run)
    rec = next(e for e in run.events if e.type == "reception" and e.player == "H8")
    opened = metric_at(ctx, run, "body_open", rec.id, player="H8")
    assert opened == pytest.approx(body_angle(run, sc, rec.frame))
    depth = metric_at(ctx, run, "depth", rec.id, player="H8")
    assert depth == pytest.approx(float(run.pos[rec.frame, run.index("H8"), 0]))


# --- the eval's words follow its numbers -----------------------------------------------------


def _row(**over) -> RunRow:
    base = dict(looks=["L", "R"], dropped=False, turned=False, shift_m=0.0, separation_m=3.0,
                nearest="A5", body_deg=0.0, side_on=False, decision="pass:H9", best="pass:H9",
                result="kept", xt_gain=0.1)  # fmt: skip
    return RunRow(**{**base, **over})


def test_the_reading_says_so_when_the_looks_barely_change_anything():
    rows = [Row(s, {name: _row() for name in RUNS}) for s in range(10)]
    text = " ".join(_reading(rows))
    assert "separation at reception barely changes" in text
    assert "His decision barely changes" in text
    better = [Row(s, {"both": _row(separation_m=5.0, side_on=True), "none": _row(decision="carry"),
                      "left": _row(separation_m=5.0, decision="pass:H5"),
                      "right": _row(side_on=True)}) for s in range(10)]  # fmt: skip
    text = " ".join(_reading(better))
    assert "+2.00 m further" in text and "side-on in 10/10 against 0/10" in text
    assert "barely change" not in text
    assert "10/10 runs with both looks, 0/10 with the left look only" in text


def test_a_run_where_he_loses_the_ball_before_deciding_is_neither_pass():
    row = _row(decision=LOST, result="lost", best="—")
    assert not row.forward and not row.other_pass


def test_the_scenario_is_registered_with_its_intervention():
    cls = SCENARIOS["pro_scan"]
    assert cls is ProScan and cls.hero == "H8" and cls.intervention == "drop_scan"
    assert cls.teaching and cls.tackles
