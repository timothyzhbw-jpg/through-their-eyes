"""Acceptance checks for the API's failure drill and checkpoint recovery (SPEC 6, 8).

POST /api/breakdowns with `fail` takes agents down for one fresh run. That run is kept under its
own key, never the cache keys of normal breakdowns. It counts against the per-client rate limit,
and no model is called for a downed step. POST /api/breakdowns/{key}/bring-back re-runs a downed
step from the run's checkpoint. Checkpoints are files under the cache directory, so recovery
works after a restart, and so does a normal breakdown interrupted mid-workflow.
"""

import pytest
from fastapi.testclient import TestClient

from agents.context import MomentContext
from agents.testing import FakeChatClient
from api.main import create_app
from api.settings import Settings
from tests.test_agents import _good_replies

MATCH = "blind_side_run-3"
BODY = {"match": MATCH, "personas": ["analyst"], "languages": ["en"]}


@pytest.fixture(scope="module")
def replies():
    return _good_replies(MomentContext.load("blind_side_run", 3))


def _settings(cache_dir, rate=(100, 600.0)):
    return Settings(matches=[("blind_side_run", 3)], cache_dir=cache_dir, rate_limit=rate,
                    web_origin="*")  # fmt: skip


def _app(cache_dir, replies, rate=(100, 600.0), fake=None):
    fake = fake or FakeChatClient(replies)
    return create_app(_settings(cache_dir, rate), client=fake, model_id="fake-model"), fake


def _steps(response):
    return {s["step"]: s for s in response["result"]["trace"]}


def test_a_drill_is_a_fresh_run_under_its_own_key(tmp_path, replies):
    app, fake = _app(tmp_path, replies)
    with TestClient(app) as c:
        normal = c.post("/api/breakdowns", json=BODY).json()
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        again = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        cached = c.post("/api/breakdowns", json=BODY).json()
    assert normal["result"]["plan_source"] == "agent" and normal["drill"] is None
    tele = _steps(drill)["telestrator"]
    assert tele["source"] == "template" and tele["error"].startswith("AgentDown:")
    assert drill["result"]["plan_source"] == "template" and drill["source"] == "model"
    assert drill["drill"] == {"down": ["telestrator"], "pending": ["telestrator"]}
    assert drill["cached"] is False and again["cached"] is False  # every drill runs the crew
    assert len({normal["key"], drill["key"], again["key"]}) == 3
    assert cached["cached"] is True and cached["key"] == normal["key"]
    assert cached["result"]["plan_source"] == "agent"  # the drill did not touch the normal cache
    assert fake.calls["telestrator"] == 1  # the normal breakdown's call; none while it was down
    assert fake.calls["director"] == 3


def test_a_drill_counts_against_the_rate_limit(tmp_path, replies):
    app, fake = _app(tmp_path, replies, rate=(2, 600.0))
    with TestClient(app) as c:
        first = c.post("/api/breakdowns", json={**BODY, "fail": ["analyst", "telestrator"]})
        key = first.json()["key"]
        back = c.post(f"/api/breakdowns/{key}/bring-back", json={"step": "analyst"})
        limited = c.post("/api/breakdowns", json={**BODY, "fail": ["analyst"]})
        later = c.post(f"/api/breakdowns/{key}/bring-back", json={"step": "telestrator"})
    assert first.status_code == back.status_code == 200
    assert limited.status_code == 429 and later.status_code == 429
    assert fake.calls["director"] == 1 and fake.calls["analyst"] == 1  # the bring-back's call
    assert fake.calls["telestrator"] == 0  # down throughout


def test_bringing_the_telestrator_back_reruns_only_that_step(tmp_path, replies):
    app, fake = _app(tmp_path, replies)
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        calls = dict(fake.calls)
        back = c.post(f"/api/breakdowns/{drill['key']}/bring-back", json={"step": "telestrator"})
    assert back.status_code == 200
    back = back.json()
    assert {r: n - calls.get(r, 0) for r, n in fake.calls.items() if n != calls.get(r, 0)} == {
        "telestrator": 1
    }
    assert back["key"] == drill["key"] and back["cached"] is False
    assert back["result"]["plan_source"] == "agent"
    assert back["drill"] == {"down": [], "pending": []}
    assert _steps(back)["telestrator"]["source"] == "llm"
    for step in ("director", "analyst", "narration", "verifier"):
        assert _steps(back)[step] == _steps(drill)[step]
    assert back["result"]["scripts"][0]["payload"] == drill["result"]["scripts"][0]["payload"]


def test_bring_back_works_after_a_restart(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["narration"]}).json()
    app, fake = _app(tmp_path, replies)  # a new process on the same disk
    with TestClient(app) as c:
        back = c.post(f"/api/breakdowns/{drill['key']}/bring-back", json={"step": "narration"})
    assert back.status_code == 200
    assert _steps(back.json())["narration"]["source"] == "llm"
    assert set(fake.calls) == {"pbp", "color"}  # narration only; the Verifier and Voice are code


def test_bring_back_refuses_what_it_cannot_do(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        normal = c.post("/api/breakdowns", json=BODY).json()
        url = f"/api/breakdowns/{drill['key']}/bring-back"
        up = c.post(url, json={"step": "director"})  # it was never down
        unknown = c.post("/api/breakdowns/0123456789abcdef0123456789abcdef/bring-back",
                         json={"step": "telestrator"})  # fmt: skip
        not_a_drill = c.post(f"/api/breakdowns/{normal['key']}/bring-back",
                             json={"step": "telestrator"})  # fmt: skip
        traversal = c.post("/api/breakdowns/..%2F..%2Fetc/bring-back", json={"step": "analyst"})
        bad_step = c.post(url, json={"step": "verifier"})
        assert c.post(url, json={"step": "telestrator"}).status_code == 200
        twice = c.post(url, json={"step": "telestrator"})
    assert up.status_code == 409 and twice.status_code == 409
    assert unknown.status_code == 404 and not_a_drill.status_code == 404
    assert traversal.status_code == 404 and bad_step.status_code == 422


def test_bring_back_after_the_checkpoints_are_gone_says_so(tmp_path, replies):
    """In Azure the checkpoints are on the replica's disk while the record is in Cosmos DB: a new
    replica has the record but not the checkpoints."""
    import shutil

    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["telestrator"]}).json()
        shutil.rmtree(tmp_path / "checkpoints" / "drills" / drill["key"])
        gone = c.post(f"/api/breakdowns/{drill['key']}/bring-back", json={"step": "telestrator"})
    assert gone.status_code == 410 and "run the drill again" in gone.json()["detail"]


def test_only_the_latest_drills_keep_their_checkpoints(tmp_path, replies, monkeypatch):
    import api.main

    monkeypatch.setattr(api.main, "DRILLS_KEPT", 2)
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        keys = [c.post("/api/breakdowns", json={**BODY, "fail": ["director"]}).json()["key"]
                for _ in range(3)]  # fmt: skip
    kept = {d.name for d in (tmp_path / "checkpoints" / "drills").iterdir()}
    assert kept == set(keys[1:])


def test_an_interrupted_breakdown_resumes_after_a_restart(tmp_path, replies):
    """The process dies during narration; after a restart the same request resumes from the
    checkpoint after the Analyst instead of starting over."""

    class Killed(BaseException):  # not an Exception: nothing on the way catches it
        pass

    dying = FakeChatClient({**replies, "pbp": Killed()})
    app, _ = _app(tmp_path, replies, fake=dying)
    with pytest.raises(Killed):  # no lifespan: a killed process does not shut down cleanly
        TestClient(app).post("/api/breakdowns", json=BODY)
    assert dying.calls["director"] == dying.calls["analyst"] == dying.calls["pbp"] == 1

    app, fake = _app(tmp_path, replies)
    with TestClient(app) as c:
        out = c.post("/api/breakdowns", json=BODY).json()
        again = c.post("/api/breakdowns", json=BODY).json()
    assert fake.calls["director"] == fake.calls["analyst"] == 0
    assert out["cached"] is False and all(
        s["source"] in ("llm", "code") for s in out["result"]["trace"]
    )
    assert again["cached"] is True
    assert list((tmp_path / "checkpoints").rglob("*.json")) == []  # cached: checkpoints gone


def test_an_offline_drill_still_shows_the_outage(tmp_path):
    app = create_app(_settings(tmp_path))
    with TestClient(app) as c:
        drill = c.post("/api/breakdowns", json={**BODY, "fail": ["director"]}).json()
    assert drill["source"] == "offline"
    assert _steps(drill)["director"]["error"].startswith("AgentDown:")
    assert drill["drill"]["pending"] == ["director"]


def test_breakdowns_name_their_trace(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        out = c.post("/api/breakdowns", json=BODY).json()
    trace_id = out["result"]["trace_id"]
    assert trace_id is None or (len(trace_id) == 32 and int(trace_id, 16) > 0)
