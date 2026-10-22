// Gait of a rigged player (SPEC 7): which clip, how much of it and how fast, from the sim's
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
//
// With the walk (walk.ts; with the extra clips, not under `?anims=base` or `?walk=0`) a real
// walk, the stroll (1.0 m/s, a 1.33 s cycle), takes the slow speeds. A walk and a jog do not blend by speed: a walking foot
// is down for 60% of the cycle, a jogging one for 30%, so in a mix the planted foot stops
// moving back with the ground while the jog's leg swings through, and skates forward (measured:
// 17-36 cm a step at 1.4-2.6 m/s, whatever the band). So a player is in one of two gaits, as
// people are, with hysteresis: the walk (idle -> stroll by sqrt(v / Vstroll) as above, then the
// stroll alone, its cadence rising), or from RUN_UP the engine's clips as before, until the
// speed drops below RUN_DOWN. A change of gait cross-fades over GAIT_FADE seconds (gaitRun,
// computed along the run, so poses stay a function of the frame). Every cycle plays on the one
// gait phase, the stroll shifted so its left-foot strike lands on the engine clips' (`offset`).
// Per cycle each clip covers its stride L = V * T; the phase advances
//   w = v / ((1 - c) Swalk + c Srun)
// cycles a second, S each gait's blended stride, c the run weight: the feet keep the sim speed
// on average through a cross-fade too.

import { wrapAngle } from "../data/hero";
import type { ExportEvent } from "../data/types";

/** The real walk (anims_walk.glb, walk.ts). */
export interface StrollClip {
  speed: number; // m/s, stride speed at rate 1
  cycle: number; // s, two steps
  offset: number; // cycles: at gait phase p the clip is at frac(p + offset) of its cycle
}

export interface GaitClips {
  walkSpeed: number; // m/s, the walk cycle's stride speed at rate 1
  sprintSpeed: number;
  cycle: number; // s, duration of both cycles (two steps), which share their phase
  stroll?: StrollClip | null; // the walk, for the walking gait
}

export interface GaitBlend {
  idle: number;
  stroll: number;
  walk: number;
  sprint: number;
  // Playback rate of the walk and sprint cycles; the gait phase advances rate / cycle cycles a
  // second, and the stroll plays at rate * stroll.cycle / cycle.
  rate: number;
}

/** A walker breaks into the jog above RUN_UP (m/s) and walks again below RUN_DOWN. */
export const RUN_UP = 1.7; // the stroll at 1.7x: 2.5 steps a second
export const RUN_DOWN = 1.3;
export const GAIT_FADE = 0.25; // s

/** The engine's clips alone: idle, walk (a jog) and sprint. */
function engineBlend(v: number, clips: GaitClips): GaitBlend {
  const { walkSpeed: vw, sprintSpeed: vs } = clips;
  if (v >= vw) {
    const s = Math.min(1, (v - vw) / (vs - vw));
    return { idle: 0, stroll: 0, walk: 1 - s, sprint: s, rate: v / (vw + s * (vs - vw)) };
  }
  const m = Math.sqrt(v / vw);
  return { idle: 1 - m, stroll: 0, walk: m, sprint: 0, rate: m };
}

/**
 * The blend at a sim speed. `run` weighs the engine's gait against the walking gait (gaitRun);
 * without the extra walk only the engine's clips play, whatever `run` says.
 */
export function gaitBlend(speed: number, clips: GaitClips, run = 1): GaitBlend {
  const v = Math.max(0, speed);
  const st = clips.stroll;
  if (!st || run >= 1) return engineBlend(v, clips);
  if (v === 0) return { idle: 1, stroll: 0, walk: 0, sprint: 0, rate: 0 };
  const T = clips.cycle;
  const m = Math.min(1, Math.sqrt(v / st.speed)); // the stroll's weight in the walking gait
  const walkStride = m * st.speed * st.cycle; // m per cycle
  const c = Math.max(0, run);
  if (c === 0) {
    return { idle: 1 - m, stroll: m, walk: 0, sprint: 0, rate: (v / walkStride) * T };
  }
  const e = engineBlend(v, clips);
  const runStride = (v * T) / e.rate;
  return {
    idle: (1 - c) * (1 - m) + c * e.idle,
    stroll: (1 - c) * m,
    walk: c * e.walk,
    sprint: c * e.sprint,
    rate: (v / ((1 - c) * walkStride + c * runStride)) * T,
  };
}

/** Speed the feet move relative to the hips for this blend: equals the sim speed (no sliding). */
export function footSpeed(b: GaitBlend, clips: GaitClips): number {
  const engine = b.rate * (b.walk * clips.walkSpeed + b.sprint * clips.sprintSpeed);
  const st = clips.stroll;
  return st ? engine + ((b.rate * st.cycle) / clips.cycle) * b.stroll * st.speed : engine;
}

/** The stroll's clip time (s) at cumulative gait phase `phase` (cycles). */
export function strollTime(phase: number, stroll: StrollClip): number {
  const u = phase + stroll.offset;
  return (u - Math.floor(u)) * stroll.cycle;
}

/**
 * The engine gait's weight per frame (0 walking, 1 running): a walker starts running when the
 * speed passes RUN_UP and walks again below RUN_DOWN; each change eases over GAIT_FADE seconds.
 */
export function gaitRun(speeds: Float32Array, dt: number): Float32Array {
  const out = new Float32Array(speeds.length);
  let running = speeds.length > 0 && speeds[0] > RUN_UP;
  let w = running ? 1 : 0;
  const step = dt / GAIT_FADE;
  for (let f = 0; f < speeds.length; f++) {
    if (!running && speeds[f] > RUN_UP) running = true;
    else if (running && speeds[f] < RUN_DOWN) running = false;
    w = running ? Math.min(1, w + step) : Math.max(0, w - step);
    out[f] = w * w * (3 - 2 * w);
  }
  return out;
}

/**
 * Cumulative gait phase per sim frame, in cycles: the integral of the playback rate. Sampled at
 * a fractional frame by linear interpolation, it gives the clip time phase * cycle. `run` is
 * gaitRun's weight per frame (the engine's gait throughout when omitted).
 */
export function gaitPhase(
  speeds: Float32Array,
  dt: number,
  clips: GaitClips,
  run?: Float32Array,
): Float64Array {
  const phase = new Float64Array(speeds.length);
  for (let f = 1; f < speeds.length; f++) {
    const b = gaitBlend(speeds[f - 1], clips, run ? run[f - 1] : 1);
    phase[f] = phase[f - 1] + (b.rate * dt) / clips.cycle;
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
