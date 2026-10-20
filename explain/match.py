"""Moments across a stitched match (SPEC 3.1, 5.1, 5.2).

Every possession's moments are detected and explained on its own run (`explain_moments`: the
lenses re-simulate (scenario, seed), in local frames), then lifted to match time: ids, frames,
times, anchors and events move by the possession's start. Each lifted card is the MomentCard's
JSON plus four keys: `possession` (its index), `local_id` (the card id inside the possession, for
breakdowns and counterfactuals), `hero` (the scenario's hero decision) and `start` (the
possession's first match frame).
"""

from __future__ import annotations

from typing import Any

from explain.cards import MomentCard
from explain.lenses import explain_moments
from sim.match import Possession, StitchedMatch, global_id


def lift_card(card: MomentCard, p: Possession) -> dict[str, Any]:
    """A possession's card in match time."""
    data = card.model_dump(mode="json")
    d = p.run.hero_decision()
    hero = (
        d is not None
        and not card.live_only
        and (card.actor, card.anchor_frame) == (d.player, d.frame)
    )
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
        out += [lift_card(c, p) for c in explained]
    return sorted(out, key=lambda c: (c["anchor_frame"], c["id"]))
