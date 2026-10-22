// The players' walk (SPEC 7; with the extra clips, `?walk=0` leaves it out): Quaternius' Universal
// Animation Library 1 Walk_Loop (CC0), retargeted onto the Gameplay Football skeleton, in
// web/public/models/anims_walk.glb (no mesh: one clip bound to grf_player.glb's bones by name;
// models/README.md has the source and the credit). A file of its own, apart from the extra
// clips, so either can ship or be dropped without the other. gait.ts plays it as the walking
// gait, on the engine clips' phase: its scene extras give its stride speed and the phase of its
// left-foot strike, and the engine walk's, measured the same way.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { StrollClip } from "./gait";

export const WALK_URL = `${import.meta.env.BASE_URL}models/anims_walk.glb`;

/** The scene extras written by the retarget (tte-blender/anims/walk.py). */
export interface WalkMeta {
  fps: number;
  credits: string[];
  clips: {
    walk: {
      duration_s: number;
      stride_speed_mps: number;
      left_strike_phase: number; // of the clip's cycle
      engine_left_strike_phase: { walk: number; sprint: number }; // grf_player.glb's
      source: string;
      license: string;
    };
  };
}

export interface WalkClips {
  stroll: StrollClip;
  clip: THREE.AnimationClip;
}

export function walkClips(gltf: GLTF): WalkClips {
  const walk = (gltf.scene.userData as WalkMeta).clips.walk;
  const clip = THREE.AnimationClip.findByName(gltf.animations, "walk");
  if (!clip) throw new Error("anims_walk.glb has no walk clip");
  return {
    stroll: {
      speed: walk.stride_speed_mps,
      cycle: walk.duration_s,
      // its left-foot strike on the engine walk's (which the sprint shares)
      offset: walk.left_strike_phase - walk.engine_left_strike_phase.walk,
    },
    clip,
  };
}
