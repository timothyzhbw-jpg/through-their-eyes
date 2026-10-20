"""MomentCard (SPEC 5.1): the shared state the agents work on.

A detector creates the card (ids, time window, involved players, anchor events, key metrics,
candidate lenses); lens selection (`explain.lenses`) then records every candidate explanation and
the one with the largest counterfactual impact. Everything in a card is plain JSON.
"""

from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, Field

LensName = Literal["scan", "space", "pressure"]
MomentKind = Literal[
    "pressed_decision", "decision_after_scan", "line_breaking_pass", "sprint", "blind_side_pass"
]
Scalar = bool | int | float | str | None


class LensResult(BaseModel):
    """One candidate explanation. `delta_xt` is its counterfactual impact in xT of the acting team
    (see `explain.lenses` for how each lens converts to xT); None when the lens is unavailable."""

    lens: LensName
    available: bool
    delta_xt: float | None = None
    unit: Literal["xT"] = "xT"
    metrics: dict[str, Scalar] = Field(default_factory=dict)
    rows: list[dict[str, Scalar]] = Field(default_factory=list)  # per-option or per-scan table
    evidence: list[str] = Field(default_factory=list)  # event ids
    note: str = ""  # how the delta was computed, or why the lens is unavailable


class MomentCard(BaseModel):
    version: Literal[1] = 1
    id: str  # "m:<kind>:<actor>:<anchor frame>"
    kind: MomentKind  # the primary detector
    tags: list[MomentKind]  # every detector that fired on this action
    scenario: str
    seed: int
    live_only: bool = False  # overlay tag only, no breakdown (e.g. sprint)
    frame_start: int
    frame_end: int  # inclusive
    anchor_frame: int  # the key instant: the decision, or the start of the action
    t_start: float
    t_end: float
    anchor_t: float
    actor: str
    receiver: str | None = None
    players: list[str]  # everyone involved, the actor first
    anchors: dict[str, str] = Field(default_factory=dict)  # name -> event id ("reception", ...)
    events: list[str] = Field(default_factory=list)  # every event id in the moment, by frame
    metrics: dict[str, Scalar] = Field(default_factory=dict)
    candidate_lenses: list[LensName] = Field(default_factory=list)
    lenses: list[LensResult] = Field(default_factory=list)
    selected_lens: LensName | None = None

    def lens(self, name: LensName) -> LensResult | None:
        return next((lens for lens in self.lenses if lens.lens == name), None)

    def content_hash(self) -> str:
        """Key for the breakdown cache (SPEC 2)."""
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
