"""Scenario templates for hero moments (SPEC 3.6)."""

from sim.scenarios.base import Scenario
from sim.scenarios.blind_side_run import BlindSideRun
from sim.scenarios.possession_play import PossessionPlay
from sim.scenarios.press_escape import PressEscape

SCENARIOS: dict[str, type[Scenario]] = {
    BlindSideRun.name: BlindSideRun,
    PossessionPlay.name: PossessionPlay,
    PressEscape.name: PressEscape,
}
