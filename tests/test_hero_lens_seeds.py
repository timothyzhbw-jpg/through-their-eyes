"""eval/hero_lens.py: the canonical report is always on the scenario's held-out seeds (SPEC 3.6)."""

from pathlib import Path

from eval.hero_lens import REPORTS, default_seeds, report_path


def test_press_escape_defaults_to_its_fresh_held_out_seeds():
    # 100-139 were seen while fixing the decision model; 200-239 were not.
    assert default_seeds("press_escape") == list(range(200, 240))
    assert default_seeds("blind_side_run") == list(range(100, 140))


def test_only_the_held_out_seeds_write_the_canonical_report():
    assert report_path("press_escape", list(range(200, 240))) == (
        REPORTS / "hero_lens_press_escape.md"
    )
    assert report_path("press_escape", list(range(100, 140))) == (
        REPORTS / "hero_lens_press_escape_100-139.md"
    )
    assert report_path("blind_side_run", list(range(100, 140))) == (
        REPORTS / "hero_lens_blind_side_run.md"
    )
    assert report_path("press_escape", [7]) == REPORTS / "hero_lens_press_escape_7-7.md"


def test_out_overrides_the_report_path():
    out = Path("out/elsewhere.md")
    assert report_path("press_escape", list(range(200, 240)), out) == out
