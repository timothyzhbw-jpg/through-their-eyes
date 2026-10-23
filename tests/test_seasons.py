"""Seasons (eval/seasons.py): season.py's metrics over independent seasons, within and across."""

import copy
import math
from collections import Counter
from pathlib import Path

import pytest

import eval.seasons as seasons
from eval.season import FRAMING, SEASON_SEED, match_seeds, play_match
from sim.match import PossessionSpec

SMALL = (PossessionSpec("possession_play", max_s=8.0), PossessionSpec("blind_side_run", 3))


@pytest.fixture(scope="module")
def small():
    return play_match(0, 11_000_000, SMALL)


def test_the_across_seasons_interval_is_a_t_interval_over_the_season_values():
    m, lo, hi = seasons.across([1.0, 2.0, 3.0, 4.0, 5.0])
    half = 2.776 * math.sqrt(2.5) / math.sqrt(5)
    assert m == 3.0 and lo == pytest.approx(3.0 - half) and hi == pytest.approx(3.0 + half)
    one = seasons.across([0.7])
    assert one[0] == 0.7 and math.isnan(one[1]) and math.isnan(one[2])
    assert all(math.isnan(x) for x in seasons.across([math.nan]))


def test_a_realism_rows_pooled_value_is_read_as_printed():
    assert seasons.pooled_value("0.41 ± 0.19 (n = 67302)") == (0.41, "0.41")
    assert seasons.pooled_value("d = −0.04 (n = 32765 vs 5512)") == (-0.04, "−0.04")
    assert seasons.pooled_value("90.1% (n = 948593)") == (90.1, "90.1")
    value, text = seasons.pooled_value("central midfielders 0.46 > forwards 0.31")
    assert math.isnan(value) and text == "—"


def test_the_roots_are_fresh_and_their_seasons_share_no_match():
    assert SEASON_SEED not in seasons.ROOTS and len(set(seasons.ROOTS)) == len(seasons.ROOTS)
    drawn = [set(match_seeds(root, 380)) for root in (SEASON_SEED, *seasons.ROOTS)]
    assert sum(map(len, drawn)) == len(set().union(*drawn))


def test_a_season_is_cached_under_season_pys_name_and_reported_under_its_own():
    assert seasons._cache(2027, 380) == Path("out") / "season_2027_380.pickle"
    # eval.season --seasons writes seasons_<first>-<last>[_<n>].md from the same caches.
    assert seasons.report_name([2027, 2031], 380, True) == "seasons_intervals.md"
    assert seasons.report_name([2027, 2028], 2, False) == "seasons_intervals_2027-2028_2.md"


def _season(small, n, restart=None):
    out = []
    for i in range(n):
        r = copy.deepcopy(small)
        r["index"] = i
        if restart is not None:
            r["restarts"] = Counter({restart: 1})
        out.append(r)
    return out


def test_the_report_has_every_section_within_across_and_pooled(small):
    a, b = _season(small, 3), _season(small, 3, restart="throw_in")
    same = [{0: True}, {0: True}]
    report = seasons.render([a, b], same, [2027, 2028])
    title, blank, framing = report.splitlines()[:3]
    assert title.startswith("# Seasons") and blank == "" and framing == FRAMING
    for section in ("## Matches", "## Moments", "## Heroes", "## Claims and the Verifier",
                    "## Does the intervention change the outcome?", "## Determinism",
                    "## Realism at season scale"):  # fmt: skip
        assert section in report
    assert "| Metric | 2027 | 2028 | Across seasons: mean (95% CI) | All matches pooled |" in report
    # A restart kind that only one season saw is zero in the other, not missing.
    row = next(line for line in report.splitlines() if line.startswith("| Restarts: throw-in"))
    assert row.split(" | ")[1].startswith("0.00") and row.split(" | ")[2].startswith("1.00")
    # Identical seasons: the hero's flip is the same in both, and pooled over six matches.
    flip = next(line for line in report.splitlines() if line.startswith("| Hero `blind_side_run`"))
    assert "100.0% (100.0 to 100.0%)" in flip and "6/6 = 100.0%" in flip
    assert "2/2 = 100.0%" in report  # determinism, pooled over the seasons' re-runs


def test_seasons_md_says_where_goals_come_from_in_season_mds_words(small):
    from eval.season import render

    sentence = "Goals come from the plan's shooting hero (`far_post_finish`, once per match)"
    assert sentence in render([small], {0: True})
    assert sentence in seasons.render([_season(small, 2)], [{0: True}], [2027])
