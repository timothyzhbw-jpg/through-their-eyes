"""Masking: everything outside the pitch is blurred and darkened; faces on the pitch are blurred.

The pitch outline is projected from world coordinates into each frame, so banners, crests,
sponsor boards, spectators and buildings beyond the touchlines are covered in one pass.
"""

from __future__ import annotations

import cv2
import numpy as np

from demo.realfeed.geometry import apply_h, depth_sign


def _clip_in_front(h: np.ndarray, poly: np.ndarray, eps: float = 1e-3) -> np.ndarray:
    """Sutherland-Hodgman clip of a world polygon to the half-plane in front of the camera."""
    w = depth_sign(h, poly)
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        wa, wb = w[i], w[(i + 1) % n]
        if wa > eps:
            out.append(a)
        if (wa > eps) != (wb > eps):
            t = (eps - wa) / (wb - wa)
            out.append(a + t * (b - a))
    return np.array(out) if out else np.empty((0, 2))


def polygon_mask(
    h_img_from_world: np.ndarray, polygon_world: np.ndarray, shape: tuple[int, int]
) -> np.ndarray:
    """Boolean image mask of a ground polygon (e.g. the pitch outline) seen through h."""
    poly = _densify(np.asarray(polygon_world, float), 0.5)
    poly = _clip_in_front(h_img_from_world, poly)
    mask = np.zeros(shape, np.uint8)
    if len(poly) >= 3:
        img = apply_h(h_img_from_world, poly)
        # Keep far-away vertices finite for the rasteriser.
        img = np.clip(img, -1e5, 1e5)
        cv2.fillPoly(mask, [np.round(img * 16).astype(np.int32)], 1, cv2.LINE_8, shift=4)
    return mask.astype(bool)


def _densify(poly: np.ndarray, step: float) -> np.ndarray:
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        n = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        out.append(a + np.linspace(0, 1, n, endpoint=False)[:, None] * (b - a))
    return np.vstack(out)


def strong_blur(frame: np.ndarray, factor: int = 16, sigma: float = 3.0) -> np.ndarray:
    """Downsample, blur and upsample: removes all detail at the scale of text and faces."""
    h, w = frame.shape[:2]
    size = (max(1, w // factor), max(1, h // factor))
    small = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), sigma)
    big = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.GaussianBlur(big, (0, 0), factor / 2)


def blur_outside(
    frame: np.ndarray, keep: np.ndarray, darken: float = 0.5, feather_px: int = 0
) -> np.ndarray:
    """Blur and darken every pixel where `keep` is False; kept pixels are returned unchanged."""
    blurred = (strong_blur(frame).astype(np.float32) * darken).astype(np.uint8)
    if feather_px <= 0:
        out = blurred.copy()
        out[keep] = frame[keep]
        return out
    # Soft edge that only ever reaches outward from the kept region.
    dist = cv2.distanceTransform((~keep).astype(np.uint8), cv2.DIST_L2, 3)
    a = np.clip(1.0 - dist / feather_px, 0.0, 1.0)[..., None]
    out = (a * frame + (1.0 - a) * blurred).astype(np.uint8)
    out[keep] = frame[keep]
    return out


def blur_boxes(frame: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
    """Pixelate-and-blur rectangles (x, y, w, h) in place, e.g. faces on the pitch."""
    hh, ww = frame.shape[:2]
    for x, y, w, h in boxes:
        x0, y0 = max(0, int(x)), max(0, int(y))
        x1, y1 = min(ww, int(x + w)), min(hh, int(y + h))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        roi = frame[y0:y1, x0:x1]
        small = cv2.resize(roi, (max(1, (x1 - x0) // 6), max(1, (y1 - y0) // 6)), cv2.INTER_AREA)
        roi[:] = cv2.GaussianBlur(cv2.resize(small, (x1 - x0, y1 - y0)), (0, 0), 2.0)
    return frame
