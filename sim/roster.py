"""Fictional names for the synthetic players and the two clubs (SPEC 4.6, 7).

Names are presentation only and are not in the export: the sim, the claims and the evidence keep
the ids (H8, A5) and the teams (0 home, 1 away). Narration renders players by their short names
(agents/context.py `names`, slot values the Verifier checks) and the clubs by theirs. In
Chinese they go by `ZH_NAMES`, as a Chinese commentator names a player over an English world
feed: the screen's labels stay "J. Ferriday", the zh captions and voice say 费里迪.
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


# Each surname transliterated as Chinese football media write foreign players (Xinhua style): what
# zh narration writes and the zh voices say. "J. Ferriday" in Chinese speech came out as "G
# Faraday" (zh-qa, 2026-10-22). One edit here renames a player in every zh line.
ZH_NAMES: dict[str, str] = {
    "H1": "奥伊斯特维尔特",
    "H2": "马伦科",
    "H3": "布兰纳",
    "H4": "安纳斯利",
    "H5": "韦尔坎普",
    "H6": "索尔顿比",
    "H7": "卡斯特兰",
    "H8": "费里迪",
    "H9": "瓦恩霍尔",
    "H10": "布拉克韦尔",
    "H11": "奥孔德鲁",
    "A1": "塔尔维斯托",
    "A2": "佩拉德",
    "A3": "温德霍尔姆",
    "A4": "格雷夫霍尔特",
    "A5": "马德利乌斯",
    "A6": "库尔瓦尔",
    "A7": "芬莫尔",
    "A8": "布伦瓦尔德",
    "A9": "奎兰",
    "A10": "凯斯特雷尔",
    "A11": "温特格伦",
}


def short_name(pid: str, lang: str = "en") -> str:
    """'J. Ferriday'; '费里迪' in Chinese (`lang` "zh"); an unknown id is returned unchanged."""
    if lang == "zh" and pid in ZH_NAMES:
        return ZH_NAMES[pid]
    found = ROSTER.get(pid)
    if found is None:
        return pid
    first, last = found
    return f"{first[0]}. {last}"


def name_forms(pid: str) -> set[str]:
    """Every way a text may write the player: his id, short name, surname (alone or in his full
    name) and Chinese name. The Verifier allows each of them only inside a slot
    (explain/render.py)."""
    forms = {pid}
    if pid in ROSTER:
        forms |= {short_name(pid), ROSTER[pid][1]}
    if pid in ZH_NAMES:
        forms.add(ZH_NAMES[pid])
    return forms


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
