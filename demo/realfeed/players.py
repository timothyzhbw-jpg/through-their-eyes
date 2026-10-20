"""Player positions from a moving broadcast camera, without a learned detector.

1. Every frame is warped into one stabilised plane (the reference frame's image plane, a fixed
   homography away from the top-down pitch view). For a camera that only pans, tilts and zooms
   this registers the whole scene, so a rolling median over time is a clean background plate.
2. The plate is warped back into the frame; pixels that differ from it are foreground.
3. Connected components with a plausible player size give the foot point (the lowest part of the
   blob), which the ground homography maps onto the pitch.
4. Shirt hue separates red shirts from sky-blue bibs (k-means on hue); a nearest-neighbour
   tracker links detections over time and smooths positions and velocities.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import cv2
import numpy as np

from demo.realfeed.geometry import apply_h

RED_HUE = 178.0  # OpenCV hue units (0-180)
BLUE_HUE = 104.0


@dataclass
class Detection:
    foot_img: np.ndarray  # (2,) pixels
    foot_world: np.ndarray  # (2,) metres
    bbox: tuple[int, int, int, int]  # x, y, w, h in pixels
    hue: float  # circular mean shirt hue, OpenCV units; nan if unsaturated
    sat: float
    team: int = -1
    silhouette: np.ndarray | None = None  # packed bool mask over bbox (np.packbits, axis 1)

    def mask(self) -> np.ndarray:
        """The player's foreground pixels inside `bbox`, (h, w) bool."""
        w = self.bbox[2]
        return np.unpackbits(self.silhouette, axis=1, count=w).astype(bool)


def _circ_mean_hue(h: np.ndarray, w: np.ndarray) -> float:
    ang = h.astype(np.float64) * (2 * np.pi / 180.0)
    c, s = (np.cos(ang) * w).sum(), (np.sin(ang) * w).sum()
    return float((np.arctan2(s, c) % (2 * np.pi)) * 180.0 / (2 * np.pi))


def _hue_dist(a: np.ndarray, b: float) -> np.ndarray:
    d = np.abs(np.asarray(a, float) - b) % 180.0
    return np.minimum(d, 180.0 - d)


def classify_teams(hue_sat: np.ndarray, max_spread: float = 12.0) -> tuple[np.ndarray, list[str]]:
    """Two-cluster k-means on shirt hue; returns labels (-1 = neither team) and cluster names."""
    hue_sat = np.asarray(hue_sat, float)
    ang = hue_sat[:, 0] * (2 * np.pi / 180.0)
    feats = np.column_stack([np.cos(ang), np.sin(ang)]).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 50, 1e-4)
    # Deterministic start: one centre at the red hue, one at the bib hue.
    init = np.array(
        [[np.cos(2 * np.pi * h / 180), np.sin(2 * np.pi * h / 180)] for h in (RED_HUE, BLUE_HUE)],
        np.float32,
    )
    labels = np.argmin(((feats[:, None, :] - init[None]) ** 2).sum(-1), axis=1).astype(np.int32)
    _, labels, centres = cv2.kmeans(
        feats, 2, labels.reshape(-1, 1), crit, 1, cv2.KMEANS_USE_INITIAL_LABELS
    )
    labels = labels.ravel()
    centre_hue = (np.arctan2(centres[:, 1], centres[:, 0]) % (2 * np.pi)) * 180 / (2 * np.pi)
    names = []
    for h in centre_hue:
        if _hue_dist(h, RED_HUE) < 20:
            names.append("red")
        elif _hue_dist(h, BLUE_HUE) < 20:
            names.append("blue")
        else:
            names.append("other")
    spread = _hue_dist(hue_sat[:, 0], 0.0)
    for k in range(2):
        spread[labels == k] = _hue_dist(hue_sat[labels == k, 0], centre_hue[k])
    return np.where(spread > max_spread, -1, labels), names


class BackgroundPlate:
    """Rolling temporal median of frames registered into one stabilised plane."""

    def __init__(self, size: tuple[int, int], scale: float = 0.5):
        self.size = size  # (w, h) of the stabilised plane at full resolution
        self.scale = scale
        self.samples: list[tuple[int, np.ndarray, np.ndarray]] = []

    def _s(self) -> np.ndarray:
        return np.diag([self.scale, self.scale, 1.0])

    def add(self, index: int, frame: np.ndarray, h_plane_from_frame: np.ndarray) -> None:
        w, h = round(self.size[0] * self.scale), round(self.size[1] * self.scale)
        hp = self._s() @ h_plane_from_frame
        warped = cv2.warpPerspective(frame, hp, (w, h), flags=cv2.INTER_AREA)
        valid = cv2.warpPerspective(
            np.full(frame.shape[:2], 255, np.uint8), hp, (w, h), flags=cv2.INTER_NEAREST
        )
        self.samples.append((index, warped, valid > 0))

    def median(self, centre: int, half_window: int) -> tuple[np.ndarray, np.ndarray]:
        """Median plate around frame `centre`, and where it has enough samples."""
        chosen = [s for s in self.samples if abs(s[0] - centre) <= half_window]
        stack = np.stack([s[1] for s in chosen]).astype(np.float32)
        valid = np.stack([s[2] for s in chosen])
        stack[~valid] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN columns off the plate
            med = np.nanmedian(stack, axis=0)
        ok = valid.sum(axis=0) >= max(3, len(chosen) // 3)
        med = np.nan_to_num(med, nan=0.0).astype(np.uint8)
        return med, ok

    def into_frame(
        self, plate: np.ndarray, ok: np.ndarray, h_plane_from_frame: np.ndarray, shape
    ) -> tuple[np.ndarray, np.ndarray]:
        hp = self._s() @ h_plane_from_frame
        h_frame_from_small = np.linalg.inv(hp)
        size = (shape[1], shape[0])
        bg = cv2.warpPerspective(plate, h_frame_from_small, size, flags=cv2.INTER_LINEAR)
        m = cv2.warpPerspective(
            ok.astype(np.uint8) * 255, h_frame_from_small, size, flags=cv2.INTER_NEAREST
        )
        return bg, m > 0


def foreground(frame: np.ndarray, bg: np.ndarray, valid: np.ndarray, thresh: float = 30.0):
    """Foreground mask from the colour distance to the background plate (Lab)."""
    a = cv2.cvtColor(cv2.GaussianBlur(frame, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(cv2.GaussianBlur(bg, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    d = a - b
    dist = np.sqrt(0.5 * d[..., 0] ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)
    fg = (dist > thresh) & valid
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 11))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, close)
    return fg.astype(bool)


def horizontal_scale(h_img_from_world: np.ndarray, world_pt: np.ndarray) -> float:
    """Pixels per metre across the image at a ground point (largest singular value)."""
    p = np.asarray(world_pt, dtype=float)
    eps = 0.05
    img = apply_h(h_img_from_world, np.array([p, p + [eps, 0], p + [0, eps]]))
    j = np.column_stack([img[1] - img[0], img[2] - img[0]]) / eps
    return float(np.linalg.svd(j, compute_uv=False)[0])


def _split_columns(blob: np.ndarray, max_parts: int) -> list[tuple[int, int]]:
    """Split a blob of side-by-side players at the deepest valleys of its column profile."""
    w = blob.shape[1]
    if max_parts <= 1 or w < 8:
        return [(0, w)]
    prof = cv2.GaussianBlur(blob.sum(axis=0).astype(np.float32)[None], (0, 0), max(1.0, w / 30))[0]
    lo, hi = int(w * 0.25), int(w * 0.75)
    k = lo + int(np.argmin(prof[lo:hi]))
    left_peak, right_peak = prof[:k].max(), prof[k:].max()
    if prof[k] > 0.55 * min(left_peak, right_peak):
        return [(0, w)]
    left = _split_columns(blob[:, :k], max_parts - 1)
    right = _split_columns(blob[:, k:], max_parts - 1)
    return left + [(a + k, b + k) for a, b in right]


def detect(
    frame: np.ndarray,
    fg: np.ndarray,
    h_img_from_world: np.ndarray,
    on_pitch,
    min_height_m: float = 1.0,
    max_height_m: float = 2.8,
    person_width_m: float = 0.75,
) -> list[Detection]:
    """Player detections from a foreground mask; `on_pitch(world_pts)` filters foot points.

    Heights are compared with the image's horizontal scale at the foot point, which for an
    upright person is close to the vertical scale. Blobs wider than one person are split at the
    valleys of their column profile (two or three players overlapping in the image).
    """
    h_world_from_img = np.linalg.inv(h_img_from_world)
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg.astype(np.uint8), 8)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    out = []
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if area < 40:
            continue
        blob_all = lab[y : y + h, x : x + w] == i
        bottom_all = np.nonzero(blob_all.any(axis=1))[0][-1]
        guess = apply_h(h_world_from_img, [[x + w / 2.0, y + bottom_all]])[0]
        s_h = horizontal_scale(h_img_from_world, guess)
        parts = _split_columns(blob_all, min(3, int(w / (person_width_m * s_h)) + 0))
        for c0, c1 in parts:
            blob = blob_all[:, c0:c1]
            rows = np.nonzero(blob.any(axis=1))[0]
            if len(rows) == 0:
                continue
            top, bottom = rows[0], rows[-1]
            bh = bottom - top + 1
            band = blob[max(0, bottom - max(2, bh // 12)) : bottom + 1]
            cols = np.nonzero(band.any(axis=0))[0]
            foot_img = np.array([x + c0 + cols.mean(), y + bottom])
            foot = apply_h(h_world_from_img, foot_img)[0]
            if not on_pitch(foot[None])[0]:
                continue
            s_h = horizontal_scale(h_img_from_world, foot)
            if not (min_height_m * s_h <= bh <= max_height_m * s_h):
                continue
            # Shirt: rows 18-50 % from the top of the person, saturated pixels only.
            t0 = top + int(bh * 0.18)
            t1 = max(top + int(bh * 0.5), t0 + 2)
            torso = blob[t0:t1]
            hh = hsv[y + t0 : y + t1, x + c0 : x + c1]
            sel = torso & (hh[..., 1] > 90) & (hh[..., 2] > 70)
            if sel.sum() >= 6:
                hue = _circ_mean_hue(hh[..., 0][sel], np.ones(sel.sum()))
                sat = float(hh[..., 1][sel].mean())
            else:
                hue, sat = float("nan"), 0.0
            box = (int(x + c0), int(y + top), int(c1 - c0), int(bh))
            sil = np.packbits(blob[top : bottom + 1], axis=1)
            out.append(Detection(foot_img, foot, box, hue, sat, silhouette=sil))
    return out


@dataclass
class Track:
    id: int
    frames: list[int] = field(default_factory=list)
    points: list[np.ndarray] = field(default_factory=list)
    teams: list[int] = field(default_factory=list)
    missing: int = 0

    @property
    def last(self) -> np.ndarray:
        return self.points[-1]

    def predict(self, frame: int) -> np.ndarray:
        if len(self.points) < 3:
            return self.last
        k = min(len(self.points) - 1, 8)
        v = (self.points[-1] - self.points[-1 - k]) / (self.frames[-1] - self.frames[-1 - k])
        return self.last + v * (frame - self.frames[-1])

    def team(self) -> int:
        known = [t for t in self.teams if t >= 0]
        if not known:
            return -1
        vals, counts = np.unique(known, return_counts=True)
        return int(vals[np.argmax(counts)])

    def dense(self) -> tuple[np.ndarray, np.ndarray]:
        """Frames from first to last with gaps linearly interpolated: (frames, (n, 2))."""
        f = np.array(self.frames)
        p = np.array(self.points)
        full = np.arange(f[0], f[-1] + 1)
        xy = np.column_stack([np.interp(full, f, p[:, 0]), np.interp(full, f, p[:, 1])])
        return full, xy

    def smoothed(self, window: int = 9) -> tuple[np.ndarray, np.ndarray]:
        full, xy = self.dense()
        if len(full) < 3:
            return full, xy
        w = min(window, len(full) - (1 - len(full) % 2))
        w = max(1, w | 1)
        pad = w // 2
        padded = np.pad(xy, ((pad, pad), (0, 0)), mode="edge")
        k = np.ones(w) / w
        sm = np.column_stack([np.convolve(padded[:, i], k, mode="valid") for i in range(2)])
        return full, sm

    def velocity(self, fps: float, window: int = 9, lag: int = 6) -> np.ndarray:
        full, sm = self.smoothed(window)
        n = len(full)
        if n < 2:
            return np.zeros((n, 2))
        idx = np.arange(n)
        a = np.clip(idx - lag, 0, n - 1)
        b = np.clip(idx + lag, 0, n - 1)
        dt = (b - a) / fps
        return (sm[b] - sm[a]) / np.where(dt > 0, dt, 1.0)[:, None]


class NearestNeighbourTracker:
    """Greedy nearest-neighbour data association with a gate in metres."""

    def __init__(self, gate_m: float = 1.0, max_missing: int = 12):
        self.gate = gate_m
        self.max_missing = max_missing
        self.active: list[Track] = []
        self.done: list[Track] = []
        self._next = 0

    def update(self, frame: int, pts: np.ndarray, teams: np.ndarray) -> list[int]:
        """Associate this frame's detections; returns the track id for each detection."""
        pts = np.asarray(pts, float).reshape(-1, 2)
        ids = [-1] * len(pts)
        pairs = []
        for ti, tr in enumerate(self.active):
            pred = tr.predict(frame)
            gate = self.gate * (1 + 0.5 * tr.missing)
            for di in range(len(pts)):
                d = float(np.linalg.norm(pts[di] - pred))
                t_team = tr.team()
                if t_team >= 0 and teams[di] >= 0 and t_team != teams[di]:
                    continue
                if d <= gate:
                    pairs.append((d, ti, di))
        pairs.sort()
        used_t, used_d = set(), set()
        for _, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            tr = self.active[ti]
            tr.frames.append(frame)
            tr.points.append(pts[di])
            tr.teams.append(int(teams[di]))
            tr.missing = 0
            ids[di] = tr.id
        keep = []
        for ti, tr in enumerate(self.active):
            if ti not in used_t:
                tr.missing += 1
            (keep if tr.missing <= self.max_missing else self.done).append(tr)
        self.active = keep
        for di in range(len(pts)):
            if di not in used_d:
                tr = Track(self._next, [frame], [pts[di]], [int(teams[di])])
                self._next += 1
                self.active.append(tr)
                ids[di] = tr.id
        return ids

    def finished(self, min_length: int = 1) -> list[Track]:
        tracks = self.done + self.active
        return [t for t in tracks if len(t.frames) >= min_length]


def stitch(
    tracks: list[Track],
    fps: float,
    max_gap_s: float = 1.2,
    base_m: float = 1.0,
    speed_m_s: float = 3.0,
    min_length: int = 25,
) -> list[Track]:
    """Join track fragments: a track that ends is continued by one that starts soon after,
    close to where the first was heading and with a compatible team. Greedy by cost."""
    tracks = sorted(tracks, key=lambda t: t.frames[0])
    joined = True
    while joined:
        joined = False
        best = None
        for a in tracks:
            fa = a.frames[-1]
            for b in tracks:
                fb = b.frames[0]
                gap = (fb - fa) / fps
                if b is a or not 0 < gap <= max_gap_s:
                    continue
                ta, tb = a.team(), b.team()
                if ta >= 0 and tb >= 0 and ta != tb:
                    continue
                d = float(np.linalg.norm(b.points[0] - a.predict(fb)))
                if d > base_m + speed_m_s * gap:
                    continue
                cost = d + gap
                if best is None or cost < best[0]:
                    best = (cost, a, b)
        if best is not None:
            _, a, b = best
            a.frames += b.frames
            a.points += b.points
            a.teams += b.teams
            tracks.remove(b)
            joined = True
    return [t for t in tracks if len(t.frames) >= min_length]
