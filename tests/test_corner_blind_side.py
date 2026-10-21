"""Set-piece hero: the marker and the runner on his blind side (SPEC 3.6).

The acceptance check on held-out seeds is `eval/hero_marking.py` (report in
eval/reports/hero_marking_corner_blind_side.md). These checks run on design seeds.
"""

import numpy as np
import pytest

from eval.hero_marking import evaluate_seed
from sim.config import DT, SimParams
from sim.engine import Simulation
from sim.overrides import FreezeBelief
from sim.scenarios import SCENARIOS
from sim.scenarios.base import Scenario, marking_target_on_belief

SCENARIO = "corner_blind_side"
DESIGN_SEEDS = [0, 1, 2, 3]


@pytest.fixture(scope="module")
def results():
    return {s: evaluate_seed(SCENARIO, s) for s in DESIGN_SEEDS}


def test_the_scenario_names_its_lens_and_intervention():
    cls = SCENARIOS[SCENARIO]
    assert (cls.hero, cls.runner, cls.lens, cls.intervention) == ("H5", "A9", "scan", "drop_scan")
    assert not cls.tackles


def test_same_seed_twice_in_the_same_environment_is_byte_identical():
    a = Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert a == Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert a != Simulation.from_scenario(SCENARIO, seed=8).run().to_bytes()


def test_resume_from_snapshot_without_overrides_reproduces_the_run():
    full = Simulation.from_scenario(SCENARIO, seed=2).run().to_bytes()
    sim = Simulation.from_scenario(SCENARIO, seed=2)
    sim.run_until(50)
    assert Simulation.resume(sim.snapshot()).run().to_bytes() == full


def test_the_moment_is_the_cutback_and_nobody_decides():
    run = Simulation.from_scenario(SCENARIO, seed=0).run()
    assert run.decisions == []
    key = run.key_scan()
    assert key.player == "H5"
    cutback = max((e for e in run.events if e.type == "pass"), key=lambda e: e.frame)
    assert (cutback.player, cutback.attrs["to"]) == ("A11", "A9")
    # The run ends one tail after the cutback is resolved.
    assert len(run.owner) - 1 == cutback.attrs["end"] + round(SimParams().tail_s / DT)


def test_the_default_moment_pass_is_any_pass_by_the_hero():
    sim = Simulation.from_scenario("blind_side_run", seed=3)
    assert Scenario.ends_on_pass(sim.scenario, sim, sim.index("H8"))
    assert not Scenario.ends_on_pass(sim.scenario, sim, sim.index("H4"))


def test_a_marker_marks_where_he_believes_his_man_is():
    sim = Simulation.from_scenario(SCENARIO, seed=0)
    h5, a9 = sim.index("H5"), sim.index("A9")
    sim.run_until(5)
    frozen = Simulation.resume(sim.snapshot(), [FreezeBelief("H5", at_frame=5)])
    frozen.run_until(40)  # A9 drifts round him meanwhile
    after = marking_target_on_belief(frozen, h5, a9, 0.9)
    assert np.linalg.norm(frozen.pos[a9] - sim.pos[a9]) > 1.0
    # Beliefs extrapolate the last sighting for at most a second; after that the target is fixed.
    frozen.run_until(45)
    assert np.allclose(after, marking_target_on_belief(frozen, h5, a9, 0.9))
    # Goal-side of the believed position: nearer his own goal (−x for the home team) than it.
    believed, _, _ = frozen.beliefs.estimate(h5, frozen.frame, DT, SimParams().belief_horizon_s)
    assert np.linalg.norm(after - [-52.5, 0.0]) < np.linalg.norm(believed[a9] - [-52.5, 0.0])
    # Not goal-side of where A9 really is: the frozen belief has lost him.
    true = frozen.pos[a9]
    side = np.array([-52.5, 0.0]) - true
    assert np.linalg.norm(after - (true + 0.9 * side / np.linalg.norm(side))) > 1.0


def test_only_the_look_shows_him_the_dart_on_design_seeds(results):
    for seed, r in results.items():
        assert r["design_rule"], seed


def test_without_the_look_the_runner_is_free_and_with_it_the_marker_is_there(results):
    for seed, r in results.items():
        assert r["gate"], seed
        assert r["c"]["separation"] > r["f"]["separation"] + 3.0, seed
        assert r["belief_error"] >= 3.0, seed
