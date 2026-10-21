// @vitest-environment happy-dom
// Motion blur in first person (SPEC 7, the Floodlit design): a horizontal blur whose strength
// follows the measured head angular velocity, sharp the instant the head stops, never under
// prefers-reduced-motion and never on the broadcast camera.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import * as motionBlur from "./motionBlur";
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
import { MotionBlur } from "./PovMotionBlur";

const hooks = vi.hoisted(() => ({
  state: null as unknown,
  view: null as unknown,
  frame: null as unknown,
}));
vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: unknown) => unknown) => select(hooks.state),
  useFrame: (draw: unknown) => {
    hooks.frame = draw;
  },
}));
vi.mock("../session", () => ({ useView: () => hooks.view }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

const hero = parseHero(raw);
const run = hero.runs.factual;
const h8 = hero.ids.indexOf("H8");
const deg = (rad: number) => (rad * 180) / Math.PI;

function blurFrame(width: number, height: number, dpr: number, reducedMotion = false) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  const playback = { povPlayer: "H8", mode: "factual", frame: 54.5, comfort: false, camera: "pov" };
  const gl = {
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(width, height),
    getPixelRatio: () => dpr,
    extensions: { has: () => true },
    domElement: { dataset: {} as Record<string, string> },
    setRenderTarget: vi.fn<(target: THREE.WebGLRenderTarget | null) => void>(),
    render: vi.fn<(scene: THREE.Scene, camera: THREE.Camera) => void>(),
  };
  hooks.state = { gl, invalidate: vi.fn() };
  hooks.view = { hero, playback: { get: () => playback } };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(MotionBlur, { hfov: (95 * Math.PI) / 180 })));
  mounted.push({ root, container });
  const draw = () =>
    (hooks.frame as (state: unknown) => void)({
      gl,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
    });
  return { gl, playback, draw };
}

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
  it("reuses a caller's tap buffers while the blur changes, stops, and starts again", () => {
    const plan = blurPlan(2, 1600);
    const offsets = plan.offsets;
    const weights = plan.weights;
    expect(blurPlan(40, 1600, plan)).toBe(plan);
    expect(plan.offsets).toBe(offsets);
    expect(plan.weights).toBe(weights);
    expect(plan.passes).toBe(2);
    expect(Math.sqrt(2) * spread(plan)).toBeGreaterThan(0.97 * 40);
    expect(blurPlan(0, 1600, plan)).toBe(plan);
    expect(plan.passes).toBe(0);
    expect(blurPlan(1, 1600, plan)).toBe(plan);
    expect(plan.offsets).toBe(offsets);
    expect(plan.weights).toBe(weights);
    expect(spread(plan)).toBeCloseTo(1, 1);
  });

  it("shares the precomputed normalized Gaussian weights across sigma values", () => {
    const narrow = gaussianTaps(1);
    const wide = gaussianTaps(20);
    expect(wide.weights).toBe(narrow.weights);
    expect(spread(narrow)).toBeCloseTo(1, 1);
    expect(spread(wide)).toBeGreaterThan(0.97 * 20);
  });

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

describe("motion blur GPU budget", () => {
  it.each([
    [3200, 1800, 2, 1600, 900],
    [5120, 2880, 2, 1920, 1080],
    [2560, 1440, 1, 1920, 1080],
    [900, 600, 0.75, 900, 600],
  ])("caps a %s x %s canvas at DPR %s to %s x %s", (width, height, dpr, w, h) => {
    const { gl, draw } = blurFrame(width, height, dpr);
    draw();
    const target = gl.setRenderTarget.mock.calls[0][0] as THREE.WebGLRenderTarget;
    expect(target.width).toBe(w);
    expect(target.height).toBe(h);
    expect(target.samples).toBe(0);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    expect(target.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect((target as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget).toBe(true);
    const mid = gl.setRenderTarget.mock.calls[1][0] as THREE.WebGLRenderTarget;
    expect(mid.width).toBe(w);
    expect(mid.height).toBe(h);
    expect(mid.samples).toBe(0);
    const quad = gl.render.mock.calls.at(-1)![0] as THREE.Scene;
    const material = (quad.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    // Taps remain in canvas pixels, preserving the blur's apparent width after downsampling.
    expect(material.uniforms.uTexel.value).toBe(1 / width);
  });

  it("keeps the original sub-pixel bypass threshold when the target is downsampled", () => {
    const sigma = vi.spyOn(motionBlur, "povBlurSigmaPx").mockReturnValue(0.75);
    const { gl, draw } = blurFrame(3200, 1800, 2);
    draw();
    expect(gl.setRenderTarget.mock.calls[0][0]).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(gl.domElement.dataset.blurSigma).toBe("0.8");
    sigma.mockReturnValue(MIN_SIGMA_PX * 0.99);
    gl.setRenderTarget.mockClear();
    gl.render.mockClear();
    draw();
    expect(gl.setRenderTarget.mock.calls).toEqual([[null]]);
    expect(gl.render).toHaveBeenCalledTimes(1);
  });

  it.each(["reduced motion", "broadcast", "stationary head"])(
    "draws straight to the canvas for %s",
    (bypass) => {
      const { gl, playback, draw } = blurFrame(3200, 1800, 2, bypass === "reduced motion");
      if (bypass === "broadcast") playback.camera = "broadcast";
      if (bypass === "stationary head") playback.frame = 60;
      draw();
      expect(gl.setRenderTarget.mock.calls).toEqual([[null]]);
      expect(gl.render).toHaveBeenCalledTimes(1);
      expect(gl.domElement.dataset.blurSigma).toBe("0");
    },
  );
});
