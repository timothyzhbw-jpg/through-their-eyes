// Scan step-through (SPEC 7): the bundled steps of the scan hero, checked against the hero export
// they ride on. Written before the screen: steps resolve from the run's scan events, arrows come
// from the sim's velocities, the options come from the decision record, and the decision's freeze
// leaves exactly two players lit. The file is sim.export.export_steps (tests/test_steps.py keeps
// it current).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import stepsJson from "../../public/data/steps_seed3.json";
import { parseHero } from "../data/hero";
import { heroMoment } from "../plan/moment";
import {
  ARROW_MIN_SPEED,
  ARROW_RADIUS_M,
  matchingStep,
  movementArrows,
  parseSteps,
  potentialPasses,
  povPose,
  project,
  projectSegment,
  PROJECTION_S,
  scanStepIds,
  focusPlayers,
  stepTitle,
  type DecisionStep,
  type LookStep,
} from "./steps";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const steps = parseSteps(stepsJson, hero, moment);
const fac = steps.runs.factual;
const cf = steps.runs.counterfactual;
const n = hero.n;

const clone = () => JSON.parse(JSON.stringify(stepsJson));

describe("steps resolve from the run's scan events", () => {
  it("one per scan of the hero that starts before the ball reaches him, then his decision", () => {
    const scans = hero.runs.factual.scans.filter((s) => s.player === "H8" && s.start < 70);
    expect(scanStepIds(hero, hero.runs.factual)).toEqual(scans.map((s) => s.id));
    expect(fac.steps.map((s) => s.id)).toEqual(["scan:H8:0050", "decision"]);
    const look = fac.steps[0] as LookStep;
    expect(look.missing).toBe(false);
    expect(look.start).toBe(50);
    expect(look.frame).toBeGreaterThanOrEqual(look.start); // frozen inside the look
    expect(look.frame).toBeLessThanOrEqual(look.end);
    expect(look.sight).toContain("H9"); // the runner comes into his sight on the key scan
  });

  it("keeps the dropped look in the run without it, as missing", () => {
    expect(scanStepIds(hero, hero.runs.counterfactual)).toEqual([]);
    expect(cf.steps.map((s) => [s.id, s.kind === "look" && s.missing])).toEqual([
      ["scan:H8:0050", true],
      ["decision", false],
    ]);
    expect(stepTitle(cf.steps[0])).toBe("No look here");
    expect(stepTitle(fac.steps[0])).toBe("Over his right shoulder");
  });

  it("refuses a file whose looks are not the run's", () => {
    const stale = clone();
    stale.runs.factual.steps[0].id = "scan:H8:0049";
    expect(() => parseSteps(stale, hero, moment)).toThrow(/regenerate/);
    const extra = clone();
    extra.runs.factual.steps = [];
    expect(() => parseSteps(extra, hero, moment)).toThrow(/looks are scan:H8:0050/);
  });

  it("refuses another moment's or another player's steps", () => {
    expect(() => parseSteps({ ...clone(), moment: "m:x" }, hero, moment)).toThrow(/m:x/);
    expect(() => parseSteps({ ...clone(), hero: "H4" }, hero, moment)).toThrow(/H4/);
    expect(() => parseSteps({ ...clone(), version: 99 }, hero, moment)).toThrow(/version/);
  });

  it("switching runs keeps the same look, or the decision", () => {
    expect(matchingStep(cf.steps, fac.steps[0], 0)).toBe(0);
    expect(matchingStep(cf.steps, fac.steps[1], 1)).toBe(1);
  });

  it("has verified lines for every step, in both languages", () => {
    for (const run of [fac, cf]) {
      expect(run.errors).toEqual([]);
      for (const lang of ["en", "zh"] as const) {
        const ids = run.answers[lang]!.lines.map((l) => l.id);
        for (const step of run.steps) expect(ids).toEqual(expect.arrayContaining(step.lines));
        expect(ids).toEqual(expect.arrayContaining(run.intro));
      }
    }
    const text = fac.answers.en!.lines.map((l) => l.text).join(" ");
    expect(text).toContain("J. Ferriday looks over his right shoulder");
    expect(text).toContain("So he passes to N. Varnhall.");
    expect(cf.answers.en!.lines.map((l) => l.text).join(" ")).toContain(
      "So he passes to K. Annersley.",
    );
  });
});

describe("movement arrows come from the sim's velocities", () => {
  const look = fac.steps[0] as LookStep;
  const arrows = movementArrows(hero, hero.runs.factual, look.frame, look.vel);

  it("start where each player is and reach his velocity times the projection", () => {
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      const at = (look.frame * n + a.player) * 2;
      expect(a.from).toEqual([hero.runs.factual.pos[at], hero.runs.factual.pos[at + 1]]);
      expect(a.to[0]).toBeCloseTo(a.from[0] + look.vel[2 * a.player] * PROJECTION_S, 5);
      expect(a.to[1]).toBeCloseTo(a.from[1] + look.vel[2 * a.player + 1] * PROJECTION_S, 5);
    }
  });

  it("are the file's velocities in m/s, the runner's the fastest", () => {
    const j = hero.ids.indexOf("H9");
    const raw9 = stepsJson.runs.factual.steps[0].vel[j];
    expect([look.vel[2 * j], look.vel[2 * j + 1]]).toEqual([
      Math.fround(raw9[0] / 1000),
      Math.fround(raw9[1] / 1000),
    ]);
    const speed = (a: (typeof arrows)[number]) =>
      Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    const fastest = arrows.reduce((x, y) => (speed(y) > speed(x) ? y : x));
    expect(hero.ids[fastest.player]).toBe("H9");
  });

  it("leave out the hero, players standing still and players far from him", () => {
    expect(arrows.some((a) => a.player === hero.hero)).toBe(false);
    const me = (look.frame * n + hero.hero) * 2;
    const pos = hero.runs.factual.pos;
    for (const a of arrows) {
      expect(Math.hypot(a.from[0] - pos[me], a.from[1] - pos[me + 1])).toBeLessThanOrEqual(
        ARROW_RADIUS_M,
      );
      expect(Math.hypot(look.vel[2 * a.player], look.vel[2 * a.player + 1])).toBeGreaterThanOrEqual(
        ARROW_MIN_SPEED,
      );
    }
    const still = new Float32Array(2 * n);
    expect(movementArrows(hero, hero.runs.factual, look.frame, still)).toEqual([]);
  });
});

describe("potential passes come from the decision record", () => {
  it("one lane per option he evaluated, from the ball at his decision to its believed target", () => {
    const run = hero.runs.factual;
    const d = run.decision!;
    const lanes = potentialPasses(hero, run, (fac.steps[0] as LookStep).sight);
    expect(lanes.map((l) => l.action)).toEqual(d.options.map((o) => o.action));
    const at = (d.frame * n + hero.hero) * 2;
    for (const [k, lane] of lanes.entries()) {
      expect(lane.from).toEqual([run.pos[at], run.pos[at + 1]]);
      expect(lane.to).toEqual(d.options[k].target);
      expect(lane.prob).toBe(d.options[k].prob);
    }
    expect(lanes.filter((l) => l.chosen).map((l) => l.action)).toEqual(["pass:H9"]);
    expect(lanes.find((l) => l.action === "pass:H9")!.seen).toBe(true); // this look found him
    expect(lanes.find((l) => l.action === "carry")!.kind).toBe("carry");
  });

  it("are the other run's record in the run without the look", () => {
    const lanes = potentialPasses(hero, hero.runs.counterfactual, []);
    expect(lanes.filter((l) => l.chosen).map((l) => l.action)).toEqual(["pass:H4"]);
    expect(lanes.every((l) => !l.seen)).toBe(true);
  });
});

describe("the decision's freeze leaves exactly two players lit", () => {
  it("the receiver of his pass and the opponent nearest him", () => {
    const d = fac.steps.at(-1) as DecisionStep;
    expect(d.kind).toBe("decision");
    const pair = focusPlayers(hero, d);
    expect(pair).toHaveLength(2);
    expect(pair.map((j) => hero.ids[j])).toEqual(["H9", "A5"]);
    // A5 really is the opponent nearest to H9 at the decision.
    const pos = hero.runs.factual.pos;
    const at = (j: number) => [pos[(d.frame * n + j) * 2], pos[(d.frame * n + j) * 2 + 1]];
    const h9 = at(pair[0]);
    const dist = (j: number) => Math.hypot(at(j)[0] - h9[0], at(j)[1] - h9[1]);
    const opponents = hero.players.flatMap((p, j) => (p.team === 1 ? [j] : []));
    expect(Math.min(...opponents.map(dist))).toBe(dist(pair[1]));
    const without = cf.steps.at(-1) as DecisionStep;
    expect(focusPlayers(hero, without).map((j) => hero.ids[j])).toEqual(["H4", "A9"]);
  });

  it("refuses a pair that is not two players", () => {
    const d = { ...(fac.steps.at(-1) as DecisionStep), focus: ["H9", "H9"] as [string, string] };
    expect(() => focusPlayers(hero, d)).toThrow();
  });
});

describe("the first-person camera the overlay projects with", () => {
  const look = fac.steps[0] as LookStep;
  const run = hero.runs.factual;
  const pose = povPose(hero, run, hero.hero, look.frame, 16 / 9);
  const me = (look.frame * n + hero.hero) * 2;
  const yaw = run.head[look.frame * n + hero.hero];
  const ahead = (d: number): [number, number] => [
    run.pos[me] + d * Math.cos(yaw),
    run.pos[me + 1] + d * Math.sin(yaw),
  ];

  it("puts what is straight ahead at the centre column, the ground below the middle", () => {
    const p = project(pose, ahead(20), 1600, 900)!;
    expect(p[0]).toBeCloseTo(800, 3);
    expect(p[1]).toBeGreaterThan(450);
  });

  it("puts what is to his left on the left, and nothing behind him", () => {
    const left: [number, number] = [
      run.pos[me] + 20 * Math.cos(yaw + 0.3),
      run.pos[me + 1] + 20 * Math.sin(yaw + 0.3),
    ];
    expect(project(pose, left, 1600, 900)![0]).toBeLessThan(800);
    expect(project(pose, ahead(-10), 1600, 900)).toBeNull();
  });

  it("clips a segment that runs behind him at the eye", () => {
    const seg = projectSegment(pose, ahead(-10), ahead(10), 1600, 900)!;
    expect(seg).not.toBeNull();
    expect(seg[1]).toEqual(project(pose, ahead(10), 1600, 900));
    expect(projectSegment(pose, ahead(-10), ahead(-5), 1600, 900)).toBeNull();
  });
});
