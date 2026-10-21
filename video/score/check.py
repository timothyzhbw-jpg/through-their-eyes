"""Acceptance checks on a rendered score: does it hit the picture, does the perception device
work, are the silences silent, does the master sit on its loudness target.

Every check reads the rendered WAVs back, not the arranger's intentions.
"""

from __future__ import annotations

import numpy as np
from dsp import SR, loudness, stereo, true_peak_db
from scipy import signal
from timeline import Plan

ONSET_EVENTS = ("hit", "card", "drop", "button", "stamp")
MAX_OFFSET_MS = 10.0  # a third of a 30 fps frame
SCAN_MIN_DROP_DB = 12.0


def _hf_energy(x: np.ndarray, cutoff: float = 1000.0) -> np.ndarray:
    mono = stereo(x).mean(axis=1)
    hp = signal.sosfilt(signal.butter(4, cutoff, "highpass", fs=SR, output="sos"), mono)
    return hp**2


def onsets(x: np.ndarray, times: list[float], search_ms: float = 40.0) -> list[float]:
    """For each cue time, the offset (ms) of the sharpest energy rise within +-search_ms."""
    mono = stereo(x).mean(axis=1)
    hp = signal.sosfilt(signal.butter(2, 150.0, "highpass", fs=SR, output="sos"), mono)
    hop = int(0.001 * SR)
    frames = len(hp) // hop
    e = (hp[: frames * hop] ** 2).reshape(frames, hop).mean(axis=1)
    loge = 10 * np.log10(e + 1e-12)
    smooth = np.convolve(loge, np.ones(2) / 2, mode="same")
    flux = np.diff(smooth, prepend=smooth[0])
    out = []
    span = int(search_ms)
    for t in times:
        c = int(round(t * 1000))
        lo, hi = max(1, c - span), min(len(flux) - 1, c + span)
        if hi <= lo:
            out.append(float("nan"))
            continue
        w = flux[lo:hi]
        # strong attacks: local maxima at least half as sharp as the sharpest in the window
        peaks = [
            k
            for k in range(1, len(w) - 1)
            if w[k] >= w[k - 1] and w[k] >= w[k + 1] and w[k] >= 0.5 * w.max()
        ]
        k = min(peaks, key=lambda k: abs(lo + k - t * 1000)) if peaks else int(np.argmax(w))
        out.append(float(lo + k - t * 1000))
    return out


def run(plan: Plan, mastered: np.ndarray, stems: dict[str, np.ndarray]) -> dict:
    result: dict = {"pass": True, "notes": []}

    def fail(msg: str) -> None:
        result["pass"] = False
        result["notes"].append(msg)

    # 1. Loudness and peak of the master.
    lufs, tp = loudness(mastered), true_peak_db(mastered)
    result["lufs"], result["true_peak_db"] = round(lufs, 2), round(tp, 2)
    if abs(lufs + 14.0) > 0.5:
        fail(f"integrated loudness {lufs:.2f} LUFS, target -14 +-0.5")
    if tp > -1.0:
        fail(f"true peak {tp:.2f} dBTP over -1.0")

    # 2. Hits on picture: the score's sharpest attack sits on each cue.
    cues = [(e.type, e.t0, e.data.get("note", "")) for e in plan.events if e.type in ONSET_EVENTS]
    cues += [("scan-release", e.t1, e.data.get("note", "")) for e in plan.of("scan")]
    cues.sort(key=lambda c: c[1])
    offsets = onsets(mastered, [c[1] for c in cues])
    rows = []
    for (kind, t, note), off in zip(cues, offsets, strict=True):
        rows.append({"cue": kind, "t": round(t, 3), "offset_ms": round(off, 1), "note": note})
    result["hits"] = rows
    bad = [r for r in rows if not abs(r["offset_ms"]) <= MAX_OFFSET_MS]
    result["hits_within_ms"] = MAX_OFFSET_MS
    result["hits_ok"] = f"{len(rows) - len(bad)}/{len(rows)}"
    for r in bad:
        fail(f"{r['cue']} at {r['t']:.3f} s: attack {r['offset_ms']:+.1f} ms off")

    # 3. The perception device: inside a scan the band loses its top end, then slams back.
    band = sum(stems[k] for k in ("drums", "bass", "music"))
    hf = _hf_energy(band)
    scans = []
    for e in plan.of("scan"):

        def level(a: float, b: float) -> float:
            seg = hf[int(a * SR) : int(b * SR)]
            return 10 * np.log10(seg.mean() + 1e-15) if len(seg) else float("nan")

        inside = level(e.t0 + 0.15, e.t1 - 0.03)
        before = level(max(0.0, e.t0 - 1.0), e.t0 - 0.02)
        after = level(e.t1 + 0.002, e.t1 + 0.25)
        row = {
            "from": round(e.t0, 3),
            "to": round(e.t1, 3),
            "drop_db": round(float(before - inside), 1),
            "slam_db": round(float(after - inside), 1),
        }
        scans.append(row)
        if row["drop_db"] < SCAN_MIN_DROP_DB or row["slam_db"] < SCAN_MIN_DROP_DB:
            fail(
                f"scan {e.t0:.2f}-{e.t1:.2f}: drop {row['drop_db']} dB, slam {row['slam_db']} dB "
                f"(need >= {SCAN_MIN_DROP_DB})"
            )
    result["scans"] = scans

    # 4. Silences: the gap before the drop and the cut-out are silent on every stem.
    everything = sum(stems.values())
    quiet = []
    for e in plan.of("window"):
        if e.data.get("mood") in ("gap", "stop"):
            start = e.t0 + (0.34 if e.data.get("mood") == "stop" else 0.0)
            seg = everything[int(start * SR) : int(e.t1 * SR) - int(0.003 * SR)]
            peak = 20 * np.log10(np.max(np.abs(seg)) + 1e-12) if len(seg) else -200.0
            quiet.append(
                {
                    "mood": e.data["mood"],
                    "from": round(start, 3),
                    "to": round(e.t1, 3),
                    "peak_db": round(float(peak), 1),
                }
            )
            if peak > -60.0:
                fail(f"{e.data['mood']} window at {start:.2f} s peaks at {peak:.1f} dBFS")
    result["silences"] = quiet

    # 5. After the button: only the button's own tail, gone before the film ends.
    if plan.of("button"):
        tail = everything[int((plan.length - 0.25) * SR) :]
        peak = 20 * np.log10(np.max(np.abs(tail)) + 1e-12) if len(tail) else -200.0
        result["end_peak_db"] = round(float(peak), 1)
        if peak > -40.0:
            fail(f"the button still rings at the end ({peak:.1f} dBFS)")
    return result
