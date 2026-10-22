// Where a rigged player looks (SPEC 7): the neck takes head_yaw − body_yaw, so a scan is
// visible on anyone in view, and the head always points exactly along head_yaw.
//
// The sim's head can be up to 180° off the body (it runs one way and watches the ball behind
// him; seed 3: |head − body| is above 140° in a tenth of player-frames, the hero's key scan is
// −128°). A neck alone cannot turn that far, so the look is split: the neck first, up to
// NECK_MAX, then the trunk twists up to TRUNK_MAX, and anything beyond turns the hips, which
// opens the body away from the running direction, as players do when they run with their back
// to the ball. Tokens keep the unclamped head (views/tokens.ts).

import * as THREE from "three";
import { wrapAngle } from "../data/hero";
import { worldYaw } from "../views/tokens";

export const NECK_MAX = (80 * Math.PI) / 180;
export const TRUNK_MAX = (50 * Math.PI) / 180; // with the neck: 130°, the hero's key scan fits

export interface LookSplit {
  hips: number; // rad, added to body_yaw for the whole model
  trunk: number; // rad, twist of the trunk about the vertical
  neck: number; // rad, the head relative to the trunk
}

export function splitLook(bodyYaw: number, headYaw: number): LookSplit {
  const total = wrapAngle(headYaw - bodyYaw);
  const a = Math.abs(total);
  const sign = total < 0 ? -1 : 1;
  const neck = Math.min(a, NECK_MAX);
  const trunk = Math.min(a - neck, TRUNK_MAX);
  return { hips: sign * (a - neck - trunk), trunk: sign * trunk, neck: sign * neck };
}

const UP = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3();
const parentWorld = new THREE.Quaternion();
const turn = new THREE.Quaternion();

/** Turn a bone about the world vertical by `angle`, on top of its animated pose. */
function turnAboutVertical(bone: THREE.Object3D, angle: number): void {
  if (angle === 0) return;
  bone.parent!.getWorldQuaternion(parentWorld);
  axis.copy(UP).applyQuaternion(parentWorld.invert());
  bone.quaternion.premultiply(turn.setFromAxisAngle(axis, angle));
  bone.updateMatrixWorld(true);
}

/**
 * Pose the look after the animation mixer has run: the holder (the model on the pitch) turns to
 * body_yaw + hips, the trunk ("middle") twists by the trunk share, and the neck turns until the
 * head points along head_yaw. The neck correction also cancels the clip's own shoulder and head
 * sway, so the head is exact whatever the gait. Where a clip swings the shoulders far round (the
 * pass), the neck would pass NECK_MAX: the trunk turns back by the excess instead.
 * `trunkTwist`: what a shoulder check (extra.ts) has already turned the trunk towards the look; it
 * counts towards the trunk's share, so the trunk does not turn twice.
 */
export function aimLook(
  holder: THREE.Object3D,
  middle: THREE.Object3D,
  neck: THREE.Object3D,
  bodyYaw: number,
  headYaw: number,
  trunkTwist = 0,
): LookSplit {
  const split = splitLook(bodyYaw, headYaw);
  holder.rotation.set(0, bodyYaw + split.hips, 0);
  holder.updateMatrixWorld(true);
  const trunk =
    trunkTwist * split.trunk > 0
      ? Math.sign(split.trunk) * Math.max(0, Math.abs(split.trunk) - Math.abs(trunkTwist))
      : split.trunk;
  turnAboutVertical(middle, trunk);
  const relative = wrapAngle(headYaw - worldYaw(middle)); // the neck angle the head needs
  const excess = relative - Math.max(-NECK_MAX, Math.min(NECK_MAX, relative));
  turnAboutVertical(middle, excess);
  turnAboutVertical(neck, wrapAngle(headYaw - worldYaw(neck)));
  return split;
}
