// The key-moment beat (SPEC 7): when slow motion starts and ends relative to the key scan, the
// freeze accent when the runner first comes into his sight, the push-in, reduced motion, plans,
// the live stream's lag and a stitched match.

import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, type Hero } from "../data/hero";
import { followLive, LIVE_MAX_LAG } from "../live/feed";
import { leaveStream } from "../session";
import { createPlayback, frameStep } from "../store/playback";
import { BLIND_START, markerExport, matchExport, pressureExport } from "../testing";
import { BEAT, beatAt, beatsOf, beatStep, beatWeight, liveLag, motion, pushAt } from "./beat";

const hero = parseHero(raw);
const factual = hero.runs.factual;
const DT = 1 / 60; // one animation frame

/** Wall seconds to play from frame `from` to `to` at 60 Hz in free play (autoSlow on). */
function wallTime(
  h: Hero,
  mode: "factual" | "counterfactual",
  from: number,
  to: number,
  speed = 1,
) {
  const playback = createPlayback(h);
  let s = { ...playback.get(), mode, frame: from, playing: true, speed, autoSlow: true };
  let t = 0;
  while (s.frame < to) {
    s = { ...s, frame: s.frame + frameStep(h, s, DT) };
    t += DT;
  }
  return t;
}

/** Playback speed (× real time) at frame `f` in free play. */
function speedAt(h: Hero, f: number, mode: "factual" | "counterfactual" = "factual", speed = 1) {
  const s = { ...createPlayback(h).get(), mode, frame: f, playing: true, speed, autoSlow: true };
  return frameStep(h, s, DT) / (DT / h.dt) / speed;
}

afterEach(() => motion.set({ reduced: false }));

describe("the key-moment beat", () => {
  it("is built around the key scan: ease in before it, release at the pass", () => {
    const [beat, ...rest] = beatsOf(hero, factual);
    expect(rest).toEqual([]);
    const key = hero.keyScan!;
    expect(beat.scan.id).toBe(key.id);
    expect(beat.observer).toBe(hero.hero);
    expect(beat.target).toBe(hero.runner);
    expect(beat.slowFrom).toBe(key.start); // full slow motion as the key scan begins
    expect(beat.slowTo).toBe(key.end);
    expect(beat.start).toBe(key.start - Math.round(BEAT.leadS / hero.dt)); // eased in before it
    const pass = factual.events.find((e) => e.type === "pass" && e.player === hero.heroId)!;
    expect(pass.frame).toBe(75);
    expect(beat.end).toBe(pass.frame); // back to 1x as he releases the pass
  });

  it("plays at 1x before the ease-in, about 0.4x through the scan, and 1x from the release", () => {
    const b = beatsOf(hero, factual)[0];
    expect(speedAt(hero, b.start - 2)).toBeCloseTo(1, 6);
    for (const f of [b.slowFrom + 1, b.slowFrom + 3, b.slowTo - 4, b.slowTo - 1]) {
      expect(speedAt(hero, f)).toBeCloseTo(BEAT.slow, 2);
    }
    expect(speedAt(hero, b.end + 0.5)).toBeCloseTo(1, 6);
    expect(speedAt(hero, b.end + 20)).toBeCloseTo(1, 6);
  });

  it("eases: speed only falls on the way in and only rises on the way out", () => {
    const b = beatsOf(hero, factual)[0];
    let last = Infinity;
    for (let f = b.start; f <= b.slowFrom; f += 0.25) {
      const v = speedAt(hero, f);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
    last = 0;
    for (let f = b.slowTo; f <= b.end; f += 0.25) {
      const v = speedAt(hero, f);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
    // No step: neighbouring quarter frames never differ by more than a tenth of real time.
    for (let f = b.start - 1; f <= b.end + 1; f += 0.25) {
      if (f + 0.25 >= b.sighted! && f <= b.sighted! + BEAT.accentFrames) continue; // the accent
      expect(Math.abs(speedAt(hero, f + 0.25) - speedAt(hero, f))).toBeLessThan(0.1);
    }
  });

  it("holds briefly when the runner first comes into his sight", () => {
    const b = beatsOf(hero, factual)[0];
    expect(b.sighted).toBe(56); // H9 enters H8's sight six frames into the scan
    const near = wallTime(hero, "factual", b.sighted! - 1, b.sighted! + 1);
    const plain = 2 * (hero.dt / BEAT.slow); // the same two frames at 0.4x
    expect(near - plain).toBeGreaterThan(BEAT.accentS - 0.05);
    expect(near - plain).toBeLessThan(BEAT.accentS + 0.05);
    expect(speedAt(hero, b.sighted! + 0.5)).toBeLessThan(0.15); // nearly frozen at its peak
  });

  it("stretches the moment by a known amount and never stalls", () => {
    const b = beatsOf(hero, factual)[0];
    const t = wallTime(hero, "factual", b.start - 5, b.end + 5);
    const realTime = (b.end - b.start + 10) * hero.dt;
    expect(t).toBeGreaterThan(realTime + 1.0);
    expect(t).toBeLessThan(realTime + 2.4);
  });

  it("slows the run without the look at the same frames, with no accent (he never looked)", () => {
    const cf = hero.runs.counterfactual;
    const [b] = beatsOf(hero, cf);
    expect(b.dropped).toBe(true);
    expect(b.sighted).toBeNull();
    expect([b.start, b.slowFrom, b.slowTo]).toEqual([
      beatsOf(hero, factual)[0].start,
      hero.keyScan!.start,
      hero.keyScan!.end,
    ]);
    expect(speedAt(hero, 60, "counterfactual")).toBeCloseTo(BEAT.slow, 2);
  });

  it("is off under prefers-reduced-motion: 1x throughout, no push-in", () => {
    motion.set({ reduced: true });
    const b = beatsOf(hero, factual)[0];
    for (let f = b.start - 2; f <= b.end + 2; f += 0.5) expect(speedAt(hero, f)).toBeCloseTo(1, 6);
    expect(pushAt(hero, factual, 60)).toBe(0);
  });

  it("pushes in with the slow motion and lets go by the release", () => {
    const b = beatsOf(hero, factual)[0];
    expect(pushAt(hero, factual, b.start - 1)).toBe(0);
    expect(pushAt(hero, factual, (b.slowFrom + b.slowTo) / 2)).toBe(1);
    expect(pushAt(hero, factual, b.end)).toBe(0);
    expect(beatWeight(b, b.slowFrom)).toBe(1);
    expect(beatAt(beatsOf(hero, factual), b.end + 1)).toBeNull();
  });

  it("aims for 0.4x whatever the chosen speed, and never speeds up a slower one", () => {
    expect(speedAt(hero, 60, "factual", 2) * 2).toBeCloseTo(BEAT.slow, 2);
    expect(speedAt(hero, 60, "factual", 0.25)).toBeCloseTo(1, 6); // 0.25x is already slower
  });

  it("leaves plans and the recap reel at their own speed (autoSlow off)", () => {
    const s = { ...createPlayback(hero).get(), frame: 60, playing: true, autoSlow: false };
    expect(frameStep(hero, s, DT)).toBeCloseTo(DT / hero.dt, 9);
  });

  it("splits one step across the ease exactly", () => {
    // Two half steps land where one whole step does.
    const b = beatsOf(hero, factual)[0];
    for (const f of [b.start - 0.3, b.slowFrom - 0.5, b.sighted! - 0.7, b.slowTo + 0.2]) {
      const whole = beatStep(hero, factual, f, 0.8, 1, false);
      const half = beatStep(hero, factual, f, 0.4, 1, false);
      const rest = beatStep(hero, factual, f + half, 0.4, 1, false);
      expect(half + rest).toBeCloseTo(whole, 3);
    }
  });

  it("has no beat for a hero without a key scan", () => {
    const h = parseHero(pressureExport());
    expect(beatsOf(h, h.runs.factual)).toEqual([]);
    expect(speedAt(h, 60)).toBeCloseTo(1, 6);
  });

  it("rings the marker's man when he comes into the marker's sight", () => {
    const h = parseHero(markerExport());
    const [b] = beatsOf(h, h.runs.factual);
    expect(h.ids[b.target]).toBe(h.marker!.man);
    expect(b.end).toBeGreaterThan(b.slowTo); // released at the pass to his man (or soon after)
  });
});

describe("the beat on the live stream", () => {
  it("lets the playhead fall behind through the beat instead of jumping to the stream", () => {
    const b = beatsOf(hero, factual)[0];
    let frame = b.start - 10;
    let latest = frame;
    let maxBehind = 0;
    for (let k = 0; k < 600 && frame < b.end + 30; k++) {
      latest = Math.min(factual.frames - 1, latest + DT / hero.dt); // the stream keeps 1x
      const lag = liveLag(hero, factual, frame, 1, false);
      const before = frame;
      const step = beatStep(hero, factual, frame, DT / hero.dt, 1, false);
      frame = followLive(frame, Math.floor(latest), hero.dt, (step / (DT / hero.dt)) * 1, DT, lag);
      expect(frame - before).toBeLessThan(1); // never a jump
      maxBehind = Math.max(maxBehind, latest - frame);
    }
    expect(maxBehind).toBeGreaterThan(LIVE_MAX_LAG + 10); // it really fell behind
  });

  it("allows no extra lag without a beat or under reduced motion", () => {
    expect(liveLag(hero, factual, 10, 1, false)).toBe(LIVE_MAX_LAG);
    expect(liveLag(hero, factual, 100, 1, true)).toBe(LIVE_MAX_LAG);
  });

  it("in a match, catches up at the next possession's cut", () => {
    const h = parseHero(matchExport());
    const run = h.runs.factual;
    // The scan hero's key scan, in match time (the opening possession repeats its first frames).
    const b = beatsOf(h, run).find((bb) => bb.start >= BLIND_START)!;
    expect(b.slowFrom).toBe(BLIND_START + hero.keyScan!.start);
    const next = h.match!.possessions.find((p) => p.start > b.end)!;
    expect(liveLag(h, run, b.end + 5, 1, false)).toBeGreaterThan(LIVE_MAX_LAG + 10);
    expect(liveLag(h, run, next.start + 1, 1, false)).toBe(LIVE_MAX_LAG);
  });
});

describe("the end of the stream", () => {
  it("lets a playhead that a beat left behind play out the frames it has", () => {
    const playback = createPlayback(hero);
    playback.set({ live: true, playing: true, frame: 60 });
    leaveStream(playback, "ended", 100);
    expect(playback.get()).toMatchObject({ live: false, playing: true, frame: 60, playUntil: 100 });
  });

  it("leaves one at the stream at the last frame received, as before", () => {
    const playback = createPlayback(hero);
    playback.set({ live: true, playing: true, frame: 98 });
    leaveStream(playback, "ended", 100);
    expect(playback.get()).toMatchObject({ live: false, playing: false, frame: 100 });
    playback.set({ live: true, playing: true, frame: 60 });
    leaveStream(playback, "lost", 100); // broken: no promise the frames after it are coming
    expect(playback.get()).toMatchObject({ live: false, playing: false, frame: 100 });
  });
});
