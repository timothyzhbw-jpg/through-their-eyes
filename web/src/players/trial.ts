// The "Rigged players (trial)" switch (SPEC 7). Off by default: tokens stay the default
// everywhere. `?rigged=1` turns it on at load, for screenshots and side-by-side review.
// Kept out of the playback store on purpose: the trial must be removable by deleting players/.

import { createStore } from "../store/store";

export interface TrialState {
  rigged: boolean;
}

function fromUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("rigged") === "1";
  } catch {
    return false;
  }
}

export const trial = createStore<TrialState>({ rigged: fromUrl() });
