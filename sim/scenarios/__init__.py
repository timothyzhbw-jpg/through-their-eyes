"""Scenario templates for hero moments (SPEC 3.6)."""

from sim.scenarios.base import Scenario
from sim.scenarios.blind_side_run import BlindSideRun

SCENARIOS: dict[str, type[Scenario]] = {BlindSideRun.name: BlindSideRun}
