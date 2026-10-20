"""Marking in possession_play (SPEC 3.4, 3.8).

Jordet et al. (2020) compare scanning by how close the nearest opponent is at the reception. In
real play a receiver with an opponent within a metre has usually been marked for a while, so the
scan slowdown under pressure (sim/config.py pressure_scan_factor) has had time to act. The realism
report reads that comparison off possession_play, so the scenario has to mark.
"""

from dataclasses import replace

import numpy as np
import pytest

from eval.realism import MARKED_M, simulate
from sim.config import DT, HALF_LENGTH, SimParams
from sim.engine import Simulation
from sim.scenarios import possession_play as pp

POSSESSION = "possession_play"
LONG = replace(SimParams(), max_duration_s=30.0)
SEEDS = range(0, 20)  # tuning seeds; the realism report runs held-out seeds 100-199


def _trace(seed: int) -> tuple[Simulation, list[dict[int, int]], list[np.ndarray]]:
    """A possession_play run with the scenario's pairs and the positions after every step."""
    sim = Simulation.from_scenario(POSSESSION, seed, params=LONG)
    marks, spots = [], []
    while not sim.done and sim.frame < sim.max_frames:
        spots.append(sim.formation_spots())
        sim.step()
        marks.append(dict(sim.scenario.marks))
    return sim, marks, spots


@pytest.fixture(scope="module")
def traces():
    return [_trace(seed) for seed in (1, 2, 3)]


@pytest.fixture(scope="module")
def receptions():
    tables = [simulate(seed)["receptions"] for seed in SEEDS]
    return {k: np.concatenate([t[k] for t in tables]) for k in tables[0]}


def test_receivers_under_tight_pressure_were_marked_for_most_of_their_window(receptions):
    # The realism report's bins: 0-1 m is < 1.5 m at the reception, 10+ m is >= 9.5 m.
    close = receptions["pressure"] < 1.5
    free = receptions["pressure"] >= 9.5
    assert close.sum() >= 10 and free.sum() >= 10
    # Share of the window (up to 10 s before the reception) with an opponent within MARKED_M.
    marked = receptions["marked"]
    assert MARKED_M == 3.0
    # Most receivers at 0-1 m had an opponent that close for more than half of their window ...
    assert np.median(marked[close]) > 0.5
    # ... and most receivers at 10+ m did not.
    assert np.median(marked[free]) < 0.5


def test_pairs_are_outfield_defenders_on_distinct_attackers_in_their_zone(traces):
    for sim, marks, spots in traces:
        run = sim.result()
        assert np.mean([len(m) for m in marks]) >= 5  # most outfield players are paired
        for f, (pairs, spot) in enumerate(zip(marks, spots, strict=True)):
            assert len(set(pairs.values())) == len(pairs)
            for j, a in pairs.items():
                assert "GK" not in (run.players[j].role, run.players[a].role)
                assert run.players[j].team != run.players[a].team
                # Checked on the positions the pair was kept on, before the step's movement.
                assert np.linalg.norm(run.pos[f, a] - spot[j]) <= pp.RELEASE_RADIUS + 1e-9


def test_markers_stay_goal_side_and_some_pairs_stay_tight_for_seconds(traces):
    goal_side, longest = [], []
    for sim, marks, _ in traces:
        run = sim.result()
        runs: dict[tuple[int, int], int] = {}
        best = 0
        for f, pairs in enumerate(marks, start=1):
            for j, a in pairs.items():
                own_goal = np.array([HALF_LENGTH if run.players[j].team == 1 else -HALF_LENGTH, 0])
                goal_side.append(
                    np.dot(run.pos[f, j] - run.pos[f, a], own_goal - run.pos[f, a]) > 0
                )
                tight = np.linalg.norm(run.pos[f, j] - run.pos[f, a]) <= 2.5
                runs[(j, a)] = runs.get((j, a), 0) + 1 if tight else 0
                best = max(best, runs[(j, a)])
            runs = {k: v for k, v in runs.items() if k in pairs.items()}
        longest.append(best * DT)
    assert np.mean(goal_side) > 0.8
    assert min(longest) >= 3.0  # in every run, some pair stays within 2.5 m for 3 s or more


def test_marking_gaps_are_keyed_draws_that_do_not_depend_on_the_play():
    fresh = Simulation.from_scenario(POSSESSION, seed=8, params=LONG)
    played = Simulation.from_scenario(POSSESSION, seed=8, params=LONG)
    played.run_until(round(12.0 / DT))
    gaps = []
    for pid in [p.id for p in fresh.players if p.role != "GK"]:
        j = fresh.index(pid)
        for frame in range(0, round(45.0 / DT), round(2.0 / DT)):
            gap = fresh.scenario.gap(fresh, frame, j)
            assert gap == played.scenario.gap(played, frame, j)
            gaps.append(gap)
    gaps = np.array(gaps)
    tight = gaps <= pp.TIGHT_GAP[1]
    assert np.all((gaps >= pp.TIGHT_GAP[0]) & (gaps <= pp.LOOSE_GAP[1]))
    assert np.all(tight | (gaps >= pp.LOOSE_GAP[0]))
    assert 0.3 < tight.mean() < 0.7  # TIGHT_SHARE = 0.5 of the spells
