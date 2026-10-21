"""Scenario templates for hero moments (SPEC 3.6)."""

from sim.scenarios.base import Scenario
from sim.scenarios.blind_side_run import BlindSideRun
from sim.scenarios.corner_blind_side import CornerBlindSide
from sim.scenarios.cutback_scan import CutbackScan
from sim.scenarios.far_post_finish import FarPostFinish
from sim.scenarios.keeper_switch import KeeperSwitch
from sim.scenarios.open_play import OpenPlay
from sim.scenarios.possession_play import PossessionPlay
from sim.scenarios.press_escape import PressEscape
from sim.scenarios.read_the_run import ReadTheRun
from sim.scenarios.screened_shot import ScreenedShot

SCENARIOS: dict[str, type[Scenario]] = {
    BlindSideRun.name: BlindSideRun,
    CornerBlindSide.name: CornerBlindSide,
    CutbackScan.name: CutbackScan,
    FarPostFinish.name: FarPostFinish,
    KeeperSwitch.name: KeeperSwitch,
    OpenPlay.name: OpenPlay,
    PossessionPlay.name: PossessionPlay,
    PressEscape.name: PressEscape,
    ReadTheRun.name: ReadTheRun,
    ScreenedShot.name: ScreenedShot,
}
