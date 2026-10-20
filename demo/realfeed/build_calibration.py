"""Turn hand clicks on the clip's first frame into calibration points.

    uv run python -m demo.realfeed.build_calibration

Writes demo/realfeed/calibration.json. Three kinds of input, all read off the first frame by hand:

- SEED: five rough correspondences (image point -> approximate pitch position) that only start the
  solver: the goalpost bases, the rightmost point of the centre circle (about (3, 0)), and two
  points on the near touchline whose distance from the halfway line is a guess (±2 m converges to
  the same fit).
- CLICKS: exact landmarks kept in the fit (the two goalpost bases) and three near-touchline points.
- Snapped points: every marking is projected with the current fit and snapped onto the painted
  line (or the far turf edge, which has no paint); the fit is repeated with a shrinking radius.

Length, width and centre-circle radius are left free. The scale comes from the futsal penalty
area (6 m quarter circles) and the 3 m goals; the free circle radius coming out at 3 m is an
independent check.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np

from demo.realfeed.calibrate import Observation, fit_calibration
from demo.realfeed.clip import CLIP_START_S, OUT, SOURCE, frame_at
from demo.realfeed.geometry import fit_homography
from demo.realfeed.lines import line_response, snap
from demo.realfeed.overlay import grass_mask
from demo.realfeed.pitch import FutsalPitch

CALIBRATION_JSON = Path(__file__).parent / "calibration.json"
FRAME = "ref"

# (image x, y) -> rough (pitch x, y) in metres.
SEED = [
    ((1377.0, 492.0), (20.0, 1.54)),  # far goalpost base
    ((1557.0, 521.0), (20.0, -1.54)),  # near goalpost base
    ((128.0, 652.0), (3.0, 0.0)),  # rightmost point of the centre circle
    ((1650.0, 1045.0), (7.0, -10.0)),  # near touchline, guessed distance from halfway
    ((1900.0, 901.0), (9.5, -10.0)),
]
CLICKS = [
    ("post_far_right", (1377.0, 492.0)),
    ("post_near_right", (1557.0, 521.0)),
    ("near_touchline", (1650.0, 1045.0)),
    ("near_touchline", (1800.0, 959.0)),
    ("near_touchline", (1900.0, 901.0)),
]
KEEP = {"post_far_right", "post_near_right"}
SNAP = ["near_touchline", "area_right", "goal_line_right", "far_touchline", "centre_circle"]
FREE = ("length", "width", "centre_radius")
RADII = (40.0, 24.0, 14.0, 8.0, 5.0, 5.0)


def build() -> dict:
    frame = frame_at(0, SOURCE)
    resp, turf = line_response(frame), grass_mask(frame)
    ident = {FRAME: np.eye(3)}
    clicks = [Observation(FRAME, f, np.array(xy)) for f, xy in CLICKS]
    keep = [o for o in clicks if o.feature in KEEP]
    seed = fit_homography(np.array([w for _, w in SEED]), np.array([i for i, _ in SEED]))
    cal = fit_calibration(clicks, ident, FutsalPitch(), seed, free=("width",))
    for radius in RADII:
        obs = keep + snap(
            frame, FRAME, cal.h_img_from_world, cal.pitch, SNAP, search_px=radius,
            spacing_px=15.0, response=resp, grass=turf,
        )  # fmt: skip
        cal = fit_calibration(obs, ident, cal.pitch, cal.h_img_from_world, free=FREE)
        p = cal.pitch
        print(
            f"snap {radius:>4.0f} px: {len(obs):>3} points, rms {cal.rms_px:.2f} px, "
            f"L {p.length:.2f} W {p.width:.2f} R {p.centre_radius:.2f}"
        )
    print("points per marking", dict(Counter(o.feature for o in obs)))
    print("rms per marking (px)", {k: round(v, 2) for k, v in cal.per_feature_rms_px.items()})
    p = cal.pitch
    return {
        "note": (
            "Calibration points for demo/realfeed on the clip's first frame. 'seed' only starts "
            "the solver; 'points' are the fitted observations: two hand-clicked goalpost bases and "
            "markings snapped onto the painted lines (the far touchline onto the turf edge). The "
            "pitch size is estimated from the markings and is approximate."
        ),
        "source": SOURCE.name,
        "reference_frame": FRAME,
        "frames": {FRAME: {"time_s": CLIP_START_S, "ref_from_frame": np.eye(3).tolist()}},
        "pitch_initial": {"length": 40.0, "width": 20.0},
        "free": list(FREE),
        "seed": [{"xy": list(i), "world": list(w)} for i, w in SEED],
        "clicks": [{"feature": f, "xy": list(xy)} for f, xy in CLICKS],
        "fit_approximate": {
            "length_m": round(float(p.length), 2),
            "width_m": round(float(p.width), 2),
            "centre_radius_m": round(float(p.centre_radius), 3),
            "rms_px": round(cal.rms_px, 3),
            "rms_px_per_marking": {k: round(v, 3) for k, v in cal.per_feature_rms_px.items()},
            "h_img_from_world": np.round(cal.h_img_from_world, 10).tolist(),
        },
        "points": [
            {"frame": o.frame, "feature": o.feature, "xy": [round(float(v), 2) for v in o.xy]}
            for o in obs
        ],
    }


def main() -> None:
    data = build()
    CALIBRATION_JSON.write_text(json.dumps(data, indent=1) + "\n")
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"wrote {CALIBRATION_JSON}")


if __name__ == "__main__":
    main()
