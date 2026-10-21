// "Your call" (SPEC 7): the camera behind the ball carrier, and the screen-space maths of picking.
// The camera looks along his team's attack from behind and above him, pulled back just far enough
// that the carrier and every option fit the frame; it does not move while the reveal plays. The
// option markers, the dotted pass path and the swipe are DOM over the canvas, placed with the
// same camera, so they work (and are tested) without WebGL.

import * as THREE from "three";
import type { Vec2 } from "../data/types";

/** Players are drawn this much larger than life: the camera is far back. */
export const TOKEN_SCALE = 1.7;
/** Height (m) of a drawn player's head top; an option's marker floats above it. */
export const HEAD_TOP = 1.85 * TOKEN_SCALE;
/** Screen pixels from the head top up to the centre of an option's marker. */
export const MARKER_RISE_PX = 26;
const MARKER_HALF_PX = 18;
const ELEVATION = (46 * Math.PI) / 180; // the camera looks down at this angle
const FOV = 40; // vertical, degrees
// Where the frame's content may sit, in normalised device coordinates.
const SAFE = { x: 0.9, bottom: -0.92 };
const MIN_SWIPE_PX = 24;
const SWIPE_CONE = (35 * Math.PI) / 180; // a swipe points at options within this angle

/** Pitch metres (x, y) and a height to three.js world coordinates (x, height, -y). */
export function toWorld([x, y]: Vec2, height = 0): THREE.Vector3 {
  return new THREE.Vector3(x, height, -y);
}

/** Screen pixels of a world point in a view of w x h CSS pixels. */
export function project(camera: THREE.Camera, world: THREE.Vector3, w: number, h: number): Vec2 {
  const v = world.clone().project(camera);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

/** Screen pixels of the centre of an option's marker over a player standing at `anchor`. */
export function markerAt(camera: THREE.Camera, anchor: Vec2, w: number, h: number): Vec2 {
  const [x, y] = project(camera, toWorld(anchor, HEAD_TOP), w, h);
  return [x, y - MARKER_RISE_PX];
}

/**
 * The camera for a call in a view of w x h pixels: behind the carrier as his team attacks (home
 * attacks +x), looking down at the middle of the carrier and the options, as far back as it
 * takes to fit them all with their markers.
 */
export function frameCall(
  carrier: Vec2,
  options: { anchor: Vec2; target: Vec2 }[],
  team: 0 | 1,
  w: number,
  h: number,
): THREE.PerspectiveCamera {
  const aspect = w / h;
  const top = 1 - (2 * (MARKER_RISE_PX + MARKER_HALF_PX + 4)) / h; // room for the markers
  const ground = [carrier, ...options.flatMap((o) => [o.anchor, o.target])];
  const points = [
    ...ground.map((p) => toWorld(p)),
    ...[carrier, ...options.map((o) => o.anchor)].map((p) => toWorld(p, HEAD_TOP)),
  ];
  const xs = ground.map((p) => p[0]);
  const ys = ground.map((p) => p[1]);
  const centre: Vec2 = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  const look = toWorld(centre);
  const dir = team === 0 ? 1 : -1;
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 800);
  const place = (distance: number) => {
    camera.position.set(
      centre[0] - dir * distance * Math.cos(ELEVATION),
      distance * Math.sin(ELEVATION),
      -centre[1],
    );
    camera.lookAt(look);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  const fits = (distance: number) => {
    place(distance);
    return points.every((p) => {
      const v = p.clone().project(camera);
      return v.z < 1 && Math.abs(v.x) <= SAFE.x && v.y <= top && v.y >= SAFE.bottom;
    });
  };
  let near = 8;
  let far = 400;
  if (fits(near)) far = near;
  else if (fits(far))
    for (let k = 0; k < 32; k++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
  place(far);
  return camera;
}

/**
 * The option a swipe points at: the swipe goes from the carrier (`origin`, screen px) along
 * `vector`; of the markers within a cone around it, the one nearest to where the swipe ends.
 * A tap (a short drag) or a swipe that points at no marker picks nothing.
 */
export function swipePick(
  origin: Vec2,
  vector: Vec2,
  markers: { action: string; at: Vec2 }[],
): string | null {
  const length = Math.hypot(vector[0], vector[1]);
  if (length < MIN_SWIPE_PX) return null;
  const end: Vec2 = [origin[0] + vector[0], origin[1] + vector[1]];
  let best: string | null = null;
  let bestD = Infinity;
  for (const m of markers) {
    const dx = m.at[0] - origin[0];
    const dy = m.at[1] - origin[1];
    const d = Math.hypot(dx, dy);
    if (d < 1) continue;
    const cos = (dx * vector[0] + dy * vector[1]) / (d * length);
    if (Math.acos(Math.min(1, Math.max(-1, cos))) > SWIPE_CONE) continue;
    const toEnd = Math.hypot(m.at[0] - end[0], m.at[1] - end[1]);
    if (toEnd < bestD) {
      best = m.action;
      bestD = toEnd;
    }
  }
  return best;
}

/** Push markers closer than `min` px apart until none overlap; the others stay put. */
export function declutter(points: Vec2[], min: number): Vec2[] {
  const out = points.map((p) => [p[0], p[1]] as Vec2);
  for (let round = 0; round < 24; round++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j][0] - out[i][0];
        const dy = out[j][1] - out[i][1];
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const [ux, uy] = d > 1e-6 ? [dx / d, dy / d] : [0, 1];
        const push = (min - d) / 2 + 0.01;
        out[i] = [out[i][0] - ux * push, out[i][1] - uy * push];
        out[j] = [out[j][0] + ux * push, out[j][1] + uy * push];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
