// Motion blur of the first-person view (SPEC 7, the Floodlit design): when the head whips round,
// the picture smears sideways as a camera's would, and it is sharp the instant the head stops.
//
// The view is filmed as if by a camera running at the sim's 25 Hz with a 90-degree shutter: each
// frame is exposed for 1/100 s of match time. A head turning at w deg/s sweeps w / 100 degrees in
// that time; at the image centre that is (w / 100) * px-per-degree pixels. A box blur of length L
// has a standard deviation of L / sqrt(12), about 0.3 L, so the horizontal Gaussian has
//   sigma = 0.3 * |w| * (shutter / 360 / 25 s) * px-per-degree,
// capped at 0.3% of the image width (about 6 px at 1920): a subtle smear, not a streak (the art
// direction, LOOKDEV 2b). Turning the head is a rotation about the vertical axis, so the
// image moves sideways: the blur is horizontal. The rate is the measured head yaw rate of the
// player whose eyes these are, in match time, so a slow-motion replay keeps the blur a broadcast
// replay would have. Off under prefers-reduced-motion, on the broadcast camera and while paused.

import { easedHeadAt, wrapAngle, type Hero, type Run } from "../data/hero";
import type { Camera3D } from "../store/playback";

export const SHUTTER_DEG = 90; // a subtle smear (LOOKDEV 2b: blur is uncomfortable)
export const CAPTURE_HZ = 25; // the sim's frame rate
export const SIGMA_PER_SWEEP = 0.3; // sigma of a box blur over the sweep, as a fraction of it
export const MAX_SIGMA_FRACTION = 0.003; // of the image width: about 6 px at 1920
export const MIN_SIGMA_PX = 0.5; // below this the frame is drawn sharp, without the pass
export const TAPS_PER_SIDE = 8;
const TAP_SPAN = 3; // taps reach +-3 sigma
/** Up to this sigma one pass of taps is under ~1 px apart; wider blurs take two passes. */
export const SINGLE_PASS_MAX_SIGMA = 3;

/** Head yaw of player j at fractional frame f, rad, as the view draws it (linear or eased). */
function headAt(hero: Hero, run: Run, j: number, f: number, eased: boolean): number {
  if (eased) return easedHeadAt(hero, run, j, f);
  const c = Math.max(0, Math.min(run.frames - 1, f));
  const i0 = Math.floor(c);
  const i1 = Math.min(run.frames - 1, i0 + 1);
  const a = run.head[i0 * hero.n + j];
  return a + wrapAngle(run.head[i1 * hero.n + j] - a) * (c - i0);
}

/**
 * Head yaw rate of player j at fractional frame f, rad per second of match time: a central
 * difference over half a frame either side of the head track the view draws (`eased` in comfort
 * mode), so it is continuous in f.
 */
export function headYawRate(hero: Hero, run: Run, j: number, f: number, eased: boolean): number {
  const d = 0.5;
  const turn = wrapAngle(headAt(hero, run, j, f + d, eased) - headAt(hero, run, j, f - d, eased));
  return turn / (2 * d * hero.dt);
}

/** Pixels per degree at the centre of a rectilinear view `widthPx` wide with this field of view. */
export function centrePxPerDeg(widthPx: number, hfovDeg: number): number {
  const focal = widthPx / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  return (focal * Math.PI) / 180;
}

/** Sigma of the horizontal blur, px, for a head turning at `yawRate` rad/s. */
export function blurSigmaPx(yawRate: number, pxPerDeg: number, shutterDeg = SHUTTER_DEG): number {
  const degPerS = (Math.abs(yawRate) * 180) / Math.PI;
  const exposure = shutterDeg / 360 / CAPTURE_HZ;
  return SIGMA_PER_SWEEP * degPerS * exposure * pxPerDeg;
}

/**
 * The blur on the first-person view right now: 0 under reduced motion, on another camera, or
 * while paused.
 */
export function povBlurSigmaPx(o: {
  reducedMotion: boolean;
  camera: Camera3D;
  playing: boolean; // a paused frame is a still: no motion, no blur
  yawRate: number; // rad/s
  widthPx: number; // drawing-buffer width
  hfovDeg: number;
}): number {
  if (o.reducedMotion || o.camera !== "pov" || !o.playing) return 0;
  return blurSigmaPx(o.yawRate, centrePxPerDeg(o.widthPx, o.hfovDeg));
}

export interface Taps {
  offsets: number[]; // px, symmetric about 0
  weights: readonly number[]; // Gaussian, summing to 1
}

const weightCache = new Map<number, readonly number[]>();

/** Tap positions scale with sigma, so normalized Gaussian weights depend only on the tap count. */
function gaussianWeights(perSide: number): readonly number[] {
  const cached = weightCache.get(perSide);
  if (cached) return cached;
  const weights = new Array<number>(2 * perSide + 1);
  let sum = 0;
  for (let k = -perSide; k <= perSide; k++) {
    const x = (k * TAP_SPAN) / perSide;
    const weight = Math.exp(-(x * x) / 2);
    weights[k + perSide] = weight;
    sum += weight;
  }
  for (let k = 0; k < weights.length; k++) weights[k] /= sum;
  weightCache.set(perSide, weights);
  return weights;
}

function writeOffsets(sigma: number, perSide: number, offsets: number[]) {
  const step = (TAP_SPAN * sigma) / perSide;
  for (let k = -perSide; k <= perSide; k++) {
    const x = k * step;
    offsets[k + perSide] = x === 0 ? 0 : x; // no -0
  }
}

/** 2 * perSide + 1 Gaussian taps spanning +-3 sigma. */
export function gaussianTaps(sigma: number, perSide = TAPS_PER_SIDE): Taps {
  const offsets = new Array<number>(2 * perSide + 1);
  writeOffsets(sigma, perSide, offsets);
  return { offsets, weights: gaussianWeights(perSide) };
}

export interface BlurPlan extends Taps {
  passes: 0 | 1 | 2; // 0: draw the frame sharp
  sigma: number; // px, after the cap
  perPass: number; // sigma of each pass: passes in a row add their variances
}

/**
 * How to draw a blur of `sigmaPx` on an image `widthPx` wide. Two passes of 17 taps each when
 * the taps of one would be more than ~1 px apart: the second pass smooths the comb of the first.
 * Pass the previous plan to reuse its buffers in a frame loop.
 */
export function blurPlan(sigmaPx: number, widthPx: number, into?: BlurPlan): BlurPlan {
  const plan: BlurPlan = into ?? { passes: 0, sigma: 0, perPass: 0, ...gaussianTaps(0) };
  const sigma = Math.min(sigmaPx, MAX_SIGMA_FRACTION * widthPx);
  if (!(sigma >= MIN_SIGMA_PX)) {
    plan.passes = 0;
    plan.sigma = 0;
    plan.perPass = 0;
    return plan;
  }
  const passes = sigma <= SINGLE_PASS_MAX_SIGMA ? 1 : 2;
  const perPass = sigma / Math.sqrt(passes);
  if (plan.perPass !== perPass) writeOffsets(perPass, TAPS_PER_SIDE, plan.offsets);
  plan.passes = passes;
  plan.sigma = sigma;
  plan.perPass = perPass;
  return plan;
}
