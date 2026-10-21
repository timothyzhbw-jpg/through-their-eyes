# /// script
# requires-python = ">=3.11,<3.12"
# dependencies = ["numpy>=2.1", "scipy>=1.14", "pretty_midi>=0.2.10"]
# ///
"""Compose, render, mix and master the trailer's original score (SPEC 10).

    uv run video/score/score.py --cues video/score/cues/v7.json --trailer video/trailer.json

writes, for each variant, `out/score/<variant>/score.wav` (mastered, 48 kHz / 24-bit),
`stems/{drums,bass,music,fx}.wav` and a report. `--check` resolves the cue sheet against the
trailer spec and prints it, without rendering. See README.md in this folder.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import check  # noqa: E402
import dsp  # noqa: E402
from analyze import band_levels, section_loudness  # noqa: E402
from dsp import SR, db  # noqa: E402
from sf import FluidRenderer, Note  # noqa: E402
from timeline import Cut, Plan  # noqa: E402

REPO = HERE.parent.parent
STEMS = ("drums", "bass", "music", "fx")
VARIANTS = ("grime", "hybrid")


def place(buf: np.ndarray, t: float, sig: np.ndarray, gain_db: float = 0.0, pan: float = 0.0):
    """Add `sig` (mono, panned; or stereo, balanced) into `buf` starting at t seconds."""
    if sig.ndim == 1:
        sig = dsp.pan(sig, pan)
    elif pan:
        sig = sig * np.array([min(1.0, 1 - pan), min(1.0, 1 + pan)])
    i = int(round(t * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * db(gain_db)


class Score:
    """Four stereo stems plus the SoundFont notes still to render."""

    def __init__(self, length: float):
        self.length = length
        self.n = int(round(length * SR))
        self.stems = {k: np.zeros((self.n + SR * 3, 2)) for k in STEMS}
        self.fluid: dict[tuple[str, str, bool], list[Note]] = defaultdict(list)
        self.fluid_gain: dict[tuple[str, str, bool], float] = {}
        self.post: list[tuple] = []

    def add(self, stem: str, t: float, sig: np.ndarray, gain_db: float = 0.0, pan: float = 0.0):
        place(self.stems[stem], t, sig, gain_db, pan)

    def add_after_masks(
        self, stem: str, t: float, sig: np.ndarray, gain_db: float = 0.0, pan: float = 0.0
    ):
        """Sounds that must survive the silences (the button, the drop)."""
        self.post.append((stem, t, sig, gain_db, pan))

    def note(
        self,
        stem: str,
        layer: str,
        pitch: int,
        t: float,
        dur: float,
        vel: int,
        gain_db: float = 0.0,
        post: bool = False,
    ):
        """A SoundFont note; `post` ones are mixed in after the silences (the button)."""
        key = (stem, layer, post)
        self.fluid[key].append(Note(int(pitch), float(t), float(dur), int(vel)))
        self.fluid_gain.setdefault(key, gain_db)


# --- mix-level devices ------------------------------------------------------------------------


def _ramp_env(n: int, windows, rise: float, fall: float) -> np.ndarray:
    """0..1 envelope: up over `rise` s at each window's start, down over `fall` s at its end."""
    w = np.zeros(n)
    for t0, t1 in windows:
        i0, i1 = int(t0 * SR), int(t1 * SR)
        r, f = max(1, int(rise * SR)), max(1, int(fall * SR))
        seg = np.ones(max(0, i1 - i0))
        seg[: min(r, len(seg))] = np.linspace(0, 1, min(r, len(seg)))
        w[i0:i1] = np.maximum(w[i0:i1], seg[: max(0, min(i1, n) - i0)])
        tail = np.linspace(1, 0, f)
        w[i1 : i1 + f] = np.maximum(w[i1 : i1 + f], tail[: max(0, min(n, i1 + f) - i1)])
    return w


def muffle(x: np.ndarray, windows, cutoff: float = 800.0, gain_db: float = -10.0) -> np.ndarray:
    """The perception device: inside a scan the band is heard through a wall, then slams back."""
    if not windows:
        return x
    w = _ramp_env(len(x), windows, rise=0.08, fall=0.006)[:, None]
    wet = dsp.lowpass(x, cutoff, 4) * db(gain_db)
    return x * (1 - w) + wet * w


def darken(x: np.ndarray, windows, cutoff: float = 2200.0, gain_db: float = -2.5) -> np.ndarray:
    if not windows:
        return x
    w = _ramp_env(len(x), windows, rise=0.12, fall=0.05)[:, None]
    return x * (1 - w) + dsp.lowpass(x, cutoff, 2) * db(gain_db) * w


def rewind(x: np.ndarray, t0: float, t1: float, speed: float = 3.0) -> np.ndarray:
    """Replace [t0, t1] with the preceding audio played backwards, `speed` times as fast."""
    i0, i1 = int(t0 * SR), int(t1 * SR)
    span = i1 - i0
    src0 = max(0, i0 - int(span * speed))
    src = x[src0:i0][::-1]
    pos = np.linspace(0, len(src) - 1, span)
    out = np.stack([np.interp(pos, np.arange(len(src)), src[:, c]) for c in range(2)], axis=1)
    out = dsp.lowpass(out, 7000.0, 2) * np.linspace(0.7, 1.0, span)[:, None]
    fade = int(0.012 * SR)
    out[:fade] *= np.linspace(0, 1, fade)[:, None]
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    y = x.copy()
    edge = int(0.008 * SR)
    y[i0 - edge : i0] *= np.linspace(1, 0, edge)[:, None]
    y[i1 : i1 + edge] *= np.linspace(0, 1, min(edge, len(y) - i1))[:, None]
    y[i0:i1] = out
    return y


def tape_stop(x: np.ndarray, t0: float, seconds: float = 0.32) -> np.ndarray:
    i0, n = int(t0 * SR), int(seconds * SR)
    tau = np.arange(n) / SR
    pos = i0 + (tau - tau**2 / (2 * seconds)) * SR
    seg = np.stack([np.interp(pos, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)
    seg *= np.linspace(1, 0, n)[:, None] ** 0.5
    y = x.copy()
    y[i0 : i0 + n] = seg
    return y


def silence(x: np.ndarray, t0: float, t1: float, fade: float = 0.008) -> np.ndarray:
    y = x.copy()
    i0, i1, f = int(t0 * SR), int(t1 * SR), int(fade * SR)
    y[i0:i1] = 0.0
    y[max(0, i0 - f) : i0] *= np.linspace(1, 0, min(f, i0))[:, None]
    back = min(int(0.002 * SR), max(0, len(y) - i1))
    y[i1 : i1 + back] *= np.linspace(0, 1, back)[:, None]
    return y


def suck_out(
    x: np.ndarray, times: list[float], seconds: float = 0.075, depth_db: float = -12.0
) -> np.ndarray:
    """Dip everything just before a hit, so the hit lands on air."""
    g = np.ones(len(x))
    n = int(seconds * SR)
    shape = 1 - (1 - db(depth_db)) * np.sin(np.linspace(0, np.pi / 2, n)) ** 2
    for t in times:
        i1 = int(t * SR)
        i0 = max(0, i1 - n)
        g[i0:i1] = np.minimum(g[i0:i1], shape[n - (i1 - i0) :])
    return x * g[:, None]


def sidechain(
    x: np.ndarray, kicks: list[float], depth_db: float, release: float = 0.14
) -> np.ndarray:
    if not kicks or depth_db <= 0:
        return x
    g = np.ones(len(x))
    curve_n = int(release * 3 * SR)
    t = np.arange(curve_n) / SR
    dip = 1 - (1 - db(-depth_db)) * np.exp(-t / release) * np.minimum(1, t / 0.004 + 0.3)
    for k in kicks:
        i = int(k * SR)
        j = min(len(g), i + curve_n)
        if i < len(g):
            g[i:j] = np.minimum(g[i:j], dip[: j - i])
    return x * g[:, None]


# --- the variant pipeline --------------------------------------------------------------------


def load_cut(path: Path | None, cues: dict) -> Cut:
    """The trailer spec the cue sheet was written against: a file, or `trailer_ref` from git."""
    if path is not None:
        return Cut.load(path)
    ref = cues.get("trailer_ref")
    if not ref:
        return Cut.load(REPO / "video" / "trailer.json")
    import subprocess

    text = subprocess.run(
        ["git", "-C", str(REPO), "show", ref], check=True, capture_output=True, text=True
    ).stdout
    return Cut(json.loads(text))


def load_assets(out: Path) -> tuple[Path, str]:
    """The SoundFont, checked against video/score/assets.json."""
    meta = json.loads((HERE / "assets.json").read_text())["soundfont"]
    path = out / "assets" / meta["extract"]
    if not path.exists():
        raise SystemExit(
            f"missing {path}: download {meta['url']} (sha256 {meta['archive_sha256']}) into "
            f"{out / 'assets'} and extract {meta['member']}; see video/score/README.md"
        )
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != meta["sha256"]:
        raise SystemExit(f"{path}: sha256 {digest} does not match assets.json")
    return path, digest


def build(variant: str, plan: Plan, renderer: FluidRenderer) -> tuple[Score, object]:
    if variant == "grime":
        from grime import Grime as Arr
    else:
        from hybrid import Hybrid as Arr
    score = Score(plan.length)
    arr = Arr(score, plan)
    arr.run()
    for (stem, layer, post), notes in sorted(score.fluid.items()):
        audio = renderer.render(layer, notes, len(score.stems[stem]) / SR)
        audio = arr.layer_fx(layer, audio) * db(score.fluid_gain[(stem, layer, post)])
        if post:
            score.add_after_masks(stem, 0.0, audio)
        else:
            score.stems[stem] += audio
    return score, arr


def mix(score: Score, plan: Plan, arr) -> dict[str, np.ndarray]:
    st = score.stems
    bus = arr.bus_settings()
    rev_rng = np.random.Generator(np.random.PCG64(7))
    room = dsp.reverb_ir(0.9, rev_rng, 8.0, 7000.0)
    hall = dsp.reverb_ir(2.2, rev_rng, 18.0, 5500.0)

    out = {}
    d = dsp.widen(dsp.highpass(st["drums"], 30.0, 2), bus.get("drums_width", 1.3), 500.0)
    d = dsp.compress(d, bus["drums_thresh"], 3.0, 6.0, 90.0, makeup_db=0.0)
    d = d + dsp.convolve(dsp.highpass(d, 250.0), room) * bus["drums_room"]
    out["drums"] = d * db(bus.get("drums_gain", 0.0))

    b = dsp.highpass(st["bass"], 27.0, 4)
    b = sidechain(b, arr.kicks, bus["bass_duck"], 0.11)
    out["bass"] = b * db(bus.get("bass_gain", 0.0))

    m = dsp.widen(dsp.highpass(st["music"], bus["music_hp"], 2), bus.get("music_width", 1.6))
    m = dsp.eq(m, "peak", 2600.0, -2.0, 1.0)  # room for the voice-over
    m = m + dsp.convolve(dsp.highpass(m, 300.0), hall) * bus["music_hall"]
    m = sidechain(m, arr.kicks, bus["music_duck"], 0.16)
    out["music"] = m * db(bus.get("music_gain", 0.0))

    f = dsp.highpass(st["fx"], 28.0, 2)
    out["fx"] = (f + dsp.convolve(dsp.highpass(f, 200.0), hall) * bus["fx_hall"]) * db(
        bus.get("fx_gain", 0.0)
    )

    # A breath of air before each big hit: everything dips for a few tens of ms.
    big = [
        e.t0
        for e in plan.events
        if e.type == "drop" or (e.type == "hit" and e.data.get("size") == "big")
    ]
    for name in STEMS:
        out[name] = suck_out(out[name], big)

    # Windows from the cue sheet, the same on every stem so the stems still add up.
    scans = [(e.t0, e.t1 - 0.006) for e in plan.of("scan")]
    darks = [(e.t0, e.t1) for e in plan.of("window") if e.data.get("mood") == "without"]
    for name in STEMS:
        x = out[name]
        if name != "fx":
            x = muffle(x, scans)
        if name == "music":
            x = darken(x, darks)
        for e in plan.of("rewind"):
            x = rewind(x, e.t0, e.t1)
        for e in plan.of("window"):
            if e.data.get("mood") == "stop":
                x = silence(tape_stop(x, e.t0), e.t0 + 0.32, e.t1)
            elif e.data.get("mood") == "gap":
                x = silence(x, e.t0, e.t1, 0.02)
        for e in plan.of("button"):
            x = silence(x, e.t0, len(x) / SR, 0.004)
        out[name] = x
    for stem, t, sig, gain_db, pan in score.post:
        place(out[stem], t, sig, gain_db, pan)
    for e in plan.of("button"):  # a clean button: the tail is gone well before the film ends
        hold, end = e.t0 + 0.7, min(e.t0 + 1.5, plan.length - 0.1)
        i0, i1 = int(hold * SR), int(end * SR)
        for name in STEMS:
            if i1 > i0:
                out[name][i0:i1] *= np.linspace(1, 0, i1 - i0)[:, None] ** 2
            out[name][i1:] = 0.0
    n = score.n
    return {k: v[:n] for k, v in out.items()}


def master(stems: dict[str, np.ndarray], target_lufs: float, ceiling_db: float):
    """Bus glue, then gain and a true-peak limiter until the loudness sits on the target."""
    total = sum(stems.values())
    glued = dsp.compress(total, -16.0, 1.6, 15.0, 160.0)
    gain = target_lufs - dsp.loudness(glued)
    for _ in range(5):
        y = dsp.limit(glued * db(gain), ceiling_db - 0.3)
        miss = target_lufs - dsp.loudness(y)
        if abs(miss) < 0.05:
            break
        gain += miss
    fade = int(0.05 * SR)
    y[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return y, gain


def report_row(name: str, x: np.ndarray) -> dict:
    return {
        "stem": name,
        "lufs": round(dsp.loudness(x), 2),
        "true_peak_db": round(dsp.true_peak_db(x), 2),
    }


def render_variant(
    variant: str, plan: Plan, renderer: FluidRenderer, out: Path, target: float, ceiling: float
):
    started = time.time()
    score, arr = build(variant, plan, renderer)
    stems = mix(score, plan, arr)
    mastered, gain = master(stems, target, ceiling)
    folder = out / variant
    (folder / "stems").mkdir(parents=True, exist_ok=True)
    dsp.write_wav(folder / "score.wav", mastered)
    stem_sum = sum(stems.values())
    stem_gain = db(-1.0) / max(1e-9, float(np.max(np.abs(stem_sum))))
    rows = [report_row("score", mastered)]
    for name, x in stems.items():
        dsp.write_wav(folder / "stems" / f"{name}.wav", x * stem_gain)
        rows.append(report_row(name, x * stem_gain))
    info = {
        "variant": variant,
        "length_s": round(len(mastered) / SR, 3),
        "lufs": round(dsp.loudness(mastered), 2),
        "true_peak_db": round(dsp.true_peak_db(mastered), 2),
        "stems_gain_db": round(dsp.to_db(stem_gain), 2),
        "stems": rows,
        "kicks": len(arr.kicks),
        "sections_lufs": dict(section_loudness(mastered, plan.sections)),
        "bands_db": band_levels(mastered),
        "checks": check.run(plan, mastered, stems),
        "seconds": round(time.time() - started, 1),
        "sha256": hashlib.sha256((folder / "score.wav").read_bytes()).hexdigest(),
    }
    (folder / "report.json").write_text(json.dumps(info, indent=2) + "\n")
    return info


def write_report(out: Path, plan: Plan, cues_path: Path) -> None:
    """out/score/report.md: both variants side by side, then the cue sheet as resolved."""
    infos = [
        json.loads((out / v / "report.json").read_text())
        for v in VARIANTS
        if (out / v / "report.json").exists()
    ]
    lines = ["# Score report", "", f"Cue sheet: `{cues_path.name}`. " + plan.describe()[0], ""]
    lines += [
        "| | " + " | ".join(i["variant"] for i in infos) + " |",
        "|---|" + "---|" * len(infos),
    ]

    def row(label, fn):
        lines.append(f"| {label} | " + " | ".join(str(fn(i)) for i in infos) + " |")

    row("integrated loudness (LUFS)", lambda i: i["lufs"])
    row("true peak (dBTP)", lambda i: i["true_peak_db"])
    row("hits on picture (within 10 ms)", lambda i: i["checks"]["hits_ok"])
    row(
        "scan: top end down / back (dB)",
        lambda i: ", ".join(f"{s['drop_db']}/{s['slam_db']}" for s in i["checks"]["scans"]),
    )
    row(
        "silences (peak dBFS)",
        lambda i: ", ".join(str(s["peak_db"]) for s in i["checks"]["silences"]),
    )
    row(
        "checks",
        lambda i: "PASS" if i["checks"]["pass"] else "FAIL: " + "; ".join(i["checks"]["notes"]),
    )
    for sec in plan.sections:
        row(f"section {sec.id} (LUFS)", lambda i, sec=sec: i["sections_lufs"].get(sec.id))
    row(
        "octave bands re 125 Hz (63…16k)",
        lambda i: " ".join(f"{v:+.0f}" for v in i["bands_db"].values()),
    )
    row("sha256 (score.wav)", lambda i: i["sha256"][:16])
    lines += [
        "",
        "## Hits",
        "",
        "| cue | t (s) | " + " | ".join(f"{i['variant']} (ms)" for i in infos) + " | note |",
        "|---|---|" + "---|" * len(infos) + "---|",
    ]
    if infos:
        for k, h in enumerate(infos[0]["checks"]["hits"]):
            offs = " | ".join(f"{i['checks']['hits'][k]['offset_ms']:+.1f}" for i in infos)
            lines.append(f"| {h['cue']} | {h['t']:.3f} | {offs} | {h['note']} |")
    lines += ["", "## Cue sheet as resolved", "", "```", *plan.describe(), "```", ""]
    (out / "report.md").write_text("\n".join(lines))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--trailer", type=Path, help="trailer spec (default: the cue sheet's trailer_ref from git)"
    )
    ap.add_argument("--cues", type=Path, default=HERE / "cues" / "v7.json")
    ap.add_argument("--variant", choices=(*VARIANTS, "all"), default="all")
    ap.add_argument("--out", type=Path, default=REPO / "out" / "score")
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--ceiling", type=float, default=-1.0, help="true-peak ceiling, dBTP")
    ap.add_argument("--check", action="store_true", help="resolve the cue sheet and print it")
    args = ap.parse_args(argv)

    cues = json.loads(args.cues.read_text())
    plan = Plan(load_cut(args.trailer, cues), cues)
    print("\n".join(plan.describe()))
    if args.check:
        return 0
    sf_path, sf_sha = load_assets(args.out)
    renderer = FluidRenderer(sf_path, args.out / "cache", sf_sha)
    ok = True
    for variant in VARIANTS if args.variant == "all" else (args.variant,):
        info = render_variant(variant, plan, renderer, args.out, args.lufs, args.ceiling)
        c = info["checks"]
        ok = ok and c["pass"]
        print(
            f"{variant}: {info['length_s']} s, {info['lufs']} LUFS, {info['true_peak_db']} dBTP, "
            f"hits {c['hits_ok']} within {c['hits_within_ms']:g} ms, "
            f"scans {[s['drop_db'] for s in c['scans']]} dB down "
            f"-> {'PASS' if c['pass'] else 'FAIL'} ({info['seconds']} s)"
        )
        for note in c["notes"]:
            print(f"  - {note}")
    write_report(args.out, plan, args.cues)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
