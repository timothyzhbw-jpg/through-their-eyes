// The judge tour's step list (steps.json, SPEC 7): its schema, which steps this page can show, and
// each step's words with their slots filled from the moment's own data. A step this page cannot
// show (no live service, a hero with no counterfactual, a stitched match) is left out, never shown
// broken.

import { z } from "zod";
import { runLabels } from "../data/hero";
import type { ViewSession } from "../session";
import { yourCallOf } from "../yourcall/controller";
import raw from "./steps.json";

/** What a step can need of the page. `!name` in steps.json means "unless". */
export const CONDITIONS = [
  "hero",
  "match",
  "api",
  "keyScan",
  "counterfactual",
  "yourCall",
] as const;
/** What a step does when it comes up (actions.ts). */
export const ENTERS = [
  "none",
  "replay",
  "counterfactual",
  "openEvidence",
  "openTamper",
  "yourCall",
  "audience",
  "producer",
  "recap",
] as const;
/** The tour card's own button for a step, for anything that calls the service (TourActs.tsx). */
export const ACTS = ["checkWrongNumber", "sound", "drill", "openMatch"] as const;

export type Condition = (typeof CONDITIONS)[number];
export type EnterName = (typeof ENTERS)[number];
export type ActName = (typeof ACTS)[number];

const When = z
  .string()
  .refine((v) => (CONDITIONS as readonly string[]).includes(v.replace(/^!/, "")), {
    message: "unknown condition",
  });

const Step = z.strictObject({
  id: z.string().regex(/^[a-z][a-z-]*$/),
  title: z.string().min(1),
  caption: z.string().min(1),
  variants: z.array(z.strictObject({ when: When, caption: z.string().min(1) })).optional(),
  target: z.union([z.string().min(1), z.array(z.string().min(1)).min(1), z.null()]),
  dim: z.boolean(), // darken the page around the target; off where the picture is the point
  focus: z.enum(["card", "app"]).optional(), // who takes the keyboard on arrival (default: card)
  enter: z.enum(ENTERS),
  act: z.enum(ACTS).optional(),
  needs: z.array(When),
  hold: z.number().positive(), // suggested seconds on the step
});

export const StepList = z.strictObject({ about: z.string(), steps: z.array(Step).min(1) });

export type TourStep = z.infer<typeof Step>;

export const STEPS: TourStep[] = StepList.parse(raw).steps;
export const STEP_IDS: string[] = STEPS.map((s) => s.id);

/** What this page has, and the words the slots take: read from the session, never written in. */
export interface TourEnv {
  has: Record<Condition, boolean>;
  slots: Record<string, string>;
}

export function envOf(session: ViewSession): TourEnv {
  const { hero } = session;
  const labels = runLabels(hero);
  return {
    has: {
      hero: session.kind === "hero",
      match: session.kind === "match",
      api: session.api !== null,
      keyScan: !!hero.keyScan,
      counterfactual: !!hero.counterfactual,
      yourCall: session.kind === "hero" && !yourCallOf(session).unavailable,
    },
    slots: { cf: labels.tag.counterfactual, cfTitle: labels.counterfactual },
  };
}

export function holds(env: TourEnv, when: string): boolean {
  const not = when.startsWith("!");
  const value = env.has[when.replace(/^!/, "") as Condition];
  return not ? !value : value;
}

/** The steps this page can show, in tour order. */
export function resolveSteps(env: TourEnv, steps: TourStep[] = STEPS): TourStep[] {
  return steps.filter((s) => s.needs.every((n) => holds(env, n)));
}

/**
 * Where the tour is: the step asked for if this page shows it; else the next one it shows after
 * it in the full list (a link to a step this page lacks lands on the following one); else the
 * first.
 */
export function indexOf(steps: TourStep[], id: string | null): number {
  if (id === null) return 0;
  const exact = steps.findIndex((s) => s.id === id);
  if (exact >= 0) return exact;
  const order = STEP_IDS.indexOf(id);
  const after = steps.findIndex((s) => STEP_IDS.indexOf(s.id) > order);
  return order >= 0 && after >= 0 ? after : 0;
}

const fill = (text: string, env: TourEnv) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => env.slots[name] ?? whole);

/** The step's title and caption on this page: the first variant that holds, slots filled. */
export function wordsOf(step: TourStep, env: TourEnv): { title: string; caption: string } {
  const variant = step.variants?.find((v) => holds(env, v.when));
  const title = fill(step.title, env);
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    caption: fill(variant?.caption ?? step.caption, env),
  };
}

/** The element a step points at: the first of its selectors that matches. */
export function targetOf(step: TourStep, root: ParentNode = document): HTMLElement | null {
  if (step.target === null) return null;
  const selectors = typeof step.target === "string" ? [step.target] : step.target;
  for (const s of selectors) {
    const el = root.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
}
