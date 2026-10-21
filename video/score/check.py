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
MIN_SALIENCE = 1.0  # the cue's onset against the strongest quarter of accents around it
SCAN_MIN_DROP_DB = 12.0


def _hf_energy(x: np.ndarray, cutoff: float = 1000.0) -> np.ndarray:
    mono = stereo(x).mean(axis=1)
    hp = signal.sosfilt(signal.butter(4, cutoff, "highpass", fs=SR, output="sos"), mono)
    return hp**2


def onset_strength(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Spectral-flux onset strength (log-compressed magnitudes, positive differences summed over
    bins), one value per 128-sample hop, and the hop in seconds."""
    mono = stereo(x).mean(axis=1)
    hop = 128
    _, _, z = signal.stft(mono, SR, nperseg=1024, noverlap=1024 - hop, boundary=None, padded=False)
    mag = np.log1p(100.0 * np.abs(z))
    flux = np.maximum(0.0, np.diff(mag, axis=1)).sum(axis=0)
    # stft frame k is centred at k*hop + 512; the difference k-1 -> k belongs to frame k
    return np.concatenate([[0.0], flux]), hop / SR


def salience(x: np.ndarray, times: list[float], around: float = 1.0) -> list[tuple[float, float]]:
    """For each cue: (offset in ms of the strongest onset within -4..+12 ms, its strength over the
    75th percentile of the onset peaks within +-`around` s). 1.0 or more means the cue is among
    the strongest quarter of accents around it."""
    o, hop = onset_strength(x)
    centre = 512 / SR
    peaks = np.where((o[1:-1] > o[:-2]) & (o[1:-1] >= o[2:]))[0] + 1
    out = []
    for t in times:
        k0 = int(np.floor((t - 0.004 - centre) / hop))
        k1 = int(np.ceil((t + 0.012 - centre) / hop)) + 1
        if k0 < 1 or k1 >= len(o):
            out.append((float("nan"), 0.0))
            continue
        k = k0 + int(np.argmax(o[k0:k1]))
        near = peaks[
            (np.abs(peaks * hop + centre - t) <= around) & (np.abs(peaks * hop + centre - t) > 0.03)
        ]
        ref = np.percentile(o[near], 75) if len(near) else 1e-9
        out.append(((k * hop + centre - t) * 1000.0, float(o[k] / max(ref, 1e-9))))
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
    cues = [
        (e.type, e.t0, e.data["picture"], e.data.get("note", ""))
        for e in plan.events
        if e.type in ONSET_EVENTS
    ]
    cues += [
        ("scan-release", e.t1, e.data["picture"], e.data.get("note", "")) for e in plan.of("scan")
    ]
    cues.sort(key=lambda c: c[1])
    offsets = salience(mastered, [c[1] for c in cues])
    rows = []
    for (kind, t, picture, note), (off, sal) in zip(cues, offsets, strict=True):
        rows.append(
            {
                "cue": kind,
                "t": round(t, 3),
                "offset_ms": round(off, 1),
                "salience": round(sal, 2),
                "snap_ms": round((t - picture) * 1000, 1),
                "note": note,
            }
        )
    result["hits"] = rows
    # An accent on the cue: its onset is as strong as the top quarter of accents around it.
    bad = [r for r in rows if not r["salience"] >= MIN_SALIENCE]
    result["hits_salience"] = MIN_SALIENCE
    result["hits_ok"] = f"{len(rows) - len(bad)}/{len(rows)}"
    for r in bad:
        fail(
            f"{r['cue']} at {r['t']:.3f} s: onset {r['offset_ms']:+.1f} ms, "
            f"salience {r['salience']}"
        )

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
