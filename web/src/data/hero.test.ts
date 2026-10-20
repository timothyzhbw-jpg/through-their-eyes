// Comfort mode (SPEC 7: eased POV yaw) must not change what the player saw: eased yaw passes
// through every recorded frame, never overshoots between frames, and the on-screen turn rate
// stays under the cap.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { advance, COMFORT_MAX_YAW, createPlayback } from "../store/playback";
import { easedHeadAt, parseHero, wrapAngle } from "./hero";

const hero = parseHero(raw);
const run = hero.runs.factual;
const j = hero.hero;
const rawYaw = (f: number) => run.head[f * hero.n + j];

describe("eased head yaw", () => {
  it("passes through the recorded yaw on every frame", () => {
    for (let f = 0; f < run.frames; f++) {
      expect(Math.abs(wrapAngle(easedHeadAt(hero, run, j, f) - rawYaw(f)))).toBeLessThan(1e-6);
    }
  });

  it("never leaves the range of the two frames around it", () => {
    for (let f = 0; f < run.frames - 1; f++) {
      const a = rawYaw(f);
      const span = wrapAngle(rawYaw(f + 1) - a);
      for (const t of [0.25, 0.5, 0.75]) {
        const d = wrapAngle(easedHeadAt(hero, run, j, f + t) - a);
        expect(d * Math.sign(span || 1)).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.abs(d)).toBeLessThanOrEqual(Math.abs(span) + 1e-6);
      }
    }
  });

  it.each([1 / 60, 1 / 240])("keeps the on-screen turn rate under the cap (dt %f s)", (dt) => {
    const playback = createPlayback(hero);
    const key = hero.keyScan!; // the bundled scan hero has one
    playback.set({ frame: key.start - 4, playing: true, comfort: true, autoSlow: false });
    let fastest = 0;
    while (playback.get().frame < key.end + 4) {
      const before = easedHeadAt(hero, run, j, playback.get().frame);
      advance(playback, hero, dt);
      const after = easedHeadAt(hero, run, j, playback.get().frame);
      fastest = Math.max(fastest, Math.abs(wrapAngle(after - before)) / dt);
    }
    expect(fastest).toBeGreaterThan(0.9 * COMFORT_MAX_YAW);
    expect(fastest).toBeLessThanOrEqual(COMFORT_MAX_YAW * (1 + 1e-6));
  });
});
