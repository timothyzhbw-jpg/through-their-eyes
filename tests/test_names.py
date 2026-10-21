"""Fictional names on screen and in the voice (SPEC 4.6, 5.3, 7).

Narration speaks of players by their fictional short names (sim/roster.py) and of the two clubs by
their fictional names. Names are slot values: the Verifier keeps them, and the raw player ids, out
of the free text. Breakdowns, recaps and what-if answers cached before names were rendered are
renamed when they are read, so nothing has to be generated again.
"""

import re

import pytest

from agents.context import MomentContext
from agents.delivery import cache_key
from agents.workflow import breakdown
from api.names import Renamed, rename
from explain.render import ScriptLine as RenderLine
from explain.render import render_line
from sim.roster import CLUBS, ROSTER, club_name, rename_ids, short_name

PLAYER_ID = re.compile(r"(?<![A-Za-z0-9_])[HA](?:1[01]|[1-9])(?![A-Za-z0-9_])")


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def offline(ctx):
    return breakdown(ctx, client=None, personas=("casual", "analyst"), languages=("en", "zh"))


def test_players_are_named_by_their_fictional_short_names(ctx):
    assert ctx.names["H8"] == "J. Ferriday" == short_name("H8")
    assert ctx.names["H4"] == "K. Annersley"
    assert set(ctx.names) == set(ctx.players)


def test_the_clubs_have_fictional_names_not_home_and_away():
    assert club_name(0) == "Kestrel Bay" and club_name(1) == "Corvane Vale"
    assert club_name(0, "zh") == "红隼湾" and club_name(1, "zh") == "科尔瓦恩谷"
    assert set(CLUBS) == {0, 1}


def test_an_offline_breakdown_names_every_player_and_shows_no_id(offline):
    for script in offline.scripts:
        texts = [line.text for line in script.payload.lines]
        for text in texts:
            assert not PLAYER_ID.search(text), text
        assert any("J. Ferriday" in t for t in texts), (script.persona, script.language, texts)
        for cue in script.voice:
            assert not PLAYER_ID.search(re.sub(r"<[^>]+>", " ", cue.ssml)), cue.ssml
            assert cue.cache_key == cache_key(cue.ssml)


def test_the_verifier_keeps_names_and_ids_inside_slots(ctx):
    claims = ["scan_before_reception"]
    ok = render_line(
        RenderLine(id="L1", text="{player} checked his shoulder.", claims=claims),
        ctx.claims, ctx.verdicts, "en", ctx.names,
    )  # fmt: skip
    assert ok.ok and ok.text == "J. Ferriday checked his shoulder."
    for written in ("H8 checked his shoulder.", "J. Ferriday checked his shoulder."):
        bad = render_line(
            RenderLine(id="L1", text=written, claims=claims), ctx.claims, ctx.verdicts, "en",
            ctx.names,
        )  # fmt: skip
        assert not bad.ok, written
        assert "entity" in [v.kind for v in bad.violations], bad.violations


def test_ids_are_renamed_only_where_they_are_whole_tokens():
    assert rename_ids("Without that look, H8 would have passed to H4.") == (
        "Without that look, J. Ferriday would have passed to K. Annersley."
    )
    assert rename_ids("没有那一眼，H8会传给H4。") == "没有那一眼，J. Ferriday会传给K. Annersley。"
    assert rename_ids("A10 beat A1.") == "J. Kestrell beat H. Talvisto."
    for kept in ("H12", "xH8", "H8a", "AH8", "{player}", "8 H", "scan:H8:0050"):
        assert rename_ids(kept) == kept
    assert set(ROSTER) >= {"H1", "H11", "A1", "A11"}


def _legacy_breakdown():
    """A breakdown cached before names were rendered: ids in its lines and its voice."""
    ssml = '<speak><voice name="en-US-GuyNeural">H8 checked his shoulder.</voice></speak>'
    return {
        "source": "model",
        "result": {
            "tier": "excited",
            "scripts": [{
                "persona": "casual", "language": "en",
                "lines": [{"id": "L1", "speaker": "pbp", "text": "{player} checked his shoulder.",
                           "claims": ["scan_before_reception"]}],
                "payload": {
                    "moment": "m:decision_after_scan:H8:0075", "persona": "casual",
                    "language": "en",
                    "lines": [{"id": "L1", "text": "H8 checked his shoulder.",
                               "claims": ["scan_before_reception"]}],
                    "claims": [{"id": "scan_before_reception", "kind": "observed",
                                "verdict": "supported", "values": {"receiver": "H9"},
                                "evidence": ["scan:H8:0050"], "seek_frame": 50}],
                },
                "voice": [{"line": "L1", "speaker": "pbp", "t": 0.2, "voice": "en-US-GuyNeural",
                           "style": None, "ssml": ssml, "cache_key": cache_key(ssml)}],
            }],
        },
    }  # fmt: skip


def test_a_breakdown_cached_with_ids_is_renamed_when_read():
    legacy = _legacy_breakdown()
    out = rename(legacy)
    script = out["result"]["scripts"][0]
    assert script["payload"]["lines"][0]["text"] == "J. Ferriday checked his shoulder."
    cue = script["voice"][0]
    assert "J. Ferriday checked his shoulder." in cue["ssml"]
    assert (
        cue["cache_key"]
        == cache_key(cue["ssml"])
        != legacy["result"]["scripts"][0]["voice"][0]["cache_key"]
    )
    # Data stays data: the moment id, claim values and evidence ids are not presentation.
    assert script["payload"]["moment"] == "m:decision_after_scan:H8:0075"
    assert script["payload"]["claims"] == legacy["result"]["scripts"][0]["payload"]["claims"]
    assert script["lines"] == legacy["result"]["scripts"][0]["lines"]
    assert rename(out) == out  # idempotent


class _Store:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def put(self, key, value):
        self.values[key] = value


def test_the_store_wrapper_renames_on_read_and_stores_as_given():
    store = _Store()
    wrapped = Renamed(store)
    wrapped.put("k", _legacy_breakdown())
    assert store.values["k"] == _legacy_breakdown()
    got = wrapped.get("k")
    assert got["result"]["scripts"][0]["payload"]["lines"][0]["text"].startswith("J. Ferriday")
    assert wrapped.get("missing") is None


def test_a_recap_cached_with_home_and_away_names_the_clubs_when_read():
    legacy = {"result": {"scripts": [{"payload": {"lines": [
        {"id": "S", "text": "Full time: Home 0, Away 0."},
        {"id": "T1", "text": "Home completed 30 of 34 passes."},
        {"id": "Z", "text": "全场结束：主队0比0客队。"},
        {"id": "K1", "text": "H9 found space on the blind side."},
    ]}}]}}  # fmt: skip
    texts = [
        x["text"] for x in rename(legacy, clubs=True)["result"]["scripts"][0]["payload"]["lines"]
    ]
    assert texts == [
        "Full time: Kestrel Bay 0, Corvane Vale 0.",
        "Kestrel Bay completed 30 of 34 passes.",
        "全场结束：红隼湾0比0科尔瓦恩谷。",
        "N. Varnhall found space on the blind side.",
    ]
    # A breakdown never mentions the clubs by those words: no club renaming there.
    assert rename({"text": "Home"})["text"] == "Home"
