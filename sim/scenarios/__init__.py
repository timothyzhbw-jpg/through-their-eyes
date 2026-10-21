"""Scenario templates for hero moments (SPEC 3.6)."""

from sim.scenarios.base import Scenario
from sim.scenarios.blind_side_run import BlindSideRun
from sim.scenarios.corner_blind_side import CornerBlindSide
from sim.scenarios.far_post_finish import FarPostFinish
from sim.scenarios.possession_play import PossessionPlay
from sim.scenarios.press_escape import PressEscape
from sim.scenarios.screened_shot import ScreenedShot

SCENARIOS: dict[str, type[Scenario]] = {
    BlindSideRun.name: BlindSideRun,
    CornerBlindSide.name: CornerBlindSide,
    FarPostFinish.name: FarPostFinish,
    PossessionPlay.name: PossessionPlay,
    PressEscape.name: PressEscape,
    ScreenedShot.name: ScreenedShot,
}
