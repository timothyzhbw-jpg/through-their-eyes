"""Held-out evidence for the "Without the look" panels, read from the committed eval reports.

It does not simulate, so web/public/data/hero_gates.json is the same on every platform.

    uv run python -m eval.hero_gates
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REPORTS = Path(__file__).parent / "reports"
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "data" / "hero_gates.json"

# The seed line uses an en dash, as the reports print it: "Seeds 100–139 (40)."
_SEEDS = re.compile(r"Seeds (\d+)–(\d+) \((\d+)\)\.")
_ROWS = {
    "decision": re.compile(r"\| Decision changed without the key scan \| (\d+)/(\d+) \("),
    "placement": re.compile(r"\| Placement changed without the key scan \| (\d+)/(\d+) \("),
}
# (scenario, what changed, report filename). The two scan heroes the panels compare.
_HEROES = (
    ("blind_side_run", "decision", "hero_flip_blind_side_run.md"),
    ("far_post_finish", "placement", "hero_shot_far_post_finish.md"),
)


def _label(filename: str) -> str:
    return f"eval/reports/{filename}"


def _find(text: str, pattern: re.Pattern[str], report: str, what: str) -> re.Match[str]:
    found = pattern.search(text)
    if not found:
        raise ValueError(f"{report}: no {what}")
    return found


def _hero(reports: Path, what: str, filename: str) -> dict:
    report = _label(filename)
    path = reports / filename
    if not path.is_file():
        raise ValueError(f"{report}: report is missing")
    text = path.read_text(encoding="utf-8")
    seeds = _find(text, _SEEDS, report, "seed line 'Seeds <first>–<last> (<n>).'")
    row = _find(text, _ROWS[what], report, f"'{what} changed without the key scan' row")
    first, last, n_line = (int(part) for part in seeds.groups())
    changed, n = (int(part) for part in row.groups())
    if n != n_line or last - first + 1 != n or changed > n:
        raise ValueError(f"{report}: Seeds {first}–{last} ({n_line}) disagrees with {changed}/{n}")
    return {
        "what": what,
        "changed": changed,
        "n": n,
        "same": n - changed,
        "seeds": [first, last],
        "report": report,
    }


def build(reports: Path = REPORTS) -> dict:
    """One entry per scan hero: how often the held-out seeds change when the key look is removed."""
    return {
        "version": 1,
        "heroes": {
            scenario: _hero(reports, what, filename) for scenario, what, filename in _HEROES
        },
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    text = json.dumps(build(), indent=1, sort_keys=True) + "\n"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
