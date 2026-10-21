"""Counterfactual overrides applied when resuming from a snapshot (SPEC 3.7)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sim.engine import Simulation


@dataclass(frozen=True)
class DropScan:
    """The player does not perform this scan (id "scan:<player>:<start frame>")."""

    scan_id: str

    def apply(self, sim: Simulation) -> None:
        sim.dropped_scans.add(self.scan_id)


@dataclass(frozen=True)
class FreezeBelief:
    """The player's belief stops updating from `at_frame` on."""

    player: str
    at_frame: int

    def apply(self, sim: Simulation) -> None:
        sim.frozen_belief[sim.index(self.player)] = self.at_frame


@dataclass(frozen=True)
class ForceAction:
    """At this decision the player takes `action` (an option id such as "pass:H4")."""

    player: str
    frame: int
    action: str

    def apply(self, sim: Simulation) -> None:
        sim.forced_actions[(sim.index(self.player), self.frame)] = self.action


@dataclass(frozen=True)
class DropStep:
    """The player does not make this step (id "step:<player>:<start frame>")."""

    step_id: str

    def apply(self, sim: Simulation) -> None:
        sim.dropped_steps.add(self.step_id)


@dataclass(frozen=True)
class SightAt:
    """In this run the player's first sight of the current shot is `frame`, seen or not.

    Analysis only. With no override the keeper's sight is the ordinary visibility test.
    """

    player: str
    frame: int

    def apply(self, sim: Simulation) -> None:
        sim.sight_at[sim.index(self.player)] = self.frame
