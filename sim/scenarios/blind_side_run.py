"""Hero scenario: the blind-side run (SPEC 3.6).

Home build-up. The centre-back H4 plays into the centre midfielder H8, who receives with his back
to goal. While the ball travels, the striker H9 slips his marker A5 and runs into the channel
behind the away line — behind H8, outside his field of view. H8 checks over his shoulder once (the
key scan) just before the ball arrives.

Hero design rule: the free runner is visible to H8 only during the key scan. H8's previous sighting
of H9 shows him standing next to A5. With the scan, H8 believes the runner is free and plays him
in; without it, he believes H9 is still marked and plays safe.

The run is onside by construction (SPEC 3.9, IFAB Laws of the Game, Law 11.1): H9 starts deep, and
his run is timed so that he is ONSIDE_AT_PASS short of the second-last defender as H8 plays, at
speed, and goes past the line only once the ball is on its way. (Until 2026-10-22 he stood about
3 m offside at the pass on every seed; `eval/reports/laws.md`.)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from analytics.vision import wrap_angle
from sim import laws
from sim.ball import flight_time
from sim.config import DT
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.perception import ForcedScan
from sim.referee import HOLD_MARGIN
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation

# id, role, x, y — the home team attacks +x.
HOME = [
    ("H1", "GK", -46.0, 0.0),
    ("H2", "FB", -8.0, -27.0),
    ("H3", "FB", -6.0, 26.0),
    ("H4", "CB", -22.0, -9.0),
    ("H5", "CB", -21.0, 9.0),
    ("H6", "DM", -10.0, 1.0),
    ("H8", "CM", 2.0, -10.0),
    ("H10", "CM", 6.0, 14.0),
    ("H7", "W", 14.0, -29.0),
    ("H11", "W", 16.0, 26.0),
    ("H9", "ST", 19.0, -2.0),
]
AWAY = [
    ("A1", "GK", 47.0, 0.0),
    ("A2", "FB", 26.0, 20.0),
    ("A3", "FB", 25.0, -23.0),
    ("A4", "CB", 26.5, 7.0),
    ("A5", "CB", 25.4, -2.8),
    ("A6", "DM", 13.0, 5.0),
    ("A8", "DM", 14.0, -1.0),
    ("A10", "AM", 2.0, 4.0),
    ("A7", "AM", -1.0, 20.0),
    ("A11", "AM", -3.0, -21.0),
    ("A9", "ST", -10.0, -1.0),
]

RUN_TARGET = np.array([38.0, -11.0])
RUN_SPEED = 8.5  # m/s, flat out
# The run is timed to reach the offside line this far short of it as H8 plays (SPEC 3.9).
ONSIDE_AT_PASS = HOLD_MARGIN
MARKER_OFFSET = np.array([1.4, 0.0])  # A5 goal-side of H9
SCAN_STOP_SHORT = np.deg2rad(40.0)  # the head stops this far short of pointing at the runner


class BlindSideRun(Scenario):
    name = "blind_side_run"
    hero = "H8"
    lens = "scan"
    intervention = "drop_scan"
    passer = "H4"
    runner = "H9"
    marker = "A5"

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        ids = [p.id for p in players]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 0.7, pos.shape), -1.5, 1.5)
        self.i_hero, self.i_passer = ids.index(self.hero), ids.index(self.passer)
        self.i_runner, self.i_marker = ids.index(self.runner), ids.index(self.marker)
        pos[self.i_marker] = pos[self.i_runner] + MARKER_OFFSET + gen.normal(0.0, 0.2, 2)

        self.spot = pos[self.i_hero].copy()
        self.runner_home = pos[self.i_runner].copy()
        self.marker_hold = pos[self.i_marker] + np.array([1.5, 0.0])  # ball-watching
        self.kick_frame = 12 + int(gen.integers(0, 6))
        ball = pos[self.i_passer] + np.array([DRIBBLE_OFFSET, 0.0])
        dist = float(np.linalg.norm(self.spot - ball))
        t_ball = flight_time(pass_speed(dist), dist - 1.0)
        self.reception_frame = self.kick_frame + round(t_ball / DT)
        self.run_start = max(2, self.reception_frame - round(gen.uniform(2.4, 2.7) / DT))
        self.run_target = RUN_TARGET + gen.uniform(-1.5, 1.5, 2)
        self.scan_frame = self.reception_frame - round(gen.uniform(0.70, 0.85) / DT)
        self.scan_dwell = float(gen.uniform(0.10, 0.16))
        return Setup(players=players, pos=pos, ball_owner=self.i_passer)

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        if sim.hero_acted:
            return {}
        out: dict[int, tuple[np.ndarray, float]] = {}
        if sim.owner != self.i_hero:
            out[self.i_hero] = (self.spot, 3.0)
        if frame < self.run_start:
            out[self.i_runner] = (self.runner_home, 2.0)
        else:
            out[self.i_runner] = (self.run_target, self._timed_speed(sim, frame))
        out[self.i_marker] = (self.marker_hold, 2.5)
        return out

    def _pass_frame(self, sim: Simulation) -> int:
        """When H8 plays: his first touch after the planned reception, or the decision the engine
        has pending once he has the ball."""
        if sim.pending_decision is not None and sim.pending_decision[0] == self.i_hero:
            return sim.pending_decision[1]
        return self.reception_frame + round(sim.params.first_touch_s / DT)

    def _timed_speed(self, sim: Simulation, frame: int) -> float:
        """The runner's speed for a timed run (SPEC 3.9, Law 11.1): flat out while he has room,
        slower when he would reach the offside line before H8 plays, so that he is
        ONSIDE_AT_PASS short of it then and goes past it once the ball is played."""
        me = sim.pos[self.i_runner]
        line = laws.second_last_depth(sim.pos, sim.team, 0)  # the home team attacks +x
        t = max((self._pass_frame(sim) - frame) * DT, DT)
        u = self.run_target - me
        u_x = max(float(u[0] / max(np.linalg.norm(u), 1e-9)), 0.2)
        room = line - ONSIDE_AT_PASS - float(me[0])
        return float(np.clip(room / t / u_x, 0.0, RUN_SPEED))

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            return ForcedPass(self.passer, self.hero, (float(self.spot[0]), float(self.spot[1])))
        return None

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        if frame != self.scan_frame:
            return {}
        me = sim.pos[self.i_hero]
        runner = sim.pos[self.i_runner] + 0.25 * sim.vel[self.i_runner]
        runner_dir = float(np.arctan2(*(runner - me)[::-1]))
        ball_dir = float(np.arctan2(*(sim.ball_pos[:2] - me)[::-1]))
        delta = float(wrap_angle(runner_dir - ball_dir))
        yaw = runner_dir
        if abs(delta) > np.deg2rad(100.0):
            yaw = runner_dir - np.sign(delta) * SCAN_STOP_SHORT
        return {self.i_hero: ForcedScan(target_yaw=yaw, dwell_s=self.scan_dwell, key=True)}

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """Until he acts, the key scan is H8's only look away (the hero design rule): a spontaneous
        scan before the kick could already show him the runner, who sets off before it."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = not sim.hero_acted
        return mask

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted
