"""Corruption eval for the verifier (SPEC 5.3, acceptance checks — explain).

    uv run python -m eval.corruption --seeds 0-19 --n 100

1. For each seed of the hero scenario, run the factual match and the drop-key-scan
   counterfactual, and build every hero-moment claim `explain.builders` can measure. All must
   verify as supported.
2. Perturb `n` of them, an equal share per type: the measured number ±1, the measured number
   ±20%, a player swapped for another player of the match, two entities in the wrong order.
3. Judge each perturbed sentence twice: by the verifier, and by an independent ground-truth
   oracle written here directly against the run arrays and the event list (never through
   explain/). Among perturbations that are false under ground truth the verifier must refute
   ≥ 98%. Perturbations that stay true, or that the recording cannot decide (e.g. a swapped player
   who never scanned), are excluded and listed.
4. Render every supported claim in `en` and `zh` through the render check, and confirm that no
   perturbed claim the verifier did not support renders. Per seed and language, build the render
   payload a viewer would receive (SPEC 5.3) and re-run every check on it.

Claims anchor on the hero's MomentCard (`<card>.<anchor>`, SPEC 5.1) from `explain.moments`.

Writes eval/reports/corruption.md.
"""

from __future__ import annotations

import argparse
import random
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from analytics.pitch_control import pitch_control, pitch_grid
from analytics.pressing import aggregate, frame_pressing
from analytics.vision import VisionParams, player_visibility, visibility, wrap_angle
from explain.audit import JsonlAuditSink, MemoryAuditSink
from explain.builders import HeroRefs, hero_claims
from explain.claims import Claim, Slot
from explain.functions import EvalContext
from explain.moments import detect_moments
from explain.render import ScriptLine, Violation, build_payload, check_payload, render_claim
from explain.verifier import Verdict, Verifier
from sim.config import SimParams
from sim.counterfactual import CounterfactualResult, drop_scan_counterfactual

SCENARIO = "blind_side_run"
REPORTS = Path(__file__).parent / "reports"
PERTURBATIONS = ("number_pm1", "number_pm20", "swap_player", "wrong_order")
LANGS = ("en", "zh")
TARGET = 0.98

# The slot that carries each claim kind's measured number.
MEASURED = {
    "scans_before_reception": "n",
    "time_since_last_scan": "secs",
    "key_scan_duration": "dur",
    "pass_to_runner": "dist",
    "pass_speed": "kmh",
    "gap_to_nearest_opponent": "gap",
    "belief_error": "err",
    "cf_value": "dxt",
    "observed_share": "share",
    "gap_to_marker": "gap",
    "gap_opened": "gain",
    "pressure_at_pass": "pressure",
}
# Player slots that may be swapped. Not the observer of belief_error: other players' beliefs
# are not recorded, so a swap there could never be judged.
SWAPPABLE = {
    "scans_before_reception": ("player",),
    "time_since_last_scan": ("player",),
    "key_scan_duration": ("player",),
    "pass_to_runner": ("passer", "receiver"),
    "pass_speed": ("passer",),
    "unmarked": ("runner", "passer"),
    "gap_to_nearest_opponent": ("runner",),
    "blind_side": ("runner", "player"),
    "scan_before_reception": ("player",),
    "belief_error": ("runner",),
    "cf_pass": ("player", "cf_receiver"),
    "observed_share": ("player",),
    "gap_to_marker": ("runner", "marker"),
    "gap_opened": ("player", "runner", "marker"),
    "runner_received": ("runner", "passer"),
    "pressure_at_pass": ("player",),
    "reception_zone": ("player",),
    "scan_side": ("player",),
    "seen_in_scan": ("player", "runner"),
}
# Two references whose order the sentence depends on (gap_* are symmetric: they stay true).
ORDER = {
    "pass_to_runner": ("passer", "receiver"),
    "unmarked": ("runner", "passer"),
    "blind_side": ("runner", "player"),
    "scan_before_reception": ("scan", "reception"),
    "cf_pass": ("player", "cf_receiver"),
    "gap_to_marker": ("runner", "marker"),
    "gap_opened": ("runner", "marker"),
    "runner_received": ("runner", "passer"),
    "seen_in_scan": ("player", "runner"),
}
APPLICABLE = {
    "number_pm1": MEASURED,
    "number_pm20": MEASURED,
    "swap_player": SWAPPABLE,
    "wrong_order": ORDER,
}


@dataclass
class World:
    seed: int
    cf: CounterfactualResult
    refs: HeroRefs
    verifier: Verifier

    @property
    def run(self):
        return self.cf.factual


@dataclass
class Generated:
    world: World
    kind: str
    claim: Claim
    verdict: Verdict


@dataclass
class Perturbed:
    original: Generated
    perturbation: str
    change: str
    claim: Claim
    verdict: Verdict
    truth: bool | None  # under ground truth; None: the recording cannot decide
    rendered: bool  # whether any language rendered it

    @property
    def kind(self) -> str:
        return self.original.kind


@dataclass
class Result:
    seeds: list[int]
    generated: list[Generated]
    perturbed: list[Perturbed]
    rendered: int = 0
    render_failures: list[tuple[str, str, list[Violation]]] = field(default_factory=list)
    samples: dict[str, dict[str, str]] = field(default_factory=dict)
    payloads: int = 0
    payload_lines: int = 0
    payload_violations: list[Violation] = field(default_factory=list)
    card_anchored: int = 0
    audited: int = 0
    seconds: float = 0.0


# --- ground-truth oracle: plain numpy over the run, independent of explain/ -----------------


def _ref(claim: Claim, name: str) -> str:
    return claim.slots[name].ref


def _val(claim: Claim, name: str) -> float:
    return claim.slots[name].value


def _close(truth: float, claimed: float, decimals: int) -> bool:
    return abs(truth - claimed) <= 0.5 * 10.0**-decimals + 1e-9


def _dist(run, a: str, b: str, f: int) -> float:
    return float(np.linalg.norm(run.pos[f, run.index(a)] - run.pos[f, run.index(b)]))


def _nearest_opponent(run, player: str, f: int) -> float:
    i = run.index(player)
    opp = [j for j, p in enumerate(run.players) if p.team != run.players[i].team]
    return float(np.linalg.norm(run.pos[f, opp] - run.pos[f, i], axis=1).min())


def _scan_frames(run, player: str, upto: int) -> list[int]:
    return [e.frame for e in run.events if e.type == "scan" and e.player == player
            and e.frame <= upto]  # fmt: skip


def _events(run) -> dict:
    return {e.id: e for e in run.events}


def _share(run, player: str, f: int, window_s: float) -> float:
    i = run.index(player)
    grid = pitch_grid()
    others = np.delete(run.pos, i, axis=1)
    frames = range(f - round(window_s / run.dt), f + 1)
    seen = np.max(
        [visibility(run.pos[g, i], run.head_yaw[g, i], np.linalg.norm(run.vel[g, i]), grid,
                    others[g]) for g in frames],
        axis=0,
    )  # fmt: skip
    team = np.array([p.team for p in run.players])
    mates, opps = team == team[i], team != team[i]
    p_def = pitch_control(grid, run.pos[f, opps], run.vel[f, opps], run.pos[f, mates],
                          run.vel[f, mates])  # fmt: skip
    return float((seen * p_def).sum() / p_def.sum())


def _place(run, player: str, f: int) -> tuple[str, str]:
    """Band of the length and lane of the width, from the player's attacking direction."""
    i = run.index(player)
    x, y = run.pos[f, i] * (1.0 if run.players[i].team == 0 else -1.0)  # +x to goal, +y his left
    band = ("own_third" if x < -17.5 else "own_half" if x < 0 else
            "opponents_half" if x < 17.5 else "final_third")  # fmt: skip
    lane = ("right_wing" if y < -20.4 else "right_of_centre" if y < -6.8 else
            "centre" if y <= 6.8 else "left_of_centre" if y <= 20.4 else "left_wing")  # fmt: skip
    return band, lane


def _turned(run, player: str, scan) -> str:
    """Which way the head turned: the larger swing of its integrated rotation over the scan."""
    head = run.head_yaw[scan.frame : scan.attrs["end"] + 1, run.index(player)]
    turned = np.cumsum(wrap_angle(np.diff(head)))
    return "left" if turned[np.argmax(np.abs(turned))] > 0 else "right"


def _saw(run, observer: str, target: str, scan) -> bool:
    i, j = run.index(observer), run.index(target)
    vis = [player_visibility(run.pos[f], run.head_yaw[f], np.linalg.norm(run.vel[f], axis=-1))[i, j]
           for f in range(scan.frame, scan.attrs["end"] + 1)]  # fmt: skip
    return bool(max(vis) >= SimParams().perception_threshold)


def ground_truth(kind: str, c: Claim, w: World) -> bool | None:
    """Is the sentence true in the sim? None when the recording cannot say."""
    run, refs = w.run, w.refs
    recv, hp, dt = refs.reception, refs.hero_pass, run.dt
    if kind == "scans_before_reception":
        lo = recv.frame - round(_val(c, "window_s") / dt)
        if lo < 0:
            return None
        n = sum(lo <= f for f in _scan_frames(run, _ref(c, "player"), recv.frame))
        return n == _val(c, "n")
    if kind == "time_since_last_scan":
        frames = _scan_frames(run, _ref(c, "player"), recv.frame)
        if not frames:
            return None
        return _close((recv.frame - max(frames)) * dt, _val(c, "secs"), 1)
    if kind == "key_scan_duration":
        scan = _events(run)[_ref(c, "scan")]
        duration = (scan.attrs["end"] - scan.frame) * dt
        return scan.player == _ref(c, "player") and _close(duration, _val(c, "dur"), 2)
    if kind == "pass_to_runner":
        return (hp.player == _ref(c, "passer") and hp.attrs["to"] == _ref(c, "receiver")
                and _close(hp.attrs["distance"], _val(c, "dist"), 0))  # fmt: skip
    if kind == "pass_speed":
        return hp.player == _ref(c, "passer") and _close(3.6 * hp.attrs["speed"], _val(c, "kmh"), 0)
    if kind == "unmarked":
        return hp.player == _ref(c, "passer") and _nearest_opponent(run, _ref(c, "runner"),
                                                                    hp.frame) > 5.0  # fmt: skip
    if kind == "gap_to_nearest_opponent":
        return _close(_nearest_opponent(run, _ref(c, "runner"), hp.frame), _val(c, "gap"), 1)
    if kind == "blind_side":
        observer, target = run.index(_ref(c, "player")), run.index(_ref(c, "runner"))
        frames = _scan_frames(run, _ref(c, "player"), recv.frame)
        if not frames:
            return None
        g = max(frames)
        rel = run.pos[g, target] - run.pos[g, observer]
        off = abs(wrap_angle(np.arctan2(rel[1], rel[0]) - run.head_yaw[g, observer]))
        vp = VisionParams()
        speed = np.linalg.norm(run.vel[g, observer])
        return bool(off > max(vp.min_half_cone, vp.half_cone - vp.narrowing_per_mps * speed))
    if kind == "scan_before_reception":
        events = _events(run)
        scan, rec = events.get(_ref(c, "scan")), events.get(_ref(c, "reception"))
        player = _ref(c, "player")
        return (scan is not None and rec is not None and scan.type == "scan"
                and rec.type == "reception" and scan.player == player == rec.player
                and scan.t < rec.t)  # fmt: skip
    if kind == "belief_error":
        d = next((d for d in run.decisions if d.player == _ref(c, "player")
                  and d.frame == hp.frame), None)  # fmt: skip
        if d is None:
            return None
        return _close(d.belief_error[_ref(c, "runner")], _val(c, "err"), 1)
    if kind == "cf_pass":
        d = w.cf.counterfactual_decision
        return d.player == _ref(c, "player") and d.chosen == f"pass:{_ref(c, 'cf_receiver')}"
    if kind == "cf_value":
        return _close(w.cf.delta_xt, _val(c, "dxt"), 2)
    if kind == "observed_share":
        share = _share(run, _ref(c, "player"), recv.frame, _val(c, "window_s"))
        return _close(100.0 * share, _val(c, "share"), 0)
    if kind == "gap_to_marker":
        return _close(_dist(run, _ref(c, "runner"), _ref(c, "marker"), hp.frame), _val(c, "gap"), 1)
    if kind == "gap_opened":
        a, b, k = _ref(c, "runner"), _ref(c, "marker"), refs.kick.frame
        gain = _dist(run, a, b, recv.frame) - _dist(run, a, b, k)
        return recv.player == _ref(c, "player") and _close(gain, _val(c, "gain"), 1)
    if kind == "runner_received":
        rec = _events(run).get(_ref(c, "reception"))
        runner = _ref(c, "runner")
        return (hp.player == _ref(c, "passer") and hp.attrs.get("receiver") == runner
                and rec is not None and rec.player == runner)  # fmt: skip
    if kind == "pressure_at_pass":
        f, i = hp.frame, run.index(_ref(c, "player"))
        carrier = int(run.owner[f])
        team = np.array([p.team for p in run.players])
        if carrier < 0 or team[i] != team[carrier]:
            return None  # only the team in possession is pressed (SPEC 4.3)
        pf = frame_pressing(run.pos[f], run.vel[f], team, run.ball_pos[f], carrier)
        value = pf.on_carrier if i == carrier else float(aggregate(pf.column(i)))
        return _close(100.0 * value, _val(c, "pressure"), 0)
    if kind == "reception_zone":
        player = _ref(c, "player")
        return recv.player == player and _place(run, player, recv.frame) == (
            _val(c, "band"), _val(c, "lane"))  # fmt: skip
    if kind == "scan_side":
        scan, player = _events(run).get(_ref(c, "scan")), _ref(c, "player")
        return (scan is not None and scan.type == "scan" and scan.player == player == recv.player
                and scan.t < recv.t and _turned(run, player, scan) == _val(c, "side"))  # fmt: skip
    if kind == "seen_in_scan":
        scan, player = _events(run).get(_ref(c, "scan")), _ref(c, "player")
        return (scan is not None and scan.player == player == recv.player and scan.t < recv.t
                and _saw(run, player, _ref(c, "runner"), scan))  # fmt: skip
    raise KeyError(kind)


# --- perturbations ------------------------------------------------------------------------


def _shift(s: Slot, factor: float | None, step: int, rng: random.Random) -> tuple[Slot, str]:
    """±1 (factor None) or ±20% at the slot's display precision; always a different value."""
    sign = rng.choice((-1, 1))
    decimals = s.decimals or 0
    unit = 10.0**-decimals
    v = s.value
    new = v + sign * step if factor is None else v * (1 + sign * factor)
    new = round(new) if decimals == 0 else round(new, decimals)
    if new == v:
        new = round(v + sign * unit) if decimals == 0 else round(v + sign * unit, decimals)
    return s.model_copy(update={"value": new}), f"{v} → {new}"


def perturb(g: Generated, ptype: str, rng: random.Random) -> tuple[Claim, str]:
    slots = dict(g.claim.slots)
    if ptype in ("number_pm1", "number_pm20"):
        name = MEASURED[g.kind]
        slots[name], change = _shift(slots[name], None if ptype == "number_pm1" else 0.2, 1, rng)
        change = f"{name}: {change}"
    elif ptype == "swap_player":
        name = rng.choice(SWAPPABLE[g.kind])
        taken = {s.ref for s in slots.values() if s.ref is not None}
        other = rng.choice([p for p in g.world.run.ids if p not in taken])
        change = f"{name}: {slots[name].ref} → {other}"
        slots[name] = Slot(ref=other)
    else:
        a, b = ORDER[g.kind]
        slots[a], slots[b] = slots[b], slots[a]
        change = f"{a} ↔ {b}"
    claim = g.claim.model_copy(update={"id": f"{g.claim.id}~{ptype}", "slots": slots})
    return claim, change


# --- the eval -----------------------------------------------------------------------------


def run_eval(seeds: list[int], n: int = 100, rng_seed: int = 0, audit_path: Path | None = None):
    t0 = time.perf_counter()
    sink = JsonlAuditSink(audit_path) if audit_path else MemoryAuditSink()
    generated: list[Generated] = []
    for seed in seeds:
        cf = drop_scan_counterfactual(SCENARIO, seed)
        cards = {c.id: c for c in detect_moments(cf.factual)}
        ctx = EvalContext(cf.factual, counterfactuals={cf.scan_id: cf}, cards=cards)
        world = World(seed, cf, HeroRefs.of(cf.factual), Verifier(ctx, sink=sink))
        for kind, claim in hero_claims(ctx, cf).items():
            claim = claim.model_copy(update={"id": f"s{seed}.{kind}"})
            generated.append(Generated(world, kind, claim, world.verifier.verify(claim)))
    result = Result(seeds=seeds, generated=generated, perturbed=[])
    result.card_anchored = sum(".action" in s or ".reception" in s for s in (
        g.claim.predicate.model_dump_json() for g in generated))  # fmt: skip

    for seed in seeds:
        mine = [g for g in generated if g.world.seed == seed]
        claims = {g.claim.id: g.claim for g in mine}
        verdicts = {g.claim.id: g.verdict for g in mine}
        for lang in LANGS:
            script = [
                ScriptLine(id="L0", text="他看到了什么？" if lang == "zh" else "What did he see?")
            ]
            script += [ScriptLine(id=f"L{i + 1}", text=g.claim.template_for(lang),
                                  claims=[g.claim.id]) for i, g in enumerate(mine)]  # fmt: skip
            built = build_payload(f"s{seed}", "analyst", lang, script, claims, verdicts)
            result.payloads += 1
            result.payload_lines += len(built.payload.lines)
            result.payload_violations += [v for r in built.rejected for v in r.violations]
            result.payload_violations += check_payload(built.payload)

    for g in generated:
        for lang in LANGS:
            out = render_claim(g.claim, g.verdict, lang)
            result.rendered += out.ok
            if not out.ok:
                result.render_failures.append((g.claim.id, lang, out.violations))
            elif g.world.seed == seeds[0]:
                result.samples.setdefault(g.kind, {})[lang] = out.text

    rng = random.Random(rng_seed)
    supported = [g for g in generated if g.verdict.status == "supported"]
    for i, ptype in enumerate(PERTURBATIONS):
        k = n // len(PERTURBATIONS) + (i < n % len(PERTURBATIONS))
        pool = [g for g in supported if g.kind in APPLICABLE[ptype]]
        picks = rng.sample(pool, k) if len(pool) >= k else rng.choices(pool, k=k)
        for g in picks:
            claim, change = perturb(g, ptype, rng)
            verdict = g.world.verifier.verify(claim)
            rendered = any(render_claim(claim, verdict, lang).ok for lang in LANGS)
            truth = ground_truth(g.kind, claim, g.world)
            result.perturbed.append(Perturbed(g, ptype, change, claim, verdict, truth, rendered))
    result.audited = len(sink.records) if isinstance(sink, MemoryAuditSink) else (
        len(audit_path.read_text().splitlines())
    )  # fmt: skip
    result.seconds = time.perf_counter() - t0
    return result


def _pct(a: int, b: int) -> str:
    return f"{a}/{b} ({a / b:.0%})" if b else "0/0"


def report(r: Result) -> str:
    gen = len(r.generated)
    supported = sum(g.verdict.status == "supported" for g in r.generated)
    false = [p for p in r.perturbed if p.truth is False]
    refuted = sum(p.verdict.status == "refuted" for p in false)
    blocked = sum(p.verdict.status != "supported" for p in false)
    still_true = [p for p in r.perturbed if p.truth is True]
    undecidable = [p for p in r.perturbed if p.truth is None]
    leaked = sum(p.rendered and p.verdict.status != "supported" for p in r.perturbed)
    rate = refuted / len(false) if false else 0.0
    clean = rate >= TARGET and leaked == 0 and not r.payload_violations and not r.render_failures
    kinds = sorted({g.kind for g in r.generated})
    labels = Counter(g.claim.kind for g in r.generated)
    lines = [
        "# Corruption eval — claims verifier",
        "",
        f"Scenario `{SCENARIO}`, seeds {r.seeds[0]}–{r.seeds[-1]} ({len(r.seeds)}): the factual "
        "run and the drop-key-scan counterfactual per seed. Claims come from `explain/builders.py` "
        f"({len(kinds)} facts); {len(r.perturbed)} perturbations, an equal share per type. Each "
        "perturbed sentence is judged by the verifier and by an independent ground-truth oracle "
        "(`eval/corruption.py`, plain numpy over the run, never through `explain/`). Numbers are "
        "true when the truth rounds to the shown value (half a display unit).",
        "",
        "| Metric | Value | Target (SPEC 5.3) |",
        "|---|---|---|",
        f"| Generated claims verified `supported` | {_pct(supported, gen)} | all |",
        f"| Perturbations false under ground truth | {len(false)} | — |",
        f"| … refuted by the verifier | **{_pct(refuted, len(false))}** | ≥ {TARGET:.0%} |",
        f"| … blocked (refuted or inconclusive) | {_pct(blocked, len(false))} | — |",
        f"| Perturbations still true (excluded) | {len(still_true)} | reported |",
        f"| Perturbations the recording cannot decide (excluded) | {len(undecidable)} | reported |",
        f"| Still-true perturbations verified `supported` | "
        f"{_pct(sum(p.verdict.status == 'supported' for p in still_true), len(still_true))} | — |",
        f"| Unsupported perturbed claims that rendered | {leaked} | 0 |",
        f"| Supported claims rendered in en + zh, render check clean | "
        f"{_pct(r.rendered, len(LANGS) * gen)} | all |",
        f"| Render payloads (seed × language) re-checked clean | "
        f"{r.payloads - len({v.line for v in r.payload_violations})}/{r.payloads}, "
        f"{r.payload_lines} lines, {len(r.payload_violations)} violations | all |",
        f"| Claims labelled observed / computed / counterfactual | "
        f"{' / '.join(str(labels[k]) for k in ('observed', 'computed', 'counterfactual'))} | "
        "every claim |",
        f"| Claims anchored on the moment card | {_pct(r.card_anchored, gen)} | — |",
        f"| Verdicts written to the audit log | {r.audited}/{gen + len(r.perturbed)} | all |",
        "",
        f"Result: {'PASS' if clean else 'FAIL'} (refutation {rate:.1%}).",
        "",
        "## By perturbation",
        "",
        "| Perturbation | n | False | Refuted | Still true | Undecidable |",
        "|---|---|---|---|---|---|",
    ]
    for ptype in PERTURBATIONS:
        ps = [p for p in r.perturbed if p.perturbation == ptype]
        f = [p for p in ps if p.truth is False]
        lines.append(
            f"| `{ptype}` | {len(ps)} | {len(f)} | "
            f"{sum(p.verdict.status == 'refuted' for p in f)} | "
            f"{sum(p.truth is True for p in ps)} | {sum(p.truth is None for p in ps)} |"
        )
    lines += [
        "",
        "## By fact",
        "",
        "| Fact | Kind | Generated | Supported | Perturbed | False | Refuted |",
        "|---|---|---|---|---|---|---|",
    ]
    for kind in kinds:
        gs = [g for g in r.generated if g.kind == kind]
        ps = [p for p in r.perturbed if p.kind == kind]
        f = [p for p in ps if p.truth is False]
        lines.append(
            f"| `{kind}` | {gs[0].claim.kind} | {len(gs)} | "
            f"{sum(g.verdict.status == 'supported' for g in gs)} | "
            f"{len(ps)} | {len(f)} | {sum(p.verdict.status == 'refuted' for p in f)} |"
        )
    missed = [p for p in false if p.verdict.status != "refuted"]
    for title, rows in (
        ("False perturbations not refuted", missed),
        ("Excluded: still true", still_true),
        ("Excluded: not decidable from the recording", undecidable),
    ):
        lines += ["", f"## {title}", ""]
        if not rows:
            lines.append("None.")
            continue
        lines += ["| Seed | Fact | Perturbation | Change | Verifier | Reason |",
                  "|---|---|---|---|---|---|"]  # fmt: skip
        for p in rows:
            reason = p.verdict.reason.replace("|", "\\|")
            lines.append(
                f"| {p.original.world.seed} | `{p.kind}` | `{p.perturbation}` | {p.change} | "
                f"{p.verdict.status} | {reason} |"
            )
    if r.render_failures:
        lines += ["", "## Render failures", ""]
        lines += [f"- `{cid}` ({lang}): {v}" for cid, lang, v in r.render_failures]
    if r.payload_violations:
        lines += ["", "## Payload violations", ""]
        lines += [f"- {v}" for v in r.payload_violations]
    lines += [
        "",
        f"## Rendered claims, seed {r.seeds[0]}",
        "",
        "Player ids stand in for display names.",
        "",
        "| Fact | en | zh |",
        "|---|---|---|",
    ]
    for kind in kinds:
        s = r.samples.get(kind, {})
        lines.append(f"| `{kind}` | {s.get('en', '—')} | {s.get('zh', '—')} |")
    counts = Counter(p.verdict.status for p in r.perturbed)
    lines += ["", f"Verdicts on all perturbations: {dict(sorted(counts.items()))}."]
    return "\n".join(lines) + "\n"


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seeds", default="0-19")
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--rng-seed", type=int, default=0)
    parser.add_argument("--audit", type=Path, help="also write the audit log as JSONL here")
    args = parser.parse_args()
    result = run_eval(_parse_seeds(args.seeds), args.n, args.rng_seed, args.audit)
    text = report(result)
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "corruption.md"
    path.write_text(text)
    print(text.split("\n## By perturbation")[0])
    print(f"wrote {path} in {result.seconds:.1f} s")


if __name__ == "__main__":
    main()
