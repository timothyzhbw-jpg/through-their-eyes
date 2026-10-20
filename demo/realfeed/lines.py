"""Snap the projected pitch markings onto the painted lines in a frame.

Used twice: to turn a few rough hand clicks into many precise calibration points, and to re-align
the tracked camera on the lines every few frames so that drift cannot build up.

A painted line is a thin ridge of "yellowness" (Lab b* plus some lightness) on the turf; a
morphological top-hat isolates it. Each projected sample of a marking searches along the image
normal for the strongest ridge with turf on both sides. The far touchline is not painted in this
venue: the turf ends at a brick walkway, so it is snapped to that colour edge instead.
"""

from __future__ import annotations

import cv2
import numpy as np

from demo.realfeed.calibrate import Observation, fit_calibration
from demo.realfeed.geometry import apply_h, depth_sign
from demo.realfeed.overlay import grass_mask
from demo.realfeed.pitch import FutsalPitch

# Unpainted boundaries and a short step toward the pitch interior, in metres.
EDGE_FEATURES = {"far_touchline": (0.0, -0.5)}


def line_response(frame: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB).astype(np.float32)
    score = (lab[..., 2] - 128.0) + 0.3 * (lab[..., 0] - 128.0)
    # Wider than the widest line in view (about 18 px on the near touchline).
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    return cv2.morphologyEx(score, cv2.MORPH_TOPHAT, k)


def _sample(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    m = pts.astype(np.float32).reshape(-1, 1, 2)
    return cv2.remap(img, m[..., 0], m[..., 1], cv2.INTER_LINEAR, borderValue=0).ravel()


def snap(
    frame: np.ndarray,
    frame_name: str,
    h_img_from_world: np.ndarray,
    pitch: FutsalPitch,
    features: list[str],
    search_px: float = 12.0,
    spacing_px: float = 25.0,
    min_response: float = 2.0,
    response: np.ndarray | None = None,
    grass: np.ndarray | None = None,
) -> list[Observation]:
    """Observations of `features` found near their projection under `h_img_from_world`."""
    resp = line_response(frame) if response is None else response
    turf = (grass_mask(frame) if grass is None else grass).astype(np.float32)
    turf_s = cv2.GaussianBlur(turf, (0, 0), 1.5)
    h, w = frame.shape[:2]
    feats = pitch.features(step=0.05)
    out: list[Observation] = []
    # The profile always spans a full line width beyond the search radius, so a wide near line
    # is never cut off; only the peak itself must lie within `search_px` of the projection.
    reach = search_px + 16.0
    ts = np.arange(-reach, reach + 0.5, 0.5)
    within = np.abs(ts) <= search_px
    for name in features:
        poly = feats[name]
        poly = poly[depth_sign(h_img_from_world, poly) > 1e-6]
        if len(poly) < 2:
            continue
        img = apply_h(h_img_from_world, poly)
        # Resample the projected curve at a fixed spacing in pixels.
        seg = np.linalg.norm(np.diff(img, axis=0), axis=1)
        arc = np.concatenate([[0.0], np.cumsum(seg)])
        if arc[-1] < spacing_px:
            continue
        s = np.arange(spacing_px / 2, arc[-1], spacing_px)
        px = np.column_stack([np.interp(s, arc, img[:, 0]), np.interp(s, arc, img[:, 1])])
        tang = np.column_stack(
            [np.interp(s + 1, arc, img[:, 0]), np.interp(s + 1, arc, img[:, 1])]
        ) - np.column_stack([np.interp(s - 1, arc, img[:, 0]), np.interp(s - 1, arc, img[:, 1])])
        tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
        normal = np.column_stack([-tang[:, 1], tang[:, 0]])
        margin = reach + 6
        ok = (px[:, 0] > margin) & (px[:, 0] < w - margin)
        ok &= (px[:, 1] > margin) & (px[:, 1] < h - margin)
        for p, n in zip(px[ok], normal[ok], strict=True):
            prof_pts = p + ts[:, None] * n
            if name in EDGE_FEATURES:
                # Orient the normal toward the pitch, then find the steepest rise of turf share.
                q = apply_h(np.linalg.inv(h_img_from_world), p)[0]
                inside = apply_h(h_img_from_world, q + EDGE_FEATURES[name])[0] - p
                nn = n if n @ inside > 0 else -n
                d = np.gradient(_sample(turf_s, p + ts[:, None] * nn))
                k = int(np.argmax(np.where(within, d, -np.inf)))
                if d[k] < 0.08 or k in (0, len(ts) - 1):
                    continue
                out.append(Observation(frame_name, name, p + ts[k] * nn))
                continue
            r = _sample(resp, prof_pts)
            k = int(np.argmax(np.where(within, r, -np.inf)))
            if r[k] < min_response or k in (0, len(ts) - 1):
                continue
            # A painted line has turf on both sides; a yellow boot or a sock does not. Look just
            # beyond the ridge's half-maximum width (near lines are 10-15 px wide).
            above = r > 0.5 * r[k]
            lo, hi = k, k
            while lo > 0 and above[lo - 1]:
                lo -= 1
            while hi < len(ts) - 1 and above[hi + 1]:
                hi += 1
            gap = 3.0 + 0.5 * (ts[hi] - ts[lo])
            side = _sample(turf_s, np.array([p + (ts[lo] - gap) * n, p + (ts[hi] + gap) * n]))
            if side.min() < 0.6 or lo == 0 or hi == len(ts) - 1:
                continue
            # Sub-pixel peak by a parabola through the maximum and its neighbours.
            y0, y1, y2 = r[k - 1], r[k], r[k + 1]
            den = y0 - 2 * y1 + y2
            off = 0.5 * (y0 - y2) / den if abs(den) > 1e-9 else 0.0
            t = ts[k] + float(np.clip(off, -1, 1)) * (ts[1] - ts[0])
            out.append(Observation(frame_name, name, p + t * n))
    return out


def alignment_drift(
    frames,
    h_img_from_world: np.ndarray,
    pitch: FutsalPitch,
    features: list[str],
    every: int = 50,
    search_px: float = 12.0,
) -> list[dict]:
    """Measure camera-tracking drift against the painted lines, every `every` frames.

    For each sampled frame, the markings projected with the tracked homography are snapped onto
    the lines. `rms_tracked_px` is their misfit; `rms_refit_px` is the misfit after re-fitting
    the homography to the same points (pitch size fixed), i.e. the noise floor of the line
    detector. Their quadrature difference estimates the drift. (Correcting the track with these
    re-fits was tried and did not beat the tracker on held-out frames, so they only measure.)
    """
    ident = {"t": np.eye(3)}
    out = []
    for i, frame in enumerate(frames):
        if i % every and i != len(h_img_from_world) - 1:
            continue
        h = h_img_from_world[i]
        obs = snap(frame, "t", h, pitch, features, search_px=search_px, spacing_px=20.0)
        if len(obs) < 10:
            out.append({"frame": i, "points": len(obs)})
            continue
        before = fit_calibration(obs, ident, pitch, h, free=(), iterations=0).rms_px
        after = fit_calibration(obs, ident, pitch, h, free=()).rms_px
        out.append(
            {
                "frame": i,
                "points": len(obs),
                "rms_tracked_px": round(before, 2),
                "rms_refit_px": round(after, 2),
                "drift_px": round(float(np.sqrt(max(0.0, before**2 - after**2))), 2),
            }
        )
    return out
