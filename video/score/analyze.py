"""Measurements for the score report: octave-band balance and loudness per section."""

from __future__ import annotations

import numpy as np
from dsp import SR, loudness, stereo
from scipy import signal

BANDS = (63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)


def band_levels(x: np.ndarray) -> dict[int, float]:
    """Octave-band power in dB (Welch PSD summed per band), relative to the 125 Hz band."""
    mono = stereo(x).mean(axis=1)
    f, p = signal.welch(mono, SR, nperseg=8192)
    out = {}
    for fc in BANDS:
        lo, hi = fc / np.sqrt(2), min(fc * np.sqrt(2), SR / 2)
        out[fc] = 10 * np.log10(p[(f >= lo) & (f < hi)].sum() + 1e-20)
    ref = out[125]
    return {k: round(v - ref, 1) for k, v in out.items()}


def section_loudness(x: np.ndarray, sections) -> list[tuple[str, float]]:
    rows = []
    for s in sections:
        seg = x[int(s.start * SR) : int(s.end * SR)]
        rows.append((s.id, round(loudness(seg), 1) if len(seg) > SR else float("nan")))
    return rows
