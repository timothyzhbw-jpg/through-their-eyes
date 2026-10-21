"""The end-of-match recap over the API (SPEC 2, 6): cached and limited like a breakdown."""

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import Settings

MATCH = "match-1"
PRESS = "press_escape-0"
ROLES = ("director", "analyst", "telestrator", "pbp", "color")


@pytest.fixture(scope="module")
def settings(tmp_path_factory):
    return Settings(
        matches=[("match", 1), ("press_escape", 0)],
        cache_dir=tmp_path_factory.mktemp("cache"),
        rate_limit=(2, 600.0),
        web_origin="*",
        analyst_mcp=False,
    )


@pytest.fixture(scope="module")
def client(settings):
    with TestClient(create_app(settings, model_id=None)) as c:
        yield c


@pytest.fixture(scope="module")
def casual(client):
    r = client.post("/api/recaps", json={"match": MATCH, "personas": ["casual"],
                                         "languages": ["en"]})  # fmt: skip
    assert r.status_code == 200, r.text
    return r.json()


def test_a_stitched_match_gets_an_offline_recap_then_the_cached_one(client, casual):
    assert casual["source"] == "offline" and not casual["cached"]
    result = casual["result"]
    assert 3 <= len(result["moments"]) <= 5
    (script,) = result["scripts"]
    assert (script["persona"], script["language"]) == ("casual", "en")
    assert script["card"]["lines"][0]["text"].startswith("Full time:")
    again = client.post("/api/recaps", json={"match": MATCH, "personas": ["casual", "casual"],
                                             "languages": ["en"]}).json()  # fmt: skip
    assert again["cached"] and again["key"] == casual["key"] and again["result"] == result


def test_only_a_stitched_match_has_a_recap(client):
    r = client.post("/api/recaps", json={"match": PRESS})
    assert r.status_code == 404 and "stitched" in r.json()["detail"]
    assert client.post("/api/recaps", json={"match": "nope-1"}).status_code == 404
    bad = client.post("/api/recaps", json={"match": MATCH, "personas": ["pundit"]})
    assert bad.status_code == 422


def test_the_cue_sheet_is_served_by_key_persona_and_language(client, casual):
    key = casual["key"]
    sheet = client.get(f"/api/recaps/{key}/cues", params={"persona": "casual", "language": "en"})
    assert sheet.status_code == 200
    data = sheet.json()
    assert data == casual["result"]["scripts"][0]["cues"]
    assert data["fps"] == 25 and data["cues"][0]["type"] == "score_bug"
    other = client.get(f"/api/recaps/{key}/cues", params={"persona": "analyst", "language": "en"})
    assert other.status_code == 404
    unknown = client.get("/api/recaps/" + "0" * 32 + "/cues",
                         params={"persona": "casual", "language": "en"})  # fmt: skip
    assert unknown.status_code == 404
    params = {"persona": "casual", "language": "en"}
    assert client.get("/api/recaps/x/cues", params=params).status_code == 404


def test_a_recap_line_may_be_spoken(client, casual):
    key = casual["result"]["scripts"][0]["voice"][0]["cache_key"]
    r = client.post("/api/tts", json={"key": key})
    # Known to the speech endpoint (a stranger key answers 404); Speech is not configured here.
    assert r.status_code == 503
    assert client.post("/api/tts", json={"key": "0" * 16}).status_code == 404


def test_the_live_stream_says_full_time_only_at_the_last_frame(client):
    frames = client.get(f"/api/matches/{MATCH}").json()["frames"]
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=1000&start={frames - 5}") as ws:
        while (m := ws.receive_json())["type"] != "end":
            pass
    assert m == {"type": "end", "f": frames, "full_time": True}
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=1&start=0") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "stop"})
        while (m := ws.receive_json())["type"] != "end":
            pass
    assert m["full_time"] is False


def test_past_the_daily_model_cap_the_cached_or_offline_recap_is_served(settings, tmp_path):
    from agents.testing import FakeChatClient

    # A model that is down: every step retries once and runs on its template, as in an outage.
    fake = FakeChatClient({role: RuntimeError("model down") for role in ROLES})
    capped = Settings(matches=settings.matches, cache_dir=tmp_path, rate_limit=(5, 600.0),
                      web_origin="*", analyst_mcp=False, daily_model_cap=1)  # fmt: skip
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["zh"]}
    with TestClient(create_app(capped, client=fake, model_id="fake-model")) as c:
        first = c.post("/api/recaps", json=body).json()
        assert first["source"] == "model" and not first["capped"]
        assert fake.calls["director"] == 2  # the call and its one retry
        calls = dict(fake.calls)
        again = c.post("/api/recaps", json=body).json()  # a cache hit costs nothing
        assert again["cached"] and again["key"] == first["key"]
        other = c.post("/api/recaps", json={**body, "personas": ["coach"]}).json()
        assert other["capped"] and other["source"] == "offline"
        assert dict(fake.calls) == calls  # no model call past the cap
        regen = c.post("/api/recaps", json={**body, "regenerate": True}).json()
        assert regen["capped"] and regen["cached"] and regen["key"] == first["key"]
