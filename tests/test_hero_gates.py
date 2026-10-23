"""The scan heroes' held-out counts on the "Without the look" panel match the committed reports.

eval/hero_gates.py only reads those reports, so the file it writes is the same on every platform.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eval.hero_gates import build
from tests.test_doc_numbers import report_values

ROOT = Path(__file__).resolve().parents[1]
COMMITTED = ROOT / "web" / "public" / "data" / "hero_gates.json"


def test_the_committed_file_matches_the_reports():
    fresh = json.dumps(build(), indent=1, sort_keys=True) + "\n"
    assert COMMITTED.read_text(encoding="utf-8") == fresh, (
        "web/public/data/hero_gates.json is stale: uv run python -m eval.hero_gates"
    )


def test_blind_side_run_matches_the_doc_number():
    entry = build()["heroes"]["blind_side_run"]
    assert entry["changed"] == report_values("H1")["k"]
    assert entry["n"] == report_values("H1")["n"]


def test_a_report_without_the_row_is_refused(tmp_path: Path):
    reports = tmp_path / "reports"
    reports.mkdir()
    (reports / "hero_flip_blind_side_run.md").write_text(
        "Seeds 100–139 (40).\n\n| Factual decision is `pass:H9` | 34/40 (85%) | — |\n",
        encoding="utf-8",
    )
    (reports / "hero_shot_far_post_finish.md").write_text(
        "Seeds 200–239 (40).\n\n| Placement changed without the key scan | 38/40 (95%) | ≥ 60% |\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="hero_flip_blind_side_run.md: no 'decision changed"):
        build(reports)


def test_same_is_the_seeds_that_did_not_change():
    for entry in build()["heroes"].values():
        assert entry["same"] == entry["n"] - entry["changed"]
