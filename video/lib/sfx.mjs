// Trailer sound effects, synthesized in plain JS (SPEC 10). 48 kHz stereo float, written as
// 24-bit PCM, deterministic: a mulberry32 stream keyed by the effect's name. Peak-normalised
// to -1 dBFS so a hit is loud and none of them clip.
//
// Each generator is a function of `dur` seconds (the default is in SFX_DEFAULT_DUR). The
// recipes are the ones in the trailer brief: heartbeat, hum, whoosh, riser, boom, stamp,
// slam, whistle, tick, rewind, glitch, shutter, sting.

import { writeFileSync } from "node:fs";
import { encodeWav24 } from "./wav.mjs";

const SR = 48000;
const PEAK = 10 ** (-1 / 20); // -1 dBFS

/** @type {Record<string, number>} */
export const SFX_DEFAULT_DUR = {
  heartbeat: 3,
  hum: 12,
  whoosh: 0.6,
  riser: 3,
  boom: 2.5,
  stamp: 0.5,
  slam: 1.2,
  whistle: 1.3,
  tick: 0.08,
  rewind: 1.2,
  glitch: 0.4,
  shutter: 0.12,
  sting: 3,
};

export const SFX_NAMES = Object.keys(SFX_DEFAULT_DUR);

/**
 * One WAV per effect name. Two beats that ask for different lengths cannot share that file.
 * @param {Array<{ sfx?: Array<{ name?: string, dur?: number }> }>} beats
 * @returns {string | null}
 */
export function conflictingSfx(beats) {
  const wanted = new Map();
  for (const beat of beats ?? []) {
    for (const effect of beat.sfx ?? []) {
      const dur = effect.dur ?? SFX_DEFAULT_DUR[effect.name];
      const prev = wanted.get(effect.name);
      if (prev != null && Math.abs(prev - dur) > 1e-6) {
        return `sfx "${effect.name}" is used at ${prev}s and ${dur}s`;
      }
      wanted.set(effect.name, dur);
    }
  }
  return null;
}

/** @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {string} name */
function hashName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @param {string} type @param {number} freq @param {number} q @param {number} [gainDb] */
function biquad(type, freq, q, gainDb = 0) {
  const w0 = (2 * Math.PI * freq) / SR;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;
  if (type === "lp") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "hp") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "bp") {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "peak") {
    const A = 10 ** (gainDb / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** @param {Float64Array} x @param {{ b0: number, b1: number, b2: number, a1: number, a2: number }} c */
function applyBiquad(x, c) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const yn = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = yn;
    y[i] = yn;
  }
  return y;
}

/** Paul Kellet's economy pink filter. */
function pink(rng, n) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return y;
}

/** @param {() => number} rng @param {number} n */
function white(rng, n) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = rng() * 2 - 1;
  return y;
}

/** @param {Float64Array} buf @param {number} n */
function zeros(n) {
  return new Float64Array(n);
}

/**
 * A sine whose frequency moves from f0 to f1 over `sweep` seconds, then holds, with an
 * exponential decay of time constant `tau`.
 * @param {Float64Array} buf
 */
function addSweep(buf, f0, f1, sweep, tau, amp, phase0 = 0) {
  let phase = phase0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const f = t < sweep ? f0 + (f1 - f0) * (t / sweep) : f1;
    buf[i] += amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * phase);
    phase += f / SR;
    if (phase >= 1) phase -= Math.floor(phase);
  }
}

/** @param {Float64Array} buf @param {number} drive */
function tanhSat(buf, drive) {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(drive * buf[i]);
}

/** @param {Float64Array} left @param {Float64Array} right */
function peakNormalize(left, right) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) {
      throw new Error(`sfx produced a non-finite sample at ${i}`);
    }
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak < 1e-12) return;
  const gain = PEAK / peak;
  for (let i = 0; i < left.length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
}

/** @param {Float64Array} mono @returns {{ left: Float64Array, right: Float64Array }} */
function stereoMono(mono) {
  return { left: mono, right: new Float64Array(mono) };
}

/** @type {Record<string, (n: number, dur: number, rng: () => number) => { left: Float64Array, right: Float64Array }>} */
const GENERATORS = {
  heartbeat(n, dur, rng) {
    const buf = zeros(n);
    const period = 60 / 64;
    const beats = Math.ceil(dur / period) + 1;
    for (let k = 0; k < beats; k++) {
      const t0 = k * period;
      addThump(buf, t0, 58, 44, 0.09, 1);
      addThump(buf, t0 + 0.18, 66, 50, 0.07, 0.62);
      addNoiseClick(buf, t0, rng, 0.012, 180, 0.9);
      addNoiseClick(buf, t0 + 0.18, rng, 0.01, 160, 0.45);
    }
    tanhSat(buf, 1.6);
    return stereoMono(buf);
  },
  hum(n, dur, rng) {
    const rngR = mulberry32((hashName("hum") ^ 0x9e3779b9) >>> 0);
    const left = applyBiquad(applyBiquad(pink(rng, n), biquad("lp", 900, 0.707)), biquad("peak", 300, 1, 4.5));
    const dryRight = applyBiquad(
      applyBiquad(pink(rngR, n), biquad("lp", 900, 0.707)),
      biquad("peak", 300, 1, 4.5),
    );
    const right = new Float64Array(n);
    const drone = 10 ** (-24 / 20);
    const fade = Math.min(SR, Math.floor(n / 2));
    let phase48 = 0;
    let phase72 = 0;
    let swell = 0;
    let target = 0;
    let next = 0;
    let phaseR = 0.2;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i >= next) {
        target = (rng() * 2 - 1) * 2;
        const hz = 0.15 + rng() * 0.15;
        next = i + Math.max(1, Math.round(SR / hz / 2));
      }
      swell += (target - swell) * 0.00015;
      const envDb = Math.max(-2, Math.min(2, swell));
      const g = 10 ** (envDb / 20);
      const tone = drone * (Math.sin(2 * Math.PI * phase48) + Math.sin(2 * Math.PI * phase72));
      phase48 += 48 / SR;
      phase72 += 72 / SR;
      let edge = 1;
      if (i < fade) edge = i / fade;
      else if (i > n - fade) edge = (n - i) / fade;
      // A few milliseconds of delay on the right keeps the two sides from collapsing to mono.
      const rIndex = i - 17;
      const r = rIndex >= 0 ? dryRight[rIndex] : dryRight[0];
      left[i] = (left[i] + tone) * g * edge;
      right[i] = (r * (0.92 + 0.08 * Math.sin(phaseR)) + tone) * g * edge;
      phaseR += 0.15 / SR;
    }
    return { left, right };
  },
  whoosh(n, dur, rng) {
    const noise = white(rng, n);
    const left = zeros(n);
    const right = zeros(n);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let c = biquad("bp", 300, 1.2);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      if (i % 16 === 0) {
        const centre = p < 0.6 ? 300 + (3000 - 300) * (p / 0.6) : 3000 + (800 - 3000) * ((p - 0.6) / 0.4);
        c = biquad("bp", centre, 1.2);
      }
      const yn = c.b0 * noise[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = noise[i];
      y2 = y1;
      y1 = yn;
      const amp = p < 0.6 ? Math.sin((p / 0.6) * Math.PI * 0.5) : Math.exp(-(((p - 0.6) / 0.4) ** 2) * 8);
      const l = Math.cos(p * Math.PI * 0.5);
      const r = Math.sin(p * Math.PI * 0.5);
      left[i] = yn * amp * l;
      right[i] = yn * amp * r;
    }
    return { left, right };
  },
  riser(n, dur, rng) {
    const buf = zeros(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const p = i / Math.max(1, n - 1);
      const f = 200 + (2000 - 200) * p;
      const saw = 2 * (phase - Math.floor(phase + 0.5));
      const amp = Math.exp(4 * p) / Math.exp(4);
      buf[i] = amp * (0.65 * saw + 0.35 * (rng() * 2 - 1));
      phase += f / SR;
      if (phase >= 1) phase -= Math.floor(phase);
    }
    return stereoMono(buf);
  },
  boom(n, dur, rng) {
    const buf = zeros(n);
    addSweep(buf, 90, 45, 0.4, 0.45, 1);
    const burstN = Math.round(0.03 * SR);
    const burst = white(rng, burstN);
    const shaped = applyBiquad(burst, biquad("lp", 3000, 0.707));
    for (let i = 0; i < shaped.length && i < n; i++) {
      const env = 1 - i / shaped.length;
      buf[i] += shaped[i] * env * 0.85;
    }
    tanhSat(buf, 1.8);
    return stereoMono(buf);
  },
  stamp(n, dur, rng) {
    const buf = zeros(n);
    addSweep(buf, 120, 60, 0.08, 0.05, 1);
    const clickN = Math.max(1, Math.round(0.005 * SR));
    const click = applyBiquad(white(rng, clickN), biquad("hp", 2500, 0.707));
    for (let i = 0; i < click.length && i < n; i++) buf[i] += click[i] * (1 - i / click.length);
    const paperN = Math.min(n, Math.round(0.04 * SR));
    const paper = applyBiquad(white(rng, paperN), biquad("bp", 2000, 1.4));
    for (let i = 0; i < paper.length; i++) buf[i] += paper[i] * Math.exp(-i / (0.012 * SR)) * 0.7;
    return stereoMono(buf);
  },
  slam(n, dur, rng) {
    const buf = zeros(n);
    addSweep(buf, 110, 48, 0.22, 0.22, 1);
    addSweep(buf, 180, 180, 0, 0.13, 0.55);
    addSweep(buf, 437, 437, 0, 0.13, 0.4);
    const burstN = Math.min(n, Math.round(0.02 * SR));
    const burst = applyBiquad(white(rng, burstN), biquad("lp", 3000, 0.707));
    for (let i = 0; i < burst.length; i++) buf[i] += burst[i] * (1 - i / burst.length);
    tanhSat(buf, 3.2);
    return stereoMono(buf);
  },
  whistle(n, dur, rng) {
    const buf = zeros(n);
    const breath = applyBiquad(white(rng, n), biquad("hp", 1800, 0.707));
    const segments = [
      { start: 0, len: 0.25 },
      { start: 0.4, len: 0.8 },
    ];
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = 2900 + 150 * Math.sin(2 * Math.PI * 30 * t);
      let env = 0;
      for (const seg of segments) {
        const u = t - seg.start;
        if (u >= 0 && u < seg.len) {
          const a = Math.min(1, u / 0.015);
          const rel = Math.min(1, (seg.len - u) / 0.03);
          env = Math.max(env, a * rel);
        }
      }
      buf[i] = env * (Math.sin(2 * Math.PI * phase) + breath[i] * 0.08);
      phase += f / SR;
      if (phase >= 1) phase -= Math.floor(phase);
    }
    return stereoMono(buf);
  },
  tick(n) {
    const buf = zeros(n);
    addSweep(buf, 1500, 1500, 0, 0.012, 1);
    return stereoMono(buf);
  },
  rewind(n, dur, rng) {
    const noise = applyBiquad(
      applyBiquad(white(rng, n), biquad("hp", 400, 0.707)),
      biquad("lp", 3200, 0.707),
    );
    const buf = zeros(n);
    let phase = 0;
    const stop = dur - 0.16;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let f = 280 + 1600 * (t / dur) + 380 * Math.sin(2 * Math.PI * 11 * t);
      if (t > stop) {
        const q = (t - stop) / 0.16;
        f = f * (1 - q) + 70 * q;
      }
      const saw = 2 * (phase - Math.floor(phase + 0.5));
      buf[i] = 0.55 * saw + 0.45 * noise[i];
      phase += f / SR;
      if (phase >= 1) phase -= Math.floor(phase);
    }
    return stereoMono(buf);
  },
  glitch(n, dur, rng) {
    const buf = zeros(n);
    let i = 0;
    while (i < n) {
      const gap = Math.round((0.012 + rng() * 0.04) * SR);
      i += gap;
      if (i >= n) break;
      const len = Math.min(n - i, Math.round((0.01 + rng() * 0.03) * SR));
      const square = rng() < 0.5;
      const freq = 120 + rng() * 1600;
      const steps = 2 ** (3 + Math.floor(rng() * 4));
      let phase = rng();
      for (let k = 0; k < len; k++) {
        let s;
        if (square) {
          phase += freq / SR;
          s = phase % 1 < 0.5 ? 0.8 : -0.8;
        } else {
          s = rng() * 2 - 1;
        }
        buf[i + k] = Math.round(s * steps) / steps;
      }
      i += len;
    }
    return stereoMono(buf);
  },
  shutter(n, dur, rng) {
    const buf = zeros(n);
    const clickN = Math.min(n, Math.max(1, Math.round(0.003 * SR)));
    for (let i = 0; i < clickN; i++) {
      const env = 1 - i / clickN;
      buf[i] += env * Math.sin(2 * Math.PI * 3200 * (i / SR));
    }
    const burstN = Math.min(n, Math.round(0.05 * SR));
    const burst = applyBiquad(white(rng, burstN), biquad("hp", 1200, 0.707));
    for (let i = 0; i < burstN; i++) buf[i] += burst[i] * Math.exp(-i / (0.01 * SR)) * 0.8;
    return stereoMono(buf);
  },
  sting(n, dur, rng) {
    const riseN = Math.min(n, Math.round(1.2 * SR));
    const rest = Math.max(1, n - riseN);
    const rise = GENERATORS.riser(riseN, riseN / SR, rng);
    const hit = GENERATORS.boom(rest, rest / SR, rng);
    const left = zeros(n);
    const right = zeros(n);
    for (let i = 0; i < riseN; i++) {
      left[i] = rise.left[i];
      right[i] = rise.right[i];
    }
    for (let i = 0; i < rest && riseN + i < n; i++) {
      left[riseN + i] += hit.left[i];
      right[riseN + i] += hit.right[i];
    }
    return { left, right };
  },
};

/**
 * A short swept thump placed at `t0` seconds. Used by the heartbeat.
 * @param {Float64Array} buf
 */
function addThump(buf, t0, f0, f1, len, amp) {
  const start = Math.round(t0 * SR);
  const count = Math.round(len * SR);
  if (start >= buf.length || count <= 0) return;
  let phase = 0;
  for (let i = 0; i < count && start + i < buf.length; i++) {
    const p = i / count;
    const f = f0 + (f1 - f0) * p;
    const env = Math.exp(-i / (count / 3));
    buf[start + i] += amp * env * Math.sin(2 * Math.PI * phase);
    phase += f / SR;
  }
}

/**
 * A low-passed noise click at `t0`.
 * @param {Float64Array} buf
 * @param {() => number} rng
 */
function addNoiseClick(buf, t0, rng, len, cutoff, amp) {
  const start = Math.round(t0 * SR);
  const count = Math.round(len * SR);
  if (start >= buf.length || count <= 0) return;
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  let lp = 0;
  for (let i = 0; i < count && start + i < buf.length; i++) {
    lp += a * (rng() * 2 - 1 - lp);
    buf[start + i] += lp * Math.exp(-i / (0.003 * SR)) * amp;
  }
}

/**
 * Synthesize one effect. `dur` defaults to the recipe's length.
 * @param {string} name
 * @param {number} [dur]
 * @returns {{ left: Float64Array, right: Float64Array, sampleRate: number, duration: number }}
 */
export function synthesize(name, dur = SFX_DEFAULT_DUR[name]) {
  const make = GENERATORS[name];
  if (!make) throw new Error(`unknown sfx "${name}"`);
  if (!(dur > 0) || !Number.isFinite(dur)) throw new Error(`sfx "${name}": duration must be positive`);
  const n = Math.max(1, Math.round(dur * SR));
  const { left, right } = make(n, n / SR, mulberry32(hashName(name)));
  if (left.length !== n || right.length !== n) {
    throw new Error(`sfx "${name}" returned ${left.length} samples, wanted ${n}`);
  }
  peakNormalize(left, right);
  return { left, right, sampleRate: SR, duration: n / SR };
}

/**
 * Write `name` to a 24-bit stereo WAV.
 * @param {string} name
 * @param {number | undefined} dur
 * @param {string} file
 */
export function writeSfx(name, dur, file) {
  const clip = synthesize(name, dur);
  writeFileSync(file, encodeWav24(clip.left, clip.right, clip.sampleRate));
  return clip;
}
