"""What an end-of-match recap may say (SPEC 6, recap): verified claims about a whole match.

A stitched match (SPEC 3.1) is possessions back to back, each its own run in local frames. The
recap needs both views:
- the match's totals (score, passes, scans, balls won back), checked on one run over the match
  clock (`stitched_run`) with `count_events` over the whole run;
- its key moments, each told by claims checked on its possession's own run: observed facts built
  here (`moment_claims`) for any moment, and for a hero moment its MomentContext's claims too.

`rank_moments` orders the candidates for the Director by an editorial rule, as a broadcaster
leads with the story of the match: a moment that scored first (`scored_moments`: its action is a
shot whose outcome is a goal, or it is tagged `goal`), then the hero moments (a match card's
`hero`: the moments the match is built around), then the rest. Within each group, by
counterfactual impact, the |Δ| of the selected lens in xT (SPEC 5.2); exact ties scan > space >
pressure, then match order. It is not a pure impact ranking. Live-only overlays (sprints) are
never key moments.

Nothing here calls a model, and nothing here is new verification logic: the claims are `Claim`s,
checked by the same `Verifier` as every breakdown.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from numbers import Integral
from typing import Any

import numpy as np

from explain import lexicon
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.functions import EvalContext, Inconclusive, Refuted
from sim.match import StitchedMatch, global_id
from sim.model import Event
from sim.run import MatchRun

LENS_ORDER = ("scan", "space", "pressure")  # exact ties in impact (SPEC 5.2)
FIRST_TAGS = ("goal",)  # moments that lead the ranking whatever their impact
SCAN_WINDOW_S = 2  # scans counted before a reception, as the hero claims count them
TEAM = {0: "Home", 1: "Away"}  # the fictional clubs, as the score bug names them
# A pass is counted once it is resolved: received, intercepted or out. One still in flight when
# its possession ends is not, as the live stats panel counts them (analytics/live_stats.py).
RESOLVED = ["complete", "intercepted", "out"]
TEAM_ZH = {0: "主队", 1: "客队"}


# --- one run over the match clock --------------------------------------------------------------


def lift_event(e: Event, start: int, dt: float) -> Event:
    """A possession's event on the match clock: its id, frame and frame-valued `end` moved by the
    possession's first frame (as `sim.export` lifts them for the web)."""
    attrs = dict(e.attrs)
    end = attrs.get("end")
    if isinstance(end, Integral) and not isinstance(end, bool):
        attrs["end"] = int(end) + start
    frame = e.frame + start
    return Event(global_id(e.id, start), e.type, frame, frame * dt, e.player, e.team, attrs)


def stitched_run(match: StitchedMatch) -> MatchRun:
    """Every possession's tracking and events on one clock: the run match totals are checked on.

    It has no hero and no decisions: those belong to each possession's own run."""
    runs = [p.run for p in match.possessions]

    def cat(name: str) -> np.ndarray:
        return np.concatenate([getattr(r, name) for r in runs])

    events = [
        lift_event(e, p.start, match.dt)
        for p in match.possessions
        for e in sorted(p.run.events, key=lambda e: (e.frame, e.id))
    ]
    return MatchRun(
        scenario="match", seed=match.seed, dt=match.dt, players=match.players, hero=None,
        pos=cat("pos"), vel=cat("vel"), body_yaw=cat("body_yaw"), head_yaw=cat("head_yaw"),
        head_yaw_observed=cat("head_yaw_observed"), ball_pos=cat("ball_pos"),
        ball_vel=cat("ball_vel"), owner=cat("owner"), events=events, decisions=[],
    )  # fmt: skip


def local_id(match_id: str, start: int) -> str:
    """An event or moment id on the match clock, back in its possession's frames."""
    return global_id(match_id, -start)


# --- ranking ---------------------------------------------------------------------------------


def impact(card: Mapping[str, Any]) -> float:
    """|Δ| of the card's selected lens in xT; 0 without one."""
    selected = card.get("selected_lens")
    lens = next((x for x in card.get("lenses", ()) if x.get("lens") == selected), None)
    delta = lens.get("delta_xt") if lens else None
    return abs(float(delta)) if delta is not None else 0.0


def scored_moments(cards: Iterable[Mapping[str, Any]], run: MatchRun) -> set[str]:
    """The moments (ids on the match clock) whose action is a shot that went in; `run` is the
    stitched run, where the cards' anchors are."""
    shots = {e.id for e in run.events if e.type == "shot" and e.attrs.get("outcome") == "goal"}
    return {c["id"] for c in cards if c.get("anchors", {}).get("action") in shots}


def rank_moments(
    cards: Iterable[Mapping[str, Any]], scored: Collection[str] = ()
) -> list[Mapping[str, Any]]:
    """Key-moment candidates, most important first (see the module docstring)."""

    def key(c: Mapping[str, Any]):
        goal = set(FIRST_TAGS) & set(c.get("tags", ())) or c["id"] in scored
        tier = 0 if goal else 1 if c.get("hero") else 2
        lens = c.get("selected_lens")
        order = LENS_ORDER.index(lens) if lens in LENS_ORDER else len(LENS_ORDER)
        return (tier, -round(impact(c), 9), order, c["anchor_frame"], c["id"])

    return sorted((c for c in cards if not c.get("live_only")), key=key)


# --- claims about the whole match -------------------------------------------------------------


def _count(type_: str, team: int, **where: Any) -> dict[str, Any]:
    args: dict[str, Any] = {"type": type_, "team": team}
    if where:
        args["where"] = where
    return fn("count_events", **args)


def _eq(lhs: Any, rhs: Any) -> Predicate:
    return Predicate(op="eq", lhs=lhs, rhs=rhs)


def match_claims(ctx: EvalContext) -> list[Claim]:
    """The match's totals, on the stitched run: the score always; per team its passes (completed
    of resolved), scans, balls won back and shots when it has any."""
    value = ctx.value
    home, away = (value(_count("goal", t)) for t in (0, 1))
    out = [
        Claim(
            id="final_score",
            template="Full time: Home {home}, Away {away}.",
            templates={"zh": "全场结束：主队{home}比{away}客队。"},
            slots={"home": Slot(value=home), "away": Slot(value=away)},
            predicate=Predicate(
                op="all",
                args=[_eq(_count("goal", 0), slot("home")), _eq(_count("goal", 1), slot("away"))],
            ),
        )  # fmt: skip
    ]
    for team, side in ((0, "home"), (1, "away")):
        name, zh = TEAM[team], TEAM_ZH[team]
        passes = value(_count("pass", team, outcome=RESOLVED))
        done = value(_count("pass", team, outcome="complete"))
        if passes:
            out.append(Claim(
                id=f"passes_{side}",
                template=f"{name} completed {{done}} of {{passes}} passes.",
                templates={"zh": f"{zh}{{passes}}次传球中完成了{{done}}次。"},
                slots={"done": Slot(value=done), "passes": Slot(value=passes)},
                predicate=Predicate(op="all", args=[
                    _eq(_count("pass", team, outcome="complete"), slot("done")),
                    _eq(_count("pass", team, outcome=RESOLVED), slot("passes")),
                ]),
            ))  # fmt: skip
        for kind, type_, en, cn in (
            ("scans", "scan", f"{name} players checked their shoulders {{n:times}}.",
             f"{zh}球员一共回头观察了{{n:times}}。"),
            ("won_back", "possession_change", f"{name} won the ball back {{n:times}}.",
             f"{zh}{{n:times}}夺回球权。"),
            ("shots", "shot", f"{name} had {{n|shot|shots}}.", f"{zh}一共射门{{n:times}}。"),
        ):  # fmt: skip
            n = value(_count(type_, team))
            if n:
                out.append(Claim(
                    id=f"{kind}_{side}", template=en, templates={"zh": cn},
                    slots={"n": Slot(value=n)}, predicate=_eq(_count(type_, team), slot("n")),
                ))  # fmt: skip
    return out


# --- claims about one moment, on its possession's run ------------------------------------------


def _event(ctx: EvalContext, event_id: str | None) -> Event | None:
    if event_id is None:
        return None
    try:
        return ctx.event(ctx.run, event_id)
    except (Inconclusive, Refuted):
        return None


def moment_claims(ctx: EvalContext, card: Mapping[str, Any], start: int) -> list[Claim]:
    """Observed facts about one moment of the match (card in match time, `ctx` on its possession's
    own run, which starts at match frame `start`). Ids are local: the caller namespaces them."""
    anchors = {k: local_id(v, start) for k, v in card.get("anchors", {}).items()}
    tags = set(card.get("tags", ())) | {card.get("kind")}
    action, reception = _event(ctx, anchors.get("action")), _event(ctx, anchors.get("reception"))
    out: list[Claim] = []

    def attempt(build) -> None:
        try:
            claim = build()
        except (Inconclusive, Refuted):
            return
        if claim is not None:
            out.append(claim)

    if action is not None and action.type == "pass":
        a = action.id
        passer, receiver = action.player, action.attrs.get("to")
        by = _eq(fn("event_attr", event=a, attr="player"), slot("passer"))
        to = _eq(fn("event_attr", event=a, attr="to"), slot("receiver"))
        people = {"passer": Slot(ref=passer), "receiver": Slot(ref=receiver)}

        def bypassed() -> Claim | None:
            n = ctx.value(fn("opponents_bypassed", event=a))
            if "line_breaking_pass" not in tags or not n:
                return None
            return Claim(
                id="bypassed",
                template="{passer}'s pass to {receiver} went past {n:words} opponents.",
                templates={"zh": "{passer}传给{receiver}的这脚球越过了{n:words}名对手。"},
                slots={**people, "n": Slot(value=n)},
                predicate=Predicate(op="all", args=[
                    by, to, _eq(fn("opponents_bypassed", event=a), slot("n")),
                ]),
                evidence=[a],
            )  # fmt: skip

        def pressed() -> Claim | None:
            if "pressed_decision" not in tags:
                return None
            pred = lexicon.under_heavy_pressure(slot("passer"), anchor=a)
            if not ctx.value(pred.lhs, {"passer": passer}) >= pred.rhs:
                return None
            return Claim(
                id="heavy_pressure",
                template="{passer} was under heavy pressure when he released the ball.",
                templates={"zh": "{passer}是在重压之下出球的。"},
                slots={"passer": Slot(ref=passer)},
                predicate=Predicate(op="all", args=[by, pred]),
                terms=["under heavy pressure"],
                evidence=[a],
            )  # fmt: skip

        def pass_to() -> Claim:
            return Claim(
                id="pass_to",
                template="{passer} played the ball to {receiver}.",
                templates={"zh": "{passer}把球传给了{receiver}。"},
                slots=people,
                predicate=Predicate(op="all", args=[by, to]),
                evidence=[a],
            )

        for build in (bypassed, pressed, pass_to):
            attempt(build)

    if reception is not None and "decision_after_scan" in tags:

        def scans() -> Claim | None:
            count = fn("scans_in_window", player=slot("player"), anchor=reception.id,
                       window_s=slot("window_s"))  # fmt: skip
            n = ctx.value(count, {"player": reception.player, "window_s": SCAN_WINDOW_S})
            if not n:
                return None
            return Claim(
                id="scans_before_reception",
                template="{player} scanned {n:times} in the {window_s} seconds before receiving.",
                templates={"zh": "接球前{window_s}秒内，{player}回头观察了{n:times}。"},
                slots={"player": Slot(ref=reception.player), "n": Slot(value=n),
                       "window_s": Slot(value=SCAN_WINDOW_S)},
                predicate=Predicate(op="all", args=[
                    _eq(fn("event_attr", event=reception.id, attr="player"), slot("player")),
                    _eq(count, slot("n")),
                ]),
                evidence=[reception.id],
            )  # fmt: skip

        attempt(scans)

    if action is not None and action.type == "shot" and action.attrs.get("outcome"):
        attempt(lambda: _shot_claim(ctx, action))
    return out


POST = {"near": ("near post", "近角"), "far": ("far post", "远角")}  # as explain/builders.py


def goal_templates(assist: bool, look: bool, post: str | None, keeper: bool) -> tuple[str, str]:
    """A goal's line in en and zh, with only the parts verified on the run: the pass that found
    the scorer (`assister`), his look before it reached him (`secs`), the post it went in at, and
    the keeper it beat. A part that is not there is left out, never guessed."""
    look_en = "looked up {secs|second|seconds} before the ball reached him"
    finish = ("scored" + (f" at the {POST[post][0]}" if post else "")
              + (" past {keeper}" if keeper else "") + ".")  # fmt: skip
    head = "{assister} found {shooter}, who " if assist else "{shooter} "
    en = head + (f"{look_en} and " if look else "") + finish
    parts = ["{assister}传球找到{shooter}"] if assist else []
    if look:
        parts.append("球到之前{secs}秒" + ("他" if assist else "{shooter}") + "抬头看了一眼")
    at = f"打{POST[post][1]}" if post else ""
    if parts:
        end = f"随后{at}破门" + ("，攻破了{keeper}把守的球门" if keeper else "")
    else:
        end = "{shooter}" + at + ("破门，攻破了{keeper}把守的球门" if keeper else "破门得分")
    return en, "，".join([*parts, end]) + "。"


def _goal_claim(
    ctx: EvalContext, shot: Event, checks: list[Predicate], evidence: list[str]
) -> Claim:
    """A goal as it was made (SPEC 6, recap): the pass that found the scorer, his look before it
    reached him, where it went in and past whom, each checked on the run like any claim. *Why:*
    the recap told the match's only goal as "N. Varnhall scored." (red team, 2026-10-22)."""
    a, shooter, run = shot.id, shot.player, ctx.run
    reception = max((e for e in run.events if e.type == "reception" and e.player == shooter
                     and e.frame <= shot.frame), key=lambda e: e.frame, default=None)  # fmt: skip
    assist = None if reception is None else next(
        (e for e in run.events if e.type == "pass" and e.team == shot.team
         and e.attrs.get("receiver") == shooter and e.attrs.get("end") == reception.frame),
        None,
    )  # fmt: skip
    slots = {"shooter": Slot(ref=shooter)}
    if assist is not None:
        slots["assister"] = Slot(ref=assist.player)
        checks += [
            _eq(fn("event_attr", event=assist.id, attr="player"), slot("assister")),
            _eq(fn("event_attr", event=assist.id, attr="receiver"), slot("shooter")),
            _eq(fn("event_attr", event=assist.id, attr="outcome"), "complete"),
            _eq(fn("event_attr", event=assist.id, attr="end"), reception.frame),
        ]
        evidence.append(assist.id)
    scan = None
    if reception is not None:
        window = round(SCAN_WINDOW_S / run.dt)
        scan = max((e for e in run.events if e.type == "scan" and e.player == shooter
                    and reception.frame - window <= e.frame <= reception.frame),
                   key=lambda e: e.frame, default=None)  # fmt: skip
    secs = None if scan is None else round(ctx.value(
        fn("seconds_between", a=scan.id, b=reception.id)), 1)  # fmt: skip
    if secs:  # a look that rounds to 0.0 s is not "before the ball reached him"
        lead = fn("seconds_between", a=slot("scan"), b=reception.id)
        slots |= {"scan": Slot(ref=scan.id), "secs": Slot(value=secs, decimals=1)}
        checks += [
            _eq(fn("event_attr", event=slot("scan"), attr="type"), "scan"),
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("shooter")),
            _eq(fn("event_attr", event=reception.id, attr="player"), slot("shooter")),
            Predicate(op="approx", lhs=lead, rhs=slot("secs"), abs_tol=0.05),
        ]
        evidence += [scan.id, reception.id]
    post = shot.attrs.get("placement") if shot.attrs.get("placement") in POST else None
    if post is not None:
        checks.append(_eq(fn("event_attr", event=a, attr="placement"), post))
    keeper = shot.attrs.get("keeper")
    if keeper is not None:
        slots["keeper"] = Slot(ref=keeper)
        checks.append(_eq(fn("event_attr", event=a, attr="keeper"), slot("keeper")))
    en, zh = goal_templates(assist is not None, bool(secs), post, keeper is not None)
    return Claim(id="goal", template=en, templates={"zh": zh}, slots=slots,
                 predicate=Predicate(op="all", args=checks), evidence=evidence)  # fmt: skip


def _shot_claim(ctx: EvalContext, shot: Event) -> Claim | None:
    """How the moment's shot ended: scored, saved, blocked or wide (SPEC 3.3)."""
    a = shot.id
    by = _eq(fn("event_attr", event=a, attr="player"), slot("shooter"))
    outcome = shot.attrs["outcome"]
    ended = _eq(fn("event_attr", event=a, attr="outcome"), outcome)
    slots = {"shooter": Slot(ref=shot.player)}
    after = [e for e in ctx.run.events if e.frame >= shot.frame]
    if outcome == "goal":
        goal = next((e for e in after if e.type == "goal" and e.player == shot.player), None)
        if goal is None:
            return None
        scored = _eq(fn("count_events", type="goal", player=slot("shooter"), anchor=goal.id), 1)
        return _goal_claim(ctx, shot, [by, ended, scored], [a, goal.id])
    if outcome == "saved":
        save = next((e for e in after if e.type == "save" and e.attrs.get("shot") == a), None)
        if save is None:
            return None
        return Claim(
            id="saved",
            template="{keeper} saved {shooter}'s shot.",
            templates={"zh": "门将{keeper}扑出了{shooter}的射门。"},
            slots={**slots, "keeper": Slot(ref=save.player), "save": Slot(ref=save.id)},
            predicate=Predicate(op="all", args=[
                by, ended,
                _eq(fn("event_attr", event=slot("save"), attr="player"), slot("keeper")),
                _eq(fn("event_attr", event=slot("save"), attr="shot"), a),
            ]),
            evidence=[a, save.id],
        )  # fmt: skip
    if outcome == "blocked":  # a player took the ball off the shot's path (sim.engine)
        end = shot.attrs.get("end")
        block = next((e for e in after if e.frame == end and e.player != shot.player
                      and e.type in ("interception", "reception")), None)  # fmt: skip
        if block is None:
            return None
        return Claim(
            id="blocked",
            template="{blocker} blocked {shooter}'s shot.",
            templates={"zh": "{blocker}挡出了{shooter}的射门。"},
            slots={**slots, "blocker": Slot(ref=block.player), "block": Slot(ref=block.id)},
            predicate=Predicate(op="all", args=[
                by, ended,
                _eq(fn("event_attr", event=slot("block"), attr="player"), slot("blocker")),
                _eq(fn("event_attr", event=slot("block"), attr="frame"),
                    fn("event_attr", event=a, attr="end")),
            ]),
            evidence=[a, block.id],
        )  # fmt: skip
    if outcome == "wide":
        return Claim(
            id="wide",
            template="{shooter}'s shot went wide.",
            templates={"zh": "{shooter}的射门偏出了。"},
            slots=slots,
            predicate=Predicate(op="all", args=[by, ended]),
            evidence=[a],
        )
    return None


def namespaced(claim: Claim, prefix: str) -> Claim:
    """The claim under the recap id `<prefix>.<id>`; verify it again: its fingerprint changed."""
    return claim.model_copy(update={"id": f"{prefix}.{claim.id}"})


def base_id(claim_id: str) -> str:
    """The claim kind behind a recap id (`k2.cf_pass` → `cf_pass`)."""
    return claim_id.rpartition(".")[2]
