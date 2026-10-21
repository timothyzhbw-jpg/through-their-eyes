// Every synthesized effect is deterministic, the requested length, and peaks at -1 dBFS.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SFX_DEFAULT_DUR, SFX_NAMES, conflictingSfx, synthesize } from "../lib/sfx.mjs";

const SR = 48000;

function peakOf(clip) {
  let peak = 0;
  for (let i = 0; i < clip.left.length; i++) {
    peak = Math.max(peak, Math.abs(clip.left[i]), Math.abs(clip.right[i]));
  }
  return peak;
}

function sameSamples(a, b) {
  assert.equal(a.left.length, b.left.length);
  assert.equal(a.right.length, b.right.length);
  for (let i = 0; i < a.left.length; i++) {
    if (a.left[i] !== b.left[i] || a.right[i] !== b.right[i]) {
      assert.fail(`sample ${i} differs`);
    }
  }
}

test("every effect is deterministic, the right length, and peaks near -1 dBFS", () => {
  for (const name of SFX_NAMES) {
    const dur = SFX_DEFAULT_DUR[name];
    const first = synthesize(name);
    const second = synthesize(name);
    sameSamples(first, second);
    const frames = Math.round(dur * SR);
    assert.equal(first.left.length, frames, name);
    assert.equal(first.right.length, frames, name);
    assert.equal(first.sampleRate, SR, name);
    assert.ok(Math.abs(first.duration - dur) <= 0.5 / SR, `${name} duration ${first.duration}`);
    const peak = peakOf(first);
    assert.ok(peak > 0.1, `${name} is silent`);
    const db = 20 * Math.log10(peak);
    assert.ok(Math.abs(db + 1) <= 0.1, `${name} peaks at ${db.toFixed(3)} dBFS`);
  }
});

test("an unknown effect is rejected", () => {
  assert.throws(() => synthesize("explosion"), /unknown sfx "explosion"/);
});

test("the same effect at two lengths is an error", () => {
  assert.equal(
    conflictingSfx([
      { sfx: [{ name: "whoosh", dur: 0.6 }] },
      { sfx: [{ name: "whoosh", dur: 1.2 }] },
    ]),
    'sfx "whoosh" is used at 0.6s and 1.2s',
  );
  assert.equal(
    conflictingSfx([{ sfx: [{ name: "whoosh" }] }, { sfx: [{ name: "boom", dur: 2.5 }] }]),
    null,
  );
});
