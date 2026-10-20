"""Render the real-footage overlay clip (out/realfeed/realfeed_overlay.mp4).

    uv run python -m demo.realfeed.pipeline   # camera, detections, tracks (cached)
    uv run python -m demo.realfeed.render

Per frame: pitch control between the two teams (analytics.pitch_control) as a translucent
surface, a ring under every tracked player, and, while the ball reaches the blue carrier, his
pass options coloured by interception risk (analytics.tti) with distance rings. Graphics are
drawn in pitch coordinates, projected with the frame's homography and keyed onto the turf.
Everything outside the pitch is blurred and darkened, except the silhouettes of players standing
on it; their heads and the prints on their shirts (a company logo on the red kit) are blurred.
The clip holds a short freeze on the carrier's first touch so the options can be read.
"""

from __future__ import annotations

import json
import pickle
from dataclasses import dataclass

import cv2
import numpy as np

from demo.realfeed.clip import FPS, OUT, SIZE
from demo.realfeed.geometry import apply_h
from demo.realfeed.overlay import (
    BLUE,
    RED,
    WHITE,
    Canvas,
    Layer,
    composite,
    control_surface,
    grass_mask,
    pass_safety,
    safety_colour,
)
from demo.realfeed.pipeline import Camera, assign_teams, camera, frames, tracks
from demo.realfeed.players import Detection, Track
from demo.realfeed.privacy import blur_boxes, blur_outside, polygon_mask
from demo.realfeed.video import Writer

VIDEO = OUT / "realfeed_overlay.mp4"
KEYFRAME = OUT / "realfeed_keyframe.png"

START = 25  # first clip frame in the output
# The ball reaches the blue player on the left; first touch at frame 400 (15:54.0 in the
# source), shot at 410. Hand annotation: his feet in frame 400, in pixels.
CARRIER_FRAME = 400
CARRIER_FEET_PX = (418.0, 690.0)
OPTIONS = (360, 412)  # frames showing his pass options
FREEZE_FRAMES = 60  # 1.2 s hold on CARRIER_FRAME
GOALKEEPER_TEAM = 0  # the orange keeper defends the goal blue attacks: he plays for red
TEAM_COLOUR = {0: RED, 1: BLUE}

CAPTION = "Real amateur footage (CC BY 3.0). Graphics computed by our pipeline."
LEGEND = [
    "Pitch control: red vs blue (time-to-intercept model)",
    "Pass options from the ball carrier: green safe, red likely intercepted",
    "Rings: 2 m and 4 m around the carrier",
    "Positions from classic computer vision; pitch size estimated (approx. 40 x 20 m)",
]


@dataclass
class PlayerState:
    track: int
    team: int
    pos: np.ndarray
    vel: np.ndarray


def states(trs: list[Track], n: int) -> list[list[PlayerState]]:
    out: list[list[PlayerState]] = [[] for _ in range(n)]
    for t in trs:
        full, sm = t.smoothed(window=11)
        vel = t.velocity(FPS, window=11, lag=6)
        team = t.team()
        team = GOALKEEPER_TEAM if team == 2 else team
        if team not in TEAM_COLOUR:
            continue
        for k, f in enumerate(full):
            if 0 <= f < n:
                out[f].append(PlayerState(t.id, team, sm[k], np.clip(vel[k], -8, 8)))
    return out


def carrier_track(cam: Camera, st: list[list[PlayerState]]) -> int:
    h = cam.h_img_from_world[CARRIER_FRAME]
    best = min(
        st[CARRIER_FRAME],
        key=lambda s: np.linalg.norm(apply_h(h, s.pos)[0] - np.array(CARRIER_FEET_PX)),
    )
    return best.track


def ground_layer(canvas: Canvas, players: list[PlayerState], carrier: int | None, fade: float):
    layer = Layer(canvas)
    red = [p for p in players if p.team == 0]
    blue = [p for p in players if p.team == 1]
    if len(red) >= 2 and len(blue) >= 2:
        p = control_surface(
            canvas,
            (np.array([q.pos for q in red]), np.array([q.vel for q in red])),
            (np.array([q.pos for q in blue]), np.array([q.vel for q in blue])),
        )
        valid = ~np.isnan(p)
        p = np.nan_to_num(p, nan=0.5)
        strength = np.abs(2 * p - 1) ** 0.9
        colours = np.where(
            (p > 0.5)[..., None], np.array(RED, np.float32), np.array(BLUE, np.float32)
        )
        layer.heat(colours, 0.42 * strength * valid)
    for q in players:
        layer.circle(q.pos, 0.55, TEAM_COLOUR[q.team], 0.10, opacity=0.95)
    lines = []
    if carrier is not None and fade > 0:
        c = next((q for q in players if q.track == carrier), None)
        if c is not None:
            mates = [q for q in players if q.team == c.team and q.track != carrier]
            opp = [q for q in players if q.team != c.team]
            opp_pv = (
                np.array([q.pos for q in opp]).reshape(-1, 2),
                np.array([q.vel for q in opp]).reshape(-1, 2),
            )
            for r in (2.0, 4.0):
                layer.circle(c.pos, r, WHITE, 0.035, opacity=0.6 * fade)
            for m in mates:
                safe = pass_safety(c.pos, m.pos, opp_pv)
                d = m.pos - c.pos
                end = m.pos - d / max(np.linalg.norm(d), 1e-6) * 0.6
                layer.line(c.pos, end, safety_colour(safe), 0.16, opacity=0.95 * fade)
                layer.circle(m.pos, 0.75, safety_colour(safe), 0.10, opacity=0.95 * fade)
                lines.append((m, safe))
            if opp:
                near = min(opp, key=lambda q: np.linalg.norm(q.pos - c.pos))
                lines.append(("nearest", float(np.linalg.norm(near.pos - c.pos)), c))
    return layer, lines


def _text(img, text, org, scale=0.8, colour=(255, 255, 255), thick=1):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_DUPLEX, scale, colour, thick, cv2.LINE_AA)


def _label(img, text, centre, scale=0.7) -> tuple[int, int, int, int]:
    """Text on a dark panel centred at `centre`; returns the panel box."""
    (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, 1)
    pad = 8
    x, y = int(centre[0] - tw / 2 - pad), int(centre[1] - th / 2 - pad)
    box = (max(0, x), max(0, y), tw + 2 * pad, th + base + 2 * pad)
    _panel(img, box, 0.6)
    _text(img, text, (box[0] + pad, box[1] + pad + th), scale)
    return box


def hud(img: np.ndarray, freeze: bool) -> list[tuple[int, int, int, int]]:
    """Caption and legend; returns their boxes (excluded from the blur check)."""
    boxes = []
    h, w = img.shape[:2]
    pad = 14
    (tw, th), _ = cv2.getTextSize(CAPTION, cv2.FONT_HERSHEY_DUPLEX, 0.8, 1)
    box = (24, h - 24 - th - 2 * pad, tw + 2 * pad, th + 2 * pad)
    _panel(img, box)
    _text(img, CAPTION, (24 + pad, h - 24 - pad), 0.8)
    boxes.append(box)
    widths = [cv2.getTextSize(s, cv2.FONT_HERSHEY_DUPLEX, 0.62, 1)[0][0] for s in LEGEND]
    box = (24, 24, max(widths) + 2 * pad, 30 * len(LEGEND) + pad)
    _panel(img, box)
    for i, s in enumerate(LEGEND):
        _text(img, s, (24 + pad, 24 + pad + 18 + 30 * i), 0.62)
    boxes.append(box)
    if freeze:
        (tw, th), _ = cv2.getTextSize("FREEZE", cv2.FONT_HERSHEY_DUPLEX, 0.8, 2)
        box = (w - 24 - tw - 2 * pad, 24, tw + 2 * pad, th + 2 * pad)
        _panel(img, box)
        _text(img, "FREEZE", (box[0] + pad, 24 + pad + th), 0.8, (90, 220, 255), 2)
        boxes.append(box)
    return boxes


def _panel(img, box, alpha=0.55):
    x, y, w, h = box
    roi = img[y : y + h, x : x + w]
    roi[:] = (roi * (1 - alpha)).astype(np.uint8)


def player_silhouettes(dets: list[Detection], shape, grow_px: int = 3) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    for d in dets:
        x, y, w, h = d.bbox
        sub = d.mask().astype(np.uint8)
        m[y : y + sub.shape[0], x : x + w] |= sub[: shape[0] - y, : shape[1] - x]
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow_px + 1, 2 * grow_px + 1))
    return cv2.dilate(m, k).astype(bool)


def head_boxes(dets: list[Detection], min_height_px: float = 90.0):
    out = []
    for d in dets:
        x, y, w, h = d.bbox
        if h >= min_height_px:
            out.append((x + 0.15 * w, y - 0.03 * h, 0.7 * w, 0.2 * h))
    return out


def kit_mark_boxes(frame: np.ndarray, dets: list[Detection], min_height_px: float = 60.0):
    """Boxes around white prints on shirts (the red kit carries a company logo; numbers too)."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    out = []
    for d in dets:
        x, y, w, h = d.bbox
        if h < min_height_px:
            continue
        r0, r1 = int(0.12 * h), int(0.58 * h)
        band = hsv[y + r0 : y + r1, x : x + w]
        sil = d.mask()[r0:r1]
        white = sil[: band.shape[0], : band.shape[1]] & (band[..., 1] < 70) & (band[..., 2] > 160)
        if white.sum() < 8:
            continue
        ys, xs = np.nonzero(white)
        bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        mx, my = max(6, 0.3 * bw), max(6, 0.3 * bh)
        out.append((x + xs.min() - mx, y + r0 + ys.min() - my, bw + 2 * mx, bh + 2 * my))
    return out


def hf_energy(img: np.ndarray, mask: np.ndarray) -> float:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lap = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    return float(np.mean(lap[mask] ** 2)) if mask.any() else 0.0


def render(preview: set[int] | None = None) -> dict:
    """Write the clip, or with `preview` only PNG stills of those clip frames."""
    cam = camera()
    dets = pickle.loads((OUT / "detections.pkl").read_bytes())
    assign_teams(dets)
    trs = tracks(dets)
    n = len(cam.h_img_from_world)
    st = states(trs, n)
    carrier = carrier_track(cam, st)
    pitch = cam.calibration.pitch
    canvas = Canvas(pitch, ppm=40.0, margin=1.0)
    writer = None if preview else Writer(VIDEO, FPS, SIZE)
    held: list[tuple[int, tuple]] = []
    checks = {"frames": 0, "hf_ratio_outside_max": 0.0, "overlay_off_grass_px": 0}
    for i, frame in enumerate(frames()):
        if i < START or (preview is not None and i not in preview):
            continue
        h = cam.h_img_from_world[i]
        if OPTIONS[0] <= i <= OPTIONS[1]:
            fade = min(1.0, (i - OPTIONS[0]) / 10.0, (OPTIONS[1] - i) / 6.0 + 0.0)
        else:
            fade = 0.0
        layer, labels = ground_layer(canvas, st[i], carrier, max(0.0, fade))
        bgr, alpha = layer.project(h, SIZE)
        pitch_area = polygon_mask(h, pitch.polygon(margin=0.35), frame.shape[:2])
        key = grass_mask(frame) & pitch_area
        # Players standing on the pitch rise above the far touchline in the image: their
        # silhouettes stay sharp (heads are blurred below); everything else outside is blurred.
        keep = pitch_area | player_silhouettes(dets[i], frame.shape[:2])
        out = composite(frame, bgr, alpha, key)
        changed = np.any(out != frame, axis=-1)
        checks["overlay_off_grass_px"] += int((changed & ~key).sum())
        out = blur_outside(out, keep, darken=0.45)
        # Heads of players on the pitch (detections held for a few frames against flicker).
        marks = head_boxes(dets[i]) + kit_mark_boxes(frame, dets[i])
        held = [(f, b) for f, b in held if i - f <= 6] + [(i, b) for b in marks]
        # Pixelate heads and shirt prints only on the kept (sharp) pixels: outside them the
        # frame is already blurred, and box edges there would add detail back.
        pixelated = blur_boxes(out.copy(), [b for _, b in held])
        out = np.where(keep[..., None], pixelated, out)
        label_boxes = []
        for item in labels:
            if item[0] == "nearest" and fade > 0.3:
                _, dist, c = item
                p = apply_h(h, c.pos)[0]
                text = f"nearest opponent {dist:.1f} m"
                label_boxes.append(_label(out, text, (p[0], p[1] + 60)))
        reps = FREEZE_FRAMES if i == CARRIER_FRAME else 1
        for r in range(reps):
            img = out.copy()
            hud_boxes = hud(img, freeze=reps > 1) + label_boxes
            if r == 0:
                outside = cv2.erode((~keep).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(
                    bool
                )
                for x, y, w, hh in hud_boxes:  # panels and their 1 px anti-aliased rim
                    x, y = max(0, int(x) - 3), max(0, int(y) - 3)
                    outside[y : y + int(hh) + 6, x : x + int(w) + 6] = False
                if outside.any():
                    ratio = hf_energy(img, outside) / max(hf_energy(frame, outside), 1e-9)
                    if ratio > checks["hf_ratio_outside_max"]:
                        checks["hf_ratio_outside_max"] = ratio
                        checks["hf_ratio_worst_frame"] = i
                checks["frames"] += 1
            if preview is not None:
                cv2.imwrite(str(OUT / f"preview_{i:03d}.png"), img)
                break
            writer.write(img)
            if i == CARRIER_FRAME and r == 0:
                cv2.imwrite(str(KEYFRAME), img)
    if writer is not None:
        writer.close()
    checks["hf_ratio_outside_max"] = round(checks["hf_ratio_outside_max"], 5)
    checks["carrier_track"] = carrier
    checks["output_frames"] = n - START + FREEZE_FRAMES - 1
    checks["duration_s"] = round(checks["output_frames"] / FPS, 2)
    return checks


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Render the real-footage overlay clip.")
    parser.add_argument("--preview", help="comma-separated clip frames to save as PNG only")
    args = parser.parse_args()
    if args.preview:
        render({int(v) for v in args.preview.split(",")})
        return
    checks = render()
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["render_checks"] = checks
    report_path.write_text(json.dumps(report, indent=1))
    print(json.dumps(checks, indent=1))
    print(f"wrote {VIDEO} and {KEYFRAME}")


if __name__ == "__main__":
    main()
