"""The score's cue sheet resolution (video/score/timeline.py, SPEC 10): pure Python, no audio."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("score_timeline", ROOT / "video/score/timeline.py")
timeline = importlib.util.module_from_spec(_spec)
sys.modules["score_timeline"] = timeline  # dataclasses look their module up while it loads
_spec.loader.exec_module(timeline)

SPEC = {
    "beats": [
        {"id": "open", "dur": 2.5},
        {"id": "see", "dur": 3.0},
        {"id": "ch1", "dur": 4.5},
        {"id": "end", "dur": 3.0, "out": {"type": "dip", "dur": 0.3}},
    ]
}


def test_beat_starts_and_references():
    cut = timeline.Cut(SPEC)
    assert [b.start for b in cut.beats] == [0.0, 2.5, 5.5, 10.0]
    assert cut.duration == pytest.approx(13.3)
    assert cut.time("ch1") == 5.5
    assert cut.time("ch1:+0.75") == 6.25
    assert cut.time("see:-0.43") == pytest.approx(2.07)
    assert cut.time("ch1:end") == 10.0
    assert cut.time(1.25) == 1.25
    with pytest.raises(KeyError):
        cut.time("nope")


def test_sections_start_on_a_downbeat_and_cues_snap_to_the_16th():
    cues = {
        "bpm": 140,
        "sections": [
            {"id": "a", "kind": "cold", "from": "open"},
            {"id": "b", "kind": "look", "from": "see"},
        ],
        "events": [
            {"type": "card", "at": "see:+0.76"},  # 0.75 s = 7 16ths at 140 BPM; 10 ms off snaps
            {"type": "card", "at": "see:+0.80", "snap": False},
            {"type": "scan", "from": "ch1:+0.2", "to": "ch1:+1.5"},
        ],
    }
    plan = timeline.Plan(timeline.Cut(SPEC), cues)
    b = plan.sections[1]
    assert b.start == 2.5 and b.grid.at(0) == 2.5
    assert b.grid.step == pytest.approx(60 / 140 / 4)
    cards = plan.of("card")
    assert cards[0].t0 == pytest.approx(2.5 + 7 * 60 / 140 / 4)
    assert cards[1].t0 == pytest.approx(3.3)
    assert plan.mood(5.5 + 1.0) == {"scan"}
    assert plan.mood(5.5 + 1.6) == set()


def test_committed_cue_sheets_resolve_against_their_cut():
    """Each cue sheet resolves against the trailer spec it names (skipped if git lacks it)."""
    import subprocess

    for path in sorted((ROOT / "video/score/cues").glob("*.json")):
        cues = json.loads(path.read_text())
        if not cues.get("trailer_ref"):
            continue  # a draft against an uncommitted cut
        run = subprocess.run(
            ["git", "-C", str(ROOT), "show", cues["trailer_ref"]], capture_output=True, text=True
        )
        if run.returncode != 0:
            pytest.skip(f"{cues['trailer_ref']} is not in this clone")
        plan = timeline.Plan(timeline.Cut(json.loads(run.stdout)), cues)
        assert plan.sections[0].start == 0.0
        assert all(e.t0 <= plan.length for e in plan.events)
