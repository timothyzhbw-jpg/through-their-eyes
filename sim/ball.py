"""Ball physics on the ground (SPEC 3.3).

Rolling ball with constant rolling resistance and quadratic air drag:
    dv/dt = -a - b v^2,   a = rolling deceleration,   b = rho * C_d * pi r^2 / (2 m).
This has a closed form. With phi0 = atan(v0 sqrt(b/a)) and k = sqrt(a b):
    v(t) = sqrt(a/b) tan(phi0 - k t),         stops at t = phi0 / k
    x(t) = ln(cos(phi0 - k t) / cos(phi0)) / b
    v(x)^2 = (v0^2 + a/b) exp(-2 b x) - a/b
Frame stepping uses the same closed form, so energy only decreases and predictions match the sim
exactly. Lofted passes, bounce and Magnus are later work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

G = 9.81


@dataclass(frozen=True)
class BallParams:
    mass: float = 0.43  # kg
    radius: float = 0.11  # m
    air_density: float = 1.2  # kg/m^3
    drag_coefficient: float = 0.25
    rolling_decel: float = 0.6  # m/s^2, grass rolling resistance (tunable)

    @property
    def drag_per_m(self) -> float:
        area = math.pi * self.radius**2
        return self.air_density * self.drag_coefficient * area / (2.0 * self.mass)


def _constants(p: BallParams) -> tuple[float, float, float]:
    a, b = p.rolling_decel, p.drag_per_m
    return a, b, math.sqrt(a * b)


def advance(speed: float, dt: float, p: BallParams = BallParams()) -> tuple[float, float]:
    """Distance covered and speed after rolling for dt from `speed`."""
    if speed <= 0.0:
        return 0.0, 0.0
    a, b, k = _constants(p)
    phi0 = math.atan(speed * math.sqrt(b / a))
    if dt >= phi0 / k:
        return -math.log(math.cos(phi0)) / b, 0.0
    phi = phi0 - k * dt
    return math.log(math.cos(phi) / math.cos(phi0)) / b, math.sqrt(a / b) * math.tan(phi)


def distance_to_stop(v0: float, p: BallParams = BallParams()) -> float:
    a, b, _ = _constants(p)
    return math.log1p(b * v0 * v0 / a) / (2.0 * b)


def speed_at(v0: float, distance: float, p: BallParams = BallParams()) -> float:
    """Speed after rolling `distance` from v0 (0 if the ball stops before)."""
    a, b, _ = _constants(p)
    v2 = (v0 * v0 + a / b) * math.exp(-2.0 * b * distance) - a / b
    return math.sqrt(max(v2, 0.0))


def launch_speed(distance: float, arrival_speed: float, p: BallParams = BallParams()) -> float:
    """Initial speed that reaches `distance` with `arrival_speed`."""
    a, b, _ = _constants(p)
    return math.sqrt((arrival_speed**2 + a / b) * math.exp(2.0 * b * distance) - a / b)


def flight_time(v0: float, distance: float, p: BallParams = BallParams()) -> float:
    """Time to roll `distance` from v0; inf if the ball stops first."""
    a, b, k = _constants(p)
    phi0 = math.atan(v0 * math.sqrt(b / a))
    cos_phi = math.cos(phi0) * math.exp(b * distance)
    if cos_phi >= 1.0:
        return math.inf
    return (phi0 - math.acos(cos_phi)) / k


def path_distances(v0: float, times: np.ndarray, p: BallParams = BallParams()) -> np.ndarray:
    """Distance rolled from v0 after each time in `times`."""
    a, b, k = _constants(p)
    if v0 <= 0.0:
        return np.zeros_like(times, dtype=float)
    phi0 = math.atan(v0 * math.sqrt(b / a))
    phi = np.maximum(phi0 - k * np.asarray(times, dtype=float), 0.0)
    return np.log(np.cos(phi) / math.cos(phi0)) / b
