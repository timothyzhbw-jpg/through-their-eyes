"""Stages of the real-footage overlay: camera, players, tracks. Results are cached in out/realfeed.

    uv run python -m demo.realfeed.pipeline        # camera track, detections, tracks, report

Each stage reads the clip again from the source file rather than holding 500 full-HD frames in
memory.
"""

from __future__ import annotations

import json
import pickle
from dataclasses import dataclass

import cv2
import numpy as np

from demo.realfeed.calibrate import Calibration, load_calibration
from demo.realfeed.clip import CLIP_FRAMES, CLIP_S, CLIP_START_S, FPS, OUT, SIZE, SOURCE
from demo.realfeed.clip import camera_track as _camera_track
from demo.realfeed.geometry import apply_h
from demo.realfeed.lines import alignment_drift
from demo.realfeed.overlay import grass_mask
from demo.realfeed.players import (
    BackgroundPlate,
    Detection,
    NearestNeighbourTracker,
    Track,
    classify_teams,
    detect,
    foreground,
    stitch,
)
from demo.realfeed.video import read_frames

CALIBRATION_JSON = OUT.parents[1] / "demo" / "realfeed" / "calibration.json"
DRIFT_FEATURES = ["near_touchline", "area_right", "goal_line_right", "far_touchline"]
SAMPLE_EVERY = 10  # frames between background samples
PLATE_EVERY = 50  # frames between background plates
PLATE_HALF_WINDOW = 200  # frames on each side of a plate
GOALKEEPER_HUE = (5.0, 22.0)  # orange shirt, OpenCV hue units


def frames():
    return read_frames(SOURCE, CLIP_START_S, CLIP_S, size=SIZE)


@dataclass
class Camera:
    calibration: Calibration
    h_img_from_world: np.ndarray  # (n, 3, 3), one per clip frame
    h_frame_from_ref: np.ndarray  # (n, 3, 3)


def camera(refresh: bool = False) -> Camera:
    cal = load_calibration(CALIBRATION_JSON)
    hs = _camera_track(SOURCE, refresh=refresh)[:CLIP_FRAMES]
    h = np.array([hh @ cal.h_img_from_world for hh in hs])
    return Camera(cal, h / h[:, 2:3, 2:3], hs)


def _plane(cam: Camera) -> tuple[np.ndarray, tuple[int, int]]:
    """Stabilised plane = the first frame's image plane, translated to hold every frame."""
    w, h = SIZE
    corners = np.array([[0, 0], [w, 0], [w, h], [0, h]], float)
    pts = np.vstack([apply_h(np.linalg.inv(hh), corners) for hh in cam.h_frame_from_ref])
    lo, hi = np.floor(pts.min(axis=0)) - 8, np.ceil(pts.max(axis=0)) + 8
    t = np.array([[1, 0, -lo[0]], [0, 1, -lo[1]], [0, 0, 1.0]])
    return t, (int(hi[0] - lo[0]), int(hi[1] - lo[1]))


def detections(cam: Camera, refresh: bool = False) -> list[list[Detection]]:
    path = OUT / "detections.pkl"
    if path.exists() and not refresh:
        return pickle.loads(path.read_bytes())
    t_plane, size = _plane(cam)
    plate = BackgroundPlate(size, scale=1.0)
    for i, f in enumerate(frames()):
        if i % SAMPLE_EVERY == 0:
            plate.add(i, f, t_plane @ np.linalg.inv(cam.h_frame_from_ref[i]))
    plates = {c: plate.median(c, PLATE_HALF_WINDOW) for c in range(0, CLIP_FRAMES, PLATE_EVERY)}
    pitch = cam.calibration.pitch

    def on_pitch(pts: np.ndarray) -> np.ndarray:
        # Substitutes and coaches stand on the far touchline: feet must be inside it there.
        return pitch.contains(pts, margin=0.4) & (pts[:, 1] < pitch.width / 2 - 0.15)

    out: list[list[Detection]] = []
    for i, f in enumerate(frames()):
        c = min(plates, key=lambda k: abs(k - i))
        h_plane = t_plane @ np.linalg.inv(cam.h_frame_from_ref[i])
        bg, ok = plate.into_frame(*plates[c], h_plane, f.shape[:2])
        # A goalkeeper who stands still melts into the median plate; his orange shirt does not.
        fg = (foreground(f, bg, ok) | goalkeeper_colour(f)) & ~grass_mask(f)
        fg = cv2.morphologyEx(
            fg.astype(np.uint8),
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 9)),
        ).astype(bool)
        out.append(detect(f, fg, cam.h_img_from_world[i], on_pitch))
        if i == 0:
            cv2.imwrite(str(OUT / "debug_fg_000.png"), fg.astype(np.uint8) * 255)
            cv2.imwrite(str(OUT / "debug_bg_000.png"), bg)
    path.write_bytes(pickle.dumps(out))
    return out


def goalkeeper_colour(frame: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    lo = np.array([GOALKEEPER_HUE[0], 130, 120], np.uint8)
    hi = np.array([GOALKEEPER_HUE[1], 255, 255], np.uint8)
    return cv2.inRange(hsv, lo, hi).astype(bool)


def assign_teams(dets: list[list[Detection]]) -> list[str]:
    """Cluster shirt hues over all detections; orange goalkeepers get their own label."""
    flat = [d for frame in dets for d in frame if not np.isnan(d.hue)]
    hue_sat = np.array([[d.hue, d.sat] for d in flat])
    labels, names = classify_teams(hue_sat, max_spread=10.0)
    for d, lab in zip(flat, labels, strict=True):
        if GOALKEEPER_HUE[0] <= d.hue <= GOALKEEPER_HUE[1]:
            d.team = 2
        else:
            d.team = int(lab)
    return [*names, "goalkeeper"]


def tracks(dets: list[list[Detection]]) -> list[Track]:
    tr = NearestNeighbourTracker(gate_m=0.8, max_missing=15)
    for i, frame in enumerate(dets):
        pts = np.array([d.foot_world for d in frame]).reshape(-1, 2)
        teams = np.array([d.team for d in frame], int)
        tr.update(i, pts, teams)
    return stitch(tr.finished(min_length=10), FPS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cam = camera(refresh=True)
    drift = alignment_drift(frames(), cam.h_img_from_world, cam.calibration.pitch, DRIFT_FEATURES)
    dets = detections(cam, refresh=True)
    names = assign_teams(dets)
    tr = tracks(dets)
    counts = [len(d) for d in dets]
    report = {
        "calibration": {
            "rms_px": round(cam.calibration.rms_px, 2),
            "length_m": round(float(cam.calibration.pitch.length), 2),
            "width_m": round(float(cam.calibration.pitch.width), 2),
            "centre_radius_m": round(float(cam.calibration.pitch.centre_radius), 2),
        },
        "drift": drift,
        "detections_per_frame": {
            "mean": round(float(np.mean(counts)), 2),
            "min": int(np.min(counts)),
            "max": int(np.max(counts)),
        },
        "team_names": names,
        "tracks": [
            {
                "id": t.id,
                "team": t.team(),
                "first": t.frames[0],
                "last": t.frames[-1],
                "detected": len(t.frames),
            }
            for t in tr
        ],  # fmt: skip
        "fps": FPS,
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != "tracks"}, indent=1))
    print(len(tr), "tracks")


if __name__ == "__main__":
    main()
