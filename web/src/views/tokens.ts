// Player pose on a token: the body turns to body_yaw, the head (a child of the body) to head_yaw.
// Pitch yaw is measured from +x towards +y; the pitch maps to three.js as (x, y) -> (x, h, -y), so
// a model facing its local +x turns to pitch yaw `a` with rotation.y = a.

import * as THREE from "three";
import { wrapAngle } from "../data/hero";

/** High-contrast visor colour, distinct from both team colours. */
export const VISOR_COLOR = "#ffffff";

/** Turn an object (not parented to a rotated one) so its local +x points to pitch yaw `yaw`. */
export function aimYaw(object: THREE.Object3D, yaw: number): void {
  object.rotation.set(0, yaw, 0);
}

export function poseToken(
  body: THREE.Object3D,
  head: THREE.Object3D,
  bodyYaw: number,
  headYaw: number,
): void {
  aimYaw(body, bodyYaw);
  aimYaw(head, wrapAngle(headYaw - bodyYaw)); // relative to the body, not clamped
}

const FORWARD = new THREE.Vector3(1, 0, 0);
const scratch = new THREE.Vector3();

/** The pitch yaw that an object's local +x points to in world space. */
export function worldYaw(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, false);
  const d = scratch.copy(FORWARD).transformDirection(object.matrixWorld);
  return Math.atan2(-d.z, d.x);
}
