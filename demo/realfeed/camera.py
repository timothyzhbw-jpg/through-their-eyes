"""Camera motion tracking: pyramidal Lucas-Kanade flow on the ground, RANSAC homographies.

A pan-tilt-zoom camera on a tripod moves every ground point by one homography per frame. Rather
than multiplying frame-to-frame homographies (whose errors add up), each frame is registered
against the current keyframe, using the previous estimate as the initial flow, and the chain only
grows when the keyframe is replaced. A forward-backward check drops points on moving players.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class TrackerParams:
    max_corners: int = 800
    quality: float = 0.002
    min_distance: int = 9
    block: int = 7
    win: int = 21
    levels: int = 4
    fb_max_px: float = 0.7
    ransac_px: float = 1.0
    keyframe_keep: float = 0.55  # replace the keyframe below this share of inliers
    keyframe_max_age: int = 75  # frames
    min_inliers: int = 25


@dataclass
class _Keyframe:
    index: int
    image: np.ndarray
    pts: np.ndarray  # (N, 1, 2) float32
    h_from_first: np.ndarray  # keyframe <- frame 0


def _detect(gray: np.ndarray, mask: np.ndarray | None, p: TrackerParams) -> np.ndarray:
    m = None if mask is None else mask.astype(np.uint8) * 255
    pts = cv2.goodFeaturesToTrack(
        gray, p.max_corners, p.quality, p.min_distance, mask=m, blockSize=p.block
    )
    if pts is None:
        return np.empty((0, 1, 2), np.float32)
    return pts.astype(np.float32)


def _lk(a, b, pts, guess, p: TrackerParams):
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)
    kw = dict(winSize=(p.win, p.win), maxLevel=p.levels, criteria=crit)
    fwd, st1, _ = cv2.calcOpticalFlowPyrLK(
        a, b, pts, guess.copy(), flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **kw
    )
    back, st2, _ = cv2.calcOpticalFlowPyrLK(
        b, a, fwd, pts.copy(), flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **kw
    )
    fb = np.linalg.norm((back - pts).reshape(-1, 2), axis=1)
    ok = (st1.ravel() == 1) & (st2.ravel() == 1) & (fb < p.fb_max_px)
    return fwd, ok


def _apply(h: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return cv2.perspectiveTransform(pts.astype(np.float64), h).astype(np.float32)


def register(
    key: _Keyframe, gray: np.ndarray, h_guess: np.ndarray, p: TrackerParams
) -> tuple[np.ndarray | None, int]:
    """Homography frame <- keyframe, refined from `h_guess`; None when registration fails."""
    if len(key.pts) < p.min_inliers:
        return None, 0
    guess = _apply(h_guess, key.pts)
    fwd, ok = _lk(key.image, gray, key.pts, guess, p)
    if ok.sum() < p.min_inliers:
        return None, int(ok.sum())
    src, dst = key.pts[ok].reshape(-1, 2), fwd[ok].reshape(-1, 2)
    h, inl = cv2.findHomography(src, dst, cv2.RANSAC, p.ransac_px, maxIters=2000, confidence=0.999)
    if h is None:
        return None, 0
    inl = inl.ravel().astype(bool)
    if inl.sum() >= 8:
        # Least-squares refit on the inliers only.
        h, _ = cv2.findHomography(src[inl], dst[inl], 0)
    return h / h[2, 2], int(inl.sum())


def track_sequence(
    frames: Iterable[np.ndarray],
    masks: Iterable[np.ndarray | None] | None = None,
    params: TrackerParams = TrackerParams(),
    stats: list[dict] | None = None,
) -> list[np.ndarray]:
    """Homographies frame_t <- frame_0 for a sequence of grayscale frames.

    `masks` (optional, one per frame) restricts feature detection, e.g. to grass and lines.
    `stats`, when given, receives one dict per frame with the inlier count and keyframe index.
    """
    out: list[np.ndarray] = []
    key: _Keyframe | None = None
    h_key = np.eye(3)  # frame <- keyframe, last estimate
    velocity = np.eye(3)
    mask_iter = iter(masks) if masks is not None else None
    for i, gray in enumerate(frames):
        mask = next(mask_iter) if mask_iter is not None else None
        if key is None:
            key = _Keyframe(i, gray, _detect(gray, mask, params), np.eye(3))
            out.append(np.eye(3))
            if stats is not None:
                stats.append({"frame": i, "inliers": len(key.pts), "keyframe": i})
            continue
        guess = velocity @ h_key
        h, n_in = register(key, gray, guess, params)
        if h is None:
            # Fall back to the prediction and start a new keyframe here.
            h = guess
        prev = h_key
        h_key = h
        velocity = h_key @ np.linalg.inv(prev)
        h_t = h_key @ key.h_from_first
        out.append(h_t / h_t[2, 2])
        if stats is not None:
            stats.append({"frame": i, "inliers": n_in, "keyframe": key.index})
        too_old = i - key.index >= params.keyframe_max_age
        if n_in < params.keyframe_keep * len(key.pts) or too_old:
            # The frame-to-frame velocity carries over: it does not depend on the keyframe.
            key = _Keyframe(i, gray, _detect(gray, mask, params), out[-1])
            h_key = np.eye(3)
    return out
