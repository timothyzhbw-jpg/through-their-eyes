"""Acceptance checks for serving the live match stats (SPEC 2, 4.6, 6): the REST snapshot, the
`stat` messages on the live stream, and the Analyst's MCP tool, all with the same numbers."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from agents import tools
from analytics.live_stats import MatchStats, compute_stats
from api.main import create_app
from api.settings import Settings

HERO, MATCH = "blind_side_run-3", "match-1"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    settings = Settings(
        matches=[("blind_side_run", 3), ("match", 1)],
        cache_dir=tmp_path_factory.mktemp("cache"),
        web_origin="*",
    )
    with TestClient(create_app(settings)) as c:
        yield c


def _stats(client, mid=HERO, **params) -> dict:
    r = client.get(f"/api/matches/{mid}/stats", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_stats_endpoint_serves_the_final_snapshot_of_the_export_it_streams(client):
    for mid in (HERO, MATCH):
        body = _stats(client, mid)
        snap = MatchStats.model_validate(body)
        export = client.get(f"/api/matches/{mid}/export").json()
        frames = export["runs"]["factual"]["frames"]
        assert snap.match == mid and snap.frames == frames and snap.frame == frames - 1
        assert snap.source == "tracking" and snap.tracks is None
        assert len(snap.players) == len(export["players"])
        assert all(p.name and p.name != p.id for p in snap.players)
        assert body == compute_stats(export, mid).snapshot().model_dump(mode="json")


def test_a_snapshot_at_a_frame_holds_only_what_was_known_then(client):
    full = _stats(client)
    at = _stats(client, frame=60)
    assert at["frame"] == 60 and all(c["frame"] <= 60 for c in at["cues"])
    assert len(at["cues"]) < len(full["cues"])
    for before, after in zip(at["players"], full["players"], strict=True):
        assert before["distance_m"] <= after["distance_m"]
    assert _stats(client, frame=10**6)["frame"] == full["frame"]  # past the end: the last frame


def test_tracks_are_served_on_request(client):
    body = _stats(client, MATCH, tracks="true")
    tracks = body["tracks"]
    assert tracks["every"] == 25 and len(tracks["ball_kmh10"]) == body["frames"]
    assert tracks["distance_dm"] and tracks["speed"]


def test_bad_requests(client):
    assert client.get("/api/matches/nope/stats").status_code == 404
    assert client.get(f"/api/matches/{HERO}/stats", params={"frame": -1}).status_code == 422
    assert client.get(f"/api/matches/{HERO}/stats", params={"frame": "x"}).status_code == 422


def test_the_live_stream_sends_every_cue_on_its_frame(client):
    cues = _stats(client)["cues"]
    sent, last_frame = [], -1
    with client.websocket_connect(f"/ws/matches/{HERO}/live?speed=1000") as ws:
        while (m := ws.receive_json())["type"] != "end":
            if m["type"] == "frame":
                last_frame = m["f"]
            elif m["type"] == "stat":
                assert m["cue"]["frame"] == last_frame  # after its frame, never ahead of it
                sent.append(m["cue"])
    assert sent == cues


def test_the_analysts_mcp_tool_serves_the_api_numbers(client):
    from mcp.shared.memory import create_connected_server_and_client_session

    from agents.mcp_server import build_server

    ctx = client.app.state.store._loaded[HERO].ctx
    body = _stats(client)
    out = json.loads(tools.get_live_stats(ctx))
    assert out["players"] == body["players"] and out["teams"] == body["teams"]
    h8 = json.loads(tools.get_live_stats(ctx, player="H8", frame=60))
    assert [p["id"] for p in h8["players"]] == ["H8"] and h8["frame"] == 60
    assert all(c["player"] == "H8" or c.get("receiver") == "H8" for c in h8["cues"])
    assert h8["players"] == [p for p in _stats(client, frame=60)["players"] if p["id"] == "H8"]

    async def go():
        server = build_server(ctx)
        async with create_connected_server_and_client_session(server._mcp_server) as session:
            names = {t.name for t in (await session.list_tools()).tools}
            result = await session.call_tool("get_live_stats", {"player": "H9"})
            return names, json.loads(result.content[0].text)

    names, h9 = asyncio.run(go())
    assert "get_live_stats" in names
    assert [p["id"] for p in h9["players"]] == ["H9"]


def test_the_mcp_tool_can_serve_a_whole_match(client):
    ctx = client.app.state.store._loaded[HERO].ctx
    match = compute_stats(client.get(f"/api/matches/{MATCH}/export").json(), MATCH)
    out = json.loads(tools.get_live_stats(ctx, stats=match))
    assert out["match"] == MATCH and out["players"] == _stats(client, MATCH)["players"]
