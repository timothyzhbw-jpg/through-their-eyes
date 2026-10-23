// The scan radar (SPEC 7): while a player scans, a short sector on the grass at his feet, 60
// degrees wide, centred on his head yaw and turning with it, with a thin edge on the side his head
// turned to. It replaces lighting up the head ray: a long bright line off a player read as an
// arrow (Bowen, 10/22: "要不然把绿色换成雷达"). With the skeleton on it marks every scanning
// player, on the board and the broadcast camera; without it, on both, the key scan's player during
// his key scan, so the look reads at a glance. First person keeps its own look grade.
//
// Scanning is what the scan detector flags on the tracked head yaw, from a scan's onset to its
// end; a stitched match's export has no detector run, so there it is the sim's own scans. The
// radar eases in from a scan's first frame and out to its last over about RADAR.fadeS of match
// time: a function of the frame, like the beat, so a paused or replayed frame looks the same, and
// it is on exactly the frames flagged.

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial } from "three";
import { clampFrame, wrapAngle, type Hero, type Run, type Sample } from "../data/hero";
import { COLORS } from "../views/scene";

/** What tells a scan: the scan detector where the export has its run, else the sim. */
export type ScanSource = "detector" | "sim";
export const scanSource = (run: Run): ScanSource => (run.detector ? "detector" : "sim");

/** Whose scans: every player's (the skeleton on), or only the key scan's player's key scan. */
export type RadarScope = "every" | "key";

const DEG = Math.PI / 180;

export const RADAR = {
  half: 30 * DEG, // half the sector's angle: 60 degrees wide
  fadeS: 0.15, // match seconds it takes to ease in and out
  edge: 0.95, // opacity of the edge on the side his head turned to, at full strength
};

/**
 * Each view: sizes in metres, the fill's opacity (at his feet, at the trailing edge, at the
 * leading edge) at full strength. The broadcast camera draws the radar at real size on the grass,
 * depth tested so players stand on it, over the skeleton's fan (0.06 m, order 1). The board is
 * flat (layer order, no depth test: over the fan, under the torso line) and its sizes are drawing
 * choices that grow with the token scale: there it reaches past the token (0.95 m), the skeleton's
 * fan (2.3 m) and head ray (3.2 m), or 2 m would show 10 px of it, and a dark backing (`backing`:
 * its opacity, `backingPx` past the rim) keeps it apart from the beat's gold sweep and the vision
 * cone it sits on.
 */
const VIEWS = {
  board: {
    radius: 4.5,
    height: 0,
    edgePx: 1.5,
    fill: { centre: 0.5, trail: 0.24, lead: 0.62 },
    backing: 0.32,
    backingPx: 2,
    order: 7.65,
  },
  broadcast: {
    radius: 2,
    height: 0.065,
    edgeM: 0.05,
    fill: { centre: 0.36, trail: 0.16, lead: 0.46 },
    backing: 0,
    backingPx: 0,
    order: 1.5,
  },
} as const;

export type RadarVariant = keyof typeof VIEWS;

// ---------- which frames: one track per run and scope ----------

/** Per frame and player (index f * n + j): whether he is scanning, and where in that scan. */
export interface RadarTrack {
  on: Uint8Array; // 1 on the frames he scans
  since: Uint16Array; // frames since the scan's first frame
  until: Uint16Array; // frames to its last frame
  side: Int8Array; // 1: his head turned counter-clockwise of the torso over the scan; -1: clockwise
}

const trackCache = new WeakMap<Run, Partial<Record<RadarScope, RadarTrack>>>();

/** The scans of a run as [player, first frame, last frame], for this scope. */
function scansOf(hero: Hero, run: Run, scope: RadarScope): [number, number, number][] {
  const out: [number, number, number][] = [];
  const detected = run.detector?.scans;
  if (scope === "every") {
    if (detected)
      detected.forEach((scans, j) => scans.forEach((s) => out.push([j, s.start, s.end])));
    else for (const s of run.scans) out.push([hero.ids.indexOf(s.player), s.start, s.end]);
    return out;
  }
  for (const key of run.scans.filter((s) => s.key)) {
    const j = hero.ids.indexOf(key.player);
    if (!detected) out.push([j, key.start, key.end]);
    else
      for (const s of detected[j] ?? [])
        if (s.start <= key.end && s.end >= key.start) out.push([j, s.start, s.end]);
  }
  return out;
}

/** The radar's frames for a run: every scan, or the key scans only. Computed once per run. */
export function radarTrack(hero: Hero, run: Run, scope: RadarScope): RadarTrack {
  let byScope = trackCache.get(run);
  if (!byScope) trackCache.set(run, (byScope = {}));
  const hit = byScope[scope];
  if (hit) return hit;
  const { n } = hero;
  const size = run.frames * n;
  const track: RadarTrack = {
    on: new Uint8Array(size),
    since: new Uint16Array(size),
    until: new Uint16Array(size),
    side: new Int8Array(size),
  };
  // Per player, scans that overlap or touch merge into one: the radar never dips between them.
  const spans = new Map<number, [number, number][]>();
  for (const [j, start, end] of scansOf(hero, run, scope)) {
    const a = Math.max(0, start);
    const b = Math.min(run.frames - 1, end);
    if (j < 0 || b < a) continue;
    const list = spans.get(j) ?? [];
    list.push([a, b]);
    spans.set(j, list);
  }
  for (const [j, list] of spans) {
    list.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const [a, b] of list) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    for (const [a, b] of merged) {
      let twist = 0; // which way his head turned off the torso over the scan
      for (let f = a; f <= b; f++) twist += wrapAngle(run.head[f * n + j] - run.body[f * n + j]);
      const side = twist < 0 ? -1 : 1;
      for (let f = a; f <= b; f++) {
        const k = f * n + j;
        track.on[k] = 1;
        track.since[k] = f - a;
        track.until[k] = b - f;
        track.side[k] = side;
      }
    }
  }
  byScope[scope] = track;
  return track;
}

/**
 * The radar's strength (0..1) for player j at fractional `frame`: 0 off a scan; on a scan it
 * eases in from the first frame and out to the end of the last, each over `fadeFrames`.
 */
export function radarAlpha(
  track: RadarTrack,
  n: number,
  frames: number,
  j: number,
  frame: number,
  fadeFrames: number,
): number {
  const c = Math.max(0, Math.min(frames - 1, frame));
  const i = Math.floor(c);
  const k = i * n + j;
  if (!track.on[k]) return 0;
  const u = c - i;
  const x = Math.min(track.since[k] + u + 1, track.until[k] + 1 - u) / fadeFrames;
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// ---------- drawing ----------

const STEPS = 10; // fill triangles per sector
const accent = new Color(COLORS.floodlight);
const ink = new Color("#0a100d"); // --ink in styles.css

/** Every radar of one view, as one mesh rewritten in place each frame. */
export class RadarGeometry {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private readonly alphas: Float32Array;
  private readonly view: (typeof VIEWS)[RadarVariant];
  /** Vertices of one radar, in drawing order: the dark backing (the board's), the fill, the edge. */
  readonly parts: { backing: number; fill: number; edge: number };
  constructor(
    readonly n: number,
    variant: RadarVariant,
  ) {
    this.view = VIEWS[variant];
    this.alphas = new Float32Array(n);
    this.parts = { backing: this.view.backing > 0 ? STEPS * 3 : 0, fill: STEPS * 3, edge: 6 };
    const p = this.parts;
    const vertices = n * (p.backing + p.fill + p.edge);
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices * 3), 3));
    this.geometry.setAttribute("color", new BufferAttribute(new Float32Array(vertices * 4), 4));
    const flat = variant === "board";
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: !flat, // on the grass, players stand on it
      polygonOffset: !flat,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: DoubleSide,
      toneMapped: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.view.order;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * Redraw from `track` at fractional `frame`, around each player's position in `sample` and his
   * head yaw in `yaw`; `scale` grows the board's radar with its tokens, `px` is metres per CSS
   * pixel there (its edge keeps one width on screen).
   */
  update(
    track: RadarTrack,
    run: Run,
    dt: number,
    frame: number,
    sample: Sample,
    yaw: Float32Array,
    scale = 1,
    px = 0,
  ): void {
    const v = this.view;
    const n = this.n;
    const c = clampFrame(run, frame);
    const fadeFrames = RADAR.fadeS / dt;
    const r = v.radius * ("edgePx" in v ? scale : 1);
    const edge = "edgePx" in v ? v.edgePx * px : v.edgeM;
    const xyz = this.geometry.attributes.position.array as Float32Array;
    const rgba = this.geometry.attributes.color.array as Float32Array;
    let vertex = 0;
    const put = (x: number, y: number, alpha: number, color = accent) => {
      xyz[vertex * 3] = x;
      xyz[vertex * 3 + 1] = v.height;
      xyz[vertex * 3 + 2] = -y;
      rgba[vertex * 4] = color.r;
      rgba[vertex * 4 + 1] = color.g;
      rgba[vertex * 4 + 2] = color.b;
      rgba[vertex * 4 + 3] = alpha;
      vertex++;
    };
    const back = r + v.backingPx * px;
    for (let j = 0; j < n; j++) {
      const a = (this.alphas[j] = radarAlpha(track, n, run.frames, j, c, fadeFrames));
      if (a <= 0) continue;
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const side = track.side[Math.floor(c) * n + j] || 1;
      const lead = yaw[j] + side * RADAR.half;
      const trail = yaw[j] - side * RADAR.half;
      if (this.parts.backing)
        for (let i = 0; i < STEPS; i++) {
          const a0 = trail + ((lead - trail) * i) / STEPS;
          const a1 = trail + ((lead - trail) * (i + 1)) / STEPS;
          put(x, y, a * v.backing, ink);
          put(x + back * Math.cos(a0), y + back * Math.sin(a0), a * v.backing, ink);
          put(x + back * Math.cos(a1), y + back * Math.sin(a1), a * v.backing, ink);
        }
      for (let i = 0; i < STEPS; i++) {
        const w0 = i / STEPS;
        const w1 = (i + 1) / STEPS;
        const a0 = trail + (lead - trail) * w0;
        const a1 = trail + (lead - trail) * w1;
        const f = v.fill;
        put(x, y, a * f.centre);
        put(x + r * Math.cos(a0), y + r * Math.sin(a0), a * (f.trail + (f.lead - f.trail) * w0));
        put(x + r * Math.cos(a1), y + r * Math.sin(a1), a * (f.trail + (f.lead - f.trail) * w1));
      }
      // The edge on the side his head turned to: a thin quad from his feet to the rim.
      const ex = Math.cos(lead);
      const ey = Math.sin(lead);
      const ox = (-ey * edge) / 2;
      const oy = (ex * edge) / 2;
      const tipX = x + r * ex;
      const tipY = y + r * ey;
      const e = a * RADAR.edge;
      put(x + ox, y + oy, e);
      put(tipX + ox, tipY + oy, e);
      put(tipX - ox, tipY - oy, e);
      put(x + ox, y + oy, e);
      put(tipX - ox, tipY - oy, e);
      put(x - ox, y - oy, e);
    }
    this.geometry.setDrawRange(0, vertex);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  /** Player j's radar strength at the last update (0: none drawn). */
  alpha(j: number): number {
    return this.alphas[j];
  }

  /** The number of vertices drawn at the last update. */
  get drawn(): number {
    return this.geometry.drawRange.count;
  }

  /** Vertex k as [x, y, z, alpha] in three.js coordinates. */
  vertex(k: number): number[] {
    const xyz = this.geometry.attributes.position.array as Float32Array;
    const rgba = this.geometry.attributes.color.array as Float32Array;
    return [xyz[k * 3], xyz[k * 3 + 1], xyz[k * 3 + 2], rgba[k * 4 + 3]];
  }

  /** Vertex k's colour as a hex string. */
  colorOf(k: number): string {
    const rgba = this.geometry.attributes.color.array as Float32Array;
    return `#${new Color(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]).getHexString()}`;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
