"""Scenario templates for hero moments (SPEC 3.6)."""

from sim.scenarios.base import Scenario
from sim.scenarios.blind_side_run import BlindSideRun
from sim.scenarios.corner_blind_side import CornerBlindSide
from sim.scenarios.cutback_scan import CutbackScan
from sim.scenarios.possession_play import PossessionPlay
from sim.scenarios.press_escape import PressEscape

SCENARIOS: dict[str, type[Scenario]] = {
    BlindSideRun.name: BlindSideRun,
    CornerBlindSide.name: CornerBlindSide,
    CutbackScan.name: CutbackScan,
    PossessionPlay.name: PossessionPlay,
    PressEscape.name: PressEscape,
}
