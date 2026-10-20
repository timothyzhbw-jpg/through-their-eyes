"""Scan-detector eval (SPEC 4.7): sweep the head angular-velocity threshold against sim truth.

    uv run python -m eval.scan_detector

Ground truth: the sim's `scan` events are the positives; its `head_turn` events (partial,
aborted scans: not scans, sim.perception) are labelled negatives, so a detection on one is a
false positive. A detection matches a true scan of the same player when their onset frames
are at most TOLERANCE_FRAMES apart, one to one, closest pairs first. The threshold and the
minimum excursion are chosen by F1 on tuning seeds with nuisance on; held-out seeds are then
reported with and without nuisance. Writes eval/reports/scan_detector.md.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from analytics.scan_detector import ScanDetectorParams, detect_all
from sim.config import SimParams
from sim.engine import Simulation

REPORTS = Path(__file__).parent / "reports"

THRESHOLDS_DEG = tuple(range(125, 301, 25))  # deg/s
MIN_EXCURSIONS_DEG = tuple(range(20, 81, 5))  # deg, tuned together with the threshold
# +-3 frames (0.12 s): an onset can be off by a frame or two through sensor noise, and the
# window is far shorter than the gap between two scans of one player (>= 0.6 s), so one
# detection can never match two scans.
TOLERANCE_FRAMES = 3
# The sim emits a scan event only once the head is back, so scans still under way when a run stops
# are missing from the truth. Onsets in the last second are left out of the scoring: no sim scan
# lasts longer (out <= 0.5 s, dwell <= 0.18 s, back <= 0.25 s).
END_GUARD_S = 1.0
BALL_MOVING = 2.0  # m/s, for the error breakdown only

POSSESSION_PARAMS = replace(SimParams(), max_duration_s=45.0)
TUNING = (("possession_play", range(0, 10)), ("blind_side_run", range(0, 20)))
HELD_OUT = (("possession_play", range(100, 120)), ("blind_side_run", range(100, 140)))
CONDITIONS = {
    "full nuisance": {},
    "sensor noise only": {"head_nuisance": False},
    "clean": {"head_nuisance": False, "sensor_noise": 0.0},
}
CONDITION_NOTES = {
    "full nuisance": "default sim: sensor noise (2°), partial scans, slow drift, ball tracking",
    "sensor noise only": "no partial scans or drift: the sim before head nuisance was added",
    "clean": "no head nuisance and no sensor noise",
}
# Harder than the default sim, scored with the detector chosen above (not re-tuned).
STRESS = {
    "partial scans up to 70° (the smallest full scan)": {
        "partial_scan_amplitude": (np.deg2rad(10.0), np.deg2rad(70.0))
    },
    "partial scans up to 90° (overlap full scans)": {
        "partial_scan_amplitude": (np.deg2rad(10.0), np.deg2rad(90.0))
    },
    "twice as many partial scans": {"partial_scan_ratio": 1.0},
    "drift std 15°": {"drift_sigma": np.deg2rad(15.0)},
    "sensor noise 5°": {"sensor_noise": np.deg2rad(5.0)},
}


@dataclass
class Sample:
    scenario: str
    seed: int
    dt: float
    head_yaw: np.ndarray  # (F, N) observed (tracking output), rad
    pos: np.ndarray  # (F, N, 2)
    ball: np.ndarray  # (F, 2)
    truth: list[list[int]]  # per player: onset frames of scans
    head_turns: list[list[int]]  # per player: onset frames of head turns (labelled negatives)

    @property
    def seconds(self) -> float:
        return len(self.ball) * self.dt


@dataclass
class Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    fp_head_turn: int = 0  # false positives on a head turn (a labelled negative)
    fp_ball_moving: int = 0
    fn_ball_moving: int = 0

    def __add__(self, other: Counts) -> Counts:
        return Counts(
            *(a + b for a, b in zip(vars(self).values(), vars(other).values(), strict=True))
        )

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0


def scenario_params(scenario: str, **overrides) -> SimParams:
    base = POSSESSION_PARAMS if scenario == "possession_play" else SimParams()
    return replace(base, **overrides)


def simulate(scenario: str, seed: int, params: SimParams) -> Sample:
    run = Simulation.from_scenario(scenario, seed, params=params).run()
    n = len(run.players)
    truth: list[list[int]] = [[] for _ in range(n)]
    head_turns: list[list[int]] = [[] for _ in range(n)]
    for e in run.events:
        if e.type in ("scan", "head_turn"):
            (truth if e.type == "scan" else head_turns)[run.index(e.player)].append(e.frame)
    return Sample(
        scenario, seed, run.dt, run.head_yaw_observed, run.pos, run.ball_pos[:, :2], truth,
        head_turns,
    )  # fmt: skip


def match(
    truth: list[int], detected: list[int], tolerance: int
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """One-to-one matching of onset frames, closest pairs first: (pairs, false pos, missed)."""
    candidates = sorted(
        (abs(d - t), t, d) for t in truth for d in detected if abs(d - t) <= tolerance
    )
    used_t: set[int] = set()
    used_d: set[int] = set()
    pairs = []
    for _, t, d in candidates:
        if t not in used_t and d not in used_d:
            used_t.add(t)
            used_d.add(d)
            pairs.append((t, d))
    return (
        sorted(pairs),
        [d for d in detected if d not in used_d],
        [t for t in truth if t not in used_t],
    )


def _scored(sample: Sample, onsets: list[int]) -> list[int]:
    last = len(sample.ball) - 1 - round(END_GUARD_S / sample.dt)
    return [f for f in onsets if f <= last]


def score(
    samples: list[Sample], params: ScanDetectorParams, tolerance: int = TOLERANCE_FRAMES
) -> Counts:
    total = Counts()
    for s in samples:
        ball_speed = np.linalg.norm(np.diff(s.ball, axis=0, append=s.ball[-1:]), axis=-1) / s.dt
        for i, scans in enumerate(detect_all(s.head_yaw, s.pos, s.ball, s.dt, params)):
            detected = _scored(s, [d.start for d in scans])
            pairs, false_pos, missed = match(_scored(s, s.truth[i]), detected, tolerance)
            on_turn = [
                d for d in false_pos if any(abs(d - h) <= tolerance for h in s.head_turns[i])
            ]
            total += Counts(
                tp=len(pairs),
                fp=len(false_pos),
                fn=len(missed),
                fp_head_turn=len(on_turn),
                fp_ball_moving=int(np.sum(ball_speed[false_pos] > BALL_MOVING)),
                fn_ball_moving=int(np.sum(ball_speed[missed] > BALL_MOVING)),
            )
    return total


def detector(threshold_deg: float, min_excursion_deg: float, **kw) -> ScanDetectorParams:
    return ScanDetectorParams(
        omega_threshold=np.deg2rad(threshold_deg), min_excursion=np.deg2rad(min_excursion_deg), **kw
    )


def velocity_only(threshold_deg: float) -> ScanDetectorParams:
    """The literature reading: any fast turn away from the ball and back, however small."""
    return detector(threshold_deg, 0.0, return_tolerance=np.deg2rad(2.0))


def samples_for(seed_sets, **overrides) -> list[Sample]:
    return [
        simulate(scenario, seed, scenario_params(scenario, **overrides))
        for scenario, seeds in seed_sets
        for seed in seeds
    ]


def tune(samples: list[Sample]) -> tuple[float, float, dict[float, tuple[float, Counts]]]:
    """Best (threshold, min excursion) by F1; ties go to the higher threshold, then the lower
    excursion. Also returns, per threshold, its best excursion and counts."""
    grid = {
        (t, m): score(samples, detector(t, m)) for t in THRESHOLDS_DEG for m in MIN_EXCURSIONS_DEG
    }
    best_t, best_m = max(grid, key=lambda k: (round(grid[k].f1, 4), k[0], -k[1]))
    per_threshold = {}
    for t in THRESHOLDS_DEG:
        m = max(MIN_EXCURSIONS_DEG, key=lambda m: (round(grid[(t, m)].f1, 4), -m))
        per_threshold[t] = (m, grid[(t, m)])
    return best_t, best_m, per_threshold


def _prf(c: Counts) -> str:
    return f"{c.precision:.3f} | {c.recall:.3f} | **{c.f1:.3f}**"


def _seed_text(seed_sets) -> str:
    return ", ".join(f"`{name}` {s[0]}–{s[-1]} ({len(s)})" for name, s in seed_sets)


def evaluate() -> str:
    tuning = samples_for(TUNING)
    best_t, best_m, per_threshold = tune(tuning)
    chosen = detector(best_t, best_m)
    held = {name: samples_for(HELD_OUT, **kw) for name, kw in CONDITIONS.items()}
    sweep = {
        name: {t: score(samples, detector(t, best_m)) for t in THRESHOLDS_DEG}
        for name, samples in held.items()
    }
    nuisance = held["full nuisance"]
    ablation = {t: score(nuisance, velocity_only(t)) for t in THRESHOLDS_DEG}
    stress = {name: score(samples_for(HELD_OUT, **kw), chosen) for name, kw in STRESS.items()}
    final = sweep["full nuisance"][best_t]
    truth = sum(len(_scored(s, t)) for s in nuisance for t in s.truth)
    turns = sum(len(_scored(s, h)) for s in nuisance for h in s.head_turns)
    minutes = sum(s.seconds for s in nuisance) / 60
    ok = "✅ meets" if final.f1 >= 0.85 else "❌ misses"
    f1s = [c.f1 for c in sweep["full nuisance"].values()]
    per_true = {t: (c.tp + c.fp) / max(c.tp + c.fn, 1) for t, c in ablation.items()}
    hardest, hardest_f1 = min(((k, c.f1) for k, c in stress.items()), key=lambda kv: kv[1])
    cap = np.rad2deg(SimParams().head_omega_max)
    lo_p, hi_p = np.rad2deg(SimParams().partial_scan_amplitude)
    lo_full = np.rad2deg(SimParams().scan_amplitude[0])

    lines = [
        "# Scan detector — threshold sweep (SPEC 4.7)",
        "",
        "`uv run python -m eval.scan_detector`. Detector: `analytics/scan_detector.py` (head yaw "
        "plus player and ball positions only, no sim state).",
        "",
        "| | Value |",
        "|---|---|",
        f"| Chosen threshold (tuning seeds, nuisance on) | **{best_t}°/s** |",
        f"| Chosen minimum excursion | **{best_m}°** |",
        f"| Held-out F1, nuisance on | **{final.f1:.3f}** — {ok} the SPEC target ≥ 0.85 |",
        f"| Held-out F1, sensor noise only / clean | {sweep['sensor noise only'][best_t].f1:.3f} "
        f"/ {sweep['clean'][best_t].f1:.3f} |",
        f"| Held-out data, nuisance on | {minutes:.1f} min of play, 22 players, {truth} scans, "
        f"{turns} head turns (partial scans) |",
        "",
        "## Reading",
        "",
        f"- **The threshold barely matters once the excursion gate is in.** Held-out F1 stays "
        f"between {min(f1s):.3f} and {max(f1s):.3f} over {THRESHOLDS_DEG[0]}–{THRESHOLDS_DEG[-1]}"
        f"°/s. Every genuine sim scan turns at the head's speed cap ({cap:.0f}°/s) within a "
        "frame, so the threshold only decides which noise-driven onsets get looked at; the "
        f"choice of {best_t}°/s is weakly determined (it wins the tie-break).",
        f"- **The literature's over-count is reproduced without the gate**: a velocity-only "
        f"detector finds {per_true[THRESHOLDS_DEG[0]]:.2f} detections per true scan at "
        f"{THRESHOLDS_DEG[0]}°/s and {per_true[THRESHOLDS_DEG[-1]]:.2f} at "
        f"{THRESHOLDS_DEG[-1]}°/s (sensor noise and partial scans).",
        f"- **What limits the score is the sim, not the detector.** Partial scans turn "
        f"{lo_p:.0f}–{hi_p:.0f}° and full scans at least {lo_full:.0f}°, and the tuned "
        f"{best_m}° gate sits in that gap. Close the gap and F1 falls (worst stress row: "
        f"{hardest_f1:.3f}, {hardest}). Real tracking has no such gap by construction, so read "
        f"{final.f1:.3f} as the score on this sim, not as a claim about real data.",
        "",
        "## Method",
        "",
        f"- Tuning seeds: {_seed_text(TUNING)}. Held-out seeds: {_seed_text(HELD_OUT)}. "
        "`possession_play` runs 45 s (ends early if the ball goes out); `blind_side_run` is the "
        "~6 s hero scenario.",
        "- Ground truth: sim `scan` events are the positives. Partial (aborted) scans are not "
        "scans — the head comes straight back before the ball leaves the binocular cone — and "
        "the sim emits them as `head_turn` events: labelled negatives, so a detection on one is "
        "a false positive.",
        f"- Matching: same player, onset frames at most ±{TOLERANCE_FRAMES} frames "
        f"({TOLERANCE_FRAMES * 40} ms) apart, one to one, closest pairs first. Onsets in the "
        f"last {END_GUARD_S:.0f} s of a run are not scored: the sim emits a scan only once the "
        "head is back, so scans under way when a run stops are missing from the truth.",
        f"- Tuning grid: threshold {THRESHOLDS_DEG[0]}–{THRESHOLDS_DEG[-1]}°/s in steps of 25 × "
        f"minimum excursion {MIN_EXCURSIONS_DEG[0]}–{MIN_EXCURSIONS_DEG[-1]}° in steps of 5. "
        "Highest F1 wins; ties go to the higher threshold, then the lower excursion. Other "
        "detector constants are fixed: return tolerance 15°, the head must pass it within 2 "
        "frames of the onset, at most 1.5 s from onset to return.",
        "- Conditions (held-out only; same seeds, so the same plays):",
        *(f"  - *{name}*: {CONDITION_NOTES[name]}" for name in CONDITIONS),
        "",
        f"## Held-out sweep at minimum excursion {best_m}°",
        "",
        "| Threshold (°/s) | P | R | F1 — full nuisance | P | R | F1 — sensor noise only "
        "| P | R | F1 — clean |",
        "|---|---|---|---|---|---|---|---|---|---|",
        *(
            f"| {t}{' ⬅' if t == best_t else ''} | "
            + " | ".join(_prf(sweep[name][t]) for name in CONDITIONS)
            + " |"
            for t in THRESHOLDS_DEG
        ),
        "",
        "## Tuning seeds: best minimum excursion per threshold (nuisance on)",
        "",
        "| Threshold (°/s) | Best min. excursion (°) | P | R | F1 |",
        "|---|---|---|---|---|",
        *(f"| {t} | {m} | {_prf(c)} |" for t, (m, c) in per_threshold.items()),
        "",
        "## Ablation: velocity threshold only (held-out, nuisance on)",
        "",
        "No excursion gate: any turn away from the ball faster than the threshold that comes back "
        "within 1.5 s (return tolerance 2°, about the sensor noise) counts as a scan — the "
        "reading under which the literature's 125°/s over-counts.",
        "",
        "| Threshold (°/s) | P | R | F1 | Detections per true scan |",
        "|---|---|---|---|---|",
    ]
    for t, c in ablation.items():
        lines.append(f"| {t} | {_prf(c)} | {per_true[t]:.2f} |")
    lines += [
        "",
        f"## Chosen detector ({best_t}°/s, {best_m}°): matching tolerance and scenarios "
        "(held-out, nuisance on)",
        "",
        "| Tolerance (frames) | P | R | F1 |",
        "|---|---|---|---|",
        *(f"| ±{k} | {_prf(score(nuisance, chosen, k))} |" for k in (1, 2, 3, 5)),
        "",
        "| Scenario | Scans | P | R | F1 |",
        "|---|---|---|---|---|",
    ]
    for name, _ in HELD_OUT:
        subset = [s for s in nuisance if s.scenario == name]
        c = score(subset, chosen)
        lines.append(f"| `{name}` | {c.tp + c.fn} | {_prf(c)} |")
    lines += [
        "",
        "## Stress test: harder head motion (held-out, chosen detector, not re-tuned)",
        "",
        "Each row changes one setting of the default (full nuisance) sim.",
        "",
        "| Change | P | R | F1 |",
        "|---|---|---|---|",
    ]
    for name, c in stress.items():
        lines.append(f"| {name} | {_prf(c)} |")
    lines += [
        "",
        "## Where the errors are (chosen detector, held-out, nuisance on)",
        "",
        "| | Count | On a `head_turn` | Ball moving > 2 m/s |",
        "|---|---|---|---|",
        f"| False positives | {final.fp} | {final.fp_head_turn} | {final.fp_ball_moving} |",
        f"| Missed scans | {final.fn} | — | {final.fn_ball_moving} |",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    report = evaluate()
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "scan_detector.md"
    path.write_text(report)
    print(report)
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
