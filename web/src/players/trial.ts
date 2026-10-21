// The "Animated players" switch (SPEC 7). On by default in the first-person view: Bowen chose the
// rigged players over the tokens by eye. `?rigged=0` starts with the tokens, for side-by-side
// review; if the model cannot load, RiggedFallback switches back to the tokens.
// They wear the upgraded look (kit designs, cloth normals, baked occlusion, the keepers' long
// sleeves and gloves; models/README.md), approved by the art director on 2026-10-21; `?look=v1`
// brings back the plain kits, for side-by-side review.
// Kept out of the playback store on purpose: the rigged players stay removable by deleting players/.

import { createStore } from "../store/store";

export type Look = "v1" | "v2";

export interface TrialState {
  rigged: boolean;
  look: Look;
}

/** Rigged players unless the query string asks for the tokens with `rigged=0`. */
export function riggedFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("rigged") !== "0";
}

/** The players' look: v2 unless the query string asks for the plain kits with `look=v1`. */
export function lookFromSearch(search: string): Look {
  return new URLSearchParams(search).get("look") === "v1" ? "v1" : "v2";
}

function fromUrl(): TrialState {
  try {
    const search = window.location.search;
    return { rigged: riggedFromSearch(search), look: lookFromSearch(search) };
  } catch {
    return { rigged: true, look: "v2" };
  }
}

export const trial = createStore<TrialState>(fromUrl());
