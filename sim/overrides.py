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
