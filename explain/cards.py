"""MomentCard: the shared state the agents work on (SPEC 5.1, 5.2, 6).

A card is what the moment detectors found, plus the candidate explanations (lenses) with their
counterfactual impact. It crosses process boundaries (API, MCP tools, agents), so it is a
pydantic model that serialises to JSON. Numbers are rounded to 4 decimals so the JSON is stable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MomentKind = Literal["decision_after_scan", "line_breaking_pass", "sprint"]
LensName = Literal["scan", "space", "pressure"]
Scalar = bool | int | float | str | None


class TimeWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame_start: int
    frame_end: int
    t_start: float  # s
    t_end: float  # s


class LensResult(BaseModel):
    """One candidate explanation and its counterfactual impact.

    `delta_xt` is in one currency for every lens: expected possession value (xT units) of the
    action, judged on the true state at the decision (see `explain.lenses`).
    """

    model_config = ConfigDict(extra="forbid")

    lens: LensName
    available: bool
    delta_xt: float | None = None
    metrics: dict[str, Scalar] = Field(default_factory=dict)
    evidence: list[str] = Field(default_factory=list)  # event ids
    note: str = ""


class MomentCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str  # "<kind>:<player>:<frame>", stable across factual and counterfactual runs
    kind: MomentKind
    scenario: str
    seed: int
    frame: int  # anchor frame: the action, or the peak of a sprint
    t: float  # s
    window: TimeWindow
    player: str  # protagonist
    team: int
    players: list[str]  # involved players, protagonist first
    anchor_events: list[str]  # event ids the moment is built on, in time order
    decision_frame: int | None = None  # the protagonist's decision, when the moment has one
    action_event: str | None = None  # the pass or shot that decision produced
    live_only: bool = False  # a live overlay tag, not a breakdown
    metrics: dict[str, Scalar] = Field(default_factory=dict)
    candidate_lenses: list[LensResult] = Field(default_factory=list)
    selected_lens: LensName | None = None


def rounded(value: float, digits: int = 4) -> float:
    return round(float(value), digits)
