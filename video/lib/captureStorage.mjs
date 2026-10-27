export const CAPTION_STORY_OFF = Object.freeze({ "tte.captionStory.v1": "0" });

export function installInitStorage(context, storage) {
  return context.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, storage);
}
