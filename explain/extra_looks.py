"""The run with two more looks, told to a viewer (SPEC 5.3, 7): the opposite of the run without
the look (`explain.look_cost`). Which looks were added, what he did with them, and where his pass
went in expected threat.

The other run is `sim.counterfactual.two_more_looks`: the hero keeps every look of his own and
also looks to his left and to his right before the ball arrives. The claims are verified and
rendered like any other (`extra_looks_payload`); like the look-cost lines they are not in
`hero_claims`, so the crew's evidence and the breakdown cache keys stay as they are.
`sim.export.export_extra_looks` bundles the payloads with the web.

- `added_looks` (counterfactual): how many scans were added (two), the side each turned to and
  how long before the ball reached him.
- `extra_result` (counterfactual): whom he passed to with them, the same player or another.
- `extra_zones` (counterfactual): where each run's pass reached its receiver, as a band and lane
  of the pitch, and the expected threat (xT) there.
"""

from __future__ import annotations

from collections.abc import Mapping

from explain.builders import HeroRefs, _approx, _eq, _num
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.functions import EvalContext, Inconclusive, Refuted
from explain.look_cost import XT_DECIMALS, _pass_by, _refs
from explain.moments import hero_card
from explain.render import RenderPayload, ScriptLine, build_payload
from explain.verifier import Verifier
from sim.counterfactual import ExtraLooksResult


def added_looks(ctx: EvalContext, r: HeroRefs, cf: ExtraLooksResult) -> Claim | None:
    if len(cf.added) != 2:
        return None
    at = {"cf": cf.id}
    first, second = cf.added
    sides = [fn("scan_side", scan=slot(name), **at) for name in ("first", "second")]
    befores = [fn("seconds_between", a=slot(name), b=r.at_reception, **at)
               for name in ("first", "second")]  # fmt: skip
    n = fn("count_events", type="scan", player=slot("player"), where={"added": True}, **at)
    values = {"first": first, "second": second, "player": r.hero}

    def ev(operand):
        return ctx.value(operand, values)

    checks = []
    for name in ("first", "second"):
        checks += [
            _eq(fn("event_attr", event=slot(name), attr="type", **at), "scan"),
            _eq(fn("event_attr", event=slot(name), attr="player", **at), slot("player")),
            _eq(fn("event_attr", event=slot(name), attr="added", **at), True),
        ]
    return Claim(
        id="added_looks",
        template="Added: {n:words} more looks by {player}, to his {first_side:vocab} "
        "{first_before|second|seconds} before the ball reached him, and to his "
        "{second_side:vocab} {second_before|second|seconds} before.",
        templates={"zh": "多看的{n:words}眼：球到之前{first_before}秒，{player}先往"
                         "{first_side:vocab}边看了看；离球到还有{second_before}秒时，又往"
                         "{second_side:vocab}边看了看。"},
        slots={"player": Slot(ref=r.hero), "first": Slot(ref=first), "second": Slot(ref=second),
               "n": Slot(value=ev(n)),
               "first_side": Slot(value=ev(sides[0])), "second_side": Slot(value=ev(sides[1])),
               "first_before": _num(ev(befores[0]), 1),
               "second_before": _num(ev(befores[1]), 1)},
        predicate=Predicate(op="all", args=[
            *checks,
            _eq(n, slot("n")),
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            Predicate(op="gt", lhs=befores[0], rhs=befores[1]),  # the first came first
            _eq(sides[0], slot("first_side")), _eq(sides[1], slot("second_side")),
            _approx(befores[0], slot("first_before"), 1),
            _approx(befores[1], slot("second_before"), 1),
        ]),
        evidence=[r.reception.id],  # the added scans are in the other run only
    )  # fmt: skip


def extra_result(ctx: EvalContext, r: HeroRefs, cf: ExtraLooksResult) -> Claim | None:
    d = cf.counterfactual_decision
    if d is None or r.hero_pass is None or r.hero_pass.type != "pass":
        return None
    alt = _pass_by(cf.counterfactual, d.player, d.frame)
    if alt is None:
        return None
    at = {"cf": cf.id}
    passes = [
        _eq(fn("event_attr", event=r.at_action, attr="player"), slot("player")),
        _eq(fn("event_attr", event=r.at_action, attr="to"), slot("receiver")),
        _eq(fn("event_attr", event=alt.id, attr="player", **at), slot("player")),
        _eq(fn("event_attr", event=alt.id, attr="to", **at), slot("cf_receiver")),
    ]
    slots = {"player": Slot(ref=r.hero), "receiver": Slot(ref=r.hero_pass.attrs["to"]),
             "cf_receiver": Slot(ref=alt.attrs["to"])}  # fmt: skip
    if alt.attrs.get("to") == r.hero_pass.attrs.get("to"):
        return Claim(
            id="extra_result",
            template="With the added looks, {player} would still have passed to {receiver}.",
            templates={"zh": "就算多看了这几眼，{player}还是会把球传给{receiver}。"},
            slots=slots,
            predicate=Predicate(op="all", args=[
                *passes, _eq(slot("cf_receiver"), slot("receiver")),
            ]),
            evidence=[r.hero_pass.id],
        )  # fmt: skip
    return Claim(
        id="extra_result",
        template="With the added looks, {player} would have passed to {cf_receiver} "
        "instead of {receiver}.",
        templates={"zh": "多看了这几眼，{player}会把球传给{cf_receiver}，而不是{receiver}。"},
        slots=slots,
        predicate=Predicate(op="all", args=passes),
        evidence=[r.hero_pass.id],
    )  # fmt: skip


def extra_zones(ctx: EvalContext, r: HeroRefs, cf: ExtraLooksResult) -> Claim | None:
    d = cf.counterfactual_decision
    if d is None or r.hero_pass is None or r.hero_pass.type != "pass":
        return None
    alt = _pass_by(cf.counterfactual, d.player, d.frame)
    at = {"cf": cf.id}
    kept = fn("possession_result")
    kept_cf = fn("possession_result", **at)
    if alt is None or ctx.value(kept) != "kept" or ctx.value(kept_cf) != "kept":
        return None  # "reached" needs both passes completed
    xt, xt_cf = fn("possession_value"), fn("possession_value", **at)
    zone = {p: fn("action_end", part=p) for p in ("band", "lane")}
    zone_cf = {p: fn("action_end", part=p, **at) for p in ("band", "lane")}
    same = alt.attrs.get("to") == r.hero_pass.attrs.get("to")
    template = (
        "{player}'s pass reached {receiver} {band:vocab}, {lane:vocab}: xT {xt}. With the added "
        "looks it would have reached {cf_receiver} {cf_band:vocab}, {cf_lane:vocab}: xT {cf_xt}."
    )
    zh = ("{player}的传球在{band:vocab}{lane:vocab}找到了{receiver}，预期威胁{xt}。多看几眼的话，"
          "球会在{cf_band:vocab}{cf_lane:vocab}到{cf_receiver}脚下，预期威胁{cf_xt}。")  # fmt: skip
    if same:
        template = (
            "{player}'s pass reached {receiver} {band:vocab}, {lane:vocab}: xT {xt}. With the "
            "added looks it would have reached him {cf_band:vocab}, {cf_lane:vocab}: xT {cf_xt}."
        )
        zh = ("{player}的传球在{band:vocab}{lane:vocab}找到了{receiver}，预期威胁{xt}。多看几眼的"
              "话，球会在{cf_band:vocab}{cf_lane:vocab}到他脚下，预期威胁{cf_xt}。")  # fmt: skip
    return Claim(
        id="extra_zones",
        template=template,
        templates={"zh": zh},
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


EXTRA_LOOKS_BUILDERS = {
    "added_looks": added_looks,
    "extra_result": extra_result,
    "extra_zones": extra_zones,
}


def extra_looks_claims(ctx: EvalContext, cf: ExtraLooksResult) -> dict[str, Claim]:
    """The lines of the run with two more looks that can be measured, keyed by kind."""
    r = _refs(ctx)
    if r is None or cf.id not in ctx.counterfactuals:
        return {}
    out: dict[str, Claim] = {}
    for kind, build in EXTRA_LOOKS_BUILDERS.items():
        try:
            claim = build(ctx, r, cf)
        except (Inconclusive, Refuted):
            continue
        if claim is not None:
            out[kind] = claim
    return out


def extra_looks_payload(
    ctx: EvalContext,
    cf: ExtraLooksResult,
    language: str,
    names: Mapping[str, str] | None = None,
) -> RenderPayload:
    """One line per supported claim, in the claim's own words for `language` (SPEC 5.3)."""
    ctx.counterfactuals.setdefault(cf.id, cf)
    claims = extra_looks_claims(ctx, cf)
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
