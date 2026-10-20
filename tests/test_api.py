"""Acceptance checks for the API service (SPEC 2, 8): live stream, moments, cached breakdowns."""

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import Settings
from tests.test_agents import _good_replies

MATCH = "blind_side_run-3"


@pytest.fixture(scope="module")
def settings(tmp_path_factory):
    return Settings(
        matches=[("blind_side_run", 3)],
        cache_dir=tmp_path_factory.mktemp("cache"),
        rate_limit=(2, 600.0),
        web_origin="*",
    )


@pytest.fixture(scope="module")
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_health_and_match_list(client):
    health = client.get("/health").json()
    assert health["status"] == "ok" and health["model"] == "offline"
    matches = client.get("/api/matches").json()
    assert [m["id"] for m in matches] == [MATCH]
    assert client.get("/api/matches/nope-1").status_code == 404


def test_export_is_the_viewer_data(client):
    data = client.get(f"/api/matches/{MATCH}/export").json()
    assert set(data["runs"]) == {"factual", "counterfactual"}
    assert data["hero"] == "H8"


def test_moments_include_the_hero_card(client):
    cards = client.get(f"/api/matches/{MATCH}/moments").json()
    hero = next(c for c in cards if c["id"] == "m:decision_after_scan:H8:0075")
    assert hero["selected_lens"] == "scan"


# --- live stream (SPEC 2: the sim replayed at wall-clock speed as the ingest) --------------------


def _drain(ws):
    messages = []
    while True:
        m = ws.receive_json()
        messages.append(m)
        if m["type"] == "end":
            return messages


def test_live_stream_replays_frames_events_and_moments_in_order(client):
    export = client.get(f"/api/matches/{MATCH}/export").json()
    n = export["runs"]["factual"]["frames"]
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=1000") as ws:
        messages = _drain(ws)
    hello = messages[0]
    assert hello["type"] == "hello" and hello["frames"] == n and hello["dt"] == pytest.approx(0.04)
    frames = [m["f"] for m in messages if m["type"] == "frame"]
    assert frames == list(range(n))
    seen = -1
    for m in messages:  # every event and moment arrives after the frame it belongs to
        if m["type"] == "frame":
            seen = m["f"]
        elif m["type"] == "event":
            assert m["event"]["frame"] <= seen
        elif m["type"] == "moment":
            assert m["card"]["frame_end"] <= seen
    kinds = {m["event"]["type"] for m in messages if m["type"] == "event"}
    assert {"pass", "reception", "scan"} <= kinds
    moments = [m["card"]["id"] for m in messages if m["type"] == "moment"]
    assert "m:decision_after_scan:H8:0075" in moments
    first = next(m for m in messages if m["type"] == "frame")
    assert len(first["pos"]) == 2 * len(hello["players"]) and "sprint" in first


def test_live_stream_can_seek_and_stop(client):
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=50") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "seek", "f": 120})
        while (m := ws.receive_json())["type"] != "frame" or m["f"] < 120:
            pass
        assert m["f"] == 120
        ws.send_json({"type": "stop"})
        while (m := ws.receive_json())["type"] != "end":
            pass


# --- breakdowns: cached by content hash, regeneration rate-limited (SPEC 2) ----------------------


def test_breakdown_is_computed_once_then_served_from_the_cache(client):
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    first = client.post("/api/breakdowns", json=body).json()
    second = client.post("/api/breakdowns", json=body).json()
    assert first["cached"] is False and second["cached"] is True
    assert first["key"] == second["key"] and first["source"] == "offline"
    assert second["result"]["scripts"][0]["payload"]["lines"]
    assert second["result"] == first["result"]


def test_the_cache_survives_a_restart(settings):
    body = {"match": MATCH, "personas": ["casual"], "languages": ["zh"]}
    with TestClient(create_app(settings)) as c:
        assert c.post("/api/breakdowns", json=body).json()["cached"] is False
    with TestClient(create_app(settings)) as c:
        assert c.post("/api/breakdowns", json=body).json()["cached"] is True


def test_regeneration_with_a_model_is_rate_limited_per_client(settings, tmp_path):
    from agents.context import MomentContext
    from agents.testing import FakeChatClient

    fresh = Settings(matches=settings.matches, cache_dir=tmp_path, rate_limit=(2, 600.0),
                     web_origin="*")  # fmt: skip
    fake = FakeChatClient(_good_replies(MomentContext.load("blind_side_run", 3)))
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"], "regenerate": True}
    with TestClient(create_app(fresh, client=fake, model_id="fake-model")) as c:
        assert c.get("/health").json()["model"] == "fake-model"
        r1, r2, r3 = (c.post("/api/breakdowns", json=body) for _ in range(3))
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["source"] == "model"
    assert r3.status_code == 200
    assert r3.json()["rate_limited"] is True and r3.json()["cached"] is True


def test_unknown_moment_is_404(client):
    body = {"match": MATCH, "moment": "m:sprint:H9:0085"}
    assert client.post("/api/breakdowns", json=body).status_code == 404


# --- what-if and the audit log -------------------------------------------------------------------


def test_what_if_answers_are_verified_and_cached(client):
    body = {"match": MATCH, "question": "What if he passed to H4?", "language": "en"}
    first = client.post("/api/whatif", json=body).json()
    again = client.post("/api/whatif", json=body).json()
    assert first["answer"]["action"] == "pass:H4" and first["cached"] is False
    assert again["cached"] is True
    claims = first["answer"]["payload"]["claims"]
    assert {c["kind"] for c in claims} == {"counterfactual"}
    refused = client.post("/api/whatif", json={**body, "question": "What if he scored?"}).json()
    assert refused["answer"]["refusal"] and refused["answer"]["payload"] is None


def test_audit_log_lists_the_verdicts(client):
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    client.post("/api/breakdowns", json=body)
    records = client.get(f"/api/matches/{MATCH}/audit?limit=5").json()
    assert 0 < len(records) <= 5
    assert {"claim", "verdict", "decided_at"} <= set(records[0])


def test_tts_needs_speech(client):
    r = client.post("/api/tts", json={"ssml": "<speak/>"})
    assert r.status_code == 503
