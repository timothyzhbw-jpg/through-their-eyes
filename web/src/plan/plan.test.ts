// Acceptance checks for the breakdown player (SPEC 7): every TelestrationPlan is schema-validated
// before playback, and an invalid plan falls back to a template plan.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { advance, createPlayback } from "../store/playback";
import { EXAMPLE_PLAN, EXAMPLE_SCRIPT, INVALID_PLAN } from "./example";
import { heroMoment, relToFrame } from "./moment";
import { BreakdownRunner } from "./runner";
import { templatePlan } from "./template";
import { MAX_POV_CLIP_S, resolvePlan, validatePlan } from "./validate";

const hero = parseHero(raw);
const moment = heroMoment(hero);

type Plan = typeof EXAMPLE_PLAN;
const withStep = (plan: Plan, index: number, patch: object): unknown => ({
  ...plan,
  steps: plan.steps.map((s, k) => (k === index ? { ...s, ...patch } : s)),
});
const povIndex = EXAMPLE_PLAN.steps.findIndex((s) => s.do === "pov");
const errorsOf = (plan: unknown) => {
  const v = validatePlan(plan, moment, EXAMPLE_SCRIPT);
  return v.ok ? [] : v.errors;
};

describe("plan validation", () => {
  it("accepts the example plan", () => {
    expect(errorsOf(EXAMPLE_PLAN)).toEqual([]);
  });

  it("accepts the template plan without a script", () => {
    const v = validatePlan(templatePlan(moment), moment, {});
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  it("rejects unknown step kinds and unknown fields", () => {
    expect(errorsOf({ ...EXAMPLE_PLAN, steps: [{ t: 0, do: "spin" }] })).not.toEqual([]);
    expect(errorsOf(withStep(EXAMPLE_PLAN, 0, { zoom: 2 }))).not.toEqual([]);
    expect(errorsOf({ ...EXAMPLE_PLAN, steps: [] })).not.toEqual([]);
    expect(errorsOf("not a plan")).not.toEqual([]);
  });

  it(`rejects POV clips longer than ${MAX_POV_CLIP_S} s and empty ones`, () => {
    expect(errorsOf(withStep(EXAMPLE_PLAN, povIndex, { from: -1.6, to: 1.6 }))).toEqual([
      expect.stringMatching(/POV clip .* longer than/),
    ]);
    expect(errorsOf(withStep(EXAMPLE_PLAN, povIndex, { from: 0.2, to: 0.2 }))).not.toEqual([]);
  });

  it("rejects references to things that do not exist", () => {
    const scan = EXAMPLE_PLAN.steps.findIndex((s) => s.do === "scan_marker");
    const cf = EXAMPLE_PLAN.steps.findIndex((s) => "kind" in s && s.kind === "counterfactual");
    const voice = EXAMPLE_PLAN.steps.findIndex((s) => s.do === "voice");
    expect(errorsOf(withStep(EXAMPLE_PLAN, scan, { scan: "scan:H8:9999" }))).not.toEqual([]);
    expect(errorsOf(withStep(EXAMPLE_PLAN, povIndex, { player: "H99" }))).not.toEqual([]);
    expect(errorsOf(withStep(EXAMPLE_PLAN, cf, { cf: "cf9" }))).not.toEqual([]);
    expect(errorsOf(withStep(EXAMPLE_PLAN, voice, { line: "L99" }))).not.toEqual([]);
  });

  it("rejects times outside the clip, steps out of order and steps after the end", () => {
    const rewind = EXAMPLE_PLAN.steps.findIndex((s) => s.do === "rewind");
    expect(errorsOf(withStep(EXAMPLE_PLAN, rewind, { to: -30 }))).not.toEqual([]);
    expect(errorsOf(withStep(EXAMPLE_PLAN, 3, { t: 0.1 }))).not.toEqual([]);
    expect(errorsOf({ ...EXAMPLE_PLAN, duration_s: 5 })).not.toEqual([]);
  });

  it("rejects a plan for another moment", () => {
    expect(errorsOf({ ...EXAMPLE_PLAN, moment: "m7" })).not.toEqual([]);
  });

  it("plays a valid plan as given", () => {
    const resolved = resolvePlan(EXAMPLE_PLAN, moment, EXAMPLE_SCRIPT);
    expect(resolved.source).toBe("given");
    expect(resolved.plan).toEqual(EXAMPLE_PLAN);
  });

  it("falls back to the template plan, with the reasons", () => {
    const resolved = resolvePlan(INVALID_PLAN, moment, EXAMPLE_SCRIPT);
    expect(resolved.source).toBe("template");
    expect(resolved.plan).toEqual(templatePlan(moment));
    expect(resolved.errors.length).toBeGreaterThan(0);
  });
});

describe("plan executor", () => {
  const FPS = 60;

  function start(plan: unknown) {
    const playback = createPlayback(hero);
    const runner = new BreakdownRunner(playback, hero, moment, EXAMPLE_SCRIPT);
    const resolved = resolvePlan(plan, moment, EXAMPLE_SCRIPT);
    runner.start(resolved.plan);
    const until = (t: number) => {
      while (runner.time < t - 1e-9 && runner.status.get().status === "running") {
        runner.tick(1 / FPS);
        advance(playback, hero, 1 / FPS);
      }
      return playback.get();
    };
    return { playback, runner, until };
  }

  it("runs a POV segment through the hero's eyes, from `from` to `to`, eased", () => {
    const { until } = start(EXAMPLE_PLAN);
    const pov = EXAMPLE_PLAN.steps[povIndex] as { t: number; from: number; to: number };
    const during = until(pov.t + 0.05);
    expect(during.povPlayer).toBe("H8");
    expect(during.comfort).toBe(true);
    expect(during.playing).toBe(true);
    expect(during.focus).toBe("pov");
    expect(during.frame).toBeGreaterThanOrEqual(relToFrame(moment, pov.from));
    const after = until(pov.t + (pov.to - pov.from) / 0.5 + 0.1);
    expect(after.playing).toBe(false);
    expect(after.frame).toBeCloseTo(relToFrame(moment, pov.to), 6);
  });

  it("applies overlays, captions and the counterfactual ghost, then finishes", () => {
    const { runner, until } = start(EXAMPLE_PLAN);
    const mid = until(4.5);
    expect(mid.scanMarker).toBe(hero.keyScan.id);
    expect(mid.cone).toBe(true);
    expect(mid.beliefGhosts).toBe(true);
    expect(mid.cfGhost).toBe(false);
    const late = until(9.1);
    expect(late.cfGhost).toBe(true);
    expect(late.caption).toBe(EXAMPLE_SCRIPT.L5);
    expect(late.frame).toBeCloseTo(relToFrame(moment, 2.8), 6);
    until(EXAMPLE_PLAN.duration_s + 1);
    expect(runner.status.get().status).toBe("done");
    expect(runner.status.get().applied).toBe(EXAMPLE_PLAN.steps.length);
  });

  it("plays the template plan to the end too", () => {
    const { runner, until } = start(INVALID_PLAN);
    const plan = templatePlan(moment);
    until(plan.duration_s + 1);
    expect(runner.status.get().status).toBe("done");
    expect(runner.status.get().applied).toBe(plan.steps.length);
  });

  it("stop() hands control back to free play", () => {
    const { playback, runner, until } = start(EXAMPLE_PLAN);
    until(2.5);
    runner.stop();
    expect(runner.status.get().status).toBe("stopped");
    expect(playback.get().autoSlow).toBe(true);
    expect(playback.get().playUntil).toBeNull();
    const t = runner.time;
    runner.tick(1);
    expect(runner.time).toBe(t);
  });
});
