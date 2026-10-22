"""The web app's pitch is the sim's pitch (SPEC 3.9, IFAB Laws of the Game, Law 1).

`web/src/views/fieldMarkings.ts` holds the field markings and goals every view draws; this test
checks its numbers against `sim/laws.py`, and that no view draws a marking from its own literal.
"""

import re
from pathlib import Path

import pytest

from sim import laws

WEB = Path(__file__).resolve().parent.parent / "web" / "src"
MARKINGS = WEB / "views" / "fieldMarkings.ts"

SIM = {
    "length": laws.PITCH_LENGTH,
    "width": laws.PITCH_WIDTH,
    "lineWidth": laws.LINE_WIDTH,
    "goalWidth": laws.GOAL_WIDTH,
    "goalHeight": laws.GOAL_HEIGHT,
    "postWidth": laws.POST_WIDTH,
    "goalAreaDepth": laws.GOAL_AREA_DEPTH,
    "penaltyAreaDepth": laws.PENALTY_AREA_DEPTH,
    "penaltyMark": laws.PENALTY_MARK_DISTANCE,
    "centreCircle": laws.CENTRE_CIRCLE_RADIUS,
    "penaltyArc": laws.PENALTY_ARC_RADIUS,
    "cornerArc": laws.CORNER_ARC_RADIUS,
}


def web_law1() -> dict[str, float]:
    block = re.search(r"export const LAW1 = \{(.*?)\} as const;", MARKINGS.read_text(), re.S)
    assert block, "fieldMarkings.ts has no LAW1 block"
    return {k: float(v) for k, v in re.findall(r"(\w+): ([0-9.]+)", block.group(1))}


def test_the_web_draws_the_sims_law_1_pitch():
    assert web_law1() == pytest.approx(SIM)


# Literals that would mean a view draws a marking or a goal by itself.
STRAY = re.compile(r"(?<![\w.])(3\.66|7\.32|2\.44|9\.15|9\.16|16\.5|18\.32|20\.16|40\.32)(?![\w])")


def code(line: str) -> str:
    """A line without its comment (`//`, or a `/* ... */` or `*` doc line)."""
    text = line.strip()
    return "" if text.startswith(("/*", "*")) else text.split("//")[0]


def test_no_view_draws_a_marking_from_its_own_numbers():
    found = []
    for folder in ("views", "yourcall", "pitchControl", "players"):  # where the pitch is drawn
        for path in sorted((WEB / folder).rglob("*.ts*")):
            if path == MARKINGS or ".test." in path.name:
                continue
            for n, line in enumerate(path.read_text().splitlines(), 1):
                if STRAY.search(code(line)):
                    found.append(f"{path.relative_to(WEB)}:{n}: {line.strip()}")
    assert found == []
