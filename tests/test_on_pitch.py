"""Players stay on the pitch (SPEC 3.2): every movement target lies inside the touchlines and goal
lines, so keepers stand at or in front of their goal line and nobody runs off the field.

A player ends at most on a line (the braking envelope stops him there), so the tolerance is only
floating-point slack; the brief allowed 0.3 m, and the measured worst is 0. The sim never
simulates a restart (a stitched match's restarts are edits, SPEC 3.1), so no player needs to stand
outside.
"""

import numpy as np
import pytest

from sim.config import A_MAX, D_MAX, DT, HALF_LENGTH, HALF_WIDTH
from sim.engine import Simulation
from sim.match import build_match
from sim.movement import steer

TOLERANCE = 1e-6  # m

# Each hero at the seed the demo shows: the served heroes and the bundled what-ifs (web/src/data),
# and the first design seed of the two the demo does not serve.
DEMO = {
    "blind_side_run": 3,
    "press_escape": 0,
    "corner_blind_side": 0,
    "far_post_finish": 11,
    "cutback_scan": 7,
    "keeper_switch": 0,
    "screened_shot": 0,
}
# A sample of each scenario's held-out seeds (SPEC 3.6): the first ten of its gate's set.
HELD_OUT = {
    "blind_side_run": range(100, 110),
    "press_escape": range(200, 210),
    "corner_blind_side": range(100, 110),
    "far_post_finish": range(200, 210),
    "cutback_scan": range(100, 110),
    "keeper_switch": range(100, 110),
    "screened_shot": range(300, 310),
    "open_play": range(100, 110),
    "possession_play": range(100, 110),
}


def _off_pitch(pos: np.ndarray, ids: list[str], where: str) -> list[str]:
    """Each player who is ever further than TOLERANCE outside the pitch, with his worst frame."""
    over = np.maximum(np.abs(pos[..., 0]) - HALF_LENGTH, np.abs(pos[..., 1]) - HALF_WIDTH)
    out = []
    for i in np.flatnonzero(over.max(axis=0) > TOLERANCE):
        f = int(over[:, i].argmax())
        x, y = pos[f, i]
        out.append(f"{where} {ids[i]} frame {f}: ({x:.2f}, {y:.2f}), {over[f, i]:.2f} m out")
    return out


def _check(scenario: str, seed: int) -> list[str]:
    run = Simulation.from_scenario(scenario, seed).run()
    return _off_pitch(run.pos, [p.id for p in run.players], f"{scenario} seed {seed}")


@pytest.mark.parametrize(("scenario", "seed"), sorted(DEMO.items()))
def test_every_player_stays_on_the_pitch_in_each_hero_at_its_demo_seed(scenario, seed):
    assert _check(scenario, seed) == []


@pytest.mark.parametrize("scenario", sorted(HELD_OUT))
def test_every_player_stays_on_the_pitch_on_held_out_seeds(scenario):
    assert [line for seed in HELD_OUT[scenario] for line in _check(scenario, seed)] == []


def test_every_player_stays_on_the_pitch_through_match_1():
    off = []
    for p in build_match(1).possessions:
        ids = [player.id for player in p.run.players]
        off += _off_pitch(p.run.pos, ids, f"match-1 possession {p.index} ({p.scenario})")
    assert off == []


def test_a_player_turning_along_a_line_brakes_for_it_instead_of_drifting_over():
    """A target on the touchline, 15 m along it, for a player running at the line: steering alone
    carries him over it; with the bounds he ends on it, and his velocity never changes by more
    than d_max a second (braking for the line shares the limit with the turn)."""
    bounds = np.array([HALF_LENGTH, HALF_WIDTH])
    one = np.ones(1)

    def run(with_bounds: bool) -> tuple[float, float]:
        pos, vel = np.array([[0.0, 28.0]]), np.array([[0.0, 7.0]])
        worst_y, worst_decel = 0.0, 0.0
        for _ in range(100):
            target = np.array([[15.0, HALF_WIDTH]])
            new_pos, new_vel = steer(pos, vel, target, 8.0 * one, A_MAX * one, D_MAX * one, DT,
                                     bounds if with_bounds else None)  # fmt: skip
            worst_decel = max(worst_decel, float(np.linalg.norm(new_vel - vel)) / DT)
            pos, vel = new_pos, new_vel
            worst_y = max(worst_y, float(pos[0, 1]))
        return worst_y, worst_decel

    assert run(with_bounds=False)[0] > HALF_WIDTH + TOLERANCE
    worst_y, worst_decel = run(with_bounds=True)
    assert worst_y <= HALF_WIDTH
    assert worst_decel <= D_MAX + 1e-9


def test_movement_targets_lie_inside_the_pitch():
    """The guarantee at its source: every target of every frame, not only where players end up."""
    sim = Simulation.from_scenario("blind_side_run", 3)
    targets = []
    original = sim._movement_targets

    def recorded(f):
        target, cap = original(f)
        targets.append(target.copy())
        return target, cap

    sim._movement_targets = recorded
    sim.run()
    t = np.array(targets)
    assert np.abs(t[..., 0]).max() <= HALF_LENGTH
    assert np.abs(t[..., 1]).max() <= HALF_WIDTH
