"""The large-sample hero gate summary (SPEC 3.6): Wilson intervals and reading the reports."""

import pytest

from eval import hero_gates
from eval.hero_gates import EVALS, GATES, Row, available, read_row, wilson


def test_wilson_matches_known_intervals():
    lo, hi = wilson(39, 40)
    assert (lo, hi) == pytest.approx((0.8712, 0.9956), abs=1e-4)
    assert wilson(0, 10) == pytest.approx((0.0, 0.2775), abs=1e-4)
    assert wilson(10, 10)[1] == pytest.approx(1.0)


def test_every_gate_on_this_branch_reads_a_rate_and_a_target_from_its_original_report():
    gates = [(name, metric) for name, metric in GATES if available(name)]
    assert gates
    for name, metric in gates:
        row = read_row(name, metric)
        assert 0 <= row.k <= row.n == 40 and row.target in (0.6, 0.8, 0.9), (name, metric)


def test_every_gate_names_a_known_eval():
    assert {name for name, _ in GATES} <= set(EVALS)


def test_a_rate_below_its_target_fails_and_one_whose_interval_clears_it_passes():
    assert hero_gates._verdict(Row(110, 200, 0.6, "")) == "**fail**"
    assert hero_gates._verdict(Row(170, 200, 0.6, "")) == "pass"
    assert hero_gates._verdict(Row(125, 200, 0.6, "")).startswith("pass (interval")


def test_the_summary_is_current():
    path = hero_gates.REPORTS / f"hero_gates_{hero_gates.SEEDS}.md"
    assert path.read_text() == hero_gates.report()
