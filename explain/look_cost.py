"""The run without the look, told to a viewer (SPEC 5.3, 7): which look was removed, what losing
it cost, and where his pass went in expected threat.

Teammates who play football watched "Without the look" (2026-10-21) and could not tell which look
had been taken away, what it had cost him, or what "xT 0.13" meant. These claims answer that in
three lines. They are verified and rendered like any other (`look_cost_payload`), but they are
not in `hero_claims`: the crew's evidence, its prompts and the breakdown cache keys stay as they
are. `sim.export.export_without_look` bundles the payloads with the web.

- `removed_look` (observed): the dropped scan, which shoulder, and how long before the ball
  reached him.
- `look_cost` (counterfactual): what he did without it. A pass that went back instead of forward
  says so; a lost ball says who won it (a tackle) or that it was lost.
- `pass_zones` (counterfactual): where each run's pass reached its receiver, as a band and lane
  of the pitch, and the expected threat (xT) there: the two values the verdict's worth subtracts.
"""

from __future__ import annotations

from collections.abc import Mapping

from explain.builders import HeroRefs, _approx, _eq, _num
from explain.claims import Claim, Predicate, Slot, event, fn, slot
from explain.functions import EvalContext, Inconclusive, Refuted
from explain.moments import hero_card
from explain.render import RenderPayload, ScriptLine, build_payload
from explain.verifier import Verifier
from sim.counterfactual import CounterfactualResult, WhatIfResult

XT_DECIMALS = 3  # 0.133 and 0.002: two decimals would show the run without the look as 0.00


def _refs(ctx: EvalContext) -> HeroRefs | None:
    """The hero moment's events, for a hero with a decision on the ball; else None."""
    decision = ctx.run.hero_decision()
    if decision is None:
        return None
    card = next(
        (c for c in ctx.cards.values()
         if not c.live_only and (c.actor, c.anchor_frame) == (decision.player, decision.frame)),
        None,
    )  # fmt: skip
    return HeroRefs.of(ctx.run, card)


def _without_look(cf: object) -> bool:
    return isinstance(cf, CounterfactualResult) and cf.scan_id.startswith("scan:")


def removed_look(ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult) -> Claim | None:
    side = fn("scan_side", scan=slot("scan"))
    before = fn("seconds_between", a=slot("scan"), b=r.at_reception)
    values = {"scan": cf.scan_id}
    return Claim(
        id="removed_look",
        template="Removed: {player}'s look over his {side:vocab} shoulder, "
        "{before|second|seconds} before the ball reached him.",
        templates={"zh": "拿掉的，是球到之前{before}秒、{player}扭头看向{side:vocab}后方的"
                         "那一眼。"},
        slots={"player": Slot(ref=r.hero), "scan": Slot(ref=cf.scan_id),
               "side": Slot(value=ctx.value(side, values)),
               "before": _num(ctx.value(before, values), 1)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=slot("scan"), attr="type"), "scan"),
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            Predicate(op="before", lhs=event(slot("scan")), rhs=event(r.at_reception)),
            _eq(side, slot("side")),
            _approx(before, slot("before"), 1),
        ]),
        evidence=[cf.scan_id],
    )  # fmt: skip


def _pass_by(run, player: str, frame: int):
    return next(
        (e for e in run.events if e.type == "pass" and e.player == player and e.frame == frame),
        None,
    )


def look_cost(ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult) -> Claim | None:
    d = cf.counterfactual_decision
    if d is None or r.hero_pass is None:
        return None
    at = {"cf": cf.scan_id}
    result = fn("possession_result", **at)
    if ctx.value(result) == "lost":
        tackle = next(
            (e for e in cf.counterfactual.events
             if e.type == "tackle" and e.frame > d.frame and e.attrs.get("won_from") == d.player),
            None,
        )  # fmt: skip
        if tackle is None:
            return Claim(
                id="look_cost",
                template="Without that look, {player} would have lost the ball.",
                templates={"zh": "如果没有那一眼，{player}会丢掉球权。"},
                slots={"player": Slot(ref=r.hero)},
                predicate=Predicate(op="all", args=[
                    _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
                    _eq(result, "lost"),
                ]),
                evidence=[cf.scan_id],
            )  # fmt: skip
        won = {"event": tackle.id, **at}
        return Claim(
            id="look_cost",
            template="Without that look, {tackler} would have won the ball off {player}.",
            templates={"zh": "如果没有那一眼，{tackler}会从{player}脚下把球抢走。"},
            slots={"player": Slot(ref=r.hero), "tackler": Slot(ref=tackle.player)},
            predicate=Predicate(op="all", args=[
                _eq(result, "lost"),
                _eq(fn("event_attr", attr="type", **won), "tackle"),
                _eq(fn("event_attr", attr="player", **won), slot("tackler")),
                _eq(fn("event_attr", attr="won_from", **won), slot("player")),
            ]),
            evidence=[cf.scan_id],
        )  # fmt: skip
    alt = _pass_by(cf.counterfactual, d.player, d.frame)
    if alt is None or ctx.value(result) != "kept":
        return None
    went_cf = fn("action_end", part="direction", **at)
    went = fn("action_end", part="direction")
    passes = [
        _eq(fn("event_attr", event=r.at_action, attr="player"), slot("player")),
        _eq(fn("event_attr", event=r.at_action, attr="to"), slot("receiver")),
        _eq(fn("event_attr", event=alt.id, attr="player", **at), slot("player")),
        _eq(fn("event_attr", event=alt.id, attr="to", **at), slot("cf_receiver")),
        _eq(result, "kept"),
    ]
    slots = {"player": Slot(ref=r.hero), "receiver": Slot(ref=r.hero_pass.attrs["to"]),
             "cf_receiver": Slot(ref=alt.attrs["to"])}  # fmt: skip
    if ctx.value(went_cf) == "back" and ctx.value(went) == "forward":
        return Claim(
            id="look_cost",
            template="Without that look, {player} would have played it back to {cf_receiver} "
            "instead of forward to {receiver}.",
            templates={"zh": "如果没有那一眼，{player}会把球回传给{cf_receiver}，"
                             "而不是向前传给{receiver}。"},
            slots=slots,
            predicate=Predicate(op="all", args=[
                *passes, _eq(went_cf, "back"), _eq(went, "forward"),
            ]),
            evidence=[cf.scan_id],
        )  # fmt: skip
    if alt.attrs.get("to") == r.hero_pass.attrs.get("to"):
        return None  # the same pass: the look cost nothing a line can name
    return Claim(
        id="look_cost",
        template="Without that look, {player} would have passed to {cf_receiver} "
        "instead of {receiver}.",
        templates={"zh": "如果没有那一眼，{player}会传给{cf_receiver}，而不是{receiver}。"},
        slots=slots,
        predicate=Predicate(op="all", args=passes),
        evidence=[cf.scan_id],
    )  # fmt: skip


def pass_zones(ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult) -> Claim | None:
    d = cf.counterfactual_decision
    if d is None or r.hero_pass is None or r.hero_pass.type != "pass":
        return None
    alt = _pass_by(cf.counterfactual, d.player, d.frame)
    at = {"cf": cf.scan_id}
    kept = fn("possession_result")
    kept_cf = fn("possession_result", **at)
    if alt is None or ctx.value(kept) != "kept" or ctx.value(kept_cf) != "kept":
        return None  # "reached" needs both passes completed
    xt, xt_cf = fn("possession_value"), fn("possession_value", **at)
    zone = {p: fn("action_end", part=p) for p in ("band", "lane")}
    zone_cf = {p: fn("action_end", part=p, **at) for p in ("band", "lane")}
    return Claim(
        id="pass_zones",
        template="{player}'s pass reached {receiver} {band:vocab}, {lane:vocab}: xT {xt}. "
        "Without that look it would have reached {cf_receiver} {cf_band:vocab}, "
        "{cf_lane:vocab}: xT {cf_xt}.",
        templates={"zh": "{player}的传球在{band:vocab}{lane:vocab}找到了{receiver}，"
                         "预期威胁（xT）{xt}。如果没有那一眼，球会在{cf_band:vocab}{cf_lane:vocab}"
                         "到{cf_receiver}脚下，预期威胁（xT）{cf_xt}。"},
        slots={"player": Slot(ref=r.hero), "receiver": Slot(ref=r.hero_pass.attrs["to"]),
               "cf_receiver": Slot(ref=alt.attrs["to"]),
               "band": Slot(value=ctx.value(zone["band"])),
               "lane": Slot(value=ctx.value(zone["lane"])),
               "cf_band": Slot(value=ctx.value(zone_cf["band"])),
               "cf_lane": Slot(value=ctx.value(zone_cf["lane"])),
               "xt": _num(ctx.value(xt), XT_DECIMALS),
               "cf_xt": _num(ctx.value(xt_cf), XT_DECIMALS)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=r.at_action, attr="player"), slot("player")),
            _eq(fn("event_attr", event=r.at_action, attr="to"), slot("receiver")),
            _eq(fn("event_attr", event=alt.id, attr="to", **at), slot("cf_receiver")),
            _eq(kept, "kept"), _eq(kept_cf, "kept"),
            _eq(zone["band"], slot("band")), _eq(zone["lane"], slot("lane")),
            _eq(zone_cf["band"], slot("cf_band")), _eq(zone_cf["lane"], slot("cf_lane")),
            _approx(xt, slot("xt"), XT_DECIMALS), _approx(xt_cf, slot("cf_xt"), XT_DECIMALS),
        ]),
        evidence=[r.hero_pass.id],
    )  # fmt: skip


LOOK_COST_BUILDERS = {
    "removed_look": removed_look,
    "look_cost": look_cost,
    "pass_zones": pass_zones,
}


def look_cost_claims(
    ctx: EvalContext, cf: CounterfactualResult | WhatIfResult | None
) -> dict[str, Claim]:
    """The lines of the run without the look that can be measured, keyed by kind; none for a
    run whose other run is not a look removed (a forced option, a keeper's step)."""
    if not _without_look(cf):
        return {}
    r = _refs(ctx)
    if r is None or r.key_scan is None or r.key_scan.id != cf.scan_id:
        return {}
    out: dict[str, Claim] = {}
    for kind, build in LOOK_COST_BUILDERS.items():
        try:
            claim = build(ctx, r, cf)
        except (Inconclusive, Refuted):
            continue
        if claim is not None:
            out[kind] = claim
    return out


def look_cost_payload(
    ctx: EvalContext,
    cf: CounterfactualResult,
    language: str,
    names: Mapping[str, str] | None = None,
) -> RenderPayload:
    """One line per supported claim, in the claim's own words for `language` (SPEC 5.3)."""
    claims = look_cost_claims(ctx, cf)
    verdicts = Verifier(ctx).verify_all(claims.values())
    card = hero_card(ctx.run, ctx.cards)
    if card is None:
        raise Inconclusive("the hero moment was not detected")
    lines = [
        ScriptLine(id=c.id, text=c.template_for(language), claims=[c.id])
        for c in claims.values()
        if verdicts[c.id].status == "supported"
    ]
    build = build_payload(card.id, "casual", language, lines, claims, verdicts, names)
    return build.payload
