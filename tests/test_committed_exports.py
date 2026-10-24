"""The data files web/ ships must be what sim.export generates now (SPEC 3.7, 7).

Regenerate with the commands in web/README.md whenever sim/, analytics/ or explain/ change.

They are generated on Linux (python:3.11-slim, `scripts/regen_linux.sh exports`), where CI and
the live API run, and must match there byte for byte. The sim is byte-identical only within one
OS (SPEC 3.7): off Linux these checks skip (`tests/canonical.py`).

Two files are the exception, checked with `_assert_near`: some GitHub x86_64 runners rebuild them
with different last bits even on numpy's pinned tier (main's CI on 2026-10-23, after #172 and
#207: the same bytes as linux/arm64), and the sim amplifies those. There the structure stays
exact (every key, length, string, id, frame, event, decision and non-tracking integer) and the
numbers may move by what was measured on that runner, no more.
"""

import json
import math
from pathlib import Path

import pytest

from sim.export import (
    export_extra_looks,
    export_hero,
    export_looks,
    export_what_ifs,
    export_without_look,
    hero_json,
    looks_json,
    payload_fixture_json,
    render_payload_fixture,
    what_ifs_json,
    without_look_json,
)
from tests import canonical

SCENARIO, SEED = "blind_side_run", 3
DATA = Path(__file__).parent.parent / "web" / "public" / "data"
# Quantised measurements: integer mm, 1e-4 rad and 1e-4 rad/s.
# The tracking arrays' quantised values: positions in integer mm, angles in 1e-4 rad.
POSITIONS = {"pos", "ghost", "ball"}
TRACKING = POSITIONS | {"head", "body", "omega", "amplitude"}
QUANTUM = 1
# The far-post what-if's forced re-sims (the keeper's positioning and save model) moved positions
# by up to 8 mm (738 of 40,342 values) on that runner; nothing else in the file moved.
FAR_POST_MM = 10
# An unrounded float (a possession value, a ΔxT) moved in its last bits only: 8.7e-19 at most.
FLOAT_REL, FLOAT_ABS = 1e-12, 1e-15


def _assert_close(fresh, committed, where="", key="", pos_mm=QUANTUM):
    """Exact structure; positions within `pos_mm`, other tracking within one quantum, other
    integers exact, unrounded floats within FLOAT_REL / FLOAT_ABS."""
    if isinstance(fresh, dict):
        assert isinstance(committed, dict) and set(fresh) == set(committed), where
        for k in fresh:
            inner = key if key in TRACKING else k
            _assert_close(fresh[k], committed[k], f"{where}/{k}", inner, pos_mm)
    elif isinstance(fresh, list):
        assert isinstance(committed, list) and len(fresh) == len(committed), where
        for i, (a, b) in enumerate(zip(fresh, committed, strict=True)):
            _assert_close(a, b, f"{where}[{i}]", key, pos_mm)
    elif isinstance(fresh, bool) or fresh is None or isinstance(fresh, str):
        assert fresh == committed, where
    elif isinstance(fresh, int) and type(committed) is int:
        allowed = pos_mm if key in POSITIONS else QUANTUM if key in TRACKING else 0
        assert abs(fresh - committed) <= allowed, f"{where}: {fresh} != {committed}"
    else:
        assert type(fresh) is float and type(committed) is float, where
        assert math.isclose(fresh, committed, rel_tol=FLOAT_REL, abs_tol=FLOAT_ABS), (
            f"{where}: {fresh} != {committed}"
        )


def _assert_current(fresh_text: str, name: str) -> None:
    """Byte for byte on Linux, the canonical platform (`tests/canonical.py`); skipped elsewhere."""
    if not canonical.ON_LINUX:
        pytest.skip(canonical.message())
    committed = (DATA / name).read_text()
    stale = f"web/public/data/{name} is stale: {canonical.message()}"
    assert fresh_text == committed, stale


def _assert_near(fresh_text: str, name: str, pos_mm: int = QUANTUM) -> None:
    """Byte for byte, or failing that `_assert_close`: for the two files a runner rebuilds with
    other last bits (module docstring)."""
    if not canonical.ON_LINUX:
        pytest.skip(canonical.message())
    committed = (DATA / name).read_text()
    if fresh_text != committed:
        _assert_close(json.loads(fresh_text), json.loads(committed), name, pos_mm=pos_mm)


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


def test_press_escape_what_ifs_are_current():
    _assert_current(
        what_ifs_json(export_what_ifs("press_escape", 0)), "whatif_press_escape_seed0.json"
    )


@pytest.mark.parametrize(
    ("scenario", "seed", "name"),
    [("blind_side_run", 3, "look_seed3.json"), ("press_escape", 0, "look_press_escape_seed0.json")],
)
def test_look_grids_are_current(scenario, seed, name):
    _assert_near(looks_json(export_looks(scenario, seed)), name)


def test_without_look_lines_are_current():
    _assert_current(
        without_look_json(export_without_look(SCENARIO, SEED)), "without_look_seed3.json"
    )


def test_extra_looks_lines_are_current():
    _assert_current(without_look_json(export_extra_looks(SCENARIO, SEED)), "extra_looks_seed3.json")


def test_far_post_finish_without_look_lines_are_current():
    fresh = without_look_json(export_without_look("far_post_finish", 11))
    _assert_current(fresh, "without_look_far_post_finish_seed11.json")


def test_far_post_finish_what_ifs_are_current():
    fresh = what_ifs_json(export_what_ifs("far_post_finish", 11))
    _assert_near(fresh, "whatif_far_post_finish_seed11.json", FAR_POST_MM)


def test_the_structural_check_catches_stale_alerts_but_not_last_unit_noise(hero):
    """What `_assert_near` allows: one quantum in the tracking (or `pos_mm` in a position), a few
    ULPs in a float."""
    committed = json.loads(hero_json(hero))
    noisy = json.loads(hero_json(hero))
    noisy["runs"]["factual"]["pos"][10][0] += 1  # 1 mm
    noisy["runs"]["factual"]["head"][10][0] += 1  # 1e-4 rad
    noisy["runs"]["factual"]["possession_value"] *= 1 + 4e-16
    _assert_close(noisy, committed)
    moved = json.loads(hero_json(hero))
    moved["runs"]["factual"]["possession_value"] += 1e-9
    with pytest.raises(AssertionError):
        _assert_close(moved, committed)
    far = json.loads(hero_json(hero))
    far["runs"]["factual"]["pos"][10][0] += FAR_POST_MM
    _assert_close(far, committed, pos_mm=FAR_POST_MM)
    far["runs"]["factual"]["pos"][10][0] += 1
    with pytest.raises(AssertionError):
        _assert_close(far, committed, pos_mm=FAR_POST_MM)
    turned = json.loads(hero_json(hero))
    turned["runs"]["factual"]["head"][10][0] += 2  # positions' bound is not the angles'
    with pytest.raises(AssertionError):
        _assert_close(turned, committed, pos_mm=FAR_POST_MM)
    stale = json.loads(hero_json(hero))
    stale["runs"]["factual"]["blind_side"]["intervals"][0]["end"] += 1  # one frame
    with pytest.raises(AssertionError):
        _assert_close(stale, committed)
    shifted = json.loads(hero_json(hero))
    shifted["runs"]["factual"]["pos"][10][0] += 2  # 2 mm
    with pytest.raises(AssertionError):
        _assert_close(shifted, committed)


def test_the_single_file_demo_page_is_current():
    """demo/hero.html embeds the hero export; regenerate it with `uv run python -m demo.build`.

    It once kept the pre-calibration ΔxT (0.105) while the web data had 0.101.
    """
    from demo.build import build

    if not canonical.ON_LINUX:
        pytest.skip(canonical.message())
    committed = (DATA.parents[2] / "demo" / "hero.html").read_text()
    fresh = build(SCENARIO, SEED)
    assert fresh == committed, f"demo/hero.html is stale: {canonical.message()}"
