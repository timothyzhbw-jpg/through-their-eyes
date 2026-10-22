"""The trailer edit's spec (video/trailer.json, SPEC 10): under two minutes, numbers only through
verified-claim slots, and every external asset CC0 or public domain with its credit."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIDEO = ROOT / "video"

SLOT = re.compile(r"\{[a-z_]+\.[a-z_]+\}")
PAUSE = re.compile(r"\[pause \d+\]")
PLAYER_ID = re.compile(r"\b[HA]\d{1,2}\b")
SHIRT = re.compile(r"\bNo\.\s?\d{1,2}\b")  # a shirt number ("No. 14") is a name too
NUMBER_WORDS = re.compile(
    r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|"
    r"forty|fifty|hundred|thousand|once|twice|half|dozen|percent)\b",
    re.IGNORECASE,
)


def _spec(story: str | None = None) -> dict:
    """The spec with one telling of the story: beats tagged with another `story` drop out."""
    spec = json.loads((VIDEO / "trailer.json").read_text())
    pick = story or spec.get("story", "blender")
    spec["beats"] = [b for b in spec["beats"] if b.get("story") in (None, pick)]
    return spec


def _strings(value):
    """Every string inside a JSON value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def _bare(text: str) -> str:
    """The text without slots, pause marks, player ids and shirt numbers: what may not hold one."""
    return SHIRT.sub("", PLAYER_ID.sub("", PAUSE.sub("", SLOT.sub("", text))))


def test_the_trailer_is_under_two_minutes():
    for story in ("blender", "app"):
        beats = _spec(story)["beats"]
        assert beats, "the trailer has no beats"
        total = sum(b["dur"] for b in beats)
        assert 0 < total < 120, (story, total)


def test_both_tellings_of_the_story_are_the_same_length():
    """Swapping the story's telling must not move the rest of the cut, or the score."""
    lengths = {story: sum(b["dur"] for b in _spec(story)["beats"]) for story in ("blender", "app")}
    assert abs(lengths["blender"] - lengths["app"]) < 1e-6, lengths


def test_spoken_and_shown_text_brings_numbers_only_through_slots():
    spec = _spec()
    texts = [
        (f"{b['id']} {vo['id']}", s)
        for b in spec["beats"]
        for vo in b.get("vo", [])
        for s in (vo.get("text"), vo.get("fallback"))
        if s
    ]
    for tid, title in spec["titles"].items():
        for key in ("params", "fallback"):
            for name, block in (title.get(key) or {}).items():
                if name in ("url", "legal"):  # an address, or credit a licence wants verbatim
                    continue
                texts += [(f"title {tid}.{key}.{name}", s) for s in _strings(block)]
    for where, text in texts:
        bare = _bare(text)
        assert not re.search(r"\d", bare), f"{where}: digit outside a slot: {text!r}"
        assert not NUMBER_WORDS.search(bare), f"{where}: number word: {text!r}"
    for b in spec["beats"]:
        for vo in b.get("vo", []):
            if vo.get("fallback"):
                assert not SLOT.search(vo["fallback"]), f"{vo['id']}: a fallback has no slots"


def test_every_external_asset_is_cc0_or_public_domain_and_credited():
    assets = json.loads((VIDEO / "assets.json").read_text())
    credits = (VIDEO / "CREDITS.md").read_text()
    used = {m["asset"] for m in _spec().get("music", [])}
    ids = {a["id"] for a in assets}
    assert used <= ids, used - ids
    for a in assets:
        assert a["page"] in credits, f"{a['id']} is not in video/CREDITS.md"
        if a.get("local"):  # our own work (the original score), a file inside the repo
            assert a["licence"] in {"Original", "CC0-1.0", "Public Domain"}, a["id"]
            local = Path(a["local"])
            assert not local.is_absolute() and ".." not in local.parts, a["id"]
            continue
        assert a["licence"] in {"CC0-1.0", "Public Domain"}, a["id"]
        assert re.fullmatch(r"[0-9a-f]{64}", a["sha256"]), a["id"]


def test_the_fonts_ship_with_their_licences():
    fonts = VIDEO / "titles" / "fonts"
    for name in ("Anton", "BebasNeue"):
        assert (fonts / f"{name}-Regular.ttf").exists(), name
        assert "SIL Open Font License" in (fonts / f"{name}-OFL.txt").read_text(), name
