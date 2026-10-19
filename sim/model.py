"""Records the sim produces (SPEC 3.1)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sim.decision import OptionEval


@dataclass(frozen=True)
class PlayerInfo:
    id: str  # "H8": team letter + shirt number
    team: int  # 0 home (attacks +x in the first half), 1 away
    role: str
    number: int
    v_max: float
    a_max: float
    d_max: float
    scan_rate: float
    temperature: float


@dataclass
class Event:
    id: str  # "<type>:<player>:<frame>", stable across factual and counterfactual runs
    type: str
    frame: int
    t: float
    player: str
    team: int
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Decision:
    frame: int
    player: str
    options: list[OptionEval]
    chosen: str
    noise: dict[str, float]  # keyed Gumbel noise per option (Gumbel-max sampling)
    belief_error: dict[str, float]  # m, believed vs true position of every player
    belief_age: dict[str, float]  # s since each player was last seen
