"""Realism report (SPEC 3.8): sim perception and movement statistics against published values."""

from pathlib import Path

import numpy as np
import pytest

from eval.realism import (
    ALL_PHASES,
    COLUMNS,
    LINE_REGRESSION,
    NO_REFERENCE,
    SHAPE_COLUMNS,
    SHAPE_EVERY,
    SHAPE_METRICS,
    SHAPE_PHASES,
    SHAPE_WARM_UP_S,
    SOURCES,
    VERDICTS,
    cohens_d,
    evaluate,
    out_of_frame_s,
    possession_start,
    render,
    shape_rows,
    shape_table,
    simulate,
    simulate_anchors,
)
from sim.config import DT
from sim.engine import Simulation

REFERENCES = (Path(__file__).parents[1] / "docs" / "REFERENCES.md").read_text()
SEEDS = [100, 101, 102]


@pytest.fixture(scope="module")
def report():
    rows = evaluate(SEEDS)
    return rows, render(rows, SEEDS)


def _table(markdown: str, after: str = "") -> tuple[list[str], list[list[str]]]:
    """The first table of `markdown` after the line `after` (from the start by default)."""
    text = markdown.split(f"\n{after}\n", 1)[1] if after else markdown
    lines = []
    for line in text.splitlines():
        if line.startswith("|"):
            lines.append(line)
        elif lines:
            break
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


@pytest.fixture(scope="module")
def shape_report():
    observed = [simulate(s) for s in SEEDS]
    anchors = [simulate_anchors(s) for s in SEEDS]
    rows = shape_rows(observed, anchors)
    return rows, render(evaluate(SEEDS, observed), SEEDS, rows)


def test_team_shape_table_has_every_metric_in_every_phase(shape_report):
    rows, markdown = shape_report
    header, body = _table(markdown, after="## Team shape")
    assert header == list(SHAPE_COLUMNS)
    phases = [p for _, p in (*SHAPE_PHASES, ALL_PHASES)]
    assert len(body) == len(rows) == len(SHAPE_METRICS) * len(phases) + len(LINE_REGRESSION)
    pairs = {(c[0].removesuffix(" †"), c[1]) for c in body}
    assert {(m, p) for _, m, _ in SHAPE_METRICS for p in phases} <= pairs
    assert sum("regressed" in c[0] or "on the ball's distance" in c[0] for c in body) == 2
    # The scan table above it is unchanged in shape.
    header, body = _table(markdown)
    assert header == list(COLUMNS)


def test_every_team_shape_row_is_cited_with_a_location_or_says_it_has_none(shape_report):
    _, markdown = shape_report
    _, body = _table(markdown, after="## Team shape")
    col = {name: i for i, name in enumerate(SHAPE_COLUMNS)}
    for cells in body:
        published, source, verdict = (cells[col[k]] for k in ("Published", "Source", "Inside"))
        assert cells[col["Sim (pooled)"]] and cells[col["Before: anchors"]] != "—"
        if published == NO_REFERENCE:
            assert source == "—" and verdict == "—", cells
            continue
        paper = next((s for s in SOURCES.values() if source.startswith(s.cite)), None)
        assert paper is not None, f"unknown source: {source}"
        assert paper.cite in REFERENCES, f"{paper.cite} is not in docs/REFERENCES.md"
        assert source != paper.cite, f"no table, figure or section given: {source}"
        assert verdict in VERDICTS, cells


def test_the_shape_table_samples_both_teams_after_the_warm_up():
    run = Simulation.from_scenario("possession_play", 100).run()
    table = shape_table(run)
    frames = len(range(round(SHAPE_WARM_UP_S / DT), len(run.owner), SHAPE_EVERY))
    assert len(table["team"]) == 2 * frames
    assert set(table["team"].tolist()) == {0, 1}
    assert np.all(table["length"] > 0) and np.all(table["width"] > 0)
