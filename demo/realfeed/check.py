"""Frame-by-frame check on the exported segment (SPEC 7, real-footage overlay).

    uv run python -m demo.realfeed.check

The label and the attribution must be legible in every exported frame (white text in the
bottom-left panel). Off-pitch masking and the turf key are measured during the render
(`render_checks` in report.json). Faces are not blurred (Bowen's decision, 2026-10-19), so there
is no face check. None of this replaces the manual frame-by-frame review before the segment goes
into the video.
"""

from __future__ import annotations

import json

import numpy as np

from demo.realfeed.clip import FPS, OUT, SIZE
from demo.realfeed.render import KEYFRAME, VIDEO, hud
from demo.realfeed.video import read_frames


def main() -> None:
    px, py, pw, ph = hud(np.zeros((SIZE[1], SIZE[0], 3), np.uint8), freeze=False)[0]
    n_out, label_ok = 0, 0
    for frame in read_frames(VIDEO, 0.0, 60.0, size=SIZE):
        n_out += 1
        roi = frame[py : py + ph, px : px + pw]
        label_ok += int(np.all(roi > 190, axis=-1).mean() > 0.01)
    checks = {
        "frames": n_out,
        "duration_s": round(n_out / FPS, 2),
        "frames_with_label_and_attribution": label_ok,
        "keyframe": KEYFRAME.name,
    }
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["video_checks"] = checks
    report_path.write_text(json.dumps(report, indent=1))
    print(json.dumps(checks, indent=1))


if __name__ == "__main__":
    main()
