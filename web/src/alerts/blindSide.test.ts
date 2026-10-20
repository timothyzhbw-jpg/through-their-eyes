// Blind-side alerts on screen (SPEC 4.4, 7): with the look, H9's alert behind H8 clears during
// the key scan; without it, the alert stays on until the pass. It clears the moment he is seen.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero, type Run } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { alertOn, alertsAt, pulse, unseenLabel } from "./blindSide";

const hero = parseHero(raw);
const key = hero.keyScan!; // the bundled scan hero has one
const on = (run: Run, f: number) => alertOn(hero, run, f, "H8", "H9");

describe("H9 behind H8", () => {
  it("with the look: on before the key scan, cleared during it", () => {
    const run = hero.runs.factual;
    expect(on(run, key.start - 1)).toBe(true);
    let cleared = key.start;
    while (on(run, cleared)) cleared++;
    expect(cleared).toBeGreaterThanOrEqual(key.start);
    expect(cleared).toBeLessThanOrEqual(key.end);
    expect(on(run, run.decision!.frame)).toBe(false);
  });

  it("without the look: on until the pass", () => {
    const run = hero.runs.counterfactual;
    const pass = run.decision!.frame;
    for (let f = key.start - 1; f <= pass; f++) expect(on(run, f)).toBe(true);
    expect(on(run, pass + 1)).toBe(false);
  });

  it("counts how long he has gone unseen, growing frame by frame", () => {
    const run = hero.runs.counterfactual;
    const [h8, h9] = [hero.ids.indexOf("H8"), hero.ids.indexOf("H9")];
    const unseen = (f: number) =>
      alertsAt(hero, run, f).find((a) => a.observer === h8 && a.target === h9)!.unseen;
    expect(unseen(key.end) - unseen(key.start)).toBeCloseTo((key.end - key.start) * hero.dt, 9);
    expect(unseenLabel(unseen(key.start))).toMatch(/^unseen \d+\.\d s$/);
  });
});

describe("display rules", () => {
  it("clears an alert the moment its target is seen, even while the module holds it on", () => {
    const run = hero.runs.factual;
    const f = key.start - 1;
    const held: Run = {
      ...run,
      blindSide: {
        ...run.blindSide,
        frames: run.blindSide.frames.map((alerts, g) =>
          g === f ? alerts.map(([o, t]) => [o, t, 0] as [number, number, number]) : alerts,
        ),
      },
    };
    expect(alertsAt(hero, held, f)).toEqual([]);
    expect(alertsAt(hero, run, f).length).toBeGreaterThan(0);
  });

  it("pulses between 1 and 1.45", () => {
    const beats = Array.from({ length: 50 }, (_, k) => pulse(k * 0.013));
    expect(Math.min(...beats)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...beats)).toBeLessThanOrEqual(1.45);
  });

  it("is on by default and has a toggle", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    expect(session.playback.get().blindSide).toBe(true);
    session.controls.toggle("blindSide");
    expect(session.playback.get().blindSide).toBe(false);
  });
});
