"""Corner-pin one picture onto a screen in a rendered clip (SPEC 10): the coach's tablet in the
story shows the app's first-person replay, then the film cuts to that replay full frame.

The clip comes with the screen's corners per frame (tl, tr, br, bl in clip pixels) and a matte
of what is visible of the screen. The pinned picture is mapped so that on the last frame the
screen shows it pixel for pixel where it will sit once it fills the frame: with H_f the map from
the screen's own unit square to frame f, a frame pixel p shows source(H_last(H_f^-1(p))), and on
the last frame that is source(p), so the cut to the same picture full frame is seamless.
Sharp by construction: one bilinear sample per pixel, no blur.

    python video/pin.py --clip bs2.mp4 --corners bs2_screen_corners.json --matte bs2_screen_matte \
        --source pov-match.mp4 --source-offset-y 138 --out bs2_pinned.mp4

Standard library and numpy only; ffmpeg decodes and encodes.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np


def homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """3x3 H with dst ~ H @ src for four point pairs (rows of [x, y])."""
    a = []
    for (x, y), (u, v) in zip(src, dst, strict=True):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.asarray(a, dtype=np.float64))
    h = vt[-1].reshape(3, 3)
    return h / h[2, 2]


def apply(h: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    w = h[2, 0] * xs + h[2, 1] * ys + h[2, 2]
    return (h[0, 0] * xs + h[0, 1] * ys + h[0, 2]) / w, (h[1, 0] * xs + h[1, 1] * ys + h[1, 2]) / w


def bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Samples of img (H, W, 3) at float pixel positions, and which ones fell inside it."""
    hgt, wid = img.shape[:2]
    inside = (x >= 0) & (y >= 0) & (x <= wid - 1) & (y <= hgt - 1)
    x = np.clip(x, 0, wid - 1.001)
    y = np.clip(y, 0, hgt - 1.001)
    x0 = x.astype(np.int64)
    y0 = y.astype(np.int64)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    top = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    bot = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bot * fy, inside


def frames(path: Path, width: int, height: int, pix: str = "rgb24", count: int | None = None):
    depth = 3 if pix == "rgb24" else 1
    limit = ["-frames:v", str(count)] if count else []
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(path), *limit, "-f", "rawvideo", "-pix_fmt", pix, "-"],
        stdout=subprocess.PIPE,
    )
    size = width * height * depth
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(height, width, depth)
    proc.wait()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--clip", required=True, type=Path)
    ap.add_argument("--corners", required=True, type=Path)
    ap.add_argument("--matte", required=True, type=Path, help="directory of f_0001.png ...")
    ap.add_argument("--source", required=True, type=Path, help="the picture to pin (first frame)")
    ap.add_argument("--source-offset-y", type=int, default=0, help="clip row 0 in source rows")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    meta = json.loads(args.corners.read_text())
    width, height, fps = meta["width"], meta["height"], meta["fps"]
    rows = meta["frames"]
    unit = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float64)
    quad = lambda r: np.array([r[k][:2] for k in ("tl", "tr", "br", "bl")], dtype=np.float64)  # noqa: E731
    h_last = homography(unit, quad(rows[-1]))

    probe = (
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0",
                str(args.source),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .split(",")
    )
    sw, sh = int(probe[0]), int(probe[1])
    source = next(frames(args.source, sw, sh, count=1)).astype(np.float32)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    enc = subprocess.Popen(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{width}x{height}",
            "-r",
            str(fps),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-crf",
            "14",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            str(args.out),
        ],
        stdin=subprocess.PIPE,
    )
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float64)
    pinned = 0
    for i, frame in enumerate(frames(args.clip, width, height)):
        row = rows[min(i, len(rows) - 1)]
        out = frame
        matte_file = args.matte / f"f_{row['frame']:04d}.png"
        if row.get("facing") and matte_file.exists():
            matte = (
                next(frames(matte_file, width, height, "gray", count=1))[..., 0].astype(np.float32)
                / 255
            )
            box = np.argwhere(matte > 0)
            if box.size:
                (y0, x0), (y1, x1) = box.min(0), box.max(0) + 1
                g = h_last @ np.linalg.inv(homography(unit, quad(row)))
                sx, sy = apply(g, xs[y0:y1, x0:x1], ys[y0:y1, x0:x1])
                sample, inside = bilinear(source, sx, sy + args.source_offset_y)
                a = (matte[y0:y1, x0:x1] * inside)[..., None]
                out = frame.astype(np.float32)
                out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - a) + sample * a
                out = np.clip(out + 0.5, 0, 255).astype(np.uint8)
                pinned += 1
        enc.stdin.write(np.ascontiguousarray(out).tobytes())
    enc.stdin.close()
    enc.wait()
    print(f"pinned {pinned} frames -> {args.out}")


if __name__ == "__main__":
    main()
