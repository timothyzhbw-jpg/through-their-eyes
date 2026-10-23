// The judge tour's state for the page's lifetime (like the lineup card's): open or not, the step
// asked for, and a counter that moves on every arrival, so a step sets itself up once per arrival
// even when React mounts the overlay again (StrictMode, a match opening a hero moment).

import { createStore } from "../store/store";
import type { TourKind } from "./steps";

export interface TourState {
  open: boolean;
  kind: TourKind; // the quick tour (a first-time visitor's four steps) or the full judge tour
  at: string | null; // the step asked for; null: the first this page shows
  seq: number; // bumps on every start and move
}

export const tour = createStore<TourState>({ open: false, kind: "full", at: null, seq: 0 });

/** Start a tour, at its first step or at `at`. */
export function startTour(at: string | null = null, kind: TourKind = "full"): void {
  tour.set((s) => ({ open: true, kind, at, seq: s.seq + 1 }));
}

/** Go to a step of the tour on screen (Next, Back, Start again). */
export function goToStep(id: string): void {
  tour.set((s) => ({ ...s, open: true, at: id, seq: s.seq + 1 }));
}

/** Close it: the app stays exactly as the last step left it. */
export function closeTour(): void {
  if (tour.get().open) tour.set({ open: false });
}
