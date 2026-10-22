// Pass options at the decision (SPEC 7): what the hero weighed, on his belief and on the truth.
// A line from the carrier to each option's believed target: width = how likely he was to choose
// it, colour = its value, the chosen one highlighted; a dashed line to the target the same option
// had on the true state. Numbers shown come from claims when the payload has one (SPEC 5.3).

import { isShot, shotPost, type Hero, type Run } from "../data/hero";
import type { Vec2 } from "../data/types";
import type { ClaimKind, Narration, PayloadClaim } from "../narration/payload";
import { shortName } from "../data/roster";

export const TOP_OPTIONS = 6;
/** The layer is shown from just before the decision until the pass is on its way. */
export const OPTIONS_WINDOW = { before: 2, after: 25 }; // frames

export interface PassOption {
  action: string;
  kind: "pass" | "carry" | "shot";
  label: string;
  receiver: string | null;
  from: Vec2; // the carrier at the decision, m
  target: Vec2; // chosen on his belief
  targetTrue: Vec2 | null; // the same option on the true state
  receiverBelieved: Vec2 | null;
  receiverTrue: Vec2 | null;
  prob: number; // chance he chose it (softmax on his belief)
  pBelief: number; // P(success) he thought
  pTrue: number | null; // P(success) it was
  value: number; // xT after the action, on his belief
  valueTrue: number | null;
  chosen: boolean;
}

export function optionLabel(action: string): string {
  if (action.startsWith("pass:")) return `Pass to ${shortName(action.slice(5))}`;
  const post = shotPost(action); // a placed shot (Module A): "shot:near" / "shot:far"
  if (post) return `${post === "near" ? "Near" : "Far"}-post shot`;
  return action === "carry" ? "Carry" : action === "shot" ? "Shot" : action;
}

/** The top options by choice probability, plus the chosen one and the runner's, best first. */
export function passOptions(hero: Hero, run: Run): PassOption[] {
  const d = run.decision;
  if (!d) return [];
  const n = hero.n;
  const at = (d.frame * n + hero.hero) * 2;
  const from: Vec2 = [run.pos[at], run.pos[at + 1]];
  const runner = hero.runnerId ? `pass:${hero.runnerId}` : null;
  return d.options
    .filter((o, rank) => rank < TOP_OPTIONS || o.action === d.chosen || o.action === runner)
    .map((o) => ({
      action: o.action,
      kind: o.action.startsWith("pass:") ? "pass" : isShot(o.action) ? "shot" : "carry",
      label: optionLabel(o.action),
      receiver: o.receiver,
      from,
      target: o.target,
      targetTrue: o.target_true,
      receiverBelieved: o.receiver_believed,
      receiverTrue: o.receiver_true,
      prob: o.prob,
      pBelief: o.p_success,
      pTrue: o.p_success_true,
      value: o.value,
      valueTrue: o.value_true,
      chosen: o.action === d.chosen,
    }));
}

export function optionsVisible(frame: number, decisionFrame: number): boolean {
  return (
    frame >= decisionFrame - OPTIONS_WINDOW.before && frame <= decisionFrame + OPTIONS_WINDOW.after
  );
}

// ---------- encodings ----------

export const WIDTH_PX = { min: 1.2, max: 9 };

/** Line width in pixels, linear in the probability that he chose the option. */
export function widthFor(prob: number): number {
  const p = Math.min(1, Math.max(0, prob));
  return WIDTH_PX.min + (WIDTH_PX.max - WIDTH_PX.min) * p;
}

/** Value range over both runs, so the same colour means the same value with and without the look. */
export function valueRange(hero: Hero): [number, number] {
  const values = (["factual", "counterfactual"] as const).flatMap((name) =>
    passOptions(hero, hero.runs[name]).flatMap((o) =>
      o.valueTrue === null ? [o.value] : [o.value, o.valueTrue],
    ),
  );
  return [Math.min(...values), Math.max(...values)];
}

// Dim teal (little threat) to near-white (most threat): reads on the green pitch, distinct from
// both team colours and from the gold used for the run without the look.
export const VALUE_RAMP = ["#3e5d66", "#4fb8d0", "#effcff"];

function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  const out = [0, 1, 2].map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Colour for an option's value (xT), on a fixed range. */
export function colorFor(value: number, [lo, hi]: [number, number]): string {
  const t = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 1;
  return t < 0.5
    ? mix(VALUE_RAMP[0], VALUE_RAMP[1], t / 0.5)
    : mix(VALUE_RAMP[1], VALUE_RAMP[2], (t - 0.5) / 0.5);
}

// ---------- he thought / it was, from claims ----------

export interface ThoughtVsWas {
  action: string;
  claim: PayloadClaim;
  pBelief: string;
  pTrue: string;
}

/**
 * The payload claim behind "he thought / it was" in this run (SPEC 5.1), and the option it is
 * about: `pass_success` is the chosen pass with the look, `cf_pass_success` the runner's option
 * without it (as built by explain.builders). Null when the payload has no such claim.
 */
export function thoughtVsWas(
  narration: Narration | null,
  hero: Hero,
  run: Run,
): ThoughtVsWas | null {
  const factual = run.name === "factual";
  const claim = narration?.claims.get(factual ? "pass_success" : "cf_pass_success");
  const action = factual ? run.decision?.chosen : hero.runnerId && `pass:${hero.runnerId}`;
  const { p_belief: pb, p_true: pt } = claim?.values ?? {};
  if (!claim || claim.verdict !== "supported" || !action) return null;
  if (typeof pb !== "number" || typeof pt !== "number") return null;
  return { action, claim, pBelief: pb.toFixed(2), pTrue: pt.toFixed(2) };
}

// ---------- hover ----------

export interface HoverRow {
  label: string;
  value: string;
  source: "claim" | "sim"; // sim: read from the export, not checked by the verifier
  kind?: ClaimKind;
}

export interface Hover {
  title: string;
  chosen: boolean;
  rows: HoverRow[];
}

export function hoverContent(option: PassOption, verified: ThoughtVsWas | null): Hover {
  const claim = verified && verified.action === option.action ? verified : null;
  const sim = (label: string, value: string): HoverRow => ({ label, value, source: "sim" });
  const fromClaim = (label: string, value: string): HoverRow => ({
    label,
    value,
    source: "claim",
    kind: claim!.claim.kind,
  });
  const success = option.kind === "shot" ? "score" : "arrive";
  return {
    title: option.label,
    chosen: option.chosen,
    rows: [
      sim("Chance he picked it", option.prob.toFixed(2)),
      claim
        ? fromClaim(`He thought it would ${success}`, claim.pBelief)
        : sim(`He thought it would ${success}`, option.pBelief.toFixed(2)),
      claim
        ? fromClaim("It was", claim.pTrue)
        : sim("It was", option.pTrue === null ? "not playable" : option.pTrue.toFixed(2)),
      sim("Value, as he saw it", `${option.value >= 0 ? "+" : ""}${option.value.toFixed(3)} xT`),
    ],
  };
}

// ---------- picking under the pointer ----------

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The option whose line (or glyph) is nearest to `point`, within `tolerance` metres. */
export function pickOption(
  point: Vec2,
  options: PassOption[],
  tolerance: number,
): PassOption | null {
  let best: PassOption | null = null;
  let bestD = tolerance;
  for (const o of options) {
    const d =
      o.kind === "pass"
        ? distanceToSegment(point, o.from, o.target)
        : Math.hypot(point[0] - o.target[0], point[1] - o.target[1]);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/** Pitch metres -> CSS pixels in a tactical board of size w x h (centre spot in the middle). */
export function toScreen([x, y]: Vec2, w: number, h: number, zoom: number): Vec2 {
  return [w / 2 + x * zoom, h / 2 - y * zoom];
}

export function toPitch([px, py]: Vec2, w: number, h: number, zoom: number): Vec2 {
  return [(px - w / 2) / zoom, (h / 2 - py) / zoom];
}
