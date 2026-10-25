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
    belief_state,
    look_options,
    new_in_picture,
    option_changes,
    options_on_belief,
)
from explain.lenses import sightings


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
