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


def test_live_frames_carry_the_blind_side_alerts(client):
    """The H9 alert behind H8 is on before the key scan and gone once H8 has looked (SPEC 4.4)."""
    export = client.get(f"/api/matches/{MATCH}/export").json()
    ids = [p["id"] for p in export["players"]]
    h8, h9 = ids.index("H8"), ids.index("H9")
    key = export["key_scan"]
    with client.websocket_connect(f"/ws/matches/{MATCH}/live?speed=1000") as ws:
        frames = {m["f"]: m for m in _drain(ws) if m["type"] == "frame"}
    run = export["runs"]["factual"]
    assert all(frames[f]["blind_side"] == run["blind_side"]["frames"][f] for f in frames)

    def on(f):
        return any((o, t) == (h8, h9) for o, t, _ in frames[f]["blind_side"])

    assert on(key["start"] - 1)
    assert not on(key["end"])
    unseen = next(u for o, t, u in frames[key["start"] - 1]["blind_side"] if (o, t) == (h8, h9))
    assert unseen * export["dt"] >= 1.0


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


# --- the global daily cap on model-backed regenerations (SPEC 8) ----------------------------------


@pytest.fixture(scope="module")
def replies():
    from agents.context import MomentContext

    ctx = MomentContext.load("blind_side_run", 3)
    return {**_good_replies(ctx), "whatif": {"action": "pass:H4"}}


def _capped(settings, cache_dir, replies, cap):
    """An app with a model, a per-client limit that never binds, and a daily cap of `cap`."""
    from agents.testing import FakeChatClient

    fresh = Settings(matches=settings.matches, cache_dir=cache_dir, rate_limit=(100, 600.0),
                     web_origin="*", daily_model_cap=cap)  # fmt: skip
    fake = FakeChatClient(replies)
    return create_app(fresh, client=fake, model_id="fake-model"), fake


def test_daily_model_cap_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("TTE_DAILY_MODEL_CAP", raising=False)
    assert Settings.from_env().daily_model_cap == 40
    monkeypatch.setenv("TTE_DAILY_MODEL_CAP", "5")
    assert Settings.from_env().daily_model_cap == 5


def test_past_the_daily_cap_breakdowns_serve_the_cache_or_the_template(settings, tmp_path, replies):
    app, fake = _capped(settings, tmp_path, replies, cap=1)
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"], "regenerate": True}
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=body).json()
        again = c.post("/api/breakdowns", json=body).json()
        uncached = c.post("/api/breakdowns", json={**body, "languages": ["zh"]}).json()
    assert first["source"] == "model" and first["capped"] is False
    assert again["capped"] is True and again["rate_limited"] is False
    assert again["cached"] is True and again["key"] == first["key"] and again["source"] == "model"
    assert uncached["capped"] is True and uncached["cached"] is False
    assert uncached["source"] == "offline" and uncached["result"]["scripts"]
    assert fake.calls["director"] == 1  # one model-backed regeneration in all


def test_the_daily_cap_is_shared_by_breakdowns_and_whatif_across_clients(
    settings, tmp_path, replies
):
    app, fake = _capped(settings, tmp_path, replies, cap=2)
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"], "regenerate": True}
    question = {"match": MATCH, "question": "What if he passed to H4?", "language": "en"}

    def ip(n):
        return {"x-forwarded-for": f"203.0.113.{n}"}

    with TestClient(app) as c:
        b = c.post("/api/breakdowns", json=body, headers=ip(1)).json()
        w1 = c.post("/api/whatif", json=question, headers=ip(2)).json()
        calls = dict(fake.calls)
        w2 = c.post("/api/whatif", json=question, headers=ip(3)).json()
        w3 = c.post("/api/whatif", json={**question, "language": "zh"}, headers=ip(4)).json()
    assert b["source"] == "model" and b["capped"] is False
    assert w1["answer"]["source"] == "llm" and w1["capped"] is False
    assert w2["capped"] is True and w2["cached"] is True  # the cached answer
    assert w2["answer"]["action"] == "pass:H4"
    assert w3["capped"] is True and w3["cached"] is False  # no cache: the rule mapper
    assert w3["answer"]["source"] == "template" and w3["answer"]["action"] == "pass:H4"
    assert fake.calls == calls and calls["director"] == 1  # no model call once capped


def test_the_daily_cap_resets_at_utc_midnight():
    from datetime import UTC, datetime, timedelta, timezone

    from api.store import DailyCap

    now = [datetime(2026, 10, 27, 23, 59, tzinfo=UTC)]
    cap = DailyCap(2, clock=lambda: now[0])
    assert cap.take() and cap.take() and not cap.take()
    now[0] = datetime(2026, 10, 28, 1, 0, tzinfo=timezone(timedelta(hours=2)))  # still the 27th UTC
    assert not cap.take()
    now[0] = datetime(2026, 10, 28, 0, 0, tzinfo=UTC)
    assert cap.left() == 2 and cap.take() and cap.left() == 1
    assert not DailyCap(0).take()


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
