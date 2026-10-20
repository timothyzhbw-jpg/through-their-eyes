"""Realism report (SPEC 3.8): sim perception and movement statistics against published values."""

from pathlib import Path

import numpy as np
import pytest

from eval.realism import (
    COLUMNS,
    NO_REFERENCE,
    SOURCES,
    VERDICTS,
    cohens_d,
    evaluate,
    out_of_frame_s,
    possession_start,
    render,
)

REFERENCES = (Path(__file__).parents[1] / "docs" / "REFERENCES.md").read_text()
SEEDS = [100, 101, 102]


@pytest.fixture(scope="module")
def report():
    rows = evaluate(SEEDS)
    return rows, render(rows, SEEDS)


def _table(markdown: str) -> tuple[list[str], list[list[str]]]:
    lines = [line for line in markdown.splitlines() if line.startswith("|")]
    header = [c.strip() for c in lines[0].strip("|").split("|")]
    assert set(lines[1].replace("|", "").strip()) <= {"-", ":"}
    body = [[c.strip() for c in line.strip("|").split("|")] for line in lines[2:]]
    return header, body


def test_table_has_the_columns_and_one_line_per_row(report):
    rows, markdown = report
    header, body = _table(markdown)
    assert header == list(COLUMNS)
    assert len(body) == len(rows) >= 20
    assert all(len(cells) == len(COLUMNS) for cells in body)
    assert len({cells[0] for cells in body}) == len(body)  # metric names are unique


def test_every_row_has_a_citation_or_the_explicit_no_reference_mark(report):
    _, markdown = report
    _, body = _table(markdown)
    col = {name: i for i, name in enumerate(COLUMNS)}
    cited = 0
    for cells in body:
        published, source, verdict = (
            cells[col["Published"]],
            cells[col["Source"]],
            cells[col["Inside"]],
        )
        if published == NO_REFERENCE:
            assert source == "—" and verdict == "—", cells
            continue
        cited += 1
        paper = next((s for s in SOURCES.values() if source.startswith(s.cite)), None)
        assert paper is not None, f"unknown source: {source}"
        assert paper.cite in REFERENCES, f"{paper.cite} is not in docs/REFERENCES.md"
        assert source != paper.cite, f"no table, figure or section given: {source}"
        assert verdict in VERDICTS, cells
    assert cited >= 10
    # The brief's movement rows (speeds, accelerations, pass speeds) have no published value.
    assert NO_REFERENCE in markdown


def test_sim_cells_are_filled_and_the_report_is_deterministic(report):
    rows, markdown = report
    for row in rows:
        assert row.sim and row.seeds, row.metric
    assert render(evaluate(SEEDS[:1]), SEEDS[:1]) == render(evaluate(SEEDS[:1]), SEEDS[:1])


def test_possession_window_starts_when_the_team_won_the_ball():
    # Team of the owner per frame: 0 has it, the ball is in flight (-1), team 1 wins it at 4.
    team = np.array([0, 0, -1, -1, 1, 1, -1, 1, 1])
    assert possession_start(team, frame=8, team_id=1) == 4
    assert possession_start(team, frame=3, team_id=0) == 0


def test_cohens_d_uses_the_pooled_standard_deviation():
    a, b = np.array([1.0, 2.0, 3.0]), np.array([0.0, 1.0, 2.0])
    assert cohens_d(a, b) == pytest.approx(1.0)
    assert cohens_d(b, a) == pytest.approx(-1.0)


def test_out_of_frame_time_runs_from_first_frame_out_to_first_frame_back():
    # Ball straight ahead (+x); the head turns out to 90 degrees and back, 0.04 s frames.
    yaw = np.deg2rad([0, 30, 60, 90, 90, 60, 30, 0])
    pos = np.zeros((len(yaw), 2))
    ball = np.tile([10.0, 0.0], (len(yaw), 1))
    half_width = np.deg2rad(41.0)
    assert out_of_frame_s(yaw, pos, ball, 0.04, half_width) == pytest.approx(4 * 0.04)
    assert out_of_frame_s(np.zeros(5), pos[:5], ball[:5], 0.04, half_width) is None
