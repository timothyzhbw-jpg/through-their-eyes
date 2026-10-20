"""Scenario templates for hero moments (SPEC 3.6)."""

from sim.scenarios.base import Scenario
from sim.scenarios.blind_side_run import BlindSideRun
from sim.scenarios.open_play import OpenPlay
from sim.scenarios.possession_play import PossessionPlay

SCENARIOS: dict[str, type[Scenario]] = {
    BlindSideRun.name: BlindSideRun,
    OpenPlay.name: OpenPlay,
    PossessionPlay.name: PossessionPlay,
}
