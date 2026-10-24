// The studios' journey (SPEC 7, door 3 of doors/): one moment, followed from why its tactics work
// to what it is worth off the pitch, then the AI crew behind it. Four steps, in order: Tactics (the
// Tactics lab), Content (the package and the stadium's screens), Value (the business panel and the
// sponsor slots) and Behind the scenes (the crew's breakdown, its evidence and the failure drill).
// The old journey's Event step is door 1 and its Your view is in Settings (doors/doors.ts maps
// their addresses). Pure: the ids, their order, the keys that move between them and the address
// that opens one.

export const JOURNEY_STEPS = ["tactics", "content", "value", "crew"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export const STEP_LABEL: Record<JourneyStep, string> = {
  tactics: "Tactics",
  content: "Content",
  value: "Value",
  crew: "Behind the scenes",
};

/** What each step opens, in a few words (the bar's tooltips and the stepper's second line). */
export const STEP_NOTE: Record<JourneyStep, string> = {
  tactics: "Why the tactics in it work",
  content: "The content package and the stadium screens",
  value: "The business panel and the sponsor slots",
  crew: "The AI crew: its breakdown, the evidence and the failure drill",
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

/** `search` with `?door=studios&step=` set to `step`, every other parameter kept. */
export function withStep(search: string, step: JourneyStep): string {
  const params = new URLSearchParams(search);
  params.set("door", "studios");
  params.set("step", step);
  return `?${params.toString()}`;
}
