"""Acceptance checks for the API service (SPEC 2, 8): live stream, moments, cached breakdowns."""

import dataclasses
import hashlib
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

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


def _app(settings, cache_dir, **limits):
    """A fresh offline app on its own cache, with some settings changed."""
    return create_app(dataclasses.replace(settings, cache_dir=cache_dir, **limits))


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


# --- the live stream is public: bounded per client, in time and in what it accepts (SPEC 2, 8) ---


def _live(c, query="speed=1000", ip=None):
    headers = {"x-forwarded-for": ip} if ip else {}
    return c.websocket_connect(f"/ws/matches/{MATCH}/live?{query}", headers=headers)


def _refusal(ws):
    """(detail, close code) of the error a stream ends with; it must not reach its end first."""
    while (m := ws.receive_json())["type"] != "error":
        assert m["type"] != "end"
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    return m["detail"], closed.value.code


def test_live_streams_are_limited_per_client(settings, tmp_path):
    with TestClient(_app(settings, tmp_path, live_per_client=2)) as c:
        with _live(c, "speed=0.1") as a, _live(c, "speed=0.1") as b:
            assert a.receive_json()["type"] == b.receive_json()["type"] == "hello"
            with _live(c, "speed=0.1") as third:
                detail, code = _refusal(third)
            with _live(c, "speed=0.1", ip="203.0.113.8") as elsewhere:  # another client
                assert elsewhere.receive_json()["type"] == "hello"
        with _live(c) as again:  # both streams closed: their slots are free again
            assert _drain(again)[-1]["type"] == "end"
    assert code == 4429 and "too many live streams" in detail


def test_a_live_session_has_a_time_limit_paused_or_not(settings, tmp_path):
    with TestClient(_app(settings, tmp_path, live_max_s=0.3)) as c, _live(c, "speed=0.1") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "pause"})
        started = time.monotonic()
        detail, code = _refusal(ws)
    assert code == 4408 and "limit" in detail
    assert time.monotonic() - started < 5


@pytest.mark.parametrize(
    "message",
    [
        "{not json",
        "[1, 2]",
        '"pause"',
        "x" * 2000,
        b'{"type": "pause"}',  # binary frames are not control messages
        '{"type": "warp"}',
        '{"type": "seek", "f": 165}',  # one past the last frame
        '{"type": "seek", "f": -1}',
        '{"type": "seek", "f": "12"}',
        '{"type": "seek", "f": 1.5}',
        '{"type": "seek"}',
        '{"type": "speed", "x": NaN}',
        '{"type": "speed", "x": "fast"}',
        '{"type": "speed", "x": true}',
    ],
    ids=lambda m: repr(m)[:28],
)
def test_a_malformed_control_message_closes_the_stream_cleanly(client, message):
    with _live(client, "speed=1") as ws:
        assert ws.receive_json()["type"] == "hello"
        if isinstance(message, bytes):
            ws.send_bytes(message)
        else:
            ws.send_text(message)
        detail, code = _refusal(ws)
    assert code == 4400 and detail


def test_live_speed_is_clamped_and_a_nan_speed_plays_at_1x(client):
    with _live(client, "speed=nan&start=155") as ws:
        started = time.monotonic()
        frames = [m for m in _drain(ws) if m["type"] == "frame"]
        elapsed = time.monotonic() - started
    assert [m["f"] for m in frames] == list(range(155, 165))
    assert elapsed >= 0.9 * 9 * 0.04  # throttled at 1x: unthrottled takes milliseconds
    with _live(client, "speed=1") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "speed", "x": 1e12})  # clamped to 1000x, not refused
        started = time.monotonic()
        assert _drain(ws)[-1]["type"] == "end"
    assert time.monotonic() - started < 3  # 165 frames at 1x would take 6.6 s


def test_live_limits_come_from_the_environment(monkeypatch):
    monkeypatch.delenv("TTE_LIVE_PER_CLIENT", raising=False)
    monkeypatch.delenv("TTE_LIVE_MAX_S", raising=False)
    s = Settings.from_env()
    assert (s.live_per_client, s.live_max_s) == (4, 600.0)
    monkeypatch.setenv("TTE_LIVE_PER_CLIENT", "2")
    monkeypatch.setenv("TTE_LIVE_MAX_S", "90")
    s = Settings.from_env()
    assert (s.live_per_client, s.live_max_s) == (2, 90.0)


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


def test_a_template_served_while_limited_does_not_pin_the_cache(settings, tmp_path, replies):
    """A viewer limited once gets the template; the next request (limit over) asks the model.

    Found by the web client: the template was cached under the offline key and then served as a
    cache hit forever, so the model was never tried again for that persona and language.
    """
    from agents.testing import FakeChatClient

    fresh = Settings(matches=settings.matches, cache_dir=tmp_path, rate_limit=(1, 600.0),
                     web_origin="*")  # fmt: skip
    analyst = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    casual = {"match": MATCH, "personas": ["casual"], "languages": ["en"]}
    with TestClient(create_app(fresh, client=FakeChatClient(replies), model_id="m")) as c:
        assert c.post("/api/breakdowns", json=analyst).json()["source"] == "model"
        limited = c.post("/api/breakdowns", json=casual).json()
        assert limited["rate_limited"] is True and limited["source"] == "offline"
        other = {"x-forwarded-for": "203.0.113.9"}  # a client with quota left
        again = c.post("/api/breakdowns", json=casual, headers=other).json()
    assert again["source"] == "model" and again["cached"] is False


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


# --- speech: only cues the crew wrote, audio cached by key, limited (SPEC 6 Voice, 8) -------------


@pytest.fixture
def speech(monkeypatch):
    """Azure Speech configured, with a fake synthesis that records the SSML it is sent."""
    from api import tts

    monkeypatch.setenv("AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setenv("AZURE_SPEECH_REGION", "test-region")
    sent: list[str] = []

    def synthesize(ssml: str) -> bytes:
        sent.append(ssml)
        return b"RIFF" + hashlib.sha256(ssml.encode()).digest()

    monkeypatch.setattr(tts, "request", synthesize)
    return sent


def _cues(c, persona="analyst", language="en"):
    """The voice cues of one breakdown script, as the web client receives them."""
    body = {"match": MATCH, "personas": [persona], "languages": [language]}
    scripts = c.post("/api/breakdowns", json=body).json()["result"]["scripts"]
    return [cue for s in scripts for cue in s["voice"]]


def test_tts_speaks_only_voice_cues_the_crew_wrote(settings, tmp_path, speech):
    """The API is public, so it must not read out text a client sends (SPEC 6 Voice)."""
    with TestClient(_app(settings, tmp_path)) as c:
        refused = [
            c.post("/api/tts", json={"ssml": "<speak>anything at all</speak>"}),
            c.post("/api/tts", content="<speak>anything</speak>",
                   headers={"content-type": "application/ssml+xml"}),
            c.post("/api/tts", json={"key": "<speak>anything</speak>"}),
            c.post("/api/tts", json={"key": "0123456789abcdef", "ssml": "<speak/>"}),
            c.post("/api/tts", json=["0123456789abcdef"]),
        ]  # fmt: skip
        unknown = c.post("/api/tts", json={"key": "0123456789abcdef"})
        cue = _cues(c)[0]
        spoken = c.post("/api/tts", json={"key": cue["cache_key"]})
    assert [r.status_code for r in refused] == [400] * len(refused)
    assert "SSML" in refused[0].json()["detail"]
    assert unknown.status_code == 404
    assert spoken.status_code == 200 and spoken.headers["content-type"] == "audio/wav"
    assert speech == [cue["ssml"]]  # the server's own SSML, nothing a client sent


def test_tts_audio_is_cached_by_key_across_restarts(settings, tmp_path, speech):
    with TestClient(_app(settings, tmp_path)) as c:
        key = _cues(c)[0]["cache_key"]
        first = c.post("/api/tts", json={"key": key}).content
        again = c.post("/api/tts", json={"key": key}).content
    with TestClient(_app(settings, tmp_path)) as c:  # no breakdown asked: the cue was stored
        restarted = c.post("/api/tts", json={"key": key})
    assert restarted.status_code == 200 and first == again == restarted.content
    assert len(speech) == 1
    assert (tmp_path / "tts" / f"{key}.wav").read_bytes() == first


def test_tts_is_rate_limited_per_client(settings, tmp_path, speech):
    with TestClient(_app(settings, tmp_path, tts_rate_limit=(2, 600.0))) as c:
        key = _cues(c)[0]["cache_key"]
        mine = [c.post("/api/tts", json={"key": key}).status_code for _ in range(3)]
        other = c.post("/api/tts", json={"key": key}, headers={"x-forwarded-for": "203.0.113.7"})
    assert mine == [200, 200, 429] and other.status_code == 200


def test_the_daily_speech_cap_counts_syntheses_only(settings, tmp_path, speech):
    with TestClient(_app(settings, tmp_path, daily_tts_cap=1)) as c:
        a, b = (cue["cache_key"] for cue in _cues(c)[:2])
        first = c.post("/api/tts", json={"key": a})
        capped = c.post("/api/tts", json={"key": b})
        cached = c.post("/api/tts", json={"key": a})  # audio already made: free
    assert first.status_code == cached.status_code == 200
    assert capped.status_code == 429 and len(speech) == 1


def test_tts_needs_speech(client, monkeypatch):
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    key = _cues(client)[0]["cache_key"]
    assert client.post("/api/tts", json={"key": key}).status_code == 503


def test_speech_limits_come_from_the_environment(monkeypatch):
    monkeypatch.delenv("TTE_TTS_RATE_LIMIT", raising=False)
    monkeypatch.delenv("TTE_DAILY_TTS_CAP", raising=False)
    s = Settings.from_env()
    assert (s.tts_rate_limit, s.daily_tts_cap) == ((60, 600.0), 200)
    monkeypatch.setenv("TTE_TTS_RATE_LIMIT", "5/60")
    monkeypatch.setenv("TTE_DAILY_TTS_CAP", "7")
    s = Settings.from_env()
    assert (s.tts_rate_limit, s.daily_tts_cap) == ((5, 60.0), 7)
