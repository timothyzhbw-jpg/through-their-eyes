// The studios' door (SPEC 7, door 3 of doors/): what the moment is worth to the league, as four
// solutions and then their value. A · AI Tactical Broadcast (the Tactics lab, asked a broadcast's
// questions), B · AI Personalised Commentary (the audiences and languages, and the crew that writes
// them), C · AI Automated Highlights (the content package for the league's channels), D · AI
// Stadium Experience (the stadium's screens), then Value (the league's revenue levers, then the
// demo KPIs). The old studio steps' addresses land on the section that holds their panel now
// (LEGACY_STUDIO_STEPS); the older journey's Event step is door 1 and its Your view is in
// Settings (doors/doors.ts maps their addresses). Pure: the ids, their order, the keys that move
// between them and the address that opens one.

export const JOURNEY_STEPS = ["broadcast", "commentary", "highlights", "stadium", "value"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** The tab's short name. */
export const STEP_LABEL: Record<JourneyStep, string> = {
  broadcast: "Tactical broadcast",
  commentary: "Commentary",
  highlights: "Highlights",
  stadium: "Stadium",
  value: "Value",
};

/** The solution's letter (A–D); Value, which sums them up, has none. */
export const STEP_MARK: Record<JourneyStep, string | null> = {
  broadcast: "A",
  commentary: "B",
  highlights: "C",
  stadium: "D",
  value: null,
};

/** The section's full name: its kicker. */
export const STEP_TITLE: Record<JourneyStep, string> = {
  broadcast: "AI Tactical Broadcast",
  commentary: "AI Personalised Commentary",
  highlights: "AI Automated Highlights",
  stadium: "AI Stadium Experience",
  value: "Value",
};

/** What each section opens, in a few words (the bar's tooltips). */
export const STEP_NOTE: Record<JourneyStep, string> = {
  broadcast: "Tactics explained on air: the Tactics lab, asked a broadcast's questions",
  commentary: "Commentary per fan and language, and the AI crew that writes it",
  highlights: "Highlights, captions and posts for the league's channels, landscape and vertical",
  stadium: "The stadium's screens on matchday",
  value: "The league's revenue levers, then the demo KPIs",
};

/** The studio steps before the four solutions, and the section that holds their panel now. */
export const LEGACY_STUDIO_STEPS: Readonly<Record<string, JourneyStep>> = {
  tactics: "broadcast",
  content: "highlights",
  crew: "commentary",
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
