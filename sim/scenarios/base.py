"""Scenario templates (SPEC 3.6): set up a recognisable situation inside normal play.

A scenario places the players, scripts a few of them, and may force scans and passes. Everything
else — perception, decisions, physics — is the same engine code for every scenario.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from sim.config import A_MAX, D_MAX, ROLES
from sim.model import PlayerInfo
from sim.perception import ForcedScan

if TYPE_CHECKING:
    from sim.engine import Simulation


@dataclass
class Setup:
    players: list[PlayerInfo]
    pos: np.ndarray  # (N, 2)
    ball_owner: int


@dataclass(frozen=True)
class ForcedPass:
    passer: str
    to: str
    target: tuple[float, float] | None = None  # defaults to the receiver's position


def make_player(pid: str, role: str) -> PlayerInfo:
    r = ROLES[role]
    return PlayerInfo(
        id=pid,
        team=0 if pid.startswith("H") else 1,
        role=role,
        number=int(pid[1:]),
        v_max=r.v_max,
        a_max=A_MAX,
        d_max=D_MAX,
        scan_rate=r.scan_rate,
        temperature=r.temperature,
    )


class Scenario:
    name = "base"
    hero: str | None = None
    # What a hero scenario is built to show (SPEC 3.6, 5.2): the lens that should explain its
    # moment, and the intervention that tests it (`sim.counterfactual.hero_counterfactual`):
    # "drop_scan" drops the key scan, "force:<action>" makes the hero take that option.
    lens: str | None = None
    intervention: str | None = None
    # Whether an opponent who gets to a carried ball wins it (`Simulation._check_tackle`). Off
    # unless a scenario needs it, so scenarios without it keep their runs byte for byte.
    tackles: bool = False

    def setup(self, gen: np.random.Generator) -> Setup:
        raise NotImplementedError

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        """Player index -> (target, speed cap) for scripted players this frame."""
        return {}

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        return None

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        return {}

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """Players who may not start a spontaneous scan this frame."""
        return np.zeros(len(sim.ids), dtype=bool)

    def decides(self, sim: Simulation, player: int) -> bool:
        """Whether a player who just took control of the ball makes a decision."""
        return False
