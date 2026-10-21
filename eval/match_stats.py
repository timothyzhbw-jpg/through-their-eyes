"""Match statistics (SPEC 3.1, 9): passes, possession changes, possessions and shots per match.

    uv run python -m eval.match_stats --seeds 100-119

Builds the stitched match (sim/match.py, `build_match`) on held-out match seeds and counts, per
match and per 90 min of play (SPEC 3.1: rates are normalised per 90 min), the passes and how they
ended, the possession changes and how they happened (interception, tackle, out of play), the team
possessions and their length, and the shots. A row has a target only when SPEC 3 sets one or a
paper cited in docs/REFERENCES.md prints one; every other row is marked "no published reference",
never filled in. Shot outcomes are "pending module A" (the shot model, `Scenario.shots`, is on
main but no scenario of the default plan turns it on), never invented. Nothing here tunes the
sim. Writes eval/reports/match_stats.md.
"""

from __future__ import annotations

import argparse
import math
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from eval.realism import (
    BOOTSTRAP,
    INCONCLUSIVE,
    INSIDE,
    MIN_GROUP,
    NO_REFERENCE,
    OUTSIDE,
    VERDICTS,
    Pool,
    Row,
    _num,
    _parse_seeds,
    _span,
    _verdict,
    _wmean,
    _wsd,
)
from sim.match import DEFAULT_PLAN, SET_PIECES, Possession, StitchedMatch, build_match

REPORTS = Path(__file__).parent / "reports"

COLUMNS = (
    "Metric", "Sim (pooled)", "Sim, 90% over seeds", "Target", "Range checked", "Source", "Inside",
)  # fmt: skip
PENDING = "pending module A"
PER_90_S = 90 * 60.0
CHANGES = ("interception", "tackle", "out")  # how a team loses the ball
ENDINGS = (*CHANGES, "cut")  # how a team possession ends: lost, or its scenario possession is cut
OUT_RESTARTS = ("throw_in", "goal_kick", "corner")
# SPEC 3.1: "A match is 15–25 scenario-driven possessions (§3.6) stitched together with restarts
# (kick-off, throw-in, goal kick, corner): 10–15 min of play in total". Design targets of the
# spec, not published values.
SPEC_POSSESSIONS = (15, 25)
SPEC_PLAY_MIN = (10.0, 15.0)
SPEC_SOURCE = "SPEC §3.1"
MATCH_COLUMNS = (
    "passes", "decided", "completed", "resolved", "unresolved", "changes", *CHANGES, "shots",
    "goals", "cuts", "cut_switches", "out_restarts", "out_restarts_kept",
)  # fmt: skip


# --- measurements on one match ---------------------------------------------------------------


@dataclass(frozen=True)
class TeamPossession:
    team: int
    start: int  # frame of its scenario possession's run
    end: int  # frame after its last frame
    passes: int
    ended: str  # one of ENDINGS


def live_events(run) -> list:
    """The run's events in frame order, up to its first `out`: after it the ball is dead."""
    events = sorted(run.events, key=lambda e: e.frame)
    out = next((e.frame for e in events if e.type == "out"), None)
    return [e for e in events if out is None or e.frame <= out]


def team_possessions(possession: Possession) -> list[TeamPossession]:
    """Spells of one team on the ball in one scenario possession.

    A spell starts when the scenario possession starts or a team wins the ball, and ends when that
    team loses it (interception, tackle, out of play) or the scenario possession is cut. A free
    ball belongs to the team that last had it.
    """
    run = possession.run
    team = [p.team for p in run.players]
    owned = np.flatnonzero(np.asarray(run.owner) >= 0)
    if owned.size == 0:
        return []
    events = live_events(run)
    kicks = [e for e in events if e.type == "pass"]
    spells: list[TeamPossession] = []
    holder, start = team[int(run.owner[owned[0]])], int(owned[0])

    def close(end: int, ended: str) -> None:
        passes = sum(e.team == holder and start <= e.frame < end for e in kicks)
        spells.append(TeamPossession(holder, start, end, passes, ended))

    for e in events:
        if e.type in ("interception", "tackle"):
            close(e.frame, e.type)
            holder, start = e.team, e.frame
        elif e.type == "out":
            close(e.frame, "out")
            return spells
    close(possession.frames, "cut")
    return spells


def measure(match: StitchedMatch) -> dict[str, dict[str, np.ndarray]]:
    """Per-observation tables of one match: the match, its scenario and its team possessions."""
    counts: Counter[str] = Counter()
    spells: list[TeamPossession] = []
    scenario: dict[str, list] = {"name": [], "length": [], "home_start": []}
    previous: list[TeamPossession] = []
    for k, p in enumerate(match.possessions):
        events = live_events(p.run)
        decided = {(d.player, d.frame) for d in p.run.decisions}
        kicks = [e for e in events if e.type == "pass"]
        outcome = Counter(e.attrs.get("outcome") for e in kicks)
        lost = Counter(e.type for e in events if e.type in CHANGES)
        changed = sum(e.type == "possession_change" for e in events)
        if changed != lost["interception"] + lost["tackle"]:
            raise ValueError(f"possession {k}: a possession change without interception or tackle")
        own = team_possessions(p)
        counts.update(
            passes=len(kicks),
            decided=sum((e.player, e.frame) in decided for e in kicks),
            completed=outcome["complete"],
            resolved=outcome["complete"] + outcome["intercepted"] + outcome["out"],
            unresolved=outcome[None],
            changes=sum(lost.values()),
            shots=sum(e.type == "shot" for e in events),
            goals=sum(e.type == "goal" for e in events),
            **lost,
        )
        if k > 0 and own and previous:
            if p.restart == "cut":
                counts["cuts"] += 1
                counts["cut_switches"] += previous[-1].team != own[0].team
            elif p.restart in OUT_RESTARTS and p.scenario not in SET_PIECES:
                # (a set-piece scenario declares its own restart: no `out` need precede it)
                out = next(e for e in live_events(match.possessions[k - 1].run) if e.type == "out")
                counts["out_restarts"] += 1
                counts["out_restarts_kept"] += own[0].team == out.team
        spells += own
        previous = own
        scenario["name"].append(p.scenario)
        scenario["length"].append(p.frames * match.dt)
        scenario["home_start"].append(bool(own) and own[0].team == 0)

    lengths = np.array([(s.end - s.start) * match.dt for s in spells])
    home = np.array([s.team == 0 for s in spells], dtype=bool)
    return {
        "match": {
            "duration": np.array([match.duration_s]),
            "possessions": np.array([float(len(match.possessions))]),
            "spells": np.array([float(len(spells))]),
            "spell_time": np.array([lengths.sum()]),
            "home_time": np.array([lengths[home].sum()]),
            **{c: np.array([float(counts[c])]) for c in MATCH_COLUMNS},
        },
        "scenarios": {k: np.asarray(v) for k, v in scenario.items()},
        "possessions": {
            "length": lengths,
            "passes": np.array([float(s.passes) for s in spells]),
            "ended": np.array([s.ended for s in spells], dtype=object),
        },
    }


def _measure_seed(seed: int) -> dict[str, dict[str, np.ndarray]]:
    return measure(build_match(seed))


# --- rows ------------------------------------------------------------------------------------


def evaluate(seeds: list[int]) -> list[Row]:
    with ProcessPoolExecutor() as ex:  # each match is independent; map keeps the seed order
        return rows_for(list(ex.map(_measure_seed, seeds)))


def rows_for(per_match: list[dict[str, dict[str, np.ndarray]]]) -> list[Row]:
    """The report's rows from what `measure` returns for each match."""
    pool = Pool(per_match)
    m, own, sc = pool.tables["match"], pool.tables["possessions"], pool.tables["scenarios"]
    n, ones = pool.n_seeds, np.ones(pool.n_seeds)
    rows: list[Row] = []

    def ratio(num: str, den: str, scale: float):
        def stat(w):
            d = np.sum(w * m[den])
            return float(np.sum(w * m[num]) / d) * scale if d > 0 else math.nan

        return stat

    def mean_of(col: str):
        return lambda w: _wmean(m[col], w)

    def target_row(metric, col, fmt, lo, hi, note, scale=1.0):
        value, sd = pool.pooled(mean_of(col)) * scale, _wsd(m[col], ones) * scale
        a, b = (v * scale for v in pool.interval(mean_of(col)))
        rows.append(
            Row(
                metric,
                f"{_num(value, fmt)} ± {_num(sd, fmt)} (n = {n} matches)",
                _span(a, b, fmt),
                f"{lo:g}–{hi:g}",
                f"{_span(lo, hi, fmt)} (design range of the spec)",
                SPEC_SOURCE,
                _verdict(value, lo, hi, n >= MIN_GROUP),
                note,
            )
        )

    def count_row(metric, col, note):
        stat = ratio(col, "duration", PER_90_S)
        value, (a, b) = pool.pooled(stat), pool.interval(stat)
        mean, sd = pool.pooled(mean_of(col)), _wsd(m[col], ones)
        rows.append(
            Row(
                metric,
                f"{_num(value, ',.0f')} ({_num(mean, '.1f')} ± {_num(sd, '.1f')} per match, "
                f"n = {n} matches)",
                _span(a, b, ",.0f"),
                note=note,
            )
        )

    def share_row(metric, num, den, what, note):
        stat = ratio(num, den, 100.0)
        value, (a, b) = pool.pooled(stat), pool.interval(stat)
        total = _num(float(np.sum(m[den])), ",.0f")
        rows.append(
            Row(
                metric,
                f"{_num(value, '.1f')}% (n = {total} {what})",
                f"{_span(a, b, '.1f')}%",
                note=note,
            )
        )

    def spell_row(metric, col, fmt, note=""):
        x = own[col]

        def stat(w):
            return _wmean(x, pool.weights("possessions", w))

        value, (a, b) = pool.pooled(stat), pool.interval(stat)
        sd = _wsd(x, np.ones(len(x)))
        rows.append(
            Row(
                metric,
                f"{_num(value, fmt)} ± {_num(sd, fmt)} (n = {len(x):,} team possessions)",
                _span(a, b, fmt),
                note=note,
            )
        )

    # The stitched match against SPEC 3.1.
    names = list(dict.fromkeys(sc["name"]))
    lengths = {s: sc["length"][sc["name"] == s] for s in names}
    caps = [s.max_s for s in DEFAULT_PLAN if s.scenario == "possession_play" and s.max_s]
    target_row(
        "Play per match (min)", "duration", ".2f", *SPEC_PLAY_MIN,
        "Length of the stitched clock: possession k starts on the frame after possession k − 1 "
        "ended, with no stoppages. Mean scenario possession: "
        + ", ".join(f"{s} {np.mean(v):.1f} s (n = {len(v)})" for s, v in lengths.items())
        + f"; possession_play runs until the ball goes out or the plan's cap ({min(caps):.0f}–"
        f"{max(caps):.0f} s, sim/match.py DEFAULT_PLAN).",
        scale=1.0 / 60.0,
    )  # fmt: skip
    plan = ", ".join(s.scenario if s.seed is None else f"{s.scenario} seed {s.seed}"
                     for s in DEFAULT_PLAN)  # fmt: skip
    target_row(
        "Scenario possessions per match", "possessions", ".1f", *SPEC_POSSESSIONS,
        f"The plan (sim/match.py DEFAULT_PLAN) has {len(DEFAULT_PLAN)}: {plan}.",
    )  # fmt: skip

    # Passes.
    total = int(np.sum(m["passes"]))
    count_row(
        "Passes attempted per 90 min", "passes",
        f"Pass events; shots are not passes. {int(np.sum(m['decided']))} of {total:,} were chosen "
        "by the decision model (SPEC 3.5), the rest scripted (Scenario.forced_pass): "
        "possession_play holds the ball 0.6–1.6 s and plays an open teammate 8–35 m away, so its "
        "script sets the pass rate.",
    )  # fmt: skip
    count_row(
        "Passes completed per 90 min", "completed",
        "Received by a teammate of the passer, the intended receiver or another.",
    )  # fmt: skip
    share_row(
        "Pass completion (%)", "completed", "resolved", "resolved passes",
        "Completed over resolved passes (completed, intercepted or out of play). "
        f"{int(np.sum(m['unresolved']))} passes were still rolling when their scenario possession "
        "was cut and are left out.",
    )  # fmt: skip

    # Possession changes.
    count_row(
        "Possession changes per 90 min", "changes",
        "Interceptions, tackles and balls out of play. A cut between scenario possessions is an "
        "edit, not a change, and is not counted.",
    )  # fmt: skip
    count_row(
        "Possession changes by interception per 90 min", "interception",
        "An opponent of the passer controls the ball in flight (engine `interception`). Every "
        "`possession_change` event is an interception or a tackle (checked).",
    )  # fmt: skip
    count_row(
        "Possession changes by tackle per 90 min", "tackle",
        "An opponent within the control radius of a carried ball wins it. Tackles are on in "
        "press_escape only (Scenario.tackles, SPEC 3.6).",
    )  # fmt: skip
    count_row(
        "Possession changes out of play per 90 min", "out",
        "The ball crosses a line (engine `out`); the last kicker's team loses it, as the laws give "
        "the throw-in, goal kick or corner to the other side. The stitch does not hand it over: "
        f"in {int(np.sum(m['out_restarts_kept']))} of the {int(np.sum(m['out_restarts']))} "
        "restarts after an out, the next scenario possession starts with the team that put the "
        "ball out.",
    )  # fmt: skip

    # Team possessions.
    count_row(
        "Team possessions per 90 min", "spells",
        "A team possession runs from the moment a team has the ball (the start of a scenario "
        "possession, or winning the ball) until it loses it or the scenario possession is cut; a "
        "free ball belongs to the team that last had it. A cut ends one even when the same team "
        "has the ball after it: the next scenario possession is a new passage of play.",
    )  # fmt: skip
    ended = Counter(own["ended"])
    spell_row(
        "Team possession length (s)", "length", ".1f",
        "How they ended: " + ", ".join(f"{k} {ended[k]}" for k in ENDINGS) + ". Those that "
        "end at a cut are cut short by the edit, so for them the length is a lower bound.",
    )  # fmt: skip
    spell_row(
        "Passes per team possession", "passes", ".2f",
        "Passes the team in possession played in it; a lower bound too where it ends at a cut.",
    )  # fmt: skip
    share_row(
        "Home team's share of possession time (%)", "home_time", "spell_time",
        "s of team possession",
        f"{int(np.sum(sc['home_start']))} of {len(sc['name'])} scenario possessions start with the "
        "home team: possession_play gives the ball to H4, H5 or H6, and the hero scenarios are "
        "built around a home player. So the away team has the ball only after winning it, and "
        f"at {int(np.sum(m['cut_switches']))} of the {int(np.sum(m['cuts']))} cuts the cut "
        "itself took the ball from the away team.",
    )  # fmt: skip

    # Shots.
    count_row(
        "Shots per 90 min", "shots",
        "Shot events (engine `shot`, an option of the decision model). The hero possessions keep "
        "their demo seeds, so they decide the same in every match, and neither they nor "
        "possession_play have the shot model on (`Scenario.shots`), so no shot is taken.",
    )  # fmt: skip
    goals = int(np.sum(m["goals"]))
    rows.append(
        Row(
            "Shot outcomes (goals, saves, misses)",
            PENDING,
            "—",
            note="The shot model (`sim/shots.py`, `Scenario.shots`, module A) is on main, but no "
            "scenario of the default plan turns it on, so no outcome is counted or invented. The "
            f"score counts goal events ({goals} here) and stays 0–0 without them (sim/match.py). "
            "SPEC 3.3's shot speed, roughly 80–130 km/h, is module A's as well and is not checked "
            "here.",
        )
    )
    return rows


# --- report ----------------------------------------------------------------------------------


def _seed_text(seeds: list[int]) -> str:
    contiguous = seeds == list(range(seeds[0], seeds[-1] + 1))
    span = f"{seeds[0]}–{seeds[-1]}" if contiguous else ", ".join(map(str, seeds))
    return f"match seeds {span} ({len(seeds)})"


def render(rows: list[Row], seeds: list[int]) -> str:
    counts = {v: sum(r.inside == v for r in rows) for v in VERDICTS}
    no_ref = sum(r.published == NO_REFERENCE for r in rows)
    outside = [r for r in rows if r.inside == OUTSIDE]
    lines = [
        "# Match statistics — passes, possession changes and shots per match (SPEC 3.1, 9)",
        "",
        f"`uv run python -m eval.match_stats`. The stitched match of sim/match.py (`build_match`) "
        f"on {_seed_text(seeds)}. Synthetic data only: a target below is a design range of SPEC "
        "3 or a number printed in a paper cited in docs/REFERENCES.md; no dataset was used.",
        "",
        f"**{counts[INSIDE]} inside, {counts[OUTSIDE]} outside, {counts[INCONCLUSIVE]} "
        f"inconclusive, {no_ref} with no published reference "
        f"({sum(r.sim == PENDING for r in rows)} of them {PENDING}).**",
        "",
    ]
    if outside:
        lines += ["Outside the target range:", ""]
        lines += [f"- {r.metric}: sim {r.sim}; target {r.published} ({r.source})." for r in outside]
        lines.append("")
    lines += [
        "| " + " | ".join(COLUMNS) + " |",
        "|" + "---|" * len(COLUMNS),
    ]
    for r in rows:
        cells = (r.metric, r.sim, r.seeds, r.published, r.range, r.source, r.inside)
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |")
    lines += [
        "",
        "## How to read it",
        "",
        "- **Sim (pooled)**: counts are per 90 min of play (SPEC 3.1), all matches pooled: the "
        "total count over the total stitched clock, times 90 min; then the mean ± SD per match. "
        "Other rows: mean ± SD of the observations (matches or team possessions), or a pooled "
        "share. **Sim, 90% over seeds**: the 5th–95th percentile of the pooled value over "
        f"{BOOTSTRAP} bootstrap resamples of the match seeds (whole matches resampled).",
        "- **90 min of play** is 90 min of the stitched clock. It has no stoppages: a cut skips "
        "the dead time between passages of play, so a per-90 figure here is per 90 min of the "
        "ball in play, not per 90 min of a match clock. No conversion is applied; no cited source "
        "gives one.",
        "- **Range checked**: SPEC 3.1's design range. **Inside** compares the pooled value; with "
        f"fewer than {MIN_GROUP} matches a row is inconclusive.",
        f"- Rows marked *{NO_REFERENCE}* have no target: SPEC 3 sets none and no paper cited in "
        "docs/REFERENCES.md is recorded there as printing one. They show the sim's distribution "
        "only. Nothing was filled in from memory or from datasets.",
        f"- *{PENDING}*: shot outcomes need a possession with the shot model on (`Scenario.shots`, "
        "module A); the default plan has none, so none is counted or invented.",
        "- Held-out seeds: the plan was built on match 1, the demo match (SPEC 3.1). Open-play "
        "possessions take seeds keyed off the match seed, from 1,000,000 up, so they are never "
        "design or eval seeds. The hero possessions keep their demo seeds ("
        + ", ".join(f"{s.scenario} {s.seed}" for s in DEFAULT_PLAN if s.seed is not None)
        + ") and are the same in every match: only the open play varies between matches.",
        "",
        "## Notes per row",
        "",
    ]
    lines += [f"- **{r.metric}** — {r.note}" for r in rows if r.note]
    lines += [
        "",
        "## Sources",
        "",
        '- **SPEC §3.1** — docs/SPEC.md: "A match is 15–25 scenario-driven possessions (§3.6) '
        "stitched together with restarts (kick-off, throw-in, goal kick, corner): 10–15 min of "
        'play in total, not 90 min of free play." and "Rates in the realism report are '
        'normalised per 90 min." Design targets of this project, not published values.',
        "",
        "docs/REFERENCES.md records what each cited paper prints. None is recorded as printing "
        "per-match counts of passes, pass completion, possession changes, possessions or shots: "
        "they are about scanning (Jordet et al. 2013, 2020; Aksum et al. 2021; Kokubu et al. "
        "2026), vision, pitch control, pressing and value models. Their full texts were not "
        "re-read for this report, so a per-match figure printed in one of them could have been "
        "missed; such a figure goes in only with its table or section.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seeds", default="100-119")
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    report = render(evaluate(seeds), seeds)
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "match_stats.md"
    path.write_text(report)
    print(report.split("\n## How to read it")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
