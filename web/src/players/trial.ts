// The "Animated players" switch (SPEC 7). On by default in the first-person view: Bowen chose the
// rigged players over the tokens by eye. `?rigged=0` starts with the tokens, for side-by-side
// review; if the model cannot load, RiggedFallback switches back to the tokens.
// Kept out of the playback store on purpose: the rigged players stay removable by deleting players/.
// The retargeted mocap clips (extra.ts: a kick at passes, a shoulder check at scans) and with them
// the walk (walk.ts, at slow speeds) are on by default; `?anims=base` keeps the engine's clips
// only, and `?walk=0` the extra clips without the walk, for side-by-side review. If the extra
// clips cannot load, the players fall back to the engine's clips; if the walk cannot, to the
// extra clips.

import { createStore } from "../store/store";

export type Anims = "base" | "extra";

export interface TrialState {
  rigged: boolean;
  anims: Anims;
  walk: boolean; // the walk (walk.ts), with anims "extra"
}

/** Rigged players unless the query string asks for the tokens with `rigged=0`. */
export function riggedFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("rigged") !== "0";
}

/** The extra clips unless the query string asks for the engine's only with `anims=base`. */
export function animsFromSearch(search: string): Anims {
  return new URLSearchParams(search).get("anims") === "base" ? "base" : "extra";
}

/** The walk unless the query string asks for the engine's slow gait with `walk=0`. */
export function walkFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("walk") !== "0";
}

function fromUrl(): TrialState {
  try {
    const search = window.location.search;
    return {
      rigged: riggedFromSearch(search),
      anims: animsFromSearch(search),
      walk: walkFromSearch(search),
    };
  } catch {
    return { rigged: true, anims: "extra", walk: true };
  }
}

export const trial = createStore<TrialState>(fromUrl());
