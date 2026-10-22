"""The tactics cards' sentences (SPEC 4.8): one verified line per card, in English and Chinese.

The cards themselves are measurements (`analytics.tactics`, the "tracking" source chip). Each card
also says in one plain sentence what its numbers mean for a fan, and that sentence is a claim like
any narration line (SPEC 5.3): its slots are filled from the card a viewer sees, and the Verifier
checks them against the run with `tactics_stat`, which measures the cards again from the run's
tracking and events. A template writes every number; nothing here calls a model.

    uv run python -m explain.tactics --match 1
    uv run python -m explain.tactics --scenario press_escape --seed 0
    uv run python -m explain.tactics --fixture --web-fixture web/src/tactics/fixture.json
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from analytics.tactics import (
    DecisionRecord,
    Passage,
    TacticsCards,
    decision_records,
    match_passages,
    tactics_from_run,
)
from explain.audit import AuditSink
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.functions import EvalContext
from explain.render import RenderPayload, ScriptLine, build_payload
from explain.verifier import Verdict, Verifier
from sim.roster import club_name, short_name
from sim.run import MatchRun

LANGUAGES = ("en", "zh")
# The clubs by their fictional names (sim/roster.py), as the score bug and the recap name them.
TEAM = {t: club_name(t) for t in (0, 1)}
TEAM_ZH = {t: club_name(t, "zh") for t in (0, 1)}
WEB_FIXTURE = Path(__file__).resolve().parents[1] / "web/src/tactics/fixture.json"


class TacticsView(BaseModel):
    """GET /api/matches/<id>/tactics: the cards and their verified sentences per language."""

    cards: TacticsCards
    lines: dict[str, RenderPayload]


def _stat(stat: str, team: int | None = None) -> dict[str, Any]:
    return (
        fn("tactics_stat", stat=stat) if team is None else fn("tactics_stat", stat=stat, team=team)
    )


def _eq(lhs: Any, rhs: Any) -> Predicate:
    return Predicate(op="eq", lhs=lhs, rhs=rhs)


def _near(lhs: Any, rhs: Any, decimals: int) -> Predicate:
    """Equal at the precision the sentence shows: half a unit of its last decimal."""
    return Predicate(op="approx", lhs=lhs, rhs=rhs, abs_tol=0.5 * 10**-decimals)


def _round(value: float, decimals: int) -> float:
    """Half up, as a reader rounds (Python's round is half to even)."""
    return math.floor(value * 10**decimals + 0.5) / 10**decimals


def _pct(ratio: float) -> int:
    return int(_round(ratio * 100, 0))


def build_up_claim(cards: TacticsCards) -> Claim | None:
    """What the featured team gains or risks by building short under pressure, or None when it
    played no short pass under pressure in its own half."""
    team = cards.build_up.team
    t = cards.build_up.teams[team]
    if t.pressed_short.passes == 0 or t.pressed_short.completion is None:
        return None
    name, opp, zh, opp_zh = TEAM[team], TEAM[1 - team], TEAM_ZH[team], TEAM_ZH[1 - team]
    slots = {
        "n": Slot(value=t.pressed_short.passes),
        "done": Slot(value=t.pressed_short.completed),
        "pct": Slot(value=_pct(t.pressed_short.completion)),
    }
    checks = [
        _eq(_stat("build_up.pressed_short.passes", team), slot("n")),
        _eq(_stat("build_up.pressed_short.completed", team), slot("done")),
        _near(_stat("build_up.pressed_short.completion", team), slot("pct", 0.01), 2),
    ]
    en = f"Building short under pressure, {name} kept the ball on {{done}} of {{n|pass|passes}}"
    cn = f"{zh}在压力下短传出球{{n:times}}，保住球权{{done:times}}"
    base = t.unpressed_short.completion
    if base is not None and t.unpressed_short.passes:
        slots["base"] = Slot(value=_pct(base))
        checks.append(
            _near(_stat("build_up.unpressed_short.completion", team), slot("base", 0.01), 2)
        )
        en += " ({pct}%, against {base}% without pressure)"
        cn += "（{pct}%，无压力时为{base}%）"
    else:
        en += " ({pct}%)"
        cn += "（{pct}%）"
    if t.lost_pressed_short and t.lost_pressed_short_xt is not None:
        slots["xt"] = Slot(value=_round(t.lost_pressed_short_xt, 3), decimals=3)
        checks += [
            Predicate(op="gt", lhs=_stat("build_up.lost_pressed_short", team), rhs=0),
            _near(_stat("build_up.lost_pressed_short_xt", team), slot("xt"), 3),
        ]
        en += (
            f"; the passes it lost handed {opp} the ball where it was worth {{xt}} in expected"
            " threat, on average."
        )
        cn += f"；丢掉的球平均让{opp_zh}在丢球处拿到价值{{xt}}的预期威胁。"
    else:
        en += "."
        cn += "。"
    return Claim(
        id="tactics_build_up",
        template=en,
        templates={"zh": cn},
        slots=slots,
        predicate=Predicate(op="all", args=checks),
        evidence=t.pressed_short_ids,
    )


def set_piece_claim(cards: TacticsCards) -> Claim | None:
    """How much threat the best corner reached against open play, and the expected goals the
    corners led to; None without a played corner that reached a teammate."""
    sp = cards.set_pieces
    best = sp.best
    if best is None or best.peak_xt is None or best.peak_player is None or best.peak_s is None:
        return None
    slots = {
        "c": Slot(value=sp.corners),
        "player": Slot(ref=best.peak_player),
        "s": Slot(value=_round(best.peak_s, 1), decimals=1),
        "xt": Slot(value=_round(best.peak_xt, 2), decimals=2),
        "xg": Slot(value=_round(sp.xg_from_corners, 2), decimals=2),
    }
    checks = [
        _eq(_stat("set_pieces.corners"), slot("c")),
        _eq(_stat("set_pieces.best.peak_player"), slot("player")),
        _near(_stat("set_pieces.best.peak_s"), slot("s"), 1),
        _near(_stat("set_pieces.best.peak_xt"), slot("xt"), 2),
        _near(_stat("set_pieces.xg_from_corners"), slot("xg"), 2),
    ]
    en = (
        "From {c|corner|corners}, {player} got the ball {s} seconds after the kick at a spot"
        " worth {xt} in expected threat"
    )
    cn = "{c}个角球中，{player}在角球开出{s}秒后拿到球，那个位置的预期威胁是{xt}"
    if sp.open_play:
        slots["n"] = Slot(value=sp.open_play)
        checks.append(_eq(_stat("set_pieces.open_play"), slot("n")))
        if sp.below_best == sp.open_play:
            checks.append(_eq(_stat("set_pieces.below_best"), slot("n")))
            en += ", more than any of the {n} open-play passages ever reached"
            cn += "，超过了全部{n}段运动战进攻的最高威胁"
        else:
            slots["k"] = Slot(value=sp.below_best)
            checks.append(_eq(_stat("set_pieces.below_best"), slot("k")))
            en += ", more than {k} of the {n} open-play passages ever reached"
            cn += "，超过了{n}段运动战进攻中{k}段的最高威胁"
    if sp.shots_from_corners == 0:
        checks.append(_eq(_stat("set_pieces.shots_from_corners"), 0))
        en += "; no shot followed, so corners added {xg} expected goals."
        cn += "；之后没有射门，角球带来的预期进球为{xg}。"
    else:
        slots["shots"] = Slot(value=sp.shots_from_corners)
        checks.append(_eq(_stat("set_pieces.shots_from_corners"), slot("shots")))
        en += "; {shots|shot|shots} followed, worth {xg} expected goals."
        cn += "；之后射门{shots:times}，预期进球{xg}。"
    return Claim(
        id="tactics_set_pieces",
        template=en,
        templates={"zh": cn},
        slots=slots,
        predicate=Predicate(op="all", args=checks),
        evidence=[best.peak_pass] if best.peak_pass else [],
    )


def tactics_claims(cards: TacticsCards) -> list[Claim]:
    return [c for c in (build_up_claim(cards), set_piece_claim(cards)) if c is not None]


def tactics_view(
    run: MatchRun,
    match_id: str,
    passages: Sequence[Passage] | None = None,
    decisions: Sequence[DecisionRecord] = (),
    sink: AuditSink | None = None,
    names: Mapping[str, str] | None = None,
) -> TacticsView:
    """The cards of `run` (one scenario's run, or a stitched match with its `passages`) and their
    sentences, each verified on the run before it is rendered. Players go by their fictional
    names (`names`, by default the roster's), never by id."""
    if names is None:
        names = {pid: short_name(pid) for pid in run.ids}
    cards = tactics_from_run(run, match_id, passages, decisions)
    ctx = EvalContext(run, resimulate=False, passages=tuple(passages or ()))
    claims = {c.id: c for c in tactics_claims(cards)}
    verifier = Verifier(ctx, sink=sink)
    verdicts: dict[str, Verdict] = {cid: verifier.verify(c) for cid, c in claims.items()}
    lines = [
        ScriptLine(id=cid.removeprefix("tactics_"), text=c.template, claims=[cid])
        for cid, c in claims.items()
        if verdicts[cid].supported
    ]
    payloads = {}
    for lang in LANGUAGES:
        localized = [
            line.model_copy(update={"text": claims[line.claims[0]].template_for(lang)})
            for line in lines
        ]
        built = build_payload(
            f"tactics:{match_id}", "analyst", lang, localized, claims, verdicts, names
        )
        payloads[lang] = built.payload
    return TacticsView(cards=cards, lines=payloads)


def view_for_match(match: Any, match_id: str, sink: AuditSink | None = None) -> TacticsView:
    """A stitched match (`sim.match.StitchedMatch`): its decisions are its possessions' own."""
    from explain.recap import stitched_run

    decisions = [d for p in match.possessions for d in decision_records(p.run.decisions, p.start)]
    return tactics_view(stitched_run(match), match_id, match_passages(match), decisions, sink)


def view_for_run(run: MatchRun, match_id: str, sink: AuditSink | None = None) -> TacticsView:
    return tactics_view(run, match_id, None, decision_records(run.decisions), sink)


# A short stitched match for the web tests: the pressure hero, open play and the corner hero.
def fixture_view() -> TacticsView:
    from sim.match import PossessionSpec, build_match

    plan = (
        PossessionSpec("possession_play", max_s=20.0),
        PossessionSpec("press_escape", 0),
        PossessionSpec("possession_play", max_s=20.0),
        PossessionSpec("corner_blind_side", 0),
    )
    return view_for_match(build_match(1, plan), "fixture")


def web_fixture(view: TacticsView) -> str:
    return json.dumps(view.model_dump(mode="json"), indent=1) + "\n"


def _print(view: TacticsView) -> None:
    cards = view.cards
    for t in cards.build_up.teams:
        print(f"{TEAM[t.team]}: build-up {t.all.completed}/{t.all.passes}, under pressure "
              f"{t.pressed.completed}/{t.pressed.passes}, short {t.short.completed}/"
              f"{t.short.passes} xT {t.short.xt}, long {t.long.completed}/{t.long.passes} xT "
              f"{t.long.xt}, line-breaking {t.line_breaking}, lost {t.lost}")  # fmt: skip
    for a in cards.build_up.alternatives:
        short = a.best_short.action if a.best_short else None
        long = a.best_long.action if a.best_long else None
        print(f"  {a.t:.1f} s {a.player} chose {a.chosen.action} ({a.chosen.value:+.4f}); "
              f"best short {short}, best long {long}")  # fmt: skip
    sp = cards.set_pieces
    peak = sp.best.peak_xt if sp.best else None
    print(f"corners {sp.corners}/{sp.awarded}, shots from corners {sp.shots_from_corners}, "
          f"xG {sp.xg_from_corners}, match shots {sp.shots}, best corner {peak}, "
          f"open-play median peak {sp.open_play_peak_median}")  # fmt: skip
    for lang, payload in view.lines.items():
        for line in payload.lines:
            print(f"[{lang}] {line.text}")


def main() -> None:
    parser = argparse.ArgumentParser(description="The tactics cards and their sentences (SPEC 4.8)")
    parser.add_argument("--match", type=int, default=None, help="stitched-match seed")
    parser.add_argument("--scenario", default=None)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--fixture", action="store_true", help="the web tests' short match")
    parser.add_argument("--web-fixture", default=None, help="write the view as JSON here")
    args = parser.parse_args()
    if args.fixture:
        view = fixture_view()
    elif args.match is not None:
        from sim.match import build_match

        view = view_for_match(build_match(args.match), f"match-{args.match}")
    elif args.scenario:
        from sim.engine import Simulation

        run = Simulation.from_scenario(args.scenario, args.seed).run()
        view = view_for_run(run, f"{args.scenario}-{args.seed}")
    else:
        parser.error("pass --match SEED, --scenario NAME --seed N, or --fixture")
    if args.web_fixture:
        path = Path(args.web_fixture)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(web_fixture(view))
    _print(view)


if __name__ == "__main__":
    main()
