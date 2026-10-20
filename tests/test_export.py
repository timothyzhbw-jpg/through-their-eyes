"""Viewer export of a hero moment (SPEC 7)."""

import json
import re

import numpy as np
import pytest

from sim.counterfactual import drop_scan_counterfactual
from sim.export import VERSION, export_hero, hero_json, render_payload_fixture

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


# --- render-payload fixture (SPEC 5.3, 7) --------------------------------------------------------


@pytest.fixture(scope="module")
def payload(data):
    return render_payload_fixture(data)


def test_payload_fixture_is_marked_and_has_every_claim_kind(payload):
    assert payload["fixture"] is True
    assert "not verifier output" in payload["note"]
    assert payload["moment"] == "m:decision_after_scan:H8:0075"
    assert {c["kind"] for c in payload["claims"]} == {"observed", "computed", "counterfactual"}
    assert {c["verdict"] for c in payload["claims"]} == {"supported"}


def test_payload_fixture_values_come_from_the_sim(data, payload):
    f, c = data["runs"]["factual"], data["runs"]["counterfactual"]
    claims = {cl["id"]: cl for cl in payload["claims"]}
    lines = {line["id"]: line["text"] for line in payload["lines"]}
    assert claims["scans_before_reception"]["values"] == {"n": 1, "window_s": 2}
    assert claims["scans_before_reception"]["evidence"] == [data["key_scan"]["id"]]
    err = claims["belief_error"]["values"]["err"]
    cf_err = claims["cf_belief_error"]["values"]["err"]
    assert err == round(f["decision"]["belief_error"][data["runner"]], 1)
    assert cf_err == round(c["decision"]["belief_error"][data["runner"]], 1)
    assert cf_err > err  # the look is what put the runner in the right place
    assert c["decision"]["chosen"] == "pass:H4" and "would have passed to H4" in lines["L5"]
    assert claims["cf_value"]["values"]["dxt"] == round(data["delta_xt"], 2)


def test_payload_fixture_lines_claims_and_evidence_resolve(data, payload):
    events = {e["id"]: e for run in data["runs"].values() for e in run["events"]}
    claims = {c["id"]: c for c in payload["claims"]}
    assert {cid for line in payload["lines"] for cid in line["claims"]} == set(claims)
    for c in claims.values():
        assert c["evidence"] and all(e in events for e in c["evidence"])
        assert c["seek_frame"] == min(events[e]["frame"] for e in c["evidence"])
    for line in payload["lines"]:
        if not line["claims"]:
            assert line["text"] == "What did he see?"  # a connective phrase
        # Every number in a caption is a filled value of one of the line's claims.
        text = re.sub(r"\b[HA]\d{1,2}\b", "", line["text"])
        values = {float(v) for cid in line["claims"] for v in claims[cid]["values"].values()}
        assert {float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)} <= values


# --- he thought vs it was (schema v3, SPEC 5.1, 7) ------------------------------------------


def test_every_option_is_scored_on_the_belief_and_on_the_truth(data):
    for run in data["runs"].values():
        for o in run["decision"]["options"]:
            for key in ("p_success", "p_success_true", "value_true", "target_true"):
                assert o[key] is not None, (o["action"], key)
            assert 0.0 <= o["p_success_true"] <= 1.0
            assert o["p_success_true_same_target"] is not None
            if o["action"].startswith("pass:"):
                assert o["receiver"] == o["action"][5:]
                assert len(o["receiver_believed"]) == len(o["receiver_true"]) == 2
            else:
                assert o["receiver"] is o["receiver_believed"] is o["receiver_true"] is None


def test_believed_receiver_positions_are_the_ones_the_decision_used(data):
    for run in data["runs"].values():
        d = run["decision"]
        for o in d["options"]:
            if o["receiver"]:
                gap = np.hypot(*np.subtract(o["receiver_believed"], o["receiver_true"]))
                assert gap == pytest.approx(d["belief_error"][o["receiver"]], abs=1e-3)


def _h9(data, run):
    return next(o for o in data["runs"][run]["decision"]["options"] if o["action"] == "pass:H9")


def test_without_the_look_the_runner_was_on_but_he_did_not_know(data):
    cf = _h9(data, "counterfactual")
    assert cf["p_success"] < 0.1
    assert cf["p_success_true"] - cf["p_success"] > 0.5
    assert cf["prob"] < 0.01
    # His target for H9 was where he last saw him: held fixed, the truth says nothing arrives.
    assert cf["p_success_true_same_target"] < 0.01


def test_with_the_look_belief_and_truth_agree_on_the_chosen_pass(data):
    f = _h9(data, "factual")
    assert data["runs"]["factual"]["decision"]["chosen"] == "pass:H9"
    assert f["p_success_true"] >= f["p_success"] > 0.5
    assert f["p_success_true_same_target"] == pytest.approx(f["p_success_true"], abs=0.02)


def test_payload_fixture_has_he_thought_it_was_claims(data, payload):
    claims = {c["id"]: c for c in payload["claims"]}
    assert claims["pass_success"]["kind"] == "computed"
    assert claims["cf_pass_success"]["kind"] == "counterfactual"
    f, cf = _h9(data, "factual"), _h9(data, "counterfactual")
    assert claims["pass_success"]["values"] == {
        "p_belief": round(f["p_success"], 2),
        "p_true": round(f["p_success_true"], 2),
    }
    assert claims["cf_pass_success"]["values"] == {
        "p_belief": round(cf["p_success"], 2),
        "p_true": round(cf["p_success_true"], 2),
    }


# --- blind-side alerts (schema v4, SPEC 4.4, 7) ----------------------------------------------


def _h8_h9(data, run):
    ids = [p["id"] for p in data["players"]]
    o, t = ids.index("H8"), ids.index("H9")
    frames = data["runs"][run]["blind_side"]["frames"]
    return [next((u for a, b, u in alerts if (a, b) == (o, t)), None) for alerts in frames]


def test_blind_side_alerts_are_exported_per_frame_for_both_runs(data):
    n = len(data["players"])
    for run in data["runs"].values():
        b = run["blind_side"]
        assert len(b["frames"]) == run["frames"]
        for f, alerts in enumerate(b["frames"]):
            for o, t, unseen in alerts:
                assert 0 <= o < n and 0 <= t < n and o != t
                # 0: in sight again but held on by the alert's minimum duration (the viewer then
                # shows it as cleared); never more than f, as everyone is seen at the first frame.
                assert 0 <= unseen <= f
        for a in b["intervals"]:  # every frame of an interval is in the per-frame list
            assert a["start"] <= a["end"] < run["frames"]


def test_with_the_look_the_runner_alert_clears_during_the_key_scan(data):
    key = data["key_scan"]
    unseen = _h8_h9(data, "factual")
    assert unseen[key["start"] - 1] is not None  # on before the look
    cleared = next(f for f in range(key["start"], len(unseen)) if unseen[f] is None)
    assert key["start"] <= cleared <= key["end"]
    on = [u for u in unseen[: key["start"]] if u is not None]
    assert on == sorted(on) and len(set(on)) == len(on)  # the unseen time only grows


def test_without_the_look_the_runner_alert_stays_on_until_the_pass(data):
    decision = data["runs"]["counterfactual"]["decision"]["frame"]
    unseen = _h8_h9(data, "counterfactual")
    on = [f for f, u in enumerate(unseen) if u is not None]
    assert on == list(range(on[0], decision + 1))
    assert on[0] < data["key_scan"]["start"]


# --- the scan detector at work (schema v5, SPEC 4.7, 7) --------------------------------------


@pytest.fixture(scope="module")
def runs():
    result = drop_scan_counterfactual(SCENARIO, SEED)
    return {"factual": result.factual, "counterfactual": result.counterfactual}


def test_the_detector_parameters_are_the_defaults(data):
    from analytics.scan_detector import DEFAULT_PARAMS as P

    assert data["units"]["angular_velocity"] == "1e-4 rad/s"
    assert data["scan_detector"] == {
        "omega_threshold": round(P.omega_threshold * 1e4),
        "min_excursion": round(P.min_excursion * 1e4),
        "return_tolerance": round(P.return_tolerance * 1e4),
        "onset_frames": P.onset_frames,
        "max_duration_s": P.max_duration_s,
    }


def test_exported_detector_output_is_the_detector_run_directly(data, runs):
    """On the tracked head yaw, as eval/scan_detector.py runs it; survives the JSON round trip."""
    from analytics.scan_detector import DEFAULT_PARAMS, detect_all, trace_scans

    decoded = json.loads(hero_json(data))
    for name, run in runs.items():
        exported = decoded["runs"][name]["scan_detector"]
        n = len(run.players)
        assert len(exported["omega"]) == len(run.owner) - 1
        assert all(len(row) == n for row in exported["omega"])
        assert len(exported["onsets"]) == len(exported["scans"]) == n
        ball = run.ball_pos[:, :2]
        direct = detect_all(run.head_yaw_observed, run.pos, ball, run.dt, DEFAULT_PARAMS)
        omega = np.array(exported["omega"]) * 1e-4
        for i in range(n):
            t = trace_scans(run.head_yaw_observed[:, i], run.pos[:, i], ball, run.dt)
            assert exported["onsets"][i] == t.onsets.tolist()
            assert np.abs(omega[:, i] - t.omega).max() <= 0.5e-4 + 1e-9
            scans = exported["scans"][i]
            assert [(s["start"], s["end"], s["peak"], s["side"]) for s in scans] == [
                (d.start, d.end, d.peak, d.side) for d in direct[i]
            ]
            for s, d in zip(scans, direct[i], strict=True):
                assert abs(s["amplitude"] * 1e-4 - d.amplitude) <= 0.5e-4 + 1e-9
                assert s["start"] in exported["onsets"][i]


def test_the_exported_detector_matches_the_eval_on_the_straight_run(data):
    """The factual run resumed from the snapshot is the run eval/scan_detector.py simulates."""
    from analytics.scan_detector import ScanDetectorParams, detect_all
    from eval.scan_detector import scenario_params, simulate

    s = simulate(SCENARIO, SEED, scenario_params(SCENARIO))
    found = detect_all(s.head_yaw, s.pos, s.ball, s.dt, ScanDetectorParams())
    exported = data["runs"]["factual"]["scan_detector"]["scans"]
    assert [[d["start"] for d in p] for p in exported] == [[d.start for d in p] for p in found]


def test_the_detector_finds_the_key_scan_only_with_the_look(data):
    ids = [p["id"] for p in data["players"]]
    hero, key = ids.index(data["hero"]), data["key_scan"]
    f = data["runs"]["factual"]["scan_detector"]
    c = data["runs"]["counterfactual"]["scan_detector"]

    def near_key(scans):
        return [s for s in scans if abs(s["start"] - key["start"]) <= 3]

    assert len(near_key(f["scans"][hero])) == 1
    assert near_key(c["scans"][hero]) == []
    # A turn the gate rejected: an onset outside every accepted scan (the panel shows these).
    scans = f["scans"][hero]
    assert any(not any(s["start"] <= o <= s["end"] for s in scans) for o in f["onsets"][hero])
