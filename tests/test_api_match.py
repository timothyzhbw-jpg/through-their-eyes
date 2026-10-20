"""The API serves a stitched match and the pressure hero (SPEC 2, 3.1, 5.2, 6)."""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import DEFAULT_MATCHES, Settings, _matches

MATCH = "match-1"
PRESS = "press_escape-0"


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


def _drain(ws):
    messages = []
    while (m := ws.receive_json())["type"] != "end":
        messages.append(m)
    return messages


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
        assert ids == ["blind_side_run-3", MATCH, PRESS]
        possessions = c.get(f"/api/matches/{MATCH}").json()["possessions"]
        heroes = [f"{p['scenario']}-{p['seed']}" for p in possessions if p["hero_moment"]]
        assert heroes == ["blind_side_run-3", PRESS]
        assert c.get(f"/api/matches/{PRESS}/export").status_code == 200


def test_deploy_and_env_example_default_to_the_same_matches():
    root = Path(__file__).resolve().parents[1]
    deploy = re.search(
        r"TTE_MATCHES=\$\{TTE_MATCHES:-([^}]*)\}", (root / "infra/deploy.sh").read_text()
    )
    example = re.search(r"^TTE_MATCHES=(.*)$", (root / ".env.example").read_text(), re.MULTILINE)
    assert deploy and example
    assert _matches(deploy.group(1)) == _matches(example.group(1)) == DEFAULT_MATCHES


def test_the_match_is_listed_with_its_possessions_and_both_hero_moments(client, info):
    ids = [m["id"] for m in client.get("/api/matches").json()]
    assert ids == [MATCH, PRESS]
    assert info["kind"] == "match" and info["hero"] is None
    assert len(info["possessions"]) == 6
    assert info["score"] == {"home": 0, "away": 0}
    heroes = info["hero_moments"]
    assert [h.split(":")[1:3] for h in heroes] == [
        ["decision_after_scan", "H8"], ["pressed_decision", "H4"]
    ]  # fmt: skip


def test_moments_are_detected_across_the_match(client, info):
    cards = client.get(f"/api/matches/{MATCH}/moments").json()
    hero = {c["id"]: c for c in cards if c["hero"]}
    assert list(hero) == info["hero_moments"]
    assert [c["selected_lens"] for c in hero.values()] == ["scan", "pressure"]
    assert {c["possession"] for c in cards} >= {1, 3}
    assert [c["anchor_frame"] for c in cards] == sorted(c["anchor_frame"] for c in cards)


def test_the_live_stream_replays_the_match_across_possessions(client, info):
    boundary = info["possessions"][3]["start"]
    start = boundary - 30
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=1000&start={start}") as ws:
        hello = ws.receive_json()
        messages = _drain(ws)
    assert hello["type"] == "hello" and hello["frames"] == info["frames"]
    assert hello["kind"] == "match"
    frames = [m["f"] for m in messages if m["type"] == "frame"]
    assert frames == list(range(start, info["frames"]))
    seen = -1
    for m in messages:
        if m["type"] == "frame":
            seen = m["f"]
        elif m["type"] == "event":
            assert m["event"]["frame"] <= seen
        elif m["type"] == "moment":
            assert m["card"]["frame_end"] <= seen
    events = [m["event"] for m in messages if m["type"] == "event"]
    assert {e["possession"] for e in events} >= {3, 4, 5}
    moments = [m["card"]["id"] for m in messages if m["type"] == "moment"]
    assert info["hero_moments"][1] in moments


def test_a_breakdown_of_the_pressure_moment_inside_the_match(client, info):
    moment = info["hero_moments"][1]
    body = {"match": MATCH, "moment": moment, "personas": ["analyst"], "languages": ["en"]}
    out = client.post("/api/breakdowns", json=body).json()
    result = out["result"]
    assert result["findings"]["lens"] == "pressure"
    assert result["request"]["moment"] == out["possession"]["local_moment"]
    assert out["possession"]["index"] == 3
    assert out["possession"]["start"] == info["possessions"][3]["start"]
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
    body = {"match": MATCH, "moment": info["hero_moments"][1], "question": "What if he carried it?"}
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
