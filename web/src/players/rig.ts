// One rigged player, without React or the DOM: clone the converted model, and pose it at a
// fractional playback frame (gait, walk, pass, shoulder check, look). RiggedPlayers.tsx dresses and
// draws the rigs; rig.test.ts poses the committed model the same way and checks where it faces
// and looks.

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
  gaitRun,
  passEvents,
  passFacing,
  passPose,
  smoothedSpeeds,
  strollTime,
} from "./gait";
import {
  type CheckClip,
  type ExtraClips,
  type ShoulderCheck,
  checkPose,
  checkTwist,
  shoulderChecks,
} from "./extra";
import { type LookSplit, aimLook } from "./look";
import type { WalkClips } from "./walk";

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
  extra: ExtraClips | null; // the extra clips (extra.ts); their kick replaces the pass
}

/** The clips a rig plays; `walk` (walk.ts) gives the slow speeds a real walk (gait.ts). */
export function modelClips(
  meta: ModelMeta,
  extra: ExtraClips | null = null,
  walk: WalkClips | null = null,
): ModelClips {
  return {
    gait: {
      walkSpeed: meta.clips.walk.stride_speed_mps!,
      sprintSpeed: meta.clips.sprint.stride_speed_mps!,
      cycle: meta.clips.walk.duration_s,
      stroll: walk ? walk.stroll : null,
    },
    pass: extra
      ? extra.pass
      : {
          duration: meta.clips.pass.duration_s,
          touch: meta.clips.pass.touch_s!,
          kickYaw: (meta.clips.pass.ball_yaw_deg! * Math.PI) / 180,
        },
    extra,
  };
}

/** Per-run motion of every player, computed once: speeds, gait phase, passes, shoulder checks. */
export interface Motion {
  speeds: Float32Array[]; // per player, per frame, m/s
  run: Float32Array[]; // per player, the engine gait's weight per frame (0 walking, gait.ts)
  phase: Float64Array[]; // per player, cumulative gait cycles per frame
  passes: Pass[][]; // per player, pass events
  checks: ShoulderCheck[][]; // per player, scans as shoulder checks (empty without the clip)
}

export function runMotion(
  hero: Hero,
  run: Run,
  clips: GaitClips,
  check: CheckClip | null = null,
): Motion {
  const speeds = hero.players.map((_, j) =>
    smoothedSpeeds(run.pos, hero.n, j, run.frames, hero.dt),
  );
  const gaits = speeds.map((s) =>
    clips.stroll ? gaitRun(s, hero.dt) : new Float32Array(s.length).fill(1),
  );
  return {
    speeds,
    run: gaits,
    phase: speeds.map((s, j) => gaitPhase(s, hero.dt, clips, gaits[j])),
    passes: passEvents(run.events, hero.ids),
    checks: hero.players.map((_, j) => (check ? shoulderChecks(hero, run, j, check) : [])),
  };
}

export interface Rig {
  holder: THREE.Group; // on the pitch: position and facing
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  sprint: THREE.AnimationAction;
  stroll: THREE.AnimationAction | null; // the walk (walk.ts), when it is loaded
  pass: THREE.AnimationAction; // the engine's standing pass, or the extra kick
  checkLeft: THREE.AnimationAction | null; // additive shoulder checks (extra clips only)
  checkRight: THREE.AnimationAction | null;
  middle: THREE.Object3D; // trunk joint
  neck: THREE.Object3D;
  // The boots, skinned (with the walk): poseRig lifts the walking gait's model by however far
  // a blended pose would push them into the ground.
  soles: Sole[] | null;
  // The clips' own trunk and neck rotation from the last mixer update, before the look turned
  // them: the mixer only writes a bone when its animated value changes, so these are put back
  // before every update, or the look's turns would pile up across redraws.
  animated: { middle: THREE.Quaternion; neck: THREE.Quaternion };
}

/** A boot vertex, skinned: its point in each influencing bone's frame, and the weights. */
export interface Sole {
  bones: THREE.Object3D[];
  weights: number[];
  points: THREE.Vector3[];
}

type BootVertex = { bones: string[]; weights: number[]; points: THREE.Vector3[] };
const bootCache = new WeakMap<GLTF, BootVertex[]>();

/**
 * Every boot vertex, as linear blend skinning places it: the sum over its bones of weight *
 * bone.matrixWorld * boneInverse * bindMatrix * position. Some boot vertices hang partly on the
 * knee, and in a blended pose one of them can be the lowest.
 */
function bootVertices(gltf: GLTF): BootVertex[] {
  const cached = bootCache.get(gltf);
  if (cached) return cached;
  const out: BootVertex[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || (mesh.material as THREE.Material).name !== "boots") return;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      const bind = new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(mesh.bindMatrix);
      const v: BootVertex = { bones: [], weights: [], points: [] };
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w <= 0) continue;
        const b = skinIndex.getComponent(i, k);
        v.bones.push(mesh.skeleton.bones[b].name);
        v.weights.push(w);
        v.points.push(bind.clone().applyMatrix4(mesh.skeleton.boneInverses[b]));
      }
      out.push(v);
    }
  });
  if (out.length === 0) throw new Error("grf_player.glb has no boots");
  bootCache.set(gltf, out);
  return out;
}

const soleWorld = new THREE.Vector3();

/** Height of the lowest boot point (m); the holder stands on the ground and only turns about y. */
function lowestSole(soles: Sole[]): number {
  let lowest = Infinity;
  for (const { bones, weights, points } of soles) {
    let y = 0;
    for (let k = 0; k < bones.length; k++) {
      y += weights[k] * soleWorld.copy(points[k]).applyMatrix4(bones[k].matrixWorld).y;
    }
    lowest = Math.min(lowest, y);
  }
  return lowest;
}

export function makeRig(
  gltf: GLTF,
  scale: number,
  extra: ExtraClips | null = null,
  walk: WalkClips | null = null,
): Rig {
  const model = cloneSkinned(gltf.scene) as THREE.Group;
  model.scale.setScalar(scale);
  const holder = new THREE.Group();
  holder.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const start = (clip: THREE.AnimationClip) => {
    const a = mixer.clipAction(clip); // an additive clip makes an additive action
    a.play();
    a.paused = true; // times are set from the playback frame, never advanced by the mixer
    a.setEffectiveWeight(0);
    return a;
  };
  const action = (name: string) => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`grf_player.glb has no ${name} clip`);
    return start(clip);
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
    stroll: walk ? start(walk.clip) : null,
    pass: extra ? start(extra.passClip) : action("pass"),
    checkLeft: extra ? start(extra.checkLeft) : null,
    checkRight: extra ? start(extra.checkRight) : null,
    middle,
    neck,
    soles: walk
      ? bootVertices(gltf).map((v) => ({
          bones: v.bones.map((name) => model.getObjectByName(name)!),
          weights: v.weights,
          points: v.points,
        }))
      : null,
    animated: { middle: middle.quaternion.clone(), neck: neck.quaternion.clone() },
  };
}

function setAction(a: THREE.AnimationAction, weight: number, time: number): void {
  a.setEffectiveWeight(weight);
  a.time = time;
}

/**
 * Pose player j at fractional frame f of a run: x, y on the pitch (m), body and head yaw (rad,
 * world) as sampled for the views. `checks: false` (reduced motion) leaves the shoulder checks
 * out; the head points along head_yaw either way. Returns the look split for checks.
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
  checks = true,
): LookSplit {
  const frames = motion.speeds[j].length;
  const c = Math.max(0, Math.min(frames - 1, f));
  const i0 = Math.floor(c);
  const i1 = Math.min(frames - 1, i0 + 1);
  const t = c - i0;
  rig.holder.position.set(x, 0, -y);
  const speed = motion.speeds[j][i0] + (motion.speeds[j][i1] - motion.speeds[j][i0]) * t;
  const phase = motion.phase[j][i0] + (motion.phase[j][i1] - motion.phase[j][i0]) * t;
  const run = motion.run[j][i0] + (motion.run[j][i1] - motion.run[j][i0]) * t;
  const cycleTime = (phase - Math.floor(phase)) * clips.gait.cycle;
  const g = gaitBlend(speed, clips.gait, run);
  const p = passPose(c, motion.passes[j], dt, clips.pass);
  const k = 1 - p.weight;
  setAction(rig.idle, k * g.idle, 0);
  setAction(rig.walk, k * g.walk, cycleTime);
  setAction(rig.sprint, k * g.sprint, cycleTime);
  if (rig.stroll && clips.gait.stroll) {
    setAction(rig.stroll, k * g.stroll, strollTime(phase, clips.gait.stroll));
  }
  setAction(rig.pass, p.weight, p.time);
  // The shoulder check rides on the gait (additive), and gives way to the kick as the gait does.
  const extra = clips.extra;
  const s =
    extra && checks && rig.checkLeft && rig.checkRight
      ? checkPose(c, motion.checks[j], dt, extra.check)
      : null;
  const cw = s ? k * s.weight : 0;
  if (rig.checkLeft && rig.checkRight) {
    setAction(rig.checkLeft, s && s.side > 0 ? cw : 0, s ? s.time : 0);
    setAction(rig.checkRight, s && s.side < 0 ? cw : 0, s ? s.time : 0);
  }
  rig.middle.quaternion.copy(rig.animated.middle);
  rig.neck.quaternion.copy(rig.animated.neck);
  rig.mixer.update(0);
  rig.animated.middle.copy(rig.middle.quaternion);
  rig.animated.neck.copy(rig.neck.quaternion);
  const twist = s && extra ? checkTwist(extra.check, s.time, cw, s.side) : 0;
  rig.model.position.y = 0;
  const split = aimLook(
    rig.holder,
    rig.middle,
    rig.neck,
    passFacing(bodyYaw, p, clips.pass),
    headYaw,
    twist,
  );
  // The walking gait stands its feet on the ground: blended with idle at the slowest speeds, and
  // with the jog through a change of gait (the walk's straight stance leg averaged with the jog's
  // bent one, up to 7 cm into the ground), the lowest boot point can sink; lift the model by
  // that much, fading out with the walk. The engine's gait poses as before (as `?anims=base`).
  if (rig.soles && run < 1) {
    const sink = -lowestSole(rig.soles) * (1 - run);
    if (sink > 0) {
      rig.model.position.y = sink;
      rig.model.updateMatrixWorld(true);
    }
  }
  return split;
}
