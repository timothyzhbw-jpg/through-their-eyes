"""Claim builders for a hero moment: ground-truth facts as ready-to-verify claims.

Each builder measures a fact with the same functions the verifier uses, then writes it as a
claim whose slots are bound into its predicate, with an English and a Chinese template. These are
the facts the Analyst can hand to the Narrator (SPEC 6), and the starting point of the
corruption eval (`eval/corruption.py`).

A hero with no decision on the ball (a marker, `marker_scan` moment) has his own builders
(`MARKER_BUILDERS`): his look, whether he stayed with his man, and the run without the look.

Numbers are rounded to the precision they are shown at, by the one rule every number on screen
follows (`analytics.stats.display`: ties away from zero, as the web's `toFixed`), and `approx`
tolerates exactly half a display unit: "41 metres" claims 40.5–41.5 m. A quantity a chip also
shows is measured as the chip measures it (a pass's length and speed and a shot's speed on the
tracked ball, `event_attr`), so the two read the same (SPEC 4.6, 5.3). With the moment's card in
the context, claims anchor on `<card>.<anchor>` (SPEC 5.1); evidence always lists plain event
ids, for the viewer to seek to.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from analytics.stats import display
from explain import lexicon
from explain.cards import MomentCard
from explain.claims import Claim, Predicate, Slot, event, fn, slot
from explain.functions import EvalContext, Inconclusive, Refuted
from explain.moments import hero_card
from sim.config import SimParams
from sim.counterfactual import CounterfactualResult, WhatIfResult
from sim.model import Decision, Event
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

SEEN = SimParams().perception_threshold  # visibility from which the sim counts a player as seen


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
    key_scan: Event | None  # the scripted key scan of a scan hero; None for other heroes
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
            key_scan=next((e for e in run.events if e.type == "scan" and e.attrs.get("key")), None),
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

    @property
    def completion(self) -> Event | None:
        """The reception that completed the hero's pass, if it was completed."""
        if self.hero_pass is None or self.hero_pass.attrs.get("outcome") != "complete":
            return None
        end, receiver = self.hero_pass.attrs["end"], self.hero_pass.attrs["receiver"]
        return next(
            (e for e in self.run.events
             if e.type == "reception" and e.player == receiver and e.frame == end),
            None,
        )  # fmt: skip


def _eq(lhs, rhs) -> Predicate:
    return Predicate(op="eq", lhs=lhs, rhs=rhs)


def _approx(lhs, rhs, decimals: int, scale: float = 1.0) -> Predicate:
    return Predicate(op="approx", lhs=lhs, rhs=rhs, abs_tol=0.5 * 10.0**-decimals * scale)


def _rounded(value: float, decimals: int) -> int | float:
    shown = display(value, decimals)
    return int(shown) if decimals == 0 else shown


def _num(value: float, decimals: int) -> Slot:
    return Slot(value=_rounded(value, decimals), decimals=decimals or None)


def scans_before_reception(ctx: EvalContext, r: HeroRefs, window_s: int = 2) -> Claim:
    count = fn("scans_in_window", player=slot("player"), anchor=r.at_reception,
               window_s=slot("window_s"))  # fmt: skip
    n = ctx.value(count, {"player": r.hero, "window_s": window_s})
    return Claim(
        id="scans_before_reception",
        template="{player} scanned {n:times} in the {window_s|second|seconds} before receiving.",
        templates={"zh": "接球前{window_s}秒内，{player}回头观察了{n:times}。"},
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


def key_scan_duration(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.key_scan is None:
        return None
    dur = fn("event_attr", event=slot("scan"), attr="duration_s")
    value = ctx.value(dur, {"scan": r.key_scan.id})
    return Claim(
        id="key_scan_duration",
        template="{player}'s look over his shoulder lasted {dur|second|seconds}.",
        templates={"zh": "{player}这次回头观察持续了{dur}秒。"},
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
    dist = fn("event_attr", event=r.at_action, attr="length")
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
    kmh = fn("event_attr", event=r.at_action, attr="release_kmh")
    return Claim(
        id="pass_speed",
        template="{passer}'s pass left his foot at {kmh} km/h.",
        templates={"zh": "{passer}这脚传球的出球时速为{kmh}公里。"},
        slots={"passer": Slot(ref=r.hero_pass.player), "kmh": _num(ctx.value(kmh), 1)},
        predicate=Predicate(op="all", args=[
            _pass_by("passer", r), _approx(kmh, slot("kmh"), 1),
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
        template="{runner} was {gap|metre|metres} from the nearest opponent when the pass was "
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


def scan_before_reception(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.key_scan is None:
        return None
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
        templates={"zh": "出球时，{player}对{runner}位置的判断偏差为{err}米。"},
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
        templates={"zh": "{player}判断传给{receiver}的球能到的概率是{p_belief}，实际是{p_true}。"},
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
    if not isinstance(cf, CounterfactualResult):  # "without that look": scan heroes only
        return None
    if r.runner is None or r.hero_pass is None:
        return None
    belief, truth = _thought_vs_was(r.runner, r.at_action, cf=cf.scan_id)
    values = {"player": r.hero, "receiver": r.runner}
    return Claim(
        id="cf_pass_success",
        template="Without that look, {player} thought the pass to {receiver} had a {p_belief} "
        "chance of arriving; it was {p_true}.",
        templates={"zh": "如果没有那一眼，{player}会以为传给{receiver}的球能到的概率是{p_belief}，"
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
    if not isinstance(cf, CounterfactualResult):  # "without that look": scan heroes only
        return None
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


def counterfactual_value(
    ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult | WhatIfResult
) -> Claim | None:
    if _placed_shot(r) is not None:
        return None  # a goal's possession value is an outcome; `cf_shot_value` gives the chance
    delta = fn("cf_delta", of="possession_value", scan=cf.scan_id)
    if isinstance(cf, CounterfactualResult):
        return Claim(
            id="cf_value",
            template="That look was worth {dxt} in expected threat.",
            templates={"zh": "那一眼带来了{dxt}的预期威胁（xT）。"},
            slots={"dxt": _num(ctx.value(delta), 2)},
            predicate=_approx(delta, slot("dxt"), 2),
            evidence=[cf.scan_id],
        )
    # A forced option (SPEC 3.7): what he did against what he was made to do instead.
    value = ctx.value(delta)
    more = value >= 0
    instead = {"carry": ("keeping the ball", "持球")}.get(
        cf.action, ("the other option", "另一种处理")
    )  # fmt: skip
    return Claim(
        id="cf_value",
        template=f"What {{player}} did was worth {{dxt}} {'more' if more else 'less'} in "
        f"expected threat than {instead[0]}.",
        templates={"zh": f"{{player}}的处理比{instead[1]}{'多' if more else '少'}{{dxt}}的预期"
                         "威胁（xT）。"},
        slots={"player": Slot(ref=r.hero), "dxt": _num(abs(value), 2)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            _approx(delta, slot("dxt", scale=1.0 if more else -1.0), 2),
        ]),
        evidence=[r.hero_pass.id if r.hero_pass else r.reception.id],
    )  # fmt: skip


def counterfactual_carry_lost(
    ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult | WhatIfResult
) -> Claim | None:
    """Had he kept the ball (the forced carry), who would have won it off him."""
    if not isinstance(cf, WhatIfResult) or cf.action != "carry":
        return None
    d = cf.counterfactual_decision
    tackle = next(
        (e for e in cf.counterfactual.events
         if e.type == "tackle" and e.attrs.get("won_from") == r.hero and d is not None
         and e.frame > d.frame),
        None,
    )  # fmt: skip
    if tackle is None:
        return None
    at = {"event": tackle.id, "cf": cf.scan_id}
    return Claim(
        id="cf_carry_lost",
        template="Had {player} kept the ball, {tackler} would have won it off him.",
        templates={"zh": "如果{player}继续持球，{tackler}会把球抢走。"},
        slots={"player": Slot(ref=r.hero), "tackler": Slot(ref=tackle.player)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", attr="type", **at), "tackle"),
            _eq(fn("event_attr", attr="player", **at), slot("tackler")),
            _eq(fn("event_attr", attr="won_from", **at), slot("player")),
        ]),
        evidence=[r.hero_pass.id if r.hero_pass else r.reception.id],
    )  # fmt: skip


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
        (e for e in r.run.events
         if e.type == "reception" and e.player == receiver and e.frame == r.hero_pass.attrs["end"]),
        None,
    )  # fmt: skip
    if reception is None:  # intercepted: the "receiver" is the opponent who won it
        return None
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


def heavy_pressure(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """The lexicon term "under heavy pressure" (pressing intensity >= 0.7), when it holds."""
    if r.hero_pass is None:
        return None
    pred = lexicon.under_heavy_pressure(slot("player"), anchor=r.at_action)
    if not ctx.value(pred.lhs, {"player": r.hero}) >= pred.rhs:
        return None
    return Claim(
        id="heavy_pressure",
        template="{player} was under heavy pressure when he released the ball.",
        templates={"zh": "{player}是在重压之下出球的。"},
        slots={"player": Slot(ref=r.hero)},
        predicate=Predicate(op="all", args=[_pass_by("player", r), pred]),
        terms=["under heavy pressure"],
        evidence=[r.hero_pass.id],
    )


def nearest_opponent_at_pass(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if r.hero_pass is None:
        return None
    who = fn("metric_at", metric="nearest_opponent", player=slot("player"), anchor=r.at_action)
    presser = ctx.value(who, {"player": r.hero})
    gap = fn("distance", a=slot("player"), b=slot("presser"), anchor=r.at_action)
    value = ctx.value(gap, {"player": r.hero, "presser": presser})
    return Claim(
        id="presser_distance",
        template="The nearest opponent, {presser}, was {gap|metre|metres} from {player} when he "
        "released the ball.",
        templates={"zh": "{player}出球时，离他最近的对手是{presser}，相距{gap}米。"},
        slots={"player": Slot(ref=r.hero), "presser": Slot(ref=presser), "gap": _num(value, 1)},
        predicate=Predicate(op="all", args=[
            _pass_by("player", r), _eq(who, slot("presser")), _approx(gap, slot("gap"), 1),
        ]),
        evidence=[r.hero_pass.id],
    )  # fmt: skip


def receiver_pressure(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """Pressing intensity on the receiver as the pass reached him: what the pass escaped to."""
    rec = r.completion
    if rec is None:
        return None
    at = r._anchor("completion", rec)
    press = fn("metric_at", metric="pressing_intensity", player=slot("receiver"), anchor=at)
    value = 100.0 * ctx.value(press, {"receiver": rec.player})
    return Claim(
        id="receiver_pressure",
        template="When the pass reached {receiver}, pressing intensity on him was {pressure}%.",
        templates={"zh": "球到{receiver}脚下时，他承受的逼抢强度为{pressure}%。"},
        slots={"receiver": Slot(ref=rec.player), "pressure": _num(value, 0)},
        predicate=Predicate(
            op="all",
            args=[
                _eq(fn("event_attr", event=at, attr="player"), slot("receiver")),
                _approx(press, slot("pressure", scale=0.01), 0, scale=0.01),
            ],
        ),
        evidence=[rec.id],
    )


# --- what a listener needs to picture the moment (SPEC 1, audio description) ---------------------


def reception_zone(ctx: EvalContext, r: HeroRefs) -> Claim:
    """Where he got the ball, as a band of the pitch's length and a lane of its width."""
    at = r.at_reception
    band, lane = (fn("metric_at", metric=m, player=slot("player"), anchor=at)
                  for m in ("pitch_band", "pitch_lane"))  # fmt: skip
    values = {"player": r.hero}
    return Claim(
        id="reception_zone",
        template="{player} received the ball {band:vocab}, {lane:vocab}.",
        templates={"zh": "{player}在{band:vocab}{lane:vocab}接球。"},
        slots={"player": Slot(ref=r.hero), "band": Slot(value=ctx.value(band, values)),
               "lane": Slot(value=ctx.value(lane, values))},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=at, attr="player"), slot("player")),
            _eq(band, slot("band")), _eq(lane, slot("lane")),
        ]),
        evidence=[r.reception.id],
    )  # fmt: skip


def scan_side(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """Which way the key scan turned his head away from the ball, before the ball reached him."""
    if r.key_scan is None:
        return None
    side = fn("scan_side", scan=slot("scan"))
    return Claim(
        id="scan_side",
        template="Before the ball reached him, {player} looked over his {side:vocab} shoulder.",
        templates={"zh": "球到之前，{player}扭头看向了{side:vocab}后方。"},
        slots={"player": Slot(ref=r.hero), "scan": Slot(ref=r.key_scan.id),
               "side": Slot(value=ctx.value(side, {"scan": r.key_scan.id}))},
        predicate=Predicate(op="all", args=[
            Predicate(op="before", lhs=event(slot("scan")), rhs=event(r.at_reception)),
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            _eq(side, slot("side")),
        ]),
        evidence=[r.key_scan.id, r.reception.id],
    )  # fmt: skip


def seen_in_scan(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """The runner came into his view during the key scan (the sim's own definition of seen).

    The sentence names the look itself: it can air before, or without, the line that tells it."""
    if r.runner is None or r.key_scan is None:
        return None
    seen = fn("max_visibility", observer=slot("player"), target=slot("runner"), event=slot("scan"))
    values = {"player": r.hero, "runner": r.runner, "scan": r.key_scan.id}
    if ctx.value(seen, values) < SEEN:
        return None
    return Claim(
        id="seen_in_scan",
        template="When {player} looked over his shoulder before the ball arrived, he saw {runner}.",
        templates={"zh": "球到之前回头的那一眼，{player}看到了{runner}。"},
        slots={"player": Slot(ref=r.hero), "runner": Slot(ref=r.runner),
               "scan": Slot(ref=r.key_scan.id)},
        predicate=Predicate(op="all", args=[
            Predicate(op="before", lhs=event(slot("scan")), rhs=event(r.at_reception)),
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            Predicate(op="ge", lhs=seen, rhs=SEEN),
        ]),
        evidence=[r.key_scan.id, r.reception.id],
    )  # fmt: skip


# --- a placed shot (Module A: `shot:near` / `shot:far`) --------------------------------------


def _placed_shot(r: HeroRefs) -> Event | None:
    """The hero's shot when it is a placed one (it has a placement), else None."""
    shot = r.hero_pass
    return shot if shot is not None and shot.type == "shot" and "placement" in shot.attrs else None


POST = {"near": ("near post", "近角"), "far": ("far post", "远角")}


def scan_at_goal(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    if _placed_shot(r) is None or r.key_scan is None:
        return None
    lead = fn("seconds_between", a=slot("scan"), b=r.at_reception)
    secs = ctx.value(lead, {"scan": r.key_scan.id})
    if round(secs, 1) <= 0.0:
        return None
    return Claim(
        id="scan_at_goal",
        template="{player} looked up {secs|second|seconds} before the ball reached him.",
        templates={"zh": "球到之前{secs}秒，{player}抬头看了一眼。"},
        slots={"player": Slot(ref=r.hero), "scan": Slot(ref=r.key_scan.id), "secs": _num(secs, 1)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=slot("scan"), attr="type"), "scan"),
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _eq(fn("event_attr", event=r.at_reception, attr="player"), slot("player")),
            _approx(lead, slot("secs"), 1),
        ]),
        evidence=[r.key_scan.id, r.reception.id],
    )  # fmt: skip


def keeper_seen_in_scan(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    shot = _placed_shot(r)
    if shot is None or r.key_scan is None:
        return None
    keeper = shot.attrs["keeper"]
    seen = fn("max_visibility", observer=slot("player"), target=slot("keeper"), event=slot("scan"))
    if ctx.value(seen, {"player": r.hero, "keeper": keeper, "scan": r.key_scan.id}) < SEEN:
        return None
    return Claim(
        id="keeper_seen_in_scan",
        template="When {player} looked up, he saw {keeper}.",
        templates={"zh": "{player}抬头的那一眼，看到了{keeper}。"},
        slots={"player": Slot(ref=r.hero), "keeper": Slot(ref=keeper),
               "scan": Slot(ref=r.key_scan.id)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            Predicate(op="ge", lhs=seen, rhs=SEEN),
        ]),
        evidence=[r.key_scan.id],
    )  # fmt: skip


def keeper_near_side(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """Where the look showed the keeper: toward the shooter's near post."""
    shot = _placed_shot(r)
    if shot is None or r.key_scan is None:
        return None
    keeper = shot.attrs["keeper"]
    offset = fn("metric_at", metric="near_side_offset", keeper=slot("keeper"),
                shooter=slot("player"), anchor=slot("scan"))  # fmt: skip
    value = ctx.value(offset, {"keeper": keeper, "player": r.hero, "scan": r.key_scan.id})
    if round(value, 1) < 1.0:
        return None
    return Claim(
        id="keeper_near_side",
        template="When {player} looked up, {keeper} stood {m|metre|metres} toward his near post.",
        templates={"zh": "{player}抬头时，{keeper}站在偏向近门柱{m}米的位置。"},
        slots={"player": Slot(ref=r.hero), "keeper": Slot(ref=keeper),
               "scan": Slot(ref=r.key_scan.id), "m": _num(value, 1)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
            _approx(offset, slot("m"), 1),
        ]),
        evidence=[r.key_scan.id],
    )  # fmt: skip


def shot_placement(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    shot = _placed_shot(r)
    if shot is None:
        return None
    post, post_zh = POST[shot.attrs["placement"]]
    return Claim(
        id="shot_placement",
        template=f"{{player}} went for the {post}.",
        templates={"zh": f"{{player}}选择打{post_zh}。"},
        slots={"player": Slot(ref=r.hero)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=r.at_action, attr="type"), "shot"),
            _eq(fn("event_attr", event=r.at_action, attr="player"), slot("player")),
            _eq(fn("event_attr", event=r.at_action, attr="placement"), shot.attrs["placement"]),
        ]),
        evidence=[shot.id],
    )  # fmt: skip


def shot_result(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """A goal, a save, or a shot wide (the shot's recorded outcome). The ids are `shot_*`: the
    match recap has its own per-moment `goal`, `saved` and `wide` claims (`explain.recap`)."""
    shot = _placed_shot(r)
    if shot is None or shot.attrs.get("outcome") not in ("goal", "saved", "wide"):
        return None
    outcome = shot.attrs["outcome"]
    is_shot = [_eq(fn("event_attr", event=r.at_action, attr="player"), slot("player")),
               _eq(fn("event_attr", event=r.at_action, attr="outcome"), outcome)]  # fmt: skip
    if outcome == "wide":
        return Claim(
            id="shot_wide",
            template="{player}'s shot went wide.",
            templates={"zh": "{player}的射门偏出了。"},
            slots={"player": Slot(ref=r.hero)},
            predicate=Predicate(op="all", args=is_shot),
            evidence=[shot.id],
        )
    if outcome == "goal":
        return Claim(
            id="shot_scored",
            template="{player} scored.",
            templates={"zh": "{player}破门得分。"},
            slots={"player": Slot(ref=r.hero)},
            predicate=Predicate(op="all", args=is_shot),
            evidence=[shot.id],
        )
    return Claim(
        id="shot_saved",
        template="{keeper} saved {player}'s shot.",
        templates={"zh": "{keeper}扑出了{player}的射门。"},
        slots={"player": Slot(ref=r.hero), "keeper": Slot(ref=shot.attrs["keeper"])},
        predicate=Predicate(op="all", args=[
            *is_shot, _eq(fn("event_attr", event=r.at_action, attr="keeper"), slot("keeper")),
        ]),
        evidence=[shot.id],
    )  # fmt: skip


def shot_speed(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    shot = _placed_shot(r)
    if shot is None:
        return None
    kmh = fn("event_attr", event=r.at_action, attr="release_kmh")
    return Claim(
        id="shot_speed",
        template="{player} hit it at {kmh} km/h.",
        templates={"zh": "{player}这脚射门的球速为每小时{kmh}公里。"},
        slots={"player": Slot(ref=r.hero), "kmh": _num(ctx.value(kmh), 1)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=r.at_action, attr="player"), slot("player")),
            _approx(kmh, slot("kmh"), 1),
        ]),
        evidence=[shot.id],
    )  # fmt: skip


def _shot_chance(placement: str, at: str, state: str, cf: str | None = None) -> dict:
    extra = {} if cf is None else {"cf": cf}
    return fn("metric_at", metric="shot_success", player=slot("player"), placement=placement,
              state=state, anchor=at, **extra)  # fmt: skip


def shot_thought_vs_was(ctx: EvalContext, r: HeroRefs) -> Claim | None:
    """He thought vs it was (SPEC 5.1) for a placed shot: his chance of a goal on his belief and
    on the truth."""
    shot = _placed_shot(r)
    if shot is None:
        return None
    placement = shot.attrs["placement"]
    belief, truth = (_shot_chance(placement, r.at_action, s) for s in ("belief", "true"))
    post, post_zh = POST[placement]
    return Claim(
        id="shot_thought_vs_was",
        template=f"{{player}} gave the {post} a {{p_belief}} chance of going in; it was "
        "{p_true}.",
        templates={"zh": f"{{player}}以为打{post_zh}的进球概率是{{p_belief}}，实际是{{p_true}}。"},
        slots={"player": Slot(ref=r.hero),
               "p_belief": _num(ctx.value(belief, {"player": r.hero}), 2),
               "p_true": _num(ctx.value(truth, {"player": r.hero}), 2)},
        predicate=Predicate(op="all", args=[
            _approx(belief, slot("p_belief"), 2), _approx(truth, slot("p_true"), 2),
        ]),
        evidence=[shot.id],
    )  # fmt: skip


def _cf_placed_shot(r: HeroRefs, cf: CounterfactualResult) -> Event | None:
    d = cf.counterfactual_decision
    if d is None or not d.chosen.startswith("shot:"):
        return None
    return next(
        (e for e in cf.counterfactual.events
         if e.type == "shot" and e.player == d.player and e.frame == d.frame
         and "placement" in e.attrs),
        None,
    )  # fmt: skip


def counterfactual_shot(ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult) -> Claim | None:
    if not isinstance(cf, CounterfactualResult) or _placed_shot(r) is None:
        return None
    alt = _cf_placed_shot(r, cf)
    if alt is None:
        return None
    post, post_zh = POST[alt.attrs["placement"]]
    at = {"event": alt.id, "cf": cf.scan_id}
    args = [_eq(fn("event_attr", attr="player", **at), slot("player")),
            _eq(fn("event_attr", attr="placement", **at), alt.attrs["placement"])]  # fmt: skip
    slots = {"player": Slot(ref=r.hero)}
    template, zh = (
        f"Without the look, {{player}} goes for the {post}.",
        (f"如果没有那一眼，{{player}}会选择打{post_zh}。"),
    )
    if alt.attrs.get("outcome") == "saved":
        slots["keeper"] = Slot(ref=alt.attrs["keeper"])
        args += [_eq(fn("event_attr", attr="outcome", **at), "saved"),
                 _eq(fn("event_attr", attr="keeper", **at), slot("keeper"))]  # fmt: skip
        template = f"Without the look, {{player}} goes for the {post}, and {{keeper}} saves it."
        zh = f"如果没有那一眼，{{player}}会选择打{post_zh}，被{{keeper}}扑出。"
    return Claim(
        id="cf_shot",
        template=template,
        templates={"zh": zh},
        slots=slots,
        predicate=Predicate(op="all", args=args),
        evidence=[cf.scan_id],
    )


def counterfactual_keeper_age(
    ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult
) -> Claim | None:
    if not isinstance(cf, CounterfactualResult) or _placed_shot(r) is None:
        return None
    alt = _cf_placed_shot(r, cf)
    if alt is None:
        return None
    keeper = alt.attrs["keeper"]
    age = fn("metric_at", metric="belief_age", observer=slot("player"), target=slot("keeper"),
             anchor=alt.id, cf=cf.scan_id)  # fmt: skip
    value = ctx.value(age, {"player": r.hero, "keeper": keeper})
    return Claim(
        id="cf_keeper_age",
        template="Without the look, his last sight of {keeper} is {secs|second|seconds} old when "
        "{player} shoots.",
        templates={"zh": "如果没有那一眼，{player}射门时距上次看到{keeper}已有{secs}秒。"},
        slots={"player": Slot(ref=r.hero), "keeper": Slot(ref=keeper), "secs": _num(value, 1)},
        predicate=_approx(age, slot("secs"), 1),
        evidence=[cf.scan_id],
    )


def counterfactual_shot_value(
    ctx: EvalContext, r: HeroRefs, cf: CounterfactualResult
) -> Claim | None:
    """The look's worth for a placed shot: his chance of a goal on the truth, with the
    placement he chose and with the one he chooses without the look (the scan lens's Δ)."""
    shot = _placed_shot(r)
    if not isinstance(cf, CounterfactualResult) or shot is None:
        return None
    alt = _cf_placed_shot(r, cf)
    if alt is None:
        return None
    p1 = _shot_chance(shot.attrs["placement"], r.at_action, "true")
    p0 = _shot_chance(alt.attrs["placement"], alt.id, "true", cf=cf.scan_id)
    v1, v0 = (ctx.value(p, {"player": r.hero}) for p in (p1, p0))
    if round(v1, 2) <= round(v0, 2):
        return None
    return Claim(
        id="cf_shot_value",
        template="The look raised his chance of scoring from {p0} to {p1}.",
        templates={"zh": "那一眼把他的进球概率从{p0}提高到了{p1}。"},
        slots={"player": Slot(ref=r.hero), "p0": _num(v0, 2), "p1": _num(v1, 2)},
        predicate=Predicate(op="all", args=[
            _approx(p1, slot("p1"), 2), _approx(p0, slot("p0"), 2),
        ]),
        evidence=[cf.scan_id, shot.id],
    )  # fmt: skip


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
    "heavy_pressure": heavy_pressure,
    "presser_distance": nearest_opponent_at_pass,
    "receiver_pressure": receiver_pressure,
    "reception_zone": reception_zone,
    "scan_side": scan_side,
    "seen_in_scan": seen_in_scan,
    "scan_at_goal": scan_at_goal,
    "keeper_seen_in_scan": keeper_seen_in_scan,
    "keeper_near_side": keeper_near_side,
    "shot_placement": shot_placement,
    "shot_result": shot_result,
    "shot_speed": shot_speed,
    "shot_thought_vs_was": shot_thought_vs_was,
}
CF_BUILDERS: dict[str, Builder] = {
    "cf_pass": counterfactual_pass,
    "cf_value": counterfactual_value,
    "cf_pass_success": counterfactual_pass_success,
    "cf_carry_lost": counterfactual_carry_lost,
    "cf_shot": counterfactual_shot,
    "cf_keeper_age": counterfactual_keeper_age,
    "cf_shot_value": counterfactual_shot_value,
}


# --- a marker's look (`marker_scan`: no decision on the ball) -------------------------------


@dataclass(frozen=True)
class MarkerRefs:
    """The events of a marker's moment: his look, the pass to his man, how it resolved."""

    run: MatchRun
    card: MomentCard
    marker: str
    man: str
    scan: Event
    played: Event  # the pass to his man
    completion: Event | None  # his man's reception, if he received it

    @classmethod
    def of(cls, run: MatchRun, card: MomentCard) -> MarkerRefs:
        done = card.anchors.get("completion")
        return cls(
            run=run,
            card=card,
            marker=card.actor,
            man=card.receiver,
            scan=run.event(card.anchors["scan"]),
            played=run.event(card.anchors["pass"]),
            completion=run.event(done) if done else None,
        )

    def at(self, name: str) -> str:
        return f"{self.card.id}.{name}"

    def cf_completion(self, cf: CounterfactualResult) -> Event | None:
        """His man's reception of the same pass in the run without the look."""
        played = next((e for e in cf.counterfactual.events if e.id == self.played.id), None)
        if played is None or played.attrs.get("outcome") != "complete":
            return None
        return next(
            (e for e in cf.counterfactual.events
             if e.type == "reception" and e.player == played.attrs["receiver"]
             and e.frame == played.attrs["end"]),
            None,
        )  # fmt: skip


def _scan_by_player() -> list[Predicate]:
    return [
        _eq(fn("event_attr", event=slot("scan"), attr="type"), "scan"),
        _eq(fn("event_attr", event=slot("scan"), attr="player"), slot("player")),
    ]


def marker_unseen(ctx: EvalContext, r: MarkerRefs) -> Claim:
    unseen = fn("metric_at", metric="time_unseen", observer=slot("player"), target=slot("runner"),
                anchor=slot("scan"))  # fmt: skip
    values = {"player": r.marker, "runner": r.man, "scan": r.scan.id}
    return Claim(
        id="marker_unseen",
        template="Before he looked, {player} had not seen {runner} for {secs|second|seconds}.",
        templates={"zh": "回头之前，{player}已经有{secs}秒没看到{runner}了。"},
        slots={"player": Slot(ref=r.marker), "runner": Slot(ref=r.man),
               "scan": Slot(ref=r.scan.id), "secs": _num(ctx.value(unseen, values), 1)},
        predicate=Predicate(op="all", args=[*_scan_by_player(),
                                            _approx(unseen, slot("secs"), 1)]),
        evidence=[r.scan.id],
    )  # fmt: skip


def marker_blind_side(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    pred = lexicon.blind_side(slot("player"), slot("runner"), anchor=r.at("scan"))
    if not ctx.value(pred.lhs, {"player": r.marker, "runner": r.man}):
        return None
    return Claim(
        id="blind_side",
        template="{runner} was on {player}'s blind side when he looked.",
        templates={"zh": "{player}回头时，{runner}在他的盲区。"},
        slots={"runner": Slot(ref=r.man), "player": Slot(ref=r.marker)},
        predicate=pred,
        terms=["blind side"],
        evidence=[r.scan.id],
    )


def marker_scan(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    lead = fn("seconds_between", a=slot("scan"), b=slot("pass"))
    values = {"scan": r.scan.id, "pass": r.played.id}
    secs = ctx.value(lead, values)
    if round(secs, 1) <= 0.0:
        return None  # the look did not come before the ball was played
    return Claim(
        id="marker_scan",
        template="{player} looked over his shoulder {secs|second|seconds} before {passer} played "
        "the ball to {runner}.",
        templates={"zh": "{passer}把球传给{runner}之前{secs}秒，{player}回头看了一眼。"},
        slots={"player": Slot(ref=r.marker), "passer": Slot(ref=r.played.player),
               "runner": Slot(ref=r.man), "scan": Slot(ref=r.scan.id),
               "pass": Slot(ref=r.played.id), "secs": _num(secs, 1)},
        predicate=Predicate(op="all", args=[
            *_scan_by_player(),
            _eq(fn("event_attr", event=slot("pass"), attr="type"), "pass"),
            _eq(fn("event_attr", event=slot("pass"), attr="player"), slot("passer")),
            _eq(fn("event_attr", event=slot("pass"), attr="to"), slot("runner")),
            _approx(lead, slot("secs"), 1),
        ]),
        evidence=[r.scan.id, r.played.id],
    )  # fmt: skip


def marker_seen_in_scan(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    seen = fn("max_visibility", observer=slot("player"), target=slot("runner"), event=slot("scan"))
    values = {"player": r.marker, "runner": r.man, "scan": r.scan.id}
    if ctx.value(seen, values) < SEEN:
        return None
    return Claim(
        id="seen_in_scan",
        template="When {player} looked over his shoulder, he saw {runner}.",
        templates={"zh": "{player}回头的那一眼，看到了{runner}。"},
        slots={"player": Slot(ref=r.marker), "runner": Slot(ref=r.man),
               "scan": Slot(ref=r.scan.id)},
        predicate=Predicate(op="all", args=[*_scan_by_player(),
                                            Predicate(op="ge", lhs=seen, rhs=SEEN)]),
        evidence=[r.scan.id],
    )  # fmt: skip


def marker_scan_side(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    side = fn("scan_side", scan=slot("scan"))
    return Claim(
        id="scan_side",
        template="{player} looked over his {side:vocab} shoulder.",
        templates={"zh": "{player}扭头看向了{side:vocab}后方。"},
        slots={"player": Slot(ref=r.marker), "scan": Slot(ref=r.scan.id),
               "side": Slot(value=ctx.value(side, {"scan": r.scan.id}))},
        predicate=Predicate(op="all", args=[*_scan_by_player(), _eq(side, slot("side"))]),
        evidence=[r.scan.id],
    )  # fmt: skip


def marker_runner_received(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    if r.completion is None:
        return None
    return Claim(
        id="runner_received",
        template="{runner} took the pass from {passer}.",
        templates={"zh": "{runner}接到了{passer}的传球。"},
        slots={"runner": Slot(ref=r.man), "passer": Slot(ref=r.played.player),
               "reception": Slot(ref=r.completion.id)},
        predicate=Predicate(op="all", args=[
            Predicate(op="exists", lhs=event(slot("reception"))),
            _eq(fn("event_attr", event=slot("reception"), attr="player"), slot("runner")),
            _eq(fn("event_attr", event=r.at("pass"), attr="receiver"), slot("runner")),
            _eq(fn("event_attr", event=r.at("pass"), attr="player"), slot("passer")),
        ]),
        evidence=[r.played.id, r.completion.id],
    )  # fmt: skip


def marker_reception_zone(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    """Where his man got the ball, from his man's side of the pitch (for listeners)."""
    if r.completion is None:
        return None
    at = r.at("completion")
    band, lane = (fn("metric_at", metric=m, player=slot("player"), anchor=at)
                  for m in ("pitch_band", "pitch_lane"))  # fmt: skip
    values = {"player": r.man}
    return Claim(
        id="reception_zone",
        template="{player} received the ball {band:vocab}, {lane:vocab}.",
        templates={"zh": "{player}在{band:vocab}{lane:vocab}接球。"},
        slots={"player": Slot(ref=r.man), "band": Slot(value=ctx.value(band, values)),
               "lane": Slot(value=ctx.value(lane, values))},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=at, attr="player"), slot("player")),
            _eq(band, slot("band")), _eq(lane, slot("lane")),
        ]),
        evidence=[r.completion.id],
    )  # fmt: skip


def stayed_with_runner(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    if r.completion is None:
        return None
    at = r.at("completion")
    gap = fn("distance", a=slot("player"), b=slot("runner"), anchor=at)
    value = ctx.value(gap, {"player": r.marker, "runner": r.man})
    return Claim(
        id="stayed_with_runner",
        template="{player} was {gap|metre|metres} from {runner} when the ball reached him.",
        templates={"zh": "球到{runner}脚下时，{player}离他{gap}米。"},
        slots={"player": Slot(ref=r.marker), "runner": Slot(ref=r.man), "gap": _num(value, 1)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=at, attr="player"), slot("runner")),
            _approx(gap, slot("gap"), 1),
        ]),
        evidence=[r.completion.id],
    )  # fmt: skip


def runner_pressure(ctx: EvalContext, r: MarkerRefs) -> Claim | None:
    if r.completion is None:
        return None
    at = r.at("completion")
    press = fn("metric_at", metric="pressing_intensity", player=slot("runner"), anchor=at)
    value = 100.0 * ctx.value(press, {"runner": r.man})
    return Claim(
        id="runner_pressure",
        template="When the ball reached {runner}, pressing intensity on him was {pressure}%.",
        templates={"zh": "球到{runner}脚下时，他承受的逼抢强度为{pressure}%。"},
        slots={"runner": Slot(ref=r.man), "pressure": _num(value, 0)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=at, attr="player"), slot("runner")),
            _approx(press, slot("pressure", scale=0.01), 0, scale=0.01),
        ]),
        evidence=[r.completion.id],
    )  # fmt: skip


def cf_lost_runner(ctx: EvalContext, r: MarkerRefs, cf: CounterfactualResult) -> Claim | None:
    """Where the marker is when the ball reaches his man in the run without the look."""
    if not isinstance(cf, CounterfactualResult) or r.completion is None:
        return None
    rec = r.cf_completion(cf)
    if rec is None:
        return None
    gap = fn("distance", a=slot("player"), b=slot("runner"), anchor=rec.id, cf=cf.scan_id)
    value = ctx.value(gap, {"player": r.marker, "runner": r.man})
    lost = lexicon.lost_his_man(slot("player"), slot("runner"), anchor=rec.id, cf=cf.scan_id)
    received = _eq(fn("event_attr", event=rec.id, attr="player", cf=cf.scan_id), slot("runner"))
    shown = _num(value, 1)
    if value > lexicon.TERMS["lost his man"].threshold and shown.value > 5:
        return Claim(
            id="cf_lost_runner",
            template="Without the look, {player} loses his man: he is {gap|metre|metres} from "
            "{runner} when the ball arrives.",
            templates={"zh": "如果没有那一眼，{player}会跟丢{runner}：球到时他已在{gap}米开外。"},
            slots={"player": Slot(ref=r.marker), "runner": Slot(ref=r.man), "gap": shown},
            predicate=Predicate(op="all", args=[received, lost, _approx(gap, slot("gap"), 1)]),
            terms=["lost his man"],
            evidence=[r.scan.id],
        )  # fmt: skip
    return Claim(
        id="cf_lost_runner",
        template="Without the look, {player} is {gap|metre|metres} from {runner} when the ball "
        "arrives.",
        templates={"zh": "如果没有那一眼，球到时{player}离{runner}有{gap}米。"},
        slots={"player": Slot(ref=r.marker), "runner": Slot(ref=r.man), "gap": shown},
        predicate=Predicate(op="all", args=[received, _approx(gap, slot("gap"), 1)]),
        evidence=[r.scan.id],
    )  # fmt: skip


def cf_unmarked(ctx: EvalContext, r: MarkerRefs, cf: CounterfactualResult) -> Claim | None:
    if not isinstance(cf, CounterfactualResult):
        return None
    rec = r.cf_completion(cf)
    if rec is None:
        return None
    pred = lexicon.predicate("unmarked", rec.id, player=slot("runner"), cf=cf.scan_id)
    if not ctx.value(pred.lhs, {"runner": r.man}) > pred.rhs:
        return None
    return Claim(
        id="cf_unmarked",
        template="Without the look, {runner} receives the ball unmarked.",
        templates={"zh": "如果没有那一眼，{runner}接球时无人盯防。"},
        slots={"runner": Slot(ref=r.man)},
        predicate=Predicate(op="all", args=[
            _eq(fn("event_attr", event=rec.id, attr="player", cf=cf.scan_id), slot("runner")),
            pred,
        ]),
        terms=["unmarked"],
        evidence=[r.scan.id],
    )  # fmt: skip


def cf_belief_error(ctx: EvalContext, r: MarkerRefs, cf: CounterfactualResult) -> Claim | None:
    if not isinstance(cf, CounterfactualResult):
        return None
    err = fn("metric_at", metric="sighting_error", observer=slot("player"), target=slot("runner"),
             anchor=r.played.id, cf=cf.scan_id)  # fmt: skip
    value = ctx.value(err, {"player": r.marker, "runner": r.man})
    return Claim(
        id="cf_belief_error",
        template="Without the look, {player}'s picture of {runner} is off by {err|metre|metres} "
        "when the ball is played.",
        templates={"zh": "如果没有那一眼，出球时{player}对{runner}位置的判断会偏差{err}米。"},
        slots={"player": Slot(ref=r.marker), "runner": Slot(ref=r.man), "err": _num(value, 1)},
        predicate=_approx(err, slot("err"), 1),
        evidence=[r.scan.id, r.played.id],
    )  # fmt: skip


def marker_cf_value(ctx: EvalContext, r: MarkerRefs, cf: CounterfactualResult) -> Claim | None:
    """The look's worth: the expected turnover where the pass resolved, with it minus without
    (the scan lens of a `marker_scan`, `explain.lenses.marker_scan_lens`)."""
    if not isinstance(cf, CounterfactualResult):
        return None
    delta = fn("cf_delta", of=fn("turnover_at_resolution", event=r.played.id), scan=cf.scan_id)
    return Claim(
        id="cf_value",
        template="That look was worth {dxt} in expected threat.",
        templates={"zh": "那一眼带来了{dxt}的预期威胁（xT）。"},
        slots={"dxt": _num(ctx.value(delta), 2)},
        predicate=_approx(delta, slot("dxt"), 2),
        evidence=[cf.scan_id],
    )


MarkerBuilder = Callable[..., Claim | None]

MARKER_BUILDERS: dict[str, MarkerBuilder] = {
    "marker_unseen": marker_unseen,
    "blind_side": marker_blind_side,
    "marker_scan": marker_scan,
    "seen_in_scan": marker_seen_in_scan,
    "scan_side": marker_scan_side,
    "runner_received": marker_runner_received,
    "reception_zone": marker_reception_zone,
    "stayed_with_runner": stayed_with_runner,
    "runner_pressure": runner_pressure,
}
MARKER_CF_BUILDERS: dict[str, MarkerBuilder] = {
    "cf_lost_runner": cf_lost_runner,
    "cf_unmarked": cf_unmarked,
    "cf_belief_error": cf_belief_error,
    "cf_value": marker_cf_value,
}


def _built(
    ctx: EvalContext, refs: object, builders: list[tuple[str, Builder, tuple]]
) -> dict[str, Claim]:
    out: dict[str, Claim] = {}
    for kind, build, extra in builders:
        try:
            claim = build(ctx, refs, *extra)
        except (Inconclusive, Refuted):
            continue  # not measurable in this run
        if claim is not None:
            out[kind] = claim
    return out


def hero_claims(
    ctx: EvalContext, cf: CounterfactualResult | WhatIfResult | None = None
) -> dict[str, Claim]:
    """Every hero-moment fact that can be measured in this run, keyed by kind."""
    decision = ctx.run.hero_decision()
    if decision is None:
        card = hero_card(ctx.run, ctx.cards)
        if card is not None and card.kind == "marker_scan":
            builders = [(k, b, ()) for k, b in MARKER_BUILDERS.items()]
            if cf is not None:
                builders += [(k, b, (cf,)) for k, b in MARKER_CF_BUILDERS.items()]
            return _built(ctx, MarkerRefs.of(ctx.run, card), builders)
    card = next(
        (c for c in ctx.cards.values()
         if decision is not None and not c.live_only
         and (c.actor, c.anchor_frame) == (decision.player, decision.frame)),
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
