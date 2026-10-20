"""Frame-by-frame checks on the exported segment (SPEC 7, real-footage overlay).

    uv run python -m demo.realfeed.check

- Faces: OpenCV's Haar cascades (frontal and profile) find faces in every source frame of the
  segment and in every exported frame; at each hit the export must not keep the source's fine
  detail (see `detail_kept`). The cascades only verify; nothing in the pipeline depends on a
  learned detector. Failures go to out/realfeed/face_hits as source | export pairs.
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


def _crop(img: np.ndarray, box) -> np.ndarray:
    x, y, w, h = box
    return img[max(0, y) : y + h, max(0, x) : x + w]


def detail_kept(src_gray: np.ndarray, out_gray: np.ndarray, box) -> float:
    """Correlation of the Laplacians of the same box in source and export.

    About 1 when the export still shows the source's fine detail (an unblurred face); near 0
    when it was blurred or pixelated, even if the box also holds a sharp outline or graphics,
    which the source does not share.
    """
    a = cv2.Laplacian(_crop(src_gray, box).astype(np.float32), cv2.CV_32F).ravel()
    b = cv2.Laplacian(_crop(out_gray, box).astype(np.float32), cv2.CV_32F).ravel()
    a, b = a - a.mean(), b - b.mean()
    den = float(np.sqrt((a @ a) * (b @ b)))
    return float(a @ b / den) if den > 0 else 0.0


def main(max_corr: float = 0.5) -> None:
    """Face checks on every exported frame.

    1. Every face the cascades find in the source frame must not keep its detail in the export
       (`detail_kept` below `max_corr`).
    2. Every cascade hit in the export itself is tested the same way against the source; the
       cascades fire on the pixelated heads, which carry no source detail. Failures of either
       check are saved as source | export pairs in out/realfeed/face_hits for review.
    """
    detectors = _detectors()
    panel = hud(np.zeros((SIZE[1], SIZE[0], 3), np.uint8), freeze=False)[0]
    px, py, pw, ph = panel
    hits_dir = OUT / "face_hits"
    hits_dir.mkdir(parents=True, exist_ok=True)
    for old in hits_dir.glob("*.png"):
        old.unlink()
    source = enumerate(read_frames(SOURCE, CLIP_START_S, 10.0, size=SIZE))
    src_i, src = next(source)
    src_corr: list[float] = []
    out_corr: list[float] = []
    failures: list[dict] = []
    label_ok = 0
    n_out = 0
    for k, frame in enumerate(read_frames(VIDEO, 0.0, 60.0, size=SIZE)):
        n_out += 1
        while src_i < source_index(k):
            src_i, src = next(source)
        g_out = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        g_src = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY)
        for kind, found, corrs in (
            ("source", faces(g_src, detectors), src_corr),
            ("export", faces(g_out, detectors), out_corr),
        ):
            for box in found:
                c = detail_kept(g_src, g_out, box)
                corrs.append(c)
                if c >= max_corr:
                    x, y, _, _ = box
                    failures.append(
                        {"kind": kind, "frame": k, "box": list(box), "corr": round(c, 3)}
                    )
                    pair = np.hstack([_crop(src, box), _crop(frame, box)])
                    cv2.imwrite(str(hits_dir / f"{kind}_{k:03d}_{x}_{y}.png"), pair)
        roi = frame[py : py + ph, px : px + pw]
        label_ok += int(np.all(roi > 190, axis=-1).mean() > 0.01)
    checks = {
        "frames": n_out,
        "duration_s": round(n_out / FPS, 2),
        "source_faces_checked": len(src_corr),
        "source_faces_with_detail_in_export": sum(c >= max_corr for c in src_corr),
        "export_cascade_hits": len(out_corr),
        "export_hits_with_source_detail": sum(c >= max_corr for c in out_corr),
        "detail_corr_max": round(max(src_corr + out_corr), 3) if src_corr + out_corr else None,
        "frames_with_label_and_attribution": label_ok,
        "failures": failures[:30],
        "keyframe": KEYFRAME.name,
    }
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["video_checks"] = checks
    report_path.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in checks.items() if k != "failures"}, indent=1))


if __name__ == "__main__":
    main()
