"""Hero expansion C3: the defender reads the run (`read_the_run`).

The acceptance check on held-out seeds is `eval/hero_flip.py --scenario read_the_run --seeds
200-239` (report in eval/reports/hero_flip_read_the_run.md). These checks run on design seeds.
"""

import numpy as np
import pytest

from sim.counterfactual import drop_scan_counterfactual
from sim.decision import DecisionContext, evaluate_defender_options
from sim.engine import Simulation
from sim.scenarios import SCENARIOS

SCENARIO, DEMO = "read_the_run", 4
HERO, RUNNER, PASSER = "H5", "A9", "A8"


@pytest.fixture(scope="module")
def demo():
    return drop_scan_counterfactual(SCENARIO, DEMO)


def _pass(run):
    (event,) = [e for e in run.events if e.type == "pass"]
    return event


def test_same_seed_twice_is_byte_identical():
    a = Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert a == Simulation.from_scenario(SCENARIO, seed=7).run().to_bytes()
    assert a != Simulation.from_scenario(SCENARIO, seed=8).run().to_bytes()


def test_the_hero_is_the_defender_and_decides_once(demo):
    run = demo.factual
    assert SCENARIOS[SCENARIO].key_action == f"cut:{RUNNER}"
    (decision,) = [d for d in run.decisions if d.player == HERO]
    assert run.hero_decision() is decision
    assert {o.kind for o in decision.options} == {"defend"}
    assert decision.options[0].action == "hold"
    assert f"cut:{RUNNER}" in {o.action for o in decision.options}
    assert sum(o.prob for o in decision.options) == pytest.approx(1.0)
    assert decision.frame < _pass(run).frame  # he reads it before it is played


def test_no_other_scenario_has_a_defenders_decision():
    for name in ("blind_side_run", "press_escape", "corner_blind_side", "screened_shot"):
        run = Simulation.from_scenario(name, 0).run()
        assert not [d for d in run.decisions if any(o.kind == "defend" for o in d.options)]


def test_the_key_scan_is_how_he_reads_the_run(demo):
    f, c = demo.factual_decision, demo.counterfactual_decision
    assert f.belief_error[RUNNER] < 1.0  # he saw A9 curl behind him
    assert c.belief_error[RUNNER] > 5.0  # he still believes A9 is beside H4
    assert (demo.factual_action, demo.counterfactual_action) == (f"cut:{RUNNER}", "hold")


def test_reading_it_wins_the_ball_and_not_reading_it_lets_the_runner_in(demo):
    won, lost = _pass(demo.factual), _pass(demo.counterfactual)
    assert won.player == PASSER
    assert (won.attrs["outcome"], won.attrs["receiver"]) == ("intercepted", HERO)
    assert (lost.attrs["outcome"], lost.attrs["receiver"]) == ("complete", RUNNER)
    assert demo.delta_xt > 0.05


def test_he_moves_within_his_limits(demo):
    run = demo.factual
    i = run.index(HERO)
    speed = np.linalg.norm(run.vel[:, i], axis=-1)
    assert speed.max() <= run.players[i].v_max + 1e-9


def _toy(attacker_y: float) -> DecisionContext:
    """Carrier A at (0, 0) attacking -x; defender D at (-20, 0); attacker R at (-25, y)."""
    pos = np.array([[0.0, 0.0], [-20.0, 0.0], [-25.0, attacker_y], [-45.0, 0.0]])
    return DecisionContext(
        carrier=0,
        team=np.array([1, 0, 1, 0]),
        pos=pos,
        vel=np.zeros_like(pos),
        age_s=np.zeros(4),
        ids=["A", "D", "R", "K"],
        attack_sign=-1,
    )


def test_a_defender_only_cuts_lanes_within_his_range():
    near = {o.action for o in evaluate_defender_options(_toy(-6.0), 1)}
    far = {o.action for o in evaluate_defender_options(_toy(-25.0), 1)}
    assert near == {"hold", "cut:R"}
    assert far == {"hold"}


def test_with_nothing_to_read_he_holds_by_the_cost_of_leaving_the_line():
    ctx = _toy(-6.0)  # the carrier would rather carry: cutting R's lane changes little
    hold, cut = evaluate_defender_options(ctx, 1)
    assert cut.value == pytest.approx(hold.value - ctx.params.defend_cost, abs=0.005)
    assert hold.prob > 0.8
