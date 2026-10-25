"""The sim never breaks a law the referee does not call (SPEC 3.9).

An invariant sweep with the audit's own judge (`eval.laws.audit_run`): every scenario on design and
held-out seeds, each hero's intervention, and both served stitched matches. The full audit runs
many more runs (`uv run python -m eval.laws`, eval/reports/laws.md); this sweep is its CI-sized
slice.
"""

import numpy as np
import pytest

from eval.laws import BREACH, audit_match, audit_scenario_seed
from sim import laws
from sim.engine import Simulation
from sim.match import restart_after
from sim.scenarios import SCENARIOS

SEEDS = (0, 1, 2, 3, 11, 100, 101, 200)


def problems(audits):
    """Unpunished breaches, wrong calls and early calls, and balls through the woodwork."""
    return [
        (f.run, f.frame, f.player, f.kind, f.detail)
        for a in audits
        for f in a.findings
        if f.unpunished or f.category != BREACH
    ]


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_no_scenario_breaks_a_law_the_referee_does_not_call(name):
    audits = [a for seed in SEEDS for a in audit_scenario_seed((name, seed))]
    assert problems(audits) == []


@pytest.mark.parametrize("seed", [1, 2])
def test_no_stitched_match_breaks_a_law_the_referee_does_not_call(seed):
    audits, _ = audit_match(seed)
    assert problems(audits) == []


def test_every_hero_moment_on_its_demo_seed_is_onside():
    for name, seed in {"blind_side_run": 3, "press_escape": 0, "far_post_finish": 11,
                       "corner_blind_side": 0}.items():  # fmt: skip
        run = Simulation.from_scenario(name, seed).run()
        team = np.array([p.team for p in run.players])
        for e in run.events:
            if e.type == "pass" and e.attrs.get("to"):
                margin = laws.offside_margins(run.pos[e.frame], team, run.ball_pos[e.frame, :2],
                                              e.team)[run.index(e.attrs["to"])]  # fmt: skip
                assert margin <= laws.LEVEL_TOLERANCE, (name, seed, e.id, margin)
        assert not any(e.type == "offside" for e in run.events)


def test_the_flagship_through_ball_is_onside_and_at_speed():
    run = Simulation.from_scenario("blind_side_run", 3).run()
    assert run.hero_decision().chosen == "pass:H9"
    p = next(e for e in run.events if e.type == "pass" and e.player == "H8")
    team = np.array([q.team for q in run.players])
    i9 = run.index("H9")
    margin = laws.offside_margins(run.pos[p.frame], team, run.ball_pos[p.frame, :2], 0)[i9]
    assert -2.0 < margin < -0.5  # onside, and close enough to the line to be in behind
    assert np.linalg.norm(run.vel[p.frame, i9]) > 6.0
    assert p.attrs["outcome"] == "complete" and p.attrs["receiver"] == "H9"


class _Offside:
    """A hand-made engine state: H9 stands 3 m beyond the away back line when H8 passes to him."""

    @staticmethod
    def run():
        sim = Simulation.from_scenario("possession_play", 5)
        ids = sim.ids
        sim.owner = ids.index("H8")
        sim.pos[ids.index("H8")] = [0.0, 0.0]
        sim.ball_pos[:2] = [0.3, 0.0]
        away = [i for i, p in enumerate(sim.players) if p.team == 1 and p.role != "GK"]
        for k, i in enumerate(away):
            sim.pos[i] = [25.0, -30.0 + 3.0 * k]  # a back line, all of it away from the pass
        sim.pos[ids.index("H9")] = [28.0, 20.0]
        sim.vel[:] = 0.0
        sim._kick_pass(sim.owner, np.array([28.0, 20.0]), ids.index("H9"), sim.frame)
        sim.run_until(sim.frame + 150)
        return sim.result()


def test_the_referee_whistles_offside_and_gives_the_defenders_a_free_kick():
    run = _Offside.run()
    calls = [e for e in run.events if e.type == "offside"]
    assert len(calls) == 1
    call = calls[0]
    assert call.player == "H9" and call.attrs["how"] == "played the ball"
    assert call.attrs["awarded_to"] == 1 and call.attrs["restart"] == "free_kick"
    assert call.attrs["margin"] > 2.5
    kick = next(e for e in run.events if e.id == call.attrs["kick"])
    assert kick.attrs["outcome"] == "offside"
    # Play stops: nobody gets the ball afterwards, and the match restarts with the free kick.
    assert not any(e.type in ("reception", "interception") and e.frame >= call.frame
                   for e in run.events)  # fmt: skip
    assert restart_after(run) == "free_kick"
