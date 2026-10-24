"""Teaching scenario (SPEC 3.6, "Teaching"): back to goal, the coach's sequence. Does the look
left (which drops him back) and the look right (which sets the half-turn) change how he receives
and what he does, against facing the ball only? And what does each look do on its own?

    uv run python -m eval.pro_scan

On `pro_scan` (sim/scenarios/pro_scan.py), H8 starts facing his own half, toward the ball (his
forward view, not a scan), then takes his scripted looks: left, then right. The look TIMES are
scripted for teaching; what he sees, believes and does follows the sim. Per seed, four runs that
share every random draw (SPEC 3.7) and differ only in his looks (`DropScan`, re-simulated from the
first dropped look):
- both looks: the forward view, the look left, the look right (the factual run);
- no side looks: the forward view only;
- left only, and right only: so that each look's effect can be told apart.

Measured in each run:
- the two rules, which act on his belief at fixed times after each look's scripted start whether
  or not he took it: did rule 1 drop him back, and did rule 2 turn him side-on;
- the reception-point shift (metres from the spot the pass was first planned for to where he
  received it) and his separation at reception (the nearest opponent's distance);
- whether he receives side-on: his body at least SIDE_ON_DEG from square (facing where the pass
  came from) at the reception;
- his decision (the decision model on his belief, SPEC 3.5): forward to the striker H9, another
  pass, or a carry; whether the forward pass is his highest-valued option;
- the outcome: the pass completed (possession kept), and the xT gained: the fitted grid's value
  where his action ended (`possession_value`, minus the opponents' if lost) minus its value
  where he received the ball;
- each look's news, in the run with both: who is new in his picture (`explain.belief_options`:
  came into his sight, or believed more than 1 m from where he would have believed them without
  the look) and which of his options it opened or closed (the decision model on his belief at the
  look's end, with and without the look; open at a believed success of at least 50%).
Shares carry 95% Wilson intervals. Design seeds 0-99 (the scene was built on 0-15 and checked on
100-106 while it was tuned); held-out seeds 100-139. Writes eval/reports/pro_scan.md.
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from analytics.xt import xt_for
from eval.season import wilson
from explain.belief_options import look_options, new_in_picture, option_changes
from explain.lenses import sightings
from sim.counterfactual import possession_result, possession_value, reception_frame
from sim.model import Event
from sim.scenarios.pro_scan import (
    HALF_TURN_M,
    LOOKS,
    MAX_SHIFT_M,
    NEAR_M,
    OPEN_DEG,
    RULE_DELAY_S,
    ProScan,
    body_angle,
    look_ids,
    run_with_looks,
)

REPORTS = Path(__file__).parent / "reports"
DESIGN = "0-99"
HELD_OUT = "100-139"
SIDE_ON_DEG = 45.0  # a body this far from square is side-on (rule 2 opens it OPEN_DEG)
RUNS = {"both": "LR", "none": "", "left": "L", "right": "R"}
TITLES = {
    "both": "Both looks (forward view + left + right)",
    "none": "No side looks (forward view only)",
    "left": "Left only",
    "right": "Right only",
}
WORDS = {"L": "left", "R": "right"}
LOST = "lost before deciding"  # the pass to him intercepted, or the ball won off him first


@dataclass
class LookNews:
    """One look's news, in the run with both looks."""

    new: list[tuple[str, float]]  # (player, metres his belief moved), largest first
    opened: list[str]  # options it opened (believed success crossed up through 50%)
    closed: list[str]  # options it closed


@dataclass
class RunRow:
    looks: list[str]  # the scripted looks that happened, in order ("L", "R")
    dropped: bool  # rule 1 moved his receiving spot back
    turned: bool  # rule 2 chose the half-turn
    shift_m: float
    separation_m: float
    nearest: str
    body_deg: float
    side_on: bool
    decision: str
    best: str  # his highest-valued option, on his belief
    result: str  # possession_result: kept, lost, open
    xt_gain: float
    news: dict[str, LookNews] = field(default_factory=dict)  # the run with both looks only

    @property
    def forward(self) -> bool:
        return self.decision == f"pass:{ProScan.runner}"

    @property
    def other_pass(self) -> bool:
        return self.decision.startswith("pass:") and not self.forward


def _lost_before_deciding(run, hero: str) -> Event | None:
    """When he makes no decision, how the ball was lost: the pass to him intercepted, or a
    tackle that won it off him."""
    if run.hero_decision() is not None:
        return None
    return next((e for e in run.events if e.type == "interception"
                 or e.type == "tackle" and e.attrs.get("won_from") == hero), None)  # fmt: skip


def _received(run, hero: str) -> int:
    """His reception for his decision; without a decision, his first reception, or the frame the
    pass to him was intercepted."""
    if run.hero_decision() is not None:
        return reception_frame(run, hero)
    got = [e.frame for e in run.events if e.type == "reception" and e.player == hero]
    if got:
        return min(got)
    lost = _lost_before_deciding(run, hero)
    if lost is None:
        raise ValueError(f"{hero}: no decision, no reception and no interception")
    return lost.frame


def _news(run, sc) -> dict[str, LookNews]:
    hero = sc.hero
    seen = sightings(run, hero)
    decision = run.hero_decision()
    decided = decision.frame if decision is not None else _received(run, sc.hero)
    started = {e.id: e for e in run.events if e.type == "scan" and e.player == hero}
    out = {}
    for (label, _, _), sid in zip(LOOKS, look_ids(sc), strict=True):
        e = started.get(sid)
        if e is None:
            continue
        a, b = e.frame, min(int(e.attrs["end"]), decided)
        before, after = look_options(run, hero, a, b, seen)
        added, removed = option_changes({o.action: o.p_success for o in before},
                                        {o.action: o.p_success for o in after})  # fmt: skip
        news = [(n.player, n.moved_m) for n in new_in_picture(run, hero, a, b, seen)
                if n.moved_m > 1.0]  # fmt: skip
        out[label] = LookNews(news, added, removed)
    return out


def _measure(seed: int, keep: str) -> RunRow:
    run, sc = run_with_looks(seed, keep)
    hero = sc.hero
    i = run.index(hero)
    f = _received(run, hero)
    opp = [j for j, p in enumerate(run.players) if p.team != run.players[i].team]
    gaps = np.linalg.norm(run.pos[f, opp] - run.pos[f, i], axis=-1)
    angle = body_angle(run, sc, f)
    sign = 1 if run.players[i].team == 0 else -1
    started = {e.id for e in run.events if e.type == "scan" and e.player == hero}
    d = run.hero_decision()
    if d is not None:
        decision, best = d.chosen, max(d.options, key=lambda o: o.value).action
        result, value = possession_result(run), possession_value(run)
    else:  # the ball lost before he decided: the opponents' xT where they won it
        lost = _lost_before_deciding(run, hero)
        if lost is None:
            raise ValueError(f"seed {seed} ({keep or 'no side looks'}): no decision, ball not lost")
        decision, best, result = LOST, "—", "lost"
        value = -float(xt_for(np.array(lost.attrs["at"]), -sign))
    return RunRow(
        looks=[
            label for (label, _, _), sid in zip(LOOKS, look_ids(sc), strict=True) if sid in started
        ],  # fmt: skip
        dropped=sc.calls["drop_back"].spot is not None,
        turned=sc.calls["half_turn"].side != 0,
        shift_m=float(np.linalg.norm(run.pos[f, i] - sc.spot)),
        separation_m=float(gaps.min()),
        nearest=run.ids[opp[int(np.argmin(gaps))]],
        body_deg=angle,
        side_on=angle >= SIDE_ON_DEG,
        decision=decision,
        best=best,
        result=result,
        xt_gain=value - float(xt_for(run.pos[f, i], sign)),
        news=_news(run, sc) if keep == RUNS["both"] else {},
    )


@dataclass
class Row:
    seed: int
    runs: dict[str, RunRow]


def evaluate_seed(seed: int) -> Row:
    return Row(seed, {name: _measure(seed, keep) for name, keep in RUNS.items()})


def _share(k: int, n: int) -> str:
    if not n:
        return "—"
    lo, hi = wilson(k, n)
    return f"{k}/{n} ({k / n:.0%}; 95% CI {lo:.0%}–{hi:.0%})"


def _mean(xs: list[float]) -> str:
    return f"{np.mean(xs):.2f} (median {np.median(xs):.2f})"


def _cols(rows: list[Row]) -> dict[str, list[RunRow]]:
    return {name: [r.runs[name] for r in rows] for name in RUNS}


def _kept(rs: list[RunRow], forward_only: bool = False) -> str:
    passes = [r for r in rs if (r.forward if forward_only else r.decision.startswith("pass:"))]
    return _share(sum(r.result == "kept" for r in passes), len(passes))


def _block(title: str, rows: list[Row]) -> list[str]:
    n = len(rows)
    c = _cols(rows)
    striker = f"pass:{ProScan.runner}"
    order = list(RUNS)

    def row(label: str, cell) -> str:
        return f"| {label} | " + " | ".join(cell(c[name]) for name in order) + " |"

    def count(pred):
        return lambda rs: _share(sum(pred(r) for r in rs), n)

    lines = [
        f"## {title}",
        "",
        "| Metric | " + " | ".join(TITLES[name] for name in order) + " |",
        "|---|" + "---|" * len(order),
        "| His scripted looks all happened | "
        + " | ".join(_share(sum(r.looks == list(RUNS[name]) for r in c[name]), n) for name in order)
        + " |",  # fmt: skip
        row("Rule 1 dropped him back (after the left look's time)", count(lambda r: r.dropped)),
        row("Rule 2 chose the half-turn (after the right look's time)", count(lambda r: r.turned)),
        row("Reception-point shift, m: mean", lambda rs: _mean([r.shift_m for r in rs])),
        row(
            "Separation from the nearest opponent at reception, m: mean",
            lambda rs: _mean([r.separation_m for r in rs]),
        ),
        row(
            f"Receives side-on (body ≥ {SIDE_ON_DEG:.0f}° from square)", count(lambda r: r.side_on)
        ),
        row(f"Decision: forward to the striker `{ProScan.runner}`", count(lambda r: r.forward)),
        row("Decision: another pass (back or sideways)", count(lambda r: r.other_pass)),
        row("Decision: carry", count(lambda r: r.decision == "carry")),
        row(
            "No decision: the pass to him intercepted, or the ball won off him first",
            count(lambda r: r.decision == LOST),
        ),
        row("Forward pass is his highest-valued option", count(lambda r: r.best == striker)),
        row("Pass completed (of his passes)", _kept),
        row("… of his passes forward to the striker", lambda rs: _kept(rs, True)),
        row(
            "Possession lost (his pass intercepted or out, tackled on a carry, or lost first)",
            count(lambda r: r.result == "lost"),
        ),
        row(
            "xT gained (where his action ended − where he received), mean",
            lambda rs: f"{np.mean([r.xt_gain for r in rs]):+.3f}",
        ),
        "",
        "Paired (same seed, same draws). Each look on its own is the run with it against the run "
        "without any side look; each look's added effect is the run with both against the run "
        "with the other look only.",
        "",
        "| Comparison | Separation at reception, m: mean change | Larger separation "
        "| Side-on, runs changed | Decision differs | Forward to the striker, runs: from → to "
        "| xT gained: mean change |",
        "|---|---|---|---|---|---|---|",
    ]
    for label, a, b in (
        ("Both looks − no side looks", "both", "none"),
        ("Left only − no side looks (the left look alone)", "left", "none"),
        ("Right only − no side looks (the right look alone)", "right", "none"),
        ("Both − right only (what the left look adds)", "both", "right"),
        ("Both − left only (what the right look adds)", "both", "left"),
    ):
        pairs = list(zip(c[a], c[b], strict=True))
        lines.append(
            f"| {label} | {np.mean([x.separation_m - y.separation_m for x, y in pairs]):+.2f} "
            f"| {_share(sum(x.separation_m > y.separation_m + 1e-6 for x, y in pairs), n)} "
            f"| {sum(x.side_on != y.side_on for x, y in pairs)}/{n} "
            f"| {_share(sum(x.decision != y.decision for x, y in pairs), n)} "
            f"| {sum(y.forward for _, y in pairs)} → {sum(x.forward for x, _ in pairs)} "
            f"| {np.mean([x.xt_gain - y.xt_gain for x, y in pairs]):+.3f} |"
        )
    lines += [
        "",
        "Each look's news, in the run with both looks: who is new in his picture (came into his "
        "sight, or believed more than 1 m from where he would have believed them without the "
        "look), and which options it opened (↑) or closed (↓): the decision model on his belief "
        "at the look's end with the look against without it, an option open at a believed "
        "success of at least 50%, scored as if the ball were at his feet.",
        "",
        "| Look | Taken | Players new in his picture, mean | Most often the most moved "
        "| How far, m: mean | Opened or closed an option | Most often opened | Most often closed |",
        "|---|---|---|---|---|---|---|---|",
    ]
    both = c["both"]
    for label, _, _ in LOOKS:
        took = [r.news[label] for r in both if label in r.news]
        if not took:
            lines.append(f"| {WORDS[label]} | 0/{n} | — | — | — | — | — | — |")
            continue
        tops = [x.new[0] for x in took if x.new]
        top = Counter(p for p, _ in tops).most_common(1)
        opened = Counter(o for x in took for o in x.opened).most_common(1)
        closed = Counter(o for x in took for o in x.closed).most_common(1)

        def fmt(mc, k: int) -> str:
            return f"`{mc[0][0]}` ({mc[0][1]}/{k})" if mc else "—"

        lines.append(
            f"| {WORDS[label]} | {len(took)}/{n} | {np.mean([len(x.new) for x in took]):.1f} "
            f"| {fmt(top, len(took))} | {np.mean([m for _, m in tops]) if tops else 0:.1f} "
            f"| {_share(sum(bool(x.opened or x.closed) for x in took), len(took))} "
            f"| {fmt(opened, len(took))} | {fmt(closed, len(took))} |"
        )
    lines.append("")
    return lines


def _reading(rows: list[Row]) -> list[str]:
    """What the held-out counts say: each sentence is computed from them, and one the counts do
    not back is not written."""
    n = len(rows)
    c = _cols(rows)

    def fwd(name):
        return sum(r.forward for r in c[name])

    def side(name):
        return sum(r.side_on for r in c[name])

    def sep(a, b):
        return float(np.mean([x.separation_m - y.separation_m
                              for x, y in zip(c[a], c[b], strict=True)]))  # fmt: skip

    def xt(name):
        return float(np.mean([r.xt_gain for r in c[name]]))

    out = ["## Reading (held-out seeds)", ""]
    drops = {name: sum(r.dropped for r in c[name]) for name in RUNS}
    turns = {name: sum(r.turned for r in c[name]) for name in RUNS}

    def four(counts):
        return (f"{counts['both']}/{n} runs with both looks, {counts['left']}/{n} with the left "
                f"look only, {counts['right']}/{n} with the right only and {counts['none']}/{n} "
                "with no side look")  # fmt: skip

    out.append(
        f"Rule 1 drops him back in {four(drops)}; rule 2 turns him side-on in {four(turns)}. Each "
        "rule acts at the same time in every run, on what he believes then: the counts are each "
        "look's effect on his picture."
    )
    s = sep("both", "none")
    if abs(s) < 0.5:
        out.append(f"His separation at reception barely changes with both looks ({s:+.2f} m on "
                   "average against no side looks).")  # fmt: skip
    else:
        out.append(
            f"With both looks he receives {s:+.2f} m further from the nearest opponent on average "
            f"than with no side looks (left alone {sep('left', 'none'):+.2f} m, right alone "
            f"{sep('right', 'none'):+.2f} m), and side-on in {side('both')}/{n} against "
            f"{side('none')}/{n}."
        )
    f = {name: fwd(name) for name in RUNS}
    if max(f.values()) - min(f.values()) <= 0.1 * n:
        out.append(f"His decision barely changes: forward to the striker in {four(f)}.")
    else:
        out.append(f"He plays forward to the striker in {four(f)}.")
        if f["left"] < f["none"]:
            out.append(
                "The left look alone lowers it: he drops back but, without the right look, "
                "receives square, and from there the model favours another pass more often."
            )
    out.append(
        f"The mean xT gained is {xt('both'):+.3f} with both looks, {xt('left'):+.3f} left only, "
        f"{xt('right'):+.3f} right only and {xt('none'):+.3f} with no side look."
    )
    if xt("both") < xt("right"):
        out.append(
            "What the left look adds on top of the right is space, not value: "
            f"{sep('both', 'right'):+.2f} m of separation at reception, and "
            f"{xt('both') - xt('right'):+.3f} xT gained on average. It is the right look, which "
            "shows the central defender stepping out, that opens the forward pass."
        )
    both = c["both"]
    for label, _, _ in LOOKS:
        took = [r.news[label] for r in both if label in r.news]
        if not took:
            continue
        moved = sum(bool(x.opened or x.closed) for x in took)
        nothing = sum(not x.new for x in took)
        line = (f"The {WORDS[label]} look opens or closes at least one option in {moved}/"
                f"{len(took)} runs")  # fmt: skip
        out.append(line + (f"; in {nothing} it brings nothing new." if nothing else "."))
    out += [
        "",
        "Limits: the look times are scripted for teaching; what he sees, believes and does "
        "follows the sim. The two rules are scoped to this scenario and act on his belief only. "
        "The sim has no first touch or reception mechanics, so the half-turn changes his body "
        "angle and the options open to him next (where the ball sits, where his eyes rest while "
        "he has it, what an opponent can win ball-first), not the touch.",
        "",
    ]
    return out


def render(design: list[Row], held: list[Row]) -> str:
    looks = ", ".join(f"{WORDS[label]} {direction}° at {s} s" for label, direction, s in LOOKS)
    lines = [
        "# Back to goal: a look left, a look right, then the half-turn — `pro_scan`",
        "",
        "A teaching scenario (SPEC 3.6), in the coach's order. **The look times are scripted for "
        "teaching; what he sees, believes and does follows the sim.** He starts facing his own "
        "half, toward the ball (his forward view, not a scan). His looks (direction from where "
        f"his body faces, seconds before the planned reception): {looks}. Rule 1, "
        f"{RULE_DELAY_S} s after the left look's scripted start: if he believes an opponent will "
        f"be within {NEAR_M:.0f} m of him when the ball arrives, he drops back toward the ball, up "
        f"to {MAX_SHIFT_M:.0f} m, to receive with space. Rule 2, {RULE_DELAY_S} s after the right "
        f"look's: if he believes one will be within {HALF_TURN_M:.0f} m, he receives on the "
        f"half-turn, {OPEN_DEG:.0f}° side-on, away from him. All four runs share every random "
        "draw (SPEC 3.7). Generated by `uv run python -m eval.pro_scan`.",
        "",
        *_block(f"Held-out seeds {held[0].seed}–{held[-1].seed} ({len(held)})", held),
        *_reading(held),
        *_block(f"Design seeds {design[0].seed}–{design[-1].seed} ({len(design)})", design),
        "## Per seed (held out)",
        "",
        "Runs: both looks / no side looks / left only / right only. Rules: D dropped back, "
        "T half-turn, - neither.",
        "",
        "| Seed | Rules | Separation (m) | Body (°) | Decision | Result | xT gained | Left look: "
        "new · ↑ · ↓ | Right look: new · ↑ · ↓ |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    def rules(r: RunRow) -> str:
        return ("D" if r.dropped else "") + ("T" if r.turned else "") or "-"

    def look(r: RunRow, label: str) -> str:
        x = r.news.get(label)
        if x is None:
            return "not taken"
        new = ", ".join(f"{p} {m:.1f}" for p, m in x.new[:2]) or "nothing new"
        return f"{new} · {', '.join(x.opened) or '—'} · {', '.join(x.closed) or '—'}"

    for r in held:
        rs = [r.runs[name] for name in RUNS]
        lines.append(
            f"| {r.seed} | {' / '.join(rules(x) for x in rs)} "
            f"| {' / '.join(f'{x.separation_m:.2f}' for x in rs)} "
            f"| {' / '.join(f'{x.body_deg:.0f}' for x in rs)} "
            f"| {' / '.join(f'`{x.decision}`' for x in rs)} "
            f"| {' / '.join(x.result for x in rs)} "
            f"| {' / '.join(f'{x.xt_gain:+.3f}' for x in rs)} "
            f"| {look(rs[0], 'L')} | {look(rs[0], 'R')} |"
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
