"""One quantity, one number (SPEC 4.6, 5.3, 7).

A quantity that a verified claim states and that a chip, card or panel also shows has one
definition and one rounding rule, so a viewer never sees two numbers for one thing: the red-team
read found the live chip "PASS 39 m" over the claim "a 38-metre pass" for the same pass (the chip
measured the ball's travel, the claim the distance to where it was aimed).

For every hero moment the service serves (api/settings.py `DEFAULT_MATCHES`, their hero
possessions, and a stitched match's heroes on the match clock), each number the web shows next to
a claim reads exactly as the claim's rendered value whenever both exist. The web's formatting is
mirrored here as it is written in web/src (`toFixed`, which rounds the exact binary value with
ties away from zero); web/src/stats/stats.test.ts checks that the chips print the payload's
values without rounding them again.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import numpy as np
import pytest

from agents.context import MomentContext
from api.settings import DEFAULT_MATCHES, Settings
from api.store import Match, MatchStore
from explain.render import _digits

STANDALONE = sorted(
    {s for mid, s in MatchStore(Settings()).known.items() if s[0] != "match"}
)  # every served hero scenario, its own export
STITCHED = 1  # match-1: the same heroes on a stitched match's export and clock


def to_fixed(x: float, digits: int) -> str:
    """JavaScript's Number.prototype.toFixed: the exact binary value, ties away from zero."""
    return str(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def said(ctx: MomentContext, claim_id: str, slot: str) -> str | None:
    """A supported claim's slot as the line renders it; None when the claim is not there."""
    claim = ctx.supported.get(claim_id)
    if claim is None or slot not in claim.slots:
        return None
    s = claim.slots[slot]
    return _digits(s.value, s.decimals)


def _cue(m: Match, kind: str, player: str, kick: int) -> Any | None:
    return next((c for c in m.stats.cues
                 if c.kind == kind and c.player == player and c.kick == kick), None)  # fmt: skip


def _kick(ctx: MomentContext, claim_id: str, start: int) -> tuple[str, int] | None:
    """(kicker, match frame) of the kick a claim's evidence names."""
    claim = ctx.supported.get(claim_id)
    if claim is None:
        return None
    e = ctx.run.event(claim.evidence[0])
    return e.player, start + e.frame


# --- what the web shows -----------------------------------------------------------------------


def pass_chip(m: Match, ctx: MomentContext, start: int) -> str | None:
    """The PASS chip over the receiver (web/src/stats/stats.ts `statTags`), the pass log and
    "Last pass" (StatsPanel.tsx): `distance_m.toFixed(0)`."""
    kick = _kick(ctx, "pass_to_runner", start)
    cue = kick and _cue(m, "pass", *kick)
    return None if cue is None else to_fixed(cue.distance_m, 0)


def pass_log_speed(m: Match, ctx: MomentContext, start: int) -> str | None:
    """The pass log's ball speed (StatsPanel.tsx): `ball_kmh.toFixed(1)`."""
    kick = _kick(ctx, "pass_speed", start)
    cue = kick and _cue(m, "pass", *kick)
    return None if cue is None else to_fixed(cue.ball_kmh, 1)


def shot_chip(m: Match, ctx: MomentContext, start: int) -> str | None:
    """The SHOT chip and the shot log (stats.ts, StatsPanel.tsx): `speed_kmh.toFixed(1)`."""
    kick = _kick(ctx, "shot_speed", start)
    cue = kick and _cue(m, "shot", *kick)
    return None if cue is None else to_fixed(cue.speed_kmh, 1)


def _decision(m: Match) -> dict[str, Any] | None:
    return m.export["runs"]["factual"].get("decision") if m.scenario != "match" else None


def belief_numeral(m: Match, ctx: MomentContext, start: int) -> str | None:
    """The decision panel's numeral (Panels.tsx): `belief_error[runner].toFixed(1)`."""
    dec, runner = _decision(m), m.export.get("runner")
    if dec is None or runner is None:
        return None
    return to_fixed(dec["belief_error"][runner], 1)


def runner_p_success(m: Match, ctx: MomentContext, start: int) -> str | None:
    """ "P(pass to … arrives), as he sees it" (Panels.tsx): `p_success.toFixed(2)`."""
    dec, runner = _decision(m), m.export.get("runner")
    if dec is None or runner is None:
        return None
    option = next((o for o in dec["options"] if o["action"] == f"pass:{runner}"), None)
    return None if option is None else to_fixed(option["p_success"], 2)


def verdict_worth(m: Match, ctx: MomentContext, start: int) -> str | None:
    """The verdict's worth before the claim airs (Panels.tsx `VerdictPanel`): the export's
    `delta_xt`, or with none (a marker's look, a placed shot: null in the API's JSON) the scan
    lens's delta on the moment's card (web/src/api/client.ts `lensDelta`), at the claim's
    precision, `toFixed(2)`, unsigned as the claim states it."""
    if m.scenario == "match":
        return None
    value = m.export.get("delta_xt")
    if value is None or math.isnan(value):
        card = next(c for c in m.cards if c["id"] == ctx.card.id)
        lens = next((x for x in card["lenses"] if x["lens"] == "scan"), None)
        if lens is None or not lens["available"] or lens["delta_xt"] is None:
            return None
        value = lens["delta_xt"]
    return to_fixed(abs(value), 2)


def separation(run_name: str) -> Callable[[Match, MomentContext, int], str | None]:
    """A marker's verdict card (Panels.tsx, web/src/data/hero.ts `markerOf`): his distance to
    his man when the pass to that man resolved, from the export's mm positions as Float32."""

    def shown(m: Match, ctx: MomentContext, start: int) -> str | None:
        if m.scenario == "match" or m.export.get("runner") is None or _decision(m) is not None:
            return None
        run = m.export["runs"][run_name]
        ids = [p["id"] for p in m.export["players"]]
        man = m.export["runner"]
        pass_ = next((e for e in run["events"] if e["type"] == "pass"
                      and (e.get("attrs") or {}).get("to") == man), None)  # fmt: skip
        if pass_ is None or (pass_.get("attrs") or {}).get("end") is None:
            return None
        f = int(pass_["attrs"]["end"])
        pos = np.asarray(run["pos"], dtype=np.float64).reshape(-1, len(ids), 2)
        a = (pos[f, ids.index(m.export["hero"])] / 1000).astype(np.float32).astype(np.float64)
        b = (pos[f, ids.index(man)] / 1000).astype(np.float32).astype(np.float64)
        return to_fixed(math.hypot(*(a - b)), 1)

    return shown


# (claim id, slot) -> what shows the same quantity elsewhere on screen
PAIRS: dict[tuple[str, str], Callable[[Match, MomentContext, int], str | None]] = {
    ("pass_to_runner", "dist"): pass_chip,
    ("pass_speed", "kmh"): pass_log_speed,
    ("shot_speed", "kmh"): shot_chip,
    ("belief_error", "err"): belief_numeral,
    ("pass_success", "p_belief"): runner_p_success,
    ("cf_value", "dxt"): verdict_worth,
    ("stayed_with_runner", "gap"): separation("factual"),
    ("cf_lost_runner", "gap"): separation("counterfactual"),
}


def _compare(m: Match, ctx: MomentContext, start: int) -> tuple[list[str], int]:
    problems, compared = [], 0
    for (claim_id, slot), shown in PAIRS.items():
        claimed = said(ctx, claim_id, slot)
        other = shown(m, ctx, start)
        if claimed is None or other is None:
            continue
        compared += 1
        if claimed != other:
            problems.append(f"{m.id} {ctx.card.id} {claim_id}.{slot}: claim {claimed}, "
                            f"{shown.__name__} {other}")  # fmt: skip
    return problems, compared


@pytest.fixture(scope="module")
def standalone() -> list[Match]:
    return [Match.load(scenario, seed) for scenario, seed in STANDALONE]


@pytest.fixture(scope="module")
def stitched() -> Match:
    assert ("match", STITCHED) in DEFAULT_MATCHES
    return Match.load("match", STITCHED)


def test_every_hero_moment_shows_one_number_per_quantity(standalone):
    problems, compared = [], 0
    for m in standalone:
        found, n = _compare(m, m.ctx, 0)
        problems += found
        compared += n
    assert problems == []
    # Each pair is exercised on at least one served hero (a pair that never meets is dead code).
    assert compared >= len(PAIRS)


def test_a_stitched_matchs_chips_say_what_its_heroes_claims_say(stitched):
    problems, compared = [], 0
    for mid, ctx in stitched.contexts.items():
        found, n = _compare(stitched, ctx, stitched.where[mid]["start"])
        problems += found
        compared += n
    assert problems == [] and compared > 0


def test_the_recap_counts_passes_as_the_stats_panel_does(stitched):
    """ "Kestrel Bay completed 312 of 370 passes." and the team line "312/370 passes" at full
    time (StatsPanel.tsx `TeamLine`) are one count."""
    rc = stitched.recap()
    teams = {t.team: t for t in stitched.stats.snapshot().teams}
    for team, side in ((0, "home"), (1, "away")):
        claim = rc.all_claims.get(f"passes_{side}")
        if claim is None or rc.verdicts[claim.id].status != "supported":
            continue
        line = teams[team]
        assert (claim.slots["done"].value, claim.slots["passes"].value) == (
            line.completed,
            line.passes,
        ), side


def test_to_fixed_mirrors_javascript():
    assert to_fixed(38.5, 0) == "39" and to_fixed(0.25, 1) == "0.3"  # ties away from zero
    assert to_fixed(1.005, 2) == "1.00"  # 1.005 is 1.00499999999999989… in binary, as in JS
    assert to_fixed(-0.125, 2) == "-0.13" and to_fixed(76.0, 1) == "76.0"
