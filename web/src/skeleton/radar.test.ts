// The scan radar (SPEC 7, radar.ts): a short sector at a scanning player's feet, on exactly the
// frames the scan detector flags (in a stitched match, the sim's own scans), eased in and out over
// about 150 ms of match time, centred on his head yaw and turning with it. With the skeleton on,
// every scanning player; without it, the key scan's player during his key scan.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, Sample, sampleInto, wrapAngle, type Hero, type Run } from "../data/hero";
import { matchExport } from "../testing";
import { COLORS } from "../views/scene";
import {
  RADAR,
  RadarGeometry,
  radarAlpha,
  radarTrack,
  scanSource,
  type RadarScope,
  type RadarVariant,
} from "./radar";
import { Pose, poseInto } from "./skeleton";

const hero = parseHero(raw);
const match = parseHero(structuredClone(matchExport()));
const H8 = hero.ids.indexOf("H8");
const KEY = { start: 50, end: 69 }; // the scan detector's scan of H8 in the factual run (the key scan)
const FADE = RADAR.fadeS / hero.dt; // frames

const on = (h: Hero, run: Run, scope: RadarScope, f: number, j: number) =>
  radarTrack(h, run, scope).on[f * h.n + j] === 1;
const flaggedByDetector = (run: Run, f: number, j: number) =>
  run.detector!.scans[j].some((s) => f >= s.start && f <= s.end);

describe("the radar's frames", () => {
  it("with the skeleton: exactly the frames the scan detector flags, every player", () => {
    for (const run of [hero.runs.factual, hero.runs.counterfactual]) {
      expect(scanSource(run)).toBe("detector");
      for (let j = 0; j < hero.n; j++)
        for (let f = 0; f < run.frames; f++)
          expect(on(hero, run, "every", f, j)).toBe(flaggedByDetector(run, f, j));
    }
  });

  it("without it: the key scan's player only, on the frames the detector flags in his key scan", () => {
    const run = hero.runs.factual;
    for (let j = 0; j < hero.n; j++)
      for (let f = 0; f < run.frames; f++)
        expect(on(hero, run, "key", f, j)).toBe(j === H8 && f >= KEY.start && f <= KEY.end);
    expect(run.scans.find((s) => s.key)).toMatchObject({ player: "H8", start: 50 });
  });

  it("not for H8 without the look: the dropped scan is nowhere in that run", () => {
    const run = hero.runs.counterfactual;
    expect(radarTrack(hero, run, "key").on.every((v) => v === 0)).toBe(true);
    for (let f = KEY.start; f <= KEY.end; f++) expect(on(hero, run, "every", f, H8)).toBe(false);
  });

  it("in a stitched match, with no detector run: the sim's own scans (key scans without it)", () => {
    const run = match.runs.factual;
    expect(scanSource(run)).toBe("sim");
    expect(run.scans.length).toBeGreaterThan(0);
    const scanning = (f: number, j: number, keyOnly: boolean) =>
      run.scans.some(
        (s) =>
          (!keyOnly || s.key) && match.ids.indexOf(s.player) === j && f >= s.start && f <= s.end,
      );
    for (let j = 0; j < match.n; j++)
      for (let f = 0; f < run.frames; f += 3) {
        expect(on(match, run, "every", f, j)).toBe(scanning(f, j, false));
        expect(on(match, run, "key", f, j)).toBe(scanning(f, j, true));
      }
    expect(run.scans.some((s) => s.key)).toBe(true);
  });

  it("the edge's side is the way his head turned off the torso over the scan, one side per scan", () => {
    const run = hero.runs.factual;
    const track = radarTrack(hero, run, "key");
    let twist = 0;
    for (let f = KEY.start; f <= KEY.end; f++)
      twist += wrapAngle(run.head[f * hero.n + H8] - run.body[f * hero.n + H8]);
    for (let f = KEY.start; f <= KEY.end; f++)
      expect(track.side[f * hero.n + H8]).toBe(Math.sign(twist));
  });
});

describe("the radar's strength", () => {
  const alpha = (h: Hero, run: Run, scope: RadarScope, j: number, f: number) =>
    radarAlpha(radarTrack(h, run, scope), h.n, run.frames, j, f, RADAR.fadeS / h.dt);

  it("is above 0 on exactly the flagged frames", () => {
    for (const [h, scope] of [
      [hero, "every"],
      [hero, "key"],
      [match, "every"],
    ] as const) {
      for (const run of Object.values(h.runs))
        for (let j = 0; j < h.n; j++)
          for (let f = 0; f < run.frames; f += h === match ? 3 : 1)
            expect(alpha(h, run, scope, j, f) > 0).toBe(on(h, run, scope, f, j));
    }
  });

  it("eases in from the scan's first frame and out to the end of its last, in about 150 ms", () => {
    const run = hero.runs.factual;
    const at = (f: number) => alpha(hero, run, "key", H8, f);
    expect(at(KEY.start - 0.5)).toBe(0);
    expect(at(KEY.start)).toBeGreaterThan(0);
    expect(at(KEY.start)).toBeLessThan(0.25);
    expect(at(KEY.start + Math.ceil(FADE) - 1)).toBe(1); // full within 150 ms
    expect(at(KEY.end - Math.ceil(FADE) + 1)).toBe(1);
    expect(at(KEY.end)).toBeLessThan(0.25);
    expect(at(KEY.end + 0.99)).toBeLessThan(0.01);
    expect(at(KEY.end + 1)).toBe(0);
    // Smooth in between: no step over 0.2 in a 20th of a frame, but the first frame's.
    let last = at(KEY.start);
    for (let f = KEY.start; f <= KEY.end + 1; f += 0.05) {
      const a = at(f);
      expect(Math.abs(a - last)).toBeLessThan(0.2);
      last = a;
    }
  });

  it("flash guard: on and off at most three times in any second, for every player (WCAG 2.3.1)", () => {
    const second = (h: Hero) => Math.round(1 / h.dt);
    for (const [h, scope] of [
      [hero, "every"],
      [hero, "key"],
      [match, "every"],
      [match, "key"],
    ] as const) {
      for (const run of Object.values(h.runs)) {
        const track = radarTrack(h, run, scope);
        for (let j = 0; j < h.n; j++) {
          const starts: number[] = [];
          for (let f = 0; f < run.frames; f++)
            if (track.on[f * h.n + j] && (f === 0 || !track.on[(f - 1) * h.n + j])) starts.push(f);
          for (let i = 0; i + 3 < starts.length; i++)
            expect(starts[i + 3] - starts[i]).toBeGreaterThanOrEqual(second(h));
        }
      }
    }
  });
});

describe("the radar drawn", () => {
  function drawn(variant: RadarVariant, frame: number, scope: RadarScope, scale = 1) {
    const run = hero.runs.factual;
    const sample = sampleInto(new Sample(hero.n), hero, run, frame);
    const pose = poseInto(new Pose(hero.n), hero, run, sample, frame, "true");
    const g = new RadarGeometry(hero.n, variant);
    g.update(radarTrack(hero, run, scope), run, hero.dt, frame, sample, pose.yaw, scale, 0.16);
    return { g, sample, pose };
  }
  const perRadar = (g: RadarGeometry) => g.parts.backing + g.parts.fill + g.parts.edge;

  /** The fill's rim of the first radar drawn: [angle, distance] of each rim vertex from (px, py). */
  function rim(g: RadarGeometry, px: number, py: number) {
    const out: [number, number][] = [];
    for (let i = 0; i < g.parts.fill / 3; i++)
      for (const k of [3 * i + 1, 3 * i + 2]) {
        const [x, , z] = g.vertex(g.parts.backing + k);
        out.push([Math.atan2(-z - py, x - px), Math.hypot(x - px, -z - py)]);
      }
    return out;
  }

  it("without the skeleton: H8 alone in his key scan, a 60 degree sector on his head yaw", () => {
    for (const [variant, radius] of [
      ["board", 4.5 * 1.5],
      ["broadcast", 2],
    ] as const) {
      const { g, sample, pose } = drawn(variant, 60, "key", 1.5);
      expect(g.drawn).toBe(perRadar(g));
      expect(g.alpha(H8)).toBe(1);
      expect(g.colorOf(g.parts.backing)).toBe(COLORS.floodlight); // the fill and the edge
      expect(g.colorOf(g.drawn - 1)).toBe(COLORS.floodlight);
      const [px, py] = [sample.pos[2 * H8], sample.pos[2 * H8 + 1]];
      const angles = rim(g, px, py).map(([a, d]) => {
        expect(d).toBeCloseTo(radius, 3); // Float32 positions
        return wrapAngle(a - pose.yaw[H8]);
      });
      expect(Math.max(...angles)).toBeCloseTo(RADAR.half, 3);
      expect(Math.min(...angles)).toBeCloseTo(-RADAR.half, 3);
      const [, y] = g.vertex(0);
      expect(y).toBeCloseTo(variant === "broadcast" ? 0.065 : 0, 6);
    }
    expect(drawn("board", 20, "key").g.drawn).toBe(0); // before the key scan
  });

  it("on the board, on a dark backing a little past its rim, apart from the gold sweep under it", () => {
    const { g, sample } = drawn("board", 60, "key");
    expect(g.parts.backing).toBe(g.parts.fill);
    expect(g.colorOf(0)).toBe("#0a100d");
    const [px, py] = [sample.pos[2 * H8], sample.pos[2 * H8 + 1]];
    const [x, , z] = g.vertex(1);
    expect(Math.hypot(x - px, -z - py)).toBeCloseTo(4.5 + 2 * 0.16, 3); // 2 px past the rim
    expect(drawn("broadcast", 60, "key").g.parts.backing).toBe(0);
  });

  it("turns with his head yaw through the scan", () => {
    for (const frame of [52, 58.5, 64, 68]) {
      const { g, sample, pose } = drawn("board", frame, "key");
      const [px, py] = [sample.pos[2 * H8], sample.pos[2 * H8 + 1]];
      const angles = rim(g, px, py).map(([a]) => wrapAngle(a - pose.yaw[H8]));
      expect((Math.max(...angles) + Math.min(...angles)) / 2).toBeCloseTo(0, 3);
    }
  });

  it("its edge runs from his feet along the side his head turned to", () => {
    const { g, sample, pose } = drawn("board", 60, "key");
    const side = radarTrack(hero, hero.runs.factual, "key").side[60 * hero.n + H8];
    const [px, py] = [sample.pos[2 * H8], sample.pos[2 * H8 + 1]];
    const e = g.parts.backing + g.parts.fill;
    const [x0, , z0] = g.vertex(e);
    const [x1, , z1] = g.vertex(e + 1);
    expect(Math.hypot(x0 - px, -z0 - py)).toBeLessThan(0.2);
    const along = Math.atan2(-z1 + z0, x1 - x0);
    expect(wrapAngle(along - (pose.yaw[H8] + side * RADAR.half))).toBeCloseTo(0, 2);
    expect(g.vertex(e)[3]).toBeCloseTo(RADAR.edge, 6);
  });

  it("with the skeleton: one radar per scanning player", () => {
    const track = radarTrack(hero, hero.runs.factual, "every");
    const scanning = (f: number) => hero.ids.filter((_, j) => track.on[f * hero.n + j]).length;
    expect(scanning(60)).toBeGreaterThan(0);
    for (const f of [0, 20, 60, 100, 140]) {
      for (const variant of ["board", "broadcast"] as const) {
        const { g } = drawn(variant, f, "every");
        expect(g.drawn).toBe(perRadar(g) * scanning(f));
      }
    }
  });
});
