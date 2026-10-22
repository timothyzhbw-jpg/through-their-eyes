// Photosensitivity guard: the WCAG 2.3.1 flash counter.
import assert from "node:assert/strict";
import { test } from "node:test";
import { flashWindows, isSaturatedRed, luminance, measureFlashes, transitions } from "../lib/flashes.mjs";

const fps = 30;
const series = (pattern, frames) => Array.from({ length: frames }, (_, i) => pattern(i));

test("a hard cut between two steady shots is not a flash", () => {
  const values = series((i) => (i < 30 ? 0.05 : 0.6), 60);
  assert.equal(flashWindows(transitions(values), fps).maxPerSecond, 0);
});

test("a white flash frame on a cut is one flash", () => {
  const values = series((i) => (i === 30 || i === 31 ? 0.9 : 0.05), 60);
  const { flashes, maxPerSecond } = flashWindows(transitions(values), fps);
  assert.equal(flashes, 1);
  assert.equal(maxPerSecond, 1);
});

test("a strobe at 5 Hz counts five flashes in a second; small swings and bright swings do not", () => {
  const strobe = series((i) => (Math.floor(i / 3) % 2 ? 0.7 : 0.05), 60);
  assert.ok(flashWindows(transitions(strobe), fps).maxPerSecond >= 4);
  const small = series((i) => (Math.floor(i / 3) % 2 ? 0.12 : 0.05), 60); // under 10 %
  assert.equal(flashWindows(transitions(small), fps).maxPerSecond, 0);
  const bright = series((i) => (Math.floor(i / 3) % 2 ? 1.0 : 0.85), 60); // darker image ≥ 0.8
  assert.equal(flashWindows(transitions(bright), fps).maxPerSecond, 0);
});

test("a slow rise and fall over two seconds is not a flash", () => {
  const values = series((i) => (i < 60 ? 0.05 + i * 0.01 : 0.65 - (i - 60) * 0.01), 120);
  assert.equal(flashWindows(transitions(values), fps).flashes, 0);
});

test("relative luminance and saturated red follow WCAG", () => {
  assert.ok(Math.abs(luminance(255, 255, 255) - 1) < 1e-9);
  assert.equal(luminance(0, 0, 0), 0);
  assert.equal(isSaturatedRed(230, 20, 20), true);
  assert.equal(isSaturatedRed(200, 120, 120), false);
});

test("measureFlashes finds a red flash and a quarter-screen strobe in tiny frames", () => {
  const w = 4;
  const h = 2;
  const frames = 30;
  const raw = Buffer.alloc(w * h * 3 * frames);
  for (let f = 0; f < frames; f++) {
    for (let p = 0; p < w * h; p++) {
      const o = (f * w * h + p) * 3;
      const red = f >= 10 && f < 13; // three red frames, a red flash
      const strobeQuarter = p === 0 && Math.floor(f / 2) % 2 === 1; // top-left strobing
      raw[o] = red ? 230 : strobeQuarter ? 220 : 20;
      raw[o + 1] = red ? 20 : strobeQuarter ? 220 : 20;
      raw[o + 2] = red ? 20 : strobeQuarter ? 220 : 20;
    }
  }
  const m = measureFlashes(raw, { width: w, height: h, fps });
  assert.equal(m.frames, frames);
  assert.ok(m.red.flashes >= 1);
  assert.ok(m.general.maxPerSecond > 3);
});
