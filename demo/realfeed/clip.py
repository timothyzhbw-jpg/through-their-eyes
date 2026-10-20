"""The clip we overlay, and the camera track that links its frames.

Source times are in seconds of the original upload. The clip is one continuous shot of the right
half: wide at first, then a slow zoom toward the goal. Its first frame shows the edge of the
centre circle, the whole penalty area, both goalposts and both touchlines, so it is calibrated
directly; later frames are linked to it by the camera tracker. (Calibrating on a frame after a
fast pan was tried and rejected: the tracked homography drifts by tens of pixels across a pan.)
Frame indices below count from CLIP_START_S at the source rate.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from demo.realfeed.camera import TrackerParams, track_sequence
from demo.realfeed.download import FILENAME, SOURCE_DIR
from demo.realfeed.overlay import grass_mask
from demo.realfeed.video import read_frames

ROOT = Path(__file__).parents[2]
OUT = ROOT / "out" / "realfeed"
SOURCE = SOURCE_DIR / FILENAME

FPS = 50.0
CLIP_START_S = 946.0  # 15:46.0, wide shot of the right half; also the calibration frame
CLIP_S = 10.0
TRACK_S = CLIP_S
SIZE = (1920, 1080)
TRACK_SCALE = 0.5  # camera tracking runs on half-resolution frames

CLIP_FRAMES = round(CLIP_S * FPS)


def tracking_mask(frame_small: np.ndarray) -> np.ndarray:
    """Where to look for camera-motion features: turf and its painted lines, off the players."""
    g = grass_mask(frame_small).astype(np.uint8)
    g = cv2.morphologyEx(g, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    return cv2.erode(g, np.ones((7, 7), np.uint8)).astype(bool)


def track_camera(source: Path = SOURCE) -> tuple[np.ndarray, list[dict]]:
    """Full-resolution homographies frame_t <- clip start, one per clip frame."""
    w, h = round(SIZE[0] * TRACK_SCALE), round(SIZE[1] * TRACK_SCALE)
    small = list(read_frames(source, CLIP_START_S, TRACK_S, size=(w, h)))
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in small]
    stats: list[dict] = []
    hs = track_sequence(grays, [tracking_mask(f) for f in small], TrackerParams(), stats)
    s = np.diag([1 / TRACK_SCALE, 1 / TRACK_SCALE, 1.0])
    full = np.array([s @ hh @ np.linalg.inv(s) for hh in hs])
    return full / full[:, 2:3, 2:3], stats


def camera_track(source: Path = SOURCE, refresh: bool = False) -> np.ndarray:
    """Cached `track_camera` (out/realfeed/camera_track.npy)."""
    path = OUT / "camera_track.npy"
    if path.exists() and not refresh:
        return np.load(path)
    hs, _ = track_camera(source)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, hs)
    return hs


def frame_at(index: int, source: Path = SOURCE) -> np.ndarray:
    """One full-resolution frame by clip index."""
    return next(read_frames(source, CLIP_START_S + index / FPS, 1.0 / FPS, size=SIZE))
