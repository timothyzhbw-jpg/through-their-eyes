"""The crew trace over the API (SPEC 6): stored with each cached breakdown and recap, and served
by key from `GET /api/breakdowns/<key>/trace` and `GET /api/recaps/<key>/trace`.

- A breakdown the crew ran has its trace; the POST response says so (`traced`) but does not carry
  it, so a breakdown stays the size it was.
- A breakdown cached before traces were recorded says "trace not recorded for this cached run",
  never a made-up one.
- A drill's trace shows the agent taken down, its fallback and its request to be brought back;
  after a bring-back, the same trace continues with the run resumed from the checkpoint.
- Showing a trace costs no model call, and nothing private is in it.
"""

import json

import pytest
from fastapi.testclient import TestClient

from agents.context import MomentContext
from agents.testing import FakeChatClient
from api.main import NOT_RECORDED, create_app
from api.settings import Settings
from tests.test_agents import _good_replies

MATCH = "blind_side_run-3"
BODY = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}


@pytest.fixture(scope="module")
def replies():
    return _good_replies(MomentContext.load("blind_side_run", 3))


def _app(cache_dir, replies, matches=(("blind_side_run", 3),)):
    fake = FakeChatClient(replies)
    settings = Settings(matches=list(matches), cache_dir=cache_dir, rate_limit=(100, 600.0),
                        web_origin="*", analyst_mcp=False)  # fmt: skip
    return create_app(settings, client=fake, model_id="fake-model"), fake


def test_a_breakdown_has_its_trace_served_by_key(tmp_path, replies):
    app, fake = _app(tmp_path, replies)
    with TestClient(app) as c:
        made = c.post("/api/breakdowns", json=BODY).json()
        calls = dict(fake.calls)
        got = c.get(f"/api/breakdowns/{made['key']}/trace")
        cached = c.post("/api/breakdowns", json=BODY).json()
    assert dict(fake.calls) == calls  # no model call to show it
    assert "trace" not in made and made["traced"] is True
    assert cached["cached"] is True and cached["traced"] is True and "trace" not in cached
    assert got.status_code == 200
    body = got.json()
    assert body["key"] == made["key"] and body["recorded"] is True
    trace = body["trace"]
    assert trace["story"] == "breakdown" and trace["subject"] == made["result"]["request"]["moment"]
    assert [s["step"] for s in trace["steps"]][0] == "director"
    assert {s["step"] for s in trace["steps"]} == {"director", "analyst", "telestrator",
                                                   "narration", "verifier", "voice"}  # fmt: skip
    (run,) = trace["runs"]
    assert run["model"] == "fake-model" or run["model"] == "FakeChatClient"
    assert run["trace_id"] == made["result"]["trace_id"]


def test_a_breakdown_cached_without_a_trace_says_so(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        made = c.post("/api/breakdowns", json=BODY).json()
    path = tmp_path / "breakdowns" / f"{made['key']}.json"
    value = json.loads(path.read_text())
    del value["trace"]  # as cached before traces were recorded
    path.write_text(json.dumps(value))
    app, _ = _app(tmp_path, replies)  # a new process: reads the file again
    with TestClient(app) as c:
        cached = c.post("/api/breakdowns", json=BODY).json()
        got = c.get(f"/api/breakdowns/{made['key']}/trace")
    assert cached["cached"] is True and cached["traced"] is False
    assert got.status_code == 200
    assert got.json() == {"key": made["key"], "recorded": False, "trace": None,
                          "detail": NOT_RECORDED}  # fmt: skip
    assert NOT_RECORDED == "trace not recorded for this cached run"


def test_unknown_or_malformed_keys_are_not_found(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        unknown = c.get("/api/breakdowns/0123456789abcdef0123456789abcdef/trace")
        malformed = c.get("/api/breakdowns/not-a-key/trace")
        traversal = c.get("/api/breakdowns/..%2F..%2Fetc/trace")
        recap = c.get("/api/recaps/0123456789abcdef0123456789abcdef/trace")
    assert unknown.status_code == malformed.status_code == traversal.status_code == 404
    assert recap.status_code == 404


def test_a_drill_trace_shows_down_fallback_and_the_bring_back(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        first = c.get(f"/api/breakdowns/{drill['key']}/trace").json()
        c.post(f"/api/breakdowns/{drill['key']}/bring-back", json={"step": "telestrator"})
        after = c.get(f"/api/breakdowns/{drill['key']}/trace").json()
    assert drill["traced"] is True and "trace" not in drill
    events = [(e["kind"], e["step"]) for e in first["trace"]["events"] if e["kind"] != "checkpoint"]
    assert events == [("down", "telestrator"), ("fallback", "telestrator"),
                      ("waiting", "telestrator")]  # fmt: skip
    assert any(e["kind"] == "checkpoint" for e in first["trace"]["events"])
    runs = after["trace"]["runs"]
    assert [(r["kind"], r["step"]) for r in runs] == [("run", None), ("bring_back", "telestrator")]
    assert runs[0]["pending"] == ["telestrator"] and runs[1]["pending"] == []
    back = [e for e in after["trace"]["events"] if e["kind"] == "back"]
    assert len(back) == 1 and back[0]["checkpoint"]
    resumed = [s for s in after["trace"]["steps"] if s["run"] == 1 and s["step"] == "telestrator"]
    assert resumed[0]["resumed"] is True and resumed[0]["source"] == "llm"
    first_run = [s for s in after["trace"]["steps"] if s["run"] == 0]
    assert first_run == first["trace"]["steps"]  # kept as they were


def test_a_recap_has_its_trace_too(tmp_path, replies):
    app, _ = _app(tmp_path, replies, matches=(("match", 1),))
    with TestClient(app) as c:
        made = c.post("/api/recaps", json={"match": "match-1", "personas": ["casual"],
                                           "languages": ["en"]}).json()  # fmt: skip
        got = c.get(f"/api/recaps/{made['key']}/trace")
    assert made["traced"] is True and "trace" not in made
    assert got.status_code == 200 and got.json()["recorded"] is True
    assert got.json()["trace"]["story"] == "recap"


def test_nothing_private_is_in_a_served_trace(tmp_path, replies, monkeypatch):
    marker = "InstrumentationKey=00000000-0000-0000-0000-000000000000"
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", marker)
    app, fake = _app(tmp_path, replies)
    with TestClient(app) as c:
        made = c.post("/api/breakdowns", json=BODY).json()
        text = c.get(f"/api/breakdowns/{made['key']}/trace").text
    assert "InstrumentationKey" not in text and "ROLE:" not in text
    for prompts in fake.prompts.values():
        assert all(p[:80] not in text for p in prompts)
