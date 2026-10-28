"""The seed gallery agrees with the hero-flip report it illustrates (SPEC 3.6, 11).

docs/hero-seeds.svg is drawn by eval/seed_gallery.py; each panel names its seed and both
decisions. The committed report was generated on Linux (SPEC 3.7), so this reads both files and
never re-runs the sim: a stale figure fails here after the report is regenerated.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "docs" / "hero-seeds.svg"
PNG = ROOT / "docs" / "hero-seeds.png"
REPORT = ROOT / "eval" / "reports" / "hero_flip_blind_side_run.md"


def _report_rows() -> dict[int, tuple[str, str]]:
    rows = {}
    for line in REPORT.read_text().splitlines():
        m = re.match(r"\| (\d+) \| `([^`]+)` \| [^|]+ \| [^|]+ \| `([^`]+)` \|", line)
        if m:
            rows[int(m[1])] = (m[2], m[3])
    return rows


def test_every_panel_matches_its_row_in_the_hero_flip_report():
    panels = re.findall(
        r'class="seed" data-seed="(\d+)" data-factual="([^"]+)" data-counterfactual="([^"]+)"',
        SVG.read_text(),
    )
    assert [int(s) for s, _, _ in panels] == list(range(100, 140, 5))
    rows = _report_rows()
    for seed, factual, counterfactual in panels:
        assert rows[int(seed)] == (factual, counterfactual), seed


def test_the_png_is_committed_beside_the_svg():
    assert PNG.stat().st_size > 50_000
    assert PNG.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_the_app_shows_the_same_png():
    # The look's compare panel shows a copy (web/public/img/seeds); it must not drift from this one.
    web = ROOT / "web" / "public" / "img" / "seeds" / "hero-seeds.png"
    assert web.read_bytes() == PNG.read_bytes()
