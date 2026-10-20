// Validate a candidate plan before playback (SPEC 7). Two layers:
//   1. shape: the zod schema (unknown step kinds, missing or extra fields, wrong types);
//   2. meaning: against this moment (ids exist, times fall inside the clip, POV clips are short).
// An invalid plan is never played: `resolvePlan` swaps in the template plan and keeps the reasons.

import { frameToRel, type MomentContext } from "./moment";
import { TelestrationPlan, type Script } from "./schema";
import { templatePlan } from "./template";

export const MAX_POV_CLIP_S = 3; // SPEC 7: POV clips <= 3 s, against motion sickness
const EPS = 1e-9;

export type Validation = { ok: true; plan: TelestrationPlan } | { ok: false; errors: string[] };

export interface ResolvedPlan {
  plan: TelestrationPlan;
  source: "given" | "template";
  errors: string[]; // why the given plan was rejected
}

export function validatePlan(candidate: unknown, m: MomentContext, script: Script): Validation {
  const parsed = TelestrationPlan.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`);
    return { ok: false, errors };
  }
  const plan = parsed.data;
  const errors: string[] = [];
  const first = frameToRel(m, 0);
  const last = frameToRel(m, m.frames - 1);
  const inClip = (where: string, rel: number) => {
    if (rel < first - EPS || rel > last + EPS) {
      errors.push(
        `${where}: ${rel} s is outside the clip [${first.toFixed(2)}, ${last.toFixed(2)}]`,
      );
    }
  };
  const knownPlayer = (where: string, id: string) => {
    if (!m.players.includes(id)) errors.push(`${where}: unknown player ${id}`);
  };

  if (plan.moment !== m.id) errors.push(`moment: plan is for ${plan.moment}, not ${m.id}`);
  let previous = 0;
  plan.steps.forEach((step, k) => {
    const where = `steps.${k} (${step.do})`;
    if (step.t < previous) errors.push(`${where}: t = ${step.t} goes back in time`);
    if (step.t > plan.duration_s) errors.push(`${where}: t = ${step.t} is after the end`);
    previous = Math.max(previous, step.t);
    switch (step.do) {
      case "rewind":
      case "play":
        inClip(where, step.to);
        break;
      case "pov":
        knownPlayer(where, step.player);
        inClip(where, step.from);
        inClip(where, step.to);
        if (step.to <= step.from) errors.push(`${where}: empty POV clip`);
        else if (step.to - step.from > MAX_POV_CLIP_S + EPS) {
          const length = (step.to - step.from).toFixed(2);
          errors.push(`${where}: POV clip of ${length} s is longer than ${MAX_POV_CLIP_S} s`);
        }
        break;
      case "scan_marker":
        if (!m.scans.includes(step.scan)) errors.push(`${where}: unknown scan ${step.scan}`);
        break;
      case "zone":
        knownPlayer(where, step.player);
        break;
      case "ghost":
        if (step.kind === "counterfactual" && step.cf !== m.counterfactual) {
          errors.push(`${where}: unknown counterfactual ${step.cf ?? "(none)"}`);
        }
        break;
      case "voice":
        if (!(step.line in script)) errors.push(`${where}: no script line ${step.line}`);
        break;
      case "freeze":
      case "camera":
        break;
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, plan };
}

/** The plan to play: the candidate if it validates, otherwise the moment's template plan. */
export function resolvePlan(candidate: unknown, m: MomentContext, script: Script): ResolvedPlan {
  const given = validatePlan(candidate, m, script);
  if (given.ok) return { plan: given.plan, source: "given", errors: [] };
  const fallback = validatePlan(templatePlan(m), m, {});
  if (!fallback.ok) throw new Error(`template plan is invalid: ${fallback.errors.join("; ")}`);
  return { plan: fallback.plan, source: "template", errors: given.errors };
}
