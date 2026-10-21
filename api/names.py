"""Fictional names in what the service serves (SPEC 4.6, 7).

Narration renders players by their fictional short names (agents/context.py `names`), so a new
breakdown, recap or what-if answer names them already. One cached before that names them by id:
`rename` maps each id in its text to the name, as rendering with names would have (the Verifier
lets an id into a line only as a slot value), and the voice cues' SSML with it, each with the cache
key of its new SSML. A recap's lines also say "Home" and "Away" (its claim templates, which its
cache key covers): `clubs=True` names the two clubs (sim/roster.py). Data stays as it is: moment and
claim ids, claim values, evidence and the script's templates.

Nothing is generated again, so nothing costs a model call. `Renamed` applies it to every value read
from a cache; values are stored as given.
"""

from __future__ import annotations

from typing import Any

from agents.delivery import cache_key
from sim.roster import rename_clubs, rename_ids

# Keys whose string values are words a viewer reads or hears; everything else is data.
_TEXT = "text"
_SSML = "ssml"


def rename(value: Any, *, clubs: bool = False) -> Any:
    """A copy of `value` (cached JSON) with players, and with `clubs` the clubs, named; `value`
    itself when nothing changes. Idempotent."""

    def words(text: str) -> str:
        text = rename_ids(text)
        return rename_clubs(text) if clubs else text

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            out = [walk(x) for x in node]
            return node if all(a is b for a, b in zip(out, node, strict=True)) else out
        if not isinstance(node, dict):
            return node
        changed = False
        out: dict[str, Any] = {}
        for k, v in node.items():
            if k in (_TEXT, _SSML) and isinstance(v, str):
                new: Any = words(v)
            else:
                new = walk(v)
            changed = changed or new is not v and new != v
            out[k] = new
        # A voice cue: its key names its SSML (agents/delivery.py), so a new SSML gets a new key.
        if isinstance(out.get(_SSML), str) and "cache_key" in out and out[_SSML] != node[_SSML]:
            out["cache_key"] = cache_key(out[_SSML])
        return out if changed else node

    return walk(value)


class Renamed:
    """A cache whose values are renamed on read (`rename`); `put` stores the value as given."""

    def __init__(self, cache: Any, *, clubs: bool = False) -> None:
        self.cache = cache
        self.clubs = clubs

    def get(self, key: str) -> Any:
        value = self.cache.get(key)
        return None if value is None else rename(value, clubs=self.clubs)

    def put(self, key: str, value: Any) -> None:
        self.cache.put(key, value)
