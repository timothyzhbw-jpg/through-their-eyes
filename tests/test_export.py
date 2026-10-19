"""Viewer export of a hero moment (SPEC 7)."""

import json
from pathlib import Path

import numpy as np
import pytest

from sim.counterfactual import drop_scan_counterfactual
from sim.export import VERSION, export_hero

SCENARIO, SEED = "blind_side_run", 3
WEB_DATA = Path(__file__).parent.parent / "web" / "public" / "data" / "hero_seed3.json"


@pytest.fixture(scope="module")
def data():
    return export_hero(SCENARIO, SEED)


def test_export_is_json_with_both_runs(data):
    json.dumps(data)
    assert set(data["runs"]) == {"factual", "counterfactual"}
    for run in data["runs"].values():
        n = run["frames"]
        assert len(run["pos"]) == len(run["ghost"]) == len(run["seen"]) == len(run["ball"]) == n
        assert run["decision"]["player"] == data["hero"]


def test_exported_tracking_matches_the_counterfactual_runs_within_a_millimetre(data):
    result = drop_scan_counterfactual(SCENARIO, SEED)
    for name, run in (("factual", result.factual), ("counterfactual", result.counterfactual)):
        exported = np.array(data["runs"][name]["pos"]).reshape(run.pos.shape) / 1000
        assert np.abs(exported - run.pos).max() <= 0.0005 + 1e-12
        assert data["runs"][name]["decision"]["chosen"] == run.hero_decision().chosen


def test_runs_are_identical_until_the_key_scan_and_differ_after(data):
    f, c = data["runs"]["factual"], data["runs"]["counterfactual"]
    start = data["key_scan"]["start"]
    assert f["head"][: start + 1] == c["head"][: start + 1]
    assert f["head"][start + 1] != c["head"][start + 1]


def test_the_hero_ghost_is_himself(data):
    i = [p["id"] for p in data["players"]].index(data["hero"])
    run = data["runs"]["factual"]
    for frame in (0, run["frames"] // 2, run["frames"] - 1):
        assert run["ghost"][frame][2 * i : 2 * i + 2] == run["pos"][frame][2 * i : 2 * i + 2]


def test_every_player_sight_is_exported_and_matches_the_hero_row(data):
    n = len(data["players"])
    i = [p["id"] for p in data["players"]].index(data["hero"])
    for run in data["runs"].values():
        assert len(run["seen_by"]) == run["frames"]
        assert all(len(row) == n for row in run["seen_by"])
        assert [row[i] for row in run["seen_by"]] == run["seen"]
        # V[i, i] = 1: every observer counts himself as seen.
        assert all((row[j] >> j) & 1 for row in run["seen_by"] for j in range(n))


def test_counterfactual_and_vision_metadata(data):
    assert data["version"] == VERSION
    assert data["counterfactual"]["intervention"] == "drop_scan"
    assert data["counterfactual"]["scan"] == data["key_scan"]["id"]
    v = data["vision"]
    assert v["half_cone"] == round(np.deg2rad(60.0) * 1e4)
    assert v["min_half_cone"] < v["half_cone"]
    assert v["distance_sigma"] == 50_000


def test_committed_web_data_has_the_current_schema(data):
    """web/ ships a pre-built export; it must be regenerated when the schema changes.

    Values are not compared byte for byte: output is identical only within one environment
    (SPEC 3.7), and the file is built on a laptop while CI runs on x86.
    """
    committed = json.loads(WEB_DATA.read_text())
    assert committed["version"] == VERSION
    assert set(committed) == set(data)
    assert committed["key_scan"] == data["key_scan"]
    for name, run in data["runs"].items():
        assert set(committed["runs"][name]) == set(run)
        assert committed["runs"][name]["frames"] == run["frames"]
        assert committed["runs"][name]["decision"]["chosen"] == run["decision"]["chosen"]
