"""Eight held-out seeds of the hero scenario, with and without the key scan (SPEC 3.6, 11).

    uv run python -m eval.seed_gallery                        # docs/hero-seeds.svg
    uv run python -m eval.seed_gallery --png --chrome <path to chrome-headless-shell>
                                                              # also docs/hero-seeds.png

The README's answer to "is that one cherry-picked moment?": the same scenario on every fifth
held-out seed of eval.hero_flip (100, 105, ..., 135), seeds that changed nothing in design. Each
panel is the board at the hero's decision: H8's key scan as the field-of-view cone the sim used
(analytics.vision.VisionParams, narrowed by his speed), his pass with the scan (gold) and the same
seconds re-simulated without it (dashed). Seeds where the decision does not change are drawn too.

The SVG is plain text written with the standard library, so it diffs. Each panel carries its
seed and both decisions as data attributes; tests/test_seed_gallery.py checks them against the
committed hero_flip report (generated on Linux, SPEC 3.7) without re-running the sim. The PNG is
a screenshot of the SVG by chrome-headless-shell, as in docs/architecture.py.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np

from analytics.vision import VisionParams
from sim.counterfactual import drop_scan_counterfactual

DOCS = Path(__file__).resolve().parents[1] / "docs"
SCENARIO = "blind_side_run"
SEEDS = list(range(100, 140, 5))

W, H = 1600, 900
COLS, ROWS = 4, 2
X0, X1, Y_HALF = -20.0, 52.5, 34.0  # the board: from behind halfway to the goal, full width
SCALE = 4.9  # px per metre
PANEL_W, PANEL_H = (X1 - X0) * SCALE, 2 * Y_HALF * SCALE
CAPTION_H = 36
GAP_X = (W - COLS * PANEL_W) / (COLS + 1)
TOP = 140
GAP_Y = 10
CONE_LENGTH = 30.0  # m, how far the drawn cone reaches (the sim's sight fades with distance)

BG, PITCH, LINE = "#0b0f0c", "#12301f", "rgba(239,237,229,0.32)"
HOME, AWAY, GOLD, WITHOUT, CHALK, CHALK_2 = (
    "#f08a4b", "#4f86f7", "#f5c542", "#ff7a93", "#efede5", "#a9a79f",
)  # fmt: skip


def _decision_pass(run, decision) -> tuple[np.ndarray, np.ndarray, str]:
    """(start, end, label) of what the hero did: the pass or shot target, or a short carry."""
    event = next(
        (e for e in run.events if e.player == decision.player and e.frame == decision.frame
         and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip
    hero = run.index(decision.player)
    start = run.pos[decision.frame, hero]
    if event is None:
        return start, start, "keeps the ball"
    to = event.attrs.get("to")
    label = f"passes to {to}" if event.type == "pass" and to else event.type
    return np.asarray(event.attrs["start"]), np.asarray(event.attrs["target"]), label


def _key_scan_cone(run) -> tuple[np.ndarray, float, float]:
    """(apex, direction, half-angle) at the frame of the key scan where his head is turned most."""
    scan = run.key_scan()
    hero = run.index(run.hero)
    frames = np.arange(scan.frame, int(scan.attrs["end"]) + 1)
    turn = np.abs(np.angle(np.exp(1j * (run.head_yaw[frames, hero] - run.body_yaw[frames, hero]))))
    f = int(frames[int(np.argmax(turn))])
    v = VisionParams()
    speed = float(np.linalg.norm(run.vel[f, hero]))
    half = max(v.min_half_cone, v.half_cone - v.narrowing_per_mps * speed)
    return run.pos[f, hero], float(run.head_yaw[f, hero]), half


def seed_panel(seed: int) -> dict:
    r = drop_scan_counterfactual(SCENARIO, seed)
    run, fd, cd = r.factual, r.factual_decision, r.counterfactual_decision
    f_start, f_end, f_label = _decision_pass(r.factual, fd)
    c_start, c_end, c_label = _decision_pass(r.counterfactual, cd)
    apex, direction, half = _key_scan_cone(run)
    return {
        "seed": seed,
        "factual": fd.chosen,
        "counterfactual": cd.chosen,
        "f_label": f_label,
        "c_label": c_label,
        "f_line": (f_start, f_end),
        "c_line": (c_start, c_end),
        "cone": (apex, direction, half),
        "frame": fd.frame,
        "players": [(p.id, p.team, run.pos[fd.frame, i]) for i, p in enumerate(run.players)],
        "hero": run.hero,
        "runner": "H9",
    }


def _xy(ox: float, oy: float, p) -> tuple[float, float]:
    return ox + (float(p[0]) - X0) * SCALE, oy + (Y_HALF - float(p[1])) * SCALE


def _arrow(ox, oy, line, color, dashed, marker) -> str:
    (x1, y1), (x2, y2) = _xy(ox, oy, line[0]), _xy(ox, oy, line[1])
    dash = ' stroke-dasharray="7 6"' if dashed else ""
    return (
        f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
        f'stroke-width="3" stroke-linecap="round"{dash} marker-end="url(#{marker})"/>'
    )


def _panel(ox: float, oy: float, d: dict) -> str:
    clip = f"clip{d['seed']}"
    out = [
        f'<g class="seed" data-seed="{d["seed"]}" data-factual="{escape(d["factual"])}" '
        f'data-counterfactual="{escape(d["counterfactual"])}">',
        f'<clipPath id="{clip}"><rect x="{ox:.1f}" y="{oy:.1f}" width="{PANEL_W:.1f}" '
        f'height="{PANEL_H:.1f}" rx="10"/></clipPath>',
        f'<g clip-path="url(#{clip})">',
        f'<rect x="{ox:.1f}" y="{oy:.1f}" width="{PANEL_W:.1f}" height="{PANEL_H:.1f}" '
        f'fill="{PITCH}"/>',
    ]
    # pitch markings: halfway line, centre circle, the penalty area and the goal
    hx, _ = _xy(ox, oy, (0, 0))
    out.append(f'<line x1="{hx:.1f}" y1="{oy:.1f}" x2="{hx:.1f}" y2="{oy + PANEL_H:.1f}" '
               f'stroke="{LINE}" stroke-width="1.5"/>')  # fmt: skip
    cx, cy = _xy(ox, oy, (0, 0))
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{9.15 * SCALE:.1f}" fill="none" '
               f'stroke="{LINE}" stroke-width="1.5"/>')  # fmt: skip
    bx, by = _xy(ox, oy, (52.5 - 16.5, 20.16))
    box_w, box_h = 16.5 * SCALE, 40.32 * SCALE
    out.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{box_w:.1f}" height="{box_h:.1f}" '
               f'fill="none" stroke="{LINE}" stroke-width="1.5"/>')  # fmt: skip
    gx, gy = _xy(ox, oy, (52.5, 3.66))
    out.append(f'<rect x="{gx - 4:.1f}" y="{gy:.1f}" width="4" height="{7.32 * SCALE:.1f}" '
               f'fill="{CHALK}" opacity="0.8"/>')  # fmt: skip
    # the key scan: the cone he saw through, at the moment his head was turned most
    apex, direction, half = d["cone"]
    ax, ay = _xy(ox, oy, apex)
    pts = [f"{ax:.1f},{ay:.1f}"]
    for a in np.linspace(direction - half, direction + half, 24):
        px, py = _xy(ox, oy, apex + CONE_LENGTH * np.array([np.cos(a), np.sin(a)]))
        pts.append(f"{px:.1f},{py:.1f}")
    out.append(f'<polygon points="{" ".join(pts)}" fill="{GOLD}" fill-opacity="0.14" '
               f'stroke="{GOLD}" stroke-opacity="0.45" stroke-width="1"/>')  # fmt: skip
    # the two passes, the one without the scan under the one with it
    if d["counterfactual"] != d["factual"]:
        if d["counterfactual"] == "carry":  # he keeps the ball: a dashed ring, not an arrow
            hx2, hy2 = _xy(ox, oy, d["c_line"][0])
            out.append(
                f'<circle cx="{hx2:.1f}" cy="{hy2:.1f}" r="13" fill="none" stroke="{WITHOUT}" '
                'stroke-width="2.5" stroke-dasharray="5 4"/>'
            )
        else:
            out.append(_arrow(ox, oy, d["c_line"], WITHOUT, True, "head-without"))
    out.append(_arrow(ox, oy, d["f_line"], GOLD, False, "head-with"))
    # players at the decision
    for pid, team, p in d["players"]:
        x, y = _xy(ox, oy, p)
        fill = GOLD if pid == d["runner"] else (HOME if team == 0 else AWAY)
        ring = f' stroke="{CHALK}" stroke-width="2.5"' if pid == d["hero"] else ""
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5.5" fill="{fill}"{ring}/>')
        if pid in (d["hero"], d["runner"]):
            out.append(f'<text x="{x + 8:.1f}" y="{y - 7:.1f}" class="tag">{pid}</text>')
    out.append("</g>")
    # caption
    ty = oy + PANEL_H + 21
    if d["counterfactual"] == d["factual"]:
        line = f'<tspan fill="{CHALK_2}">the same either way: {escape(d["f_label"])}</tspan>'
    else:
        line = (
            f'<tspan fill="{GOLD}">with the scan: {escape(d["f_label"])}</tspan>'
            f'<tspan fill="{CHALK_2}"> · </tspan>'
            f'<tspan fill="{WITHOUT}">without: {escape(d["c_label"])}</tspan>'
        )
    out.append(
        f'<text x="{ox:.1f}" y="{ty:.1f}" class="cap"><tspan class="seedno">'
        f"Seed {d['seed']}</tspan>  {line}</text>"
    )
    out.append("</g>")
    return "\n".join(out)


def render(panels: list[dict]) -> str:
    first, last = SEEDS[0], SEEDS[-1]
    head = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" font-family="Inter, Segoe UI, Helvetica, sans-serif">',
        "<style>"
        f".title{{font:600 34px Inter,-apple-system,Segoe UI,Helvetica,sans-serif;fill:{CHALK}}}"
        f".sub{{font:400 17px Inter,-apple-system,Segoe UI,Helvetica,sans-serif;fill:{CHALK_2}}}"
        f".seedno{{font:600 15px Inter,-apple-system,Segoe UI,Helvetica,sans-serif;fill:{CHALK}}}"
        ".cap{font:500 13.5px Inter,-apple-system,Segoe UI,Helvetica,sans-serif}"
        f".tag{{font:600 12px Inter,-apple-system,Segoe UI,Helvetica,sans-serif;fill:{CHALK}}}"
        "</style>",
        "<defs>"
        f'<marker id="head-with" markerWidth="8" markerHeight="8" refX="6" refY="4" '
        f'orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="{GOLD}"/></marker>'
        f'<marker id="head-without" markerWidth="8" markerHeight="8" refX="6" refY="4" '
        f'orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="{WITHOUT}"/></marker>'
        "</defs>",
        f'<rect width="{W}" height="{H}" fill="{BG}"/>',
        f'<text x="{GAP_X:.1f}" y="56" class="title">Not one cherry-picked moment</text>',
        f'<text x="{GAP_X:.1f}" y="88" class="sub">The same simulated scenario on every fifth '
        f"held-out seed ({first}–{last}), at H8's decision: his key scan "
        f'(<tspan fill="{GOLD}">gold cone</tspan>), his pass with it '
        f'(<tspan fill="{GOLD}">gold arrow</tspan>)</text>',
        f'<text x="{GAP_X:.1f}" y="112" class="sub">and the same seconds re-simulated without it '
        f'(<tspan fill="{WITHOUT}">dashed; a dashed ring when he keeps the ball</tspan>). '
        f"H9, the runner, in gold. Synthetic players, fictional teams.</text>",
    ]
    body = []
    for i, d in enumerate(panels):
        col, row = i % COLS, i // COLS
        ox = GAP_X + col * (PANEL_W + GAP_X)
        oy = TOP + row * (PANEL_H + CAPTION_H + GAP_Y)
        body.append(_panel(ox, oy, d))
    return "\n".join(head + body + ["</svg>"]) + "\n"


def export_png(svg: Path, png: Path, chrome: str) -> None:
    """Screenshot `svg` at its size with chrome-headless-shell."""
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run(
            [
                chrome, "--headless", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=1", f"--window-size={W},{H}",
                f"--user-data-dir={profile}", f"--screenshot={png}", svg.as_uri(),
            ],
            check=True, capture_output=True,
        )  # fmt: skip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--png", action="store_true", help="also write docs/hero-seeds.png")
    parser.add_argument("--chrome", help="chrome-headless-shell binary for --png")
    args = parser.parse_args()
    if args.png and not args.chrome:
        parser.error("--png needs --chrome <path to chrome-headless-shell>")
    panels = [seed_panel(s) for s in SEEDS]
    svg = DOCS / "hero-seeds.svg"
    svg.write_text(render(panels))
    print(f"wrote {svg}")
    for d in panels:
        print(f"  seed {d['seed']}: {d['factual']} -> {d['counterfactual']}")
    if args.png:
        export_png(svg, DOCS / "hero-seeds.png", args.chrome)
        print(f"wrote {DOCS / 'hero-seeds.png'}")


if __name__ == "__main__":
    main()
