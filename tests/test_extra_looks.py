"""With two more looks: scans added on top of the hero's own, each at a time before he receives the
ball and in a direction from where his body faces (SPEC 3.7 `ForceScans`, `extra:` what-ifs).
"""

import re

import numpy as np
import pytest

from analytics.vision import wrap_angle
from sim.config import DT, SimParams
from sim.counterfactual import (
    TWO_LOOKS_FIRST_S,
    extra_looks_at,
    extra_looks_counterfactual,
    extra_looks_id,
    is_what_if_id,
    parse_extra_looks_id,
    reception_frame,
    two_more_looks,
    what_if_from_id,
)
from sim.engine import Simulation
from sim.overrides import SCAN_DIRECTIONS, ForceScans
from sim.perception import scan_turn

BLIND = ("blind_side_run", 3)
P = SimParams()


@pytest.fixture(scope="module")
def factual():
    return Simulation.from_scenario(*BLIND).run()


@pytest.fixture(scope="module")
def two(factual):
    return two_more_looks(*BLIND, probe=factual)


# --- no intervention, no change -------------------------------------------------------------------


def test_no_forced_scan_leaves_the_run_byte_identical(factual):
    sim = Simulation.from_scenario(*BLIND)
    sim.run_until(5)
    resumed = Simulation.resume(sim.snapshot(), [ForceScans("H8", ())]).run()
    assert resumed.to_bytes() == factual.to_bytes()
    assert not any(e.attrs.get("added") for e in resumed.events)


def test_a_fresh_run_is_byte_identical_to_the_factual_one(factual, two):
    assert two.factual.to_bytes() == factual.to_bytes()


# --- the forced scans appear --------------------------------------------------------------------


def test_the_forced_scans_start_when_and_where_they_are_asked(two):
    run, i = two.counterfactual, two.counterfactual.index("H8")
    assert len(two.added) == 2 and two.missing == []
    for (frame, deg), sid in zip(two.looks, two.added, strict=True):
        scan = run.event(sid)
        assert scan.frame == frame and scan.attrs["added"] is True and scan.attrs["key"] is False
        to_ball = run.ball_pos[frame, :2] - run.pos[frame, i]
        base = np.arctan2(to_ball[1], to_ball[0])
        turn = scan_turn(run.body_yaw[frame, i] + np.deg2rad(deg) - base, P)
        assert scan.attrs["direction"] == pytest.approx(float(wrap_angle(base + turn)), abs=1e-9)
    assert [deg for _, deg in two.looks] == [SCAN_DIRECTIONS["left"], SCAN_DIRECTIONS["right"]]
    # Left is counter-clockwise of the ball, right clockwise: he faces it before the kick.
    left, right = (run.event(sid).attrs["direction"] for sid in two.added)
    ball = [np.arctan2(*(run.ball_pos[f, :2] - run.pos[f, i])[::-1]) for f, _ in two.looks]
    assert wrap_angle(left - ball[0]) > 0 > wrap_angle(right - ball[1])


def test_the_rule_puts_both_looks_before_the_key_scan_and_keeps_it(factual, two):
    received = reception_frame(factual, "H8")
    assert two.looks[0][0] == received - round(TWO_LOOKS_FIRST_S / DT)
    first = two.counterfactual.event(two.added[0])
    assert two.looks[1][0] == first.attrs["end"] + round(P.scan_refractory_s / DT)
    key = factual.key_scan()
    second = two.counterfactual.event(two.added[1])
    assert second.attrs["end"] + round(P.scan_refractory_s / DT) <= key.frame
    assert two.counterfactual.key_scan().id == key.id


def test_forced_scans_turn_no_faster_than_a_scan_can(two):
    run, i = two.counterfactual, two.counterfactual.index("H8")
    for sid in two.added:
        scan = run.event(sid)
        yaw = run.head_yaw[scan.frame : scan.attrs["end"] + 1, i]
        assert np.abs(wrap_angle(np.diff(yaw))).max() / DT <= P.head_omega_max + 1e-9
        assert P.scan_amplitude[0] - 1e-9 <= scan.attrs["amplitude"] <= P.scan_amplitude[1] + 1e-9


def test_a_look_wider_than_a_scan_stops_at_the_widest_turn():
    lo, hi = P.scan_amplitude
    assert scan_turn(np.pi, P) == pytest.approx(-hi)  # exactly behind: over the right shoulder
    assert scan_turn(np.deg2rad(170), P) == pytest.approx(hi)
    assert scan_turn(np.deg2rad(-100), P) == pytest.approx(np.deg2rad(-100))
    assert scan_turn(lo - 0.01, P) is None  # the ball stays in view: not a scan


def test_looks_that_cannot_start_are_refused(factual):
    with pytest.raises(ValueError, match="cannot start"):  # forward: he faces the ball
        extra_looks_counterfactual(*BLIND, [(2.0, "forward")], probe=factual)
    with pytest.raises(ValueError, match="cannot start"):  # the first is still under way
        extra_looks_counterfactual(*BLIND, [(2.0, "left"), (1.9, "right")], probe=factual)
    with pytest.raises(ValueError, match="outside"):
        extra_looks_counterfactual(*BLIND, [(9.0, "left")], probe=factual)
    with pytest.raises(ValueError):
        extra_looks_counterfactual(*BLIND, [(2.0, "up")], probe=factual)
    with pytest.raises(ValueError, match="dwells"):
        ForceScans("H8", ((10, "left"),), dwell_s=P.scan_dwell_max_s + 1).apply(
            Simulation.from_scenario(*BLIND)
        )


def test_an_added_look_too_late_cancels_his_own_and_says_so(factual):
    key = factual.key_scan()
    result = extra_looks_at(*BLIND, [(key.frame - 5, 90)], probe=factual)
    assert result.missing == [key.id]


# --- randomness -----------------------------------------------------------------------------------


def test_the_looks_leave_every_random_draw_unchanged(factual):
    result = two_more_looks(*BLIND, probe=factual)
    again = extra_looks_at(*BLIND, result.looks, record_draws=True)
    for player in factual.ids:
        f, c = again.factual.draws_for(player), again.counterfactual.draws_for(player)
        common = f.keys() & c.keys()
        assert len(common) > 0.9 * min(len(f), len(c))
        assert all(f[k] == c[k] for k in common), player


def test_until_his_decision_only_his_head_moves(two):
    f, c = two.factual, two.counterfactual
    end = two.factual_decision.frame
    i = f.index("H8")
    upto = slice(0, end + 1)
    assert np.array_equal(c.pos[upto], f.pos[upto])
    assert np.array_equal(c.ball_pos[upto], f.ball_pos[upto])
    others = np.arange(len(f.players)) != i
    assert np.array_equal(c.head_yaw[upto][:, others], f.head_yaw[upto][:, others])
    assert not np.array_equal(c.head_yaw[upto, i], f.head_yaw[upto, i])


# --- ids ------------------------------------------------------------------------------------------


def test_extra_look_ids_round_trip_and_re_simulate(two):
    assert extra_looks_id("H8", [(4, 90), (24, -90)]) == "extra:H8:0004:+090,0024:-090"
    assert parse_extra_looks_id("extra:H8:0004:+090,0024:-090") == ("H8", [(4, 90), (24, -90)])
    assert is_what_if_id(two.id) and two.scan_id == two.id
    again = what_if_from_id(*BLIND, two.id)
    assert again.counterfactual.to_bytes() == two.counterfactual.to_bytes()
    with pytest.raises(ValueError):
        parse_extra_looks_id("look:H8:0050:-150")


# --- the eval's belief error ----------------------------------------------------------------------


def test_belief_error_at_a_frame_is_what_his_decision_recorded(factual):
    from eval.extra_looks import belief_error_at

    d = factual.hero_decision()
    err = belief_error_at(*BLIND, d.frame, "H8")
    assert err == pytest.approx([d.belief_error[pid] for pid in factual.ids], abs=1e-9)


# --- the bundle's verified lines ------------------------------------------------------------------


@pytest.fixture(scope="module")
def bundle():
    from sim.export import export_extra_looks

    return export_extra_looks(*BLIND)


def test_the_bundle_tells_the_added_looks_in_verified_lines(bundle, two):
    assert bundle["id"] == two.id and bundle["kept_own"] is True
    assert [a["id"] for a in bundle["added"]] == two.added
    assert bundle["report"] == "eval/reports/extra_looks_blind_side_run.md"
    for lang in ("en", "zh"):
        answer = bundle["answers"][lang]
        ids = [line["id"] for line in answer["lines"]]
        assert ids == ["added_looks", "extra_result", "extra_zones"]
        assert all(c["verdict"] == "supported" for c in answer["claims"])
        # Evidence is on the factual run, which the app has; the added scans are not in it.
        evidence = [e for c in answer["claims"] for e in c["evidence"]]
        assert all(e.startswith(("reception:", "pass:")) for e in evidence)
    values = next(c for c in bundle["answers"]["en"]["claims"] if c["id"] == "added_looks")
    assert values["values"]["n"] == 2
    assert (values["values"]["first_side"], values["values"]["second_side"]) == ("left", "right")


def test_the_zh_lines_hold_no_latin_letters(bundle):
    for line in bundle["answers"]["zh"]["lines"]:
        assert not re.search(r"[A-Za-z]", line["text"]), line["text"]
