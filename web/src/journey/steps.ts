// The journey (SPEC 7): one moment, followed from what happened on the pitch to what it is worth
// off it. Five steps, in order: Event (the moment and the run without the look), Tactics (the
// Tactics lab), Your view (the audience, the language, who to follow), Content (the package and
// the stadium's screens) and Value (the business panel and the sponsor slots). Pure: the ids, their
// order, the keys that move between them and the address that opens one.

export const JOURNEY_STEPS = ["event", "tactics", "your-view", "content", "value"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export const STEP_LABEL: Record<JourneyStep, string> = {
  event: "Event",
  tactics: "Tactics",
  "your-view": "Your view",
  content: "Content",
  value: "Value",
};

/** What each step opens, in a few words (the bar's tooltips and the stepper's second line). */
export const STEP_NOTE: Record<JourneyStep, string> = {
  event: "The moment, with and without the look",
  tactics: "Why the tactics in it work",
  "your-view": "Your audience, language and who you follow",
  content: "The content package and the stadium screens",
  value: "The business panel and the sponsor slots",
};

export const parseStep = (v: string | null | undefined): JourneyStep | null =>
  v != null && (JOURNEY_STEPS as readonly string[]).includes(v) ? (v as JourneyStep) : null;

export const stepIndex = (step: JourneyStep): number => JOURNEY_STEPS.indexOf(step);

/** The step `delta` places away, held at the ends (the journey does not wrap round). */
export function moveStep(step: JourneyStep, delta: number): JourneyStep {
  const i = Math.max(0, Math.min(JOURNEY_STEPS.length - 1, stepIndex(step) + delta));
  return JOURNEY_STEPS[i];
}

/** Where a key moves the bar from `step` (the tabs pattern: arrows, Home, End); null for any
 * other key. */
export function stepForKey(step: JourneyStep, key: string): JourneyStep | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return moveStep(step, 1);
    case "ArrowLeft":
    case "ArrowUp":
      return moveStep(step, -1);
    case "Home":
      return JOURNEY_STEPS[0];
    case "End":
      return JOURNEY_STEPS[JOURNEY_STEPS.length - 1];
    default:
      return null;
  }
}

/** `search` with `?step=` set to `step`, every other parameter kept. */
export function withStep(search: string, step: JourneyStep): string {
  const params = new URLSearchParams(search);
  params.set("step", step);
  return `?${params.toString()}`;
}
