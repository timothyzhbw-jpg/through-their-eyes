"""Marking in possession_play (SPEC 3.2, 3.4, 3.8).

Jordet et al. (2020) compare scanning by how close the nearest opponent is at the reception. In
real play a receiver with an opponent within a metre has usually been marked for a while, so the
scan slowdown under pressure (sim/config.py pressure_scan_factor) has had time to act. The realism
report reads that comparison off possession_play, so the scenario has to mark.

possession_play keeps a team shape (`Scenario.team_shape`, sim/team_shape.py) and marks zonally:
a defender picks up an attacker near his slot and follows him goal-side only while that keeps him
near it. Without the shape (the realism report's "before" column) it marks as it did before, man
to man anywhere in a 20 m zone. Both are checked: `shape` is the scenario as it runs.
"""

from dataclasses import replace

import numpy as np
import pytest

from eval.realism import MARKED_M, tables
from sim.config import DT, HALF_LENGTH, SimParams
from sim.engine import Simulation
from sim.scenarios import possession_play as pp

LONG = replace(SimParams(), max_duration_s=30.0)
SEEDS = range(0, 20)  # tuning seeds; the realism report runs held-out seeds 100-199
SHAPES = (True, False)


def _sim(seed: int, shape: bool, params: SimParams = LONG) -> Simulation:
    scenario = pp.PossessionPlay()
    scenario.team_shape = shape
    return Simulation(scenario, seed, params)


def _trace(seed: int, shape: bool) -> tuple[Simulation, list[dict[int, int]], list[np.ndarray]]:
    """A possession_play run with the scenario's pairs and the positions after every step."""
    sim = _sim(seed, shape)
    marks, spots = [], []
    while not sim.done and sim.frame < sim.max_frames:
        spots.append(sim.formation_spots())
        sim.step()
        marks.append(dict(sim.scenario.marks))
    return sim, marks, spots


@pytest.fixture(scope="module", params=SHAPES, ids=["shape", "anchors"])
def traces(request):
    return request.param, [_trace(seed, request.param) for seed in (1, 2, 3)]


@pytest.fixture(scope="module", params=SHAPES, ids=["shape", "anchors"])
def receptions(request):
    from eval.realism import PARAMS

    found = [tables(_sim(seed, request.param, PARAMS).run())["receptions"] for seed in SEEDS]
    return request.param, {k: np.concatenate([t[k] for t in found]) for k in found[0]}


def test_receivers_under_tight_pressure_were_marked_for_longer_than_free_ones(receptions):
    shape, rec = receptions
    # The realism report's bins: 0-1 m is < 1.5 m at the reception, 10+ m is >= 9.5 m.
    close = rec["pressure"] < 1.5
    free = rec["pressure"] >= 9.5
    assert close.sum() >= 10 and free.sum() >= 10
    # Share of the window (up to 10 s before the reception) with an opponent within MARKED_M.
    marked = rec["marked"]
    assert MARKED_M == 3.0
    # Most receivers at 10+ m had nobody that close for most of their window ...
    assert np.median(marked[free]) < 0.5
    if shape:
        # ... and with zonal marking receivers at 0-1 m had one there for a quarter or more of
        # theirs (0.29 on seeds 0-39): a man is marked in a zone, then passed on or pressed.
        assert np.median(marked[close]) > 0.25
    else:
        # ... and man to man, most receivers at 0-1 m had one for more than half of theirs.
        assert np.median(marked[close]) > 0.5


def test_pairs_are_outfield_defenders_on_distinct_attackers_in_their_zone(traces):
    shape, found = traces
    for sim, marks, spots in found:
        run = sim.result()
        # Most outfield defenders are paired; zonal marking leaves a man who is out of every
        # zone to the next one (4.9 pairs on average on these seeds, against 5 or more man to man).
        assert np.mean([len(m) for m in marks]) >= (4 if shape else 5)
        for f, (pairs, spot) in enumerate(zip(marks, spots, strict=True)):
            assert len(set(pairs.values())) == len(pairs)
            for j, a in pairs.items():
                assert "GK" not in (run.players[j].role, run.players[a].role)
                assert run.players[j].team != run.players[a].team
                # Checked on the positions the pair was kept on, before the step's movement. With
                # the shape a pair holds while the marking point (at most LOOSE_GAP[1] goal-side
                # of the man) is within SHAPE_LEASH of the defender's slot.
                reach = pp.SHAPE_LEASH + pp.LOOSE_GAP[1] if shape else pp.RELEASE_RADIUS
                assert np.linalg.norm(run.pos[f, a] - spot[j]) <= reach + 1e-9


def test_markers_stay_goal_side_and_some_pairs_stay_tight_for_seconds(traces):
    shape, found = traces
    goal_side, longest = [], []
    for sim, marks, _ in found:
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
    # With the shape, attackers move between their slots as the ball moves and markers chase
    # them, about 9 m from their marking point when not goal-side (0.68 of pair-frames are).
    assert np.mean(goal_side) > (0.6 if shape else 0.8)
    assert min(longest) >= 3.0  # in every run, some pair stays within 2.5 m for 3 s or more


def test_marking_gaps_are_keyed_draws_that_do_not_depend_on_the_play():
    fresh = Simulation.from_scenario("possession_play", seed=8, params=LONG)
    played = Simulation.from_scenario("possession_play", seed=8, params=LONG)
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
