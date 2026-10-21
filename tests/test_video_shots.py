"""The demo video's shot list (video/shots.json, SPEC 10) parses, stays on the project's own site,
and its voice-over brings in numbers only through slots filled from verified claims."""

import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "video" / "shots.json"
CAPTURE = ROOT / "video" / "capture.mjs"

SLOT = re.compile(r"\{[a-z_]+\.[a-z_]+\}")
PLAYER_ID = re.compile(r"\b[HA]\d{1,2}\b")
NUMBER_WORDS = re.compile(
    r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|"
    r"forty|fifty|hundred|thousand|once|twice|half|dozen|percent)\b",
    re.IGNORECASE,
)


def _doc() -> dict:
    return json.loads(SHOTS.read_text())


def _site() -> str:
    """The web app's public URL, as the README gives it."""
    match = re.search(r"\*\*Web app:\*\* (https://\S+)", (ROOT / "README.md").read_text())
    assert match, "README.md names no web app URL"
    return match.group(1).rstrip("/")


def _object_keys(name: str) -> set[str]:
    """Keys of a top-level `const NAME = { ... };` object in capture.mjs."""
    body = re.search(rf"^const {name} = \{{\n(.*?)^\}};", CAPTURE.read_text(), re.M | re.S)
    assert body, f"capture.mjs has no {name}"
    return set(re.findall(r'^  (?:async )?"?([a-z-]+)"?[:(]', body.group(1), re.M))


# A parameter read straight off the query, or through deeplink.ts's read("name", parse) helper.
PARAM_READ = re.compile(r'(?:(?:params|URLSearchParams\([^)]*\))\.get|\bread)\("([a-z]+)"')


def _url_params() -> set[str]:
    """Query parameters the web app reads (web/src, outside tests)."""
    names: set[str] = set()
    for path in (ROOT / "web" / "src").rglob("*.ts*"):
        if ".test." not in path.name:
            names.update(PARAM_READ.findall(path.read_text()))
    return names


def test_the_shot_list_parses_and_fits_in_two_minutes():
    doc = _doc()
    shots = doc["shots"]
    ids = [s["id"] for s in shots]
    assert len(ids) == len(set(ids)) and ids == sorted(ids)
    assert doc["viewport"] == {"width": 1920, "height": 1080}
    for shot in shots:
        assert shot["viewport"] == {"width": 1920, "height": 1080}, shot["id"]
        assert shot["status"] in {"ready", "stand-in", "pending feature", "external"}, shot["id"]
        assert shot["target_s"] > 0 and shot["title"] and shot["spec_beat"], shot["id"]
        if shot["status"] != "ready":
            assert shot.get("pending"), f"{shot['id']}: say why it is not ready"
    assert sum(s["target_s"] for s in shots) < 120


def test_every_url_is_on_the_projects_own_site():
    site = urlsplit(_site())
    params = _url_params()
    assert {"autoplay", "offline", "rigged"} <= params  # the parser still finds them
    assert _doc()["site"].rstrip("/") == _site()
    for shot in _doc()["shots"]:
        if shot["status"] in {"ready", "stand-in"}:
            assert shot["url"], shot["id"]
        if shot["url"] is None:
            continue
        url = urlsplit(shot["url"])
        assert (url.scheme, url.netloc) == (site.scheme, site.netloc), shot["id"]
        assert set(parse_qs(url.query)) <= params, f"{shot['id']}: unknown URL parameter"


def test_actions_use_the_capture_scripts_vocabulary():
    actions, waits = _object_keys("ACTIONS"), _object_keys("WAITS")
    assert {"wait", "click", "select", "fill", "scroll", "hold"} <= actions
    assert {"assets", "live", "breakdown"} <= waits
    for shot in _doc()["shots"]:
        steps = shot["setup"] + shot["actions"]
        if shot["status"] in {"ready", "stand-in"}:
            assert shot["actions"], shot["id"]
        for step in steps:
            assert step["do"] in actions, f"{shot['id']}: {step}"
            if step["do"] == "wait":
                assert step["for"] in waits, f"{shot['id']}: {step}"
            if step["do"] == "click":
                assert step.get("selector") or (step.get("role") and step.get("name")), step
            assert step.get("hold", 0) >= 0


def test_voice_over_numbers_come_only_from_verified_claim_slots():
    doc = _doc()
    assert {(h["persona"], h["language"]) for h in doc["harvest"]} <= {
        (p, lang) for p in ("casual", "analyst", "player_fan", "coach") for lang in ("en", "zh")
    }
    for shot in doc["shots"]:
        for key in ("vo", "vo_fallback"):
            text = shot.get(key)
            if text is None:
                continue
            assert not re.search(r"\{(?![a-z_]+\.[a-z_]+\})", text), f"{shot['id']}: malformed slot"
            if key == "vo_fallback":
                assert not SLOT.search(text), f"{shot['id']}: the fallback must not need claims"
            bare = PLAYER_ID.sub("", SLOT.sub("", text))
            assert not re.search(r"\d", bare), f"{shot['id']} {key}: a digit outside a slot"
            assert not NUMBER_WORDS.search(bare), f"{shot['id']} {key}: a number word"
