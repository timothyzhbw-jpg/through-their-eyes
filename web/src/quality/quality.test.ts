// Render quality tiers (SPEC 7): which tier a device gets, how a link or the viewer overrides it,
// what each tier draws, and depth of field only through the key-moment slow motion.

import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { beatsOf, motion } from "../beat/beat";
import { parseHero } from "../data/hero";
import {
  detectTier,
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
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)", desktop, "standard"],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)", desktop, "medium"],
    ["Apple GPU", { mobile: true, dpr: 3, deviceMemory: undefined }, "medium"],
    ["Adreno (TM) 740", { mobile: true, dpr: 3, deviceMemory: 8 }, "medium"],
    ["Mali-G57", { mobile: true, dpr: 2, deviceMemory: 3 }, "standard"],
    [
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)",
      { ...desktop, deviceMemory: 2 },
      "medium",
    ],
    [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      desktop,
      "standard",
    ],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", desktop, "standard"],
  ] as const)("%s → %s", (renderer, device, tier) => {
    expect(detectTier({ renderer, ...device })).toBe(tier);
  });

  it("reads ?quality= from a link", () => {
    expect(parseQuality("?quality=high")).toBe("high");
    expect(parseQuality("?at=60&quality=medium")).toBe("medium");
    expect(parseQuality("?quality=standard")).toBe("standard");
    expect(parseQuality("?quality=auto")).toBe("auto");
    expect(parseQuality("?quality=ultra")).toBeNull();
    expect(parseQuality("")).toBeNull();
  });

  it("lets the viewer choose over the link and the detection", () => {
    setTier("high", "viewer");
    expect(quality.get()).toEqual({ tier: "high", source: "viewer" });
  });

  it("draws everything at high, no ambient occlusion or shadows at medium, nothing extra at standard", () => {
    expect(featuresOf("high", false)).toEqual({
      post: true,
      ao: true,
      bloom: true,
      dof: true,
      smaa: true,
      environment: true,
      shadows: true,
    });
    expect(featuresOf("medium", false)).toMatchObject({
      post: true,
      ao: false,
      shadows: false,
      bloom: true,
      dof: true,
      smaa: true,
      environment: true,
    });
    expect(Object.values(featuresOf("standard", false)).some(Boolean)).toBe(false);
  });

  it("turns depth of field off under reduced motion", () => {
    expect(featuresOf("high", true).dof).toBe(false);
    expect(featuresOf("medium", true).dof).toBe(false);
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

  it("steps high to medium to standard, and only a tier the device was given", () => {
    quality.set({ tier: "high", source: "auto" });
    stepDown();
    expect(quality.get()).toEqual({ tier: "medium", source: "auto" });
    stepDown();
    expect(quality.get().tier).toBe("standard");
    quality.set({ tier: "high", source: "viewer" });
    stepDown();
    expect(quality.get().tier).toBe("high"); // the viewer's choice stands
  });
});
