// Motion blur of the first-person view (SPEC 7, the Floodlit design): when the head whips round,
// the picture smears sideways as a camera's would, and it is sharp the instant the head stops.
//
// The view is filmed as if by a camera running at the sim's 25 Hz with a 180-degree shutter: each
// frame is exposed for 1/50 s of match time. A head turning at w deg/s sweeps w / 50 degrees in
// that time; at the image centre that is (w / 50) * px-per-degree pixels. A box blur of length L
// has a standard deviation of L / sqrt(12), about 0.3 L, so the horizontal Gaussian has
//   sigma = 0.3 * |w| * (shutter / 360 / 25 s) * px-per-degree,
// capped at 3% of the image width. Turning the head is a rotation about the vertical axis, so the
// image moves sideways: the blur is horizontal. The rate is the measured head yaw rate of the
// player whose eyes these are, in match time, so a slow-motion replay keeps the blur a broadcast
// replay would have. Off under prefers-reduced-motion and on the broadcast camera.

import { easedHeadAt, wrapAngle, type Hero, type Run } from "../data/hero";
import type { Camera3D } from "../store/playback";

export const SHUTTER_DEG = 180;
export const CAPTURE_HZ = 25; // the sim's frame rate
export const SIGMA_PER_SWEEP = 0.3; // sigma of a box blur over the sweep, as a fraction of it
export const MAX_SIGMA_FRACTION = 0.03; // of the image width
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

/** The blur on the first-person view right now: 0 under reduced motion or on another camera. */
export function povBlurSigmaPx(o: {
  reducedMotion: boolean;
  camera: Camera3D;
  yawRate: number; // rad/s
  widthPx: number; // drawing-buffer width
  hfovDeg: number;
}): number {
  if (o.reducedMotion || o.camera !== "pov") return 0;
  return blurSigmaPx(o.yawRate, centrePxPerDeg(o.widthPx, o.hfovDeg));
}

export interface Taps {
  offsets: number[]; // px, symmetric about 0
  weights: number[]; // Gaussian, summing to 1
}

/** 2 * perSide + 1 Gaussian taps spanning +-3 sigma. */
export function gaussianTaps(sigma: number, perSide = TAPS_PER_SIDE): Taps {
  const step = (TAP_SPAN * sigma) / perSide;
  const offsets: number[] = [];
  const raw: number[] = [];
  for (let k = -perSide; k <= perSide; k++) {
    const x = k * step;
    offsets.push(x === 0 ? 0 : x); // no -0
    raw.push(Math.exp(-(x * x) / (2 * sigma * sigma)));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return { offsets, weights: raw.map((w) => w / sum) };
}

export interface BlurPlan extends Taps {
  passes: 0 | 1 | 2; // 0: draw the frame sharp
  sigma: number; // px, after the cap
  perPass: number; // sigma of each pass: passes in a row add their variances
}

/**
 * How to draw a blur of `sigmaPx` on an image `widthPx` wide. Two passes of 17 taps each when
 * the taps of one would be more than ~1 px apart: the second pass smooths the comb of the first.
 */
export function blurPlan(sigmaPx: number, widthPx: number): BlurPlan {
  const sigma = Math.min(sigmaPx, MAX_SIGMA_FRACTION * widthPx);
  if (!(sigma >= MIN_SIGMA_PX))
    return { passes: 0, sigma: 0, perPass: 0, offsets: [], weights: [] };
  const passes = sigma <= SINGLE_PASS_MAX_SIGMA ? 1 : 2;
  const perPass = sigma / Math.sqrt(passes);
  return { passes, sigma, perPass, ...gaussianTaps(perPass) };
}
