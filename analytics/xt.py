"""Expected threat (SPEC 4.5).

`xt_prior` is a smooth surface used by the decision model until the 16 x 12 grid fitted on
synthetic events exists; it rises toward the opponent's goal and is symmetric across the long axis.
Coordinates are for a team attacking +x; use `xt_for` for a team attacking -x.
"""

from __future__ import annotations

import numpy as np

GOAL_X = 52.5
FLOOR = 0.02
PEAK = 0.33
SCALE_M = 14.0


def xt_prior(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    d = np.hypot(GOAL_X - np.asarray(x, dtype=float), np.asarray(y, dtype=float))
    return FLOOR + PEAK * np.exp(-((d / SCALE_M) ** 1.5))


def xt_for(points: np.ndarray, attack_sign: int) -> np.ndarray:
    """xT of points ((M, 2) or (2,)) for a team attacking toward `attack_sign` * x."""
    p = np.asarray(points, dtype=float)
    return xt_prior(attack_sign * p[..., 0], attack_sign * p[..., 1])
