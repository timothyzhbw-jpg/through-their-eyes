"""Render the real-footage overlay clip (out/realfeed/realfeed_overlay.mp4).

    uv run python -m demo.realfeed.pipeline   # camera, detections, tracks (cached)
    uv run python -m demo.realfeed.render

Per frame: pitch control between the two teams (analytics.pitch_control) as a translucent
surface, a ring under every tracked player, and, while the ball reaches the blue carrier, his
pass options coloured by interception risk (analytics.tti) with distance rings. Graphics are
drawn in pitch coordinates, projected with the frame's homography and keyed onto the turf.
Everything outside the pitch is blurred, except the silhouettes of players standing on it and
the white frame of the goal; the prints on the red kit (a company logo) are erased. Faces are not
blurred (Bowen's decision, 2026-10-19).
The clip holds a short freeze on the carrier's first touch so the options can be read.
"""

from __future__ import annotations

import json
import pickle
from dataclasses import dataclass

import cv2
import numpy as np

from demo.realfeed.clip import FPS, OUT, SIZE
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
from demo.realfeed.pipeline import assign_teams, camera, frames, tracks
from demo.realfeed.players import Detection, Track
from demo.realfeed.privacy import (
    blur_outside,
    erase_prints,
    goal_frame_mask,
    kit_print_mask,
    polygon_mask,
)
from demo.realfeed.video import Writer

VIDEO = OUT / "realfeed_overlay.mp4"
KEYFRAME = OUT / "realfeed_keyframe.png"

START = 60  # first clip frame in the output; keeps the segment under 10 s
# The ball reaches a blue player at the centre circle: first touch at frame 400 (15:54.0 in the
# source), shot at 410, read off the footage by eye. No ball detector and no committed player
# positions: the carrier is chosen by rule, the blue player nearest the centre spot then.
CARRIER_FRAME = 400
CARRIER_TEAM = 1
OPTIONS = (360, 412)  # frames showing his pass options
FREEZE_FRAMES = 60  # 1.2 s hold on CARRIER_FRAME
GOALKEEPER_TEAM = 0  # the orange keeper defends the goal blue attacks: he plays for red
TEAM_COLOUR = {0: RED, 1: BLUE}
# Off the pitch: blurred past reading any text, crest or face, yet still a football ground.
BACKGROUND = {"factor": 10, "darken": 0.9, "desaturate": 0.2, "feather_px": 4}
CONTROL_OPACITY = 0.24

# The only text on the real footage (SPEC 7): what it is, and the CC BY attribution, on screen for
# the whole segment. Graphics only otherwise: no numbers, captions or narration.
LABEL = "Real footage, overlay demo only; the app uses synthetic data"
ATTRIBUTION = "savinkins, Wikimedia Commons, CC BY 3.0; blurred and overlaid by us"


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


def carrier_track(st: list[list[PlayerState]]) -> int:
    blue = [s for s in st[CARRIER_FRAME] if s.team == CARRIER_TEAM]
    return min(blue, key=lambda s: float(np.linalg.norm(s.pos))).track


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
        strength = np.abs(2 * p - 1) ** 1.3
        colours = np.where(
            (p > 0.5)[..., None], np.array(RED, np.float32), np.array(BLUE, np.float32)
        )
        layer.heat(colours, CONTROL_OPACITY * strength * valid)
    for q in players:
        layer.circle(q.pos, 0.55, TEAM_COLOUR[q.team], 0.10, opacity=0.95)
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
    return layer


def _text(img, text, org, scale=0.8, colour=(255, 255, 255), thick=1):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_DUPLEX, scale, colour, thick, cv2.LINE_AA)


def hud(img: np.ndarray, freeze: bool) -> list[tuple[int, int, int, int]]:
    """Label and attribution (bottom left), a pause sign while frozen; returns the panel boxes."""
    h, w = img.shape[:2]
    pad, gap = 14, 10
    sizes = [
        cv2.getTextSize(t, cv2.FONT_HERSHEY_DUPLEX, s, 1)[0]
        for t, s in ((LABEL, 0.8), (ATTRIBUTION, 0.62))
    ]
    bw = max(sw for sw, _ in sizes) + 2 * pad
    bh = sizes[0][1] + sizes[1][1] + gap + 2 * pad + 6
    box = (24, h - 24 - bh, bw, bh)
    _panel(img, box)
    _text(img, LABEL, (24 + pad, box[1] + pad + sizes[0][1]), 0.8)
    _text(
        img,
        ATTRIBUTION,
        (24 + pad, box[1] + pad + sizes[0][1] + gap + sizes[1][1] + 4),
        0.62,
        (215, 215, 215),
    )
    boxes = [box]
    if freeze:
        # A pause sign, not a word: the footage carries no captions.
        box = (w - 24 - 64, 24, 64, 64)
        _panel(img, box)
        for x0 in (w - 24 - 64 + 18, w - 24 - 64 + 36):
            cv2.rectangle(img, (x0, 24 + 16), (x0 + 10, 24 + 48), (255, 255, 255), -1)
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
    carrier = carrier_track(st)
    pitch = cam.calibration.pitch
    canvas = Canvas(pitch, ppm=40.0, margin=1.0)
    writer = None if preview else Writer(VIDEO, FPS, SIZE)
    checks = {"frames": 0, "hf_ratio_outside_max": 0.0, "overlay_off_grass_px": 0}
    for i, frame in enumerate(frames()):
        if i < START or (preview is not None and i not in preview):
            continue
        h = cam.h_img_from_world[i]
        if OPTIONS[0] <= i <= OPTIONS[1]:
            fade = min(1.0, (i - OPTIONS[0]) / 10.0, (OPTIONS[1] - i) / 6.0 + 0.0)
        else:
            fade = 0.0
        layer = ground_layer(canvas, st[i], carrier, max(0.0, fade))
        bgr, alpha = layer.project(h, SIZE)
        pitch_area = polygon_mask(h, pitch.polygon(margin=0.35), frame.shape[:2])
        key = grass_mask(frame) & pitch_area
        # Players standing on the pitch rise above the far touchline in the image: their
        # silhouettes stay sharp, and so does the white goal frame; the rest outside is blurred.
        keep = pitch_area | player_silhouettes(dets[i], frame.shape[:2])
        keep |= goal_frame_mask(frame, h, pitch.length / 2)
        out = composite(frame, bgr, alpha, key)
        changed = np.any(out != frame, axis=-1)
        checks["overlay_off_grass_px"] += int((changed & ~key).sum())
        # Shirt prints first, from the source pixels, then the background.
        out = erase_prints(out, kit_print_mask(frame, keep))
        out = blur_outside(out, keep, **BACKGROUND)
        reps = FREEZE_FRAMES if i == CARRIER_FRAME else 1
        for r in range(reps):
            img = out.copy()
            hud_boxes = hud(img, freeze=reps > 1)
            if r == 0:
                grow = 2 * BACKGROUND["feather_px"] + 5  # skip the feathered rim
                outside = cv2.erode(
                    (~keep).astype(np.uint8), np.ones((grow, grow), np.uint8)
                ).astype(bool)
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
