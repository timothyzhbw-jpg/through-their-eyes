// Render-only body separation (separate.ts): nobody closer than the gap unless a crowd and the cap
// stop it, no offset where there is room, never past the cap, no pops between 25 Hz frames,
// deterministic, and on real frames: the press-escape what-if runs (frames with bodies under
// the gap, two nearly on one spot) and the seed-3 hero moment (nobody close).

import { describe, expect, it } from "vitest";
import heroRaw from "../../public/data/hero_seed3.json";
import pressRaw from "../../public/data/whatif_press_escape_seed0.json";
import { Sample, parseHero, sampleInto } from "../data/hero";
import {
  CARRY_WINDOW,
  MAX_OFFSET,
  MIN_GAP,
  Separation,
  carrierWeights,
  positionsAt,
  separateInto,
  sharedSeparation,
} from "./separate";

const TOL = 0.01; // m, the relaxation's residual
const BOUND = 0.25; // m per 25 Hz frame, the most an offset may change

function offsets(pos: number[], carry: number[] | null = null): Float32Array {
  const n = pos.length / 2;
  return separateInto(new Float32Array(2 * n), pos, n, carry);
}

function gap(pos: ArrayLike<number>, off: ArrayLike<number>, i: number, j: number): number {
  return Math.hypot(
    pos[2 * i] + off[2 * i] - pos[2 * j] - off[2 * j],
    pos[2 * i + 1] + off[2 * i + 1] - pos[2 * j + 1] - off[2 * j + 1],
  );
}

function minGap(pos: ArrayLike<number>, off: ArrayLike<number> | null, n: number): number {
  let m = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) m = Math.min(m, gap(pos, off ?? new Float32Array(2 * n), i, j));
  return m;
}

const maxOffset = (off: ArrayLike<number>, n: number) =>
  Math.max(...Array.from({ length: n }, (_, j) => Math.hypot(off[2 * j], off[2 * j + 1])));

describe("separateInto", () => {
  it("gives no offset when nobody is close", () => {
    const pos = [0, 0, MIN_GAP + 0.01, 0, 10, 10, -20, 5];
    expect(Array.from(offsets(pos))).toEqual(new Array(8).fill(0));
    // exactly at the gap is not close
    expect(Array.from(offsets([0, 0, MIN_GAP, 0]))).toEqual([0, 0, 0, 0]);
  });

  it("pushes a pair apart along their line, symmetrically", () => {
    const pos = [0, 0, 0.3, 0.4]; // 0.5 m apart, along (0.6, 0.8)
    const off = offsets(pos);
    expect(gap(pos, off, 0, 1)).toBeCloseTo(MIN_GAP, 3);
    expect(off[0]).toBeCloseTo(-off[2], 6);
    expect(off[1]).toBeCloseTo(-off[3], 6);
    expect(off[2] / off[3]).toBeCloseTo(0.75, 3); // along the line
    expect(off[2]).toBeGreaterThan(0);
    expect(Math.hypot(off[2], off[3])).toBeCloseTo((MIN_GAP - 0.5) / 2, 3);
  });

  it("moves the ball carrier less, and the pair still ends at the gap", () => {
    const pos = [0, 0, 0.3, 0];
    const free = offsets(pos);
    const held = offsets(pos, [1, 0]);
    expect(gap(pos, held, 0, 1)).toBeCloseTo(MIN_GAP, 3);
    expect(Math.abs(held[0])).toBeLessThan(Math.abs(free[0]) * 0.6);
    expect(Math.abs(held[2])).toBeGreaterThan(Math.abs(free[2]));
  });

  it("keeps every pair at the gap when no more than two meet, whatever the carrier", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    for (let trial = 0; trial < 200; trial++) {
      // pairs: each 0..0.6 m apart, pairs far from each other
      const pos: number[] = [];
      const carry: number[] = [];
      for (let p = 0; p < 5; p++) {
        const a = rnd() * Math.PI;
        const d = Math.abs(rnd()) * MIN_GAP;
        pos.push(p * 20, 0, p * 20 + d * Math.cos(a), d * Math.sin(a));
        carry.push(p === 0 ? Math.abs(rnd()) : 0, 0);
      }
      const off = offsets(pos, carry);
      expect(minGap(pos, off, 10)).toBeGreaterThan(MIN_GAP - TOL);
      expect(maxOffset(off, 10)).toBeLessThanOrEqual(MAX_OFFSET + 1e-6);
    }
  });

  it("separates two bodies on one spot", () => {
    const pos = [5, 5, 5, 5];
    const off = offsets(pos);
    expect(gap(pos, off, 0, 1)).toBeGreaterThan(MIN_GAP - TOL);
  });

  it("never passes the cap, and in a crowd the gaps still grow", () => {
    // seven bodies inside 0.3 m of one spot: the cap stops the gaps short of MIN_GAP
    const pos: number[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * 2 * Math.PI;
      pos.push(0.1 * Math.cos(a), 0.1 * Math.sin(a));
    }
    const off = offsets(pos);
    expect(maxOffset(off, 7)).toBeLessThanOrEqual(MAX_OFFSET + 1e-6);
    const before = minGap(pos, null, 7);
    const after = minGap(pos, off, 7);
    expect(after).toBeGreaterThan(before + 0.1);
    // a lone neighbour of three: the gap grows, to the full gap where the cap allows
    const three = [0, 0, 0.1, 0, 0.05, 0.1];
    const o3 = offsets(three);
    expect(minGap(three, o3, 3)).toBeGreaterThan(minGap(three, null, 3));
    expect(maxOffset(o3, 3)).toBeLessThanOrEqual(MAX_OFFSET + 1e-6);
  });

  it("is deterministic", () => {
    const pos = [0, 0, 0.2, 0.1, 0.5, 0.3, 3, 3, 3.2, 3.1];
    const a = Array.from(offsets(pos, [0, 0, 1, 0, 0]));
    const b = Array.from(offsets(pos, [0, 0, 1, 0, 0]));
    expect(a).toEqual(b);
    // and does not depend on what the buffer held
    const dirty = new Float32Array(10).fill(9);
    expect(Array.from(separateInto(dirty, pos, 5, [0, 0, 1, 0, 0]))).toEqual(a);
  });

  it("does not pop as two bodies pass each other, even through one another", () => {
    // B runs at A at 8 m/s each way (0.64 m per 25 Hz frame between them), a hand's breadth to the side
    let worst = 0;
    let prev: Float32Array | null = null;
    for (let f = -20; f <= 20; f++) {
      const pos = [f * 0.32, 0, -f * 0.32, 0.15];
      const off = offsets(pos);
      if (prev) for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(off[k] - prev[k]));
      prev = off;
    }
    // two cap-widths would be a pop; a pass at running speed moves an offset by about its cap
    expect(worst).toBeLessThan(2 * MAX_OFFSET);
  });
});

describe("carrierWeights", () => {
  const owner = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1];
  const w = (f: number) => Array.from(carrierWeights(owner, owner.length, f, new Float32Array(2)));

  it("is the holder's alone away from a change, and sums to at most one", () => {
    expect(w(3)[0]).toBeCloseTo(1, 6);
    expect(w(14)[1]).toBeCloseTo(1, 6);
    for (let f = 0; f <= 23; f += 0.25) expect(w(f)[0] + w(f)[1]).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("eases over a change of owner: bounded steps between frames", () => {
    let worst = 0;
    for (let f = 0; f < 23; f += 0.1) {
      const a = w(f);
      const b = w(f + 0.1);
      worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    }
    expect(worst).toBeLessThan(0.1);
    expect(CARRY_WINDOW).toBeGreaterThan(1);
  });
});

/** One run of the press-escape what-if export (mm, 22 players) as per-frame metres; the export
 * has no owner column, so the holder is whoever is within 1.5 m of the ball, nearest first. */
function pressRuns() {
  return pressRaw.options
    .flatMap((o) => (o.pos && o.ball ? [{ id: o.id, pos: o.pos, ball: o.ball }] : []))
    .map((o) => {
      const frames = o.pos.length;
      const n = o.pos[0].length / 2;
      const pos = new Float32Array(frames * 2 * n);
      const owner = new Int16Array(frames).fill(-1);
      o.pos.forEach((row, f) => {
        let best = 1.5;
        for (let j = 0; j < 2 * n; j++) pos[f * 2 * n + j] = row[j] / 1000;
        for (let j = 0; j < n; j++) {
          const d = Math.hypot(row[2 * j] - o.ball[f][0], row[2 * j + 1] - o.ball[f][1]) / 1000;
          if (d < best) [best, owner[f]] = [d, j];
        }
      });
      return { id: o.id, frames, n, pos, owner };
    });
}

type PressRun = ReturnType<typeof pressRuns>[number];

describe("on real frames", () => {
  const runs = pressRuns();
  const n = runs[0].n;
  const sep = new Separation(n);
  const pos = (r: PressRun, f: number) => r.pos.subarray(f * 2 * n, (f + 1) * 2 * n);
  const update = (r: PressRun, f: number) => sep.update(r, f);
  const tight = runs.flatMap((r) =>
    Array.from({ length: r.frames }, (_, f) => ({ r, f, d: minGap(pos(r, f), null, n) })).filter(
      ({ d }) => d < MIN_GAP,
    ),
  );

  it("includes press frames with bodies too close (what the fix is for)", () => {
    expect(tight.length).toBeGreaterThan(100);
    expect(Math.min(...tight.map((t) => t.d))).toBeLessThan(0.05);
  });

  it("opens the tight frames to the gap, within the cap, and never closes one", () => {
    let held = 0;
    for (const { r, f, d } of tight) {
      update(r, f);
      expect(maxOffset(sep.off, n)).toBeLessThanOrEqual(MAX_OFFSET + 1e-6);
      const after = minGap(pos(r, f), sep.off, n);
      expect(after).toBeGreaterThan(d);
      if (after > MIN_GAP - TOL) held++;
    }
    // Three or more crowded together may stay a little short; the rest are fully open.
    expect(held / tight.length).toBeGreaterThan(0.9);
  });

  it("reads the positions the pose is sampled at, at fractional frames, comfort mode or not", () => {
    const hero = parseHero(heroRaw);
    const run = hero.runs.factual;
    const sample = new Sample(hero.n);
    const out = new Float32Array(2 * hero.n);
    for (const eased of [false, true])
      for (const f of [0, 0.37, 12.5, run.frames - 1.25, run.frames + 3]) {
        sampleInto(sample, hero, run, f, eased);
        expect(Array.from(positionsAt(run, hero.n, f, out))).toEqual(Array.from(sample.pos));
      }
  });

  it("solves a frame once for every view that asks, and again for the next", () => {
    const hero = parseHero(heroRaw);
    const run = hero.runs.factual;
    const shared = sharedSeparation(hero, hero.n);
    expect(sharedSeparation(hero, hero.n)).toBe(shared);
    const fresh = new Separation(hero.n);
    for (const f of [3, 3, 40.5, 3]) {
      expect(Array.from(shared.update(run, f).off)).toEqual(Array.from(fresh.update(run, f).off));
    }
  });

  it("gives no offset where nobody is close, on the press and on seed 3", () => {
    for (const r of runs)
      for (let f = 0; f < r.frames; f++) {
        if (minGap(pos(r, f), null, n) < MIN_GAP) continue;
        update(r, f);
        expect(Array.from(sep.off).every((v) => v === 0)).toBe(true);
        expect(sep.ball).toEqual([0, 0]);
      }
    const hero = parseHero(heroRaw);
    const run = hero.runs.factual;
    const sep3 = new Separation(hero.n);
    for (let f = 0; f < run.frames; f++) {
      sep3.update(run, f);
      expect(Array.from(sep3.off).every((v) => v === 0)).toBe(true);
    }
  });

  it("changes by a bounded step between consecutive frames", () => {
    let worst = 0;
    let where = "";
    for (const r of runs) {
      const prev = new Float32Array(2 * n);
      for (let f = 0; f < r.frames; f++) {
        update(r, f);
        if (f > 0)
          for (let k = 0; k < 2 * n; k++) {
            const step = Math.abs(sep.off[k] - prev[k]);
            if (step > worst) [worst, where] = [step, `${r.id} frame ${f}`];
          }
        prev.set(sep.off);
      }
    }
    expect(worst, `worst step at ${where}`).toBeLessThan(BOUND);
  });

  it("is the same for the same frame, whatever was played before", () => {
    const { r, f } = tight[tight.length >> 1];
    const first = Array.from(update(r, f).off);
    const ball = [...sep.ball];
    update(r, Math.max(0, f - 20));
    update(r, 0);
    expect(Array.from(update(r, f).off)).toEqual(first);
    expect(sep.ball).toEqual(ball);
  });
});
