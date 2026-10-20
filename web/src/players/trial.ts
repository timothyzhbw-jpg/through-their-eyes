// The "Animated players" switch (SPEC 7). On by default in the first-person view: Bowen chose the
// rigged players over the tokens by eye. `?rigged=0` starts with the tokens, for side-by-side
// review; if the model cannot load, RiggedFallback switches back to the tokens.
// Kept out of the playback store on purpose: the rigged players stay removable by deleting players/.

import { createStore } from "../store/store";

export interface TrialState {
  rigged: boolean;
}

/** Rigged players unless the query string asks for the tokens with `rigged=0`. */
export function riggedFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("rigged") !== "0";
}

function fromUrl(): boolean {
  try {
    return riggedFromSearch(window.location.search);
  } catch {
    return true;
  }
}

export const trial = createStore<TrialState>({ rigged: fromUrl() });
