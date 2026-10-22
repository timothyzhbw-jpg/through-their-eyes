// Extra player animations (SPEC 7; on by default, `?anims=base` for the engine's clips only):
// open-licence motion retargeted onto the Gameplay Football skeleton, in
// web/public/models/anims_extra.glb (no mesh: animations bound to grf_player.glb's bones by name;
// models/README.md has the sources and credits).
// - pass_short: a mocap kick (CMU), replacing the engine's standing pass at every sim pass event;
// - shoulder_check_l / _r: the trunk's share of a look over the shoulder (CMU), played as an
//   additive layer at every sim scan, timed to the head's own turn: out, hold, back.
// The head stays the sim's: the checks have no neck track, and look.ts points the neck along
// head_yaw after every clip (the kick's neck track only tilts the head down to the ball).
// Everything is a pure function of the playback frame, as in gait.ts.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Hero, Run } from "../data/hero";
import { wrapAngle } from "../data/hero";
import type { PassClip } from "./gait";

export const EXTRA_URL = `${import.meta.env.BASE_URL}models/anims_extra.glb`;

interface ExtraClipMeta {
  duration_s: number;
  touch_s?: number;
  ball_yaw_deg?: number;
  reach_s?: number;
  leave_s?: number;
  back_s?: number;
  head_peak_deg?: number;
  twist_fps?: number;
  twist_deg?: number[];
}

/** The scene extras written by the retarget (tte-blender/anims/build.py). */
export interface ExtraMeta {
  fps: number;
  credits: string[];
  clips: Record<"pass_short" | "shoulder_check_l" | "shoulder_check_r", ExtraClipMeta>;
}

/** The shoulder check's phases (s): the head reaches its peak, leaves it, is back; the end. */
export interface CheckClip {
  duration: number;
  reach: number;
  leave: number;
  back: number;
  headPeak: number; // rad, the size of the look the clip was captured with
  twistFps: number;
  twist: number[]; // rad, the trunk's turn about the vertical, + = left, of shoulder_check_l
}

export interface ExtraClips {
  pass: PassClip;
  passClip: THREE.AnimationClip;
  check: CheckClip;
  checkLeft: THREE.AnimationClip; // additive
  checkRight: THREE.AnimationClip;
}

const DEG = Math.PI / 180;

/** The extra clips, the shoulder checks made additive against their first frame. */
export function extraClips(gltf: GLTF): ExtraClips {
  const meta = gltf.scene.userData as ExtraMeta;
  const find = (name: string) => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`anims_extra.glb has no ${name} clip`);
    return clip;
  };
  const additive = (name: string) => THREE.AnimationUtils.makeClipAdditive(find(name).clone());
  const pass = meta.clips.pass_short;
  const left = meta.clips.shoulder_check_l;
  return {
    pass: {
      duration: pass.duration_s,
      touch: pass.touch_s!,
      kickYaw: pass.ball_yaw_deg! * DEG,
    },
    passClip: find("pass_short"),
    check: {
      duration: left.duration_s,
      reach: left.reach_s!,
      leave: left.leave_s!,
      back: left.back_s!,
      headPeak: Math.abs(left.head_peak_deg!) * DEG,
      twistFps: left.twist_fps!,
      twist: left.twist_deg!.map((d) => d * DEG),
    },
    checkLeft: additive("shoulder_check_l"),
    checkRight: additive("shoulder_check_r"),
  };
}

/** One sim scan as the shoulder check plays it (frames, fractional where interpolated). */
export interface ShoulderCheck {
  start: number; // the scan starts
  reach: number; // the head reaches 90% of its turn
  leave: number; // the head leaves it
  end: number; // the scan ends: the head is back
  side: 1 | -1; // +1 over the left shoulder (counter-clockwise), -1 the right
  weight: number; // 0..1, by how far the head turns from the body
}

/** Scans whose head turns less than this further from the body play no shoulder check. */
export const CHECK_MIN_TURN = 15 * DEG;

/**
 * The shoulder checks of player j in a run, from the sim's scan events: each scan's phases from
 * the head's turn (relative to where it started), its side from where the head ends up relative
 * to the body at the peak, its weight from how far that is, up to the clip's own look (78°).
 */
export function shoulderChecks(hero: Hero, run: Run, j: number, clip: CheckClip): ShoulderCheck[] {
  const n = hero.n;
  const id = hero.ids[j];
  const out: ShoulderCheck[] = [];
  for (const scan of run.scans) {
    if (scan.player !== id) continue;
    const s = Math.max(0, scan.start);
    const e = Math.min(run.frames - 1, scan.end);
    if (e <= s) continue;
    const head0 = run.head[s * n + j];
    let peak = s;
    let most = -1;
    for (let f = s; f <= e; f++) {
      const ex = Math.abs(wrapAngle(run.head[f * n + j] - head0));
      if (ex > most) {
        most = ex;
        peak = f;
      }
    }
    let reach = peak;
    let leave = peak;
    for (let f = s; f <= peak; f++) {
      if (Math.abs(wrapAngle(run.head[f * n + j] - head0)) >= 0.9 * most) {
        reach = f;
        break;
      }
    }
    for (let f = e; f >= peak; f--) {
      if (Math.abs(wrapAngle(run.head[f * n + j] - head0)) >= 0.9 * most) {
        leave = f;
        break;
      }
    }
    const relStart = wrapAngle(head0 - run.body[s * n + j]);
    const relPeak = wrapAngle(run.head[peak * n + j] - run.body[peak * n + j]);
    if (Math.abs(relPeak) - Math.abs(relStart) < CHECK_MIN_TURN) continue;
    out.push({
      start: s,
      reach,
      leave,
      end: e,
      side: relPeak >= 0 ? 1 : -1,
      weight: Math.min(1, Math.abs(relPeak) / clip.headPeak),
    });
  }
  return out;
}

/**
 * The shoulder check at fractional frame f: the clip's time, warped so its phases land on the
 * scan's (out to the peak, the hold, back), then played on at its own speed while the trunk
 * settles; the latest scan that covers f wins.
 */
export function checkPose(
  f: number,
  checks: ShoulderCheck[],
  dt: number,
  clip: CheckClip,
): { time: number; weight: number; side: 1 | -1 } {
  const tail = (clip.duration - clip.back) / dt; // frames after the scan's end
  for (let k = checks.length - 1; k >= 0; k--) {
    const c = checks[k];
    if (f < c.start || f > c.end + tail) continue;
    const lerp = (a: number, b: number, t0: number, t1: number) =>
      b > a ? t0 + ((t1 - t0) * (f - a)) / (b - a) : t1;
    let time: number;
    if (f <= c.reach) time = lerp(c.start, c.reach, 0, clip.reach);
    else if (f <= c.leave) time = lerp(c.reach, c.leave, clip.reach, clip.leave);
    else if (f <= c.end) time = lerp(c.leave, c.end, clip.leave, clip.back);
    else time = clip.back + (f - c.end) * dt;
    return { time: Math.min(time, clip.duration), weight: c.weight, side: c.side };
  }
  return { time: 0, weight: 0, side: 1 };
}

/** The trunk's turn about the vertical the check adds at clip time t (rad, signed by side). */
export function checkTwist(clip: CheckClip, time: number, weight: number, side: 1 | -1): number {
  if (weight <= 0) return 0;
  const x = Math.max(0, Math.min(clip.twist.length - 1, time * clip.twistFps));
  const i = Math.floor(x);
  const j = Math.min(clip.twist.length - 1, i + 1);
  const v = clip.twist[i] + (clip.twist[j] - clip.twist[i]) * (x - i);
  return v * weight * side;
}
