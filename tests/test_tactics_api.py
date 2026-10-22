"""Serving the tactics cards (SPEC 2, 4.8): GET /api/matches/<id>/tactics returns the cards the
viewer draws and the verified sentences, the same as explain/tactics.py builds from the run."""

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import Settings
from explain.tactics import TacticsView, view_for_run
from sim.engine import Simulation


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    settings = Settings(
        matches=[("press_escape", 0), ("corner_blind_side", 0)],
        cache_dir=tmp_path_factory.mktemp("cache"),
        web_origin="*",
    )
    with TestClient(create_app(settings)) as c:
        yield c


def test_the_tactics_endpoint_serves_the_cards_and_their_verified_sentences(client):
    for scenario, seed in (("press_escape", 0), ("corner_blind_side", 0)):
        mid = f"{scenario}-{seed}"
        r = client.get(f"/api/matches/{mid}/tactics")
        assert r.status_code == 200, r.text
        view = TacticsView.model_validate(r.json())
        run = Simulation.from_scenario(scenario, seed).run()
        assert r.json() == view_for_run(run, mid).model_dump(mode="json")
        assert view.cards.match == mid and view.cards.source == "tracking"
        assert set(view.lines) == {"en", "zh"}
        assert all(c.verdict == "supported" for p in view.lines.values() for c in p.claims)


def test_an_unknown_match_has_no_tactics(client):
    assert client.get("/api/matches/nope-1/tactics").status_code == 404
