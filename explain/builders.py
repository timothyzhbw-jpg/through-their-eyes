"""Claim builders for a hero moment: ground-truth facts as ready-to-verify claims.

Each builder measures a fact with the same functions the verifier uses, then writes it as a
claim whose slots are bound into its predicate, with an English and a Chinese template. These are
the facts the Analyst can hand to the Narrator (SPEC 6), and the starting point of the
corruption eval (`eval/corruption.py`).

Numbers are rounded to the precision they are shown at, and `approx` tolerates exactly half a
display unit: "41 metres" claims 40.5–41.5 m. With the moment's card in the context, claims anchor
on `<card>.<anchor>` (SPEC 5.1); evidence always lists plain event ids, for the viewer to seek to.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from explain import lexicon
from explain.cards import MomentCard
from explain.claims import Claim, Predicate, Slot, event, fn, slot
from explain.functions import EvalContext, Inconclusive, Refuted
from sim.counterfactual import CounterfactualResult
from sim.model import Decision, Event
from sim.run import MatchRun
from sim.scenarios import SCENARIOS


@dataclass(frozen=True)
class HeroRefs:
    """The events that make up a scenario's hero moment."""

    run: MatchRun
    hero: str
    runner: str | None
    marker: str | None
    kick: Event  # the pass the hero receives
    reception: Event
    decision: Decision
    hero_pass: Event | None  # the pass or shot the hero chose, if any
    key_scan: Event
    card: MomentCard | None = None  # the hero's decision moment, when detected

    @classmethod
    def of(cls, run: MatchRun, card: MomentCard | None = None) -> HeroRefs:
        scenario = SCENARIOS[run.scenario]
        hero = run.hero
        reception = next(e for e in run.events if e.type == "reception" and e.player == hero)
        kick = max(
            (e for e in run.events
             if e.type == "pass" and e.attrs.get("to") == hero and e.frame <= reception.frame),
            key=lambda e: e.frame,
        )  # fmt: skip
        decision = run.hero_decision()
        hero_pass = next(
            (e for e in run.events if e.player == hero and e.frame == decision.frame
             and e.type in ("pass", "shot")),
            None,
        )  # fmt: skip
        return cls(
            run=run,
            hero=hero,
            runner=getattr(scenario, "runner", None),
            marker=getattr(scenario, "marker", None),
            kick=kick,
            reception=reception,
            decision=decision,
            hero_pass=hero_pass,
            key_scan=run.key_scan(),
            card=card,
        )

    def _anchor(self, name: str, e: Event) -> str:
        if self.card is not None and self.card.anchors.get(name) == e.id:
            return f"{self.card.id}.{name}"
        return e.id

    @property
    def at_reception(self) -> str:
        return self._anchor("reception", self.reception)

    @property
    def at_action(self) -> str:
        return self._anchor("action", self.hero_pass)


def _eq(lhs, rhs) -> Predicate:
    return Predicate(op="eq", lhs=lhs, rhs=rhs)


def _approx(lhs, rhs, decimals: int, scale: float = 1.0) -> Predicate:
    return Predicate(op="approx", lhs=lhs, rhs=rhs, abs_tol=0.5 * 10.0**-decimals * scale)


def _rounded(value: float, decimals: int) -> int | float:
    return round(value) if decimals == 0 else round(value, decimals)


def _num(value: float, decimals: int) -> Slot:
    return Slot(value=_rounded(value, decimals), decimals=decimals or None)


def scans_before_reception(ctx: EvalContext, r: HeroRefs, window_s: int = 2) -> Claim:
    count = fn("scans_in_window", player=slot("player"), anchor=r.at_reception,
               window_s=slot("window_s"))  # fmt: skip
    n = ctx.value(count, {"player": r.hero, "window_s": window_s})
    return Claim(
        id="scans_before_reception",
        template="{player} scanned {n:times} in the {window_s|second|seconds} before receiving.",
        templates={"zh": "接球前{window_s}秒内，{player}扫视了{n:times}。"},
        slots={"player": Slot(ref=r.hero), "n": Slot(value=n), "window_s": Slot(value=window_s)},
        predicate=_eq(count, slot("n")),
        evidence=_scans(r, window_s) or [r.reception.id],
    )


def time_since_last_scan(ctx: EvalContext, r: HeroRefs) -> Claim:
    since = fn("metric_at", metric="time_since_last_scan", player=slot("player"),
               anchor=r.at_reception)  # fmt: skip
    secs = ctx.value(since, {"player": r.hero})
    return Claim(
        id="time_since_last_scan",
        template="{player} had last checked his shoulder {secs|second|seconds} before the ball "
        "arrived.",
        templates={"zh": "球到脚下时，{player}距上次回头观察已过去{secs}秒。"},
        slots={"player": Slot(ref=r.hero), "secs": _num(secs, 1)},
        predicate=_approx(since, slot("secs"), 1),
        evidence=[_last_scan(r), r.reception.id],
    )


def key_scan_duration(ctx: EvalContext, r: HeroRefs) -> Claim:
    dur = fn("event_attr", event=slot("scan"), attr="duration_s")
    value = ctx.value(dur, {"scan": r.key_scan.id})
    return Claim(
        id="key_scan_duration",
        template="{player}'s look over his shoulder lasted {dur|second|seconds}.",
        templates={"zh": "{player}这一眼回头持续了{dur}秒。"},
        slots={"player": Slot(ref=r.hero), "scan": Slot(ref=r.key_scan.id), "dur": _num(value, 2)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _approx(dur, slot("dur"), 2),
        ]),
        evidence=[r.key_scan.id],
    )  # fmt: skip


def _scans(r: HeroRefs, window_s: float) -> list[str]:
    lo = r.reception.frame - round(window_s / r.run.dt)
    return [e.id for e in r.run.events if e.type == "scan" and e.player == r.hero
            and lo <= e.frame <= r.reception.frame]  # fmt: skip


def _last_scan(r: HeroRefs) -> str:
    scans = [e for e in r.run.events if e.type == "scan" and e.player == r.hero
             and e.frame <= r.reception.frame]  # fmt: skip
    return max(scans, key=lambda e: e.frame).id


def _pass_by(passer_slot: str, r: HeroRefs) -> Predicate:
    return _eq(fn("event_attr", event=r.at_action, attr="player"), slot(passer_slot))


def pass_to_runner(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.hero_pass.type != "pass":
        return None
    p = r.hero_pass
    dist = fn("event_attr", event=r.at_action, attr="distance")
    return Claim(
        id="pass_to_runner",
        template="{passer} found {receiver} with a {dist}-metre pass.",
        templates={"zh": "{passer}一脚{dist}米的传球找到了{receiver}。"},
        slots={"passer": Slot(ref=p.player), "receiver": Slot(ref=p.attrs["to"]),
               "dist": _num(ctx.value(dist), 0)},
        predicate=Predicate(op="all", args=[
            _pass_by("passer", r),
            _eq(fn("event_attr", event=r.at_action, attr="to"), slot("receiver")),
            _approx(dist, slot("dist"), 0),
        ]),
        evidence=[p.id],
    )  # fmt: skip


def pass_speed(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.hero_pass.type != "pass":
        return None
    speed = fn("event_attr", event=r.at_action, attr="speed")
    kmh = ctx.value(speed) * 3.6
    return Claim(
        id="pass_speed",
        template="{passer}'s pass left his foot at {kmh} km/h.",
        templates={"zh": "{passer}这脚传球的出球时速为{kmh}公里。"},
        slots={"passer": Slot(ref=r.hero_pass.player), "kmh": _num(kmh, 0)},
        predicate=Predicate(op="all", args=[
            _pass_by("passer", r),
            _approx(speed, slot("kmh", scale=1 / 3.6), 0, scale=1 / 3.6),
        ]),
        evidence=[r.hero_pass.id],
    )  # fmt: skip


def runner_unmarked(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.runner is None:
        return None
    claim = Claim(
        id="unmarked",
        template="{runner} was unmarked when {passer} released the ball.",
        templates={"zh": "{passer}出球时，{runner}无人盯防。"},
        slots={"runner": Slot(ref=r.runner), "passer": Slot(ref=r.hero_pass.player)},
        predicate=Predicate(op="all", args=[
            _pass_by("passer", r), lexicon.unmarked(slot("runner"), anchor=r.at_action),
        ]),
        terms=["unmarked"],
        evidence=[r.hero_pass.id],
    )  # fmt: skip
    gap = ctx.value(claim.predicate.args[1].lhs, {"runner": r.runner})
    return claim if gap > lexicon.TERMS["unmarked"].threshold else None


def gap_to_nearest_opponent(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.runner is None:
        return None
    gap = fn("metric_at", metric="nearest_opponent_distance", player=slot("runner"),
             anchor=r.at_action)  # fmt: skip
    return Claim(
        id="gap_to_nearest_opponent",
        template="{runner} had {gap|metre|metres} to the nearest opponent when the pass was "
        "played.",
        templates={"zh": "出球时，{runner}离最近的对手有{gap}米。"},
        slots={"runner": Slot(ref=r.runner), "gap": _num(ctx.value(gap, {"runner": r.runner}), 1)},
        predicate=_approx(gap, slot("gap"), 1),
        evidence=[r.hero_pass.id],
    )


def blind_side_run(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.runner is None:
        return None
    pred = lexicon.blind_side(slot("player"), slot("runner"), anchor=r.at_reception)
    if not ctx.value(pred.lhs, {"player": r.hero, "runner": r.runner}):
        return None
    return Claim(
        id="blind_side",
        template="{runner}'s run was on {player}'s blind side.",
        templates={"zh": "{runner}的跑位在{player}的盲区。"},
        slots={"runner": Slot(ref=r.runner), "player": Slot(ref=r.hero)},
        predicate=pred,
        terms=["blind side"],
        evidence=[_last_scan(r), r.reception.id],
    )


def scan_before_reception(ctx: EvalContext, r: HeroRefs) -> Claim:
    return Claim(
        id="scan_before_reception",
        template="{player} checked his shoulder before the ball reached him.",
        templates={"zh": "球到之前，{player}先回头看了一眼。"},
        slots={"player": Slot(ref=r.hero), "scan": Slot(ref=r.key_scan.id),
               "reception": Slot(ref=r.reception.id)},
        predicate=Predicate(op="all", args=[
            Predicate(op="before", lhs=event(slot("scan")), rhs=event(slot("reception"))),
            _eq(fn("event_attr", event=slot("scan"), attr="type"), "scan"),
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _eq(fn("event_attr", event=slot("reception"), attr="type"), "reception"),
            _eq(fn("event_attr", event=slot("reception"), attr="player"), slot("player")),
        ]),
        evidence=[r.key_scan.id, r.reception.id],
    )  # fmt: skip


def belief_error_at_pass(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.runner is None:
        return None
    err = fn("metric_at", metric="belief_error", observer=slot("player"), target=slot("runner"),
             anchor=r.at_action)  # fmt: skip
    value = ctx.value(err, {"player": r.hero, "runner": r.runner})
    return Claim(
        id="belief_error",
        template="When he played the pass, {player}'s picture of {runner} was off by "
        "{err|metre|metres}.",
        templates={"zh": "出球时，{player}对{runner}位置的判断只差{err}米。"},
        slots={"player": Slot(ref=r.hero), "runner": Slot(ref=r.runner), "err": _num(value, 1)},
        predicate=_approx(err, slot("err"), 1),
        evidence=[r.hero_pass.id],
    )


def _thought_vs_was(receiver: str, at: str, cf: str | None = None) -> tuple[dict, dict]:
    """P(success) of the hero's pass to `receiver`: on his belief, and on the true state."""
    extra = {} if cf is None else {"cf": cf}
    belief, truth = (
        fn("metric_at", metric="pass_success", player=slot("player"), receiver=slot("receiver"),
           state=state, anchor=at, **extra)
        for state in ("belief", "true")
    )  # fmt: skip
    return belief, truth


def pass_success(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """He thought vs it was (SPEC 5.1): the chosen pass, on his belief and on the truth."""
    if r.hero_pass is None or r.hero_pass.type != "pass":
        return None
    receiver = r.hero_pass.attrs["to"]
    belief, truth = _thought_vs_was(receiver, r.at_action)
    values = {"player": r.hero, "receiver": receiver}
    return Claim(
        id="pass_success",
        template="{player} thought the pass to {receiver} had a {p_belief} chance of arriving; "
        "it was {p_true}.",
        templates={"zh": "{player}以为传给{receiver}的球到达的概率是{p_belief}，实际是{p_true}。"},
        slots={"player": Slot(ref=r.hero), "receiver": Slot(ref=receiver),
               "p_belief": _num(ctx.value(belief, values), 2),
               "p_true": _num(ctx.value(truth, values), 2)},
        predicate=Predicate(op="all", args=[
            _approx(belief, slot("p_belief"), 2), _approx(truth, slot("p_true"), 2),
        ]),
        evidence=[r.hero_pass.id],
    )  # fmt: skip


def counterfactual_pass_success(
    ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult
) -> Claim | None:
    """The same he-thought-vs-it-was for the runner's option in the run without the look."""
    if r.runner is None or r.hero_pass is None:
        return None
    belief, truth = _thought_vs_was(r.runner, r.at_action, cf=cf.scan_id)
    values = {"player": r.hero, "receiver": r.runner}
    return Claim(
        id="cf_pass_success",
        template="Without that look, {player} thought the pass to {receiver} had a {p_belief} "
        "chance of arriving; it was {p_true}.",
        templates={"zh": "如果没有那一眼，{player}以为传给{receiver}的球到达的概率是{p_belief}，"
                         "实际是{p_true}。"},
        slots={"player": Slot(ref=r.hero), "receiver": Slot(ref=r.runner),
               "p_belief": _num(ctx.value(belief, values), 2),
               "p_true": _num(ctx.value(truth, values), 2)},
        predicate=Predicate(op="all", args=[
            _approx(belief, slot("p_belief"), 2), _approx(truth, slot("p_true"), 2),
        ]),
        evidence=[r.hero_pass.id],
    )  # fmt: skip


def counterfactual_pass(ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult) -> Claim | None:
    d = cf.counterfactual_decision
    if d is None or not d.chosen.startswith("pass:"):
        return None
    alt = next(
        e for e in cf.counterfactual.events
        if e.type == "pass" and e.player == d.player and e.frame == d.frame
    )  # fmt: skip
    return Claim(
        id="cf_pass",
        template="Without that look, {player} would have passed to {cf_receiver}.",
        templates={"zh": "如果没有那一眼，{player}会把球传给{cf_receiver}。"},
        slots={"player": Slot(ref=r.hero), "cf_receiver": Slot(ref=alt.attrs["to"])},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=alt.id, attr="player", cf=cf.scan_id), slot("player")),
            _eq(fn("event_attr", event=alt.id, attr="to", cf=cf.scan_id), slot("cf_receiver")),
        ]),
        evidence=[cf.scan_id],
    )  # fmt: skip


def counterfactual_value(ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult) -> Claim:
    delta = fn("cf_delta", of="possession_value", scan=cf.scan_id)
    return Claim(
        id="cf_value",
        template="That look was worth {dxt} in expected threat.",
        templates={"zh": "那一眼带来了{dxt}的预期威胁（xT）。"},
        slots={"dxt": _num(ctx.value(delta), 2)},
        predicate=_approx(delta, slot("dxt"), 2),
        evidence=[cf.scan_id],
    )


def observed_share(ctx: EvalContext, r: HeroRefs, window_s: int = 1) -> Claim:
    share = fn("observed_share", player=slot("player"), anchor=r.at_reception,
               window_s=slot("window_s"))  # fmt: skip
    value = 100.0 * ctx.value(share, {"player": r.hero, "window_s": window_s})
    return Claim(
        id="observed_share",
        template="In the {window_s|second|seconds} before receiving, {player} saw {share}% of the "
        "space the opponents controlled.",
        templates={"zh": "接球前{window_s}秒内，{player}看到了对手控制区域的{share}%。"},
        slots={"player": Slot(ref=r.hero), "window_s": Slot(value=window_s),
               "share": _num(value, 0)},
        predicate=_approx(share, slot("share", scale=0.01), 0, scale=0.01),
        evidence=[r.reception.id],
    )  # fmt: skip


def gap_to_marker(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.runner is None or r.marker is None:
        return None
    gap = fn("distance", a=slot("runner"), b=slot("marker"), anchor=r.at_action)
    value = ctx.value(gap, {"runner": r.runner, "marker": r.marker})
    return Claim(
        id="gap_to_marker",
        template="{runner} was {gap|metre|metres} clear of {marker} when the pass was played.",
        templates={"zh": "出球时，{runner}与{marker}相距{gap}米。"},
        slots={"runner": Slot(ref=r.runner), "marker": Slot(ref=r.marker), "gap": _num(value, 1)},
        predicate=_approx(gap, slot("gap"), 1),
        evidence=[r.hero_pass.id],
    )


def gap_opened(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.runner is None or r.marker is None:
        return None
    travel = -(r.reception.frame - r.kick.frame) * r.run.dt
    gain = fn("metric_delta", metric="distance", a=slot("runner"), b=slot("marker"),
              anchor=r.at_reception, from_=travel, to=0.0)  # fmt: skip
    value = ctx.value(gain, {"runner": r.runner, "marker": r.marker})
    return Claim(
        id="gap_opened",
        template="While the ball travelled to {player}, {runner} opened up {gain|metre|metres} "
        "on {marker}.",
        templates={"zh": "球传向{player}的途中，{runner}把与{marker}的距离拉开了{gain}米。"},
        slots={"player": Slot(ref=r.hero), "runner": Slot(ref=r.runner),
               "marker": Slot(ref=r.marker), "gain": _num(value, 1)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            _approx(gain, slot("gain"), 1),
        ]),
        evidence=[r.kick.id, r.reception.id],
    )  # fmt: skip


def runner_received(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None or r.hero_pass.attrs.get("receiver") is None:
        return None
    receiver = r.hero_pass.attrs["receiver"]
    reception = next(
        e for e in r.run.events
        if e.type == "reception" and e.player == receiver and e.frame == r.hero_pass.attrs["end"]
    )  # fmt: skip
    return Claim(
        id="runner_received",
        template="{runner} took the pass from {passer}.",
        templates={"zh": "{runner}接到了{passer}的传球。"},
        slots={"runner": Slot(ref=receiver), "passer": Slot(ref=r.hero_pass.player),
               "reception": Slot(ref=reception.id)},
        predicate=Predicate(op="all", args=[
            Predicate(op="exists", lhs=event(slot("reception"))),
            _eq(fn("event_attr", event=slot("reception"), attr="player"), slot("runner")),
            _eq(fn("event_attr", event=r.at_action, attr="receiver"), slot("runner")),
            _pass_by("passer", r),
        ]),
        evidence=[r.hero_pass.id, reception.id],
    )  # fmt: skip


def pressure_at_pass(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None:
        return None
    press = fn("metric_at", metric="pressing_intensity", player=slot("player"),
               anchor=r.at_action)  # fmt: skip
    value = 100.0 * ctx.value(press, {"player": r.hero})
    return Claim(
        id="pressure_at_pass",
        template="Pressing intensity on {player} was {pressure}% when he released the ball.",
        templates={"zh": "出球时，{player}承受的逼抢强度为{pressure}%。"},
        slots={"player": Slot(ref=r.hero), "pressure": _num(value, 0)},
        predicate=_approx(press, slot("pressure", scale=0.01), 0, scale=0.01),
        evidence=[r.hero_pass.id],
    )


Builder = Callable[..., Claim | None]

BUILDERS: dict[str, Builder] = {
    "scans_before_reception": scans_before_reception,
    "time_since_last_scan": time_since_last_scan,
    "key_scan_duration": key_scan_duration,
    "pass_to_runner": pass_to_runner,
    "pass_speed": pass_speed,
    "unmarked": runner_unmarked,
    "gap_to_nearest_opponent": gap_to_nearest_opponent,
    "blind_side": blind_side_run,
    "scan_before_reception": scan_before_reception,
    "belief_error": belief_error_at_pass,
    "gap_to_marker": gap_to_marker,
    "gap_opened": gap_opened,
    "runner_received": runner_received,
    "observed_share": observed_share,
    "pressure_at_pass": pressure_at_pass,
    "pass_success": pass_success,
}
CF_BUILDERS: dict[str, Builder] = {
    "cf_pass": counterfactual_pass,
    "cf_value": counterfactual_value,
    "cf_pass_success": counterfactual_pass_success,
}


def hero_claims(ctx: EvalContext, cf: CounterfactualResult | None = None) -> dict[str, Claim]:
    """Every hero-moment fact that can be measured in this run, keyed by kind."""
    card = next(
        (c for c in ctx.cards.values()
         if c.actor == ctx.run.hero and "decision_after_scan" in c.tags),
        None,
    )  # fmt: skip
    refs = HeroRefs.of(ctx.run, card)
    out: dict[str, Claim] = {}
    builders = [(k, b, ()) for k, b in BUILDERS.items()]
    if cf is not None:
        builders += [(k, b, (cf,)) for k, b in CF_BUILDERS.items()]
    for kind, build, extra in builders:
        try:
            claim = build(ctx, refs, *extra)
        except (Inconclusive, Refuted):
            continue  # not measurable in this run
        if claim is not None:
            out[kind] = claim
    return out
