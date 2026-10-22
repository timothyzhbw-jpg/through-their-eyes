"""Where a breakdown or a recap came from, as the API says it (SPEC 2, 6, 8).

Every answer carries `provenance`: `live` (the crew ran for this request), `cached` (a crew run
from `ran_at`), or `template` (no model call, with the reason: `rate_limited`, `capped` or
`model_unavailable`). The web shows exactly this; it never works it out from other fields, and a
cached or template answer is never presented as a fresh crew run.
"""

import json

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


@pytest.fixture(scope="module")
def replies():
    return _good_replies(MomentContext.load("blind_side_run", 3))


def _app(cache_dir, replies=None, matches=(("blind_side_run", 3),), rate=(100, 600.0), cap=40):
    settings = Settings(matches=list(matches), cache_dir=cache_dir, rate_limit=rate,
                        daily_model_cap=cap, web_origin="*", analyst_mcp=False)  # fmt: skip
    if replies is None:
        return create_app(settings, model_id=None)  # no model configured
    return create_app(settings, client=FakeChatClient(replies), model_id="fake-model")


def test_a_fresh_crew_run_is_live_then_cached_with_its_run_time(tmp_path, replies):
    with TestClient(_app(tmp_path, replies)) as c:
        live = c.post("/api/breakdowns", json=BODY).json()
        cached = c.post("/api/breakdowns", json=BODY).json()
    assert live["provenance"]["kind"] == "live" and live["provenance"]["reason"] is None
    assert live["provenance"]["ran_at"].endswith("+00:00")  # UTC, ISO 8601
    assert cached["provenance"] == {**live["provenance"], "kind": "cached"}  # the original time


def test_without_a_model_the_answer_is_the_offline_template_and_says_why(tmp_path):
    with TestClient(_app(tmp_path)) as c:
        first = c.post("/api/breakdowns", json=BODY).json()
        again = c.post("/api/breakdowns", json=BODY).json()
    for answer in (first, again):
        assert answer["source"] == "offline"
        assert answer["provenance"]["kind"] == "template"
        assert answer["provenance"]["reason"] == "model_unavailable"
    assert again["cached"] is True  # a cached template is still a template, never "cached crew"


def test_a_rate_limited_client_gets_the_template_and_the_reason(tmp_path, replies):
    with TestClient(_app(tmp_path, replies, rate=(1, 600.0))) as c:
        c.post("/api/breakdowns", json={**BODY, "personas": ["casual"]})  # uses the one allowed
        limited = c.post("/api/breakdowns", json=BODY).json()
    assert limited["rate_limited"] is True and limited["source"] == "offline"
    assert limited["provenance"]["kind"] == "template"
    assert limited["provenance"]["reason"] == "rate_limited"


def test_past_the_daily_cap_the_template_says_the_cap_was_reached(tmp_path, replies):
    with TestClient(_app(tmp_path, replies, cap=0)) as c:
        capped = c.post("/api/breakdowns", json=BODY).json()
    assert capped["capped"] is True and capped["provenance"] == {
        "kind": "template", "ran_at": capped["provenance"]["ran_at"], "reason": "capped",
    }  # fmt: skip


def test_a_limited_client_gets_a_cached_crew_run_as_cached(tmp_path, replies):
    with TestClient(_app(tmp_path, replies, rate=(1, 600.0))) as c:
        made = c.post("/api/breakdowns", json=BODY).json()
        limited = c.post("/api/breakdowns", json={**BODY, "regenerate": True}).json()
    assert limited["rate_limited"] is True and limited["cached"] is True
    assert limited["provenance"] == {**made["provenance"], "kind": "cached"}


def test_a_breakdown_cached_before_run_times_were_recorded_has_no_time(tmp_path, replies):
    with TestClient(_app(tmp_path, replies)) as c:
        made = c.post("/api/breakdowns", json=BODY).json()
    path = tmp_path / "breakdowns" / f"{made['key']}.json"
    value = json.loads(path.read_text())
    del value["trace"], value["ran_at"]  # as cached before either was recorded
    path.write_text(json.dumps(value))
    with TestClient(_app(tmp_path, replies)) as c:
        cached = c.post("/api/breakdowns", json=BODY).json()
    assert cached["provenance"] == {"kind": "cached", "ran_at": None, "reason": None}


def test_a_drill_is_a_live_crew_run(tmp_path, replies):
    with TestClient(_app(tmp_path, replies)) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        back = c.post(f"/api/breakdowns/{drill['key']}/bring-back",
                      json={"step": "telestrator"}).json()  # fmt: skip
    assert drill["provenance"]["kind"] == "live" and back["provenance"]["kind"] == "live"
    assert back["provenance"]["ran_at"] >= drill["provenance"]["ran_at"]  # the bring-back's run


def test_a_recap_says_where_it_came_from_too(tmp_path, replies):
    with TestClient(_app(tmp_path, replies, matches=(("match", 1),), rate=(1, 600.0))) as c:
        live = c.post("/api/recaps", json=RECAP).json()
        cached = c.post("/api/recaps", json=RECAP).json()
        limited = c.post("/api/recaps", json={**RECAP, "languages": ["zh"]}).json()
    assert live["source"] == "model" and live["provenance"]["kind"] == "live"
    assert cached["provenance"] == {**live["provenance"], "kind": "cached"}
    assert limited["rate_limited"] is True
    assert limited["provenance"]["kind"] == "template"
    assert limited["provenance"]["reason"] == "rate_limited"


def test_an_offline_recap_says_no_model_is_configured(tmp_path):
    with TestClient(_app(tmp_path, matches=(("match", 1),))) as c:
        recap = c.post("/api/recaps", json=RECAP).json()
    assert recap["provenance"]["kind"] == "template"
    assert recap["provenance"]["reason"] == "model_unavailable"
