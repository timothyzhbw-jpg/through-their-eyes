"""Fictional names for the synthetic players (SPEC 4.6).

Names are presentation only and are not in the export.
"""

from __future__ import annotations

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
