"""The goal frame (Law 1.10, SPEC 3.9): no player runs through a goalpost or stands in a goal.

Bowen saw it live on 2026-10-22: in blind_side_run seed 3 the away keeper ran along his goal line
through the post. Each hero's runs, factual and its intervention, on the demo and design seeds."""

import numpy as np
import pytest

from sim import laws
from sim.counterfactual import hero_counterfactual
from sim.engine import Simulation
from sim.scenarios import SCENARIOS

HEROES = sorted(name for name, cls in SCENARIOS.items() if cls.hero is not None)
DEMO = {"blind_side_run": 3, "press_escape": 0, "far_post_finish": 11, "corner_blind_side": 0}


def test_post_clearance_is_a_body_and_a_post():
    assert pytest.approx(laws.BODY_RADIUS + laws.POST_RADIUS) == laws.POST_CLEARANCE
    assert laws.post_distance(laws.POSTS[0]) == pytest.approx(0.0)
    assert laws.in_goal(np.array([laws.HALF_LENGTH + 0.5, 0.0]))
    assert not laws.in_goal(np.array([laws.HALF_LENGTH - 0.5, 0.0]))
    assert not laws.in_goal(np.array([laws.HALF_LENGTH + 0.5, laws.GOAL_HALF_WIDTH + 1.0]))


@pytest.mark.parametrize("scenario", HEROES)
def test_no_player_runs_through_a_post_or_into_a_goal(scenario):
    seeds = sorted({DEMO.get(scenario, 0), *range(10)})
    worst = []
    for seed in seeds:
        for kind, run in (
            ("factual", Simulation.from_scenario(scenario, seed).run()),
            ("intervention", hero_counterfactual(scenario, seed).counterfactual),
        ):
            gap = float(laws.post_distance(run.pos).min())
            worst.append((gap, seed, kind))
            assert not laws.in_goal(run.pos).any(), (scenario, seed, kind)
    assert min(worst)[0] >= laws.POST_CLEARANCE, min(worst)


def _keeper_runs_past_a_post(run) -> list[tuple[str, int]]:
    """Frames where a keeper sweeps his goal line past his post (`laws.along_line_past_posts`):
    what Bowen saw in blind_side_run seed 3 before the keeper spot (A1 ran along the line at
    4.5 m/s, 0.5-0.7 m past the post, frames 117-121). A keeper shuffling at his near post
    (cutback_scan, about 1 m/s, half a body outside it) is not this."""
    out = []
    for k, p in enumerate(run.players):
        if p.role == "GK":
            speed = np.linalg.norm(run.vel[:, k], axis=-1)
            bad = np.flatnonzero(laws.along_line_past_posts(run.pos[:, k], speed))
            out += [(p.id, int(f)) for f in bad]
    return out


@pytest.mark.parametrize("scenario", HEROES)
def test_no_keeper_runs_along_his_goal_line_past_a_post(scenario):
    seeds = sorted({DEMO.get(scenario, 0), *range(10)})
    for seed in seeds:
        for kind, run in (
            ("factual", Simulation.from_scenario(scenario, seed).run()),
            ("intervention", hero_counterfactual(scenario, seed).counterfactual),
        ):
            assert not _keeper_runs_past_a_post(run), (scenario, seed, kind)
