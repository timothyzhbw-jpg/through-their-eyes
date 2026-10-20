"""Frame-by-frame checks on the exported segment (SPEC 7, real-footage overlay).

    uv run python -m demo.realfeed.check

Every exported frame is compared with the source frame it shows:

- Off-pitch masking. Pixels outside the kept set (the pitch, the players standing on it, the goal
  frame) must hold no legible detail. Detail is measured at two scales: `fine` (Laplacian,
  single-pixel detail) and `letter` (band-pass between Gaussian scales 1.5 and 4.5 px, the stroke
  width of the board lettering here). For each, the export is regressed on the source over the
  off-pitch pixels: the gain is the share of the source's detail that survives in place. Text
  needs its strokes, so it cannot be read at a gain near zero; H.264 noise in the export is not
  correlated with the source and does not count, unlike in a plain energy ratio. The letter
  gain is also measured inside every board and crest in view (REGIONS, tracked from the first
  frame with the camera homography).
- Faces, only when render.BLUR_FACES is on (Bowen decided against blurring them on 2026-10-19):
  OpenCV's Haar cascades find faces in the source frame; the export must not keep their detail.
- Label and attribution: legible white text in the bottom-left panel of every frame.

Side-by-side source | export crops of every region at four moments go to out/realfeed/legibility
for the manual frame-by-frame review, which these checks do not replace.
"""

from __future__ import annotations

import json
import pickle

import cv2
import numpy as np

from demo.realfeed.clip import CLIP_START_S, FPS, OUT, SIZE, SOURCE
from demo.realfeed.geometry import apply_h
from demo.realfeed.pipeline import camera
from demo.realfeed.render import (
    BACKGROUND,
    BLUR_FACES,
    CARRIER_FRAME,
    FREEZE_FRAMES,
    KEYFRAME,
    START,
    VIDEO,
    head_boxes,
    hud,
    keep_mask,
)
from demo.realfeed.video import read_frames

# Boards and crests beyond the touchlines, read off the clip's first frame (x0, y0, x1, y1).
REGIONS = {
    "board VETEK 1": (360, 295, 440, 335),
    "board VETEK 2": (605, 305, 700, 360),
    "board VETEK 3": (800, 315, 930, 375),
    "board FC METALIST text": (950, 315, 1095, 340),
    "board V logo": (1100, 325, 1200, 395),
    "crest on fence 1": (735, 320, 765, 365),
    "crest on fence 2": (990, 335, 1025, 380),
    "crest on dugout 1": (1495, 350, 1570, 450),
    "crest on dugout 2": (1825, 360, 1920, 485),
}
MAX_FINE = 0.05  # at most 5 % of the source's single-pixel detail survives off the pitch
MAX_LETTER = 0.10  # ... and at most 10 % of its letter-stroke detail, also inside each region
REVIEW_FRAMES = (0, 170, CARRIER_FRAME - START, 498)
CASCADES = ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml")


def source_index(k: int) -> int:
    """Clip frame shown at output frame k (the freeze repeats CARRIER_FRAME)."""
    i = START + k
    if i <= CARRIER_FRAME:
        return i
    return max(CARRIER_FRAME, i - (FREEZE_FRAMES - 1))


def _gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)


def band(gray: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(gray, (0, 0), 1.5) - cv2.GaussianBlur(gray, (0, 0), 4.5)


def gain(src: np.ndarray, out: np.ndarray) -> float:
    """Least-squares gain of `out` on `src` (both 1-D): the share of the source signal kept."""
    a, b = src - src.mean(), out - out.mean()
    den = float(a @ a)
    return float(a @ b / den) if den > 0 else 0.0


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a - a.mean(), b - b.mean()
    den = float(np.sqrt((a @ a) * (b @ b)))
    return float(a @ b / den) if den > 0 else 0.0


def _faces(gray_u8: np.ndarray, detectors) -> list[tuple[int, int, int, int]]:
    out = []
    for det in detectors:
        for flip in (False, True):  # the profile cascade only finds faces turned one way
            img = cv2.flip(gray_u8, 1) if flip else gray_u8
            for x, y, w, h in det.detectMultiScale(img, 1.1, 5, minSize=(14, 14)):
                out.append((int(gray_u8.shape[1] - x - w if flip else x), int(y), int(w), int(h)))
    return out


def main() -> None:
    cam = camera()
    dets = pickle.loads((OUT / "detections.pkl").read_bytes())
    pitch = cam.calibration.pitch
    blank = np.zeros((SIZE[1], SIZE[0], 3), np.uint8)
    label_box = hud(blank.copy(), freeze=False)[0]
    hud_boxes = hud(blank.copy(), freeze=True, share=0.5)  # every panel that can appear
    grow = 2 * BACKGROUND["feather_px"] + 5  # the feathered rim reaches this far outward
    review = OUT / "legibility"
    review.mkdir(parents=True, exist_ok=True)
    for old in review.glob("*.png"):
        old.unlink()
    detectors = (
        [cv2.CascadeClassifier(cv2.data.haarcascades + c) for c in CASCADES] if BLUR_FACES else []
    )
    source = enumerate(read_frames(SOURCE, CLIP_START_S, 10.0, size=SIZE))
    src_i, src = next(source)
    fine, letter, label_ok, n_out = [], [], 0, 0
    region_gain = {name: 0.0 for name in REGIONS}
    region_seen = {name: 0 for name in REGIONS}
    faces_checked, faces_kept = 0, 0
    for k, frame in enumerate(read_frames(VIDEO, 0.0, 60.0, size=SIZE)):
        n_out += 1
        while src_i < source_index(k):
            src_i, src = next(source)
        i = src_i
        _, keep = keep_mask(src, cam.h_img_from_world[i], pitch, dets[i])
        outside = cv2.erode((~keep).astype(np.uint8), np.ones((grow, grow), np.uint8)) > 0
        for x, y, w, h in hud_boxes:  # panels and their anti-aliased rim
            outside[max(0, y - 3) : y + h + 3, max(0, x - 3) : x + w + 3] = False
        g_src, g_out = _gray(src), _gray(frame)
        b_src, b_out = band(g_src), band(g_out)
        lap_src = cv2.Laplacian(g_src, cv2.CV_32F)
        lap_out = cv2.Laplacian(g_out, cv2.CV_32F)
        fine.append(gain(lap_src[outside], lap_out[outside]))
        letter.append(gain(b_src[outside], b_out[outside]))
        for name, (x0, y0, x1, y1) in REGIONS.items():
            quad = apply_h(cam.h_frame_from_ref[i], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
            qx0, qy0 = np.clip(np.floor(quad.min(axis=0)), 0, [SIZE[0], SIZE[1]]).astype(int)
            qx1, qy1 = np.clip(np.ceil(quad.max(axis=0)), 0, [SIZE[0], SIZE[1]]).astype(int)
            m = outside[qy0:qy1, qx0:qx1]
            if m.sum() < 150:
                continue  # out of view or covered by a player
            g = gain(b_src[qy0:qy1, qx0:qx1][m], b_out[qy0:qy1, qx0:qx1][m])
            region_gain[name] = max(region_gain[name], g)
            region_seen[name] += 1
            if k in REVIEW_FRAMES:
                pair = np.hstack([src[qy0:qy1, qx0:qx1], frame[qy0:qy1, qx0:qx1]])
                tag = name.replace(" ", "_")
                cv2.imwrite(str(review / f"{tag}_{k:03d}.png"), pair)
        if BLUR_FACES:
            u8 = g_src.astype(np.uint8)
            boxes = _faces(u8, detectors) + [tuple(map(int, b)) for b in head_boxes(dets[i])]
            for x, y, w, h in boxes:
                if w < 4 or h < 4:
                    continue
                faces_checked += 1
                a = cv2.Laplacian(g_src[y : y + h, x : x + w], cv2.CV_32F).ravel()
                b = cv2.Laplacian(g_out[y : y + h, x : x + w], cv2.CV_32F).ravel()
                faces_kept += int(_corr(a, b) >= 0.5)
        px, py, pw, ph = label_box
        label_ok += int(np.all(frame[py : py + ph, px : px + pw] > 190, axis=-1).mean() > 0.01)
    checks = {
        "frames": n_out,
        "duration_s": round(n_out / FPS, 2),
        "offpitch_fine_gain_max": round(max(fine), 4),
        "offpitch_letter_gain_max": round(max(letter), 4),
        "region_letter_gain_max": {k: round(v, 4) for k, v in region_gain.items()},
        "region_frames_in_view": region_seen,
        "thresholds": {"fine": MAX_FINE, "letter": MAX_LETTER},
        "offpitch_illegible": bool(
            max(fine) <= MAX_FINE
            and max(letter) <= MAX_LETTER
            and max(region_gain.values()) <= MAX_LETTER
        ),
        "faces_blurred": BLUR_FACES,
        "frames_with_label_and_attribution": label_ok,
        "keyframe": KEYFRAME.name,
    }
    if BLUR_FACES:
        checks["faces_checked"] = faces_checked
        checks["faces_with_detail_in_export"] = faces_kept
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["video_checks"] = checks
    report_path.write_text(json.dumps(report, indent=1))
    print(json.dumps(checks, indent=1))


if __name__ == "__main__":
    main()
