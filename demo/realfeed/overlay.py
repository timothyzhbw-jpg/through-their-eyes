"""Ground graphics: drawn in pitch coordinates, projected into the frame, keyed onto the turf.

Every graphic is rasterised on a top-down canvas in metres and warped into the frame with the
frame's image-from-world homography, so it lies on the ground with correct perspective. It is
then composited only where the pixel is turf-coloured: players, the ball and the painted lines
stay on top of the graphics, as if the graphics were painted on the grass under their feet.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from analytics.pitch_control import control_from_times, pitch_control
from analytics.tti import time_to_intercept
from demo.realfeed.geometry import apply_h
from demo.realfeed.pitch import FutsalPitch

# Turf in this footage is a washed-out green: OpenCV hue ~52-63, saturation ~40-56.
GRASS_HUE = (38, 88)
GRASS_SAT = (20, 160)
GRASS_VAL = (60, 220)

RED = (60, 60, 230)  # BGR
BLUE = (230, 160, 60)
WHITE = (255, 255, 255)


def grass_mask(frame_bgr: np.ndarray) -> np.ndarray:
    """True where a pixel has the colour of the turf (not lines, kits, skin, ball or brick)."""
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    lo = np.array([GRASS_HUE[0], GRASS_SAT[0], GRASS_VAL[0]], np.uint8)
    hi = np.array([GRASS_HUE[1], GRASS_SAT[1], GRASS_VAL[1]], np.uint8)
    return cv2.inRange(hsv, lo, hi).astype(bool)


def composite(
    frame: np.ndarray, layer_bgr: np.ndarray, alpha: np.ndarray, key: np.ndarray
) -> np.ndarray:
    """Alpha-blend `layer_bgr` over `frame` where `key` is True; other pixels stay untouched."""
    out = frame.copy()
    sel = key & (alpha > 0)
    a = alpha[sel][:, None]
    out[sel] = np.clip(frame[sel] * (1 - a) + layer_bgr[sel] * a + 0.5, 0, 255).astype(np.uint8)
    return out


@dataclass(frozen=True)
class Canvas:
    """Top-down raster over the pitch plus a margin, `ppm` pixels per metre."""

    pitch: FutsalPitch
    ppm: float = 40.0
    margin: float = 1.0

    @property
    def size(self) -> tuple[int, int]:
        w = round((self.pitch.length + 2 * self.margin) * self.ppm)
        h = round((self.pitch.width + 2 * self.margin) * self.ppm)
        return w, h

    def world_from_canvas(self) -> np.ndarray:
        s = 1.0 / self.ppm
        x0 = -self.pitch.length / 2 - self.margin
        y0 = self.pitch.width / 2 + self.margin
        return np.array([[s, 0, x0], [0, -s, y0], [0, 0, 1.0]])

    def to_px(self, pts: np.ndarray) -> np.ndarray:
        return apply_h(np.linalg.inv(self.world_from_canvas()), pts)


class Layer:
    """BGR + alpha raster on a canvas, with drawing helpers in world coordinates."""

    def __init__(self, canvas: Canvas):
        self.canvas = canvas
        w, h = canvas.size
        self.bgr = np.zeros((h, w, 3), np.float32)
        self.alpha = np.zeros((h, w), np.float32)

    def _blend(self, paint: np.ndarray, colour, opacity: float) -> None:
        a = paint.astype(np.float32) / 255.0 * opacity
        self.bgr = self.bgr * (1 - a[..., None]) + np.array(colour, np.float32) * a[..., None]
        self.alpha = self.alpha + a * (1 - self.alpha)

    def heat(self, colours: np.ndarray, alpha: np.ndarray) -> None:
        """Paint a full-canvas colour image (h, w, 3) with per-pixel alpha (h, w)."""
        a = alpha.astype(np.float32)
        self.bgr = self.bgr * (1 - a[..., None]) + colours.astype(np.float32) * a[..., None]
        self.alpha = self.alpha + a * (1 - self.alpha)

    def line(self, a, b, colour, width_m: float, opacity: float = 1.0) -> None:
        paint = np.zeros(self.alpha.shape, np.uint8)
        p = np.round(self.canvas.to_px(np.array([a, b])) * 16).astype(np.int32)
        t = max(1, round(width_m * self.canvas.ppm))
        cv2.line(paint, tuple(p[0]), tuple(p[1]), 255, t, cv2.LINE_AA, shift=4)
        self._blend(paint, colour, opacity)

    def circle(self, c, r_m: float, colour, width_m: float, opacity: float = 1.0) -> None:
        paint = np.zeros(self.alpha.shape, np.uint8)
        p = np.round(self.canvas.to_px(np.array([c]))[0] * 16).astype(np.int32)
        r = round(r_m * self.canvas.ppm * 16)
        t = -1 if width_m <= 0 else max(1, round(width_m * self.canvas.ppm))
        cv2.circle(paint, tuple(p), r, 255, t, cv2.LINE_AA, shift=4)
        self._blend(paint, colour, opacity)

    def polygon(self, pts, colour, opacity: float = 1.0) -> None:
        paint = np.zeros(self.alpha.shape, np.uint8)
        p = np.round(self.canvas.to_px(np.asarray(pts)) * 16).astype(np.int32)
        cv2.fillPoly(paint, [p], 255, cv2.LINE_AA, shift=4)
        self._blend(paint, colour, opacity)

    def project(self, h_img_from_world: np.ndarray, size: tuple[int, int]):
        """Warp to the frame: (bgr uint8 (H, W, 3), alpha float (H, W))."""
        h = h_img_from_world @ self.canvas.world_from_canvas()
        rgba = np.dstack([self.bgr, self.alpha * 255.0]).astype(np.float32)
        warped = cv2.warpPerspective(
            rgba, h, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0
        )
        return np.clip(warped[..., :3], 0, 255).astype(np.uint8), warped[..., 3] / 255.0


# --- analytics on the tracked players -----------------------------------------------------


def control_surface(
    canvas: Canvas,
    team_a: tuple[np.ndarray, np.ndarray],
    team_b: tuple[np.ndarray, np.ndarray],
    cell: float = 0.5,
) -> np.ndarray:
    """P(team a controls) on the canvas raster, from analytics.pitch_control (SPEC 4.2)."""
    pts, (ny, nx) = canvas.pitch.grid(cell)
    p = pitch_control(pts, team_a[0], team_a[1], team_b[0], team_b[1]).reshape(ny, nx)
    # Grid rows run from -width/2 upward; canvas rows run from +width/2 downward.
    p = p[::-1]
    w, h = canvas.size
    m = round(canvas.margin * canvas.ppm)
    inner = cv2.resize(p.astype(np.float32), (w - 2 * m, h - 2 * m), interpolation=cv2.INTER_CUBIC)
    out = np.full((h, w), np.nan, np.float32)
    out[m : h - m, m : w - m] = np.clip(inner, 0, 1)
    return out


def pass_safety(
    carrier: np.ndarray,
    target: np.ndarray,
    defenders: tuple[np.ndarray, np.ndarray],
    ball_speed: float = 10.0,
    skip_m: float = 1.0,
) -> float:
    """Lowest P(ball beats every defender) along the pass line (TTI, SPEC 4.1 / 4.2)."""
    d = np.linalg.norm(target - carrier)
    if d <= skip_m or len(defenders[0]) == 0:
        return 1.0
    s = np.linspace(skip_m, d, max(2, int(d / 0.25)))
    pts = carrier + (target - carrier) * (s / d)[:, None]
    t_ball = s / ball_speed
    t_def = time_to_intercept(defenders[0], defenders[1], pts).min(axis=0)
    return float(control_from_times(t_ball, t_def).min())


def safety_colour(p: float) -> tuple[int, int, int]:
    """Green (safe) through amber to red (likely intercepted), BGR."""
    stops = [(0.0, (60, 60, 235)), (0.5, (40, 190, 250)), (1.0, (110, 230, 90))]
    for (p0, c0), (p1, c1) in zip(stops, stops[1:], strict=False):
        if p <= p1:
            t = (p - p0) / (p1 - p0)
            return tuple(int(round(c0[i] + t * (c1[i] - c0[i]))) for i in range(3))
    return stops[-1][1]
