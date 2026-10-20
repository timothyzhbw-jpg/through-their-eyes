// Geometry of the procedural stadium around the pitch, as numbers only (Stadium.tsx draws it).
// Everything is generated: no models, textures or photos. The stands are one continuous bowl: a
// cross-section (the profile) swept along a rounded rectangle around the pitch, with a lower and
// an overhanging upper tier under a roof. Pitch coordinates (m, origin at the centre spot);
// heights in metres above the grass.

/** Front of the stands: a rounded rectangle (half extents and corner radius, pitch m). */
export const BOWL = { halfX: 62, halfY: 42, radius: 14 };

/**
 * The stands' cross-section, front to back: (setback from the front, height). A front wall, the
 * lower tier's rake, the overhanging upper tier's fascia, its rake, and the back wall.
 */
export const PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1.4],
  [11, 7.2],
  [11, 8.4],
  [9, 8.4],
  [9, 10.2],
  [21, 17.4],
  [23, 24.5],
];
/** The roof: a slab from the top of the back wall forward over the upper tier. */
export const ROOF = { back: [23, 24.5], front: [3, 27] } as const;

/** Seated rows of the crowd: setback range on each rake and row pitch (m). */
const TIERS = [
  { from: 0.6, to: 10.4, row: 0.8, rake: [PROFILE[1], PROFILE[2]] },
  { from: 9.6, to: 20.6, row: 0.85, rake: [PROFILE[5], PROFILE[6]] },
] as const;
const SEAT = 0.6; // m between seats
const AISLE = { every: 24, width: 1.2 }; // m along a row

/** Floodlight masts at the four corners (pitch m) and their height (m). */
export const FLOODLIGHTS = (() => {
  const reach = BOWL.radius + 25; // beyond the back of the stands, on the corner's diagonal
  const cx = BOWL.halfX - BOWL.radius;
  const cy = BOWL.halfY - BOWL.radius;
  const d = reach / Math.SQRT2;
  return [
    [cx + d, cy + d],
    [-cx - d, cy + d],
    [-cx - d, -cy - d],
    [cx + d, -cy - d],
  ].map(([x, y]) => ({ x, y, height: 46 }));
})();

/** Advertising boards, 0.9 m high: 4 m beyond the touchlines, 5.5 m behind the goal lines. */
export const BOARDS = {
  touchline: { y: 38, halfLength: 54 },
  goalLine: { x: 58, halfLength: 32 },
  height: 0.9,
};

/** Height of the stands' top surface at a setback (rakes and back wall), or null off the stands. */
export function standHeight(d: number): number | null {
  if (d < 0) return null;
  if (d <= 9) return lerpProfile(PROFILE[1], PROFILE[2], d);
  if (d <= 21) return lerpProfile(PROFILE[5], PROFILE[6], d);
  if (d <= 23) return lerpProfile(PROFILE[6], PROFILE[7], d);
  return null;
}

/** Height of the roof's underside at a setback, or null outside it. */
export function roofHeight(d: number): number | null {
  const [db, hb] = ROOF.back;
  const [df, hf] = ROOF.front;
  if (d < df || d > db) return null;
  return hf + ((hb - hf) * (d - df)) / (db - df);
}

function lerpProfile(
  [d0, h0]: readonly [number, number],
  [d1, h1]: readonly [number, number],
  d: number,
): number {
  return h0 + ((h1 - h0) * (d - d0)) / (d1 - d0);
}

/** Setback of a pitch point from the front of the stands (negative: in front of them). */
export function setback(x: number, y: number): number {
  const qx = Math.abs(x) - (BOWL.halfX - BOWL.radius);
  const qy = Math.abs(y) - (BOWL.halfY - BOWL.radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - BOWL.radius;
}

/** Length of the loop of the stands at setback `d`. */
export function perimeter(d: number): number {
  const a = BOWL.halfX - BOWL.radius;
  const b = BOWL.halfY - BOWL.radius;
  return 4 * (a + b) + 2 * Math.PI * (BOWL.radius + d);
}

type Side = [length: number, at: (t: number) => [number, number, number, number]];

/** The loop's eight sides at setback `d`, counter-clockwise from the right end's start: right
 * end (going +y), top-right corner, top side (going -x), top-left corner, left end, bottom-left
 * corner, bottom side, bottom-right corner. Each side maps arc length to [x, y, nx, ny], the
 * point and its inward normal. */
function sides(d: number): Side[] {
  const a = BOWL.halfX - BOWL.radius;
  const b = BOWL.halfY - BOWL.radius;
  const r = BOWL.radius + d;
  const arc = (Math.PI / 2) * r;
  return [
    [2 * b, (t) => [a + r, -b + t, -1, 0]],
    [arc, (t) => corner(a, b, r, t / r)],
    [2 * a, (t) => [a - t, b + r, 0, -1]],
    [arc, (t) => corner(-a, b, r, Math.PI / 2 + t / r)],
    [2 * b, (t) => [-a - r, b - t, 1, 0]],
    [arc, (t) => corner(-a, -b, r, Math.PI + t / r)],
    [2 * a, (t) => [-a + t, -b - r, 0, 1]],
    [arc, (t) => corner(a, -b, r, (3 * Math.PI) / 2 + t / r)],
  ];
}

/** The point of the loop at setback `d` at arc length `s`, with its inward normal. */
export function loopPoint(d: number, s: number): [number, number, number, number] {
  const length = perimeter(d);
  let rest = ((s % length) + length) % length;
  for (const [side, at] of sides(d)) {
    if (rest <= side) return at(rest);
    rest -= side;
  }
  return sides(d)[0][1](0);
}

/** The point of side `side` (0-7) at fraction `t` of it: the same fraction lines up across
 * setbacks, which is what sweeping a cross-section needs. */
export function loopAt(d: number, side: number, t: number): [number, number, number, number] {
  const [length, at] = sides(d)[side];
  return at(t * length);
}

function corner(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): [number, number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [cx + r * c, cy + r * s, -c, -s];
}

export interface Seat {
  x: number;
  y: number;
  z: number; // height of the rake under the seat
  facing: number; // yaw towards the pitch (pitch frame, rad)
}

/** Every seat of both tiers, aisles left free. Deterministic. */
export function seats(): Seat[] {
  const out: Seat[] = [];
  for (const tier of TIERS) {
    for (let d = tier.from; d <= tier.to + 1e-9; d += tier.row) {
      const z = lerpProfile(tier.rake[0], tier.rake[1], d);
      const length = perimeter(d);
      for (let s = 0; s < length; s += SEAT) {
        if (s % AISLE.every < AISLE.width) continue;
        const [x, y, nx, ny] = loopPoint(d, s);
        out.push({ x, y, z, facing: Math.atan2(ny, nx) });
      }
    }
  }
  return out;
}

/** A small deterministic hash in [0, 1) for per-seat variety. */
export function hash01(k: number): number {
  const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
