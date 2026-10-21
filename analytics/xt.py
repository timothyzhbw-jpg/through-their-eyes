"""Expected threat (SPEC 4.5).

Two surfaces, both for a team attacking +x (`xt_for` and `xt_prior_for` take the attack sign):

- `xt_prior`: a smooth surface that rises toward the opponent's goal and is symmetric across the
  long axis. The decision model values options with it (SPEC 3.5): the grid below is fitted on
  play that the decision model drives, so a decision model on the grid would change the very
  data the grid is fitted on.
- The 16 x 12 grid fitted on synthetic open play with Singh's (2019) Markov model, solved by
  value iteration:

      xT(z) = s(z) g(z) + m(z) sum_z' T(z -> z') xT(z')

  s, m: shares of the actions from cell z that are shots and moves (passes, carries); g: goals
  per shot; T: successful moves from z ending in z', per move from z (a lost ball is worth 0).
  A cell with fewer than `min_actions` actions keeps the prior, moved down to the fitted floor
  (the prior's floor is a guess, the fit measures it); with fewer than `min_shots` shots in all
  the whole grid is the prior. `eval/xt_fit.py` fits it and caches it per sim version in
  `xt_grid.json`; `xt_for` reads it, bilinear between cell centres so that a millimetre never
  jumps a cell boundary, and falls back to the prior when there is no cache.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import numpy as np

GOAL_X = 52.5
FLOOR = 0.02
PEAK = 0.33
SCALE_M = 14.0

NX, NY = 16, 12
LENGTH, WIDTH = 105.0, 68.0
GRID_PATH = Path(__file__).with_name("xt_grid.json")


def xt_prior(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    d = np.hypot(GOAL_X - np.asarray(x, dtype=float), np.asarray(y, dtype=float))
    return FLOOR + PEAK * np.exp(-((d / SCALE_M) ** 1.5))


def xt_prior_for(points: np.ndarray, attack_sign: int) -> np.ndarray:
    """Prior xT of points ((M, 2) or (2,)) for a team attacking toward `attack_sign` * x."""
    p = np.asarray(points, dtype=float)
    return xt_prior(attack_sign * p[..., 0], attack_sign * p[..., 1])


# --- the fitted grid ----------------------------------------------------------------------


@dataclass(frozen=True)
class Action:
    """One on-ball action, in coordinates where the acting team attacks +x."""

    kind: str  # "move" or "shot"
    start: tuple[float, float]
    end: tuple[float, float] | None  # where a successful move ended; None if the ball was lost
    goals: float = 0.0  # a shot's expected goals


@dataclass(frozen=True)
class XtFit:
    grid: np.ndarray  # (NX, NY)
    fitted: np.ndarray  # (NX, NY) bool: the cell's value comes from data, not the prior
    actions: np.ndarray  # (NX, NY) actions started in each cell
    shots: np.ndarray  # (NX, NY)
    status: str  # "fitted", or "prior: <why>"


def cell_centres() -> tuple[np.ndarray, np.ndarray]:
    return (
        (np.arange(NX) + 0.5) * LENGTH / NX - LENGTH / 2,
        (np.arange(NY) + 0.5) * WIDTH / NY - WIDTH / 2,
    )


def cell_of(point: tuple[float, float]) -> tuple[int, int]:
    i = int(np.clip(np.floor((point[0] + LENGTH / 2) / LENGTH * NX), 0, NX - 1))
    j = int(np.clip(np.floor((point[1] + WIDTH / 2) / WIDTH * NY), 0, NY - 1))
    return i, j


def fit_xt(
    actions: list[Action],
    min_actions: int = 10,
    min_shots: int = 30,
    symmetric: bool = False,
    tol: float = 1e-12,
) -> XtFit:
    """`symmetric`: every action counts again mirrored across the long axis (for play that is
    symmetric in y), so a cell's counts are its own plus its mirror image's."""
    n, shots, goals = np.zeros((NX, NY)), np.zeros((NX, NY)), np.zeros((NX, NY))
    moved = np.zeros((NX, NY, NX, NY))
    mirrors = (1.0, -1.0) if symmetric else (1.0,)
    for a in actions:
        for m in mirrors:
            z = cell_of((a.start[0], m * a.start[1]))
            n[z] += 1
            if a.kind == "shot":
                shots[z] += 1
                goals[z] += a.goals
            elif a.end is not None:
                moved[z + cell_of((a.end[0], m * a.end[1]))] += 1
    xs, ys = cell_centres()
    prior = xt_prior(xs[:, None], ys[None, :])
    fitted = n >= min_actions
    if shots.sum() / len(mirrors) < min_shots or not fitted.any():
        why = f"prior: {shots.sum() / len(mirrors):.0f} shots, fewer than {min_shots}"
        return XtFit(prior, np.zeros_like(fitted), n, shots, why)
    safe = np.maximum(n, 1.0)
    reward = goals / safe  # s * g = (shots / n) * (goals / shots)
    move = moved / safe[:, :, None, None]  # m * T
    # The prior's floor (its value far from goal) is a guess and the fit measures it: sparse cells
    # take the prior moved to the lowest fitted value, found with sparse cells worth 0.
    floor = _value_iteration(reward, move, fitted, np.zeros_like(prior), tol)[fitted].min()
    fallback = np.clip(prior - FLOOR + floor, 0.0, 1.0)
    return XtFit(_value_iteration(reward, move, fitted, fallback, tol), fitted, n, shots, "fitted")


def _value_iteration(reward, move, fitted, fallback, tol: float) -> np.ndarray:
    grid = np.where(fitted, 0.0, fallback)
    for _ in range(100_000):
        new = np.where(fitted, reward + np.einsum("abcd,cd->ab", move, grid), fallback)
        done = np.abs(new - grid).max() < tol
        grid = new
        if done:
            break
    return grid


def grid_value(grid: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Bilinear between cell centres; constant beyond the outermost centres."""
    fx = np.clip((np.asarray(x, dtype=float) + LENGTH / 2) / LENGTH * NX - 0.5, 0, NX - 1)
    fy = np.clip((np.asarray(y, dtype=float) + WIDTH / 2) / WIDTH * NY - 0.5, 0, NY - 1)
    i, j = np.minimum(fx.astype(int), NX - 2), np.minimum(fy.astype(int), NY - 2)
    tx, ty = fx - i, fy - j
    return (
        (1 - tx) * (1 - ty) * grid[i, j]
        + tx * (1 - ty) * grid[i + 1, j]
        + (1 - tx) * ty * grid[i, j + 1]
        + tx * ty * grid[i + 1, j + 1]
    )


@cache
def fitted_grid() -> np.ndarray | None:
    """The cached fit, or None when there is none (then xT is the prior)."""
    if not GRID_PATH.exists():
        return None
    data = json.loads(GRID_PATH.read_text())
    return np.array(data["grid"], dtype=float) if data["status"] == "fitted" else None


def xt_for(points: np.ndarray, attack_sign: int) -> np.ndarray:
    """xT of points ((M, 2) or (2,)) for a team attacking toward `attack_sign` * x."""
    grid = fitted_grid()
    if grid is None:
        return xt_prior_for(points, attack_sign)
    p = np.asarray(points, dtype=float)
    return grid_value(grid, attack_sign * p[..., 0], attack_sign * p[..., 1])
