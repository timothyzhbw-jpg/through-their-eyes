"""Scenario templates (SPEC 3.6): set up a recognisable situation inside normal play.

A scenario places the players, scripts a few of them, and may force scans and passes. Everything
else — perception, decisions, physics — is the same engine code for every scenario.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from sim.config import A_MAX, D_MAX, DT, HALF_LENGTH, ROLES
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


@dataclass(frozen=True)
class ForcedShot:
    """A scripted strike. `action` is `shot:<placement>`, the same shape `_kick_shot` reads."""

    shooter: str
    placement: str
    target: tuple[float, float]

    @property
    def action(self) -> str:
        return f"shot:{self.placement}"


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
    # Placed shots, keepers on the bisector who react when they see the ball, and the save model
    # (`sim.shots`, Module A). Off unless a scenario needs it, so the others keep their runs.
    shots: bool = False
    # Formation-based team shape (`sim.team_shape`, SPEC 3.2): every slot placed relative to its
    # team's block, by phase. Off unless a scenario sets it, so the others keep their runs.
    team_shape: bool = False
    # With `team_shape`: (home formation, away formation) and each player's slot by id.
    formation: tuple[str, str] = ("4-3-3", "4-2-3-1")
    slots: dict[str, str] = {}

    def setup(self, gen: np.random.Generator) -> Setup:
        raise NotImplementedError

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        """Player index -> (target, speed cap) for scripted players this frame."""
        return {}

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        return None

    def forced_shot(self, sim: Simulation, frame: int) -> ForcedShot | None:
        """A scripted strike when `shots` is on. Default off, so no other scenario kicks one."""
        return None

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        return {}

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """Players who may not start a spontaneous scan this frame."""
        return np.zeros(len(sim.ids), dtype=bool)

    def decides(self, sim: Simulation, player: int) -> bool:
        """Whether a player who just took control of the ball makes a decision."""
        return False

    def ends_on_pass(self, sim: Simulation, passer: int) -> bool:
        """Whether this pass, played by `passer` now, is the moment's pass: the run ends
        `SimParams.tail_s` after it is resolved. By default, any pass by the hero."""
        return sim.ids[passer] == self.hero

    def ends_on_shot(self, sim: Simulation, shooter: int) -> bool:
        """Whether this shot ends the run `SimParams.tail_s` after it resolves. Defaults to
        `ends_on_pass`, so a hero's own strike still ends the run."""
        return self.ends_on_pass(sim, shooter)


def marking_target_on_belief(sim: Simulation, marker: int, man: int, gap: float) -> np.ndarray:
    """Goal-side of where `marker` believes his man is (SPEC 3.4 belief, 3.6 set piece).

    A marker who has not seen his man for a while marks the extrapolated last sighting, so he can
    lose a man who moved out of his field of view. The other scenarios mark the true position.
    """
    pos, _, _ = sim.beliefs.estimate(marker, sim.frame, DT, sim.params.belief_horizon_s)
    believed = pos[man]
    own_goal = np.array([HALF_LENGTH if sim.team[marker] == 1 else -HALF_LENGTH, 0.0])
    side = own_goal - believed
    return believed + gap * side / max(float(np.linalg.norm(side)), 1e-6)
