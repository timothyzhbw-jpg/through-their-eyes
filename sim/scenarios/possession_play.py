"""Possession play (SPEC 3.4, 4.7): no hero moment, just passing, for evals that need volume.

Both teams in shape. The ball carrier keeps the ball for a short time (keyed draw) and plays it to
an open outfield teammate in range; the nearest opponent closes him down to a few metres, and
defenders step in on passes they can reach, so possession changes hands now and then. Nothing
here depends on perception: no decisions, no forced or suppressed scans. Heads, scans and head
nuisance come from the normal engine. Hero runs last about 6 s, so run this one longer:

    Simulation.from_scenario("possession_play", seed, params=SimParams(max_duration_s=45.0))

The run ends early if the ball goes out of play (there are no restarts yet).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from sim.config import DT
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation

# id, role, x, y — 4-3-3 against 4-2-3-1, the home team attacks +x.
HOME = [
    ("H1", "GK", -45.0, 0.0),
    ("H2", "FB", -18.0, -24.0),
    ("H3", "FB", -18.0, 24.0),
    ("H4", "CB", -30.0, -8.0),
    ("H5", "CB", -30.0, 8.0),
    ("H6", "DM", -16.0, 0.0),
    ("H8", "CM", -5.0, -12.0),
    ("H10", "CM", -5.0, 12.0),
    ("H7", "W", 8.0, -26.0),
    ("H11", "W", 8.0, 26.0),
    ("H9", "ST", 12.0, 0.0),
]
AWAY = [
    ("A1", "GK", 45.0, 0.0),
    ("A2", "FB", 20.0, 22.0),
    ("A3", "FB", 20.0, -22.0),
    ("A4", "CB", 22.0, 7.0),
    ("A5", "CB", 22.0, -7.0),
    ("A6", "DM", 8.0, 6.0),
    ("A8", "DM", 8.0, -6.0),
    ("A10", "AM", -3.0, 0.0),
    ("A7", "AM", -1.0, 18.0),
    ("A11", "AM", -1.0, -18.0),
    ("A9", "ST", -14.0, 0.0),
]

HOLD_S = (0.6, 1.6)  # time on the ball before passing
PASS_RANGE = (8.0, 35.0)  # m
OPEN_ENOUGH = 8.0  # m to the nearest opponent; more space than this does not make a better pass
PRESS_DISTANCE = 3.0  # m, the closest opponent stops this far from the carrier


class PossessionPlay(Scenario):
    name = "possession_play"
    hero = None

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 1.5, pos.shape), -3.0, 3.0)
        self.holder, self.release, self.last_passer = -1, 0, -1
        owner = [p.id for p in players].index(str(gen.choice(["H4", "H5", "H6"])))
        return Setup(players=players, pos=pos, ball_owner=owner)

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        i = sim.owner
        if i != self.holder:
            if self.holder >= 0 and i < 0:
                self.last_passer = self.holder
            self.holder = i
            if i >= 0:
                u = sim.rng.uniform_for("possession_hold", frame, sim.ids[i])
                self.release = frame + round((HOLD_S[0] + (HOLD_S[1] - HOLD_S[0]) * u) / DT)
        if i < 0 or frame < self.release:
            return None
        mates = np.flatnonzero((sim.team == sim.team[i]) & (np.arange(len(sim.ids)) != i))
        opponents = np.flatnonzero(sim.team != sim.team[i])
        dist = np.linalg.norm(sim.pos[mates] - sim.pos[i], axis=-1)
        space = np.linalg.norm(
            sim.pos[mates][:, None, :] - sim.pos[opponents][None, :, :], axis=-1
        ).min(axis=1)
        jitter = sim.rng.uniform("possession_pass", frame, len(mates))
        score = np.minimum(space, OPEN_ENOUGH) * (0.5 + jitter)
        keeper = np.array([sim.players[j].role == "GK" for j in mates])
        out_of_range = (dist < PASS_RANGE[0]) | (dist > PASS_RANGE[1])
        score[out_of_range | keeper | (mates == self.last_passer)] = -1.0
        to = mates[int(np.argmax(score))] if score.max() > 0 else mates[int(np.argmin(dist))]
        return ForcedPass(sim.ids[i], sim.ids[to])

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        i = sim.owner
        if i < 0:
            return {}
        opponents = np.flatnonzero(sim.team != sim.team[i])
        k = opponents[np.argmin(np.linalg.norm(sim.pos[opponents] - sim.pos[i], axis=-1))]
        away = sim.pos[k] - sim.pos[i]
        dist = float(np.linalg.norm(away))
        if dist < 1e-6:
            away, dist = np.array([1.0 if sim.team[k] == 1 else -1.0, 0.0]), 1.0
        return {k: (sim.pos[i] + PRESS_DISTANCE * away / dist, sim.params.press_speed)}
