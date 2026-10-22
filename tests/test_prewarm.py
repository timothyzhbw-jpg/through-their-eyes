"""Acceptance checks for the cache pre-warm (SPEC 2, 8): every breakdown a viewer can open ends up
cached from the model, new ones are paced to the per-client limit, and the run stops at the daily
cap instead of serving templates."""

from __future__ import annotations

import hashlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api import store, tts
from api.main import create_app
from api.settings import Settings
from infra import prewarm
from tests.test_agents import _good_replies

MOMENT = "m:decision_after_scan:H8:0075"
VIEWS = len(prewarm.PERSONAS) * len(prewarm.LANGUAGES)


class Clock:
    """A clock that only moves when the pre-warm sleeps."""

    def __init__(self) -> None:
        self.now, self.slept = 0.0, 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.now += s
        self.slept += s


@pytest.fixture(scope="module")
def replies():
    """Every role answers, every voice as its persona's rules ask in the script's language
    (tests/test_agents.py `_good_replies`: the persona's opener, a number first for the analyst,
    where it happened first for audio description)."""
    from agents.context import MomentContext

    return _good_replies(MomentContext.load("blind_side_run", 3))


@pytest.fixture
def speech(monkeypatch):
    """Azure Speech configured, with a fake synthesis that records the SSML it is sent."""
    monkeypatch.setenv("AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setenv("AZURE_SPEECH_REGION", "test-region")
    sent: list[str] = []

    def synthesize(ssml: str) -> bytes:
        sent.append(ssml)
        return b"RIFF" + hashlib.sha256(ssml.encode()).digest()

    monkeypatch.setattr(tts, "request", synthesize)
    return sent


@pytest.fixture
def clock(monkeypatch):
    """The pre-warm's clock, which the API's per-client limits read too (api/store.py)."""
    c = Clock()
    monkeypatch.setattr(store, "time", SimpleNamespace(monotonic=c))
    return c


def _app(tmp_path, replies, **settings):
    from agents.testing import FakeChatClient

    fresh = Settings(matches=[("blind_side_run", 3)], cache_dir=tmp_path, web_origin="*",
                     analyst_mcp=False, **settings)  # fmt: skip
    fake = FakeChatClient(replies)
    return create_app(fresh, client=fake, model_id="fake-model"), fake


def _http(c: TestClient) -> prewarm.Http:
    def call(method: str, path: str, body: dict | None = None):
        r = c.request(method, path, json=body)
        kind = r.headers.get("content-type", "")
        return r.status_code, (r.json() if "json" in kind else r.content)

    return call


def _run(c, clock, **kw):
    kw = {"rate": (2, 600.0), "tts_gap_s": 10.0, **kw}
    return prewarm.run(_http(c), clock=clock, sleep=clock.sleep, log=lambda *_: None, **kw)


def test_the_views_are_every_persona_and_language_of_every_hero_moment(tmp_path, replies):
    app, _ = _app(tmp_path, replies)
    with TestClient(app) as c:
        views = prewarm.views(_http(c))
    assert len(views) == VIEWS and {v.moment for v in views} == {MOMENT}
    assert {(v.persona, v.language) for v in views} == {
        (p, lang) for p in prewarm.PERSONAS for lang in prewarm.LANGUAGES
    }


def test_new_breakdowns_are_paced_to_the_client_limit_and_a_rerun_is_free(tmp_path, replies, clock):
    app, fake = _app(tmp_path, replies, rate_limit=(2, 600.0), daily_model_cap=100)
    with TestClient(app) as c:
        first = _run(c, clock)
        made, slept = fake.calls["director"], clock.slept
        again = _run(c, clock)
    assert first.code == 0 and all(r.status == "new" and not r.problems for r in first.rows)
    assert made == VIEWS  # one model breakdown per view, none wasted on a refusal
    assert slept >= (VIEWS // 2 - 1) * 600  # two per window of 600 s
    assert again.code == 0 and {r.status for r in again.rows} == {"cached"}
    assert fake.calls["director"] == made and clock.slept == slept  # cached: no call, no wait


def test_past_the_daily_cap_nothing_new_is_made(tmp_path, replies, clock):
    app, fake = _app(tmp_path, replies, rate_limit=(100, 600.0), daily_model_cap=3)
    with TestClient(app) as c:
        out = _run(c, clock)
    assert out.code == prewarm.CAPPED
    assert [r.status for r in out.rows].count("new") == 3 and fake.calls["director"] == 3
    assert all(r.status in ("new", "capped") for r in out.rows)


def test_max_new_leaves_the_rest_of_the_cap_alone(tmp_path, replies, clock):
    app, fake = _app(tmp_path, replies, rate_limit=(100, 600.0), daily_model_cap=100)
    with TestClient(app) as c:
        out = _run(c, clock, max_new=4)
    assert out.code == 1 and fake.calls["director"] == 4
    assert [r.status for r in out.rows].count("skipped") == VIEWS - 4


def test_a_breakdown_with_a_template_step_is_degraded():
    trace = [{"step": "director", "source": "llm"}, {"step": "verifier", "source": "code"}]
    clean = {"source": "model", "result": {"plan_source": "agent", "trace": trace}}
    assert prewarm.problems(clean) == []
    bad = {"source": "model", "result": {"plan_source": "template", "trace": [
        {"step": "analyst", "source": "template"}]}}  # fmt: skip
    assert prewarm.problems(bad) == ["plan from template", "analyst from template"]
    assert prewarm.problems({"source": "offline", "result": {}}) == ["source offline"]
    # Cached before the crew recorded its trace: regenerating it records one (SPEC 6).
    assert prewarm.problems({**clean, "traced": False}) == ["no crew trace"]
    assert prewarm.problems({**clean, "traced": True}) == []


def test_tts_speaks_every_cue_once(tmp_path, replies, speech, clock):
    app, _ = _app(tmp_path, replies, rate_limit=(100, 600.0), daily_model_cap=100)
    with TestClient(app) as c:
        first = _run(c, clock, tts=True)
        spoken = len(speech)
        again = _run(c, clock, tts=True)
    assert first.code == 0 and spoken == first.cues > 0
    assert again.code == 0 and len(speech) == spoken  # the audio is cached by key
    assert clock.slept >= 2 * (spoken - 1) * 10.0  # one request per gap, in each run


@pytest.mark.parametrize("text, rate", [("3/600", (3, 600.0)), ("5", (5, 600.0))])
def test_the_rate_is_read_like_the_api_reads_it(text, rate):
    assert prewarm.parse_rate(text) == rate


def test_a_stitched_match_adds_its_recap_for_every_persona_and_language():
    """The web app asks for a match's recap one persona in one language at a time (SPEC 6)."""
    infos = {
        "/api/matches": [{"id": "blind_side_run-3"}, {"id": "match-1"}],
        "/api/matches/blind_side_run-3": {"id": "blind_side_run-3", "kind": "hero",
                                          "hero_moments": [MOMENT]},
        "/api/matches/match-1": {"id": "match-1", "kind": "match", "hero_moments": ["m:a", "m:b"]},
    }  # fmt: skip
    found = prewarm.views(lambda method, path, body: (200, infos[path]))
    recaps = [v for v in found if v.kind == "recap"]
    assert len(found) == 3 * VIEWS + VIEWS and found[-len(recaps) :] == recaps
    assert {v.match for v in recaps} == {"match-1"} and len(recaps) == VIEWS
    assert recaps[0].path == "/api/recaps"
    first = {"personas": [prewarm.PERSONAS[0]], "languages": [prewarm.LANGUAGES[0]]}
    assert recaps[0].body() == {"match": "match-1", **first, "regenerate": False}
    clean = {"source": "model", "result": {"reel_source": "agent", "trace": []}}
    assert prewarm.problems(clean) == []
    assert prewarm.problems({**clean, "result": {"reel_source": "template", "trace": []}}) == [
        "plan from template"
    ]
