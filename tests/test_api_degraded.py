"""A crew run in which a model step fell back to its template is DEGRADED (SPEC 2, 6, 8).

It is cached marked as such, and every answer lists the steps that fell back (`degraded`). While
the model is available a degraded run is run again: at most once per key per
`TTE_DEGRADED_RETRY_S`, under the per-client limit and the daily cap. While it is not (this client
is limited, today's cap is reached, or the key was retried a moment ago), the degraded run is
served, labelled as it is: its steps' sources and `degraded`. A retry that comes back worse does
not replace it. Drills never write to the cache.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agents.context import MomentContext
from agents.testing import FakeChatClient
from api.main import create_app
from api.settings import Settings
from tests.test_agents import _good_replies

MATCH = "blind_side_run-3"
BODY = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}
RECAP = {"match": "match-1", "personas": ["casual"], "languages": ["en"]}


class ChatClientException(RuntimeError):
    """Like Agent Framework's: the model service failed the call."""


@pytest.fixture(scope="module")
def replies():
    return _good_replies(MomentContext.load("blind_side_run", 3))


def _analyst_fails(replies, calls: int):
    """The Analyst's first `calls` model calls fail, then it answers. A step makes two attempts
    (one retry) before its template takes over."""
    return {**replies, "analyst": [ChatClientException("503")] * calls + [replies["analyst"]]}


def _app(cache_dir, replies, rate=(100, 600.0), cap=40, retry_s=0.0, matches=None):
    settings = Settings(matches=matches or [("blind_side_run", 3)], cache_dir=cache_dir,
                        rate_limit=rate, daily_model_cap=cap, web_origin="*", analyst_mcp=False,
                        degraded_retry_s=retry_s)  # fmt: skip
    fake = FakeChatClient(replies)
    return create_app(settings, client=fake, model_id="fake-model"), fake


def _steps(answer) -> dict[str, str]:
    return {s["step"]: s["source"] for s in answer["result"]["trace"]}


def test_a_run_whose_model_step_fell_back_is_cached_as_degraded(tmp_path, replies):
    app, _ = _app(tmp_path, _analyst_fails(replies, 2), retry_s=3600.0)
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=BODY).json()
        again = c.post("/api/breakdowns", json=BODY).json()
    assert first["source"] == "model" and _steps(first)["analyst"] == "template"
    assert first["degraded"] == ["analyst"] and first["provenance"]["kind"] == "live"
    # Within the retry interval it is served as it is: cached, labelled, no model call.
    assert again["cached"] is True and again["degraded"] == ["analyst"]
    assert again["provenance"]["kind"] == "cached" and _steps(again)["analyst"] == "template"


def test_a_clean_run_and_the_offline_template_are_not_degraded(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        clean = c.post("/api/breakdowns", json=BODY).json()
    assert clean["degraded"] == [] and set(_steps(clean).values()) <= {"llm", "code"}
    offline = Settings(matches=[("blind_side_run", 3)], cache_dir=tmp_path / "off",
                       web_origin="*", analyst_mcp=False)  # fmt: skip
    with TestClient(create_app(offline, model_id=None)) as c:
        template = c.post("/api/breakdowns", json=BODY).json()
    # A template by design says so in its provenance; it is not a model run that fell back.
    assert template["source"] == "offline" and template["degraded"] == []
    assert template["provenance"]["kind"] == "template"


def test_a_degraded_run_is_run_again_while_the_model_is_available(tmp_path, replies):
    app, fake = _app(tmp_path, _analyst_fails(replies, 2))
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=BODY).json()
        retried = c.post("/api/breakdowns", json=BODY).json()
        calls = dict(fake.calls)
        served = c.post("/api/breakdowns", json=BODY).json()
    assert first["degraded"] == ["analyst"]
    assert retried["cached"] is False and retried["provenance"]["kind"] == "live"
    assert retried["degraded"] == [] and _steps(retried)["analyst"] == "llm"
    assert retried["key"] == first["key"]  # the same cache entry, replaced
    assert served["cached"] is True and served["degraded"] == []
    assert dict(fake.calls) == calls  # a clean run is a cache hit: no model call


def test_a_degraded_key_is_retried_at_most_once_per_interval(tmp_path, replies):
    app, fake = _app(tmp_path, _analyst_fails(replies, 99), retry_s=3600.0)
    with TestClient(app) as c:
        c.post("/api/breakdowns", json=BODY)
        directors = fake.calls["director"]
        for _ in range(3):
            answer = c.post("/api/breakdowns", json=BODY).json()
            assert answer["cached"] is True and answer["degraded"] == ["analyst"]
    assert fake.calls["director"] == directors  # no crew run, no unit of the cap


def test_while_the_model_is_not_available_the_degraded_run_is_served_labelled(tmp_path, replies):
    # One regeneration per client: the first request spends it and comes out degraded.
    app, fake = _app(tmp_path, _analyst_fails(replies, 2), rate=(1, 600.0))
    with TestClient(app) as c:
        c.post("/api/breakdowns", json=BODY)
        limited = c.post("/api/breakdowns", json=BODY).json()
    assert limited["rate_limited"] is True and limited["cached"] is True
    assert limited["source"] == "model" and limited["degraded"] == ["analyst"]
    assert limited["provenance"]["kind"] == "cached"
    assert fake.calls["director"] == 1
    app, fake = _app(tmp_path / "capped", _analyst_fails(replies, 2), cap=1)
    with TestClient(app) as c:
        c.post("/api/breakdowns", json=BODY)
        capped = c.post("/api/breakdowns", json=BODY).json()
    assert capped["capped"] is True and capped["cached"] is True
    assert capped["degraded"] == ["analyst"] and fake.calls["director"] == 1


def test_a_retry_that_comes_back_worse_keeps_the_cached_run(tmp_path, replies):
    # The first run loses the Analyst; the retry loses the Analyst and the Director.
    flaky = {**_analyst_fails(replies, 99),
             "director": [replies["director"]] + [ChatClientException("503")] * 99}  # fmt: skip
    app, fake = _app(tmp_path, flaky)
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=BODY).json()
        worse = c.post("/api/breakdowns", json=BODY).json()
        later = c.post("/api/breakdowns", json=BODY).json()
    assert first["degraded"] == ["analyst"]
    assert fake.calls["director"] >= 3  # the retry ran (one call, then two failed attempts)
    # The viewer gets the better run, and it stays cached.
    assert worse["degraded"] == ["analyst"] and worse["cached"] is True
    assert worse["provenance"]["ran_at"] == first["provenance"]["ran_at"]
    assert later["degraded"] == ["analyst"]


def test_regenerate_runs_a_degraded_key_again_inside_the_interval(tmp_path, replies):
    """What `infra.prewarm --refresh-degraded` asks for: the retry interval protects the cap
    from many viewers of one key, not from an explicit, rate-limited regeneration."""
    app, _ = _app(tmp_path, _analyst_fails(replies, 2), retry_s=3600.0)
    with TestClient(app) as c:
        c.post("/api/breakdowns", json=BODY)
        fresh = c.post("/api/breakdowns", json={**BODY, "regenerate": True}).json()
    assert fresh["cached"] is False and fresh["degraded"] == []


def test_a_drill_never_writes_to_the_cache(tmp_path, replies):
    app, fake = _app(tmp_path, replies)
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["analyst"]}).json()
        normal = c.post("/api/breakdowns", json=BODY).json()
    assert drill["degraded"] == ["analyst"] and drill["drill"]["down"] == ["analyst"]
    assert normal["key"] != drill["key"] and normal["cached"] is False
    assert normal["degraded"] == []


def test_a_cached_run_from_before_the_marker_is_read_as_degraded(tmp_path, replies):
    """Entries cached before `degraded` was stored (Cosmos keeps them) are judged on read."""
    app, _ = _app(tmp_path, _analyst_fails(replies, 2), retry_s=3600.0)
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json=BODY).json()
        storage = app.state.storage.breakdowns
        value = storage.get(first["key"])
        assert value["degraded"] == ["analyst"]  # stored with the run
        storage.put(first["key"], {k: v for k, v in value.items() if k != "degraded"})
        again = c.post("/api/breakdowns", json=BODY).json()
    assert again["cached"] is True and again["degraded"] == ["analyst"]


def test_a_recap_whose_model_step_fell_back_is_degraded_and_run_again(tmp_path):
    from agents.recap_context import RecapContext
    from tests.test_recap import _replies

    rc = RecapContext.for_match(1)
    good = _replies(rc, [rc.candidates[1].id, rc.candidates[0].id, rc.candidates[3].id])
    flaky = {**good, "analyst": [ChatClientException("503")] * 2 + [good["analyst"]]}
    app, _ = _app(tmp_path, flaky, matches=[("match", 1)])
    with TestClient(app) as c:
        first = c.post("/api/recaps", json=RECAP).json()
        retried = c.post("/api/recaps", json=RECAP).json()
    assert first["degraded"] == ["analyst"] and first["source"] == "model"
    assert retried["cached"] is False and retried["degraded"] == []
