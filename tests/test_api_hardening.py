"""Acceptance checks for the public API's cost guards (SPEC 8, docs/OPERATIONS.md): the egress
budget, the live stream's speed cap, the what-if mapping cache and the crew run slots."""

import asyncio
import time
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api import main
from api.egress import MB, Egress
from api.main import create_app
from api.settings import Settings
from tests.test_agents import _good_replies

MATCH = "blind_side_run-3"
EXPORT = f"/api/matches/{MATCH}/export"
RAW = {"accept-encoding": "identity"}  # the 0.4 MB export, not the 0.12 MB gzip


def _ip(n: int) -> dict[str, str]:
    return {"x-forwarded-for": f"203.0.113.{n}"}


def _settings(tmp_path, **changes) -> Settings:
    return Settings(matches=[("blind_side_run", 3)], cache_dir=tmp_path, web_origin="*",
                    analyst_mcp=False, **changes)  # fmt: skip


@pytest.fixture(scope="module")
def replies():
    from agents.context import MomentContext

    ctx = MomentContext.load("blind_side_run", 3)
    return {**_good_replies(ctx), "whatif": {"action": "pass:H4"}}


def _model_app(tmp_path, replies, **changes):
    from agents.testing import FakeChatClient

    fake = FakeChatClient(replies)
    settings = _settings(tmp_path, **{"rate_limit": (100, 600.0), **changes})
    return create_app(settings, client=fake, model_id="fake-model"), fake


# --- egress: every response body and live message counts (api/egress.py) -----------------------


def test_egress_lets_a_download_start_while_bytes_are_left_and_refills(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr("api.egress.time.monotonic", lambda: now[0])
    egress = Egress(per_client=100, window_s=10, daily=10_000)
    assert egress.refused("a") is None
    egress.charge("a", 150)  # one download may take the bucket below zero
    assert egress.refused("a") and egress.refused("b") is None  # per client
    now[0] += 5  # refilled by 50 bytes: still below zero
    assert egress.refused("a")
    now[0] += 1  # 10 bytes left
    assert egress.refused("a") is None
    now[0] += 3600
    assert len(egress) == 1  # refilled buckets go on the next charge
    egress.charge("b", 1)
    assert len(egress) == 1


def test_the_daily_egress_budget_is_shared_and_resets_at_utc_midnight():
    day = [datetime(2026, 10, 27, 23, 0, tzinfo=UTC)]
    egress = Egress(per_client=10**9, window_s=3600, daily=100, clock=lambda: day[0])
    egress.charge("a", 60)
    egress.charge("b", 60)
    assert "today" in egress.refused("c")
    day[0] = datetime(2026, 10, 28, 0, 0, tzinfo=UTC)
    assert egress.refused("c") is None and egress.today_left() == 100


def test_egress_tracks_a_bounded_number_of_clients():
    egress = Egress(per_client=100, window_s=3600, daily=10**9, max_clients=3)
    for n in range(10):
        egress.charge(str(n), 200)
    assert len(egress) == 3  # the least recently charged are forgotten
    assert egress.refused("9") and egress.refused("0") is None


def test_exports_count_against_the_client_budget_and_the_refusal_is_readable(tmp_path):
    with TestClient(create_app(_settings(tmp_path, egress_per_client=(1, 3600.0)))) as c:
        codes = [c.get(EXPORT, headers={**RAW, **_ip(1)}).status_code for _ in range(4)]
        refused = c.get(EXPORT, headers={**_ip(1), "origin": "https://example.org"})
        elsewhere = c.get(EXPORT, headers=_ip(2))
        health = c.get("/health", headers=_ip(1))
    assert codes == [200, 200, 200, 429]  # 0.4 MB each: the third starts with 0.2 MB left
    assert refused.status_code == 429 and "this address" in refused.json()["detail"]
    assert refused.headers["access-control-allow-origin"] == "*"  # CORS still answers
    assert refused.headers["x-content-type-options"] == "nosniff"
    assert refused.headers["retry-after"]
    assert elsewhere.status_code == 200 and health.status_code == 200


def test_past_the_daily_egress_budget_every_client_is_refused(tmp_path):
    with TestClient(create_app(_settings(tmp_path, daily_egress_gb=0.001))) as c:  # 1 MB
        codes = [c.get(EXPORT, headers={**RAW, **_ip(n)}).status_code for n in range(4)]
        later = c.get(f"/api/matches/{MATCH}/moments", headers=_ip(9))
    assert codes == [200, 200, 200, 429]
    assert later.status_code == 429 and "today" in later.json()["detail"]


def test_live_messages_count_and_a_spent_budget_refuses_a_new_stream(tmp_path):
    with TestClient(create_app(_settings(tmp_path, egress_per_client=(0.1, 3600.0)))) as c:
        with c.websocket_connect(f"/ws/matches/{MATCH}/live?speed=8", headers=_ip(1)) as ws:
            while ws.receive_json()["type"] != "end":  # 0.13 MB: it plays to the end
                pass
        with c.websocket_connect(f"/ws/matches/{MATCH}/live", headers=_ip(1)) as ws:
            refusal = ws.receive_json()
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
        with c.websocket_connect(f"/ws/matches/{MATCH}/live", headers=_ip(2)) as ws:
            assert ws.receive_json()["type"] == "hello"
    assert refusal["type"] == "error" and "this address" in refusal["detail"]
    assert closed.value.code == 4429


def test_egress_limits_come_from_the_environment(monkeypatch):
    for name in ("TTE_EGRESS_PER_CLIENT", "TTE_DAILY_EGRESS_GB", "TTE_CREW_CONCURRENCY"):
        monkeypatch.delenv(name, raising=False)
    s = Settings.from_env()
    assert (s.egress_per_client, s.daily_egress_gb, s.crew_concurrency) == ((500, 3600.0), 10, 2)
    monkeypatch.setenv("TTE_EGRESS_PER_CLIENT", "50/600")
    monkeypatch.setenv("TTE_DAILY_EGRESS_GB", "2.5")
    monkeypatch.setenv("TTE_CREW_CONCURRENCY", "1")
    s = Settings.from_env()
    assert (s.egress_per_client, s.daily_egress_gb, s.crew_concurrency) == ((50, 600.0), 2.5, 1)
    assert int(s.egress_per_client[0] * MB) == 50_000_000


# --- the live stream's speed cap ----------------------------------------------------------------


def test_a_live_stream_plays_at_most_8x(tmp_path):
    live = f"/ws/matches/{MATCH}/live?speed=1000&start=100"
    with TestClient(create_app(_settings(tmp_path))) as c, c.websocket_connect(live) as ws:
        started = time.monotonic()
        frames = 0
        while (m := ws.receive_json())["type"] != "end":
            frames += m["type"] == "frame"
        elapsed = time.monotonic() - started
    assert frames == 62  # frames 100-161 of the hero run
    assert elapsed >= 0.9 * 61 * 0.04 / 8  # at 1000x, 62 frames take milliseconds


# --- what-if: a question the model mapped is not mapped again -----------------------------------


def _ask(c, question, n, language="en"):
    body = {"match": MATCH, "question": question, "language": language}
    return c.post("/api/whatif", json=body, headers=_ip(n)).json()


def test_a_repeated_what_if_question_costs_no_model_call_or_cap_unit(tmp_path, replies):
    app, fake = _model_app(tmp_path, replies, daily_model_cap=2)
    with TestClient(app) as c:
        first = _ask(c, "What if he passed to H4?", 1)
        assert fake.calls["whatif"] == 1  # mapped once, not again to answer it
        again = _ask(c, "  what if he PASSED to h4 ", 2)
        in_zh = _ask(c, "What if he passed to H4?", 3, language="zh")
        assert fake.calls["whatif"] == 1
        other = _ask(c, "What if he played it to H4?", 4)  # the cap's second unit
        past_cap = _ask(c, "What if he slid it to H4?", 5)
    assert first["answer"]["source"] == "llm" and first["capped"] is False
    assert again["cached"] is True and again["capped"] is False
    assert again["answer"]["question"] == "  what if he PASSED to h4 "
    assert in_zh["cached"] is False and in_zh["capped"] is False
    assert in_zh["answer"]["source"] == "llm" and in_zh["answer"]["action"] == "pass:H4"
    assert other["capped"] is False and fake.calls["whatif"] == 2
    assert past_cap["capped"] is True and fake.calls["whatif"] == 2  # the rules mapped it


def test_a_failed_mapping_is_not_kept(tmp_path, replies):
    app, fake = _model_app(tmp_path, {**replies, "whatif": RuntimeError("model down")})
    with TestClient(app) as c:
        failed = _ask(c, "What if he passed to H4?", 1)
        tries = fake.calls["whatif"]
        _ask(c, "What if he passed to H4?", 2)
    assert failed["answer"]["source"] == "template" and tries > 0  # the rules answered
    assert fake.calls["whatif"] == 2 * tries  # the model was asked again


def test_what_if_mappings_survive_a_restart(tmp_path, replies):
    app, _ = _model_app(tmp_path, replies)
    with TestClient(app) as c:
        _ask(c, "What if he passed to H4?", 1)
    app, fake = _model_app(tmp_path, replies)
    with TestClient(app) as c:
        kept = _ask(c, "what if he passed to H4", 2)
    assert fake.calls["whatif"] == 0
    assert kept["cached"] is True and kept["answer"]["source"] == "llm"


# --- crew runs with a model share a few slots ----------------------------------------------------


@pytest.mark.parametrize("slots", [1, 3])
def test_crew_runs_with_a_model_wait_for_a_slot(tmp_path, replies, monkeypatch, slots):
    from agents.testing import FakeChatClient

    active, peak = 0, 0
    real = main.run_crew

    async def counted(*args, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            return await real(*args, **kwargs)
        finally:
            active -= 1

    monkeypatch.setattr(main, "run_crew", counted)
    fake = FakeChatClient(replies, delays={"director": 0.2})
    settings = _settings(tmp_path, rate_limit=(100, 600.0), crew_concurrency=slots)
    app = create_app(settings, client=fake, model_id="fake-model")

    async def burst():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await asyncio.gather(*[
                c.post("/api/breakdowns", headers=_ip(n),
                       json={"match": MATCH, "personas": [p], "languages": ["en"]})
                for n, p in enumerate(["casual", "analyst", "coach"])
            ])  # fmt: skip

    out = asyncio.run(burst())
    assert [r.json()["source"] for r in out] == ["model"] * 3
    assert peak == slots


# --- request bodies ------------------------------------------------------------------------------


def test_match_and_moment_ids_are_bounded(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as c:
        long_match = c.post("/api/breakdowns", json={"match": "m" * 101})
        long_moment = c.post("/api/whatif", json={"match": MATCH, "moment": "m" * 101,
                                                  "question": "What if?"})  # fmt: skip
    assert long_match.status_code == long_moment.status_code == 422


# --- responses: no secret, URL, path or id from an SDK error reaches the public trace -----------


def test_errors_in_the_public_trace_hold_no_secret_url_path_or_id(monkeypatch):
    from agents.llm import describe

    monkeypatch.setenv("AZURE_SPEECH_KEY", "s3cr3t-key-value")
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://tte.services.ai.azure.com/api/p")
    error = RuntimeError(
        "POST https://tte.services.ai.azure.com/api/p/openai failed with s3cr3t-key-value in "
        "/app/.venv/lib/python3.11/site-packages/openai/_base_client.py for client "
        "0a1b2c3d-1111-2222-3333-444455556666: Error code: 429 and/or 1/2 retries"
    )
    text = describe(error)
    for leaked in ("s3cr3t", "azure.com", "/app/", ".venv", "0a1b2c3d"):
        assert leaked not in text
    assert text.endswith("Error code: 429 and/or 1/2 retries")
    plain = ConnectionError("the analyst is down")
    assert describe(plain) == "ConnectionError: the analyst is down"


def test_the_load_test_refuses_any_host_but_localhost():
    import argparse

    from infra import loadtest

    live = argparse.Namespace(api="https://tte-api.example.azurecontainerapps.io")
    with pytest.raises(SystemExit, match="local API only"):
        asyncio.run(loadtest.main_async(live))


# --- a limited drill or bring-back is never a dead end (SPEC 6) ---------------------------------

DRILL = {"match": MATCH, "personas": ["analyst"], "languages": ["en"], "fail": ["telestrator"]}


def _steps(response):
    return {s["step"]: s for s in response["result"]["trace"]}


def test_a_limited_drill_replays_the_recorded_run_and_its_recorded_bring_back(tmp_path, replies):
    app, fake = _model_app(tmp_path, replies, rate_limit=(1, 600.0))
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=DRILL, headers=_ip(1)).json()
        early = c.post("/api/breakdowns", json=DRILL, headers=_ip(1)).json()
        back = c.post(f"/api/breakdowns/{first['key']}/bring-back", json={"step": "telestrator"},
                      headers=_ip(2)).json()  # fmt: skip
        calls = dict(fake.calls)
        limited = c.post("/api/breakdowns", json=DRILL, headers=_ip(1)).json()
        recorded_back = c.post(f"/api/breakdowns/{limited['key']}/bring-back",
                               json={"step": "telestrator"}, headers=_ip(1)).json()  # fmt: skip
        again = c.post(f"/api/breakdowns/{limited['key']}/bring-back",
                       json={"step": "analyst"}, headers=_ip(1))  # fmt: skip
    assert first["source"] == "model" and "recorded" not in first
    assert early["recorded"]["at"] and early["rate_limited"] is True
    assert early["drill"]["pending"] == []  # no bring-back recorded yet: no dead button
    assert limited["recorded"]["at"] and limited["key"] == early["key"] != first["key"]
    assert limited["result"] == first["result"] and limited["source"] == "model"
    assert limited["drill"] == {"down": ["telestrator"], "pending": ["telestrator"]}
    assert recorded_back["recorded"]["at"] and recorded_back["result"] == back["result"]
    assert _steps(recorded_back)["telestrator"]["source"] == "llm"
    assert again.status_code == 404  # the analyst was not down in that drill
    assert fake.calls == calls  # the replays called no model


def test_a_limited_bring_back_with_no_recording_comes_back_without_the_model(tmp_path, replies):
    app, fake = _model_app(tmp_path, replies, rate_limit=(1, 600.0))
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json=DRILL, headers=_ip(1)).json()
        calls = dict(fake.calls)
        back = c.post(f"/api/breakdowns/{drill['key']}/bring-back",
                      json={"step": "telestrator"}, headers=_ip(1)).json()  # fmt: skip
    assert back["rate_limited"] is True and "recorded" not in back
    assert back["key"] == drill["key"] and back["source"] == "offline"
    assert back["drill"] == {"down": [], "pending": []}
    assert _steps(back)["telestrator"]["source"] == "template"
    assert fake.calls == calls


def test_past_every_limit_with_no_recording_a_drill_is_429(tmp_path, replies, monkeypatch):
    monkeypatch.setattr(main, "DAILY_OFFLINE_DRILLS", 0)  # no offline runs left either
    app, _ = _model_app(tmp_path, replies, rate_limit=(1, 600.0))
    with TestClient(app) as c:
        c.post("/api/breakdowns", json=DRILL, headers=_ip(1))
        refused = c.post("/api/breakdowns", json={**DRILL, "fail": ["analyst"]}, headers=_ip(1))
    assert refused.status_code == 429 and refused.json()["detail"].startswith("rate_limited")


def test_recordings_are_bounded_and_an_offline_run_never_replaces_a_model_run(tmp_path):
    from api.recorded import Recordings

    recordings = Recordings(tmp_path, keep=3)

    def rec(source):
        return {"at": "2026-10-21T15:00:00+00:00", "parts": {}, "path": [],
                "response": {"source": source}}  # fmt: skip

    recordings.put("a", rec("model"))
    recordings.put("a", rec("offline"))
    assert recordings.get("a")["response"]["source"] == "model"
    recordings.put("b", rec("offline"))
    recordings.put("b", rec("model"))
    assert recordings.get("b")["response"]["source"] == "model"
    for key in "cdef":
        recordings.put(key, rec("model"))
    assert len(list(tmp_path.glob("*.json"))) == 3 and recordings.has("f")


# --- the judging window: its own limits on its UTC days ------------------------------------------


@pytest.mark.parametrize("during", [True, False])
def test_the_judging_window_raises_the_limits_on_its_days(tmp_path, replies, during):
    from datetime import timedelta

    today = datetime.now(UTC).date()
    window = (today, today) if during else (today - timedelta(days=2), today - timedelta(days=1))
    app, fake = _model_app(tmp_path, replies, rate_limit=(1, 600.0), daily_model_cap=1,
                           judging_window=window, judging_rate_limit=(3, 600.0),
                           judging_daily_model_cap=3)  # fmt: skip
    body = {"match": MATCH, "personas": ["analyst"], "languages": ["en"], "regenerate": True}
    with TestClient(app) as c:
        out = [c.post("/api/breakdowns", json=body, headers=_ip(1)).json() for _ in range(4)]
    sources = [o["source"] for o in out]
    if during:  # a judge's tour of three model runs fits; the fourth meets the window's limits
        assert sources[:3] == ["model"] * 3 and (out[3]["rate_limited"] or out[3]["capped"])
        assert fake.calls["director"] == 3
    else:
        assert sources[0] == "model" and out[1]["capped"] and fake.calls["director"] == 1
        assert out[1]["rate_limited"] is False  # the cap is checked first


def test_the_judging_window_comes_from_the_environment(monkeypatch):
    from datetime import date

    for name in ("TTE_JUDGING_WINDOW", "TTE_JUDGING_RATE_LIMIT", "TTE_JUDGING_DAILY_MODEL_CAP"):
        monkeypatch.delenv(name, raising=False)
    s = Settings.from_env()
    assert s.judging_window == (date(2026, 10, 27), date(2026, 11, 10))
    assert s.limits_on(date(2026, 10, 26)) == ((3, 600.0), 40)
    assert s.limits_on(date(2026, 10, 27)) == s.limits_on(date(2026, 11, 10)) == ((8, 600.0), 100)
    assert s.limits_on(date(2026, 11, 11)) == ((3, 600.0), 40)
    monkeypatch.setenv("TTE_JUDGING_WINDOW", "off")
    monkeypatch.setenv("TTE_JUDGING_RATE_LIMIT", "6/600")
    monkeypatch.setenv("TTE_JUDGING_DAILY_MODEL_CAP", "60")
    s = Settings.from_env()
    assert s.judging_window is None and s.limits_on(date(2026, 10, 30)) == ((3, 600.0), 40)
    assert (s.judging_rate_limit, s.judging_daily_model_cap) == ((6, 600.0), 60)
    assert Settings().judging_window is None  # a Settings made in code has no window


def test_a_replay_says_where_it_came_from_and_keeps_its_crew_trace(tmp_path, replies):
    app, _ = _model_app(tmp_path, replies, rate_limit=(1, 600.0))
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=DRILL, headers=_ip(1)).json()
        replay = c.post("/api/breakdowns", json=DRILL, headers=_ip(1)).json()
        offline = c.post("/api/breakdowns", json={**DRILL, "fail": ["analyst"]},
                         headers=_ip(1)).json()  # fmt: skip
        trace = c.get(f"/api/breakdowns/{replay['key']}/trace").json()
    assert first["provenance"]["kind"] == "live"
    assert replay["provenance"] == {"kind": "cached", "ran_at": replay["recorded"]["at"],
                                    "reason": None}  # fmt: skip
    assert replay["recorded"]["at"] == first["provenance"]["ran_at"]
    assert offline["provenance"]["kind"] == "template"
    assert offline["provenance"]["reason"] == "rate_limited"  # not "model_unavailable"
    assert trace["recorded"] is True and trace["trace"]
    assert "trace" not in replay and replay["traced"] is True
