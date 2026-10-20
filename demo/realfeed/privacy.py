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
    frame: np.ndarray,
    keep: np.ndarray,
    darken: float = 0.5,
    feather_px: int = 0,
    factor: int = 16,
    desaturate: float = 0.0,
) -> np.ndarray:
    """Blur, desaturate and darken every pixel where `keep` is False; kept pixels are unchanged."""
    soft = strong_blur(frame, factor).astype(np.float32)
    if desaturate > 0:
        soft = soft * (1 - desaturate) + soft.mean(axis=-1, keepdims=True) * desaturate
    blurred = np.clip(soft * darken, 0, 255).astype(np.uint8)
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


def camera_matrix(h_img_from_world: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """3x4 projection from a ground homography, assuming square pixels and a centred principal
    point: the focal length follows from the two ground axes being orthogonal and equally long.
    Approximate (it sets the vertical scale); used only to place the goal in the frame."""
    cx, cy = size[0] / 2, size[1] / 2
    g = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1.0]]) @ h_img_from_world
    f = np.sqrt(abs(-(g[:2, 0] @ g[:2, 1]) / (g[2, 0] * g[2, 1])))
    k = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    m = np.linalg.inv(k) @ h_img_from_world
    m = m * 2.0 / (np.linalg.norm(m[:, 0]) + np.linalg.norm(m[:, 1]))
    if m[2, 2] < 0:
        m = -m
    return k @ np.column_stack([m[:, 0], m[:, 1], np.cross(m[:, 0], m[:, 1]), m[:, 2]])


def goal_frame_mask(
    frame: np.ndarray,
    h_img_from_world: np.ndarray,
    goal_line_x: float,
    half_width: float = 1.7,
    depth: float = 1.2,
    height: float = 2.4,
    slack_px: int = 25,
) -> np.ndarray:
    """Thin white pixels (posts, crossbar, net) inside the projected goal volume, grown by
    `slack_px`. Nothing else is kept: the crest painted on the wall behind the net stays blurred.
    """
    p = camera_matrix(h_img_from_world, (frame.shape[1], frame.shape[0]))
    corners = np.array(
        [[goal_line_x + dx, y, z, 1.0] for dx in (0.0, depth) for y in (-half_width, half_width)
         for z in (0.0, height)]
    ).T  # fmt: skip
    q = p @ corners
    if (q[2] <= 0).any():
        return np.zeros(frame.shape[:2], bool)
    pts = (q[:2] / q[2]).T.astype(np.float32)
    region = np.zeros(frame.shape[:2], np.uint8)
    cv2.fillConvexPoly(region, cv2.convexHull(pts).astype(np.int32), 1)
    region = cv2.dilate(region, np.ones((2 * slack_px + 1, 2 * slack_px + 1), np.uint8))
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    sat, val = hsv[..., 1], hsv[..., 2]
    # Thin bright structures (a top-hat drops the pale wall behind the goal) ...
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    thin = (cv2.morphologyEx(val, cv2.MORPH_TOPHAT, k) > 22) & (sat < 40) & (val > 140)
    thin &= region.astype(bool)
    # ... of which only long straight runs: posts, crossbar and the frame of the net. The crest
    # on the wall behind has pale stripes too, but they are short or curved.
    height_px = float(np.ptp(pts[:, 1]))
    segs = cv2.HoughLinesP(
        thin.astype(np.uint8) * 255, 1, np.pi / 180, threshold=30,
        minLineLength=max(25.0, 0.3 * height_px), maxLineGap=10,
    )  # fmt: skip
    lines = np.zeros(frame.shape[:2], np.uint8)
    width = max(3, round(height_px / 40))
    for x0, y0, x1, y1 in segs[:, 0] if segs is not None else []:
        cv2.line(lines, (int(x0), int(y0)), (int(x1), int(y1)), 1, width)
    return lines.astype(bool) & (val > 120) & (sat < 60)


def soften_heads(frame: np.ndarray, boxes, keep: np.ndarray) -> np.ndarray:
    """Gaussian-blur an ellipse over each head box (x, y, w, h); only `keep` pixels change."""
    out = frame.copy()
    hh, ww = frame.shape[:2]
    for x, y, w, h in boxes:
        x0, y0 = max(0, int(x - 0.3 * w)), max(0, int(y - 0.3 * h))
        x1, y1 = min(ww, int(x + 1.3 * w)), min(hh, int(y + 1.3 * h))
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        roi = frame[y0:y1, x0:x1]
        sigma = max(2.0, 0.22 * max(w, h))
        soft = cv2.GaussianBlur(roi, (0, 0), sigma)
        m = np.zeros(roi.shape[:2], np.float32)
        centre = (int(x + w / 2 - x0), int(y + h / 2 - y0))
        cv2.ellipse(m, centre, (max(1, int(w * 0.6)), max(1, int(h * 0.6))), 0, 0, 360, 1.0, -1)
        m = cv2.GaussianBlur(m, (0, 0), max(1.0, 0.15 * max(w, h)))
        m = np.clip(m * 1.6, 0, 1) * keep[y0:y1, x0:x1]
        out[y0:y1, x0:x1] = (roi * (1 - m[..., None]) + soft * m[..., None]).astype(np.uint8)
    return out


def kit_print_mask(frame: np.ndarray, region: np.ndarray, min_red_border: float = 0.6):
    """Light prints on the red kit (a company logo, numbers) inside `region`.

    A print is a light patch (white, or pinkish where red bleeds in) mostly bordered by red
    shirt. The ball, a sock or an arm touching a red player is bordered by turf or background
    as well, so it stays.
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    red = ((h >= 168) | (h <= 6)) & (s > 120) & (v > 80)
    light = ((s < 115) & (v > 165)).astype(np.uint8)
    light = cv2.morphologyEx(light, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
    n, lab, st, _ = cv2.connectedComponentsWithStats((light & region).astype(np.uint8), 8)
    out = np.zeros(frame.shape[:2], bool)
    k3 = np.ones((3, 3), np.uint8)
    for i in range(1, n):
        x, y, w, hh, area = st[i]
        if area < 4 or area > 4000:
            continue
        x0, y0 = max(0, x - 4), max(0, y - 4)
        comp = _fill_holes(lab[y0 : y + hh + 4, x0 : x + w + 4] == i)  # dark text inside a print
        ring = cv2.dilate(comp, k3, iterations=3).astype(bool) & ~comp.astype(bool)
        if ring.any() and red[y0 : y + hh + 4, x0 : x + w + 4][ring].mean() >= min_red_border:
            out[y0 : y + hh + 4, x0 : x + w + 4] |= comp.astype(bool)
    return cv2.dilate(out.astype(np.uint8), k3, iterations=2).astype(bool)


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """uint8 mask with enclosed holes filled (flood the outside from a padded border)."""
    padded = np.pad(mask.astype(np.uint8), 1)
    outside = padded.copy()
    ff = np.zeros((padded.shape[0] + 2, padded.shape[1] + 2), np.uint8)
    cv2.floodFill(outside, ff, (0, 0), 1)
    return ((padded == 1) | (outside == 0))[1:-1, 1:-1].astype(np.uint8)


def erase_prints(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill the masked pixels from their surroundings (the shirt colour), so a print is gone."""
    if not mask.any():
        return frame
    return cv2.inpaint(frame, mask.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)


def blur_boxes(frame: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
    """Pixelate-and-blur rectangles (x, y, w, h) in place."""
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
