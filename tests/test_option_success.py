"""sim.decision.option_success: one option re-scored at a fixed target (SPEC 3.5, 5.1)."""

import numpy as np
import pytest

import sim.engine
from sim.decision import evaluate_options, option_success
from sim.engine import Simulation


@pytest.fixture(scope="module")
def captured():
    """Every decision context of a hero run, as the engine built it, and the run."""
    seen = []

    def recording(ctx):
        seen.append(ctx)
        return evaluate_options(ctx)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(sim.engine, "evaluate_options", recording)
        run = Simulation.from_scenario("blind_side_run", 3).run()
    return seen, run


def test_reproduces_every_option_on_the_context_it_was_scored_on(captured):
    contexts, _ = captured
    assert contexts
    for ctx in contexts:
        for o in evaluate_options(ctx):
            assert option_success(ctx, o.action, o.target) == pytest.approx(o.p_success, abs=1e-12)


def test_the_recorded_frame_is_the_state_the_decision_saw(captured):
    """The true state for "it was" is run.pos / run.vel / run.ball_pos at the decision frame."""
    contexts, run = captured
    hero = run.hero_decision()
    ctx = next(c for c in contexts if c.ids[c.carrier] == hero.player)
    i, f = ctx.carrier, hero.frame
    assert np.array_equal(ctx.pos[i], run.pos[f, i])
    assert np.array_equal(ctx.vel[i], run.vel[f, i])
    assert np.array_equal(ctx.ball, run.ball_pos[f, :2])


def test_decisions_are_unchanged(captured):
    _, run = captured
    again = Simulation.from_scenario("blind_side_run", 3).run()
    assert again.output_hash() == run.output_hash()


def test_rejects_unknown_actions_and_unplayable_passes(captured):
    ctx = captured[0][0]
    with pytest.raises(ValueError):
        option_success(ctx, "dribble", (0.0, 0.0))
    mate = next(j for j in range(len(ctx.team)) if ctx.team[j] == ctx.team[ctx.carrier]
                and j != ctx.carrier)  # fmt: skip
    far = (float(ctx.pos[ctx.carrier][0]) + 80.0, 0.0)  # beyond the 50 m pass range
    assert option_success(ctx, f"pass:{ctx.ids[mate]}", far) is None
