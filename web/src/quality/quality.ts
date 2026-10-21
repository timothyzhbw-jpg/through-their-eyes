// Render quality of the 3D view (SPEC 7). Three tiers:
// - standard: the scene drawn straight to the canvas (sprites for glow, decals for shadows), as
//   it has been; the fallback, and what a software renderer gets;
// - medium (phones, older integrated GPUs): a post chain with bloom, depth of field through the
//   key-moment slow motion, SMAA and image-based lighting, without ambient occlusion or shadows;
// - high (desktop GPUs): the above plus ambient occlusion (GTAO) and soft shadow-mapped players.
// The tier comes from the device (renderer string, memory, phone or not), a link
// (`?quality=high|medium|standard|auto`) or the viewer's choice in View options, in that order of
// precedence from last to first. Until the high tier has proven itself on fps the default is
// standard: `?quality=auto` (or the switch) opts in.

import { beatAt, beatsOf, beatWeight, motion, type Beat } from "../beat/beat";
import type { Hero, Run } from "../data/hero";
import { createStore } from "../store/store";

export type Tier = "standard" | "medium" | "high";
export const TIERS: readonly Tier[] = ["standard", "medium", "high"];
export type QualitySource = "default" | "auto" | "link" | "viewer";

/** Whether the device's tier is used when neither a link nor the viewer chose one. */
export const AUTO_BY_DEFAULT = false;

export interface Device {
  renderer: string; // WebGL's unmasked renderer
  mobile: boolean;
  dpr: number;
  deviceMemory: number | undefined; // GB, Chrome only
}

/** The tier a device can carry at 60 fps. */
export function detectTier(d: Device): Tier {
  const r = d.renderer.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(r)) return "standard";
  if (d.mobile) return d.deviceMemory !== undefined && d.deviceMemory <= 3 ? "standard" : "medium";
  if (d.deviceMemory !== undefined && d.deviceMemory <= 2) return "medium";
  // Integrated PC graphics. On an Apple M4 Pro at 1080p the high tier runs at about 128 fps
  // uncapped (medium 140–160, standard 200–300); an Iris Xe or an AMD APU is several times
  // slower, so it gets medium, and older Intel UHD / HD graphics the standard pipeline.
  if (/intel/.test(r)) return /iris|arc/.test(r) ? "medium" : "standard";
  if (/radeon\(tm\) graphics|radeon graphics|vega/.test(r)) return "medium";
  return "high";
}

/** `?quality=` of a link: a tier, "auto" (the device's), or null when absent or unknown. */
export function parseQuality(search: string): Tier | "auto" | null {
  const v = new URLSearchParams(search).get("quality");
  if (v === "auto") return "auto";
  return TIERS.find((t) => t === v) ?? null;
}

export interface Features {
  post: boolean; // the post chain at all (HDR buffer, tone mapping at the end)
  ao: boolean;
  bloom: boolean;
  dof: boolean;
  smaa: boolean;
  environment: boolean; // image-based lighting
  shadows: boolean;
}

const NONE: Features = {
  post: false,
  ao: false,
  bloom: false,
  dof: false,
  smaa: false,
  environment: false,
  shadows: false,
};

export function featuresOf(tier: Tier, reduced: boolean): Features {
  if (tier === "standard") return NONE;
  const high = tier === "high";
  return {
    post: true,
    ao: high,
    bloom: true,
    dof: !reduced,
    smaa: true,
    environment: true,
    shadows: high,
  };
}

/**
 * How much depth of field at frame `f` (0..1): the key-moment beat's slow motion only, and only
 * on the broadcast camera. In first person the shirt numbers float in front of the stands, so a
 * depth of field from the scene's depth would blur them with the stands: what he sees stays sharp.
 */
export function dofAt(hero: Hero, run: Run, f: number, camera: "pov" | "broadcast"): number {
  if (motion.get().reduced || camera !== "broadcast") return 0;
  const b = beatAt(beatsOf(hero, run), f);
  return b ? beatWeight(b, f) : 0;
}

/**
 * Whom the depth of field holds sharp: the player the look is for from the moment he is in
 * sight; before that the hero on the broadcast camera, and in first person -1 (a point ahead).
 */
export function focusOf(b: Beat, f: number, camera: "pov" | "broadcast"): number {
  if (b.sighted !== null && b.target >= 0 && f >= b.sighted) return b.target;
  return camera === "broadcast" ? b.observer : -1;
}

/**
 * The safety net of an automatic tier: playing frames are timed (paused, the canvas only
 * redraws on demand, so those gaps say nothing), and when they average under MIN_FPS over
 * WINDOW_S of play the tier should come down.
 */
export const MIN_FPS = 45;
const WINDOW_S = 2.5;
const MAX_GAP_S = 0.25; // a longer gap is a pause, a seek or a hidden tab: not a slow frame

export class FrameMeter {
  private last: number | null = null;
  private played = 0;
  private frames = 0;

  /** One drawn frame at wall time `t` (s); "lower" once play has been too slow for long enough. */
  frame(t: number, playing: boolean): "keep" | "lower" {
    const gap = this.last === null ? null : t - this.last;
    this.last = t;
    if (!playing || gap === null || gap > MAX_GAP_S) return "keep";
    this.played += gap;
    this.frames += 1;
    if (this.played < WINDOW_S) return "keep";
    const fps = this.frames / this.played;
    this.played = 0;
    this.frames = 0;
    return fps < MIN_FPS ? "lower" : "keep";
  }
}

/** One tier down, for an automatic tier only: a link's or the viewer's choice stands. */
export function stepDown(): void {
  const { tier, source } = quality.get();
  if (source !== "auto" && source !== "default") return;
  const lower = TIERS[Math.max(0, TIERS.indexOf(tier) - 1)];
  if (lower !== tier) quality.set({ tier: lower, source: "auto" });
}

/** The device as the browser describes it; null outside a browser or without WebGL. */
export function browserDevice(): Device | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  let renderer = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return null;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) ||
    (nav.maxTouchPoints > 1 && window.matchMedia?.("(pointer: coarse)").matches);
  return { renderer, mobile, dpr: window.devicePixelRatio || 1, deviceMemory: nav.deviceMemory };
}

/** The tier the device gets by itself (standard where it cannot be told). */
export function autoTier(): Tier {
  const device = browserDevice();
  return device ? detectTier(device) : "standard";
}

function initial(): { tier: Tier; source: QualitySource } {
  const link = typeof window === "undefined" ? null : parseQuality(window.location.search);
  if (link === "auto") return { tier: autoTier(), source: "auto" };
  if (link) return { tier: link, source: "link" };
  return AUTO_BY_DEFAULT
    ? { tier: autoTier(), source: "auto" }
    : { tier: "standard", source: "default" };
}

/** The 3D view's render quality, page-wide. */
export const quality = createStore<{ tier: Tier; source: QualitySource }>(initial());

export function setTier(tier: Tier, source: QualitySource = "viewer"): void {
  quality.set({ tier, source });
}
