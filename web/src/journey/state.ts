// The studios' journey's place for the page's lifetime: the step whose panel is open, and a counter
// that moves on every opening asked for from outside the bar (a deep link, a tour), so the panel
// scrolls itself into view once per ask.

import { createStore } from "../store/store";
import { type JourneyStep, withStep } from "./steps";

export interface JourneyState {
  step: JourneyStep;
  seq: number; // bumps on every opening that should bring the panel into view
}

export const journey = createStore<JourneyState>({ step: "tactics", seq: 0 });

/**
 * Open `step`'s panel. `reveal`: bring it into view (a deep link, a tour, a step picked in the
 * bar). `address`: write `?step=` into the address, so the link the viewer copies opens it.
 */
export function openStep(
  step: JourneyStep,
  { reveal = true, address = false }: { reveal?: boolean; address?: boolean } = {},
): void {
  journey.set((s) => ({ step, seq: reveal ? s.seq + 1 : s.seq }));
  if (address && typeof window !== "undefined") {
    const search = withStep(window.location.search, step);
    window.history.replaceState(window.history.state, "", `${search}${window.location.hash}`);
  }
}
