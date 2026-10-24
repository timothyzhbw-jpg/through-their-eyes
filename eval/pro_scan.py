"""Teaching scenario (SPEC 3.6, "Teaching"): back to goal, three looks, then the half-turn. Do
three looks (left, right, behind) plus the forward look give the midfielder more than one look
(behind only)?

    uv run python -m eval.pro_scan

On `pro_scan` (sim/scenarios/pro_scan.py), H8 takes his scripted looks; the look TIMES are
scripted for teaching, and what he sees, believes and does follows the sim. Per seed, two runs
that share every random draw (SPEC 3.7) and differ only in his looks:
- three looks: left, right, behind, then the forward look as the ball comes (the factual run);
- one look: behind only (the other three dropped with `DropScan`, re-simulated from the first).
And, because the app's own intervention is the one every scan hero has, a third run without the
forward look only (`drop_scan` of the key look), reported beside them.

Measured in each run:
- the reception-point shift: metres from the spot the pass was planned for to where he received
  it (rule 1 moves his spot on his belief; the engine moves him there);
- his separation at reception: the nearest opponent's distance;
- whether he receives side-on: his body at least SIDE_ON_DEG from square (facing where the pass
  came from) at the reception (rule 2 turns him when he believes a presser is near);
- his decision (the decision model on his belief, SPEC 3.5): forward to the striker H9, or back
  or sideways (any other pass), or a carry;
- the outcome: the pass completed (possession kept), and the xT gained: the fitted grid's value
  where his action ended (`possession_value`, minus the opponents' if lost) minus its value
  where he received the ball;
- each look's use: his belief error about the outfield opponents (mean metres, as the explain
  layer rebuilds his belief from sightings) as the look begins and as it ends.
Shares carry 95% Wilson intervals. Design seeds 0-99 (the scene was built on 0-15); held-out
seeds 100-139, run once the scene was fixed. Writes eval/reports/pro_scan.md.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from analytics.xt import xt_for
from eval.season import wilson
from explain.lenses import believed_position, sightings
from sim.counterfactual import possession_result, possession_value, reception_frame
from sim.scenarios.pro_scan import (
    HALF_TURN_M,
    LOOKS,
    MAX_SHIFT_M,
    NEAR_M,
    OPEN_DEG,
    ProScan,
    body_angle,
    look_ids,
    run_with_looks,
)

REPORTS = Path(__file__).parent / "reports"
DESIGN = "0-99"
HELD_OUT = "100-139"
SIDE_ON_DEG = 45.0  # a body this far from square is side-on (rule 2 opens it OPEN_DEG)
RUNS = {"three": "LRBF", "one": "B", "no_forward": "LRB"}


@dataclass
class RunRow:
    looks: list[str]  # the scripted looks that happened, in order ("L", "R", "B", "F")
    shift_m: float
    separation_m: float
    nearest: str
    body_deg: float
    side_on: bool
    decision: str
    best: str  # his highest-valued option, on his belief
    result: str  # possession_result: kept, lost, open
    xt_gain: float
    # label -> (mean belief error at its start, at its end, players), over the outfield
    # opponents he saw on the look
    look_error: dict[str, tuple[float, float, int]]

    @property
    def forward(self) -> bool:
        return self.decision == f"pass:{ProScan.runner}"

    @property
    def back_or_sideways(self) -> bool:
        return self.decision.startswith("pass:") and not self.forward


def _measure(seed: int, keep: str) -> RunRow:
    run, sc = run_with_looks(seed, keep)
    hero = sc.hero
    i = run.index(hero)
    f = reception_frame(run, hero)
    opp = [j for j, p in enumerate(run.players) if p.team != run.players[i].team]
    gaps = np.linalg.norm(run.pos[f, opp] - run.pos[f, i], axis=-1)
    angle = body_angle(run, sc, f)
    sign = 1 if run.players[i].team == 0 else -1
    started = {e.id: e for e in run.events if e.type == "scan" and e.player == hero}
    done, errors = [], {}
    outfield = [j for j in opp if run.players[j].role != "GK"]
    seen = sightings(run, hero)
    for (label, _, _), sid in zip(LOOKS, look_ids(sc), strict=True):
        e = started.get(sid)
        if e is None:
            continue
        done.append(label)
        a, b = e.frame, int(e.attrs["end"])
        saw = [j for j in outfield if seen[a : b + 1, j].any()]
        if saw:
            ends = [float(np.mean([np.linalg.norm(believed_position(run, hero, run.ids[j], g,
                                                                   seen=seen) - run.pos[g, j])
                                   for j in saw])) for g in (a, b)]  # fmt: skip
            errors[label] = (ends[0], ends[1], len(saw))
    return RunRow(
        looks=done,
        shift_m=float(np.linalg.norm(run.pos[f, i] - sc.spot)),
        separation_m=float(gaps.min()),
        nearest=run.ids[opp[int(np.argmin(gaps))]],
        body_deg=angle,
        side_on=angle >= SIDE_ON_DEG,
        decision=run.hero_decision().chosen,
        best=max(run.hero_decision().options, key=lambda o: o.value).action,
        result=possession_result(run),
        xt_gain=possession_value(run) - float(xt_for(run.pos[f, i], sign)),
        look_error=errors,
    )


@dataclass
class Row:
    seed: int
    runs: dict[str, RunRow]


def evaluate_seed(seed: int) -> Row:
    return Row(seed, {name: _measure(seed, keep) for name, keep in RUNS.items()})


def _share(k: int, n: int) -> str:
    lo, hi = wilson(k, n)
    return f"{k}/{n} ({k / n:.0%}; 95% CI {lo:.0%}–{hi:.0%})"


def _mean(xs: list[float]) -> str:
    return f"{np.mean(xs):.2f} (median {np.median(xs):.2f})"


def _block(title: str, rows: list[Row]) -> list[str]:
    n = len(rows)
    three = [r.runs["three"] for r in rows]
    one = [r.runs["one"] for r in rows]
    nof = [r.runs["no_forward"] for r in rows]
    all_looks = sum(r.looks == ["L", "R", "B", "F"] for r in three)
    one_ok = sum(r.looks == ["B"] for r in one)
    sep_more = sum(t.separation_m > o.separation_m + 1e-6 for t, o in zip(three, one, strict=True))
    changed = sum(t.decision != o.decision for t, o in zip(three, one, strict=True))
    nof_changed = sum(t.decision != x.decision for t, x in zip(three, nof, strict=True))
    d_xt = [t.xt_gain - o.xt_gain for t, o in zip(three, one, strict=True)]
    d_sep = [t.separation_m - o.separation_m for t, o in zip(three, one, strict=True)]
    striker = f"pass:{ProScan.runner}"

    def kept(rs: list[RunRow]) -> str:
        passes = [r for r in rs if r.decision.startswith("pass:")]
        return _share(sum(r.result == "kept" for r in passes), len(passes)) if passes else "—"

    def fwd_kept(rs: list[RunRow]) -> str:
        fw = [r for r in rs if r.forward]
        return _share(sum(r.result == "kept" for r in fw), len(fw)) if fw else "—"

    lines = [
        f"## {title}",
        "",
        "| Metric | Three looks + forward look | One look (behind only) | Without the forward "
        "look (the app's run) |",
        "|---|---|---|---|",
        f"| His scripted looks all happened | {_share(all_looks, n)} | {_share(one_ok, n)} "
        f"| {_share(sum(r.looks == ['L', 'R', 'B'] for r in nof), n)} |",
        f"| Reception-point shift, m: mean | {_mean([r.shift_m for r in three])} "
        f"| {_mean([r.shift_m for r in one])} | {_mean([r.shift_m for r in nof])} |",
        f"| Separation from the nearest opponent at reception, m: mean "
        f"| {_mean([r.separation_m for r in three])} | {_mean([r.separation_m for r in one])} "
        f"| {_mean([r.separation_m for r in nof])} |",
        f"| Receives side-on (body ≥ {SIDE_ON_DEG:.0f}° from square) "
        f"| {_share(sum(r.side_on for r in three), n)} | {_share(sum(r.side_on for r in one), n)} "
        f"| {_share(sum(r.side_on for r in nof), n)} |",
        f"| Decision: forward to the striker `{ProScan.runner}` "
        f"| {_share(sum(r.forward for r in three), n)} | {_share(sum(r.forward for r in one), n)} "
        f"| {_share(sum(r.forward for r in nof), n)} |",
        f"| Decision: back or sideways (another pass) "
        f"| {_share(sum(r.back_or_sideways for r in three), n)} "
        f"| {_share(sum(r.back_or_sideways for r in one), n)} "
        f"| {_share(sum(r.back_or_sideways for r in nof), n)} |",
        f"| Forward pass is his highest-valued option "
        f"| {_share(sum(r.best == striker for r in three), n)} "
        f"| {_share(sum(r.best == striker for r in one), n)} "
        f"| {_share(sum(r.best == striker for r in nof), n)} |",
        f"| Decision: carry | {_share(sum(r.decision == 'carry' for r in three), n)} "
        f"| {_share(sum(r.decision == 'carry' for r in one), n)} "
        f"| {_share(sum(r.decision == 'carry' for r in nof), n)} |",
        f"| Pass completed (of his passes) | {kept(three)} | {kept(one)} | {kept(nof)} |",
        f"| … of his passes forward to the striker | {fwd_kept(three)} | {fwd_kept(one)} "
        f"| {fwd_kept(nof)} |",
        f"| Possession lost (pass intercepted or out, or tackled on a carry) "
        f"| {_share(sum(r.result == 'lost' for r in three), n)} "
        f"| {_share(sum(r.result == 'lost' for r in one), n)} "
        f"| {_share(sum(r.result == 'lost' for r in nof), n)} |",
        f"| xT gained (where his action ended − where he received), mean "
        f"| {np.mean([r.xt_gain for r in three]):+.3f} | {np.mean([r.xt_gain for r in one]):+.3f} "
        f"| {np.mean([r.xt_gain for r in nof]):+.3f} |",
        "",
        "| Paired, three looks against one | Value |",
        "|---|---|",
        f"| Separation at reception larger with three looks | {_share(sep_more, n)} |",
        f"| Separation gained, m: mean | {np.mean(d_sep):+.2f} |",
        f"| Decision differs | {_share(changed, n)} |",
        f"| xT gained, three looks − one look: mean | {np.mean(d_xt):+.3f} |",
        f"| Decision differs without the forward look only (the app's intervention) "
        f"| {_share(nof_changed, n)} |",
        "",
        "Each look's use, in the three-look run: the outfield opponents he saw on it, and his "
        "belief error about them (mean metres; his belief rebuilt from his sightings, as the "
        "explain layer does) as the look begins → as it ends.",
        "",
        "| Look | Taken | Opponents seen, mean | Belief error about them, start → end (m) "
        "| Error fell |",
        "|---|---|---|---|---|",
    ]
    for label, _, _ in LOOKS:
        taken = sum(label in r.looks for r in three)
        took = [r.look_error[label] for r in three if label in r.look_error]
        if not took:
            lines.append(f"| {label} | {taken}/{n} | 0 | — | — |")
            continue
        a, b = np.mean([x[0] for x in took]), np.mean([x[1] for x in took])
        fell = sum(x[1] < x[0] - 1e-9 for x in took)
        lines.append(f"| {label} | {taken}/{n} | {np.mean([x[2] for x in took]):.1f} "
                     f"| {a:.2f} → {b:.2f} | {_share(fell, len(took))} |")  # fmt: skip
    lines.append("")
    return lines


def _reading(rows: list[Row]) -> list[str]:
    """What the held-out counts say: each sentence is computed from them, and one that the counts
    do not back is not written."""
    n = len(rows)
    three = [r.runs["three"] for r in rows]
    one = [r.runs["one"] for r in rows]
    nof = [r.runs["no_forward"] for r in rows]
    striker = f"pass:{ProScan.runner}"
    pairs = list(zip(three, one, strict=True))
    sep = np.mean([t.separation_m - o.separation_m for t, o in pairs])
    wider = sum(t.separation_m > o.separation_m + 1e-6 for t, o in pairs)
    side3, side1 = sum(r.side_on for r in three), sum(r.side_on for r in one)
    fwd3, fwd1 = sum(r.forward for r in three), sum(r.forward for r in one)
    best3, best1 = sum(r.best == striker for r in three), sum(r.best == striker for r in one)
    fk3 = sum(r.forward and r.result == "kept" for r in three)
    fk1 = sum(r.forward and r.result == "kept" for r in one)
    x3, x1 = np.mean([r.xt_gain for r in three]), np.mean([r.xt_gain for r in one])
    same = sum(abs(x.shift_m - o.shift_m) < 1e-6 and x.side_on == o.side_on
               for x, o in zip(nof, one, strict=True))  # fmt: skip
    out = ["## Reading (held-out seeds)", ""]
    if abs(sep) < 0.5 and abs(side3 - side1) < 0.1 * n and abs(fwd3 - fwd1) < 0.1 * n:
        out.append("Three looks barely change anything here: his separation, his body at "
                   "reception and his decision are about the same as with one look.")  # fmt: skip
    else:
        out.append(f"With three looks he receives {sep:+.2f} m further from the nearest opponent "
                   f"on average (further in {wider}/{n} runs), and side-on in {side3}/{n} against "
                   f"{side1}/{n} with one look.")  # fmt: skip
    if abs(fwd3 - fwd1) <= 0.1 * n:
        out.append(
            f"His decision barely changes: he plays forward to the striker in {fwd3}/{n} runs "
            f"with three looks and {fwd1}/{n} with one. The forward pass is his highest-valued "
            f"option in {best3}/{n} and {best1}/{n}: on either picture it is the pass he wants, "
            "and the decision model's softmax draw (SPEC 3.5) picks another in the rest. What the "
            "looks change is how he receives the ball."
        )
    else:
        out.append(f"He plays forward to the striker in {fwd3}/{n} runs with three looks and "
                   f"{fwd1}/{n} with one.")  # fmt: skip
    out.append(f"His forward passes complete in {fk3}/{fwd3} with three looks and {fk1}/{fwd1} "
               f"with one; the mean xT gained is {x3:+.3f} against {x1:+.3f}.")  # fmt: skip
    out.append(
        f"Without the forward look alone he receives where, and as square as, with one look in "
        f"{same}/{n} runs: the forward look, which shows the central defender stepping out toward "
        "him, is the one the two rules act on."
    )
    first = [r.look_error["L"] for r in three if "L" in r.look_error]
    if first and np.mean([x[0] for x in first]) < 0.05:
        out.append(
            "The first look (left) finds little new: everyone is known at the run's first frame "
            "(SPEC 3.4), and the players it shows have barely moved since."
        )
    out += [
        "",
        "Limits: the look times are scripted for teaching; what he sees, believes and does "
        "follows the sim. The sim has no first touch or reception mechanics, so the half-turn "
        "changes his body angle and his next action's options (where the ball sits, where his "
        "eyes rest while he has it, what an opponent can win ball-first), not the touch.",
        "",
    ]
    return out


def render(design: list[Row], held: list[Row]) -> str:
    looks = ", ".join(f"{label} {direction}° at {s} s" for label, direction, s in LOOKS)
    lines = [
        "# Back to goal: three looks, then the half-turn — `pro_scan`",
        "",
        "A teaching scenario (SPEC 3.6). **The look times are scripted for teaching; what he "
        "sees, believes and does follows the sim.** His looks (direction from where his body "
        f"faces, seconds before the planned reception): {looks}. Rule 1 moves his receiving spot "
        f"after each look, up to {MAX_SHIFT_M:.0f} m, away from the opponents he believes will be "
        f"within {NEAR_M:.0f} m of him when the ball arrives; rule 2 turns him {OPEN_DEG:.0f}° "
        f"side-on at reception when he believes one is within {HALF_TURN_M:.0f} m. All three runs "
        "share every random draw (SPEC 3.7). Generated by `uv run python -m eval.pro_scan`.",
        "",
        *_block(f"Held-out seeds {held[0].seed}–{held[-1].seed} ({len(held)})", held),
        *_reading(held),
        *_block(f"Design seeds {design[0].seed}–{design[-1].seed} ({len(design)})", design),
        "## Per seed (held out)",
        "",
        "| Seed | Looks | Shift 3 / 1 (m) | Separation 3 / 1 (m) | Body 3 / 1 (°) "
        "| Decision 3 | Decision 1 | Result 3 / 1 | xT gained 3 / 1 | Without F |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in held:
        t, o, x = r.runs["three"], r.runs["one"], r.runs["no_forward"]
        lines.append(
            f"| {r.seed} | {''.join(t.looks)} | {t.shift_m:.2f} / {o.shift_m:.2f} "
            f"| {t.separation_m:.2f} / {o.separation_m:.2f} | {t.body_deg:.0f} / {o.body_deg:.0f} "
            f"| `{t.decision}` | `{o.decision}` | {t.result} / {o.result} "
            f"| {t.xt_gain:+.3f} / {o.xt_gain:+.3f} | `{x.decision}` |"
        )
    return "\n".join(lines) + "\n"


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def collect(seeds: list[int], workers: int | None) -> list[Row]:
    with ProcessPoolExecutor(workers) as pool:
        return list(pool.map(evaluate_seed, seeds, chunksize=4))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--design", default=DESIGN)
    parser.add_argument("--held-out", default=HELD_OUT)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--out", type=Path, default=REPORTS / "pro_scan.md")
    args = parser.parse_args()
    design = collect(_parse_seeds(args.design), args.workers)
    held = collect(_parse_seeds(args.held_out), args.workers)
    report = render(design, held)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(report)
    print(report.split("## Design seeds")[0])
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
