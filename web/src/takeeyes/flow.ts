// "Take his eyes" (SPEC 7): the steps of the mode, as a pure reducer. The viewer picks a time and
// a direction for his one look (`choosing`), watches the moment re-simulated with it through his
// eyes (`looking`), then sees what came of it (`result`): both runs as ghost paths, or his picture
// at the decision with the look or with none. From the result one step tries another look.

export type Step = "closed" | "loading" | "error" | "choosing" | "looking" | "result";
/** What the result shows: both runs from the decision on, or his picture at the decision. */
export type ResultView = "both" | "picture" | "none";

export interface FlowState {
  step: Step;
  frame: number | null; // the look's time, a grid frame
  offset: number | null; // its direction, degrees from the ball (+ to his left)
  tried: string[]; // look ids already played since the mode opened, in order
  view: ResultView;
  error: string | null;
}

export type FlowEvent =
  | { type: "open"; loaded: boolean }
  | { type: "loaded"; frame: number; offset: number }
  | { type: "failed"; error: string }
  | { type: "pick"; frame?: number; offset?: number }
  | { type: "look"; id: string }
  | { type: "done" }
  | { type: "view"; view: ResultView }
  | { type: "again" }
  | { type: "close" };

export const CLOSED: FlowState = {
  step: "closed",
  frame: null,
  offset: null,
  tried: [],
  view: "both",
  error: null,
};

/** The next state; an event that does not apply returns the same state object. */
export function reduce(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case "open":
      if (s.step !== "closed") return s;
      if (!e.loaded) return { ...CLOSED, step: "loading" };
      return s.frame === null ? { ...CLOSED, step: "loading" } : { ...s, step: "choosing" };
    case "loaded":
      if (s.step !== "loading") return s;
      return { ...s, step: "choosing", frame: e.frame, offset: e.offset };
    case "failed":
      return s.step === "loading" ? { ...s, step: "error", error: e.error } : s;
    case "pick": {
      if (s.step !== "choosing" && s.step !== "result") return s;
      const frame = e.frame ?? s.frame;
      const offset = e.offset ?? s.offset;
      if (s.step === "choosing" && frame === s.frame && offset === s.offset) return s;
      return { ...s, step: "choosing", frame, offset };
    }
    case "look":
      if (s.step !== "choosing" || s.frame === null || s.offset === null) return s;
      return {
        ...s,
        step: "looking",
        view: "both",
        tried: s.tried.includes(e.id) ? s.tried : [...s.tried, e.id],
      };
    case "done":
      return s.step === "looking" ? { ...s, step: "result", view: "both" } : s;
    case "view":
      return s.step === "result" && s.view !== e.view ? { ...s, view: e.view } : s;
    case "again":
      return s.step === "result" || s.step === "looking" ? { ...s, step: "choosing" } : s;
    case "close":
      return s.step === "closed" ? s : { ...s, step: "closed", error: null };
  }
}
