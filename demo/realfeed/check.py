"""Frame-by-frame checks on the exported segment (SPEC 7, real-footage overlay).

    uv run python -m demo.realfeed.check

- Faces: OpenCV's Haar cascades (frontal and profile) run on every exported frame and, for
  comparison, on the matching source frames. The cascades only verify; nothing in the pipeline
  depends on a learned detector. Every hit in the export is saved as a crop for review.
- Label and attribution: the bottom-left panel holds legible white text in every frame.
- Off-pitch masking is measured during the render (`render_checks` in report.json).

This does not replace the manual frame-by-frame review before the segment goes into the video.
"""

from __future__ import annotations

import json

import cv2
import numpy as np

from demo.realfeed.clip import CLIP_START_S, FPS, OUT, SIZE, SOURCE
from demo.realfeed.render import CARRIER_FRAME, FREEZE_FRAMES, KEYFRAME, START, VIDEO, hud
from demo.realfeed.video import read_frames

CASCADES = ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml")


def _detectors() -> list[cv2.CascadeClassifier]:
    return [cv2.CascadeClassifier(cv2.data.haarcascades + name) for name in CASCADES]


def faces(gray: np.ndarray, detectors) -> list[tuple[int, int, int, int]]:
    out = []
    for det in detectors:
        for flip in (False, True):  # the profile cascade only finds faces turned one way
            img = cv2.flip(gray, 1) if flip else gray
            hits = det.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(14, 14))
            for x, y, w, h in hits:
                x = gray.shape[1] - x - w if flip else x
                out.append((int(x), int(y), int(w), int(h)))
    return out


def source_index(k: int) -> int:
    """Clip frame shown at output frame k (the freeze repeats CARRIER_FRAME)."""
    i = START + k
    if i <= CARRIER_FRAME:
        return i
    return max(CARRIER_FRAME, i - (FREEZE_FRAMES - 1))


def main() -> None:
    detectors = _detectors()
    panel = hud(np.zeros((SIZE[1], SIZE[0], 3), np.uint8), freeze=False)[0]
    px, py, pw, ph = panel
    hits_dir = OUT / "face_hits"
    hits_dir.mkdir(parents=True, exist_ok=True)
    for old in hits_dir.glob("*.png"):
        old.unlink()
    wanted = {source_index(k) for k in range(0, 600, 10)}
    src = {
        i: f
        for i, f in enumerate(read_frames(SOURCE, CLIP_START_S, 10.0, size=SIZE))
        if i in wanted
    }
    n_out, out_hits, label_ok = 0, [], 0
    src_hits = 0
    for k, frame in enumerate(read_frames(VIDEO, 0.0, 60.0, size=SIZE)):
        n_out += 1
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        for x, y, w, h in faces(gray, detectors):
            out_hits.append({"frame": k, "box": [x, y, w, h]})
            cv2.imwrite(str(hits_dir / f"{k:03d}_{x}_{y}.png"), frame[y : y + h, x : x + w])
        roi = frame[py : py + ph, px : px + pw]
        white = np.all(roi > 190, axis=-1).mean()
        label_ok += int(white > 0.01)
        if k % 10 == 0:
            g = cv2.cvtColor(src[source_index(k)], cv2.COLOR_BGR2GRAY)
            src_hits += len(faces(g, detectors))
    checks = {
        "frames": n_out,
        "duration_s": round(n_out / FPS, 2),
        "faces_in_export": len(out_hits),
        "face_hits": out_hits[:50],
        "faces_in_source_every_10th_frame": src_hits,
        "frames_with_label_and_attribution": label_ok,
        "keyframe": KEYFRAME.name,
    }
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["video_checks"] = checks
    report_path.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in checks.items() if k != "face_hits"}, indent=1))


if __name__ == "__main__":
    main()
