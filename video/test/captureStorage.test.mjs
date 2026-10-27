import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CAPTION_STORY_OFF, installInitStorage } from "../lib/captureStorage.mjs";

test("capture storage is installed before page load", async () => {
  let init;
  const context = {
    async addInitScript(fn, arg) {
      init = { fn, arg };
    },
  };
  await installInitStorage(context, CAPTION_STORY_OFF);
  const values = new Map();
  globalThis.localStorage = { setItem: (key, value) => values.set(key, value) };
  try {
    init.fn(init.arg);
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(values.get("tte.captionStory.v1"), "0");
});

test("every live shot hides The story so far", () => {
  const doc = JSON.parse(readFileSync(new URL("../shots.json", import.meta.url), "utf8"));
  for (const shot of doc.shots) {
    if (shot.status === "ready" || shot.status === "stand-in") {
      assert.equal(shot.storage?.["tte.captionStory.v1"], "0", shot.id);
    }
  }
});
