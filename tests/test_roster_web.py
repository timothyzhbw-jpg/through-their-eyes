"""The web app's copy of the fictional names (web/src/data/roster.ts) matches sim/roster.py."""

import re
from pathlib import Path

from sim.roster import CLUBS, ROSTER, ZH_NAMES

WEB = Path(__file__).resolve().parents[1] / "web" / "src" / "data" / "roster.ts"


def test_the_web_roster_is_the_sims():
    text = WEB.read_text()
    players = dict(
        (pid, (first, last))
        for pid, first, last in re.findall(r'^\s+(\w+): \["([^"]+)", "([^"]+)"\],$', text, re.M)
    )
    assert players == ROSTER
    clubs = {
        int(team): (name, code, zh)
        for team, name, code, zh in re.findall(
            r'^\s+(\d): \{ name: "([^"]+)", code: "([^"]+)", zh: "([^"]+)" \},$', text, re.M
        )
    }
    assert clubs == CLUBS
    block = text[text.index("export const ZH_NAMES") :]
    block = block[: block.index("};")]
    assert dict(re.findall(r'^\s+(\w+): "([^"]+)",$', block, re.M)) == ZH_NAMES
