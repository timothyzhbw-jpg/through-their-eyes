"""Viewer export of a hero moment (SPEC 7)."""

import json

import numpy as np
import pytest

from sim.counterfactual import drop_scan_counterfactual
from sim.export import export_hero

SCENARIO, SEED = "blind_side_run", 3


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
