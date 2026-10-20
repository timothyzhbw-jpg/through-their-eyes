"""Image-to-pitch calibration from hand-picked points on the markings.

Each observation is an image point known to lie on a named marking (a line, the centre circle,
the penalty area) or to be a named point (centre spot, a goalpost base). Points may come from
several frames of one camera shot; `frame_to_ref` holds each frame's homography into the
reference frame, as measured by the camera tracker. The fit solves for the reference frame's
image-from-world homography together with the pitch length, width and centre-circle radius by
Levenberg-Marquardt on image-space distances, so the residuals are reprojection errors in pixels.
The scale comes from the futsal penalty area (6 m radius) and the 3 m goals; the centre-circle
radius is left free as an independent check of that scale.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

from demo.realfeed.geometry import apply_h, depth_sign, fit_homography, normalise
from demo.realfeed.pitch import FutsalPitch

SIZE_PARAMS = ("length", "width", "centre_radius")


@dataclass(frozen=True)
class Observation:
    frame: str
    feature: str
    xy: np.ndarray


@dataclass
class Calibration:
    h_img_from_world: np.ndarray
    pitch: FutsalPitch
    rms_px: float
    residuals_px: np.ndarray
    per_feature_rms_px: dict[str, float] = field(default_factory=dict)
    frame_to_ref: dict[str, np.ndarray] = field(default_factory=dict)
    reference: str = "ref"


def _norm_matrix(pts: np.ndarray) -> np.ndarray:
    c = pts.mean(axis=0)
    s = 1.0 / max(np.abs(pts - c).max(), 1e-9)
    return np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1.0]])


def _closest_in_image(h_img_from_world: np.ndarray, poly: np.ndarray, pts: np.ndarray):
    """Closest point on the projected polyline (point-to-segment), one per query point."""
    front = depth_sign(h_img_from_world, poly) > 1e-6
    proj = apply_h(h_img_from_world, poly[front])
    if len(proj) == 0:
        return pts + 1e4  # the marking is behind the camera: a step the solver must reject
    d = ((pts[:, None, :] - proj[None, :, :]) ** 2).sum(axis=-1)
    i = np.argmin(d, axis=1)
    if len(proj) == 1:
        return proj[i]
    best = proj[i].copy()
    best_d = d[np.arange(len(pts)), i]
    for j0, j1 in ((i - 1, i), (i, i + 1)):
        ok = (j0 >= 0) & (j1 < len(proj))
        a = proj[np.clip(j0, 0, len(proj) - 1)]
        b = proj[np.clip(j1, 0, len(proj) - 1)]
        ab = b - a
        t = np.clip(((pts - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0, 1)
        q = a + t[:, None] * ab
        dq = ((pts - q) ** 2).sum(1)
        better = ok & (dq < best_d)
        best[better], best_d[better] = q[better], dq[better]
    return best


def initial_homography(observations: list[Observation], frame_to_ref, pitch: FutsalPitch):
    """DLT from the observations of point features (spots, posts, intersections)."""
    feats = pitch.features()
    world, img = [], []
    for o in observations:
        pt = feats[o.feature]
        if len(pt) == 1:
            world.append(pt[0])
            img.append(apply_h(frame_to_ref[o.frame], o.xy)[0])
    if len(world) < 4:
        raise ValueError("need at least four point features for the initial homography")
    return fit_homography(np.array(world), np.array(img))


def fit_calibration(
    observations: list[Observation],
    frame_to_ref: dict[str, np.ndarray],
    pitch0: FutsalPitch,
    h_guess: np.ndarray | None = None,
    free: tuple[str, ...] = SIZE_PARAMS,
    iterations: int = 200,
) -> Calibration:
    if h_guess is None:
        h_guess = initial_homography(observations, frame_to_ref, pitch0)
    groups: dict[tuple[str, str], list[np.ndarray]] = defaultdict(list)
    for o in observations:
        groups[(o.frame, o.feature)].append(np.asarray(o.xy, dtype=float).reshape(2))
    keys = sorted(groups)
    pts = {k: np.array(v) for k, v in groups.items()}
    ref_img = np.vstack([apply_h(frame_to_ref[k[0]], pts[k]) for k in keys])
    world_box = pitch0.polygon()
    t_img, t_world = _norm_matrix(ref_img), _norm_matrix(world_box)
    frame_from_ref = {f: np.linalg.inv(h) for f, h in frame_to_ref.items()}

    # Every marking counts the same however many points were snapped onto it.
    weight = {k: 1.0 / np.sqrt(len(pts[k])) for k in keys}

    def unpack(theta: np.ndarray) -> tuple[np.ndarray, FutsalPitch]:
        hn = np.append(theta[:8], 1.0).reshape(3, 3)
        h = np.linalg.inv(t_img) @ hn @ t_world
        sizes = {name: float(v) for name, v in zip(free, theta[8:], strict=True)}
        return normalise(h), replace(pitch0, **sizes)

    def raw_residuals(theta: np.ndarray) -> list[np.ndarray]:
        h, pitch = unpack(theta)
        feats = pitch.features(step=0.05)
        out = []
        for k in keys:
            h_f = frame_from_ref[k[0]] @ h
            out.append(pts[k] - _closest_in_image(h_f, feats[k[1]], pts[k]))
        return out

    def residuals(theta: np.ndarray) -> np.ndarray:
        return np.concatenate(
            [(r * weight[k]).ravel() for k, r in zip(keys, raw_residuals(theta), strict=True)]
        )

    hn0 = t_img @ h_guess @ np.linalg.inv(t_world)
    hn0 = hn0 / hn0[2, 2]
    theta = np.concatenate([hn0.ravel()[:8], [getattr(pitch0, n) for n in free]])
    r = residuals(theta)
    cost = r @ r
    lam = 1e-3
    for _ in range(iterations):
        jac = np.empty((len(r), len(theta)))
        for i in range(len(theta)):
            step = 1e-6 * max(1.0, abs(theta[i]))
            tp, tm = theta.copy(), theta.copy()
            tp[i] += step
            tm[i] -= step
            jac[:, i] = (residuals(tp) - residuals(tm)) / (2 * step)
        a = jac.T @ jac
        g = jac.T @ r
        cost_old = cost
        for _ in range(12):
            delta = np.linalg.solve(a + lam * np.diag(np.diag(a) + 1e-12), -g)
            cand = theta + delta
            rc = residuals(cand)
            if rc @ rc < cost:
                theta, r, cost = cand, rc, float(rc @ rc)
                lam = max(lam / 3, 1e-9)
                break
            lam *= 4
        else:
            break
        if cost_old - cost < 1e-10 * max(cost_old, 1e-12):
            break
    h, pitch = unpack(theta)
    per_point = np.linalg.norm(np.vstack(raw_residuals(theta)), axis=1)
    per_feature: dict[str, list[float]] = defaultdict(list)
    i = 0
    for k in keys:
        for _ in range(len(pts[k])):
            per_feature[k[1]].append(per_point[i])
            i += 1
    return Calibration(
        h_img_from_world=h,
        pitch=pitch,
        rms_px=float(np.sqrt(np.mean(per_point**2))),
        residuals_px=per_point,
        per_feature_rms_px={
            k: float(np.sqrt(np.mean(np.square(v)))) for k, v in per_feature.items()
        },
        frame_to_ref=frame_to_ref,
    )


def load_calibration(path: Path) -> Calibration:
    """Fit the committed calibration points (demo/realfeed/calibration.json)."""
    data = json.loads(Path(path).read_text())
    frame_to_ref = {
        name: np.array(f["ref_from_frame"], dtype=float) for name, f in data["frames"].items()
    }
    obs = [Observation(p["frame"], p["feature"], np.array(p["xy"], float)) for p in data["points"]]
    pitch0 = FutsalPitch(**data.get("pitch_initial", {}))
    guess = None
    if "seed" in data:
        world = np.array([s["world"] for s in data["seed"]], float)
        img = np.array([s["xy"] for s in data["seed"]], float)
        guess = fit_homography(world, img)
    free = tuple(data.get("free", SIZE_PARAMS))
    cal = fit_calibration(obs, frame_to_ref, pitch0, guess, free=free)
    cal.reference = data["reference_frame"]
    return cal
