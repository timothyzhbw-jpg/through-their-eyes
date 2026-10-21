"""The season eval (eval/season.py): its seeds, one small match end to end, and its report."""

import math

import pytest

from eval.season import (
    FRAMING,
    MATCH_SEED_BASE,
    hero_seed,
    marked_changed,
    match_seeds,
    play_match,
    render,
    render_seasons,
    season_plan,
    wilson,
)
from sim.match import DEFAULT_PLAN, SEED_BASE, PossessionSpec, build_match

SMALL = (PossessionSpec("possession_play", max_s=8.0), PossessionSpec("blind_side_run", 3))


@pytest.fixture(scope="module")
def small():
    return play_match(0, 11_000_000, SMALL)


def test_match_seeds_come_from_one_season_seed():
    seeds = match_seeds(2026, 5)
    assert seeds == match_seeds(2026, 5) != match_seeds(2027, 5)
    assert len(set(seeds)) == 5 and all(s >= MATCH_SEED_BASE for s in seeds)


def test_a_season_match_plays_match_1s_plan_with_fresh_hero_seeds():
    plan = season_plan(match_seeds(2026, 1)[0])
    assert [s.scenario for s in plan] == [s.scenario for s in DEFAULT_PLAN]
    assert [s.max_s for s in plan] == [s.max_s for s in DEFAULT_PLAN]
    heroes = [s.seed for s in plan if s.seed is not None]
    assert heroes and all(s >= SEED_BASE for s in heroes)  # never a design or eval seed
    assert hero_seed(1, 3) == hero_seed(1, 3) != hero_seed(2, 3)


def test_one_match_runs_the_whole_pipeline(small):
    (hero,) = small["heroes"]
    assert hero["detected"] and hero["built"] and hero["error"] is None
    assert hero["scripts"] == 10  # every persona and language
    assert set(hero["verdicts"]) == {"supported"}
    assert hero["violations"] == hero["unverified_on_screen"] == 0
    assert (hero["flip"], hero["measure"]) == (True, "decision")  # seed 3 flips (SPEC 3.6)
    assert any(m["hero"] for m in small["moments"])
    assert small["hash"] == build_match(11_000_000, SMALL).output_hash()
    assert set(small["observed"]) == {"receptions", "scans", "peaks", "passes"}
    assert len(small["ablation"]["scans"]) == len(small["observed"]["receptions"]["scans"])


def test_a_markers_outcome_is_whether_his_man_is_marked_as_the_ball_arrives():
    assert marked_changed({"separation_with_scan_m": 3.0, "separation_without_scan_m": 8.0})
    assert not marked_changed({"separation_with_scan_m": 6.0, "separation_without_scan_m": 9.0})
    assert marked_changed({}) is None


def test_wilson_interval():
    lo, hi = wilson(37, 40)
    assert 0.80 < lo < 0.81 and 0.97 < hi < 0.98
    assert all(math.isnan(x) for x in wilson(0, 0))  # no observations


def test_the_report_opens_with_the_framing_and_lists_every_section(small):
    report = render([small], {0: True})
    title, blank, framing = report.splitlines()[:3]
    assert title.startswith("# Season") and blank == "" and framing == FRAMING
    for section in ("## 1. Moments", "## 2. Claims", "## 3.", "## 4. Determinism", "## 5."):
        assert section in report
    assert "1/1 byte-identical" in report


def test_seasons_are_reported_side_by_side_and_pooled(small):
    report = render_seasons([(7, [small], {0: True}), (8, [small, small], {0: True})])
    title, blank, framing = report.splitlines()[:3]
    assert title == "# Seasons — the pipeline on 2 independent seasons" and framing == FRAMING
    assert "season seeds 7–8, 1 or 2 matches each, 3 in all" in report
    flips = next(x for x in report.splitlines() if "`blind_side_run`: intervention" in x)
    assert flips.startswith("| `blind_side_run`: intervention changes the outcome (decision) |")
    assert "| 1/1 | 2/2 | 3/3 = 100.0% (" in flips  # each season, then pooled with Wilson
    for section in ("## 1. Heroes", "## 2. Claims", "## 3.", "## 4.", "## 5. Determinism",
                    "## 6. Realism"):  # fmt: skip
        assert section in report
    assert "2/2 byte-identical in all" in report
