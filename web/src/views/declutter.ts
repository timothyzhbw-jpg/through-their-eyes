// Shirt numbers in the 3D view (SPEC 7). Each player's number floats above him at a fixed world
// size, so in his eyes two players on nearly the same bearing put one number on top of the other
// ("10" over "10"). Each frame the labels are placed nearest first on screen: one that would
// touch a label already placed is lifted one label up, and if that spot is taken too it is
// hidden. The runner's gold label goes first, so it always shows.

import * as THREE from "three";

/** A label on screen: centre and size in pixels (y down), and its distance from the camera. */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  priority?: boolean; // placed before every other label
}

export interface Placement {
  visible: boolean;
  lift: number; // label heights up from its place: 0 or 1
}

const LIFTS = [0, 1];

const touches = (a: LabelBox, ay: number, b: LabelBox, by: number) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(ay - by) < (a.h + b.h) / 2;

/** Where each label goes this frame; a null box (behind the camera) is hidden. */
export function declutter(boxes: readonly (LabelBox | null)[]): Placement[] {
  const out: Placement[] = boxes.map(() => ({ visible: false, lift: 0 }));
  const order = boxes
    .map((b, i) => [b, i] as const)
    .filter((e): e is readonly [LabelBox, number] => e[0] !== null)
    .sort(
      ([a, i], [b, j]) => Number(!!b.priority) - Number(!!a.priority) || a.depth - b.depth || i - j,
    );
  const placed: { box: LabelBox; y: number }[] = [];
  for (const [box, i] of order) {
    const lift = LIFTS.find((k) => {
      const y = box.y - k * box.h;
      return !placed.some((p) => touches(box, y, p.box, p.y));
    });
    if (lift === undefined) continue;
    placed.push({ box, y: box.y - lift * box.h });
    out[i] = { visible: true, lift };
  }
  return out;
}

const view = new THREE.Vector3();
const ndc = new THREE.Vector3();

/**
 * A label of world height `size` (and width `aspect` × that) at `world` as it lands on a
 * `width` × `height` picture: its centre and its box in pixels. Null behind the camera.
 */
export function labelBox(
  camera: THREE.PerspectiveCamera,
  world: THREE.Vector3,
  size: number,
  { width, height }: { width: number; height: number },
  aspect = 1,
): Omit<LabelBox, "priority"> | null {
  view.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const depth = -view.z;
  if (depth <= camera.near) return null;
  ndc.copy(world).project(camera);
  const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const px = (size * focal) / depth;
  return {
    x: ((ndc.x + 1) / 2) * width,
    y: ((1 - ndc.y) / 2) * height,
    w: px * aspect,
    h: px,
    depth,
  };
}
