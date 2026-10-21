// WAV header round trip: 24-bit stereo for effects, 16-bit mono for a silent voice-over.
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWav16Mono, encodeWav24, readWav, trimSilence, wavDuration } from "../lib/wav.mjs";

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

test("trimSilence keeps the speech and a little air, and drops the edges", () => {
  const sr = 24000;
  const x = new Float64Array(sr * 2); // 2 s: silence, 0.5 s of tone from 0.25 s, silence
  for (let i = Math.round(0.25 * sr); i < Math.round(0.75 * sr); i++) x[i] = 0.5 * Math.sin(i / 5);
  const [trimmed] = trimSilence({ samples: [x], sampleRate: sr }, { pad: 0.04 });
  const seconds = trimmed.length / sr;
  assert.ok(seconds > 0.5 && seconds < 0.62, `${seconds}`);
  const [none] = trimSilence({ samples: [new Float64Array(sr)], sampleRate: sr });
  assert.equal(none.length, 0);
});
