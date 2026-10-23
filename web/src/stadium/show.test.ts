import { describe, expect, it } from "vitest";
import { SCREEN_IDS } from "./formats";
import { assignScreens, FADE, MIN_GAP_MS, programme } from "./rules";
import { createShow, createSurfaces, type ShowDeps } from "./show";
import { facts, recordingCanvas } from "./testing";

const events = programme(facts());

/** A clock the test moves, and timers that fire when it passes them. */
function fakeTime(reduced = false) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const deps: ShowDeps = {
    now: () => now,
    later: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancel: (id) => {
      const k = timers.findIndex((t) => t.id === id);
      if (k >= 0) timers.splice(k, 1);
    },
    reducedMotion: () => reduced,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  return { deps, advance, now: () => now };
}

const draws = (show: ReturnType<typeof createShow>) =>
  SCREEN_IDS.map((s) => show.surfaces[s].draws).reduce((a, b) => a + b, 0);

describe("the show", () => {
  it("draws each screen once on the first event, then only what changes", () => {
    const time = fakeTime();
    const show = createShow(events, createSurfaces(recordingCanvas()), time.deps);
    show.select(0);
    expect(draws(show)).toBe(SCREEN_IDS.length); // the first show cuts in
    show.select(0);
    time.advance(5000);
    expect(draws(show)).toBe(SCREEN_IDS.length); // the same event: nothing redrawn

    show.select(1);
    time.advance(5000);
    const a = assignScreens(events[0], 0);
    const b = assignScreens(events[1], 1);
    const changed = SCREEN_IDS.filter((s) => a[s].key !== b[s].key).length;
    expect(draws(show)).toBe(SCREEN_IDS.length + changed);
    // And no frame redraws anything: time passing alone draws nothing.
    time.advance(60_000);
    expect(draws(show)).toBe(SCREEN_IDS.length + changed);
    show.dispose();
  });

  it("swaps a fading screen's picture at the bottom of its dip", () => {
    const time = fakeTime();
    const show = createShow(events, createSurfaces(recordingCanvas()), time.deps);
    show.select(0);
    time.advance(MIN_GAP_MS);
    show.select(1);
    const main = show.surfaces.main;
    const before = main.key;
    expect(show.level("main")).toBe(1);
    time.advance(FADE.ms / 4);
    expect(show.level("main")).toBeLessThan(1);
    expect(main.key).toBe(before); // still the old picture on the way down
    time.advance(FADE.ms / 4);
    expect(main.key).not.toBe(before);
    time.advance(FADE.ms / 2);
    expect(show.level("main")).toBe(1);
    expect(show.fading()).toBe(false);
    show.dispose();
  });

  it("changes the screens at most once per gap while the timeline is scrubbed", () => {
    const time = fakeTime();
    const show = createShow(events, createSurfaces(recordingCanvas()), time.deps);
    const commits: number[] = [];
    let shown = show.state.get().shown;
    show.state.subscribe(() => {
      const s = show.state.get().shown;
      if (s !== shown) commits.push(time.now());
      shown = s;
    });
    // Back and forth across the whole timeline at 60 Hz for four seconds.
    for (let k = 0; k < 240; k++) {
      show.select(Math.round((Math.sin(k / 10) + 1) * 2.5));
      time.advance(1000 / 60);
    }
    for (let k = 1; k < commits.length; k++) {
      expect(commits[k] - commits[k - 1]).toBeGreaterThanOrEqual(MIN_GAP_MS);
    }
    // Once the scrubbing stops, the screens settle on where the timeline is.
    show.select(5);
    time.advance(MIN_GAP_MS * 2);
    expect(show.state.get().shown).toBe(5);
    show.dispose();
  });

  it("cuts instead of fading with reduced motion", () => {
    const time = fakeTime(true);
    const show = createShow(events, createSurfaces(recordingCanvas()), time.deps);
    show.select(0);
    time.advance(MIN_GAP_MS);
    show.select(1);
    expect(show.fading()).toBe(false);
    expect(show.level("main")).toBe(1);
    expect(show.surfaces.main.key).toBe(assignScreens(events[1], 1).main.key);
    show.dispose();
  });
});
