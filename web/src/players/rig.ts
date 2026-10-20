// One rigged player, without React or the DOM: clone the converted model, and pose it at a
// fractional playback frame (gait, pass, look). RiggedPlayers.tsx dresses and draws the rigs;
// rig.test.ts poses the committed model the same way and checks where it faces and looks.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Hero, Run } from "../data/hero";
import {
  type GaitClips,
  type Pass,
  type PassClip,
  gaitBlend,
  gaitPhase,
  passEvents,
  passFacing,
  passPose,
  smoothedSpeeds,
} from "./gait";
import { type LookSplit, aimLook } from "./look";

/** Rendered height, as the tokens (1.80 m); the source model stands 1.885 m. */
export const PLAYER_HEIGHT = 1.8;

interface ClipMeta {
  duration_s: number;
  stride_speed_mps?: number;
  touch_s?: number;
  ball_yaw_deg?: number;
}

/** The scene extras written by demo/grf/convert.py. */
export interface ModelMeta {
  height_m: number;
  clips: Record<"idle" | "walk" | "sprint" | "pass", ClipMeta>;
}

export interface ModelClips {
  gait: GaitClips;
  pass: PassClip;
}

export function modelClips(meta: ModelMeta): ModelClips {
  return {
    gait: {
      walkSpeed: meta.clips.walk.stride_speed_mps!,
      sprintSpeed: meta.clips.sprint.stride_speed_mps!,
      cycle: meta.clips.walk.duration_s,
    },
    pass: {
      duration: meta.clips.pass.duration_s,
      touch: meta.clips.pass.touch_s!,
      kickYaw: (meta.clips.pass.ball_yaw_deg! * Math.PI) / 180,
    },
  };
}

/** Per-run motion of every player, computed once: speeds, gait phase, passes. */
export interface Motion {
  speeds: Float32Array[]; // per player, per frame, m/s
  phase: Float64Array[]; // per player, cumulative gait cycles per frame
  passes: Pass[][]; // per player, pass events
}

export function runMotion(hero: Hero, run: Run, clips: GaitClips): Motion {
  const speeds = hero.players.map((_, j) =>
    smoothedSpeeds(run.pos, hero.n, j, run.frames, hero.dt),
  );
  return {
    speeds,
    phase: speeds.map((s) => gaitPhase(s, hero.dt, clips)),
    passes: passEvents(run.events, hero.ids),
  };
}

export interface Rig {
  holder: THREE.Group; // on the pitch: position and facing
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  sprint: THREE.AnimationAction;
  pass: THREE.AnimationAction;
  middle: THREE.Object3D; // trunk joint
  neck: THREE.Object3D;
  // The clips' own trunk and neck rotation from the last mixer update, before the look turned
  // them: the mixer only writes a bone when its animated value changes, so these are put back
  // before every update, or the look's turns would pile up across redraws.
  animated: { middle: THREE.Quaternion; neck: THREE.Quaternion };
}

export function makeRig(gltf: GLTF, scale: number): Rig {
  const model = cloneSkinned(gltf.scene) as THREE.Group;
  model.scale.setScalar(scale);
  const holder = new THREE.Group();
  holder.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const action = (name: string) => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`grf_player.glb has no ${name} clip`);
    const a = mixer.clipAction(clip);
    a.play();
    a.paused = true; // times are set from the playback frame, never advanced by the mixer
    a.setEffectiveWeight(0);
    return a;
  };
  const middle = model.getObjectByName("middle")!;
  const neck = model.getObjectByName("neck")!;
  return {
    holder,
    model,
    mixer,
    idle: action("idle"),
    walk: action("walk"),
    sprint: action("sprint"),
    pass: action("pass"),
    middle,
    neck,
    animated: { middle: middle.quaternion.clone(), neck: neck.quaternion.clone() },
  };
}

function setAction(a: THREE.AnimationAction, weight: number, time: number): void {
  a.setEffectiveWeight(weight);
  a.time = time;
}

/**
 * Pose player j at fractional frame f of a run: x, y on the pitch (m), body and head yaw (rad,
 * world) as sampled for the views. Returns the look split for checks.
 */
export function poseRig(
  rig: Rig,
  motion: Motion,
  clips: ModelClips,
  j: number,
  f: number,
  dt: number,
  x: number,
  y: number,
  bodyYaw: number,
  headYaw: number,
): LookSplit {
  const frames = motion.speeds[j].length;
  const c = Math.max(0, Math.min(frames - 1, f));
  const i0 = Math.floor(c);
  const i1 = Math.min(frames - 1, i0 + 1);
  const t = c - i0;
  rig.holder.position.set(x, 0, -y);
  const speed = motion.speeds[j][i0] + (motion.speeds[j][i1] - motion.speeds[j][i0]) * t;
  const phase = motion.phase[j][i0] + (motion.phase[j][i1] - motion.phase[j][i0]) * t;
  const cycleTime = (phase - Math.floor(phase)) * clips.gait.cycle;
  const g = gaitBlend(speed, clips.gait);
  const p = passPose(c, motion.passes[j], dt, clips.pass);
  const k = 1 - p.weight;
  setAction(rig.idle, k * g.idle, 0);
  setAction(rig.walk, k * g.walk, cycleTime);
  setAction(rig.sprint, k * g.sprint, cycleTime);
  setAction(rig.pass, p.weight, p.time);
  rig.middle.quaternion.copy(rig.animated.middle);
  rig.neck.quaternion.copy(rig.animated.neck);
  rig.mixer.update(0);
  rig.animated.middle.copy(rig.middle.quaternion);
  rig.animated.neck.copy(rig.neck.quaternion);
  return aimLook(rig.holder, rig.middle, rig.neck, passFacing(bodyYaw, p, clips.pass), headYaw);
}
