// The judge tour's state for the page's lifetime (like the lineup card's): open or not, the step
// asked for, and a counter that moves on every arrival, so a step sets itself up once per arrival
// even when React mounts the overlay again (StrictMode, a match opening a hero moment).
//
// The keyboard: a tour started from a button goes back to it when the tour closes (or to Settings,
// when that button is in the closed menu); a tour left for a mode it links to (the scan story from
// the compare step) comes back to that step when the mode closes, on the link.

import { createStore } from "../store/store";
import type { TourKind } from "./steps";

export interface TourState {
  open: boolean;
  kind: TourKind; // door 1's story, the full judge tour or the studios' walk
  at: string | null; // the step asked for; null: the first this page shows
  seq: number; // bumps on every start and move
  focus: string | null; // the id of what takes the keyboard on arrival; null: the card's Next
}

export const tour = createStore<TourState>({
  open: false,
  kind: "full",
  at: null,
  seq: 0,
  focus: null,
});

let opener: HTMLElement | null = null; // the button that started the tour on screen

/** Start a tour, at its first step or at `at`. */
export function startTour(at: string | null = null, kind: TourKind = "full"): void {
  if (!tour.get().open && typeof document !== "undefined") {
    const el = document.activeElement;
    opener = el instanceof HTMLElement && el !== document.body ? el : null;
  }
  tour.set((s) => ({ open: true, kind, at, seq: s.seq + 1, focus: null }));
}

/** Go to a step of the tour on screen (Next, Back, Start again). */
export function goToStep(id: string): void {
  tour.set((s) => ({ ...s, open: true, at: id, seq: s.seq + 1, focus: null }));
}

/** Close it: the app stays exactly as the last step left it. `restore`: the keyboard goes back to
 * the button that started it (off when the closing choice moves it itself). */
export function closeTour({ restore = true }: { restore?: boolean } = {}): void {
  if (!tour.get().open) return;
  tour.set({ open: false });
  const back = opener;
  opener = null;
  if (!restore || !back) return;
  // Started from a page that is gone (the landing page's button): the header's title, never <body>.
  if (!back.isConnected) {
    document.querySelector<HTMLElement>(".stage-head h1")?.focus({ preventScroll: true });
    return;
  }
  const menu = back.closest<HTMLElement>(".more-panel");
  const target = menu?.hidden ? document.getElementById("settings") : back;
  target?.focus({ preventScroll: true });
}

let resume: { at: string; kind: TourKind; focus: string } | null = null;

/** Leave the tour for a mode its step links to; `resumeTour` brings it back on that step. */
export function leaveTourFor(focus: string): void {
  const { open, at, kind } = tour.get();
  if (!open) return;
  resume = { at: at ?? "", kind, focus };
  tour.set({ open: false });
}

/** Back to the step the tour was left on, the keyboard on the link that left it; false when no
 * tour was left. */
export function resumeTour(): boolean {
  if (!resume) return false;
  const { at, kind, focus } = resume;
  resume = null;
  tour.set((s) => ({ open: true, kind, at: at || null, seq: s.seq + 1, focus }));
  return true;
}
