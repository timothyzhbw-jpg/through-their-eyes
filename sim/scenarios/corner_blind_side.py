"""Hero scenario: a short corner and the runner on the marker's blind side (SPEC 3.6).

The away team takes a corner at the home goal (−x). A7 plays it short to A11. The home centre-back
H5 marks the striker A9 man to man; his head tracks the ball, out to the corner. While the ball
goes short, A9 drifts slowly round H5 to his blind side, then darts out to the edge of the box,
and A11 cuts the ball back to him along the ground. H5 checks over his shoulder once (the key
scan) as A9 darts.

The mechanism is marking on belief (`marking_target_on_belief`): every marker here steers
goal-side of where he *believes* his man is, from his own perception (SPEC 3.4), not of where the
man is. A man who leaves the marker's field of view is marked at his extrapolated last sighting,
which freezes after `SimParams.belief_horizon_s`. The other scenarios mark the true position.

Hero design rule: A9 is visible to H5 only during the key scan once he darts. H5's previous
sighting shows him drifting slowly beside him. With the scan, H5 sees the dart and goes with him;
without it, he marks the spot A9 left, and A9 meets the cutback unmarked. Nothing decides here:
the passes are scripted, and the moment is where H5 runs. The intervention is `drop_scan`.

Per seed (keyed draws): positions jitter, when the corner is taken, the drift, when A9 darts, the
key scan's timing and dwell, when the cutback is played, and where A9 runs to.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from analytics.vision import wrap_angle
from sim.config import DT
from sim.perception import ForcedScan
from sim.scenarios.base import (
    ForcedPass,
    Scenario,
    Setup,
    make_player,
    marking_target_on_belief,
)

if TYPE_CHECKING:
    from sim.engine import Simulation

# id, role, x, y — the away team attacks −x and takes a corner from the flag at (−52.5, 34). Home
# zonal spots for the players who mark nobody; H5, H8, H10 and H11 are placed below.
HOME = [
    ("H1", "GK", -51.8, 0.5),
    ("H2", "FB", -51.6, 3.4),  # near post
    ("H3", "FB", -51.6, -3.4),  # far post
    ("H4", "CB", -49.0, 2.0),
    ("H5", "CB", -46.6, 3.2),
    ("H6", "DM", -48.8, -3.5),
    ("H8", "CM", -48.6, 4.4),
    ("H10", "CM", -47.6, -5.6),
    ("H7", "W", -30.0, 20.0),
    ("H11", "W", -47.5, 19.0),
    ("H9", "ST", -18.0, 2.0),
]
AWAY = [
    ("A1", "GK", 45.0, 0.0),
    ("A2", "FB", -10.0, 25.0),
    ("A3", "FB", -10.0, -22.0),
    ("A4", "CB", -48.0, 5.0),
    ("A5", "CB", -47.0, -5.0),
    ("A6", "DM", -20.0, 8.0),
    ("A8", "DM", -28.0, -6.0),
    ("A10", "AM", -30.0, 12.0),
    ("A7", "AM", -52.0, 33.5),
    ("A11", "AM", -46.0, 25.5),
    ("A9", "ST", -43.5, 8.3),
]

MARKS = {"H5": "A9", "H8": "A4", "H10": "A5"}  # man to man, on belief
MARK_GAP = 0.9  # m goal-side (style knob, not fitted)
PRESS_GAP = 3.5  # m, H11 from A11 once he has the ball
PRESS_SIDE = np.deg2rad(-150.0)  # toward the byline, off the cutback lane
HOLD_SPEED = 3.0  # m/s, players holding a spot
START_OFFSET = 1.4 * np.array([np.cos(np.deg2rad(40.0)), np.sin(np.deg2rad(40.0))])
DRIFT_SPEED = 2.5  # m/s
DART_SPEED = 8.0  # m/s
BLIND_SPOT = np.array([-44.3, 0.2])  # central: goal-side marking puts him behind H5's gaze
DART_TARGET = np.array([-36.5, 2.5])  # edge of the box
SCAN_STOP_SHORT = np.deg2rad(40.0)  # the head stops this far short of pointing at the runner


class CornerBlindSide(Scenario):
    name = "corner_blind_side"
    hero = "H5"
    lens = "scan"
    intervention = "drop_scan"
    taker = "A7"
    short = "A11"
    runner = "A9"
    marker = "H5"
    presser = "H11"

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        ids = [p.id for p in players]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 0.5, pos.shape), -1.0, 1.0)
        i = {pid: ids.index(pid) for pid in ids}
        self.i = i
        self.i_hero, self.i_runner = i[self.marker], i[self.runner]
        self.i_taker, self.i_short, self.i_presser = i[self.taker], i[self.short], i[self.presser]
        pos[i["A7"]] = [-52.0, 33.5]  # at the flag
        pos[self.i_runner] = pos[self.i_hero] + START_OFFSET
        self.spots = pos.copy()
        self.blind_spot = BLIND_SPOT + gen.uniform(-0.3, 0.3, 2)
        self.dart_target = DART_TARGET + gen.uniform(-1.0, 1.0, 2)
        self.kick_frame = 8 + int(gen.integers(0, 7))
        self.dart_delay = float(gen.uniform(0.0, 0.2))  # after A11 receives
        self.scan_after_dart = float(gen.uniform(0.15, 0.30))
        self.cutback_after_dart = float(gen.uniform(0.50, 0.70))
        self.scan_dwell = float(gen.uniform(0.10, 0.16))
        self.marks = {i[d]: i[a] for d, a in MARKS.items()}
        # Event-driven timings, set when A11 receives the short corner.
        self.received: int | None = None
        self.dart_frame = self.scan_frame = self.cutback_frame = -1
        return Setup(players=players, pos=pos, ball_owner=self.i_taker)

    def _track(self, sim: Simulation, frame: int) -> None:
        if self.received is None and sim.owner == self.i_short:
            self.received = frame
            self.dart_frame = frame + round(self.dart_delay / DT)
            self.scan_frame = self.dart_frame + round(self.scan_after_dart / DT)
            self.cutback_frame = self.dart_frame + round(self.cutback_after_dart / DT)

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        self._track(sim, frame)
        if frame == self.kick_frame:
            to = sim.pos[self.i_short]
            return ForcedPass(self.taker, self.short, (float(to[0]), float(to[1])))
        if frame == self.cutback_frame:
            t = self.dart_target
            return ForcedPass(self.short, self.runner, (float(t[0]), float(t[1])))
        return None

    def ends_on_pass(self, sim: Simulation, passer: int) -> bool:
        return passer == self.i_short and sim.frame == self.cutback_frame

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        out: dict[int, tuple[np.ndarray, float]] = {}
        for j in range(len(sim.ids)):
            if j != sim.owner:
                out[j] = (self.spots[j], HOLD_SPEED)
        for d, a in self.marks.items():
            out[d] = (marking_target_on_belief(sim, d, a, MARK_GAP), sim.v_max[d])
        if self.received is not None and sim.owner == self.i_short:
            side = PRESS_GAP * np.array([np.cos(PRESS_SIDE), np.sin(PRESS_SIDE)])
            out[self.i_presser] = (sim.pos[self.i_short] + side, sim.v_max[self.i_presser])
        if self.received is None or frame < self.dart_frame:
            out[self.i_runner] = (self.blind_spot, DRIFT_SPEED)
        else:
            out[self.i_runner] = (self.dart_target, DART_SPEED)
        if frame > self.kick_frame:
            out[self.i_taker] = (np.array([-47.0, 30.0]), HOLD_SPEED)
        out.pop(sim.owner, None)
        return out

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
        """Until the cutback is resolved, the key scan is H5's only look away (the hero design
        rule): a spontaneous scan could already show him the runner."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = sim.hero_resolved_frame is None
        return mask
