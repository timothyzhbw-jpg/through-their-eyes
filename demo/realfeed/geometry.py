"""Planar homography helpers (numpy only)."""

from __future__ import annotations

import numpy as np


def apply_h(h: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Map (N, 2) points through a 3x3 homography."""
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    q = np.column_stack([pts, np.ones(len(pts))]) @ np.asarray(h, dtype=float).T
    return q[:, :2] / q[:, 2:3]


def depth_sign(h: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Homogeneous scale of each mapped point; positive means in front of the camera."""
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    return np.column_stack([pts, np.ones(len(pts))]) @ np.asarray(h, dtype=float)[2]


def _normaliser(pts: np.ndarray) -> np.ndarray:
    c = pts.mean(axis=0)
    d = np.sqrt(((pts - c) ** 2).sum(axis=1)).mean()
    s = np.sqrt(2.0) / max(d, 1e-12)
    return np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1.0]])


def fit_homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Normalised DLT: the homography mapping src (N >= 4, 2) to dst, least squares."""
    src = np.asarray(src, dtype=float)
    dst = np.asarray(dst, dtype=float)
    ts, td = _normaliser(src), _normaliser(dst)
    s = apply_h(ts, src)
    d = apply_h(td, dst)
    rows = []
    for (x, y), (u, v) in zip(s, d, strict=True):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    _, _, vt = np.linalg.svd(np.asarray(rows))
    hn = vt[-1].reshape(3, 3)
    h = np.linalg.inv(td) @ hn @ ts
    return normalise(h)


def normalise(h: np.ndarray) -> np.ndarray:
    """Scale a homography so that h[2, 2] == 1 (keeps the sign convention of depth_sign)."""
    return h / h[2, 2]


def local_scale(h_img_from_world: np.ndarray, world_pt: np.ndarray) -> float:
    """Image pixels per metre around a ground point (geometric mean of the Jacobian)."""
    p = np.asarray(world_pt, dtype=float)
    eps = 0.05
    pts = np.array([p, p + [eps, 0], p + [0, eps]])
    img = apply_h(h_img_from_world, pts)
    j = np.column_stack([img[1] - img[0], img[2] - img[0]]) / eps
    return float(np.sqrt(abs(np.linalg.det(j))))
