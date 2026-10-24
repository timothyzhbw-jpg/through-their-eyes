// "Show data on the pitch" (SPEC 7): the measured tags over the players (PASS 24 m · routine,
// SPRINT … km/h, the carrier's name, each with its `tracking` mark) and his readouts in his eyes.
// Off by default, so the first screen is the picture; the hero's and the key players' rings and
// names stay. The viewer's choice is kept in localStorage, like the audience and language
// (personal/persist.ts); where storage is off the page simply forgets.

import { browserStorage } from "../personal/persist";
import { createStore } from "../store/store";

export const PITCH_DATA_KEY = "tte.pitchData.v1";

function readSaved(): boolean {
  try {
    return browserStorage()?.getItem(PITCH_DATA_KEY) === "1";
  } catch {
    return false;
  }
}

export const pitchData = createStore<{ on: boolean }>({ on: readSaved() });

/** Turn the data on the pitch on or off, and remember it. */
export function setPitchData(on: boolean): void {
  pitchData.set({ on });
  try {
    const storage = browserStorage();
    if (on) storage?.setItem(PITCH_DATA_KEY, "1");
    else storage?.removeItem(PITCH_DATA_KEY);
  } catch {
    // storage refused: the choice still holds for this visit
  }
}
