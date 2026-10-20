// Skeleton data (SPEC 7, optional; the first item in the SPEC 9 cut order): every player drawn
// the way limb-tracking data is shown, but only with what the sim records on every frame: the
// position, the torso yaw (`body`), the head yaw (`head`, or as a tracking system reports it), and
// the scan detector's marks. Limbs are not sim data, so none are drawn.
//
// "As tracked" is the head yaw with the sim's sensor noise (independent, 2 degrees, per frame:
// sim/config.py `sensor_noise`), the series the scan detector runs on. The export carries it as the
// detector's angular velocity (`scan_detector.omega`), so it is rebuilt here by integrating that,
// with the one unknown constant pinned to the circular mean of true minus integrated yaw (the noise
// has zero mean). That is within sigma / sqrt(frames) of the tracked series: on blind_side_run
// seed 3, 0.38 degrees at most over every player and both runs, against sim.engine's own output.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type InterleavedBuffer,
  type InterleavedBufferAttribute,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { clampFrame, wrapAngle, type Hero, type Run, type Sample } from "../data/hero";
import { COLORS } from "../views/scene";

/** Which head yaw the skeleton draws: the sim's, or as a tracking system reports it. */
export type YawSource = "true" | "tracked";
/** What lights the head ray: the scan detector where the export has its run, else the sim. */
export type LitBy = "detector" | "sim";

export const DETECTOR_COLOR = "#b6e86f"; // --detector in styles.css: the detector's own output
const DEG = Math.PI / 180;

// ---------- the tracked head yaw ----------

const trackedCache = new WeakMap<Run, Float32Array>();

/**
 * The tracked head yaw of every player, index frame * n + player, rad; null when the run has no
 * scan detector run (a stitched match's export). Computed once per run.
 */
export function trackedHead(hero: Hero, run: Run): Float32Array | null {
  const detector = run.detector;
  if (!detector) return null;
  const hit = trackedCache.get(run);
  if (hit) return hit;
  const { n, dt } = hero;
  const frames = run.frames;
  const out = new Float32Array(frames * n);
  const turned = new Float64Array(frames); // integrated turn since frame 0, rad
  for (let j = 0; j < n; j++) {
    for (let f = 1; f < frames; f++)
      turned[f] = turned[f - 1] + detector.omega[(f - 1) * n + j] * dt;
    let sin = 0;
    let cos = 0;
    for (let f = 0; f < frames; f++) {
      const d = run.head[f * n + j] - turned[f];
      sin += Math.sin(d);
      cos += Math.cos(d);
    }
    const start = Math.atan2(sin, cos); // the tracked yaw at frame 0, up to the mean noise
    for (let f = 0; f < frames; f++) out[f * n + j] = wrapAngle(start + turned[f]);
  }
  trackedCache.set(run, out);
  return out;
}

// ---------- what lights the head ray ----------

export const litBy = (run: Run): LitBy => (run.detector ? "detector" : "sim");

const litCache = new WeakMap<Run, Uint8Array>();

/**
 * 1 where player j's head ray is lit at frame f (index f * n + j): over every scan the detector
 * accepted, from its onset to its end; in a stitched match, which has no detector run, over the
 * sim's own scans.
 */
export function litMask(hero: Hero, run: Run): Uint8Array {
  const hit = litCache.get(run);
  if (hit) return hit;
  const { n } = hero;
  const mask = new Uint8Array(run.frames * n);
  const mark = (j: number, start: number, end: number) => {
    for (let f = Math.max(0, start); f <= Math.min(run.frames - 1, end); f++) mask[f * n + j] = 1;
  };
  if (run.detector)
    run.detector.scans.forEach((scans, j) => scans.forEach((s) => mark(j, s.start, s.end)));
  else for (const s of run.scans) mark(hero.ids.indexOf(s.player), s.start, s.end);
  litCache.set(run, mask);
  return mask;
}

// ---------- the pose of every player at one frame ----------

export class Pose {
  source: YawSource = "true"; // the head yaw drawn (tracked only where the export has it)
  litBy: LitBy = "detector";
  yaw: Float32Array; // head yaw drawn, rad
  body: Float32Array; // torso yaw, rad
  twist: Float32Array; // head yaw minus torso yaw, rad in [-pi, pi], counter-clockwise positive
  lit: Uint8Array;
  constructor(n: number) {
    this.yaw = new Float32Array(n);
    this.body = new Float32Array(n);
    this.twist = new Float32Array(n);
    this.lit = new Uint8Array(n);
  }
}

/** Fill `out` at fractional `frame`; `sample` is that frame, sampled by the view. */
export function poseInto(
  out: Pose,
  hero: Hero,
  run: Run,
  sample: Sample,
  frame: number,
  wanted: YawSource,
): Pose {
  const { n } = hero;
  const tracked = wanted === "tracked" ? trackedHead(hero, run) : null;
  const lit = litMask(hero, run);
  const c = clampFrame(run, frame);
  const i0 = Math.floor(c);
  const i1 = Math.min(run.frames - 1, i0 + 1);
  const t = c - i0;
  out.source = tracked ? "tracked" : "true";
  out.litBy = litBy(run);
  for (let j = 0; j < n; j++) {
    let yaw = sample.head[j]; // the true yaw, as the other views draw it
    if (tracked) {
      const a = tracked[i0 * n + j];
      yaw = a + wrapAngle(tracked[i1 * n + j] - a) * t;
    }
    out.yaw[j] = wrapAngle(yaw);
    out.body[j] = sample.body[j];
    out.twist[j] = wrapAngle(yaw - sample.body[j]);
    out.lit[j] = lit[i0 * n + j];
  }
  return out;
}

// ---------- shapes in pitch coordinates (m, rad) ----------

/** The torso line: the two shoulders, across the torso's facing, `half` m either side. */
export function shoulders(x: number, y: number, body: number, half: number) {
  const sx = half * Math.sin(body);
  const sy = half * Math.cos(body);
  return [x + sx, y - sy, x - sx, y + sy] as const; // right shoulder, left shoulder
}

/** The fan's edge angles into `out`, from the torso's facing to the head yaw in equal steps. */
export function fanEdges(body: number, twist: number, out: Float32Array): Float32Array {
  const steps = out.length - 1;
  for (let i = 0; i <= steps; i++) out[i] = body + (twist * i) / steps;
  return out;
}

/** The fan fills in as the head turns off the torso: faint when aligned, solid past 120 degrees. */
export function fanAlpha(twist: number): number {
  const u = Math.min(1, Math.max(0, (Math.abs(twist) - 20 * DEG) / (100 * DEG)));
  return 0.1 + 0.5 * u * u * (3 - 2 * u);
}

// ---------- drawing ----------

/** A batch of thick line segments (screen-space width), rewritten in place every frame. */
export class Segments {
  readonly object: LineSegments2;
  readonly material: LineMaterial;
  count = 0;
  private readonly buffer: InterleavedBuffer;
  private readonly array: Float32Array;
  constructor(max: number, width: number, color: string, opacity: number) {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(Math.max(1, max) * 6));
    this.buffer = (geometry.attributes.instanceStart as InterleavedBufferAttribute).data;
    this.array = this.buffer.array as Float32Array;
    this.material = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity,
      depthTest: false, // drawn over the players, like tracking data over the picture
      depthWrite: false,
    });
    this.material.toneMapped = false;
    this.object = new LineSegments2(geometry, this.material);
    this.object.frustumCulled = false;
  }
  begin(): void {
    this.count = 0;
  }
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const a = this.array;
    const k = this.count * 6;
    if (k + 6 > a.length) return;
    a[k] = ax;
    a[k + 1] = ay;
    a[k + 2] = az;
    a[k + 3] = bx;
    a[k + 4] = by;
    a[k + 5] = bz;
    this.count++;
  }
  end(): void {
    this.buffer.needsUpdate = true;
    (this.object.geometry as LineSegmentsGeometry).instanceCount = this.count;
  }
  /** Segment k as [ax, ay, az, bx, by, bz] in three.js coordinates. */
  segment(k: number): number[] {
    return Array.from(this.array.subarray(k * 6, k * 6 + 6));
  }
  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Sizes and heights of one view, in metres (board sizes are multiplied by the token scale), line
 * widths in CSS px. The board is flat (layer order, no depth test); the broadcast camera draws the
 * torso line at shoulder height and the head ray at eye height over the players, with a spine
 * down to the position, and the fan on the grass under them. The heights are a drawing choice;
 * only the position and the two yaws are data.
 */
const VIEWS = {
  board: {
    shoulder: 1.55, // half the torso line: out past the token (radius 0.95)
    rayFrom: 1.0, // from the token's edge
    ray: 3.2,
    litRay: 4.6,
    fan: 2.3,
    shoulderH: 0,
    eyeH: 0,
    fanH: 0,
    spine: false,
    widths: { torso: 3, spine: 0, ray: 2, lit: 3.5 },
    order: { fan: 7.6, torso: 7.7, ray: 9.5 }, // TacticalView: under the token (8), over its ring
  },
  broadcast: {
    shoulder: 0.32, // wider than real shoulders, to read at broadcast distance
    rayFrom: 0.12,
    ray: 2.4,
    litRay: 3.4,
    fan: 1.3,
    shoulderH: 1.42,
    eyeH: 1.68,
    fanH: 0.06, // just over the grass graphics (0.05 m)
    spine: true,
    widths: { torso: 4, spine: 1.5, ray: 2.5, lit: 4 },
    order: { fan: 1, torso: 15, ray: 15 }, // over the players, under the live tags (20)
  },
} as const;

export type SkeletonVariant = keyof typeof VIEWS;

const FAN_STEPS = 12;
const fanColor = new Color(COLORS.fg);

/** Everything the skeleton draws in one view, as three.js objects under `group`. */
export class SkeletonGeometry {
  readonly group = new Group();
  readonly torso: Segments;
  readonly spine: Segments;
  readonly rays: Segments;
  readonly lit: Segments;
  private readonly fan: BufferGeometry;
  private readonly fanMaterial: MeshBasicMaterial;
  private readonly alphas: Float32Array;
  private readonly edges = new Float32Array(FAN_STEPS + 1);
  private readonly view: (typeof VIEWS)[SkeletonVariant];
  constructor(
    readonly n: number,
    variant: SkeletonVariant,
  ) {
    const v = (this.view = VIEWS[variant]);
    const w = v.widths;
    this.torso = new Segments(n, w.torso, COLORS.fg, 0.95);
    this.spine = new Segments(v.spine ? n : 0, w.spine, COLORS.fg, 0.55);
    this.rays = new Segments(n, w.ray, COLORS.fg, 0.9);
    this.lit = new Segments(n, w.lit, DETECTOR_COLOR, 1);
    this.torso.object.renderOrder = v.order.torso;
    this.spine.object.renderOrder = v.order.torso;
    this.rays.object.renderOrder = v.order.ray;
    this.lit.object.renderOrder = v.order.ray + 0.1;
    this.alphas = new Float32Array(n);
    this.fan = new BufferGeometry();
    const vertices = n * FAN_STEPS * 3;
    this.fan.setAttribute("position", new BufferAttribute(new Float32Array(vertices * 3), 3));
    this.fan.setAttribute("color", new BufferAttribute(new Float32Array(vertices * 4), 4));
    this.fanMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: variant === "broadcast", // on the grass, players stand on it
      side: DoubleSide,
      toneMapped: false,
    });
    const fanMesh = new Mesh(this.fan, this.fanMaterial);
    fanMesh.frustumCulled = false;
    fanMesh.renderOrder = v.order.fan;
    this.group.add(
      fanMesh,
      this.torso.object,
      this.spine.object,
      this.rays.object,
      this.lit.object,
    );
    this.group.visible = false; // until the layer turns it on
  }

  /** The canvas size in CSS px, which screen-space line widths need. */
  resize(width: number, height: number): void {
    for (const s of [this.torso, this.spine, this.rays, this.lit]) {
      s.material.resolution.set(width, height);
    }
  }

  /** Redraw every player from `pose`; `scale` grows the board's shapes with its tokens. */
  update(pose: Pose, sample: Sample, scale: number): void {
    const v = this.view;
    const k = v.spine ? 1 : scale; // the broadcast camera draws to real size
    this.lit.material.color.set(pose.litBy === "detector" ? DETECTOR_COLOR : COLORS.sight);
    for (const s of [this.torso, this.spine, this.rays, this.lit]) s.begin();
    const xyz = this.fan.attributes.position.array as Float32Array;
    const rgba = this.fan.attributes.color.array as Float32Array;
    let vertex = 0;
    for (let j = 0; j < this.n; j++) {
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const [rx, ry, lx, ly] = shoulders(x, y, pose.body[j], v.shoulder * k);
      this.torso.push(rx, v.shoulderH, -ry, lx, v.shoulderH, -ly);
      if (v.spine) this.spine.push(x, 0.05, -y, x, v.shoulderH, -y);
      const c = Math.cos(pose.yaw[j]);
      const s = Math.sin(pose.yaw[j]);
      const ray = pose.lit[j] ? this.lit : this.rays;
      const from = v.rayFrom * k;
      const to = (pose.lit[j] ? v.litRay : v.ray) * k;
      ray.push(x + from * c, v.eyeH, -(y + from * s), x + to * c, v.eyeH, -(y + to * s));

      // The fan: FAN_STEPS triangles from the position, torso facing to head yaw.
      const alpha = (this.alphas[j] = fanAlpha(pose.twist[j]));
      const r = v.fan * k;
      const put = (px: number, py: number) => {
        xyz[vertex * 3] = px;
        xyz[vertex * 3 + 1] = v.fanH;
        xyz[vertex * 3 + 2] = -py;
        rgba[vertex * 4] = fanColor.r;
        rgba[vertex * 4 + 1] = fanColor.g;
        rgba[vertex * 4 + 2] = fanColor.b;
        rgba[vertex * 4 + 3] = alpha;
        vertex++;
      };
      const edges = fanEdges(pose.body[j], pose.twist[j], this.edges);
      for (let i = 0; i < FAN_STEPS; i++) {
        put(x, y);
        put(x + r * Math.cos(edges[i]), y + r * Math.sin(edges[i]));
        put(x + r * Math.cos(edges[i + 1]), y + r * Math.sin(edges[i + 1]));
      }
    }
    for (const s of [this.torso, this.spine, this.rays, this.lit]) s.end();
    this.fan.setDrawRange(0, vertex);
    this.fan.attributes.position.needsUpdate = true;
    this.fan.attributes.color.needsUpdate = true;
  }

  /** The fan's opacity for player j at the last update. */
  fanAlpha(j: number): number {
    return this.alphas[j];
  }

  dispose(): void {
    for (const s of [this.torso, this.spine, this.rays, this.lit]) s.dispose();
    this.fan.dispose();
    this.fanMaterial.dispose();
  }
}
