// Camera moves between the 3D view's cameras (SPEC 7): switching between his eyes and the
// broadcast camera flies from one to the other instead of cutting, unless the director cuts
// (`requestCut`), the playhead jumped (a seek or a plan's rewind is a cut in the edit), or the
// viewer prefers reduced motion. The view sets its target pose as usual; `apply` then moves the
// three.js camera part of the way there from the pose it showed when the switch happened.

import * as THREE from "three";

export const BLEND_S = 0.8; // wall seconds of a camera move
const JUMP_FRAMES = 3; // a playhead move larger than this between two draws is a seek

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

let cutRequested = false;

/** The next camera change is a cut (the auto director's). */
export function requestCut(): void {
  cutRequested = true;
}

export interface BlendInput {
  camera: string; // the camera chosen now
  frame: number;
  now: number; // wall seconds
  reduced: boolean;
}

/** Progress of a blend in [0, 1] at wall time `now`, eased; 1 when none runs. */
export function blendProgress(t0: number | null, now: number): number {
  if (t0 === null) return 1;
  const t = (now - t0) / BLEND_S;
  return t >= 1 ? 1 : easeInOut(Math.max(0, t));
}

/** Whether a switch from `last` to `input.camera` should fly (true) or cut (false). */
export function shouldBlend(
  last: { camera: string; frame: number } | null,
  input: BlendInput,
  cut: boolean,
): boolean {
  if (!last || last.camera === input.camera) return false;
  if (cut || input.reduced) return false;
  return Math.abs(input.frame - last.frame) <= JUMP_FRAMES;
}

/** One per canvas: remembers the pose drawn last and blends from it after a switch. */
export class CameraBlend {
  private last: { camera: string; frame: number } | null = null;
  private t0: number | null = null;
  private readonly from = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    fov: 60,
    fog: [0, 0] as [number, number],
  };
  private readonly to = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  /** Before the view moves the camera: a switch starts a move from the pose on screen. */
  begin(camera: THREE.PerspectiveCamera, fog: THREE.Fog | null, input: BlendInput): void {
    const cut = cutRequested;
    cutRequested = false;
    if (this.last && this.last.camera !== input.camera) {
      if (shouldBlend(this.last, input, cut)) {
        this.from.position.copy(camera.position);
        this.from.quaternion.copy(camera.quaternion);
        this.from.fov = camera.fov;
        if (fog) this.from.fog = [fog.near, fog.far];
        this.t0 = input.now;
      } else this.t0 = null;
    }
    this.last = { camera: input.camera, frame: input.frame };
  }

  /** After the view set its target pose: move part of the way. True while a move runs. */
  apply(camera: THREE.PerspectiveCamera, fog: THREE.Fog | null, now: number): boolean {
    const e = blendProgress(this.t0, now);
    if (e >= 1) {
      this.t0 = null;
      return false;
    }
    this.to.position.copy(camera.position);
    this.to.quaternion.copy(camera.quaternion);
    camera.position.lerpVectors(this.from.position, this.to.position, e);
    camera.quaternion.slerpQuaternions(this.from.quaternion, this.to.quaternion, e);
    camera.fov = this.from.fov + (camera.fov - this.from.fov) * e;
    camera.near = 0.05; // in between, players can come close to the lens
    camera.far = 400;
    camera.updateProjectionMatrix();
    if (fog) {
      fog.near = this.from.fog[0] + (fog.near - this.from.fog[0]) * e;
      fog.far = this.from.fog[1] + (fog.far - this.from.fog[1]) * e;
    }
    return true;
  }
}
