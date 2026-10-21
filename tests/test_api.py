"""Acceptance checks for the API service (SPEC 2, 8): live stream, moments, cached breakdowns."""

import asyncio
import dataclasses
import hashlib
import json
import threading
import time
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api import tts
from api.main import create_app
from api.settings import Settings
from api.store import RateLimiter
from tests.test_agents import _good_replies

MATCH = "blind_side_run-3"
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def settings(tmp_path_factory):
    return Settings(
        matches=[("blind_side_run", 3)],
        cache_dir=tmp_path_factory.mktemp("cache"),
        rate_limit=(2, 600.0),
        verify_rate_limit=(100, 60.0),
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
    assert health["analyst_mcp"] is False  # no model, so no Analyst to give tools to
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
    for name in ("TTE_LIVE_PER_CLIENT", "TTE_LIVE_MAX_S", "TTE_LIVE_MAX_TOTAL"):
        monkeypatch.delenv(name, raising=False)
    s = Settings.from_env()
    assert (s.live_per_client, s.live_max_s, s.live_max_total) == (4, 600.0, 64)
    monkeypatch.setenv("TTE_LIVE_PER_CLIENT", "2")
    monkeypatch.setenv("TTE_LIVE_MAX_S", "90")
    monkeypatch.setenv("TTE_LIVE_MAX_TOTAL", "16")
    s = Settings.from_env()
    assert (s.live_per_client, s.live_max_s, s.live_max_total) == (2, 90.0, 16)


def test_live_streams_have_a_ceiling_across_all_clients(settings, tmp_path):
    """A new X-Forwarded-For per connect gets a new per-client bucket, not a new process limit."""
    with TestClient(_app(settings, tmp_path, live_max_total=2)) as c:
        a_ip, b_ip = "198.51.100.1", "198.51.100.2"
        with _live(c, "speed=0.1", ip=a_ip) as a, _live(c, "speed=0.1", ip=b_ip) as b:
            assert a.receive_json()["type"] == b.receive_json()["type"] == "hello"
            with _live(c, "speed=0.1", ip="198.51.100.3") as third:
                detail, code = _refusal(third)
        with _live(c, ip="198.51.100.3") as again:  # both closed: room again
            assert _drain(again)[-1]["type"] == "end"
    assert code == 4429 and "live streams" in detail


def test_spoofed_first_hops_share_the_live_slots_of_the_real_address(settings, tmp_path):
    """The Container Apps ingress appends the address it saw; earlier hops are the client's."""
    app = _app(settings, tmp_path, live_per_client=1)
    with TestClient(app) as c, _live(c, "speed=0.1", ip="198.51.100.1, 192.0.2.50") as a:
        assert a.receive_json()["type"] == "hello"
        with _live(c, "speed=0.1", ip="198.51.100.2, 192.0.2.50") as spoofed:
            detail, code = _refusal(spoofed)
        with _live(c, "speed=0.1", ip="198.51.100.1, 192.0.2.51") as other:
            assert other.receive_json()["type"] == "hello"
    assert code == 4429


def _dockerfile_ws_max_size() -> int:
    lines = (ROOT / "Dockerfile").read_text().splitlines()
    cmd = next(line for line in lines if line.startswith("CMD"))
    args = json.loads(cmd.removeprefix("CMD").strip())
    return int(args[args.index("--ws-max-size") + 1])


def test_the_server_closes_a_socket_on_a_large_frame_before_buffering_it():
    """uvicorn's --ws-max-size refuses a frame by its header (1009), so a large control message
    never reaches the app; the image starts uvicorn with a limit near the longest valid message."""
    import socket

    import uvicorn
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.client import connect

    from api.live import MAX_CONTROL_CHARS

    limit = _dockerfile_ws_max_size()
    assert MAX_CONTROL_CHARS * 4 <= limit <= 16 * 1024  # 4 bytes per char at most in UTF-8
    app = FastAPI()
    received = []

    @app.websocket("/ws")
    async def echo(ws: WebSocket):
        await ws.accept()
        while True:
            received.append(await ws.receive_text())

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, port=port, ws_max_size=limit, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        with connect(f"ws://127.0.0.1:{port}/ws") as ws:
            ws.send("x" * 100)
            ws.send("x" * (1 << 20))
            with pytest.raises(ConnectionClosed) as closed:
                ws.recv(timeout=5)
        assert closed.value.rcvd is not None and closed.value.rcvd.code == 1009
        time.sleep(0.1)
        assert [len(m) for m in received] == [100]
    finally:
        server.should_exit = True
        thread.join(10)


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


# --- the Analyst's tools over our MCP server (SPEC 6, 8) ----------------------------------------


def test_analyst_mcp_is_on_unless_the_environment_turns_it_off(monkeypatch):
    monkeypatch.delenv("TTE_ANALYST_MCP", raising=False)
    assert Settings.from_env().analyst_mcp is True
    for off in ("0", "false", "OFF", " no "):
        monkeypatch.setenv("TTE_ANALYST_MCP", off)
        assert Settings.from_env().analyst_mcp is False
    for on in ("1", "true", ""):
        monkeypatch.setenv("TTE_ANALYST_MCP", on)
        assert Settings.from_env().analyst_mcp is True


def _mcp_app(settings, cache_dir, replies, on):
    from agents.testing import FakeChatClient

    fresh = Settings(matches=settings.matches, cache_dir=cache_dir, rate_limit=(100, 600.0),
                     web_origin="*", analyst_mcp=on)  # fmt: skip
    fake = FakeChatClient(replies)
    return create_app(fresh, client=fake, model_id="fake-model"), fake


@pytest.mark.parametrize("on", [True, False])
def test_a_model_breakdown_gives_the_analyst_the_mcp_tools_when_on(settings, tmp_path, replies, on):
    """Found 2026-10-20: the API never set use_mcp, so the deployed Analyst had no tools."""
    app, fake = _mcp_app(settings, tmp_path, replies, on)
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    with TestClient(app) as c:
        assert c.get("/health").json()["analyst_mcp"] is on
        r = c.post("/api/breakdowns", json=body).json()
    assert r["source"] == "model" and r["cached"] is False
    if on:
        assert {"get_moment", "list_claims", "run_counterfactual", "what_if"} <= set(
            fake.tools["analyst"]
        )
    else:
        assert fake.tools["analyst"] == []
    assert fake.tools["director"] == [] and fake.tools["telestrator"] == []


def test_a_breakdown_cached_without_the_tools_is_not_served_once_they_are_on(
    settings, tmp_path, replies
):
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    keys = []
    for on in (False, True, True):
        app, _ = _mcp_app(settings, tmp_path, replies, on)
        with TestClient(app) as c:
            r = c.post("/api/breakdowns", json=body).json()
        keys.append((r["key"], r["cached"]))
    (off_key, off_cached), (on_key, on_cached), (again_key, again_cached) = keys
    assert not off_cached and not on_cached and again_cached
    assert off_key != on_key == again_key


def test_breakdowns_take_the_audio_description_persona(client):
    """Blind and low-vision viewers (SPEC 1): a persona like any other, validated like the rest."""
    body = {"match": MATCH, "personas": ["audio_description"], "languages": ["en", "zh"]}
    r = client.post("/api/breakdowns", json=body)
    assert r.status_code == 200
    scripts = r.json()["result"]["scripts"]
    assert {(s["persona"], s["language"]) for s in scripts} == {
        ("audio_description", "en"), ("audio_description", "zh"),
    }  # fmt: skip
    assert all(s["payload"]["lines"] and not s["dropped"] for s in scripts)
    assert client.post("/api/breakdowns", json={**body, "personas": ["blind"]}).status_code == 422
    question = {"match": MATCH, "question": "What if he passed to H4?", "language": "zh"}
    answer = client.post("/api/whatif", json={**question, "persona": "audio_description"})
    assert answer.status_code == 200
    assert answer.json()["answer"]["payload"]["persona"] == "audio_description"
    assert client.post("/api/whatif", json={**question, "persona": "blind"}).status_code == 422


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


# --- tamper checks: the verifier on a claim with one number changed (SPEC 5.3, 7) -----------------


def _verify(client, claim="cf_value", slot="dxt", value=0.5, headers=None, **extra):
    body = {"match": MATCH, "claim": claim, "slot": slot, "value": value, **extra}
    return client.post("/api/verify", json=body, headers=headers)


def test_a_wrong_number_is_refuted_and_its_line_would_not_air(client):
    r = _verify(client, value=0.5)
    assert r.status_code == 200
    out = r.json()
    assert out["claim"] == "cf_value" and out["slot"] == "dxt" and out["value"] == 0.5
    assert out["verified_value"] == pytest.approx(0.13, abs=0.005)
    assert out["status"] == "refuted" and out["airs"] is False
    assert out["reason"].startswith("approx(") and out["reason"].endswith(", 0.5) is false")
    assert out["line"] == "That look was worth 0.50 in expected threat."  # as it would render
    assert any(v.startswith("unsupported_claim: cf_value: refuted") for v in out["violations"])
    assert out["trace"] and out["trace"][0]["holds"] is False
    assert out["audited"] is False


def test_the_verified_number_is_supported_and_its_line_airs(client):
    true = _verify(client).json()["verified_value"]
    out = _verify(client, value=true).json()
    assert out["status"] == "supported" and out["airs"] is True and out["violations"] == []
    assert out["line"] == "That look was worth 0.13 in expected threat."
    zh = _verify(client, value=true, language="zh").json()
    assert zh["line"] == "那一眼带来了0.13的预期威胁（xT）。" and zh["airs"] is True


def test_every_numeric_slot_of_every_claim_can_be_tampered(settings, tmp_path):
    """Each true value is supported and airs; the same slot doubled (or 1 for a zero) is not,
    and its line reads differently. Its own app: two requests per slot, no rate limit in play."""
    from agents.context import MomentContext

    fresh = Settings(matches=settings.matches, cache_dir=tmp_path,
                     verify_rate_limit=(10**6, 60.0), web_origin="*")  # fmt: skip
    ctx = MomentContext.load("blind_side_run", 3)
    tried = 0
    with TestClient(create_app(fresh)) as c:
        for cid, claim in ctx.claims.items():
            for name, s in claim.slots.items():
                if isinstance(s.value, bool) or not isinstance(s.value, int | float):
                    continue
                r_true = _verify(c, cid, name, s.value)
                assert r_true.status_code == 200, (cid, name, r_true.text)
                true = r_true.json()
                assert true["status"] == "supported" and true["airs"] is True, (cid, name, true)
                wrong = (s.value * 2 or 1) if name != "window_s" else s.value * 5
                r_wrong = _verify(c, cid, name, wrong)
                assert r_wrong.status_code == 200, (cid, name, r_wrong.text)
                out = r_wrong.json()
                assert out["status"] != "supported" and out["airs"] is False, (cid, name, out)
                assert out["line"] is not None and out["line"] != true["line"], (cid, name, out)
                tried += 1
    assert tried >= 10


def test_only_numeric_slots_of_existing_claims_are_accepted(client):
    assert _verify(client, claim="no_such_claim").status_code == 404
    assert _verify(client, slot="no_such_slot").status_code == 404
    assert client.post("/api/verify", json={"match": "nope-1", "claim": "cf_value", "slot": "dxt",
                                            "value": 1}).status_code == 404  # fmt: skip
    assert _verify(client, "pass_speed", "passer", 1).status_code == 422  # a player, not a number
    assert _verify(client, value="0.5").status_code == 422  # strings are not numbers
    assert _verify(client, value=True).status_code == 422
    assert _verify(client, value=0.123).status_code == 422  # the slot renders 2 decimals
    assert _verify(client, "pass_speed", "kmh", 83.5).status_code == 422  # a whole number
    assert _verify(client, value=1e12).status_code == 422
    assert _verify(client, language="fr").status_code == 422


def test_tamper_checks_are_not_written_to_the_audit_log(client):
    url = f"/api/matches/{MATCH}/audit?limit=500"
    before = client.get(url).json()
    _verify(client, value=0.5)
    _verify(client, "pass_speed", "kmh", 120)
    after = client.get(url).json()
    assert after == before
    assert all(r["verdict"]["status"] == "supported" for r in after)


def test_tamper_checks_are_rate_limited_per_client(settings, tmp_path):
    fresh = Settings(matches=settings.matches, cache_dir=tmp_path, verify_rate_limit=(2, 600.0),
                     web_origin="*")  # fmt: skip
    with TestClient(create_app(fresh)) as c:
        assert _verify(c).status_code == 200 and _verify(c).status_code == 200
        limited = _verify(c)
        other = _verify(c, headers={"x-forwarded-for": "203.0.113.7"})
    assert limited.status_code == 429 and "too many" in limited.json()["detail"]
    assert other.status_code == 200


def test_the_tamper_rate_limit_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("TTE_VERIFY_RATE_LIMIT", raising=False)
    assert Settings.from_env().verify_rate_limit == (20, 60.0)
    monkeypatch.setenv("TTE_VERIFY_RATE_LIMIT", "5/30")
    assert Settings.from_env().verify_rate_limit == (5, 30.0)


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


def test_tts_speaks_the_cues_of_a_failure_drill(settings, tmp_path, speech):
    """A drill's breakdown is served outside the breakdown cache (SPEC 6): its cues still speak."""
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"], "fail": ["director"]}
    with TestClient(_app(settings, tmp_path)) as c:
        drill = c.post("/api/breakdowns", json=body).json()
        cue = next(cue for s in drill["result"]["scripts"] for cue in s["voice"])
        spoken = c.post("/api/tts", json={"key": cue["cache_key"]})
    assert drill["drill"]["pending"] == ["director"]
    assert spoken.status_code == 200 and speech == [cue["ssml"]]


def test_drill_cues_are_kept_in_memory_and_bounded(monkeypatch):
    from api import tts

    monkeypatch.setattr(tts, "DRILL_CUES_KEPT", 2)
    stored: dict = {}
    cues = tts.Cues(type("S", (), {"get": stored.get, "put": stored.__setitem__})())

    def drill(*keys):
        return {
            "result": {"scripts": [{"voice": [{"cache_key": k, "ssml": f"<{k}/>"} for k in keys]}]}
        }

    cues.add_drill(drill("a", "b"))
    cues.add_drill(drill("c"))
    assert stored == {}  # nothing reaches the store (Cosmos DB in Azure)
    assert [cues.ssml(k) for k in "abc"] == [None, "<b/>", "<c/>"]


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
    for name in ("TTE_TTS_RATE_LIMIT", "TTE_DAILY_TTS_CAP", "TTE_TTS_CONCURRENCY"):
        monkeypatch.delenv(name, raising=False)
    s = Settings.from_env()
    assert (s.tts_rate_limit, s.daily_tts_cap, s.tts_concurrency) == ((60, 600.0), 200, 4)
    monkeypatch.setenv("TTE_TTS_RATE_LIMIT", "5/60")
    monkeypatch.setenv("TTE_DAILY_TTS_CAP", "7")
    monkeypatch.setenv("TTE_TTS_CONCURRENCY", "2")
    s = Settings.from_env()
    assert (s.tts_rate_limit, s.daily_tts_cap, s.tts_concurrency) == ((5, 60.0), 7, 2)


def _concurrently(app, requests):
    """Send (method, path, json) requests to `app` at once; the responses, in order."""

    async def run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await asyncio.gather(*(c.request(m, p, json=j) for m, p, j in requests))

    return asyncio.run(run())


def _slow(monkeypatch, delay=0.3):
    """A fake synthesis that takes `delay` s; records the SSML sent and the most in flight."""
    sent, in_flight, peak, lock = [], [0], [0], threading.Lock()

    def synthesize(ssml: str) -> bytes:
        with lock:
            in_flight[0] += 1
            peak[0] = max(peak[0], in_flight[0])
        time.sleep(delay)
        with lock:
            in_flight[0] -= 1
            sent.append(ssml)
        return b"RIFF" + hashlib.sha256(ssml.encode()).digest() * 1000

    monkeypatch.setattr(tts, "request", synthesize)
    return sent, peak


def test_concurrent_misses_for_one_cue_synthesize_once(settings, tmp_path, speech, monkeypatch):
    sent, _ = _slow(monkeypatch)
    app = _app(settings, tmp_path, daily_tts_cap=2)
    with TestClient(app) as c:
        a, b, third = (cue["cache_key"] for cue in _cues(c)[:3])
    first = _concurrently(app, [("POST", "/api/tts", {"key": a})] * 4)
    with TestClient(app) as c:
        b_status = c.post("/api/tts", json={"key": b}).status_code  # one unit of two was used
        third_status = c.post("/api/tts", json={"key": third}).status_code
    assert [r.status_code for r in first] == [200] * 4
    assert len({r.content for r in first}) == 1 and len(sent) == 2  # a once, then b
    assert (b_status, third_status) == (200, 429)
    assert (tmp_path / "tts" / f"{a}.wav").read_bytes() == first[0].content
    assert sorted(p.name for p in (tmp_path / "tts").iterdir()) == sorted([f"{a}.wav", f"{b}.wav"])


def test_a_failed_synthesis_gives_its_cap_unit_back(settings, tmp_path, speech, monkeypatch):
    calls = []

    def flaky(ssml: str) -> bytes:
        calls.append(ssml)
        if len(calls) <= 3:
            raise tts.SpeechUnavailable("Azure Speech request failed")
        return b"RIFF-ok"

    monkeypatch.setattr(tts, "request", flaky)
    with TestClient(_app(settings, tmp_path, daily_tts_cap=1)) as c:
        key = _cues(c)[0]["cache_key"]
        failed = [c.post("/api/tts", json={"key": key}) for _ in range(3)]
        ok = c.post("/api/tts", json={"key": key})
    assert [r.status_code for r in failed] == [502] * 3
    assert failed[0].json() == {"detail": "Azure Speech request failed"}
    assert ok.status_code == 200 and ok.content == b"RIFF-ok"
    assert [p.name for p in (tmp_path / "tts").iterdir()] == [f"{key}.wav"]  # no temp files


def test_azure_speech_calls_in_flight_are_capped(settings, tmp_path, speech, monkeypatch):
    _, peak = _slow(monkeypatch, delay=0.2)
    app = _app(settings, tmp_path, tts_concurrency=2)
    with TestClient(app) as c:
        keys = [cue["cache_key"] for lang in ("en", "zh") for cue in _cues(c, language=lang)]
    keys = list(dict.fromkeys(keys))[:6]
    assert len(keys) >= 4
    replies = _concurrently(app, [("POST", "/api/tts", {"key": k}) for k in keys])
    assert [r.status_code for r in replies] == [200] * len(keys)
    assert peak[0] == 2


def test_audio_files_are_written_whole_by_concurrent_writers(tmp_path, monkeypatch):
    """Each writer has its own temp file, so the published WAV is one writer's bytes."""
    key = "0123456789abcdef"
    payloads = [bytes([i]) * (4 << 20) for i in range(6)]
    turn = iter(payloads)
    lock = threading.Lock()

    def request(ssml):
        with lock:
            return next(turn)

    monkeypatch.setattr(tts, "request", request)
    args = ("<speak/>", key, tmp_path)
    threads = [threading.Thread(target=tts.synthesize, args=args) for _ in payloads]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert (tmp_path / "tts" / f"{key}.wav").read_bytes() in payloads
    assert [p.name for p in (tmp_path / "tts").iterdir()] == [f"{key}.wav"]


# --- the voice cues a breakdown records never fail the breakdown (SPEC 6 Voice) -----------------


def test_a_cached_breakdown_with_null_voice_is_served(settings, tmp_path):
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    with TestClient(_app(settings, tmp_path)) as c:
        key = c.post("/api/breakdowns", json=body).json()["key"]
    path = tmp_path / "breakdowns" / f"{key}.json"
    value = json.loads(path.read_text())
    for script in value["result"]["scripts"]:
        script["voice"] = None
    path.write_text(json.dumps(value))
    with TestClient(_app(settings, tmp_path)) as c:  # a fresh process reads the file
        r = c.post("/api/breakdowns", json=body)
    assert r.status_code == 200 and r.json()["cached"] is True


def test_a_failing_voice_store_does_not_fail_a_breakdown(settings, tmp_path):
    body = {"match": MATCH, "personas": ["casual"], "languages": ["en"]}

    def broken(*args):
        raise OSError("disk full")

    app = _app(settings, tmp_path)
    app.state.cues.store.put = broken
    app.state.cues.store.get = broken
    with TestClient(app) as c:
        computed = c.post("/api/breakdowns", json=body)
        cached = c.post("/api/breakdowns", json=body)
    assert computed.status_code == cached.status_code == 200
    assert cached.json()["cached"] is True


def test_a_restart_does_not_overwrite_the_ssml_stored_for_a_key():
    class Store(dict):
        def put(self, key, value):
            self[key] = value

    store = Store({"0123456789abcdef": {"ssml": "<speak>first</speak>"}})
    breakdown = {"result": {"scripts": [{"voice": [
        {"cache_key": "0123456789abcdef", "ssml": "<speak>changed</speak>"},
        {"cache_key": "fedcba9876543210", "ssml": "<speak>new</speak>"},
    ]}]}}  # fmt: skip
    cues = tts.Cues(store)  # a new process: it has written nothing yet
    cues.add(breakdown)
    assert cues.ssml("0123456789abcdef") == "<speak>first</speak>"
    assert cues.ssml("fedcba9876543210") == "<speak>new</speak>"


# --- client addresses: the ingress appends the address it saw (SPEC 8) ----------------------------


def test_spoofed_first_hops_share_one_rate_limit(settings, tmp_path, speech):
    with TestClient(_app(settings, tmp_path, tts_rate_limit=(2, 600.0))) as c:
        key = _cues(c)[0]["cache_key"]

        def post(forwarded):
            return c.post("/api/tts", json={"key": key}, headers={"x-forwarded-for": forwarded})

        spoofed = [post(f"198.51.100.{i}, 192.0.2.50").status_code for i in range(3)]
        other = post("198.51.100.1, 192.0.2.51").status_code
    assert spoofed == [200, 200, 429] and other == 200


def test_the_rate_limiter_forgets_idle_clients_and_tracks_a_bounded_number():
    limiter = RateLimiter(1, 0.05, max_clients=3)
    for i in range(10):
        assert limiter.allow(f"c{i}")
    assert len(limiter._seen) == 3 and set(limiter._seen) == {"c7", "c8", "c9"}
    assert not limiter.allow("c9")  # a tracked client is still limited
    time.sleep(0.1)
    assert limiter.allow("c9") and len(limiter._seen) <= 3
    limiter.allow("c0")
    assert set(limiter._seen) == {"c9", "c0"}  # c7 and c8 went idle: forgotten
    assert all(limiter._seen.values())  # no empty deques kept
    assert not RateLimiter(0, 60).allow("c") and not RateLimiter(0, 60)._seen


# --- input bounds, headers and errors: the API is public with no login (CLAUDE.md rule 6) --------


def test_request_bodies_are_capped(client):
    origin = {"origin": "https://example.org"}
    padded = {"match": MATCH, "question": "What if he passed to H4?", "pad": "y" * 20_000}
    r = client.post("/api/whatif", json=padded, headers=origin)
    assert r.status_code == 413 and r.headers["access-control-allow-origin"] == "*"
    chunks = iter([b'{"match": "' + b"x" * 10_000, b"x" * 10_000 + b'"}'])  # no content-length
    r = client.post("/api/breakdowns", content=chunks, headers={"content-type": "application/json"})
    assert r.status_code == 413
    assert client.post("/api/tts", content=b"x" * 20_000).status_code == 413


def test_personas_and_languages_are_deduplicated_and_capped(client):
    once = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
    twice = {"match": MATCH, "personas": ["analyst", "analyst"], "languages": ["en", "en"]}
    a = client.post("/api/breakdowns", json=once).json()
    b = client.post("/api/breakdowns", json=twice).json()
    assert b["key"] == a["key"] and b["cached"] is True  # duplicates do not bust the cache
    assert b["result"]["request"]["personas"] == ["analyst"] and len(b["result"]["scripts"]) == 1
    for bad in ({"personas": []}, {"languages": []}, {"personas": ["analyst"] * 9},
                {"languages": ["en"] * 9}, {"personas": ["pundit"]}):  # fmt: skip
        r = client.post("/api/breakdowns", json={"match": MATCH, **bad})
        assert r.status_code == 422, bad


def test_what_if_questions_are_capped(client):
    body = {"match": MATCH, "question": "x" * 301}
    assert client.post("/api/whatif", json=body).status_code == 422
    assert client.post("/api/whatif", json={**body, "question": ""}).status_code == 422


def test_responses_carry_security_headers_and_cors_is_unchanged(client):
    r = client.get("/health", headers={"origin": "https://example.org"})
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert r.headers["access-control-allow-origin"] == "*"
    docs = client.get("/docs")  # HTML that loads Swagger UI: no CSP, the rest applies
    assert docs.status_code == 200 and "content-security-policy" not in docs.headers
    assert docs.headers["x-content-type-options"] == "nosniff"
    assert client.post("/api/tts", json={}).headers["x-frame-options"] == "DENY"


def test_a_500_carries_no_stack_trace(settings):
    app = create_app(settings)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("internals: /app/api/main.py, key=abc")

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/boom", headers={"origin": "https://example.org"})
    assert r.status_code == 500 and r.json() == {"detail": "internal error"}
    assert "internals" not in r.text and "Traceback" not in r.text
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["access-control-allow-origin"] == "*"  # the static site can read it
