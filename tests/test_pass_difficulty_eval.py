"""The pass difficulty sanity check (SPEC 4.6, eval/pass_difficulty.py): its AUC and verdict, and
the committed report's result."""

from pathlib import Path

import numpy as np
import pytest

from eval.pass_difficulty import (
    COUNTEREXAMPLE,
    INCONCLUSIVE,
    SUPPORTED,
    auc,
    passes,
    render,
    verdict,
)

REPORT = Path(__file__).resolve().parents[1] / "eval/reports/pass_difficulty.md"


def test_auc_counts_failed_passes_rated_harder_with_ties_half():
    failed = np.array([True, True, False, False])
    assert auc(np.array([0.9, 0.8, 0.1, 0.2]), failed) == 1.0
    assert auc(np.array([0.1, 0.2, 0.9, 0.8]), failed) == 0.0
    assert auc(np.array([0.5, 0.5, 0.5, 0.5]), failed) == 0.5
    assert np.isnan(auc(np.array([0.5, 0.4]), np.array([False, False])))


def test_the_verdict_follows_the_criterion_set_before_the_run():
    assert verdict(0.55, 0.7) == SUPPORTED
    assert verdict(0.3, 0.45) == COUNTEREXAMPLE
    assert verdict(0.45, 0.6) == INCONCLUSIVE


def test_the_report_renders_from_a_few_seeds():
    rows = [r for s in (300, 301) for r in passes(s)]
    assert rows
    assert {"difficulty", "failed", "lane", "passer", "receiver", "distance"} <= set(rows[0])
    text = render(rows, [300, 301])
    assert "AUC" in text and "Completion by band" in text


@pytest.mark.skipif(not REPORT.exists(), reason="report not written yet")
def test_the_committed_report_states_its_verdict():
    text = REPORT.read_text()
    assert "--seeds 300-399" in text
    assert any(f"**{v}**" in text for v in (SUPPORTED, COUNTEREXAMPLE, INCONCLUSIVE))
