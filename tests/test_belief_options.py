"""His options on his belief at any frame (SPEC 3.5, 7; `explain.belief_options`). Written before
the screen shows them: at his decision frame the rebuilt belief and options are the decision
record's exactly, the functions are read only, a look's news is what the look changed, and the
opened/closed split follows the threshold.
"""

import numpy as np
import pytest

from agents.context import MomentContext
from explain.belief_options import (
    NEW_M,
    OPEN_P,
    IllDefinedLook,
    belief_state,
    look_options,
    new_in_picture,
    option_changes,
    options_on_belief,
    without_look_sightings,
)
from explain.lenses import sightings
from sim.engine import Simulation
from sim.overrides import DropScan
from sim.scenarios.pro_scan import look_ids, run_with_looks


@pytest.fixture(scope="module")
def blind():
    return MomentContext.load("blind_side_run", 3)


def test_at_his_decision_the_options_are_the_decision_records(blind):
    run = blind.run
    d = run.hero_decision()
    pos, _, _ = belief_state(run, d.player, d.frame)
    for k, pid in enumerate(run.ids):
        truth = float(np.linalg.norm(pos[k] - run.pos[d.frame, k]))
        assert truth == pytest.approx(d.belief_error[pid], abs=1e-9)
    mine = {o.action: o for o in options_on_belief(run, d.player, d.frame)}
    assert set(mine) == {o.action for o in d.options}
    for o in d.options:
        assert mine[o.action].p_success == pytest.approx(o.p_success, abs=1e-12)
        assert mine[o.action].value == pytest.approx(o.value, abs=1e-12)
        assert mine[o.action].prob == pytest.approx(o.prob, abs=1e-12)


def test_it_is_read_only(blind):
    run = blind.run
    before = run.to_bytes()
    seen = sightings(run, "H8")
    options_on_belief(run, "H8", 40, seen)
    new_in_picture(run, "H8", 50, 70, seen)
    assert run.to_bytes() == before


def test_a_looks_news_is_what_the_look_changed(blind):
    """The blind-side look brings the runner H9 into his picture, far from where he had him."""
    run = blind.run
    scan = next(e for e in run.events if e.type == "scan" and e.player == "H8")
    a, b = scan.frame, int(scan.attrs["end"])
    news = {n.player: n for n in new_in_picture(run, "H8", a, b)}
    assert "H9" in news and news["H9"].moved_m > NEW_M and news["H9"].entered
    assert all(n.entered or n.moved_m > NEW_M for n in news.values())
    assert list(news.values()) == sorted(news.values(), key=lambda n: -n.moved_m)
    without, with_look = look_options(run, "H8", a, b)
    w = {o.action: o.p_success for o in without}
    n = {o.action: o.p_success for o in with_look}
    assert n["pass:H9"] > w["pass:H9"] + 0.5  # seeing the run opens the pass to him
    opened, _ = option_changes(w, n)
    assert "pass:H9" in opened


def test_options_open_and_close_at_the_threshold():
    was = {"pass:A": OPEN_P - 0.01, "pass:B": OPEN_P, "carry": 0.9, "pass:C": 0.7}
    now = {"pass:A": OPEN_P, "pass:B": OPEN_P - 0.01, "carry": 0.95, "pass:D": 0.6}
    assert option_changes(was, now) == (["pass:A", "pass:D"], ["pass:B", "pass:C"])
    assert option_changes(now, now) == ([], [])


def test_without_a_scan_keeps_what_his_forward_view_would_have_shown():
    """Seed 116's right look: H4 was never open without it and is not news from the look."""
    run = MomentContext.load("pro_scan", 116).run
    scan = run.key_scan()
    a, b = scan.frame, int(scan.attrs["end"])
    without, with_look = look_options(run, "H8", a, b)
    was = {o.action: o.p_success for o in without}
    now = {o.action: o.p_success for o in with_look}
    assert was["pass:H4"] == pytest.approx(0.45, abs=0.01)
    assert was["pass:H4"] < OPEN_P and now["pass:H4"] < OPEN_P
    assert "pass:H4" not in option_changes(was, now)[1]
    news = {n.player: n for n in new_in_picture(run, "H8", a, b)}
    assert "H4" not in news


def test_a_forward_view_reentry_is_not_news_from_the_scan():
    """A10 reenters sight during seed 0's left look, but he is visible without the scan too."""
    run = Simulation.from_scenario("pro_scan", 0).run()
    scan = next(e for e in run.events if e.type == "scan" and e.player == "H8")
    a, b = scan.frame, int(scan.attrs["end"])
    seen = sightings(run, "H8")
    without_seen = without_look_sightings(run, "H8", a, b, seen)
    j = run.index("A10")
    assert not seen[a - 1, j] and seen[a : b + 1, j].any()
    assert without_seen[a : b + 1, j].all()  # head toward the ball sees him throughout
    before, _, _ = belief_state(run, "H8", b, without_seen)
    after, _, _ = belief_state(run, "H8", b, seen)
    np.testing.assert_array_equal(before[j], after[j])
    assert "A10" not in {n.player for n in new_in_picture(run, "H8", a, b, seen, without_seen)}


def test_without_a_look_preserves_existing_interventions_and_only_replaces_its_frames():
    """Dropping the right look from a run already without the left must not bring the left back."""
    run, sc = run_with_looks(116, "R")
    scan = run.key_scan()
    a, b = scan.frame, int(scan.attrs["end"])
    seen = sightings(run, "H8")
    with pytest.raises(ValueError, match="does not match the supplied run's interventions"):
        without_look_sightings(run, "H8", a, b, seen)
    without = without_look_sightings(run, "H8", a, b, seen, [DropScan(look_ids(sc, "L")[0])])
    neither, _ = run_with_looks(116, "")
    np.testing.assert_array_equal(without[a : b + 1], sightings(neither, "H8")[a : b + 1])
    np.testing.assert_array_equal(without[:a], seen[:a])
    np.testing.assert_array_equal(without[b + 1 :], seen[b + 1 :])


def test_a_baseline_with_different_physical_play_is_rejected():
    """The left look's movement rule acts later; extending the comparison past it mixes geometry."""
    run = Simulation.from_scenario("pro_scan", 116).run()
    scan = next(e for e in run.events if e.type == "scan" and e.player == "H8")
    with pytest.raises(IllDefinedLook, match="changes physical play"):
        without_look_sightings(run, "H8", scan.frame, 71)
