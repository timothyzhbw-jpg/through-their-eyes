"""Blind-side alert eval (SPEC 4.4): tracking-only alerts against the sim's beliefs.

    uv run python -m eval.blind_side

Ground truth: stale-belief episodes. For a watched (observer, target) pair, an episode is a
stretch of frames in which the observer's belief about the target (`Simulation.beliefs`, sampled
before every step as sim/export.py does) is off by more than STALE_M and the target is within the
alert's `max_distance`, and in which the target ran at the alert's `min_speed` at least once: a
stale belief about a player who made a run. Speed and range say which situations matter, so truth
and alert share them; the alert has to infer the stale belief from tracking alone. Watched pairs
follow SPEC 4.4: the carrier and the intended receiver watch teammates, the defenders nearest the
ball watch opponents. In the truth the intended receiver is the pass event's `to`; the alert infers
him from the ball's line.

The unit is an alert interval: an alert is correct when it overlaps a truth interval of the same
pair (±TOLERANCE_S), and a truth interval is found when an alert overlaps it. Frame-level
precision and recall are reported too. Writes eval/reports/blind_side.md.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from analytics.blind_side import (
    DEFAULT_PARAMS,
    Alert,
    BlindSideParams,
    Roles,
    detect_alerts,
    observer_roles,
    visible_mask,
    watch_pairs,
)
from sim.config import DT, SimParams
from sim.engine import Simulation

REPORTS = Path(__file__).parent / "reports"

STALE_M = 3.0  # SPEC 4.4: a belief stale by more than 3 m
TOLERANCE_S = 0.5  # an alert and a truth interval of the same pair match if this close
# Truth intervals: gaps up to 0.2 s are bridged and shorter intervals dropped — a belief that is
# stale for a few frames is not something a live overlay could show.
BRIDGE_S = 0.2
MIN_TRUTH_S = 0.2
MIN_UNSEEN_S = (0.4, 0.6, 0.8, 1.0, 1.2, 1.5)
MIN_MOVED_M = (1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0)

POSSESSION_PARAMS = replace(SimParams(), max_duration_s=45.0)
TUNING = (("possession_play", range(0, 10)), ("blind_side_run", range(0, 20)))
HELD_OUT = (("possession_play", range(100, 120)), ("blind_side_run", range(100, 140)))


@dataclass
class Sample:
    scenario: str
    seed: int
    ids: list[str]
    team: np.ndarray  # (N,)
    head_yaw: np.ndarray  # (F, N) observed
    pos: np.ndarray  # (F, N, 2)
    vel: np.ndarray  # (F, N, 2)
    ball_pos: np.ndarray  # (F, 3)
    ball_vel: np.ndarray  # (F, 3)
    owner: np.ndarray  # (F,)
    belief_error: np.ndarray  # (F, N, N) m, observer's belief about target vs truth
    truth_roles: Roles  # with the intended receiver from the pass events
    seen: np.ndarray  # (F, N, N) visibility on the observed head yaw (cached)

    @property
    def seconds(self) -> float:
        return len(self.owner) * DT


@dataclass
class Counts:
    alerts: int = 0
    alerts_ok: int = 0
    truths: int = 0
    truths_found: int = 0
    frames_alert: int = 0
    frames_truth: int = 0
    frames_both: int = 0

    def __add__(self, other: Counts) -> Counts:
        return Counts(
            *(a + b for a, b in zip(vars(self).values(), vars(other).values(), strict=True))
        )

    @property
    def precision(self) -> float:
        return self.alerts_ok / self.alerts if self.alerts else 0.0

    @property
    def recall(self) -> float:
        return self.truths_found / self.truths if self.truths else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0

    @property
    def frame_precision(self) -> float:
        return self.frames_both / self.frames_alert if self.frames_alert else 0.0

    @property
    def frame_recall(self) -> float:
        return self.frames_both / self.frames_truth if self.frames_truth else 0.0


def _belief_error(sim: Simulation) -> np.ndarray:
    n = len(sim.ids)
    err = np.zeros((n, n))
    for i in range(n):
        believed, _, _ = sim.beliefs.estimate(i, sim.frame, DT, sim.params.belief_horizon_s)
        err[i] = np.linalg.norm(believed - sim.pos, axis=-1)
    return err


def _truth_receiver(run, frames: int) -> np.ndarray:
    receiver = np.full(frames, -1)
    for e in run.events:
        if e.type != "pass":
            continue
        end = e.attrs.get("end")
        for f in range(e.frame + 1, frames if end is None else min(int(end), frames - 1) + 1):
            if run.owner[f] < 0:
                receiver[f] = run.index(e.attrs["to"])
    return receiver


def simulate(scenario: str, seed: int) -> Sample:
    params = POSSESSION_PARAMS if scenario == "possession_play" else SimParams()
    sim = Simulation.from_scenario(scenario, seed, params=params)
    errors = []
    while not sim.done:
        errors.append(_belief_error(sim))
        sim.step()
    errors.append(_belief_error(sim))
    run = sim.result()
    team = np.array([p.team for p in run.players])
    roles = observer_roles(run.pos, run.ball_pos, run.ball_vel, run.owner, team, dt=DT)
    truth_roles = replace(roles, receiver=_truth_receiver(run, len(run.owner)))
    return Sample(
        scenario, seed, run.ids, team, run.head_yaw_observed, run.pos, run.vel, run.ball_pos,
        run.ball_vel, run.owner, np.array(errors), truth_roles,
        visible_mask(run.head_yaw_observed, run.pos, run.vel),
    )  # fmt: skip


def stale_mask(s: Sample, params: BlindSideParams, moving: float = 0.0) -> np.ndarray:
    """(F, N, N) bool: watched pair, belief stale by > STALE_M, target in range and at least
    `moving` m/s on that frame."""
    speed = np.linalg.norm(s.vel, axis=-1)
    out = np.zeros(s.belief_error.shape, dtype=bool)
    for f in range(len(s.owner)):
        dist = np.linalg.norm(s.pos[f][None] - s.pos[f][:, None], axis=-1)
        out[f] = (
            watch_pairs(s.truth_roles, f, s.team)
            & (s.belief_error[f] > STALE_M)
            & (speed[f][None] >= moving)
            & (dist <= params.max_distance)
        )
    return out


def truth(s: Sample, params: BlindSideParams, per_frame_speed: float | None = None) -> list[Alert]:
    """Stale-belief episodes in which the target ran at `min_speed` at least once. With
    `per_frame_speed`, instead: frames where the target moves at least that fast (variants)."""
    if per_frame_speed is not None:
        return intervals(stale_mask(s, params, per_frame_speed))
    speed = np.linalg.norm(s.vel, axis=-1)
    return [
        g for g in intervals(stale_mask(s, params))
        if speed[g.start : g.end + 1, g.target].max() >= params.min_speed
    ]  # fmt: skip


def intervals(mask: np.ndarray) -> list[Alert]:
    """Truth intervals per pair from a (F, N, N) mask, with short gaps bridged and blips dropped."""
    bridge, shortest = round(BRIDGE_S / DT), round(MIN_TRUTH_S / DT)
    out = []
    for o, t in zip(*np.nonzero(mask.any(axis=0)), strict=True):
        on = np.flatnonzero(mask[:, o, t])
        runs, start, prev = [], on[0], on[0]
        for f in on[1:]:
            if f - prev > bridge + 1:
                runs.append((start, prev))
                start = f
            prev = f
        runs.append((start, prev))
        out += [Alert(int(o), int(t), int(a), int(b)) for a, b in runs if b - a + 1 >= shortest]
    return sorted(out, key=lambda a: (a.start, a.observer, a.target))


def _overlap(a: Alert, b: Alert, tol: int) -> bool:
    return (a.observer, a.target) == (b.observer, b.target) and (
        a.start <= b.end + tol and b.start <= a.end + tol
    )


def _mask(shape: tuple[int, ...], spans: list[Alert]) -> np.ndarray:
    out = np.zeros(shape, dtype=bool)
    for a in spans:
        out[a.start : a.end + 1, a.observer, a.target] = True
    return out


def score(
    samples: list[Sample], params: BlindSideParams, truths: list[list[Alert]] | None = None
) -> Counts:
    tol = round(TOLERANCE_S / DT)
    total = Counts()
    for k, s in enumerate(samples):
        alerts = detect_alerts(
            s.head_yaw, s.pos, s.vel, s.ball_pos, s.ball_vel, s.owner, s.team, DT, params,
            seen=s.seen,
        ).intervals  # fmt: skip
        episodes = truths[k] if truths is not None else truth(s, params)
        alerted, stale = _mask(s.belief_error.shape, alerts), _mask(s.belief_error.shape, episodes)
        total += Counts(
            alerts=len(alerts),
            alerts_ok=sum(any(_overlap(a, g, tol) for g in episodes) for a in alerts),
            truths=len(episodes),
            truths_found=sum(any(_overlap(a, g, tol) for a in alerts) for g in episodes),
            frames_alert=int(alerted.sum()),
            frames_truth=int(stale.sum()),
            frames_both=int((alerted & stale).sum()),
        )
    return total


def samples_for(seed_sets) -> list[Sample]:
    return [simulate(name, seed) for name, seeds in seed_sets for seed in seeds]


def tune(samples: list[Sample], expect_s: float = 0.0) -> tuple[BlindSideParams, dict]:
    """Best (min_unseen_s, min_moved_m) by interval F1; ties go to the longer unseen time, then
    the larger move (fewer alerts)."""
    base = replace(DEFAULT_PARAMS, expect_s=expect_s)
    truths = [truth(s, base) for s in samples]
    grid = {
        (u, m): score(samples, replace(base, min_unseen_s=u, min_moved_m=m), truths)
        for u in MIN_UNSEEN_S
        for m in MIN_MOVED_M
    }
    u, m = max(grid, key=lambda k: (round(grid[k].f1, 4), k[0], k[1]))
    return replace(base, min_unseen_s=u, min_moved_m=m), grid


FALSE_ALERT_REASONS = {
    "not_stale": "the belief was never stale by > 3 m during the alert",
    "slowed": "stale only after the runner slowed below the run speed (the belief overshoots)",
    "short": "stale while watched for < 0.2 s (too short to be an episode)",
    "unwatched": "stale only while the pair was not watched, or out of range",
    "other": "other",
}


def false_alerts(samples: list[Sample], params: BlindSideParams) -> dict[str, int]:
    """Why alerts that match no truth episode are wrong (keys of FALSE_ALERT_REASONS)."""
    tol = round(TOLERANCE_S / DT)
    out = dict.fromkeys(FALSE_ALERT_REASONS, 0)
    for s in samples:
        episodes, stale = truth(s, params), stale_mask(s, params)
        stretches = intervals(stale)
        speed = np.linalg.norm(s.vel, axis=-1)
        alerts = detect_alerts(
            s.head_yaw, s.pos, s.vel, s.ball_pos, s.ball_vel, s.owner, s.team, DT, params,
            seen=s.seen,
        ).intervals  # fmt: skip
        for a in alerts:
            if any(_overlap(a, g, tol) for g in episodes):
                continue
            span = slice(a.start, a.end + 1)
            watched_stale = stale[span, a.observer, a.target]
            if s.belief_error[span, a.observer, a.target].max() <= STALE_M:
                out["not_stale"] += 1
            elif not watched_stale.any():
                out["unwatched"] += 1
            elif not any(_overlap(a, g, tol) for g in stretches):
                out["short"] += 1
            elif speed[span, a.target][watched_stale].max() < params.min_speed:
                out["slowed"] += 1
            else:
                out["other"] += 1
    return out


def _row(name: str, c: Counts) -> str:
    return (
        f"| {name} | {c.precision:.3f} | {c.recall:.3f} | **{c.f1:.3f}** | {c.alerts} | "
        f"{c.truths} | {c.frame_precision:.3f} | {c.frame_recall:.3f} |"
    )


def _seed_text(seed_sets) -> str:
    return ", ".join(f"`{name}` {s[0]}–{s[-1]} ({len(s)})" for name, s in seed_sets)


def evaluate() -> str:
    tuning = samples_for(TUNING)
    chosen, grid = tune(tuning)
    expecting, _ = tune(tuning, expect_s=1.0)
    held = samples_for(HELD_OUT)
    spec = replace(DEFAULT_PARAMS, min_unseen_s=1.0, min_moved_m=3.0, expect_s=0.0)
    near = replace(chosen, max_distance=25.0)
    rows = {
        f"chosen ({chosen.min_unseen_s} s, {chosen.min_moved_m} m)": score(held, chosen),
        "SPEC values (1.0 s, 3.0 m)": score(held, spec),
        "chosen, 25 m range for alert and truth (SPEC 4.4 text)": score(held, near),
        f"variant: expectation 1 s, tuned ({expecting.min_unseen_s} s, "
        f"{expecting.min_moved_m} m)": score(held, expecting),
        f"chosen; truth variant: target ≥ {chosen.min_speed} m/s on every frame": score(
            held, chosen, [truth(s, chosen, chosen.min_speed) for s in held]
        ),
        "chosen; truth variant: target ≥ 2 m/s on every frame": score(
            held, chosen, [truth(s, chosen, 2.0) for s in held]
        ),
    }
    final = rows[next(iter(rows))]
    tuned = grid[(chosen.min_unseen_s, chosen.min_moved_m)]
    variant = score(held, expecting)
    wrong = false_alerts(held, chosen)
    ok_p = "✅" if final.precision >= 0.8 else "❌"
    ok_r = "✅" if final.recall >= 0.7 else "❌"
    minutes = sum(s.seconds for s in held) / 60
    lines = [
        "# Blind-side alerts vs the sim's beliefs (SPEC 4.4)",
        "",
        "`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw "
        "and positions only). Truth: the sim's belief state.",
        "",
        "| | Value |",
        "|---|---|",
        f"| Chosen thresholds (tuning seeds) | unseen ≥ **{chosen.min_unseen_s} s**, moved ≥ "
        f"**{chosen.min_moved_m} m**; speed ≥ {chosen.min_speed} m/s, range ≤ "
        f"{chosen.max_distance:.0f} m, on ≥ {chosen.min_on_s} s |",
        f"| Held-out precision | **{final.precision:.3f}** {ok_p} target ≥ 0.8 |",
        f"| Held-out recall | **{final.recall:.3f}** {ok_r} target ≥ 0.7 |",
        f"| Tuning seeds, same thresholds | precision {tuned.precision:.3f}, recall "
        f"{tuned.recall:.3f} |",
        f"| Held-out data | {minutes:.1f} min of play, {final.truths} truth intervals, "
        f"{final.alerts} alerts |",
        "",
        "## What limits precision",
        "",
        "Alerts that match no truth episode (held-out, chosen thresholds):",
        "",
        "| Reason | Alerts |",
        "|---|---|",
        *(f"| {FALSE_ALERT_REASONS[k]} | {v} |" for k, v in wrong.items()),
        "",
        "- *Runner slowed* (the largest group): he ran while unseen, the belief carried his "
        "velocity on, and it went stale only once he slowed — overshooting him. The truth counts "
        "an episode only if he runs while the belief is stale; a truth that also counted a run "
        "*since he was last seen* would accept these. That is a definition choice, left as is.",
        "- *Never stale:* the belief stayed within 3 m — either he moved less than 3 m (the tuned "
        "move threshold is lower), or the last sighting already showed the run and the sim's "
        "belief carries that velocity on for up to 1 s. SPEC 4.4 measures the move from the last "
        "sighting and cannot tell.",
        "- The *expectation* variant measures the move from where he would be at his last-seen "
        f"velocity (≤ 1 s) and reaches precision {variant.precision:.3f}, recall "
        f"{variant.recall:.3f} on held-out seeds. But that is the same constant-velocity "
        "assumption the sim's belief makes, so part of the gain is circular. It is a variant "
        "(`expect_s`), off by default.",
        "- *Too short:* the pair was watched while the belief was stale for under 0.2 s.",
        "",
        "## Held-out results",
        "",
        "Interval level (the unit a viewer sees) and frame level.",
        "",
        "| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |",
        "|---|---|---|---|---|---|---|---|",
        *(_row(name, c) for name, c in rows.items()),
        "",
        "| Scenario (chosen) | Precision | Recall | F1 | Alerts | Truth intervals | Frame P "
        "| Frame R |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for name, _ in HELD_OUT:
        lines.append(_row(f"`{name}`", score([s for s in held if s.scenario == name], chosen)))
    lines += [
        "",
        "## Tuning grid (interval F1, tuning seeds)",
        "",
        "| Unseen ≥ (s) \\ moved ≥ (m) | " + " | ".join(f"{m}" for m in MIN_MOVED_M) + " |",
        "|---" * (len(MIN_MOVED_M) + 1) + "|",
        *(
            f"| {u} | " + " | ".join(f"{grid[(u, m)].f1:.3f}" for m in MIN_MOVED_M) + " |"
            for u in MIN_UNSEEN_S
        ),
        "",
        "## Method",
        "",
        f"- Tuning seeds: {_seed_text(TUNING)}. Held-out seeds: {_seed_text(HELD_OUT)}. "
        "`possession_play` runs 45 s; `blind_side_run` is the ~6 s hero scenario.",
        f"- Truth: stale-belief episodes — watched pair, belief error > {STALE_M:.0f} m (the sim's "
        "extrapolated belief, sampled before every step), target within the alert's range — in "
        f"which the target ran at ≥ {chosen.min_speed} m/s at least once. Episodes: gaps ≤ "
        f"{BRIDGE_S} s bridged, episodes < {MIN_TRUTH_S} s dropped. In the truth the intended "
        "receiver is the pass event's `to`; the alert infers him from the ball's line.",
        "- Why episodes: the alert's speed is an onset condition and it then holds until the "
        "target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows "
        "while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the "
        "alert is not meant to raise. Both variants are in the last two results rows.",
        f"- Matching: same (observer, target), intervals overlapping within ±{TOLERANCE_S} s. "
        "Precision = alerts that match a truth interval / alerts; recall = truth intervals "
        "matched by an alert / truth intervals.",
        "- Tuned: `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen "
        "time, then the larger move. Fixed: speed, range and the 0.4 s hold, which also define "
        "the truth or come from SPEC 4.4.",
        "- Range: SPEC 4.4 says 25 m, but on `blind_side_run` the runner H9 is 22–30 m from H8 "
        "when the alert should be on, so the default is 35 m for both alert and truth. The 25 m "
        "row shows the SPEC text.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    report = evaluate()
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "blind_side.md"
    path.write_text(report)
    print(report)
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
