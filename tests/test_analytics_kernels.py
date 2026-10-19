"""Acceptance checks for the M1 analytics kernels (SPEC 4.1, 4.2, 4.4, 4.5)."""

import numpy as np

from analytics.pitch_control import pitch_control, pitch_grid
from analytics.tti import time_to_intercept
from analytics.vision import player_visibility, visibility
from analytics.xt import xt_prior

NO_OCCLUDERS = np.empty((0, 2))


def _random_teams(seed: int):
    rng = np.random.default_rng(seed)
    half = np.array([52.5, 34.0])
    hp, ap = rng.uniform(-half, half, size=(2, 11, 2))
    hv, av = rng.normal(0.0, 2.0, size=(2, 11, 2))
    return hp, hv, ap, av


# --- 4.1 time to intercept ---------------------------------------------------------------


def test_tti_of_a_standing_player_is_reaction_plus_run():
    t = time_to_intercept(np.zeros((1, 2)), np.zeros((1, 2)), np.array([[10.0, 0.0]]), 0.7, 5.0)
    assert np.isclose(t[0, 0], 0.7 + 10.0 / 5.0)


def test_tti_keeps_current_velocity_during_reaction():
    # Moving at 5 m/s toward the target: at 3.5 m after 0.7 s, then 6.5 m at 5 m/s.
    t = time_to_intercept(
        np.zeros((1, 2)), np.array([[5.0, 0.0]]), np.array([[10.0, 0.0]]), 0.7, 5.0
    )
    assert np.isclose(t[0, 0], 0.7 + 6.5 / 5.0)


# --- 4.2 pitch control -------------------------------------------------------------------


def test_pitch_control_is_a_probability_that_sums_to_one_across_teams():
    grid = pitch_grid(1.0)
    assert grid.shape == (105 * 68, 2)
    for seed in range(5):
        hp, hv, ap, av = _random_teams(seed)
        p_home = pitch_control(grid, hp, hv, ap, av)
        p_away = pitch_control(grid, ap, av, hp, hv)
        assert p_home.min() >= 0.0 and p_home.max() <= 1.0
        np.testing.assert_allclose(p_home + p_away, 1.0, atol=1e-12)


def test_pitch_control_is_symmetric_under_team_swap_and_pitch_flip():
    grid = pitch_grid(1.0)
    for seed in range(5):
        hp, hv, ap, av = _random_teams(seed)
        p_home = pitch_control(grid, hp, hv, ap, av)
        # The away team becomes the home team on a pitch rotated by 180 degrees.
        p_swapped = pitch_control(-grid, -ap, -av, -hp, -hv)
        np.testing.assert_allclose(p_swapped, 1.0 - p_home, atol=1e-12)


# --- 4.4 vision --------------------------------------------------------------------------


def _polar(angles_deg, dists):
    a = np.deg2rad(np.asarray(angles_deg, dtype=float))
    d = np.asarray(dists, dtype=float)
    a, d = np.meshgrid(a, d)
    return np.stack([d.ravel() * np.cos(a.ravel()), d.ravel() * np.sin(a.ravel())], axis=-1)


def test_cells_behind_the_player_are_not_visible():
    behind = _polar(np.arange(120, 241, 5), [1, 3, 10, 25, 50])
    v = visibility(np.zeros(2), 0.0, 0.0, behind, NO_OCCLUDERS)
    assert v.max() < 0.05


def test_cells_in_front_are_visible():
    front = _polar([-30, 0, 30], [3, 10, 20])
    v = visibility(np.zeros(2), 0.0, 0.0, front, NO_OCCLUDERS)
    assert v.min() > 0.85


def test_occluded_cells_score_lower_than_unoccluded_at_same_angle_and_distance():
    target = np.array([[20.0, 0.0]])
    free = visibility(np.zeros(2), 0.0, 0.0, target, NO_OCCLUDERS)
    blocked = visibility(np.zeros(2), 0.0, 0.0, target, np.array([[8.0, 0.1]]))
    assert blocked[0] < 0.5 * free[0]
    # An occluder behind the target does not block it.
    beyond = visibility(np.zeros(2), 0.0, 0.0, target, np.array([[30.0, 0.0]]))
    assert np.isclose(beyond[0], free[0])


def test_cone_narrows_as_running_speed_rises():
    edge = _polar([55], [10])
    standing = visibility(np.zeros(2), 0.0, 0.0, edge, NO_OCCLUDERS)
    sprinting = visibility(np.zeros(2), 0.0, 7.5, edge, NO_OCCLUDERS)
    assert sprinting[0] < standing[0]


# --- 4.5 expected threat (prior used until the fitted grid exists) ------------------------


def test_xt_prior_increases_toward_goal_and_is_symmetric_across_the_long_axis():
    xs = np.linspace(-50, 50, 21)
    values = xt_prior(xs, np.zeros_like(xs))
    assert np.all(np.diff(values) > 0)
    ys = np.linspace(-30, 30, 13)
    np.testing.assert_allclose(
        xt_prior(np.full_like(ys, 30.0), ys), xt_prior(np.full_like(ys, 30.0), -ys)
    )


def test_player_visibility_matches_the_single_observer_kernel():
    rng = np.random.default_rng(4)
    pos = rng.uniform([-40, -30], [40, 30], size=(22, 2))
    head = rng.uniform(-np.pi, np.pi, 22)
    speed = rng.uniform(0, 8, 22)
    v = player_visibility(pos, head, speed)
    for i in range(22):
        others = np.delete(np.arange(22), i)
        for j in others:
            occluders = pos[np.setdiff1d(others, [j])]
            ref = visibility(pos[i], head[i], speed[i], pos[[j]], occluders)[0]
            assert abs(v[i, j] - ref) < 1e-12
    np.testing.assert_array_equal(np.diag(v), 1.0)
