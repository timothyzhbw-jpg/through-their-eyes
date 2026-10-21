// The breakdown on screen: verified narration, the plan it plays from and the voice cues, for the
// chosen persona and language (SPEC 1, 6, 7). With the live service it comes from
// POST /api/breakdowns (cached by content hash on the server); the response says whether it was
// cached or generated, by the model or the offline template, and whether the per-client rate limit
// or the daily cap stopped a regeneration. Offline, or when the request fails, the bundled fixture
// and the hand-written plan are shown instead.
//
// A breakdown from the service is checked exactly like the bundled one: the payload against the
// moment (validatePayload), the plan against the moment and the script (resolvePlan).

import type { BreakdownResponse, Drill, Persona, StepTrace, VoiceCue } from "../api/client";
import type { Hero } from "../data/hero";
import { scriptOf, validatePayload, type Narration } from "../narration/payload";
import type { MomentContext } from "../plan/moment";
import type { Script } from "../plan/schema";
import { resolvePlan, type ResolvedPlan } from "../plan/validate";
import type { Language } from "../whatif/whatif";

/** waiting: online, not asked yet (the stream has not detected the moment). */
export type BreakdownStatus = "waiting" | "loading" | "ready" | "failed";

export type BreakdownOrigin =
  | { kind: "bundled" } // the fixture in public/data: offline data
  | {
      kind: "api";
      key: string; // the server's cache key
      cached: boolean;
      rateLimited: boolean;
      capped: boolean;
      source: "model" | "offline"; // the agent crew on the model, or its offline template
      planSource: "agent" | "template"; // the Telestrator's plan, or the server's template
      planErrors: string[];
      totalMs: number; // the crew's wall time when it was generated
      trace: StepTrace[]; // each crew step: the model, its template, or code
      traceId: string | null; // operation_Id in Application Insights; null: tracing was off
      drill: Drill | null; // a failure drill (SPEC 6); null for a normal breakdown
      recordedAt: string | null; // a recorded drill run, replayed while limited: when it ran
    };

/** What the narration, the breakdown player and the voice read. */
export interface BreakdownView {
  narration: Narration | null; // null when the payload failed its checks (or none yet)
  payloadErrors: string[];
  script: Script; // caption text per line id
  resolved: ResolvedPlan;
  voice: VoiceCue[]; // SSML per line; empty for the bundled fixture
  origin: BreakdownOrigin | null;
}

export interface BreakdownState extends BreakdownView {
  persona: Persona;
  language: Language;
  status: BreakdownStatus;
  error: string | null; // why the service gave no breakdown (the bundled one is shown)
}

/** The bundled fixture and plan (offline data). */
export function bundledBreakdown(
  payload: unknown,
  plan: unknown,
  moment: MomentContext,
  hero: Hero,
): BreakdownView {
  const checked = validatePayload(payload, moment, hero);
  const narration = checked.ok ? checked.narration : null;
  const script = scriptOf(narration);
  return {
    narration,
    payloadErrors: checked.ok ? [] : checked.errors,
    script,
    resolved: resolvePlan(plan, moment, script),
    voice: [],
    origin: { kind: "bundled" },
  };
}

const dropNulls = (step: object) =>
  Object.fromEntries(Object.entries(step).filter(([, v]) => v !== null));

/**
 * The service's plan in the web's shape: nulls dropped (the API sends every optional field) and
 * each voice cue added as a voice step at its time on the plan clock.
 */
export function webPlan(plan: unknown, voice: VoiceCue[]): unknown {
  const p = plan as { steps?: unknown };
  if (!p || typeof p !== "object" || !Array.isArray(p.steps)) return plan;
  const steps = [
    ...p.steps.map((s) => (s && typeof s === "object" ? dropNulls(s) : s)),
    ...voice.map((c) => ({ t: c.t, do: "voice", line: c.line })),
  ];
  // Stable: at equal times a plan step comes before the line spoken over it.
  steps.sort((a, b) => (a as { t: number }).t - (b as { t: number }).t);
  return { ...p, steps };
}

/** One persona and language out of a service response, checked against the moment. */
export function apiBreakdown(
  res: BreakdownResponse,
  persona: Persona,
  language: Language,
  moment: MomentContext,
  hero: Hero,
): BreakdownView {
  const result = res.result;
  const origin: BreakdownOrigin = {
    kind: "api",
    key: res.key,
    cached: res.cached,
    rateLimited: res.rate_limited,
    capped: res.capped,
    source: res.source,
    planSource: result.plan_source,
    planErrors: result.plan_errors,
    totalMs: result.total_ms,
    trace: result.trace,
    traceId: result.trace_id ?? null,
    drill: res.drill ?? null,
    recordedAt: res.recorded?.at ?? null,
  };
  const script = result.scripts.find((s) => s.persona === persona && s.language === language);
  const checked = script
    ? validatePayload(script.payload, moment, hero)
    : { ok: false as const, errors: [`no script for ${persona} in ${language}`] };
  const narration = checked.ok ? checked.narration : null;
  const lines = scriptOf(narration);
  const voice = (script?.voice ?? []).filter((c) => c.line in lines);
  return {
    narration,
    payloadErrors: checked.ok ? [] : checked.errors,
    script: lines,
    resolved: resolvePlan(webPlan(result.plan, voice), moment, lines),
    voice,
    origin,
  };
}
