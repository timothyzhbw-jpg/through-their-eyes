"""Fictional names for the synthetic players and the two clubs (SPEC 4.6, 7).

Names are presentation only and are not in the export: the sim, the claims and the evidence keep
the ids (H8, A5) and the teams (0 home, 1 away). Narration renders players by their short names
(agents/context.py `names`, slot values the Verifier checks) and the clubs by theirs.
"""

from __future__ import annotations

import re

ROSTER: dict[str, tuple[str, str]] = {
    "H1": ("Bram", "Oystervelt"),
    "H2": ("Tiago", "Marrenko"),
    "H3": ("Sully", "Brannagh"),
    "H4": ("Kofi", "Annersley"),
    "H5": ("Dario", "Velkamp"),
    "H6": ("Emre", "Saltonby"),
    "H7": ("Rui", "Castellane"),
    "H8": ("Joss", "Ferriday"),
    "H9": ("Nico", "Varnhall"),
    "H10": ("Lio", "Brackwell"),
    "H11": ("Sami", "Okondru"),
    "A1": ("Henrik", "Talvisto"),
    "A2": ("Yusuf", "Pellard"),
    "A3": ("Marek", "Undholm"),
    "A4": ("Ossian", "Grevholt"),
    "A5": ("Teo", "Mardelius"),
    "A6": ("Bastien", "Coulvard"),
    "A7": ("Ilyas", "Fenmore"),
    "A8": ("Caio", "Brunvald"),
    "A9": ("Matteo", "Quillan"),
    "A10": ("Jory", "Kestrell"),
    "A11": ("Anders", "Vintergren"),
}


def full_name(pid: str) -> str:
    """'Joss Ferriday'; an unknown id is returned unchanged."""
    found = ROSTER.get(pid)
    if found is None:
        return pid
    first, last = found
    return f"{first} {last}"


def short_name(pid: str) -> str:
    """'J. Ferriday'; an unknown id is returned unchanged."""
    found = ROSTER.get(pid)
    if found is None:
        return pid
    first, last = found
    return f"{first[0]}. {last}"


# The two clubs, home (team 0) and away (team 1): name, three-letter code, Chinese name. Invented;
# no real club goes by either (checked 2026-10-21).
CLUBS: dict[int, tuple[str, str, str]] = {
    0: ("Kestrel Bay", "KES", "红隼湾"),
    1: ("Corvane Vale", "COR", "科尔瓦恩谷"),
}


def club_name(team: int, lang: str = "en") -> str:
    """'Kestrel Bay' for the home side (team 0); in Chinese with `lang` "zh"."""
    name, _, zh = CLUBS[team]
    return zh if lang == "zh" else name


def club_code(team: int) -> str:
    """'KES': the score bug's short form."""
    return CLUBS[team][1]


# A player id as a whole token: not inside another word, a number or an event id (scan:H8:0050).
# A CJK character next to it is a boundary (Chinese text has no spaces).
_ID = re.compile(r"(?<![A-Za-z0-9_:])[HA](?:1[01]|[1-9])(?![A-Za-z0-9_:])")


def rename_ids(text: str) -> str:
    """Every player id in `text` as his short name: 'H8 passed to H4' -> 'J. Ferriday passed to
    K. Annersley'. For text rendered before names were (cached breakdowns): the Verifier lets an id
    into a line only as a slot value, so each id in it names a player."""
    return _ID.sub(lambda m: short_name(m.group(0)), text)


# How text rendered before the clubs had names speaks of them (explain/recap.py templates).
_CLUB_WORDS = [
    (re.compile(r"\bHome\b"), club_name(0)),
    (re.compile(r"\bAway\b"), club_name(1)),
    (re.compile("主队"), club_name(0, "zh")),
    (re.compile("客队"), club_name(1, "zh")),
]


def rename_clubs(text: str) -> str:
    """'Home' and 'Away' (主队, 客队) as the clubs' names, in a recap's text rendered before the
    clubs had names. Only for recap text: there those words name the two sides and nothing else."""
    for pattern, name in _CLUB_WORDS:
        text = pattern.sub(name, text)
    return text
