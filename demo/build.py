"""Build the single-file hero demo page from a sim export (SPEC 7, stand-in for web/).

    uv run python -m demo.build --seed 3

Writes demo/hero.html (page body for publishing) and out/hero_preview.html (a full HTML document
for opening locally).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sim.export import export_hero

HERE = Path(__file__).parent
ROOT = HERE.parent


def build(scenario: str, seed: int) -> str:
    data = json.dumps(export_hero(scenario, seed), separators=(",", ":")).replace("</", "<\\/")
    template = (HERE / "hero.template.html").read_text()
    return template.replace("/*__DATA__*/", data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the hero demo page.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    args = parser.parse_args()
    page = build(args.scenario, args.seed)
    (HERE / "hero.html").write_text(page)
    preview = ROOT / "out" / "hero_preview.html"
    preview.parent.mkdir(exist_ok=True)
    preview.write_text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        f"</head><body>{page}</body></html>"
    )
    print(f"wrote {HERE / 'hero.html'} ({len(page) / 1024:.0f} KB) and {preview}")


if __name__ == "__main__":
    main()
