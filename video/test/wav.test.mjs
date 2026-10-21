// WAV header round trip: 24-bit stereo for effects, 16-bit mono for a silent voice-over.
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWav16Mono, encodeWav24, readWav, wavDuration } from "../lib/wav.mjs";

function close(actual, expected, bits) {
  const full = bits === 16 ? 32767 : 8388607;
  assert.ok(Math.abs(actual - expected) <= 1 / full, `${actual} vs ${expected}`);
}

test("24-bit stereo survives a write and a read", () => {
  const left = new Float64Array([0, 0.5, -0.5, 1, -1]);
  const right = new Float64Array([0.25, -0.25, 0.1, -0.8, 0.3]);
  const buf = encodeWav24(left, right, 48000);
  const wav = readWav(buf);
  assert.equal(wav.format, 1);
  assert.equal(wav.channels, 2);
  assert.equal(wav.bits, 24);
  assert.equal(wav.sampleRate, 48000);
  assert.equal(wav.frames, 5);
  assert.equal(wav.duration, 5 / 48000);
  assert.equal(wavDuration(buf), wav.duration);
  for (let i = 0; i < left.length; i++) {
    close(wav.samples[0][i], left[i], 24);
    close(wav.samples[1][i], right[i], 24);
  }
});

test("16-bit mono survives a write and a read", () => {
  const samples = new Float64Array([0, 0.5, -1, 1]);
  const buf = encodeWav16Mono(samples, 24000);
  const wav = readWav(buf);
  assert.equal(wav.channels, 1);
  assert.equal(wav.bits, 16);
  assert.equal(wav.sampleRate, 24000);
  assert.equal(wav.frames, 4);
  assert.equal(wav.duration, 4 / 24000);
  for (let i = 0; i < samples.length; i++) close(wav.samples[0][i], samples[i], 16);
});

test("a buffer that is not a WAV is rejected", () => {
  assert.throws(() => readWav(Buffer.from("not a wav file at all!!")), /not a WAV file/);
});
