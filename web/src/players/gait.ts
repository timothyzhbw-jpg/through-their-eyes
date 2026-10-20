// Gait of a rigged player (SPEC 7 trial): which clip, how much of it and how fast, from the sim's
// running speed alone. Everything is a pure function of the playback frame, so pausing,
// scrubbing and slow motion pose the players exactly as playing through does.
//
// The converted clips (demo/grf/convert.py) have their root motion removed; their stride speed
// is the speed the feet move backwards relative to the hips at playback rate 1. Feet do not
// slide when that speed, scaled by blend weight and playback rate, equals the sim speed:
//   locomotion weight m = walk + sprint, rate r:  r * m * ((1 − s) Vwalk + s Vsprint) = v
// - from walk to sprint speed both clips play at full weight, mixed by s, at rate 1 at either end;
// - below the walk clip's speed (the engine's "walk" is a 5.25 m/s jog) m = r = sqrt(v / Vwalk):
//   blending with the idle pose shortens the stride while the cadence drops, so 1.5 m/s gives
//   about 2.2 steps a second with 0.67 m steps, a walk, instead of the jog in slow motion.
// The stride shrinks about linearly with the blend weight because the legs swing about the hips.

import { wrapAngle } from "../data/hero";
import type { ExportEvent } from "../data/types";

export interface GaitClips {
  walkSpeed: number; // m/s, the walk cycle's stride speed at rate 1
  sprintSpeed: number;
  cycle: number; // s, duration of both cycles (two steps), which share their phase
}

export interface GaitBlend {
  idle: number;
  walk: number;
  sprint: number;
  rate: number; // playback rate of the walk and sprint cycles
}

export function gaitBlend(speed: number, clips: GaitClips): GaitBlend {
  const v = Math.max(0, speed);
  const { walkSpeed: vw, sprintSpeed: vs } = clips;
  if (v >= vw) {
    const s = Math.min(1, (v - vw) / (vs - vw));
    return { idle: 0, walk: 1 - s, sprint: s, rate: v / (vw + s * (vs - vw)) };
  }
  const m = Math.sqrt(v / vw);
  return { idle: 1 - m, walk: m, sprint: 0, rate: m };
}

/** Speed the feet move relative to the hips for this blend: equals the sim speed (no sliding). */
export function footSpeed(b: GaitBlend, clips: GaitClips): number {
  return b.rate * (b.walk * clips.walkSpeed + b.sprint * clips.sprintSpeed);
}

/**
 * Cumulative gait phase per sim frame, in cycles: the integral of the playback rate. Sampled at
 * a fractional frame by linear interpolation, it gives the clip time phase * cycle.
 */
export function gaitPhase(speeds: Float32Array, dt: number, clips: GaitClips): Float64Array {
  const phase = new Float64Array(speeds.length);
  for (let f = 1; f < speeds.length; f++) {
    phase[f] = phase[f - 1] + (gaitBlend(speeds[f - 1], clips).rate * dt) / clips.cycle;
  }
  return phase;
}

/**
 * Running speed of player j per frame, m/s: central differences of the sim positions, averaged
 * over five frames (0.2 s) so the blend does not flicker. Index (frame * n + j) * 2 + xy.
 */
export function smoothedSpeeds(
  pos: Float32Array,
  n: number,
  j: number,
  frames: number,
  dt: number,
): Float32Array {
  const raw = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = Math.max(0, f - 1);
    const b = Math.min(frames - 1, f + 1);
    if (a === b) continue;
    const dx = pos[(b * n + j) * 2] - pos[(a * n + j) * 2];
    const dy = pos[(b * n + j) * 2 + 1] - pos[(a * n + j) * 2 + 1];
    raw[f] = Math.hypot(dx, dy) / ((b - a) * dt);
  }
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(frames - 1, f + 2); k++) {
      sum += raw[k];
      count++;
    }
    out[f] = sum / count;
  }
  return out;
}

export interface PassClip {
  duration: number; // s
  touch: number; // s, ball contact
  kickYaw: number; // rad, where the clip sends the ball, from the model's forward (+ left)
}

export interface Pass {
  frame: number; // the pass event: the ball leaves the foot
  yaw: number; // rad, pitch yaw from the passer to the pass target
}

export const PASS_FADE = 0.12; // s, cross-fade between the gait and the pass clip
export const FACE_LEAD = 0.3; // s, the body turns to the pass this long before and after the clip

/** Pass events per player index (pass events name the passer; start and target in m). */
export function passEvents(events: ExportEvent[], ids: string[]): Pass[][] {
  const out: Pass[][] = ids.map(() => []);
  for (const e of events) {
    const j = ids.indexOf(e.player);
    if (e.type !== "pass" || j < 0) continue;
    const [sx, sy] = e.attrs.start as [number, number];
    const [tx, ty] = e.attrs.target as [number, number];
    out[j].push({ frame: e.frame, yaw: Math.atan2(ty - sy, tx - sx) });
  }
  return out;
}

/**
 * The pass clip's time and weight at fractional frame f: the clip's ball contact lands on the
 * pass event's frame; it fades in over its first PASS_FADE seconds and out over its last.
 * `facing` weighs the turn towards the pass (passFacing): it starts FACE_LEAD seconds before the
 * clip and ends FACE_LEAD seconds after it, so the body does not spin round in three frames.
 */
export function passPose(
  f: number,
  passes: Pass[],
  dt: number,
  clip: PassClip,
): { time: number; weight: number; facing: number; yaw: number } {
  for (const pass of passes) {
    const time = (f - pass.frame) * dt + clip.touch;
    if (time < -FACE_LEAD || time > clip.duration + FACE_LEAD) continue;
    const inClip = time >= 0 && time <= clip.duration;
    const weight = inClip ? Math.min(1, time / PASS_FADE, (clip.duration - time) / PASS_FADE) : 0;
    const ramp = FACE_LEAD + PASS_FADE;
    const facing = Math.min(
      1,
      (time + FACE_LEAD) / ramp,
      (clip.duration + FACE_LEAD - time) / ramp,
    );
    return { time: Math.min(Math.max(time, 0), clip.duration), weight, facing, yaw: pass.yaw };
  }
  return { time: 0, weight: 0, facing: 0, yaw: 0 };
}

/**
 * Body yaw while the pass clip plays. The clip kicks the ball `kickYaw` off the model's forward,
 * but the sim's passer can face anywhere (seed 3: H8 faces 180° and passes at −4°), so for the
 * clip's duration the body turns, by the pose's facing weight, until the kick goes along the
 * pass. Outside that window this is body_yaw.
 */
export function passFacing(
  bodyYaw: number,
  pose: { facing: number; yaw: number },
  clip: PassClip,
): number {
  if (pose.facing <= 0) return bodyYaw;
  return bodyYaw + wrapAngle(pose.yaw - clip.kickYaw - bodyYaw) * pose.facing;
}
