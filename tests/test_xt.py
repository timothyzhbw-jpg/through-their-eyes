"""Expected threat fitted on synthetic open play (SPEC 4.5, acceptance checks — analytics).

The acceptance checks run on the cached grid (`analytics/xt_grid.json`), which
`uv run python -m eval.xt_fit` fits on `open_play` tuning seeds; the freshness test fails when
the sim behaves differently from the version the grid was fitted on.
"""

import json

import numpy as np
import pytest

from analytics import xt
from analytics.xt import (
    NX,
    NY,
    Action,
    cell_centres,
    fit_xt,
    grid_value,
    xt_for,
    xt_prior,
    xt_prior_for,
)

CENTRAL = [4, 5, 6, 7]  # lanes either side of the long axis (12 lanes of 5.7 m)
WINGS = [0, 1, 10, 11]
NEAR_GOAL = [13, 14, 15]  # the last three columns (6.6 m each) before the attacked goal line


@pytest.fixture(scope="module")
def cache():
    return json.loads(xt.GRID_PATH.read_text())


@pytest.fixture(scope="module")
def grid(cache):
    return np.array(cache["grid"])


# --- the value iteration on hand-built actions -------------------------------------------


def _centre(i: int, j: int) -> tuple[float, float]:
    xs, ys = cell_centres()
    return float(xs[i]), float(ys[j])


def test_value_iteration_matches_the_closed_form_on_a_two_cell_chain():
    a, b = _centre(10, 6), _centre(14, 6)
    actions = [Action("move", a, b)] * 8 + [Action("move", a, None)] * 2  # A: 80% reach B
    actions += [Action("shot", b, None, 0.4)] * 5 + [Action("move", b, b)] * 5  # B: half shots
    fit = fit_xt(actions, min_actions=1, min_shots=1)
    # xT(B) = 0.5 * 0.4 + 0.5 * xT(B) = 0.4; xT(A) = 0.8 * xT(B) = 0.32.
    assert fit.status == "fitted"
    assert fit.grid[14, 6] == pytest.approx(0.4, abs=1e-9)
    assert fit.grid[10, 6] == pytest.approx(0.32, abs=1e-9)


def test_cells_with_too_little_data_keep_the_prior_moved_to_the_fitted_floor():
    a, b = _centre(10, 6), _centre(14, 6)
    actions = [Action("shot", a, None, 0.1)] + [Action("move", a, b)] * 9  # A: 10 actions
    actions += [Action("shot", b, None, 0.5)] * 2  # B: 2 actions, too few
    fit = fit_xt(actions, min_actions=5, min_shots=1)
    xs, ys = cell_centres()
    assert fit.fitted[10, 6] and not fit.fitted[14, 6] and not fit.fitted[0, 0]
    # The floor is A's value with sparse cells worth 0: 0.1 / 10 = 0.01.
    assert fit.grid[14, 6] == pytest.approx(xt_prior(xs[14], ys[6]) - xt.FLOOR + 0.01)
    assert fit.grid[0, 0] == pytest.approx(max(xt_prior(xs[0], ys[0]) - xt.FLOOR + 0.01, 0.0))
    assert fit.grid[10, 6] == pytest.approx(0.01 + 0.9 * fit.grid[14, 6])


def test_a_symmetric_fit_counts_every_action_mirrored_across_the_long_axis():
    actions = [
        Action("move", (10.0, -20.0), (25.0, -12.0)),
        Action("move", (25.0, -12.0), None),
        Action("move", (25.0, -12.0), (40.0, -5.0)),
        Action("shot", (40.0, -5.0), None, 0.3),
        Action("move", (40.0, -5.0), (44.0, 2.0)),
    ] * 3
    mirrored = [
        Action(a.kind, (a.start[0], -a.start[1]),
               None if a.end is None else (a.end[0], -a.end[1]), a.goals)
        for a in actions
    ]  # fmt: skip
    sym = fit_xt(actions, min_actions=1, min_shots=1, symmetric=True)
    both = fit_xt(actions + mirrored, min_actions=1, min_shots=1)
    np.testing.assert_allclose(sym.grid, both.grid, atol=1e-12)
    np.testing.assert_allclose(sym.grid, sym.grid[:, ::-1], atol=1e-12)


def test_without_enough_shots_the_whole_grid_is_the_prior():
    a, b = _centre(10, 6), _centre(14, 6)
    fit = fit_xt([Action("move", a, b)] * 50, min_actions=1, min_shots=1)
    xs, ys = cell_centres()
    assert fit.status.startswith("prior")
    np.testing.assert_allclose(fit.grid, xt_prior(xs[:, None], ys[None, :]))


# --- acceptance: the fitted grid ----------------------------------------------------------


def test_the_cached_grid_is_a_real_fit_of_the_current_sim(cache):
    from eval.xt_fit import MIN_ACTIONS, MIN_SHOTS, SCENARIO, SEEDS, SYMMETRIC, sim_version

    assert cache["status"] == "fitted"
    assert (cache["scenario"], cache["seeds"]) == (SCENARIO, [SEEDS.start, SEEDS.stop - 1])
    assert (cache["min_actions"], cache["min_shots"]) == (MIN_ACTIONS, MIN_SHOTS)
    assert cache["symmetric"] == SYMMETRIC
    assert cache["sim_version"] == sim_version(), (
        "analytics/xt_grid.json was fitted on another sim version: run "
        "`uv run python -m eval.xt_fit`, then regenerate the exports (web/README.md)"
    )


def test_fitted_grid_is_16_by_12_and_probability_like(grid):
    assert grid.shape == (NX, NY)
    assert np.all(np.isfinite(grid))
    assert grid.min() >= 0.0 and grid.max() <= 1.0


def test_fitted_grid_increases_toward_the_attacked_goal(grid, cache):
    fitted = np.array(cache["fitted"])
    assert fitted.mean() >= 0.5  # mostly fitted, not the prior standing in
    assert fitted[np.ix_(NEAR_GOAL, [5, 6])].all()  # the near-goal comparison is on fitted cells
    columns = grid.mean(axis=1)
    assert np.all(np.diff(columns) >= -0.01)
    assert np.all(np.diff(grid[:, CENTRAL].mean(axis=1)) >= -0.02)
    assert columns[NEAR_GOAL].mean() - columns[:3].mean() >= 0.05
    for j in range(NY):  # no lane is worth less near goal than in its own half
        assert grid[NEAR_GOAL, j].mean() >= grid[: NX // 2, j].mean() - 0.01


def test_central_lanes_are_worth_at_least_the_wings_near_goal(grid):
    for i in NEAR_GOAL:
        assert grid[i, CENTRAL].mean() >= grid[i, WINGS].mean()


def test_a_fixed_seed_set_gives_a_byte_identical_grid():
    from eval.xt_fit import collect

    first = fit_xt(collect(range(2)), min_actions=1, min_shots=0)
    second = fit_xt(collect(range(2)), min_actions=1, min_shots=0)
    assert first.grid.tobytes() == second.grid.tobytes()
    assert first.fitted.tobytes() == second.fitted.tobytes()


# --- wiring --------------------------------------------------------------------------------


def test_xt_for_reads_the_fitted_grid_between_cell_centres(grid):
    xs, ys = cell_centres()
    assert xt_for(np.array([xs[12], ys[3]]), 1) == pytest.approx(grid[12, 3])
    mid = np.array([(xs[12] + xs[13]) / 2, ys[3]])
    assert xt_for(mid, 1) == pytest.approx((grid[12, 3] + grid[13, 3]) / 2)
    # Continuous: a millimetre either side of a cell boundary is the same value.
    edge = -52.5 + 13 * 105.0 / NX
    left, right = xt_for(np.array([[edge - 1e-3, 0.0], [edge + 1e-3, 0.0]]), 1)
    assert abs(left - right) < 1e-3
    # A team attacking -x sees the pitch rotated by 180 degrees.
    p = np.array([30.0, -12.0])
    assert xt_for(p, -1) == pytest.approx(xt_for(-p, 1))
    assert grid_value(grid, 30.0, -12.0) == pytest.approx(xt_for(p, 1))


def test_decisions_still_value_options_with_the_prior():
    """The grid is fitted on play the decision model drives, so the model keeps the prior: a
    decision model on the fitted grid would change the very data the grid is fitted on."""
    from sim.decision import DecisionContext, evaluate_options

    team = np.array([0, 0, 1])
    ctx = DecisionContext(
        carrier=0, team=team, pos=np.array([[20.0, 5.0], [30.0, -8.0], [26.0, 9.0]]),
        vel=np.zeros((3, 2)), age_s=np.zeros(3), ids=["H8", "H9", "A5"],
    )  # fmt: skip
    carry = next(o for o in evaluate_options(ctx) if o.action == "carry")
    expected = carry.p_success * xt_prior_for(np.array(carry.target), 1) - (
        1.0 - carry.p_success
    ) * xt_prior_for(np.array([20.0, 5.0]), -1)
    assert carry.value == pytest.approx(float(expected), abs=1e-12)


# --- the data: open play driven by the decision model ---------------------------------------


@pytest.fixture(scope="module")
def open_run():
    from eval.xt_fit import PARAMS, SCENARIO
    from sim.engine import Simulation

    return Simulation.from_scenario(SCENARIO, 0, params=PARAMS).run()


def test_in_open_play_every_pass_and_shot_is_a_decision(open_run):
    decided = {(d.player, d.frame, d.chosen.split(":")[0]) for d in open_run.decisions}
    kicks = [e for e in open_run.events if e.type in ("pass", "shot")]
    assert kicks
    for e in kicks:
        assert (e.player, e.frame, e.type) in decided


def test_in_open_play_the_carrier_decides_again_after_a_carry(open_run):
    from eval.xt_fit import PARAMS, SCENARIO
    from sim.decision import DecisionParams
    from sim.engine import Simulation

    steps = round(DecisionParams().carry_time / open_run.dt)
    checked = 0
    # Seed 0 may end without a carry; seed 1 carries too.
    for run in (open_run, Simulation.from_scenario(SCENARIO, 1, params=PARAMS).run()):
        frames = {(d.player, d.frame) for d in run.decisions}
        carries = [d for d in run.decisions if d.chosen == "carry"
                   and d.frame + steps < len(run.owner) - 1]  # fmt: skip
        for d in carries:
            assert (d.player, d.frame + steps) in frames
        checked += len(carries)
    assert checked
