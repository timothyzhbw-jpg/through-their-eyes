"""Futsal pitch model in metres.

Origin at the centre spot, x along the touchlines toward the right-hand goal (as seen from the
camera), y across the pitch toward the far touchline; the camera stands beyond y = -width / 2.
Markings follow the futsal Laws of the Game (centre circle radius 3 m, penalty area built from 6 m
quarter circles around the goalposts joined by a 3.16 m line, 3 m goals). Length and width are
not known for this venue and are estimated from the markings during calibration (approximate).
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np


@dataclass(frozen=True)
class FutsalPitch:
    length: float = 40.0
    width: float = 20.0
    centre_radius: float = 3.0
    area_radius: float = 6.0
    area_line: float = 3.16
    goal_width: float = 3.0
    penalty_mark: float = 6.0
    second_penalty_mark: float = 10.0

    def with_size(self, length: float, width: float, centre_radius: float) -> FutsalPitch:
        return replace(self, length=length, width=width, centre_radius=centre_radius)

    def polygon(self, margin: float = 0.0) -> np.ndarray:
        """Pitch outline (4, 2), counter-clockwise, grown by `margin` metres."""
        hx, hy = self.length / 2 + margin, self.width / 2 + margin
        return np.array([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]])

    def contains(self, pts: np.ndarray, margin: float = 0.0) -> np.ndarray:
        pts = np.asarray(pts, dtype=float).reshape(-1, 2)
        return (np.abs(pts[:, 0]) <= self.length / 2 + margin) & (
            np.abs(pts[:, 1]) <= self.width / 2 + margin
        )

    def grid(self, cell: float) -> tuple[np.ndarray, tuple[int, int]]:
        """Cell centres over the pitch, (ny * nx, 2) with x fastest, and (ny, nx)."""
        nx, ny = round(self.length / cell), round(self.width / cell)
        xs = -self.length / 2 + cell * (np.arange(nx) + 0.5)
        ys = -self.width / 2 + cell * (np.arange(ny) + 0.5)
        gx, gy = np.meshgrid(xs, ys)
        return np.stack([gx.ravel(), gy.ravel()], axis=-1), (ny, nx)

    def features(self, step: float = 0.02) -> dict[str, np.ndarray]:
        """Every marking as a dense polyline (or a single point), keyed by name."""
        hl, hw = self.length / 2, self.width / 2

        def seg(a, b) -> np.ndarray:
            a, b = np.asarray(a, float), np.asarray(b, float)
            n = max(2, int(np.ceil(np.linalg.norm(b - a) / step)) + 1)
            return a + np.linspace(0.0, 1.0, n)[:, None] * (b - a)

        def arc(c, r, a0, a1) -> np.ndarray:
            n = max(2, int(np.ceil(abs(a1 - a0) * r / step)) + 1)
            t = np.linspace(a0, a1, n)
            return np.column_stack([c[0] + r * np.cos(t), c[1] + r * np.sin(t)])

        def area(side: float) -> np.ndarray:
            # side = +1 for the right-hand goal, -1 for the left-hand goal. Far quarter circle,
            # then the straight line, then the near quarter circle.
            gx = side * hl
            r, a = self.area_radius, self.area_line / 2
            if side > 0:
                far = arc((gx, a), r, np.pi / 2, np.pi)
                near = arc((gx, -a), r, np.pi, 1.5 * np.pi)
            else:
                far = arc((gx, a), r, np.pi / 2, 0.0)
                near = arc((gx, -a), r, 0.0, -np.pi / 2)
            line = seg((gx - side * r, a), (gx - side * r, -a))
            return np.vstack([far, line, near])

        g = self.goal_width / 2
        return {
            "near_touchline": seg((-hl, -hw), (hl, -hw)),
            "far_touchline": seg((-hl, hw), (hl, hw)),
            "halfway": seg((0, -hw), (0, hw)),
            "goal_line_right": seg((hl, -hw), (hl, hw)),
            "goal_line_left": seg((-hl, -hw), (-hl, hw)),
            "centre_circle": arc((0, 0), self.centre_radius, -np.pi, np.pi),
            "centre_spot": np.array([[0.0, 0.0]]),
            "area_right": area(+1.0),
            "area_left": area(-1.0),
            "penalty_spot_right": np.array([[hl - self.penalty_mark, 0.0]]),
            "penalty_spot_left": np.array([[-hl + self.penalty_mark, 0.0]]),
            "second_penalty_right": np.array([[hl - self.second_penalty_mark, 0.0]]),
            "second_penalty_left": np.array([[-hl + self.second_penalty_mark, 0.0]]),
            "post_far_right": np.array([[hl, g]]),
            "post_near_right": np.array([[hl, -g]]),
            "post_far_left": np.array([[-hl, g]]),
            "post_near_left": np.array([[-hl, -g]]),
            "corner_far_right": np.array([[hl, hw]]),
            "corner_near_right": np.array([[hl, -hw]]),
            "halfway_far": np.array([[0.0, hw]]),
            "halfway_near": np.array([[0.0, -hw]]),
        }

    def feature_samples(self, step: float = 0.5) -> dict[str, np.ndarray]:
        """Coarser samples of every marking, for drawing and synthetic tests."""
        return {k: v[:: max(1, round(step / 0.02))] for k, v in self.features().items()}

    def closest(self, feature: str, pts: np.ndarray, step: float = 0.02) -> np.ndarray:
        """Nearest point of a marking for each query point, (N, 2) -> (N, 2)."""
        poly = self.features(step)[feature]
        pts = np.asarray(pts, dtype=float).reshape(-1, 2)
        d = ((pts[:, None, :] - poly[None, :, :]) ** 2).sum(axis=-1)
        return poly[np.argmin(d, axis=1)]
