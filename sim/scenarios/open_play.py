"""Open play (SPEC 3.5, 4.5): possession play where every ball carrier decides for himself.

The same shape, pressing and marking as `possession_play`, but nothing is scripted on the ball:
each carrier — the first one at kick-off, every receiver after his first touch, and a carrier when
his carry ends — picks a pass, a carry or a shot with the decision model on his belief, so play
moves toward goal and some possessions end in shots. The xT grid is fitted on it
(`eval/xt_fit.py`). No hero. Like `possession_play`, run it longer than a hero run:

    Simulation.from_scenario("open_play", seed, params=SimParams(max_duration_s=45.0))

The run ends when the ball goes out of play (a shot that misses included; there are no restarts).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sim.scenarios.base import ForcedPass
from sim.scenarios.possession_play import PossessionPlay

if TYPE_CHECKING:
    from sim.engine import Simulation


class OpenPlay(PossessionPlay):
    name = "open_play"
    hero = None
    # The xT grid (`analytics/xt_grid.json`, every moment's ΔxT) is fitted on this scenario, so it
    # keeps the anchors shifted with the ball until the grid is refitted (SPEC 4.5).
    team_shape = False

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        return None

    def decides(self, sim: Simulation, player: int) -> bool:
        return True
