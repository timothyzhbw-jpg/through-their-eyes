"""Moments across a stitched match (SPEC 3.1, 5.1, 5.2).

Every possession's moments are detected and explained on its own run (`explain_moments`: the
lenses re-simulate (scenario, seed), in local frames), then lifted to match time: ids, frames,
times, anchors and events move by the possession's start. Each lifted card is the MomentCard's
JSON plus four keys: `possession` (its index), `local_id` (the card id inside the possession, for
breakdowns and counterfactuals), `hero` (the scenario hero's moment, `explain.moments.hero_card`:
his decision, or a marker's look) and `start` (the possession's first match frame).
"""

from __future__ import annotations

from typing import Any

from explain.cards import MomentCard
from explain.lenses import explain_moments
from explain.moments import hero_card
from sim.match import Possession, StitchedMatch, global_id


def lift_card(card: MomentCard, p: Possession, hero: bool = False) -> dict[str, Any]:
    """A possession's card in match time; `hero` marks the scenario hero's moment."""
    data = card.model_dump(mode="json")
    at = p.start * p.run.dt
    data |= {
        "id": global_id(card.id, p.start),
        "frame_start": card.frame_start + p.start,
        "frame_end": card.frame_end + p.start,
        "anchor_frame": card.anchor_frame + p.start,
        "t_start": round(card.t_start + at, 4),
        "t_end": round(card.t_end + at, 4),
        "anchor_t": round(card.anchor_t + at, 4),
        "anchors": {k: global_id(v, p.start) for k, v in card.anchors.items()},
        "events": [global_id(e, p.start) for e in card.events],
        "possession": p.index,
        "local_id": card.id,
        "hero": hero,
        "start": p.start,
    }
    return data


def match_moments(match: StitchedMatch, cards: dict[int, list[MomentCard]] | None = None):
    """Every moment of the match, in match time and anchor order. `cards` may supply a
    possession's already-explained cards (by possession index) to save re-simulating them."""
    out = []
    for p in match.possessions:
        explained = (cards or {}).get(p.index)
        if explained is None:
            explained = explain_moments(p.run)
        h = hero_card(p.run, explained)
        out += [lift_card(c, p, h is not None and c.id == h.id) for c in explained]
    return sorted(out, key=lambda c: (c["anchor_frame"], c["id"]))
