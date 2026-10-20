"""Marking in possession_play (SPEC 3.4, 3.8).

Jordet et al. (2020) compare scanning by how close the nearest opponent is at the reception. In
real play a receiver with an opponent within a metre has usually been marked for a while, so the
scan slowdown under pressure (sim/config.py pressure_scan_factor) has had time to act. The realism
report reads that comparison off possession_play, so the scenario has to mark.
"""

import numpy as np
import pytest

from eval.realism import MARKED_M, simulate

SEEDS = range(0, 20)  # tuning seeds; the realism report runs held-out seeds 100-199


@pytest.fixture(scope="module")
def receptions():
    tables = [simulate(seed)["receptions"] for seed in SEEDS]
    return {k: np.concatenate([t[k] for t in tables]) for k in tables[0]}


@pytest.mark.xfail(strict=True, reason="possession_play does not mark yet")
def test_receivers_under_tight_pressure_were_marked_for_most_of_their_window(receptions):
    # The realism report's bins: 0-1 m is < 1.5 m at the reception, 10+ m is >= 9.5 m.
    close = receptions["pressure"] < 1.5
    free = receptions["pressure"] >= 9.5
    assert close.sum() >= 10 and free.sum() >= 10
    # Share of the window (up to 10 s before the reception) with an opponent within MARKED_M.
    marked = receptions["marked"]
    assert MARKED_M == 3.0
    # Most receivers at 0-1 m had an opponent that close for more than half of their window ...
    assert np.median(marked[close]) > 0.5
    # ... and most receivers at 10+ m did not.
    assert np.median(marked[free]) < 0.5
