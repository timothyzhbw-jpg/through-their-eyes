// "Story beside the picture": the desktop transcript of the lines already captioned. On by
// default; the viewer's choice is kept in localStorage, and blocked storage only forgets it.

import { browserStorage } from "../personal/persist";
import { createStore } from "../store/store";

export const CAPTION_STORY_KEY = "tte.captionStory.v1";

function readSaved(): boolean {
  try {
    return browserStorage()?.getItem(CAPTION_STORY_KEY) !== "0";
  } catch {
    return true;
  }
}

export const captionStoryPrefs = createStore<{ on: boolean }>({ on: readSaved() });

export function setCaptionStory(on: boolean): void {
  captionStoryPrefs.set({ on });
  try {
    browserStorage()?.setItem(CAPTION_STORY_KEY, on ? "1" : "0");
  } catch {
    // Storage refused: the choice still holds for this visit.
  }
}
