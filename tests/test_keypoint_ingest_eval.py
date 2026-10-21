"""Limb-tracking ingest eval (SPEC 4.7): the detector's F1 on keypoint-derived head yaw against
the sim's tracked head yaw, on held-out seeds (a few here; the report runs them all)."""

import pytest

from analytics.scan_detector import DEFAULT_PARAMS
from eval.keypoint_ingest import BASELINE, MATCHED, ROUTES, evaluate, render
from eval.scan_detector import samples_for, score

SEEDS = (("blind_side_run", range(100, 104)),)


@pytest.fixture(scope="module")
def routes():
    return evaluate(SEEDS)


def test_the_baseline_is_the_scan_detector_evals_own_score(routes):
    expected = score(samples_for(SEEDS), DEFAULT_PARAMS)
    assert routes[BASELINE].counts == expected


def test_every_route_scores_the_same_runs_and_truth(routes):
    truth = [s.truth for s in routes[BASELINE].samples]
    for name in ROUTES:
        assert [s.truth for s in routes[name].samples] == truth
        c = routes[name].counts
        assert c.tp + c.fn == routes[BASELINE].counts.tp + routes[BASELINE].counts.fn


def test_at_the_sims_noise_the_keypoint_route_is_as_noisy_and_scores_alike(routes):
    base, kp = routes[BASELINE], routes[MATCHED]
    assert kp.rms_deg == pytest.approx(base.rms_deg, rel=0.1)
    assert kp.counts.f1 >= base.counts.f1 - 0.05


def test_the_report_has_one_row_per_route(routes):
    lines = render(routes, SEEDS).splitlines()
    first = next(i for i, line in enumerate(lines) if line.startswith("|---")) + 1
    rows = lines[first : lines.index("", first)]
    assert [r.split(" | ")[0].removeprefix("| ") for r in rows] == list(ROUTES)
