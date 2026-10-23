"""Laws of the Game audit (SPEC 3.9): where does the sim break a law the referee does not call?

    uv run python -m eval.laws --workers 4

Runs every scenario on its design seeds 0–99 and its held-out seeds 100–139 and 200–239, each hero
scenario's own intervention on the same seeds (the run the app shows beside the factual one), and
both served stitched matches (match seeds 1 and 2). `possession_play` and `open_play` run for 45 s,
as their evals do. Every run is judged frame by frame and event by event with `sim/laws.py`, the
same code the referee and the tests use, and the findings are written to eval/reports/laws.md.

A finding is one of:
- a **breach**: the sim did what a law forbids (an offside offence, a ball out of play that stays
  in play, a goal not given, a keeper handling outside his area, a tackle through the man, an
  opponent too close at a restart). It is **called** when the referee stopped play for it (an
  `out`, `goal`, `offside` or `foul` event at that frame) and **unpunished** otherwise;
- a **wrong call**: the referee stopped play or gave a goal where the Laws do not;
- an **early call**: the right call made before the whole ball had crossed the line;
- **not modelled**: the Laws cannot judge it in the sim (a ball through the woodwork, which has no
  physics yet).

The stitched match's restarts are edits between scenario runs (SPEC 3.1), not simulated play,
except where a set-piece scenario plays one (`corner_blind_side`'s corner). They are listed with
what the Laws would award, apart from the counts.
"""

from __future__ import annotations

import argparse
import os
import pickle
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from sim import laws
from sim.ball import BallParams
from sim.config import SimParams
from sim.counterfactual import hero_counterfactual
from sim.engine import Simulation
from sim.match import SET_PIECES, build_match
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
CACHE = Path("out") / "laws_audit.pickle"
DESIGN = list(range(100))
HELD_OUT = [*range(100, 140), *range(200, 240)]
MATCH_SEEDS = (1, 2)
LONG_S = 45.0  # possession_play and open_play, as in eval/realism.py
LONG = ("possession_play", "open_play")
# The demo seeds of the heroes (sim/match.py's plan), and seed 0 for the heroes it does not play.
DEMO = {"blind_side_run": 3, "press_escape": 0, "far_post_finish": 11, "corner_blind_side": 0}
CALLS = ("out", "goal", "offside", "foul")  # the referee's whistle: play stops
TOUCHES = ("reception", "interception", "tackle", "save")

BREACH, WRONG, EARLY, UNMODELLED = "breach", "wrong call", "early call", "not modelled"
# kind -> (law, category)
KINDS = {
    "team sheet": ("3.1", BREACH),
    "ball out, play on": ("9.1", BREACH),
    "out called before the whole ball crossed": ("9.1", EARLY),
    "goal not given": ("10.1", BREACH),
    "goal given before the whole ball crossed": ("10.1", EARLY),
    "goal given, the ball was not between the posts": ("10.1", WRONG),
    "goal credited to the wrong team": ("10.1", WRONG),
    "ball through the woodwork, given as a goal": ("10.1", UNMODELLED),
    "ball through the woodwork, played on": ("10.1", UNMODELLED),
    "offside offence": ("11.2", BREACH),
    "offside called without an offence": ("11.2", WRONG),
    "keeper handled outside his area": ("12.1", BREACH),
    "tackle through the man": ("12.1", BREACH),
    "restart: opponent too close": ("13-17", BREACH),
    "restart: ball in the wrong place": ("13-17", BREACH),
}
# What each law's checks look at, for the "By law" table.
CHECKED = {
    "3.1": ("runs", "line-ups: eleven a side, one keeper"),
    "9.1": ("frames", "frames in play: the whole ball over a line stops play"),
    "10.1": ("goal-line crossings", "whole-ball crossings of a goal line, and every goal given"),
    "11.2": ("kicks", "passes and shots: offside position, then involvement"),
    "12.1": ("saves and tackles", "keeper handling (saves) and tackles"),
    "13-17": ("restarts", "simulated restarts: distances and the ball's place"),
}


@dataclass(frozen=True)
class Finding:
    kind: str
    run: str
    frame: int
    player: str | None
    detail: str
    called: bool = False

    @property
    def law(self) -> str:
        return KINDS[self.kind][0]

    @property
    def category(self) -> str:
        return KINDS[self.kind][1]

    @property
    def unpunished(self) -> bool:
        return self.category == BREACH and not self.called


@dataclass(frozen=True)
class KickJudgement:
    """One pass or shot as the offside law sees it (the hero tables)."""

    frame: int
    kicker: str
    to: str | None  # intended receiver (passes)
    kind: str  # pass | shot
    restart: str | None
    margin: float | None  # the intended receiver beyond the offside line (m, <= 0: not)
    line_by: str  # what sets the line: a player id, "ball" or "halfway"
    offence: str | None  # who committed one, and how


@dataclass
class RunAudit:
    label: str
    scenario: str
    seed: int
    group: str  # design | held-out | intervention | match <seed>
    findings: list[Finding] = field(default_factory=list)
    checked: Counter = field(default_factory=Counter)
    kicks: list[KickJudgement] = field(default_factory=list)
    off_field: float = 0.0  # furthest any player stood off the field while the ball was in play
    off_field_by: str | None = None
    off_field_frames: int = 0
    # The goal frame (Law 1.10): the closest any player's centre came to a post's, and the frames
    # with a player inside a goal (behind the line between the posts), the whole run.
    post_gap: float = float("inf")
    post_by: str | None = None
    in_goal_frames: int = 0
    keeper_line_frames: int = 0  # a keeper sweeping his line past his post


# --- judging one run -----------------------------------------------------------------------------


def _stop(run: MatchRun) -> int | None:
    calls = [e.frame for e in run.events if e.type in CALLS]
    return min(calls) if calls else None


def _line_setter(pos, team, ball, attacking, ids) -> str:
    """What sets the offside line: the second-last opponent's id, "ball" or "halfway"."""
    opp = np.flatnonzero(team != attacking)
    d = laws.depth(laws.clip_to_field(pos[opp]), attacking)
    second = opp[np.argsort(d, kind="stable")[-2]]
    d2, db = float(np.sort(d)[-2]), float(laws.depth(ball, attacking))
    best = max(0.0, db, d2)
    return "halfway" if best == 0.0 else "ball" if best == db else ids[second]


def audit_run(run: MatchRun, label: str, group: str, restart: str | None = None) -> RunAudit:
    """Every finding in one run. `restart` is the restart its first kick is (simulated set
    pieces only: a corner kick is exempt from offside and has its own distances)."""
    a = RunAudit(label, run.scenario, run.seed, group)
    ids, team = run.ids, np.array([p.team for p in run.players])
    roles = [p.role for p in run.players]
    radius = BallParams().radius
    events = sorted(run.events, key=lambda e: (e.frame, e.id))
    stop = _stop(run)
    last = len(run.owner) - 1 if stop is None else stop
    by_frame = defaultdict(list)
    for e in events:
        by_frame[e.frame].append(e)

    def add(kind: str, frame: int, player: str | None, detail: str, called: bool = False) -> None:
        a.findings.append(Finding(kind, label, int(frame), player, detail, called))

    # The goal frame (Law 1.10): no body through a post, nobody inside a goal.
    gaps = laws.post_distance(run.pos)
    f, i = np.unravel_index(int(np.argmin(gaps)), gaps.shape)
    a.post_gap, a.post_by = float(gaps[f, i]), f"{ids[i]} ({roles[i]}) at frame {f}"
    a.in_goal_frames = int(laws.in_goal(run.pos).any(axis=1).sum())
    keepers = [k for k, r in enumerate(roles) if r == "GK"]
    speed = np.linalg.norm(run.vel[:, keepers], axis=-1)
    a.keeper_line_frames = int(
        laws.along_line_past_posts(run.pos[:, keepers], speed).any(axis=1).sum()
    )

    # Law 3: the line-up.
    a.checked["3.1"] += 1
    for problem in laws.team_sheet_breaches(team.tolist(), roles):
        add("team sheet", 0, None, problem)

    # Off the field (informational): how far players stand beyond the lines while in play.
    outside = laws.distance_outside(run.pos[: last + 1])
    if outside.size and outside.max() > 0.0:
        f, i = np.unravel_index(int(np.argmax(outside)), outside.shape)
        a.off_field, a.off_field_by = float(outside[f, i]), f"{ids[i]} ({roles[i]}) at frame {f}"
        a.off_field_frames = int((outside > 0.0).any(axis=1).sum())

    # Law 9: the whole ball over a line must stop play, and only then.
    a.checked["9.1"] += last + 1
    first_out = next(
        (f for f in range(last + 1) if laws.ball_out(run.ball_pos[f], radius) is not None), None
    )
    stop_events = [e for e in by_frame.get(stop, []) if e.type in CALLS] if stop is not None else []
    if first_out is not None and (stop is None or first_out < stop):
        line = laws.ball_out(run.ball_pos[first_out], radius)
        holder = int(run.owner[first_out])
        how = f"carried by {ids[holder]}" if holder >= 0 else "rolling"
        beyond = float(laws.distance_outside(run.ball_pos[first_out, :2]))
        played = "the run ends" if stop is None else f"play stopped at frame {stop}"
        add(
            "ball out, play on",
            first_out,
            ids[holder] if holder >= 0 else None,
            f"over the {line.replace('_', ' ')}, {how}, centre {beyond:.2f} m beyond; {played}",
        )
    for e in stop_events:
        if e.type == "out" and laws.ball_out(run.ball_pos[e.frame], radius) is None:
            beyond = float(laws.distance_outside(run.ball_pos[e.frame, :2]))
            add(
                "out called before the whole ball crossed",
                e.frame,
                e.player,
                f"centre {beyond:.3f} m beyond the line (the whole ball: {radius:.2f} m)",
            )

    # Law 10: whole-ball crossings of a goal line, and every goal given.
    crossings = []
    for f in range(1, last + 1):
        c = laws.goal_line_crossing(run.ball_pos[f - 1], run.ball_pos[f], radius)
        if c is not None:
            crossings.append((f, c))
    goals = [e for e in events if e.type == "goal"]
    if stop is not None and not crossings and stop >= 1:
        # The engine freezes the ball where it calls it: extend its last step to read the line.
        b0, b1 = run.ball_pos[stop - 1], run.ball_pos[stop]
        step = float(abs(b1[0] - b0[0]))
        if step > 1e-6:
            c = laws.goal_line_crossing(b0, b0 + (b1 - b0) * (1.0 + 3 * radius / step), radius)
            if c is not None:
                crossings.append((stop, c))
    a.checked["10.1"] += len(crossings) + len(goals)
    for f, c in crossings:
        scored = [g for g in goals if g.frame <= f + 1]
        attacking = 0 if c.end == 1 else 1
        if c.verdict == "goal" and not scored:
            add(
                "goal not given",
                f,
                None,
                f"whole ball over the goal line at y {c.y:+.2f} m (inside the posts: "
                f"|y| ≤ {laws.GOAL_HALF_WIDTH - radius:.2f}); a goal for team {attacking}",
            )
        if c.verdict == "post":
            add(
                "ball through the woodwork, " + ("given as a goal" if scored else "played on"),
                f,
                None,
                f"centre at y {c.y:+.2f} m as it crosses: part of the ball meets a post",
            )
        for g in scored:
            if c.verdict not in ("goal", "post"):
                add(
                    "goal given, the ball was not between the posts",
                    g.frame,
                    g.player,
                    f"{c.verdict} at y {c.y:+.2f} m",
                )
            if g.team != attacking:
                add(
                    "goal credited to the wrong team",
                    g.frame,
                    g.player,
                    f"team {g.team} credited at the goal team {attacking} attacks",
                )
    for g in goals:
        if laws.ball_out(run.ball_pos[g.frame], radius) is None:
            beyond = float(laws.distance_outside(run.ball_pos[g.frame, :2]))
            add(
                "goal given before the whole ball crossed",
                g.frame,
                g.player,
                f"centre {beyond:.3f} m beyond the line (the whole ball: {radius:.2f} m)",
            )

    # Law 11: every pass and shot in play, its offside positions, and what the players did next.
    kicks = [e for e in events if e.type in ("pass", "shot") and e.frame <= last]
    offside_calls = {(e.player, e.frame) for e in events if e.type == "offside"}
    matched_calls = set()
    a.checked["11.2"] += len(kicks)
    for n, e in enumerate(kicks):
        f, k, attacking = e.frame, run.index(e.player), e.team
        pos, ball = run.pos[f], run.ball_pos[f, :2]
        in_pos = laws.offside_positions(pos, team, ball, attacking, kicker=k)
        margins = laws.offside_margins(pos, team, ball, attacking)
        setter = _line_setter(pos, team, ball, attacking, ids)
        kick_restart = restart if n == 0 else None
        # The next touch of the ball after the kick, before play stops.
        nxt = next((t for t in events if t.type in TOUCHES and f < t.frame <= last), None)
        offence = None
        if nxt is not None:
            g, toucher = nxt.frame, run.index(nxt.player)
            if team[toucher] == attacking and nxt.type == "reception":
                how = laws.offside_offence(
                    bool(in_pos[toucher]), restart=kick_restart, played_ball=True
                )
                if how:
                    offence = (toucher, g, how)
            else:  # an opponent plays it: did an attacker in an offside position challenge him?
                near = np.linalg.norm(run.pos[g] - run.ball_pos[g, :2], axis=-1)
                for j in np.flatnonzero(in_pos & (near <= laws.CHALLENGE_RADIUS)):
                    offence = (int(j), g, laws.offside_offence(True, challenged=True))
                    break
        if offence is None and e.type == "shot":
            keeper = next(
                (j for j in range(len(ids)) if team[j] != attacking and roles[j] == "GK"), None
            )
            if keeper is not None:
                for j in np.flatnonzero(in_pos):
                    if laws.obstructs_view(pos[keeper], ball, pos[j]):
                        offence = (int(j), f, laws.offside_offence(True, blocked_view=True))
                        break
        if offence is not None:
            j, g, how = offence
            called = (ids[j], g) in offside_calls
            matched_calls.add((ids[j], g))
            add(
                "offside offence",
                g,
                ids[j],
                f"{how}: {e.player}'s {e.type} at frame {f}, {margins[j]:.2f} m beyond "
                f"{_describe_line(setter)}",
                called,
            )
        to = e.attrs.get("to") if e.type == "pass" else None
        margin = float(margins[run.index(to)]) if to else None
        if margin is not None:
            a.checked["passes"] += 1
            a.checked["passes to an offside position"] += margin > laws.LEVEL_TOLERANCE
        a.kicks.append(
            KickJudgement(
                f,
                e.player,
                to,
                e.type,
                kick_restart,
                margin,
                setter,
                None if offence is None else f"{ids[offence[0]]}: {offence[2]}",
            )
        )
    for pid, g in sorted(offside_calls - matched_calls):
        add("offside called without an offence", g, pid, "no offside offence at this frame")

    # Law 12: the keeper's hands (saves) and tackles.
    for e in events:
        if e.frame > last:
            continue
        if e.type == "save":
            a.checked["12.1"] += 1
            k = run.index(e.player)
            if not laws.keeper_may_handle(run.pos[e.frame, k], int(team[k])):
                x, y = run.pos[e.frame, k]
                add(
                    "keeper handled outside his area",
                    e.frame,
                    e.player,
                    f"saved at ({x:.2f}, {y:.2f})",
                )
        elif e.type == "tackle":
            a.checked["12.1"] += 1
            tackler, carrier = run.index(e.player), run.index(e.attrs["won_from"])
            ball = np.asarray(e.attrs["at"])
            if not laws.ball_first(run.pos[e.frame, tackler], run.pos[e.frame, carrier], ball):
                to_ball = float(np.linalg.norm(run.pos[e.frame, tackler] - ball))
                to_man = float(
                    np.linalg.norm(run.pos[e.frame, tackler] - run.pos[e.frame, carrier])
                )
                fouled = any(c.type == "foul" and c.frame == e.frame for c in events)
                add(
                    "tackle through the man",
                    e.frame,
                    e.player,
                    f"won it from {e.attrs['won_from']}: {to_ball:.2f} m from the ball, "
                    f"{to_man:.2f} m from him",
                    fouled,
                )

    # Laws 13-17: a simulated restart, from the first frame until its kick puts the ball in play.
    if restart is not None and kicks:
        kick = kicks[0]
        a.checked["13-17"] += 1
        taker = run.index(kick.player)
        worst: dict[tuple[str, int | None], laws.Breach] = {}
        for f in range(kick.frame + 1):
            for b in laws.restart_breaches(restart, run.ball_pos[f, :2], run.pos[f], team, taker):
                if b.player is None and f != kick.frame:
                    continue  # the ball's place counts when it is kicked
                key = (b.rule, b.player)
                if key not in worst or b.value < worst[key].value:
                    worst[key] = b
        for (rule, j), b in sorted(worst.items(), key=lambda kv: (kv[0][0], kv[0][1] or -1)):
            kind = (
                "restart: ball in the wrong place" if j is None else "restart: opponent too close"
            )
            who = None if j is None else ids[j]
            add(
                kind,
                kick.frame,
                who,
                f"{restart}: {rule} (Law {b.law}): {b.value:.2f} m, needs {b.required:.2f} m",
            )
    return a


def _describe_line(setter: str) -> str:
    if setter in ("ball", "halfway"):
        return "the ball" if setter == "ball" else "the halfway line"
    return f"the second-last opponent {setter}"


# --- what to run ---------------------------------------------------------------------------------


def _params(scenario: str) -> SimParams:
    return SimParams(max_duration_s=LONG_S) if scenario in LONG else SimParams()


def audit_scenario_seed(task: tuple[str, int]) -> list[RunAudit]:
    """The factual run of (scenario, seed), and its hero intervention when it has one."""
    name, seed = task
    group = "design" if seed in DESIGN else "held-out"
    restart = SET_PIECES.get(name)
    label = f"{name} {seed}"
    out = []
    run = Simulation.from_scenario(name, seed, params=_params(name)).run()
    out.append(_finish(audit_run(run, label, group, restart), run))
    if SCENARIOS[name].intervention:
        try:
            cf = hero_counterfactual(name, seed).counterfactual
        except (StopIteration, ValueError):  # no key scan or step on this seed: nothing to drop
            return out
        out.append(
            _finish(
                audit_run(cf, f"{label} ({SCENARIOS[name].intervention})", "intervention", restart),
                cf,
            )
        )
    return out


def _finish(a: RunAudit, run: MatchRun) -> RunAudit:
    """Kicks are kept for the hero tables only (factual runs on the demo seeds)."""
    if run.hero is None or a.group == "intervention" or run.seed != DEMO.get(run.scenario, 0):
        a.kicks = []
    return a


@dataclass
class Stitch:
    match: int
    index: int
    scenario: str
    label: str  # the match's restart label
    expected: str  # what the Laws award after the previous possession
    awarded_to: int | None
    starts_with: int | None  # the team on the ball in the possession's first frame
    simulated: bool


def audit_match(seed: int) -> tuple[list[RunAudit], list[Stitch]]:
    match = build_match(seed)
    audits, stitches = [], []
    for k, p in enumerate(match.possessions):
        restart = SET_PIECES.get(p.scenario)
        label = f"match {seed} #{k} {p.scenario} {p.seed}"
        a = audit_run(p.run, label, f"match {seed}", restart)
        a.kicks = []
        audits.append(a)
        owner = int(p.run.owner[0])
        starts = int(p.run.players[owner].team) if owner >= 0 else None
        if k == 0:
            expected, awarded = "kick_off", None
        else:
            expected, awarded = expected_restart(match.possessions[k - 1].run)
        stitches.append(
            Stitch(
                seed,
                k,
                p.scenario,
                p.restart,
                expected,
                awarded,
                starts,
                restart is not None and restart == p.restart,
            )
        )
    return audits, stitches


def expected_restart(run: MatchRun) -> tuple[str, int | None]:
    """What the Laws award after a possession, and to which team: a kick-off to the team that
    conceded, a throw-in, goal kick or corner by where the whole ball left and who touched it last
    (Laws 8, 15-17), or "cut" while the ball is still in play."""
    stop = _stop(run)
    calls = [e for e in run.events if e.type in CALLS and e.frame == stop]
    goal = next((e for e in calls if e.type == "goal"), None)
    if goal is not None:
        return "kick_off", 1 - goal.team
    out = next((e for e in calls if e.type == "out"), None)
    if out is None:
        return "cut", None
    x, y = run.ball_pos[out.frame, :2]
    if abs(y) - laws.HALF_WIDTH >= abs(x) - laws.HALF_LENGTH:
        return "throw_in", 1 - out.team
    defending = 1 if x > 0 else 0
    return ("corner", 1 - defending) if out.team == defending else ("goal_kick", defending)


# --- the report ----------------------------------------------------------------------------------


def collect(workers: int) -> tuple[list[RunAudit], list[Stitch]]:
    tasks = [(name, seed) for name in sorted(SCENARIOS) for seed in [*DESIGN, *HELD_OUT]]
    audits: list[RunAudit] = []
    stitches: list[Stitch] = []
    with ProcessPoolExecutor(workers) as pool:
        for result in pool.map(audit_scenario_seed, tasks, chunksize=8):
            audits += result
        for match_audits, match_stitches in pool.map(audit_match, MATCH_SEEDS):
            audits += match_audits
            stitches += match_stitches
    return audits, stitches


def _fmt(n: int) -> str:
    return f"{n:,}"


def render(audits: list[RunAudit], stitches: list[Stitch]) -> str:
    findings = [f for a in audits for f in a.findings]
    unpunished = [f for f in findings if f.unpunished]
    groups = ("design", "held-out", "intervention", *(f"match {s}" for s in MATCH_SEEDS))
    runs = Counter(a.group for a in audits)
    lines = [
        "# Laws of the Game audit (SPEC 3.9)",
        "",
        "`uv run python -m eval.laws`. Every scenario on design seeds 0–99 and held-out seeds "
        "100–139 and 200–239, each hero scenario's own intervention on the same seeds, and the "
        f"stitched matches {', '.join(map(str, MATCH_SEEDS))} (each on its own plan, "
        "`sim.match.plan_for`), judged with `sim/laws.py`: the IFAB *Laws of the Game 2026/27* "
        "(theifab.com), each rule cited by law and section and restated in our own words there. "
        f"`possession_play` and `open_play` run {LONG_S:.0f} s. Runs: "
        + ", ".join(f"{runs[g]} {g}" for g in groups)
        + f" ({_fmt(len(audits))} in all).",
        "",
        "A **breach** is something a law forbids; it is **called** when the referee stopped play "
        "for it and **unpunished** otherwise. A **wrong call** stops play or gives a goal where "
        "the Laws do not, an **early call** is the right call before the whole ball had crossed, "
        "and **not modelled** is what the sim has no physics for (the woodwork).",
        "",
        f"**{_fmt(len(unpunished))} unpunished breaches**, "
        f"{_fmt(sum(f.category == BREACH and f.called for f in findings))} called, "
        f"{_fmt(sum(f.category == WRONG for f in findings))} wrong calls, "
        f"{_fmt(sum(f.category == EARLY for f in findings))} early calls, "
        f"{_fmt(sum(f.category == UNMODELLED for f in findings))} not modelled.",
        "",
        *_demo_lines(audits),
        "## By law",
        "",
        "| Law | What is checked | Checked | Breaches | Called | Unpunished | Wrong calls | "
        "Early calls | Not modelled |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    checked = Counter()
    for a in audits:
        checked.update(a.checked)
    for law, (unit, what) in CHECKED.items():
        mine = [f for f in findings if f.law == law]
        lines.append(
            f"| {law} | {what} | {_fmt(checked[law])} {unit} | "
            f"{sum(f.category == BREACH for f in mine)} | "
            f"{sum(f.category == BREACH and f.called for f in mine)} | "
            f"{sum(f.unpunished for f in mine)} | {sum(f.category == WRONG for f in mine)} | "
            f"{sum(f.category == EARLY for f in mine)} | "
            f"{sum(f.category == UNMODELLED for f in mine)} |"
        )

    lines += ["", "## Every finding by kind and run set", ""]
    kinds = [k for k in KINDS if any(f.kind == k for f in findings)]
    by_group = {a.label: a.group for a in audits}
    lines += [
        "| Finding | Law | Category | " + " | ".join(groups) + " |",
        "|---|---|---|" + "---|" * len(groups),
    ]
    for k in kinds:
        counts = Counter(by_group[f.run] for f in findings if f.kind == k)
        law, cat = KINDS[k]
        lines.append(
            f"| {k} | {law} | {cat} | " + " | ".join(str(counts[g]) for g in groups) + " |"
        )
    if not kinds:
        lines.append("| none | | | " + " | ".join("0" for _ in groups) + " |")

    lines += [
        "",
        "## Unpunished breaches by scenario",
        "",
        "Runs with at least one unpunished breach, of all runs, per scenario and run set; then "
        "the unpunished breaches per law.",
        "",
        "| Scenario | Run set | Runs with one | Runs | 3.1 | 9.1 | 10.1 | 11.2 | 12.1 | 13-17 |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    table = defaultdict(list)
    for a in audits:
        table[(a.scenario, a.group)].append(a)
    for (scenario, group), rows in sorted(
        table.items(), key=lambda kv: (kv[0][0], groups.index(kv[0][1]))
    ):
        bad = [x for x in rows if any(f.unpunished for f in x.findings)]
        per = Counter(f.law for x in rows for f in x.findings if f.unpunished)
        lines.append(
            f"| `{scenario}` | {group} | {len(bad)} | {len(rows)} | "
            + " | ".join(str(per[law]) for law in CHECKED)
            + " |"
        )

    lines += _hero_tables(audits)
    lines += _stitch_tables(stitches)
    lines += _off_field_table(audits)
    lines += _woodwork_table(audits)
    lines += ["", "## Examples", "", "Up to five per finding, in run order.", ""]
    for k in kinds:
        lines += [f"**{k}** (Law {KINDS[k][0]}, {KINDS[k][1]})", ""]
        for f in [f for f in findings if f.kind == k][:5]:
            who = f" {f.player}" if f.player else ""
            lines.append(
                f"- {f.run}, frame {f.frame}{who}: {f.detail}{' — called' if f.called else ''}"
            )
        lines.append("")
    lines += _static_checks()
    return "\n".join(lines).rstrip() + "\n"


def _demo_lines(audits: list[RunAudit]) -> list[str]:
    """One line per hero moment of the stitched match (its demo seed): onside, or the offence."""
    out = []
    for name, seed in DEMO.items():
        a = next(x for x in audits if x.label == f"{name} {seed}")
        bad = [f for f in a.findings if f.unpunished]
        verdict = "; ".join(f"{f.player} {f.kind}, {f.detail}" for f in bad) or "no breach"
        out.append(f"- `{name}` {seed} (in the stitched match): {verdict}.")
    return [*out, ""]


def _hero_tables(audits: list[RunAudit]) -> list[str]:
    lines = [
        "",
        "## Hero moments on their demo seeds",
        "",
        "Every pass and shot of the factual run. Margin: how far the intended receiver stood "
        "beyond the offside line when the ball was played (m; ≤ 0 is onside). Seeds: the demo "
        "seeds of the stitched match, 0 for the heroes it does not play.",
        "",
        "| Run | Frame | Kick | Restart | Receiver's margin | Line set by | Offence |",
        "|---|---|---|---|---|---|---|",
    ]
    for a in audits:
        if a.group == "intervention" or not a.kicks:
            continue
        seed = DEMO.get(a.scenario, 0)
        if a.seed != seed:
            continue
        for k in a.kicks:
            line_by = k.line_by
            margin = "—" if k.margin is None else f"{k.margin:+.2f}"
            to = f" → {k.to}" if k.to else ""
            lines.append(
                f"| `{a.scenario}` {a.seed} | {k.frame} | {k.kicker}{to} ({k.kind}) | "
                f"{k.restart or '—'} | {margin} | {line_by} | {k.offence or '—'} |"
            )
    lines += [
        "",
        "Hero scenarios over all their seeds: factual runs with an offside offence anywhere in "
        "the run, and runs where the offender is the hero or the player the hero passed to.",
        "",
        "| Scenario | Run set | Runs | With an offside offence | Hero or his receiver |",
        "|---|---|---|---|---|",
    ]
    heroes = {name: cls.hero for name, cls in SCENARIOS.items() if cls.hero}
    for name in sorted(heroes):
        for group in ("design", "held-out", "intervention"):
            rows = [a for a in audits if a.scenario == name and a.group == group]
            if not rows:
                continue
            off = [a for a in rows if any(f.kind == "offside offence" for f in a.findings)]
            hero_off = [
                a
                for a in off
                if any(
                    f.kind == "offside offence" and _hero_related(f, heroes[name])
                    for f in a.findings
                )
            ]
            lines.append(f"| `{name}` | {group} | {len(rows)} | {len(off)} | {len(hero_off)} |")
    return lines


def _hero_related(f: Finding, hero: str) -> bool:
    return f.player == hero or f"{hero}'s pass" in f.detail


def _stitch_tables(stitches: list[Stitch]) -> list[str]:
    lines = [
        "",
        "## Stitched matches: restarts",
        "",
        "How each possession of a match begins (its label), what the Laws award after the "
        "previous possession and to whom, which team has the ball in the possession's first "
        "frame, and whether the restart is played in the sim. Only a set-piece scenario plays "
        "one; every other stitch is an edit (SPEC 3.1).",
        "",
        "| Match | Restarts | Label as the Laws award | Played in the sim | Edits "
        "| … to the awarded team |",
        "|---|---|---|---|---|---|",
    ]
    for seed in MATCH_SEEDS:
        rows = [s for s in stitches if s.match == seed]
        restarts = [s for s in rows if s.expected != "cut"]
        same = sum(s.label == s.expected for s in rows)
        played = [s for s in restarts if s.simulated]
        edits = [s for s in restarts if not s.simulated]
        right_team = sum(s.awarded_to is None or s.starts_with == s.awarded_to for s in edits)
        lines.append(
            f"| {seed} | {len(restarts)} of {len(rows)} stitches | {same}/{len(rows)} | "
            f"{len(played)} | {len(edits)} | {right_team}/{len(edits)} |"
        )
    lines += [
        "",
        "| Match | # | Scenario | Label | The Laws award | To team | First team on the ball "
        "| Played |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for s in stitches:
        if s.expected == "cut" and s.label == "cut":
            continue
        team = "—" if s.awarded_to is None else str(s.awarded_to)
        starts = "—" if s.starts_with is None else str(s.starts_with)
        lines.append(
            f"| {s.match} | {s.index} | `{s.scenario}` | {s.label} | {s.expected} | "
            f"{team} | {starts} | {'yes' if s.simulated else 'no (edit)'} |"
        )
    return lines


def _woodwork_table(audits: list[RunAudit]) -> list[str]:
    near = [a for a in audits if a.post_gap < laws.POST_CLEARANCE or a.in_goal_frames]
    lines = [
        "",
        "## Players and the goal frame (Law 1.10)",
        "",
        f"No player's body may overlap a post: his centre stays {laws.POST_CLEARANCE:.2f} m "
        f"from the post's ({laws.BODY_RADIUS:.1f} m body, {laws.POST_RADIUS:.2f} m post), and "
        f"nobody stands inside a goal. **{len(near)} of {_fmt(len(audits))} runs** break it. "
        "No keeper sweeps his goal line past his post (within 1 m of the line, more than a body "
        "outside the post, over 2 m/s): "
        f"**{sum(a.keeper_line_frames > 0 for a in audits)} runs**. Per scenario and run set:",
        "",
        "| Scenario | Run set | Runs | Through a post or in a goal | Keeper along his line past "
        "a post | Closest to a post (m) | Who |",
        "|---|---|---|---|---|---|---|",
    ]
    groups = ("design", "held-out", "intervention", *(f"match {s}" for s in MATCH_SEEDS))
    table = defaultdict(list)
    for a in audits:
        table[(a.scenario, a.group)].append(a)
    for (scenario, group), rows in sorted(
        table.items(), key=lambda kv: (kv[0][0], groups.index(kv[0][1]))
    ):
        worst = min(rows, key=lambda a: a.post_gap)
        bad = sum(a.post_gap < laws.POST_CLEARANCE or a.in_goal_frames > 0 for a in rows)
        sweeps = sum(a.keeper_line_frames > 0 for a in rows)
        lines.append(
            f"| `{scenario}` | {group} | {len(rows)} | {bad} | {sweeps} | {worst.post_gap:.2f} | "
            f"{worst.label}: {worst.post_by} |"
        )
    return lines


def _off_field_table(audits: list[RunAudit]) -> list[str]:
    lines = [
        "",
        "## Players off the field while the ball is in play (informational)",
        "",
        "Not a breach by itself: players may leave the field in the course of play, and for "
        "offside they count as on the line (Law 11.1). Runs where any player stood beyond the "
        "outer edge of a line, the furthest, and who.",
        "",
        "| Scenario | Run set | Runs with one | Runs | Furthest (m) | Who |",
        "|---|---|---|---|---|---|",
    ]
    groups = ("design", "held-out", "intervention", *(f"match {s}" for s in MATCH_SEEDS))
    table = defaultdict(list)
    for a in audits:
        table[(a.scenario, a.group)].append(a)
    for (scenario, group), rows in sorted(
        table.items(), key=lambda kv: (kv[0][0], groups.index(kv[0][1]))
    ):
        off = [a for a in rows if a.off_field > 0.0]
        if not off:
            continue
        worst = max(off, key=lambda a: a.off_field)
        lines.append(
            f"| `{scenario}` | {group} | {len(off)} | {len(rows)} | "
            f"{worst.off_field:.2f} | {worst.label}: {worst.off_field_by} |"
        )
    return lines


def _static_checks() -> list[str]:
    from analytics.xt import GOAL_X
    from sim import config, shots

    lo, hi = laws.BALL_RADIUS_RANGE
    r = BallParams().radius
    rows = [
        (
            "1",
            "pitch 105 × 68 m (sim.config)",
            (config.HALF_LENGTH, config.HALF_WIDTH) == (laws.HALF_LENGTH, laws.HALF_WIDTH),
        ),
        (
            "1",
            "goal 7.32 m between the posts (sim.shots)",
            shots.GOAL_HALF_WIDTH * 2 == laws.GOAL_WIDTH,
        ),
        ("1", "goal line at x = ±52.5 m (analytics.xt)", GOAL_X == laws.HALF_LENGTH),
        ("2", f"ball radius {r:.3f} m in {lo:.4f}–{hi:.4f} m (68–70 cm round)", lo <= r <= hi),
    ]
    lines = ["## Static checks", "", "| Law | Check | Holds |", "|---|---|---|"]
    lines += [f"| {law} | {what} | {'yes' if ok else '**no**'} |" for law, what, ok in rows]
    lines += [
        "",
        "Not checked here: the web app's pitch markings (`web/src/views`), drawn from its own "
        "literals.",
    ]
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Laws of the Game audit of the sim (SPEC 3.9).")
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--out", type=Path, default=REPORTS / "laws.md")
    parser.add_argument("--from-cache", action="store_true", help=f"re-render {CACHE}")
    args = parser.parse_args()
    if args.from_cache:
        audits, stitches = pickle.loads(CACHE.read_bytes())
    else:
        audits, stitches = collect(args.workers)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(pickle.dumps((audits, stitches)))
    args.out.write_text(render(audits, stitches))
    unpunished = sum(f.unpunished for a in audits for f in a.findings)
    print(f"wrote {args.out}: {unpunished} unpunished breaches in {len(audits)} runs")


if __name__ == "__main__":
    main()
