"""The data files web/ ships must be what sim.export generates now (SPEC 3.7, 7).

Regenerate with the command in web/README.md whenever sim/, analytics/ or explain/ change.

Where the files are generated (macOS on Apple silicon) they must match byte for byte. Elsewhere,
CI on x86 included, SPEC 3.7 promises no cross-platform identity, so the check is structural:
every key, list length, string, frame number, event, alert and decision must match exactly, and
only quantised measurements may differ in their last unit (1 mm or 1e-4 rad in the tracking
arrays; 2e-4 in rounded floats).
"""

import json
import platform
from pathlib import Path

import pytest

from sim.export import (
    export_hero,
    export_what_ifs,
    hero_json,
    payload_fixture_json,
    render_payload_fixture,
    what_ifs_json,
)

SCENARIO, SEED = "blind_side_run", 3
DATA = Path(__file__).parent.parent / "web" / "public" / "data"
GENERATED_ON = ("Darwin", "arm64")
TRACKING = {"pos", "ghost", "head", "body", "ball"}  # integer mm / 1e-4 rad arrays
FLOAT_TOL = 2e-4


def _assert_close(fresh, committed, where="", tracking=False):
    if isinstance(fresh, dict):
        assert isinstance(committed, dict) and set(fresh) == set(committed), where
        for k in fresh:
            _assert_close(fresh[k], committed[k], f"{where}/{k}", tracking or k in TRACKING)
    elif isinstance(fresh, list):
        assert isinstance(committed, list) and len(fresh) == len(committed), where
        for i, (a, b) in enumerate(zip(fresh, committed, strict=True)):
            _assert_close(a, b, f"{where}[{i}]", tracking)
    elif isinstance(fresh, bool) or fresh is None or isinstance(fresh, str):
        assert fresh == committed, where
    elif isinstance(fresh, int) and isinstance(committed, int):
        assert abs(fresh - committed) <= (1 if tracking else 0), f"{where}: {fresh} != {committed}"
    else:
        assert abs(fresh - committed) <= FLOAT_TOL, f"{where}: {fresh} != {committed}"


def _assert_current(fresh_text: str, name: str) -> None:
    committed = (DATA / name).read_text()
    stale = f"web/public/data/{name} is stale: regenerate it (web/README.md)"
    if (platform.system(), platform.machine()) == GENERATED_ON:
        assert fresh_text == committed, stale
    else:
        _assert_close(json.loads(fresh_text), json.loads(committed), name)


@pytest.fixture(scope="module")
def hero():
    return export_hero(SCENARIO, SEED)


def test_hero_export_is_current(hero):
    _assert_current(hero_json(hero), "hero_seed3.json")


def test_payload_fixture_is_current(hero):
    fixture = render_payload_fixture(hero)
    _assert_current(payload_fixture_json(fixture), "fixture_payload_seed3.json")


def test_what_ifs_are_current():
    _assert_current(what_ifs_json(export_what_ifs(SCENARIO, SEED)), "whatif_seed3.json")


def test_the_structural_check_catches_stale_alerts_but_not_last_unit_noise(hero):
    """What CI relies on off the generating platform."""
    committed = json.loads(hero_json(hero))
    noisy = json.loads(hero_json(hero))
    noisy["runs"]["factual"]["pos"][10][0] += 1  # 1 mm
    noisy["runs"]["factual"]["possession_value"] += 1e-4
    _assert_close(noisy, committed)
    stale = json.loads(hero_json(hero))
    stale["runs"]["factual"]["blind_side"]["intervals"][0]["end"] += 1  # one frame
    with pytest.raises(AssertionError):
        _assert_close(stale, committed)
    shifted = json.loads(hero_json(hero))
    shifted["runs"]["factual"]["pos"][10][0] += 2  # 2 mm
    with pytest.raises(AssertionError):
        _assert_close(shifted, committed)
