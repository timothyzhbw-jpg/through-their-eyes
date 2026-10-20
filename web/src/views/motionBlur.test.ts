// Motion blur in first person (SPEC 7, the Floodlit design): a horizontal blur whose strength
// follows the measured head angular velocity, sharp the instant the head stops, never under
// prefers-reduced-motion and never on the broadcast camera.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import {
  blurPlan,
  blurSigmaPx,
  centrePxPerDeg,
  gaussianTaps,
  headYawRate,
  MAX_SIGMA_FRACTION,
  MIN_SIGMA_PX,
  povBlurSigmaPx,
} from "./motionBlur";

const hero = parseHero(raw);
const run = hero.runs.factual;
const h8 = hero.ids.indexOf("H8");
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Standard deviation of a tap set, px. */
const spread = (t: { offsets: ArrayLike<number>; weights: ArrayLike<number> }) => {
  let v = 0;
  for (let k = 0; k < t.offsets.length; k++) v += t.weights[k] * t.offsets[k] ** 2;
  return Math.sqrt(v);
};

describe("head yaw rate", () => {
  it("reads the sim's head turn: H8 looks away at about 404 degrees a second", () => {
    // The export's head yaw steps by the same angle every frame from frame 50 to 58.
    expect(Math.abs(deg(headYawRate(hero, run, h8, 54.5, false)))).toBeCloseTo(404, 0);
    expect(Math.abs(deg(headYawRate(hero, run, h8, 54.5, true)))).toBeCloseTo(404, 0);
  });

  it("is near zero while he watches the ball", () => {
    for (const f of [2, 8.5, 12])
      expect(Math.abs(deg(headYawRate(hero, run, h8, f, false)))).toBeLessThan(10);
  });

  it("follows the eased head in comfort mode: the turn stops with zero velocity", () => {
    // Frames 59-61 hold still between the look away and the look back; the eased curve stops.
    expect(Math.abs(deg(headYawRate(hero, run, h8, 60, true)))).toBeLessThan(1);
  });
});

describe("blur strength", () => {
  it("is 0.3 x the angle swept while the virtual 25 Hz, 180-degree shutter is open", () => {
    // 400 deg/s for 1/50 s sweeps 8 degrees; at 12.8 px per degree that is 102 px; sigma 30.7 px.
    const rad = (400 * Math.PI) / 180;
    expect(blurSigmaPx(rad, 12.8)).toBeCloseTo(0.3 * 8 * 12.8, 6);
    expect(blurSigmaPx(-rad, 12.8)).toBeCloseTo(0.3 * 8 * 12.8, 6); // either direction
    expect(blurSigmaPx(rad, 12.8, 360)).toBeCloseTo(2 * 0.3 * 8 * 12.8, 6);
    expect(blurSigmaPx(rad, 12.8, 0)).toBe(0);
  });

  it("measures pixels per degree at the image centre of the 95-degree first-person view", () => {
    // The design's figure: 12.8 px per degree on a 1600 px wide frame.
    expect(centrePxPerDeg(1600, 95)).toBeCloseTo(12.8, 1);
    expect(centrePxPerDeg(3200, 95)).toBeCloseTo(25.6, 1);
  });

  it("is off under prefers-reduced-motion and on the broadcast camera", () => {
    const turning = { yawRate: (404 * Math.PI) / 180, widthPx: 1600, hfovDeg: 95 };
    expect(povBlurSigmaPx({ ...turning, camera: "pov", reducedMotion: false })).toBeCloseTo(
      0.3 * 404 * 0.02 * centrePxPerDeg(1600, 95),
      6,
    );
    expect(povBlurSigmaPx({ ...turning, camera: "pov", reducedMotion: true })).toBe(0);
    expect(povBlurSigmaPx({ ...turning, camera: "broadcast", reducedMotion: false })).toBe(0);
  });
});

describe("blur plan", () => {
  it("draws the frame sharp, without the pass, when the blur is under half a pixel", () => {
    expect(blurPlan(0, 1600).passes).toBe(0);
    expect(blurPlan(MIN_SIGMA_PX * 0.99, 1600).passes).toBe(0);
    expect(blurPlan(MIN_SIGMA_PX, 1600).passes).toBe(1);
  });

  it("caps the blur at 3% of the width, as the design does", () => {
    expect(blurPlan(500, 1600).sigma).toBeCloseTo(MAX_SIGMA_FRACTION * 1600, 6);
    expect(blurPlan(20, 1600).sigma).toBe(20);
  });

  it("splits a wide blur into two passes whose spreads add up to the asked one", () => {
    const small = blurPlan(2, 1600);
    expect(small.passes).toBe(1);
    expect(spread(small)).toBeCloseTo(2, 1);
    const wide = blurPlan(40, 1600);
    expect(wide.passes).toBe(2);
    expect(wide.perPass).toBeCloseTo(40 / Math.SQRT2, 6);
    // Two Gaussian passes in a row: variances add.
    expect(Math.sqrt(2) * spread(wide)).toBeGreaterThan(0.97 * 40);
    expect(Math.sqrt(2) * spread(wide)).toBeLessThan(1.01 * 40);
  });

  it("uses normalised, symmetric Gaussian taps", () => {
    const t = gaussianTaps(10);
    const n = t.offsets.length;
    expect(n).toBe(17);
    expect(t.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    for (let k = 0; k < n; k++) {
      expect(t.offsets[k]).toBeCloseTo(-t.offsets[n - 1 - k], 6);
      expect(t.weights[k]).toBeCloseTo(t.weights[n - 1 - k], 6);
    }
    expect(t.offsets[(n - 1) / 2]).toBe(0);
    expect(Math.max(...t.weights)).toBe(t.weights[(n - 1) / 2]);
    expect(spread(t)).toBeGreaterThan(9.7);
  });
});
