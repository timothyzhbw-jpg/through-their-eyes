// "Your call" (SPEC 7): the steps of the mode, as a pure reducer. The viewer decides at the hero's
// decision with only his picture (`deciding`), then the reveal plays its beats in order: what the
// call led to (`outcome`), the true picture (`truth`), what he did and why (`actual`), and the two
// compared (`compare`). From the comparison one step tries another option or closes the mode.

export type Step = "closed" | "deciding" | "outcome" | "truth" | "actual" | "compare";

/** The reveal's beats, in order. */
export const BEATS = ["outcome", "truth", "actual", "compare"] as const;
export type Beat = (typeof BEATS)[number];

export interface FlowState {
  step: Step;
  aim: string | null; // the option previewed while deciding (hover, focus, a swipe in progress)
  pick: string | null; // the viewer's call
  tried: string[]; // calls already played since the mode opened, in order
}

export type FlowEvent =
  | { type: "open" }
  | { type: "aim"; action: string | null }
  | { type: "choose"; action: string }
  | { type: "next" }
  | { type: "skip" }
  | { type: "retry" }
  | { type: "close" };

export interface FlowContext {
  actions: readonly string[]; // the options the viewer may pick
}

export const CLOSED: FlowState = { step: "closed", aim: null, pick: null, tried: [] };

export const isBeat = (step: Step): step is Beat => (BEATS as readonly string[]).includes(step);

/** The next state; an event that does not apply returns the same state object. */
export function reduce(s: FlowState, e: FlowEvent, ctx: FlowContext): FlowState {
  switch (e.type) {
    case "open":
      return { step: "deciding", aim: null, pick: null, tried: s.step === "closed" ? [] : s.tried };
    case "close":
      return s.step === "closed" ? s : CLOSED;
    case "aim":
      if (s.step !== "deciding" || s.aim === e.action) return s;
      if (e.action !== null && !ctx.actions.includes(e.action)) return s;
      return { ...s, aim: e.action };
    case "choose":
      if (s.step !== "deciding" || !ctx.actions.includes(e.action)) return s;
      return {
        step: "outcome",
        aim: null,
        pick: e.action,
        tried: s.tried.includes(e.action) ? s.tried : [...s.tried, e.action],
      };
    case "next": {
      if (!isBeat(s.step) || s.step === "compare") return s;
      return { ...s, step: BEATS[BEATS.indexOf(s.step) + 1] };
    }
    case "skip":
      return isBeat(s.step) && s.step !== "compare" ? { ...s, step: "compare" } : s;
    case "retry":
      return isBeat(s.step) ? { ...s, step: "deciding", aim: null, pick: null } : s;
  }
}
