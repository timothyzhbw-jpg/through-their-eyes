// The tours' step lists (steps.json, SPEC 7): the quick tour (door 1's story, The look, ending on
// a card with the other two doors), the full judge tour (the three doors in order), and the studios'
// walk (door 3's sections, journey/). Their schema, which steps this page can show, and each step's
// words with their slots filled from the moment's own data. A step this page cannot show (no live
// service, a hero with no counterfactual, a stitched match) is left out, never shown broken.

import { z } from "zod";
import { runLabels } from "../data/hero";
import { DOORS } from "../doors/doors";
import { JOURNEY_STEPS } from "../journey/steps";
import { shortName } from "../data/roster";
import type { ViewSession } from "../session";
import { takeEyesOf } from "../takeeyes/controller";
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
  "takeEyes",
] as const;
/** What a step does when it comes up (actions.ts). */
export const ENTERS = [
  "none",
  "look",
  "replay",
  "compare",
  "counterfactual",
  "openEvidence",
  "openTamper",
  "tamperAuto",
  "yourCall",
  "takeEyes",
  "audience",
  "producer",
  "recap",
] as const;
/** The verified lines a quick-tour step's panel carries (StepLines.tsx). */
export const SAYS = ["look", "without", "compare"] as const;
/** The tour card's own buttons for a step (TourActs.tsx): anything that calls the service; the
 * quick tour's look again and its link to the scan story; and its end card's three choices
 * (`doors`: the card's only buttons). */
export const ACTS = [
  "checkWrongNumber",
  "sound",
  "drill",
  "openMatch",
  "replayLook",
  "scanSteps",
  "doors",
] as const;

export type Condition = (typeof CONDITIONS)[number];
export type EnterName = (typeof ENTERS)[number];
export type ActName = (typeof ACTS)[number];
export type SayName = (typeof SAYS)[number];

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
  door: z.enum(DOORS).optional(), // the door it opens on arrival (doors/); none: the page stays
  enter: z.enum(ENTERS),
  act: z.enum(ACTS).optional(),
  say: z.enum(SAYS).optional(), // the verified lines its panel carries
  journey: z.enum(JOURNEY_STEPS).optional(), // the journey step whose panel it opens (journey/)
  needs: z.array(When),
  hold: z.number().positive(), // suggested seconds on the step
});

export const StepList = z.strictObject({
  about: z.string(),
  steps: z.array(Step).min(1), // the full judge tour: the three doors in order
  quick: z.array(Step).min(1), // the quick tour: door 1's story
  story: z.array(Step).min(1), // the studios' walk: door 3's steps
});

export type TourStep = z.infer<typeof Step>;
export type TourKind = "quick" | "full" | "story";

const LISTS = StepList.parse(raw);
export const STEPS: TourStep[] = LISTS.steps;
export const STEP_IDS: string[] = STEPS.map((s) => s.id);
export const QUICK_STEPS: TourStep[] = LISTS.quick;
export const QUICK_IDS: string[] = QUICK_STEPS.map((s) => s.id);
export const STORY_STEPS: TourStep[] = LISTS.story;
export const STORY_IDS: string[] = STORY_STEPS.map((s) => s.id);

/** Step ids from before, and the step each lands on now: the old Full story's Event steps are
 * door 1's story, its Your view (now in Settings) gives way to the studios' first section, the
 * studios' old steps land on the section that holds their panel, and the quick tour's Your call
 * step is the full tour's. */
export const LEGACY_STEP_IDS: Record<string, string> = {
  "story-event": "look",
  "story-without": "remove",
  "story-view": "story-broadcast",
  "story-tactics": "story-broadcast",
  "story-content": "story-highlights",
  "story-crew": "story-commentary",
  call: "yourcall",
};

/** A tour's steps, all of them, in order. */
export const stepsOf = (kind: TourKind): TourStep[] =>
  kind === "quick" ? QUICK_STEPS : kind === "story" ? STORY_STEPS : STEPS;

/** The tour a step id belongs to (ids are unique across the three). */
export const kindOf = (id: string): TourKind =>
  QUICK_IDS.includes(id) ? "quick" : STORY_IDS.includes(id) ? "story" : "full";

/** A tour's length in seconds: the sum of its steps' suggested holds. */
export const secondsOf = (kind: TourKind): number => stepsOf(kind).reduce((t, s) => t + s.hold, 0);

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
      takeEyes: session.kind === "hero" && !takeEyesOf(session).unavailable,
    },
    slots: {
      cf: labels.tag.counterfactual,
      cfTitle: labels.counterfactual,
      hero: hero.heroId ? shortName(hero.heroId) : "the player",
    },
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
 * it in its tour's whole list (a link to a step this page lacks lands on the following one); else
 * the first.
 */
export function indexOf(steps: TourStep[], id: string | null): number {
  if (id === null) return 0;
  const exact = steps.findIndex((s) => s.id === id);
  if (exact >= 0) return exact;
  const ids = stepsOf(kindOf(id)).map((s) => s.id);
  const order = ids.indexOf(id);
  const after = steps.findIndex((s) => ids.indexOf(s.id) > order);
  return order >= 0 && after >= 0 ? after : 0;
}

/** The quick tour opens only where it can show its point: the look, and the run without it. */
export function quickTourFits(env: TourEnv): boolean {
  const shown = new Set(resolveSteps(env, QUICK_STEPS).map((s) => s.id));
  return shown.has("look") && shown.has("remove");
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
