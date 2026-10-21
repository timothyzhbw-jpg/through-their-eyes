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
class NoScans:
    """The player starts no scan of his own, spontaneous or partial, in frames [start, end).
    Forced and added scans still start; `DropScan` stops a forced one."""

    player: str
    start: int
    end: int

    def apply(self, sim: Simulation) -> None:
        sim.no_scans[sim.index(self.player)] = (self.start, self.end)


@dataclass(frozen=True)
class AddScan:
    """The player starts a scan at `frame`, `offset` rad from where he would look without one (the
    ball; counter-clockwise positive, so + is over his left shoulder as he faces the ball).

    It takes the path of the scenario's forced scans (`sim.perception.ForcedScan`), so it is as
    physical as any other scan: the amplitude must lie in `SimParams.scan_amplitude`, the head
    turns at the scan's keyed peak speed (`SimParams.scan_omega`), and the dwell is the median of
    `SimParams.scan_dwell_s` unless given. Like a forced scan it waits for a scan under way and
    its refractory; `sim.counterfactual.add_scan_counterfactual` refuses a look that never starts.
    """

    player: str
    frame: int
    offset: float  # rad
    dwell_s: float | None = None

    def apply(self, sim: Simulation) -> None:
        lo, hi = sim.params.scan_amplitude
        if not lo - 1e-9 <= abs(self.offset) <= hi + 1e-9:
            raise ValueError(
                f"a scan turns {lo:.3f}-{hi:.3f} rad from the ball, not {abs(self.offset):.3f}"
            )
        dwell = sim.params.scan_dwell_s[0] if self.dwell_s is None else self.dwell_s
        if not 0.0 <= dwell <= sim.params.scan_dwell_max_s:
            raise ValueError(f"a scan dwells 0-{sim.params.scan_dwell_max_s} s, not {dwell}")
        sim.added_scans[(sim.index(self.player), self.frame)] = (self.offset, dwell)


@dataclass(frozen=True)
class ForceAction:
    """At this decision the player takes `action` (an option id such as "pass:H4")."""

    player: str
    frame: int
    action: str

    def apply(self, sim: Simulation) -> None:
        sim.forced_actions[(sim.index(self.player), self.frame)] = self.action
