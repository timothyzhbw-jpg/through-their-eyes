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
  // The retargeted kick's own geometry (extra.ts; the engine's standing pass has none), in the
  // model's frame at its own scale (m, x forward, z to its right): the plant foot stands still
  // at `plant.at` from `plant.time` (s) to the end; the ball's centre at the touch; the kicking
  // foot is down again at `land` (s). The clip plays in place; `root` is the body's travel over
  // the plant foot (the capture's), which the rig applies by moving the body (rig.ts): `plant`
  // and `contact` are with it.
  plant?: { time: number; at: [number, number] };
  contact?: [number, number];
  land?: number;
  root?: { fps: number; xz: [number, number][] };
}

/** The kick's body travel at clip time t (m, model frame), held after the clip; zero without. */
export function rootAt(clip: PassClip, t: number, out: [number, number]): [number, number] {
  const r = clip.root;
  if (!r) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const x = Math.max(0, Math.min(r.xz.length - 1, t * r.fps));
  const i = Math.floor(x);
  const j = Math.min(r.xz.length - 1, i + 1);
  const u = x - i;
  out[0] = r.xz[i][0] + (r.xz[j][0] - r.xz[i][0]) * u;
  out[1] = r.xz[i][1] + (r.xz[j][1] - r.xz[i][1]) * u;
  return out;
}

/** A pass (or shot) event of one player. */
export interface Pass {
  frame: number; // the pass event: the ball leaves the foot
  yaw: number; // rad, pitch yaw from the ball to the pass target (a shot: to its aim)
  start: [number, number]; // m, the sim's ball as it leaves the foot
}

// A kick, in the order it plays, at rate 1 (never stretched; τ = seconds from the pass event):
// - the turn: before the wind-up, body_yaw turns to the kick's facing (the yaw that sends the
//   clip's kick along the pass) at TURN_RATE, at least TURN_MIN long, in quick hops (kickHop);
//   the gait plays on, so a slow carry before the pass is still the gait;
// - the wind-up: the clip from WINDUP before its ball contact, which lands on the pass event's
//   frame (τ = 0); it fades in over PASS_FADE, its plant foot in the air;
// - the body is anchored on the plant foot's spot from the wind-up through the follow-through
//   (rig.ts): it travels over that foot as in the capture (`root`), and the sim's passer moving
//   off, or the hips' share of a look, cannot slide it. The follow-through is held until the
//   kicking foot is down again (`land`), or, when the sim's passer runs on, until he is
//   LEAVE_GAP from his spot (pass and move; at least HOLD_MIN after the contact);
// - the release: the clip fades into the gait, the body turns back to body_yaw and the anchor
//   lets go over LOCK_RELEASE.
// The feet change pose in the air: a STEP_HOP lift over each cross-fade with the gait.
// The ball (kickBall) moves onto the kicking foot with the turn, sits there to the contact and
// is back on the sim's path BALL_LEAVE after it.
export const WINDUP = 0.4; // s, the clip's own: the step to the plant, back-lift and strike
export const PASS_FADE = 0.1; // s, cross-fade between the gait and the pass clip
export const TURN_RATE = 2 * Math.PI; // rad/s: a standing player turns 360° a second
export const TURN_MIN = 0.15; // s
export const TURN_MAX = 0.5; // s: half a turn
export const LOCK_RELEASE = 0.4; // s
export const HOLD_MIN = 0.2; // s after the contact: the foot through the ball
export const LEAVE_GAP = 0.15; // m
export const HOP = 0.04; // m: the turn's quick feet, a hop for every quarter turn (kickHop)
export const STEP_HOP = 0.03; // m
export const BALL_LEAVE = 0.12; // s
export const TURN_THROUGH_LOOK = (120 * Math.PI) / 180;
export const LOOK_SIDE = (30 * Math.PI) / 180; // a look this far off the body has a side

/**
 * Which way to turn by `angle` (rad, the shorter way) with the head `look` (rad) off the body: a
 * turn of over TURN_THROUGH_LOOK goes round through the side he looks to, as players turn after
 * their eyes (and the head is then never left behind the kick: look.ts kickLook). 0: the shorter.
 */
export function turnSide(angle: number, look: number): 1 | -1 | 0 {
  if (Math.abs(angle) <= TURN_THROUGH_LOOK || Math.abs(look) < LOOK_SIDE) return 0;
  return look > 0 ? 1 : -1;
}

/** The signed turn from `from` to `to` (rad) on `side` (turnSide). */
export function turnAngle(from: number, to: number, side: 1 | -1 | 0): number {
  const d = wrapAngle(to - from);
  if (side === 0 || Math.sign(d) === side) return d;
  return d + side * 2 * Math.PI;
}

/** How long a standing player takes to turn by `angle` (rad). */
export function turnTime(angle: number): number {
  return Math.min(TURN_MAX, Math.max(TURN_MIN, Math.abs(angle) / TURN_RATE));
}

/** One kick as the rig plays it, from the sim's pass event and body yaw (rig.ts kicksOf). */
export interface Kick {
  frame: number; // the pass event
  facing: number; // rad, the body yaw that sends the clip's kick along the pass
  // Which way the body turns to the facing: +1 counter-clockwise, -1 clockwise, 0 the shorter
  // way. A half-turn goes the way he is looking (turnSide).
  side: 1 | -1 | 0;
  sweep: number; // rad, the turn before the wind-up (signed, from body_yaw then)
  turn: number; // s, its length
  hold: number; // s after the contact: the follow-through is held until then
  release: number; // s, the turn back to body_yaw after the follow-through
  anchor: [number, number] | null; // m, the plant foot on the pitch (retargeted kick only)
  ball: [number, number]; // m, from the sim's ball to the kicking foot's at the contact
}

/** Pass and shot events per player index (they name the kicker; start, target or aim in m). */
export function passEvents(events: ExportEvent[], ids: string[]): Pass[][] {
  const out: Pass[][] = ids.map(() => []);
  for (const e of events) {
    const j = ids.indexOf(e.player);
    if ((e.type !== "pass" && e.type !== "shot") || j < 0) continue;
    const from = e.attrs.start as [number, number] | undefined;
    const to = (e.type === "shot" ? e.attrs.aim : e.attrs.target) as [number, number] | undefined;
    if (!from || !to) continue;
    const [sx, sy] = from;
    out[j].push({ frame: e.frame, yaw: Math.atan2(to[1] - sy, to[0] - sx), start: [sx, sy] });
  }
  return out;
}

function smooth(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** The longest the clip is held at full weight (s from the contact): the kicking foot is down. */
export function holdEnd(clip: PassClip): number {
  return (clip.land ?? clip.duration - PASS_FADE) - clip.touch;
}

/** The first and last moment (s from the contact) at which a kick poses anything. */
function kickSpan(kick: Kick): [number, number] {
  const end = kick.hold;
  return [-WINDUP - kick.turn, end + Math.max(PASS_FADE, kick.release, LOCK_RELEASE)];
}

export interface KickPose {
  time: number; // s, the clip's time
  weight: number; // the clip's weight; the gait has the rest
  facing: number; // 0..1: how far the body has turned from body_yaw to the kick's facing
  lock: number; // 0..1: how firmly the plant foot holds the body
  kick: Kick | null;
}

const NO_KICK: KickPose = { time: 0, weight: 0, facing: 0, lock: 0, kick: null };

/** The kick at fractional frame f, if one is playing (pure: a function of the frame). */
export function kickPose(f: number, kicks: Kick[], dt: number, clip: PassClip): KickPose {
  for (const kick of kicks) {
    const tau = (f - kick.frame) * dt;
    const [a, b] = kickSpan(kick);
    if (tau < a || tau > b) continue;
    const end = kick.hold;
    const time = tau + clip.touch;
    const start = Math.max(0, clip.touch - WINDUP);
    const weight =
      time < start
        ? 0
        : Math.max(0, Math.min(1, (time - start) / PASS_FADE, 1 - (tau - end) / PASS_FADE));
    const facing =
      tau < -WINDUP
        ? smooth((tau - a) / kick.turn)
        : tau <= end
          ? 1
          : 1 - smooth((tau - end) / kick.release);
    // Before the plant the anchor is where the sim has him (the travel starts at the plant):
    // it eases in with the clip, so it holds from the plant on.
    const lock = !clip.plant
      ? 0
      : tau <= end
        ? smooth((time - start) / PASS_FADE)
        : 1 - smooth((tau - end) / LOCK_RELEASE);
    return { time: Math.min(Math.max(time, 0), clip.duration), weight, facing, lock, kick };
  }
  return NO_KICK;
}

/**
 * How high a kick lifts the body (m) at fractional frame f, so the feet never glide on the grass:
 * through the turn, quick hops, one per quarter turn or part of one, HOP high (lower for a turn
 * under 60°); over each cross-fade with the gait, a STEP_HOP lift while the legs change pose.
 */
export function kickHop(f: number, kick: Kick, dt: number): number {
  const tau = (f - kick.frame) * dt;
  const bump = (u: number, n = 1) => (u > 0 && u < 1 ? Math.abs(Math.sin(Math.PI * n * u)) : 0);
  const angle = Math.abs(kick.sweep);
  const hops = Math.max(1, Math.round(angle / (Math.PI / 2)));
  const turn =
    HOP * Math.min(1, angle / (Math.PI / 3)) * bump((tau + WINDUP + kick.turn) / kick.turn, hops);
  const into = STEP_HOP * bump((tau + WINDUP) / PASS_FADE);
  const out = STEP_HOP * bump((tau - kick.hold) / PASS_FADE);
  return turn + into + out;
}

/** How far the ball is moved onto the kicking foot at fractional frame f (0..1). */
export function kickBallWeight(f: number, kick: Kick, dt: number): number {
  const tau = (f - kick.frame) * dt;
  if (tau >= 0) return Math.max(0, 1 - tau / BALL_LEAVE);
  return smooth((tau + WINDUP + kick.turn) / kick.turn);
}

/** Body yaw while a kick plays: body_yaw turned by the pose's facing weight to the kick's. */
export function kickFacing(bodyYaw: number, pose: KickPose): number {
  if (!pose.kick || pose.facing <= 0) return bodyYaw;
  return bodyYaw + turnAngle(bodyYaw, pose.kick.facing, pose.kick.side) * pose.facing;
}
