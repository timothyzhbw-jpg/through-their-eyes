"""The API serves a stitched match and the pressure hero (SPEC 2, 3.1, 5.2, 6)."""

import gzip
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import DEFAULT_MATCHES, Settings, _matches
from api.store import Match
from sim.match import DEFAULT_PLAN

MATCH = "match-1"
PRESS = "press_escape-0"
CORNER = "corner_blind_side-0"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    settings = Settings(
        matches=[("match", 1), ("press_escape", 0)],
        cache_dir=tmp_path_factory.mktemp("cache"),
        rate_limit=(2, 600.0),
        web_origin="*",
    )
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture(scope="module")
def info(client):
    return client.get(f"/api/matches/{MATCH}").json()


def _possession(info, scenario):
    return next(p for p in info["possessions"] if p["scenario"] == scenario)


def test_tte_matches_names_a_stitched_match():
    assert _matches("blind_side_run:3,match:1,press_escape:0") == [
        ("blind_side_run", 3), ("match", 1), ("press_escape", 0)
    ]  # fmt: skip
    assert ("match", 1) in DEFAULT_MATCHES and ("blind_side_run", 3) in DEFAULT_MATCHES


def test_the_defaults_serve_the_match_and_each_hero_possession(tmp_path, monkeypatch):
    # The web app opens a hero moment of the match from its possession's own export (SPEC 2, 3.1).
    monkeypatch.delenv("TTE_MATCHES", raising=False)
    settings = Settings.from_env()
    settings.cache_dir = tmp_path
    with TestClient(create_app(settings)) as c:
        ids = [m["id"] for m in c.get("/api/matches").json()]
        assert ids == ["blind_side_run-3", CORNER, MATCH, "match-2", PRESS]
        possessions = c.get(f"/api/matches/{MATCH}").json()["possessions"]
        heroes = [f"{p['scenario']}-{p['seed']}" for p in possessions if p["hero_moment"]]
        assert heroes == ["blind_side_run-3", PRESS, "far_post_finish-11", CORNER]
        for hero in heroes:
            assert c.get(f"/api/matches/{hero}/export").status_code == 200
        # match-2: the same heroes on other gated seeds, in another order (sim/match.py MATCH_2).
        two = c.get("/api/matches/match-2").json()
        assert [h.split(":")[1:3] for h in two["hero_moments"]] == [
            ["pressed_decision", "H4"], ["marker_scan", "H5"], ["decision_after_scan", "H8"]
        ]  # fmt: skip
        heroes = [f"{p['scenario']}-{p['seed']}" for p in two["possessions"] if p["hero_moment"]]
        assert heroes == ["press_escape-1", "corner_blind_side-2", "blind_side_run-11"]
        for hero in heroes:  # served, though TTE_MATCHES does not list them
            assert c.get(f"/api/matches/{hero}/export").status_code == 200


def test_a_service_from_the_environment_loads_its_matches_before_the_first_request(
    tmp_path, monkeypatch
):
    # The stitched match takes longer to simulate on 0.5 vCPU than the web app waits for its
    # export (15 s): a new revision that loaded it on the first request served offline data
    # (found live on 2026-10-20). Warm, the lifespan loads every match before uvicorn opens its
    # port.
    monkeypatch.delenv("TTE_WARM", raising=False)
    assert Settings.from_env().warm and not Settings().warm
    settings = Settings(matches=[("blind_side_run", 3), ("press_escape", 0)], cache_dir=tmp_path)
    # The teaching scenario is served (not listed) whatever the settings, so it is warmed too.
    for warm, loaded in ((True, {"blind_side_run-3", PRESS, "pro_scan-126"}), (False, set())):
        settings.warm = warm
        app = create_app(settings)
        with TestClient(app):
            assert set(app.state.store._loaded) == loaded


def test_tte_warm_0_loads_each_match_on_its_first_request(monkeypatch):
    monkeypatch.setenv("TTE_WARM", "0")
    assert not Settings.from_env().warm


def test_deploy_and_env_example_default_to_the_same_matches():
    root = Path(__file__).resolve().parents[1]
    deploy = re.search(
        r"TTE_MATCHES=\$\{TTE_MATCHES:-([^}]*)\}", (root / "infra/deploy.sh").read_text()
    )
    example = re.search(r"^TTE_MATCHES=(.*)$", (root / ".env.example").read_text(), re.MULTILINE)
    assert deploy and example
    assert _matches(deploy.group(1)) == _matches(example.group(1)) == DEFAULT_MATCHES


def test_an_export_is_serialised_once_with_nan_as_null():
    # As FastAPI serialised it per request: a hero export has NaN where a value is undefined.
    m = Match("x", "x", 0, {}, {"a": float("nan"), "b": [1.5, float("inf")], "c": "é"}, [], [])
    assert json.loads(m.export_json) == {"a": None, "b": [1.5, None], "c": "é"}
    assert gzip.decompress(m.export_gzip) == m.export_json


def test_a_matchs_hero_possessions_are_served_without_being_listed(client, info):
    # The web app opens a hero moment from its possession's own export, so the service serves it
    # even when TTE_MATCHES does not list it (here: only match-1 and the pressure hero).
    assert [m["id"] for m in client.get("/api/matches").json()] == [MATCH, PRESS]
    for p in info["possessions"]:
        if p["hero_moment"]:
            r = client.get(f"/api/matches/{p['scenario']}-{p['seed']}/export")
            assert r.status_code == 200 and r.json()["hero"] == p["hero"]
    assert client.get("/api/matches/blind_side_run-4/export").status_code == 404


def test_the_teaching_scenario_is_served_without_being_listed(client):
    # The scan story links to the coach's example (SPEC 3.6, "Teaching"): `?match=pro_scan-126`.
    assert "pro_scan-126" not in [m["id"] for m in client.get("/api/matches").json()]
    r = client.get("/api/matches/pro_scan-126/export")
    assert r.status_code == 200 and r.json()["hero"] == "H8"
    assert client.get("/api/matches/pro_scan-127/export").status_code == 404


def test_the_match_is_listed_with_its_possessions_and_its_hero_moments(client, info):
    ids = [m["id"] for m in client.get("/api/matches").json()]
    assert ids == [MATCH, PRESS]
    assert info["kind"] == "match" and info["hero"] is None
    assert len(info["possessions"]) == len(DEFAULT_PLAN)
    assert info["score"] == {"home": 1, "away": 0}
    heroes = info["hero_moments"]
    assert [h.split(":")[1:3] for h in heroes] == [
        ["decision_after_scan", "H8"], ["pressed_decision", "H4"], ["decision_after_scan", "H9"],
        ["marker_scan", "H5"]
    ]  # fmt: skip


def test_the_export_is_served_compressed_when_the_client_accepts_it(client, info):
    # About 12 MB of JSON for the whole match; the web app's export request gives up at 15 s.
    url = f"/api/matches/{MATCH}/export"
    gz = client.get(url, headers={"Accept-Encoding": "gzip"})
    plain = client.get(url, headers={"Accept-Encoding": "identity"})
    assert gz.headers["content-encoding"] == "gzip"
    assert "content-encoding" not in plain.headers
    assert int(gz.headers["content-length"]) < len(plain.content) / 2
    assert gz.json() == plain.json()
    assert plain.json()["runs"]["factual"]["frames"] == info["frames"]


def test_moments_are_detected_across_the_match(client, info):
    cards = client.get(f"/api/matches/{MATCH}/moments").json()
    hero = {c["id"]: c for c in cards if c["hero"]}
    assert list(hero) == info["hero_moments"]
    assert [c["selected_lens"] for c in hero.values()] == ["scan", "pressure", "scan", "scan"]
    played = {p["index"] for p in info["possessions"] if p["hero_moment"]}
    assert played <= {c["possession"] for c in cards}
    assert [c["anchor_frame"] for c in cards] == sorted(c["anchor_frame"] for c in cards)


def test_the_live_stream_replays_the_match_across_possessions(client, info):
    possessions = info["possessions"]
    i = next(i for i, p in enumerate(possessions) if p["scenario"] == "press_escape")
    pressure, following = possessions[i], possessions[i + 1]
    start = pressure["start"] - 30
    moment_id = pressure["hero_moment"]
    assert moment_id
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=1000&start={start}") as ws:
        hello = ws.receive_json()
        messages = []
        seen_moment = seen_next = stopped = False
        while (m := ws.receive_json())["type"] != "end":
            messages.append(m)
            if m["type"] == "moment" and m["card"]["id"] == moment_id:
                seen_moment = True
            elif m["type"] == "event" and m["event"]["possession"] == following["index"]:
                seen_next = True
            if seen_moment and seen_next and not stopped:
                ws.send_json({"type": "stop"})
                stopped = True
    assert hello["type"] == "hello" and hello["frames"] == info["frames"]
    assert hello["kind"] == "match"
    frames = [m["f"] for m in messages if m["type"] == "frame"]
    assert frames and frames == list(range(start, start + len(frames)))
    seen = -1
    for m in messages:
        if m["type"] == "frame":
            seen = m["f"]
        elif m["type"] == "event":
            assert m["event"]["frame"] <= seen
        elif m["type"] == "moment":
            assert m["card"]["frame_end"] <= seen
    events = [m["event"] for m in messages if m["type"] == "event"]
    assert {pressure["index"], following["index"]} <= {e["possession"] for e in events}
    moments = [m["card"]["id"] for m in messages if m["type"] == "moment"]
    assert moment_id in moments


def test_a_breakdown_of_the_pressure_moment_inside_the_match(client, info):
    pressure = _possession(info, "press_escape")
    moment = pressure["hero_moment"]
    body = {"match": MATCH, "moment": moment, "personas": ["analyst"], "languages": ["en"]}
    out = client.post("/api/breakdowns", json=body).json()
    result = out["result"]
    assert result["findings"]["lens"] == "pressure"
    assert result["request"]["moment"] == out["possession"]["local_moment"]
    assert out["possession"]["index"] == pressure["index"]
    assert out["possession"]["start"] == pressure["start"]
    claims = {c for line in result["scripts"][0]["payload"]["lines"] for c in line["claims"]}
    assert {"pressure_at_pass", "cf_carry_lost"} <= claims
    again = client.post("/api/breakdowns", json=body).json()
    assert again["cached"] is True and again["key"] == out["key"]


def test_a_breakdown_needs_a_hero_moment_of_the_match(client):
    cards = client.get(f"/api/matches/{MATCH}/moments").json()
    other = next(c["id"] for c in cards if not c["hero"])
    for moment in (other, "m:nope:H1:0001"):
        body = {"match": MATCH, "moment": moment, "personas": ["casual"], "languages": ["en"]}
        assert client.post("/api/breakdowns", json=body).status_code == 404


def test_what_if_he_had_kept_the_ball(client, info):
    moment = _possession(info, "press_escape")["hero_moment"]
    body = {"match": MATCH, "moment": moment, "question": "What if he carried it?"}
    answer = client.post("/api/whatif", json=body).json()["answer"]
    assert answer["action"] == "carry"
    assert all(c["verdict"] == "supported" for c in answer["payload"]["claims"])
    assert any(c["id"] == "whatif_outcome" for c in answer["payload"]["claims"])


def test_the_pressure_hero_on_its_own(client):
    data = client.get(f"/api/matches/{PRESS}/export").json()
    assert data["key_scan"] is None
    assert data["counterfactual"] == {"id": "cf1", "intervention": "force_action",
                                      "action": "carry"}  # fmt: skip
    assert data["runs"]["counterfactual"]["decision"]["chosen"] == "carry"
    out = client.post(
        "/api/breakdowns", json={"match": PRESS, "personas": ["casual"], "languages": ["zh"]}
    ).json()
    assert out["result"]["findings"]["lens"] == "pressure"
    assert out["result"]["plan_source"] == "template"
    assert not any(s["do"] == "scan_marker" for s in out["result"]["plan"]["steps"])


def test_a_wrong_number_is_checked_against_the_hero_moment_it_belongs_to(client, info):
    # Inside the stitched match the evidence card asks about its possession's hero (SPEC 3.1, 7).
    second = _possession(info, "press_escape")["hero_moment"]
    body = {"match": MATCH, "claim": "pressure_at_pass", "slot": "pressure", "value": 50}
    own = client.post("/api/verify", json={**body, "match": PRESS}).json()
    assert own["verified_value"] == 95 and own["status"] == "refuted"
    r = client.post("/api/verify", json={**body, "moment": second})
    assert r.status_code == 200
    assert {k: r.json()[k] for k in ("verified_value", "status", "line")} == {
        k: own[k] for k in ("verified_value", "status", "line")
    }
    first = client.post("/api/verify", json=body).json()  # no moment: the first hero (H8)
    assert first["verified_value"] == 0 != own["verified_value"]
    assert client.post("/api/verify", json={**body, "moment": "nope"}).status_code == 404


def test_the_pressure_hero_is_described_for_listeners(client):
    # Audio description (SPEC 1) on a hero without a key scan: no scan lines, no analyst numbers.
    from agents.delivery import ANALYST_NUMBERS

    body = {"match": PRESS, "personas": ["audio_description"], "languages": ["en", "zh"]}
    r = client.post("/api/breakdowns", json=body)
    assert r.status_code == 200
    for script in r.json()["result"]["scripts"]:
        lines = script["payload"]["lines"]
        claims = {c for line in lines for c in line["claims"]}
        assert lines and not script["dropped"]
        assert "heavy_pressure" in claims and "reception_zone" in claims
        assert not claims & ANALYST_NUMBERS
        assert not claims & {"scan_side", "seen_in_scan", "scan_before_reception"}
