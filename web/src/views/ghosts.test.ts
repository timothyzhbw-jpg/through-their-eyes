// Belief ghosts: which show, how strongly, and that none pops on or off (views/ghosts.ts).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, type Hero } from "../data/hero";
import { pressureExport } from "../testing";
import {
  beliefError,
  GHOST_EASE_S,
  GHOST_FROM_M,
  GHOST_FULL_M,
  GHOST_LABEL_S,
  ghostAlpha,
  ghostLabelAlpha,
  ghostWindow,
} from "./ghosts";

const hero = parseHero(raw);
const runs = ["factual", "counterfactual"] as const;

/** Ghosts on show at a frame: player index and strength. */
function shown(h: Hero, name: (typeof runs)[number], frame: number, all: boolean) {
  const out: [number, number][] = [];
  for (let j = 0; j < h.n; j++) {
    const a = ghostAlpha(h, h.runs[name], frame, j, all);
    if (a > 0) out.push([j, a]);
  }
  return out;
}

describe("by default", () => {
  it("runs from the key scan to the decision", () => {
    for (const name of runs) {
      const w = ghostWindow(hero, hero.runs[name])!;
      expect(w.from).toBe(hero.keyScan!.start);
      expect(w.to).toBe(hero.runs[name].decision!.frame);
    }
  });

  it("shows at most one ghost on any frame: the runner's, inside the window", () => {
    for (const name of runs) {
      const run = hero.runs[name];
      const w = ghostWindow(hero, run)!;
      const ease = GHOST_EASE_S / hero.dt;
      for (let f = 0; f < run.frames; f++) {
        const on = shown(hero, name, f, false);
        expect(on.length).toBeLessThanOrEqual(1);
        for (const [j] of on) expect(j).toBe(hero.runner);
        if (f < w.from || f > w.to + ease) expect(on).toEqual([]);
      }
    }
  });

  it("shows the runner at full strength while the hero has him 3 m wrong, without the look", () => {
    const run = hero.runs.counterfactual;
    const w = ghostWindow(hero, run)!;
    const late = w.to - 1;
    expect(beliefError(hero, run, late, hero.runner)).toBeGreaterThan(GHOST_FULL_M);
    expect(ghostAlpha(hero, run, late, hero.runner, false)).toBe(1);
  });

  it("lets the runner go once the key scan has found him, with the look", () => {
    const run = hero.runs.factual;
    const w = ghostWindow(hero, run)!;
    expect(beliefError(hero, run, w.to, hero.runner)).toBeLessThan(GHOST_FROM_M);
    expect(ghostAlpha(hero, run, w.to, hero.runner, false)).toBe(0);
  });

  it("is the 2.4 s before the decision for a hero without a key scan", () => {
    const pressed = parseHero(pressureExport());
    expect(pressed.keyScan).toBeNull();
    const run = pressed.runs.factual;
    const w = ghostWindow(pressed, run);
    if (!w) return; // no runner in this export: no default ghost at all
    expect(w.to - w.from).toBeCloseTo(2.4 / pressed.dt, 6);
  });
});

describe("everyone's, on request", () => {
  it("shows other players his picture has wrong, never the hero himself", () => {
    let most = 0;
    for (const name of runs) {
      const run = hero.runs[name];
      for (let f = 0; f < run.frames; f++) {
        const on = shown(hero, name, f, true);
        most = Math.max(most, on.length);
        for (const [j] of on) expect(j).not.toBe(hero.hero);
      }
    }
    expect(most).toBeGreaterThan(5);
  });

  it("is nothing under 1 m and full from 3 m, held only by the fade", () => {
    const run = hero.runs.factual;
    for (let f = 0; f < run.frames; f++) {
      for (let j = 0; j < hero.n; j++) {
        if (j === hero.hero) continue;
        const a = ghostAlpha(hero, run, f, j, true);
        if (beliefError(hero, run, f, j) >= GHOST_FULL_M) expect(a).toBe(1);
        let recent = 0; // the largest error over the fade's reach
        for (let k = 0; k <= Math.ceil(GHOST_EASE_S / hero.dt); k++) {
          recent = Math.max(recent, beliefError(hero, run, Math.max(0, f - k), j));
        }
        if (recent < GHOST_FROM_M) expect(a).toBe(0);
      }
    }
  });
});

describe("no ghost pops", () => {
  it("fades out no faster than over 0.15 s of match time, and in over at least 0.15 s at the window", () => {
    const step = 0.25; // frames
    const fall = step / (GHOST_EASE_S / hero.dt) + 1e-6;
    for (const name of runs) {
      const run = hero.runs[name];
      for (const all of [false, true]) {
        for (let j = 0; j < hero.n; j++) {
          let before = ghostAlpha(hero, run, 0, j, all);
          for (let f = step; f < run.frames; f += step) {
            const a = ghostAlpha(hero, run, f, j, all);
            expect(before - a).toBeLessThanOrEqual(fall);
            before = a;
          }
        }
      }
      // The window opens over the fade: never at full strength on its first frame.
      const w = ghostWindow(hero, run)!;
      expect(ghostAlpha(hero, run, w.from, hero.runner, false)).toBe(0);
    }
  });
});

describe("its label", () => {
  it("is on for the window's first 2 s, faded in and out", () => {
    const run = hero.runs.counterfactual;
    const w = ghostWindow(hero, run)!;
    const ease = GHOST_EASE_S / hero.dt;
    expect(ghostLabelAlpha(hero, run, w.from - 1)).toBe(0);
    expect(ghostLabelAlpha(hero, run, w.from)).toBe(0);
    expect(ghostLabelAlpha(hero, run, w.from + ease)).toBe(1);
    const end = Math.min(w.to, w.from + GHOST_LABEL_S / hero.dt);
    expect(ghostLabelAlpha(hero, run, end)).toBe(0);
    expect(ghostLabelAlpha(hero, run, end + 5)).toBe(0);
  });
});
