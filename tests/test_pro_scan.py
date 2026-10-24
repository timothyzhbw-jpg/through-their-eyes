"""Teaching scenario `pro_scan` (SPEC 3.6, "Teaching"): back to goal, three looks, then the
half-turn. Written with the scenario, on design seeds (0-99): the looks start at their scripted
times, the two rules act on his belief and never on the truth, dropping looks leaves every other
player's random draws alone, and the other scenarios are untouched by its engine hooks.
"""

import numpy as np
import pytest

from analytics.vision import wrap_angle
from eval.pro_scan import RUNS, Row, RunRow, _reading
from explain.functions import EvalContext, metric_at
from sim.config import DT, SimParams
from sim.counterfactual import reception_frame, run_counterfactual
from sim.engine import Simulation
from sim.overrides import DropScan, scan_direction_deg
from sim.perception import scan_turn
from sim.scenarios import SCENARIOS
from sim.scenarios.base import Scenario
from sim.scenarios.pro_scan import (
    HALF_TURN_M,
    LOOKS,
    MAX_SHIFT_M,
    NEAR_M,
    OPEN_DEG,
    ProScan,
    body_angle,
    half_turn_yaw,
    look_ids,
    receiving_spot,
    run_with_looks,
)

P = SimParams()
DESIGN = range(6)


@pytest.fixture(scope="module")
def runs():
    """(three looks, one look) for a few design seeds: run, scenario."""
    return {seed: (run_with_looks(seed), run_with_looks(seed, "B")) for seed in DESIGN}


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


# --- the looks: times scripted, the rest the sim's ---------------------------------------------


def test_each_look_starts_at_its_scripted_frame_in_its_direction(runs):
    for seed, ((run, sc), _) in runs.items():
        i = run.index("H8")
        for (label, direction, before_s), sid in zip(LOOKS, look_ids(sc), strict=True):
            f = sc.look_frames[label]
            assert f == sc.reception_frame - round(before_s / run.dt)
            scan = run.event(sid)
            assert scan.type == "scan" and scan.frame == f, (seed, label)
            assert scan.attrs["key"] is (label == "F")
            # As `ForceScans` turns a look: from where his body faces, at most the widest scan.
            # Recorded frame f is before that frame's step, as the engine reads it.
            to_ball = run.ball_pos[f, :2] - run.pos[f, i]
            base = float(np.arctan2(to_ball[1], to_ball[0]))
            turn = scan_turn(run.body_yaw[f, i] + np.deg2rad(scan_direction_deg(int(direction)))
                             - base, P)  # fmt: skip
            assert scan.attrs["direction"] == pytest.approx(float(wrap_angle(base + turn)),
                                                            abs=1e-9)  # fmt: skip
        # No look of his own: the scripted ones are all he takes before he plays.
        decided = run.hero_decision().frame
        turns = ("scan", "head_turn")
        own = [e.id for e in run.events
               if e.type in turns and e.player == "H8" and e.frame < decided]  # fmt: skip
        assert own == look_ids(sc)


def test_one_look_is_the_same_run_without_the_other_three_looks(runs):
    for seed, ((three, sc), (one, _)) in runs.items():
        first = min(sc.look_frames[label] for label in "LRF")
        assert np.array_equal(three.pos[: first + 1], one.pos[: first + 1])
        scans = [e.id for e in one.events if e.type == "scan" and e.player == "H8"
                 and e.frame < one.hero_decision().frame]  # fmt: skip
        assert scans == look_ids(sc, "B"), seed


def test_dropping_looks_leaves_every_other_players_draws_unchanged():
    sc = Simulation.from_scenario("pro_scan", 3).scenario
    first = min(sc.look_frames[label] for label in "LRF")
    factual, one = run_counterfactual("pro_scan", 3, first,
                                      [DropScan(s) for s in look_ids(sc, "LRF")],
                                      record_draws=True)  # fmt: skip
    for player in ("A5", "H9", "H4", "A1", "A6"):
        f, c = factual.draws_for(player), one.draws_for(player)
        common = f.keys() & c.keys()
        assert len(common) > 0.9 * min(len(f), len(c))
        assert all(f[k] == c[k] for k in common)


def test_players_respect_role_speed_and_acceleration_limits(runs):
    for (run, _), (one, _) in runs.values():
        for r in (run, one):
            speed = np.linalg.norm(r.vel, axis=-1)
            assert np.all(speed <= np.array([p.v_max for p in r.players]) + 1e-9)
            acc = np.linalg.norm(np.diff(r.vel, axis=0), axis=-1) / r.dt
            assert np.all(acc <= np.array([p.d_max for p in r.players]) + 1e-6)


# --- rule 1: where he receives, on his belief --------------------------------------------------


def test_receiving_spot_moves_away_from_the_defenders_he_believes_are_near():
    spot = np.array([0.0, 0.0])
    assert receiving_spot(spot, spot, np.array([[NEAR_M + 1.0, 0.0]])) is None
    # Before the pass: anywhere within MAX_SHIFT_M, away from him.
    new = receiving_spot(spot, spot, np.array([[4.0, 0.0]]))
    assert np.linalg.norm(new - spot) <= MAX_SHIFT_M + 1e-9
    assert new[0] == pytest.approx(-MAX_SHIFT_M)
    # While the ball comes: only back along its line, toward the passer.
    aim, passer = np.array([0.0, 0.0]), np.array([-20.0, 0.0])
    new = receiving_spot(spot, spot, np.array([[3.0, 1.0]]), aim, passer)
    assert new[1] == pytest.approx(0.0) and -MAX_SHIFT_M - 1e-9 <= new[0] < 0.0


def test_the_drop_back_comes_from_his_belief_not_from_where_the_defender_is(runs):
    """With one look he never sees A5 step out, so he does not drop back while the ball comes,
    though A5 is truly as close as with three looks."""
    for (_, sc3), (_, sc1) in runs.values():
        flight = [f for f, _ in sc3.shifts if f >= sc3.kick_frame]
        assert flight, "with the forward look he drops back as the ball comes"
        assert not [f for f, _ in sc1.shifts if f >= sc1.kick_frame]


# --- rule 2: the half-turn, on his belief ------------------------------------------------------


def test_half_turn_turns_side_on_away_from_the_presser_he_believes_in():
    me, ball_from = np.array([0.0, 0.0]), np.array([-20.0, 0.0])
    yaw, side_on = half_turn_yaw(me, ball_from, np.array([[HALF_TURN_M + 1.0, 3.0]]))
    assert not side_on and yaw == pytest.approx(np.pi)
    yaw, side_on = half_turn_yaw(me, ball_from, np.array([[2.0, 2.0]]))  # behind his right
    assert side_on and 45.0 <= OPEN_DEG <= 90.0
    turn = float(wrap_angle(yaw - np.pi))
    assert abs(np.rad2deg(turn)) == pytest.approx(OPEN_DEG)
    side = float(wrap_angle(np.arctan2(2.0, 2.0) - np.pi))
    assert turn * side < 0  # turned away from him


def test_the_half_turn_comes_from_his_belief_not_from_where_the_presser_is(runs):
    """With one look he receives square although an opponent is truly within HALF_TURN_M: he
    believes A5 is still back in the lane. With three looks he receives side-on."""
    square_under_pressure = side_on = 0
    settle = round(np.deg2rad(OPEN_DEG) / P.body_turn_rate / DT) + 1  # frames to turn
    for (three, sc3), (one, sc1) in runs.values():
        f3, f1 = reception_frame(three, "H8"), reception_frame(one, "H8")
        assert not any(on for _, on in sc1.turns)  # he never believes a presser is near
        assert body_angle(one, sc1, f1) < 45.0
        i = one.index("H8")
        opp = [j for j, p in enumerate(one.players) if p.team == 1]
        square_under_pressure += float(np.linalg.norm(one.pos[f1, opp] - one.pos[f1, i],
                                                      axis=-1).min()) <= HALF_TURN_M  # fmt: skip
        # Rule 2's call at his reception, made at least the turn's time before it.
        calls = [(f, on) for f, on in sc3.turns if f <= f3 - settle]
        if calls and calls[-1][1] and all(f <= f3 - settle for f, _ in sc3.turns if f <= f3):
            assert body_angle(three, sc3, f3) >= 45.0
            side_on += 1
    assert square_under_pressure >= len(DESIGN) // 2
    assert side_on >= len(DESIGN) // 2


# --- the verifier's metrics for the beats -------------------------------------------------------


def test_body_open_and_depth_metrics_read_the_run(runs):
    (run, sc), _ = runs[0]
    ctx = EvalContext(run)
    rec = next(e for e in run.events if e.type == "reception" and e.player == "H8")
    opened = metric_at(ctx, run, "body_open", rec.id, player="H8")
    assert opened == pytest.approx(body_angle(run, sc, rec.frame))
    depth = metric_at(ctx, run, "depth", rec.id, player="H8")
    assert depth == pytest.approx(float(run.pos[rec.frame, run.index("H8"), 0]))


# --- the eval's words follow its numbers -----------------------------------------------------


def _row(seed: int, **over) -> RunRow:
    base = dict(looks=["L", "R", "B", "F"], shift_m=1.0, separation_m=3.0, nearest="A5",
                body_deg=0.0, side_on=False, decision="pass:H9", best="pass:H9", result="kept",
                xt_gain=0.1, look_error={"L": (0.0, 0.0, 3)})  # fmt: skip
    return RunRow(**{**base, **over})


def test_the_reading_says_so_when_three_looks_barely_change_anything():
    rows = [Row(s, {name: _row(s) for name in RUNS}) for s in range(10)]
    text = " ".join(_reading(rows))
    assert "Three looks barely change anything" in text
    assert "His decision barely changes" in text
    better = [Row(s, {"three": _row(s, separation_m=5.0, side_on=True), "one": _row(s),
                      "no_forward": _row(s)}) for s in range(10)]  # fmt: skip
    text = " ".join(_reading(better))
    assert "+2.00 m further" in text and "side-on in 10/10 against 0/10" in text
    assert "barely change anything" not in text


def test_the_scenario_is_registered_with_its_intervention():
    cls = SCENARIOS["pro_scan"]
    assert cls is ProScan and cls.hero == "H8" and cls.intervention == "drop_scan"
    assert cls.teaching and cls.tackles
