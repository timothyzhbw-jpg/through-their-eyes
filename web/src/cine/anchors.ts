// Where a shot's anchors are, in pitch metres, at a fractional frame (SPEC 10). Player tracks
// are the sim's samples; a dolly around a runner averages a short window so one jittery frame
// does not kick the camera. Yaw 0 points along +pitch x and positive yaw turns toward +pitch y.
// A local offset is x forward, y left, h up, then rotated by that yaw:
// (x, y) -> (x cos yaw - y sin yaw, x sin yaw + y cos yaw).

import { Sample, sampleInto, type Hero, type Run, type Scan } from "../data/hero";
import { sharedSeparation } from "../players/separate";
import { EYE_HEIGHT } from "../views/PovView";
import type { Anchor, Vec3 } from "./shot";

/** The first-person camera looks this far ahead of the eyes. PovView's LOOK_AHEAD. */
const LOOK_AHEAD = 10;
/** Height of that look point. PovView looks at 1.3 m. */
const LOOK_HEIGHT = 1.3;
/** Ball centre height, the sphere PovView draws. */
const BALL_HEIGHT = 0.11;
const SMOOTH_SAMPLES = 9;

/** Anchors sit where the body is drawn (players/separate.ts), not on the sim's spot. */
function renderOffset(hero: Hero, run: Run, frame: number): Float32Array {
  return sharedSeparation(hero, hero.n).update(run, frame).off;
}

export interface Pose {
  x: number;
  y: number;
  body: number;
  head: number;
}

function circularMean(sinSum: number, cosSum: number): number {
  return Math.atan2(sinSum, cosSum);
}

/**
 * Player position and yaw at `frame`. With `smooth` seconds above 0, nine samples across
 * [frame ± smooth/dt] are averaged (yaw as a circular mean).
 */
export function smoothedPose(
  hero: Hero,
  run: Run,
  j: number,
  frame: number,
  smooth: number,
  scratch?: Sample,
): Pose {
  const sample = scratch ?? new Sample(hero.n);
  if (!(smooth > 0)) {
    sampleInto(sample, hero, run, frame, false);
    return {
      x: sample.pos[2 * j],
      y: sample.pos[2 * j + 1],
      body: sample.body[j],
      head: sample.head[j],
    };
  }
  const half = smooth / hero.dt;
  let x = 0;
  let y = 0;
  let sinBody = 0;
  let cosBody = 0;
  let sinHead = 0;
  let cosHead = 0;
  for (let k = 0; k < SMOOTH_SAMPLES; k++) {
    const f = frame + half * (-1 + (2 * k) / (SMOOTH_SAMPLES - 1));
    sampleInto(sample, hero, run, f, false);
    x += sample.pos[2 * j];
    y += sample.pos[2 * j + 1];
    sinBody += Math.sin(sample.body[j]);
    cosBody += Math.cos(sample.body[j]);
    sinHead += Math.sin(sample.head[j]);
    cosHead += Math.cos(sample.head[j]);
  }
  const n = SMOOTH_SAMPLES;
  return {
    x: x / n,
    y: y / n,
    body: circularMean(sinBody, cosBody),
    head: circularMean(sinHead, cosHead),
  };
}

function rotate(x: number, y: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c - y * s, x * s + y * c];
}

/**
 * The anchor as a pitch point (x, y, height). `role` matters for `{at: "eyes"}`: the eye point,
 * or the point the first-person view looks at. `scratch` is a Sample the caller reuses.
 */
export function anchorPoint(
  hero: Hero,
  run: Run,
  frame: number,
  smooth: number,
  anchor: Anchor,
  role: "eye" | "look",
  scratch?: Sample,
): Vec3 {
  if (anchor.at === "world") return [anchor.p[0], anchor.p[1], anchor.p[2]];
  if (anchor.at === "ball") {
    const sample = scratch ?? new Sample(hero.n);
    sampleInto(sample, hero, run, frame, false);
    const offset = anchor.offset ?? [0, 0, 0];
    return [sample.ball[0] + offset[0], sample.ball[1] + offset[1], BALL_HEIGHT + offset[2]];
  }
  const j = hero.ids.indexOf(anchor.id);
  if (j < 0) throw new Error(`unknown player "${anchor.id}"`);
  const pose = smoothedPose(hero, run, j, frame, smooth, scratch);
  const off = renderOffset(hero, run, frame);
  const x = pose.x + off[2 * j];
  const y = pose.y + off[2 * j + 1];
  if (anchor.at === "eyes") {
    if (role === "look") {
      return [
        x + LOOK_AHEAD * Math.cos(pose.head),
        y + LOOK_AHEAD * Math.sin(pose.head),
        LOOK_HEIGHT,
      ];
    }
    return [x, y, EYE_HEIGHT];
  }
  const yaw = anchor.axes === "body" ? pose.body : anchor.axes === "head" ? pose.head : 0;
  let localX = 0;
  let localY = 0;
  let height = 0;
  if (anchor.orbit) {
    const az = (anchor.orbit.az * Math.PI) / 180;
    localX = anchor.orbit.r * Math.cos(az);
    localY = anchor.orbit.r * Math.sin(az);
    height = anchor.orbit.h;
  }
  if (anchor.offset) {
    localX += anchor.offset[0];
    localY += anchor.offset[1];
    height += anchor.offset[2];
  }
  const [wx, wy] = rotate(localX, localY, yaw);
  return [x + wx, y + wy, height];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span === 0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

/**
 * How hard a vision cone flashes at `frame`: 0 at a scan's start, 1 from three frames in until
 * the scan ends, then a fall to 0 over the next eight frames. Overlapping scans take the max.
 */
export function coneEnvelope(frame: number, scans: readonly Scan[], player: string): number {
  let envelope = 0;
  for (const scan of scans) {
    if (scan.player !== player) continue;
    const rise = smoothstep(scan.start, scan.start + 3, frame);
    const fall = 1 - smoothstep(scan.end, scan.end + 8, frame);
    envelope = Math.max(envelope, rise * fall);
  }
  return envelope;
}
