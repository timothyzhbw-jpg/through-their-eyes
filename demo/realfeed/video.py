"""Frame I/O through the ffmpeg command-line tool (decode VP9, encode H.264)."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path

import numpy as np


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise RuntimeError("ffmpeg not found on PATH (brew install ffmpeg)")
    return exe


def read_frames(
    path: Path, start_s: float, duration_s: float, size: tuple[int, int] = (1920, 1080)
) -> Iterator[np.ndarray]:
    """BGR frames from `start_s` for `duration_s` seconds (frame-accurate seek)."""
    w, h = size
    cmd = [
        _ffmpeg(), "-v", "error", "-ss", f"{start_s:.3f}", "-i", str(path),
        "-t", f"{duration_s:.3f}", "-an", "-vf", f"scale={w}:{h}:flags=area",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]  # fmt: skip
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3
    try:
        while True:
            buf = proc.stdout.read(n)
            if len(buf) < n:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        proc.stdout.close()
        proc.wait()


class Writer:
    """H.264 (yuv420p) MP4 writer fed with BGR frames."""

    def __init__(self, path: Path, fps: float, size: tuple[int, int] = (1920, 1080), crf: int = 18):
        path.parent.mkdir(parents=True, exist_ok=True)
        w, h = size
        cmd = [
            _ffmpeg(), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{w}x{h}", "-r", f"{fps}", "-i", "-",
            "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(path),
        ]  # fmt: skip
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def write(self, frame: np.ndarray) -> None:
        self.proc.stdin.write(np.ascontiguousarray(frame).tobytes())

    def close(self) -> None:
        self.proc.stdin.close()
        if self.proc.wait() != 0:
            raise RuntimeError("ffmpeg encode failed")
