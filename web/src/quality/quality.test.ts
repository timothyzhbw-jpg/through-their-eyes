// Render quality tiers (SPEC 7): which tier a device gets, how a link or the viewer overrides it,
// what each tier draws, and depth of field only through the key-moment slow motion.

import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { beatsOf, motion } from "../beat/beat";
import { parseHero } from "../data/hero";
import {
  detectTier,
  DOF_EASE_S,
  DofEase,
  dofAt,
  FrameMeter,
  featuresOf,
  focusOf,
  parseQuality,
  quality,
  setTier,
  stepDown,
} from "./quality";

const hero = parseHero(raw);
const run = hero.runs.factual;

const desktop = { mobile: false, dpr: 2, deviceMemory: 16 };
afterEach(() => {
  motion.set({ reduced: false });
  quality.set({ tier: "standard", source: "default" });
});

describe("render quality tiers", () => {
  it.each([
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)", desktop, "high"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)", desktop, "high"],
    ["ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)", desktop, "high"],
    ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)", desktop, "medium"],
    ["ANGLE (Intel, Intel(R) Arc(TM) A370M Graphics Direct3D11 vs_5_0 ps_5_0)", desktop, "medium"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)", desktop, "low"],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)", desktop, "medium"],
    ["Apple GPU", { mobile: true, dpr: 3, deviceMemory: undefined }, "medium"],
    ["Adreno (TM) 740", { mobile: true, dpr: 3, deviceMemory: 8 }, "medium"],
    ["Mali-G57", { mobile: true, dpr: 2, deviceMemory: 3 }, "low"],
    [
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)",
      { ...desktop, deviceMemory: 2 },
      "medium",
    ],
    [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      desktop,
      "low",
    ],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", desktop, "low"],
  ] as const)("%s → %s", (renderer, device, tier) => {
    expect(detectTier({ renderer, ...device })).toBe(tier);
  });

  it("reads ?quality= from a link", () => {
    expect(parseQuality("?quality=high")).toBe("high");
    expect(parseQuality("?at=60&quality=medium")).toBe("medium");
    expect(parseQuality("?quality=standard")).toBe("standard");
    expect(parseQuality("?quality=low")).toBe("low");
    expect(parseQuality("?quality=auto")).toBe("auto");
    expect(parseQuality("?quality=ultra")).toBeNull();
    expect(parseQuality("")).toBeNull();
  });

  it("lets the viewer choose over the link and the detection", () => {
    setTier("high", "viewer");
    expect(quality.get()).toEqual({ tier: "high", source: "viewer" });
  });

  it("changes fidelity between low, medium and high, never the look", () => {
    const low = featuresOf("low", false);
    const medium = featuresOf("medium", false);
    const high = featuresOf("high", false);
    for (const f of [low, medium, high]) {
      expect(f.look).toBe(true); // tone curve, rim, crowd, halos, shadows, environment
      expect(f.environment).toBe(true);
    }
    expect(low).toMatchObject({ post: false, smaa: false, dof: false, ao: false, bloom: false });
    expect(medium).toMatchObject({ post: true, smaa: true, dof: true, ao: false, bloom: false });
    expect(high).toMatchObject({ post: true, smaa: true, dof: true, ao: true, bloom: true });
  });

  it("leaves the standard picture exactly as it was", () => {
    expect(Object.values(featuresOf("standard", false)).some(Boolean)).toBe(false);
  });

  it("turns depth of field off under reduced motion", () => {
    expect(featuresOf("high", true).dof).toBe(false);
    expect(featuresOf("medium", true).dof).toBe(false);
    expect(featuresOf("low", true).look).toBe(true); // the look is not motion
  });
});

describe("depth of field", () => {
  const b = beatsOf(hero, run)[0];

  it("only through the key-moment slow motion", () => {
    expect(dofAt(hero, run, b.start - 1, "broadcast")).toBe(0);
    expect(dofAt(hero, run, (b.slowFrom + b.slowTo) / 2, "broadcast")).toBe(1);
    expect(dofAt(hero, run, b.end, "broadcast")).toBe(0);
    expect(dofAt(hero, run, b.end + 30, "broadcast")).toBe(0);
    expect(dofAt(hero, run, b.slowFrom - 2, "broadcast")).toBeGreaterThan(0);
    expect(dofAt(hero, run, b.slowFrom - 2, "broadcast")).toBeLessThan(1);
  });

  it("only on the broadcast camera: in first person every shirt number stays sharp", () => {
    expect(dofAt(hero, run, (b.slowFrom + b.slowTo) / 2, "pov")).toBe(0);
  });

  it("is off under reduced motion", () => {
    motion.set({ reduced: true });
    expect(dofAt(hero, run, (b.slowFrom + b.slowTo) / 2, "broadcast")).toBe(0);
  });

  it("focuses on the player the look is for once he is in sight; before that on the hero (broadcast) or ahead (first person)", () => {
    expect(focusOf(b, b.sighted! - 1, "broadcast")).toBe(b.observer);
    expect(focusOf(b, b.sighted! - 1, "pov")).toBe(-1);
    expect(focusOf(b, b.sighted! + 1, "pov")).toBe(b.target);
    expect(focusOf(b, b.sighted! + 1, "broadcast")).toBe(b.target);
  });
});

describe("depth of field eases (LOOKDEV 2b: a gentle focus pull, never a pop)", () => {
  /** Step `ease` at 60 Hz from `t0` for `seconds` towards `target`; the amounts drawn. */
  const run60 = (ease: DofEase, target: number, t0: number, seconds: number, cut = 1) => {
    const out: number[] = [];
    for (let k = 1; k <= Math.round(seconds * 60); k++)
      out.push(ease.step(target, t0 + k / 60, cut));
    return out;
  };

  it("takes at least half a second to come in, starting and ending gently", () => {
    expect(DOF_EASE_S).toBeGreaterThanOrEqual(0.5);
    const ease = new DofEase();
    expect(ease.step(1, 10, 1)).toBe(0); // the first frame has no elapsed time
    const inn = run60(ease, 1, 10, 1);
    const reached = inn.findIndex((v) => v >= 0.999);
    expect(reached / 60).toBeGreaterThanOrEqual(0.5);
    expect(inn.at(-1)).toBe(1);
    for (let k = 1; k < inn.length; k++) expect(inn[k]).toBeGreaterThanOrEqual(inn[k - 1]);
    // Eased in and out: the first and last steps are much smaller than the middle ones.
    const steps = inn.slice(0, reached + 1).map((v, k) => v - (k ? inn[k - 1] : 0));
    const most = Math.max(...steps);
    expect(steps[0]).toBeLessThan(most / 5);
    expect(steps[reached]).toBeLessThan(most / 5);
  });

  it("and at least half a second to go out", () => {
    const ease = new DofEase();
    ease.step(1, 0, 1);
    run60(ease, 1, 0, 1);
    const out = run60(ease, 0, 1, 1);
    expect(out.findIndex((v) => v <= 0.001) / 60).toBeGreaterThanOrEqual(0.5);
    expect(out.at(-1)).toBe(0);
  });

  it("is off at once around a cut, then comes in again from nothing", () => {
    const ease = new DofEase();
    ease.step(1, 0, 1);
    run60(ease, 1, 0, 1);
    expect(ease.step(1, 1.01, 0)).toBe(0); // the cut's frame is sharp
    expect(ease.step(1, 1.1, 0.5)).toBe(0); // and so is the ramp of the cut guard
    const back = run60(ease, 1, 1.1, 1);
    expect(back[0]).toBeLessThan(0.05);
    expect(back.findIndex((v) => v >= 0.999) / 60).toBeGreaterThanOrEqual(0.5);
  });

  it("does not jump after a pause or a hidden tab: a long gap counts as one short step", () => {
    const ease = new DofEase();
    ease.step(1, 0, 1);
    expect(ease.step(1, 30, 1)).toBeLessThan(0.1);
    expect(ease.moving(1)).toBe(true);
    run60(ease, 1, 30, 1);
    expect(ease.moving(1)).toBe(false);
  });
});

describe("the safety net on auto", () => {
  const feed = (meter: FrameMeter, fps: number, seconds: number, playing = true) => {
    let verdict: "keep" | "lower" = "keep";
    for (let t = 0; t < seconds; t += 1 / fps) {
      if (meter.frame(t, playing) === "lower") verdict = "lower";
    }
    return verdict;
  };

  it("asks for a lower tier when playback runs under 45 fps for long enough", () => {
    expect(feed(new FrameMeter(), 30, 4)).toBe("lower");
    expect(feed(new FrameMeter(), 58, 10)).toBe("keep");
    expect(feed(new FrameMeter(), 30, 1)).toBe("keep"); // too soon to tell
  });

  it("ignores frames while paused (the canvas only redraws on demand)", () => {
    expect(feed(new FrameMeter(), 2, 30, false)).toBe("keep");
  });

  it("steps high to medium to low, and only a tier the device was given", () => {
    quality.set({ tier: "high", source: "auto" });
    stepDown();
    expect(quality.get()).toEqual({ tier: "medium", source: "auto" });
    stepDown();
    expect(quality.get().tier).toBe("low");
    stepDown();
    expect(quality.get().tier).toBe("low"); // the look stays: low is the floor
    quality.set({ tier: "high", source: "viewer" });
    stepDown();
    expect(quality.get().tier).toBe("high"); // the viewer's choice stands
  });
});
