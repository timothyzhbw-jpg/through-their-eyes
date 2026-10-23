// Render-only body separation (SPEC 7). The sim lets two bodies come closer than a body is wide
// (corners, presses); drawn as they are, the animated footballers pass through each other. This
// moves only where a mesh is placed. The sim, the export and every number stay as they are, and
// the overlays (tactical board, pitch control, belief rings, radar, evidence) keep the true spots.
//
// separateInto is a pure function of one frame's positions (and who holds the ball): two bodies
// closer than MIN_GAP are pushed apart along the line between them, the ball carrier moving less,
// no one further than MAX_OFFSET. There is no state between frames, so seeking or replaying gives
// the same picture. Three things keep it from popping, again without state:
// - the push grows from zero at MIN_GAP, so it is continuous in the positions;
// - the carrier's share comes from a window of frames (carrierWeights), so a change of
//   possession eases over CARRY_WINDOW frames;
// - when two bodies run through each other, the line between them turns half a circle in a frame
//   or two and the push would flip sides. Separation leans the push to one side of their path
//   (sideLean), chosen from their motion a few frames either side, so they slide past.

/** Body radius, m: the tokens' capsule is 0.28, the first-person picture's 0.3. */
export const BODY_RADIUS = 0.3;
/** Closest two bodies may be, centre to centre, m. */
export const MIN_GAP = 2 * BODY_RADIUS;
/** Furthest a body is moved, m. Two bodies on one spot can still be MIN_GAP apart (2 x 0.35). */
export const MAX_OFFSET = 0.35;
/** How much less the ball carrier gives way: his share of a push is 1 - CARRIER_YIELD of a
 * free player's. */
export const CARRIER_YIELD = 0.65;
/** Half-width, in frames, of the tent the carrier's share is averaged over (0.2 s at 25 Hz). */
export const CARRY_WINDOW = 5;
/** Frames either side of `f` whose positions say which way two bodies are heading (0.12 s). */
export const LEAN_WINDOW = 3;
/** The push leans this far (m) off the line between two bodies heading through each other... */
export const LEAN = 0.4;
/** ...in full once they close by this much (m) over the window; less in proportion. */
const LEAN_CLOSING = 1;
/** Passing nearer than this (m), which side they are on is not told apart (sideLean). */
const LEAN_SIDE = 0.1;

const ITERATIONS = 12; // relaxation passes; crowds of three or more need a few
const SETTLED = 1e-4; // m: stop once a pass moves no one more than this
const EPS = 1e-9;

/**
 * How much each player holds the ball at fractional frame `f`, in [0, 1], summing to at most 1:
 * the share of the frames within CARRY_WINDOW of `f` (a tent) in which he owns it. `owner[frame]`
 * is a player index, -1 when free. Continuous in `f`; `out` has one slot per player.
 */
export function carrierWeights(
  owner: ArrayLike<number>,
  frames: number,
  f: number,
  out: Float32Array,
): Float32Array {
  out.fill(0);
  const c = Math.max(0, Math.min(frames - 1, f));
  const lo = Math.max(0, Math.ceil(c - CARRY_WINDOW + 1e-9));
  const hi = Math.min(frames - 1, Math.floor(c + CARRY_WINDOW - 1e-9));
  let total = 0;
  for (let i = lo; i <= hi; i++) {
    const w = 1 - Math.abs(i - c) / CARRY_WINDOW;
    total += w;
    const j = owner[i];
    if (j >= 0 && j < out.length) out[j] += w;
  }
  if (total > 0) for (let j = 0; j < out.length; j++) out[j] /= total;
  return out;
}

/**
 * Render offsets, m, into `out` (x, y per player, pitch frame; zero for anyone with room).
 * `pos`: x, y per player; `carry`: each player's share of the ball (carrierWeights), or null.
 * Bodies closer than MIN_GAP are pushed apart along the line between them; the shares of a
 * push go by how little each yields (the carrier less). Each offset is capped at MAX_OFFSET;
 * where three or more crowd and the cap stops it, the gaps still grow as far as it allows.
 * `lean`: for the pair (i, j), i < j, at 2 * (i * n + j), the vector added to the line between
 * them to fix the side of the push (Separation.lean), or null for the plain line.
 */
export function separateInto(
  out: Float32Array,
  pos: ArrayLike<number>,
  n: number,
  carry: ArrayLike<number> | null = null,
  lean: ArrayLike<number> | null = null,
): Float32Array {
  out.fill(0, 0, 2 * n);
  for (let pass = 0; pass < ITERATIONS; pass++) {
    let moved = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[2 * j] + out[2 * j] - pos[2 * i] - out[2 * i];
        const dy = pos[2 * j + 1] + out[2 * j + 1] - pos[2 * i + 1] - out[2 * i + 1];
        const d2 = dx * dx + dy * dy;
        if (d2 >= MIN_GAP * MIN_GAP) continue;
        // The push is along u, the line between them (leaned): the s >= 0 that makes
        // |r + s u| = MIN_GAP. For u along r it is MIN_GAP - d.
        let ux = dx;
        let uy = dy;
        if (lean) {
          ux += lean[2 * (i * n + j)];
          uy += lean[2 * (i * n + j) + 1];
        }
        let len = Math.hypot(ux, uy);
        if (len < EPS) {
          ux = 1; // exactly one spot: a fixed direction
          uy = 0;
          len = 1;
        }
        ux /= len;
        uy /= len;
        const along = dx * ux + dy * uy;
        const s = -along + Math.sqrt(Math.max(0, along * along + MIN_GAP * MIN_GAP - d2));
        const yi = carry ? 1 - CARRIER_YIELD * carry[i] : 1;
        const yj = carry ? 1 - CARRIER_YIELD * carry[j] : 1;
        const sj = (s * yj) / (yi + yj); // j's share of the push; i's is s - sj
        moved = Math.max(
          moved,
          shift(out, j, ux * sj, uy * sj),
          shift(out, i, -ux * (s - sj), -uy * (s - sj)),
        );
      }
    }
    if (moved < SETTLED) break;
  }
  return out;
}

/** Add (x, y) to player j's offset, cut back to MAX_OFFSET; returns how far it moved. */
function shift(out: Float32Array, j: number, x: number, y: number): number {
  const ox = out[2 * j];
  const oy = out[2 * j + 1];
  let nx = ox + x;
  let ny = oy + y;
  const len = Math.hypot(nx, ny);
  if (len > MAX_OFFSET) {
    nx *= MAX_OFFSET / len;
    ny *= MAX_OFFSET / len;
  }
  out[2 * j] = nx;
  out[2 * j + 1] = ny;
  return Math.hypot(nx - ox, ny - oy);
}

/** A run's tracks: `pos` is x, y per player per frame (hero.ts Run). */
export interface Track {
  pos: ArrayLike<number>;
  owner: ArrayLike<number>;
  frames: number;
}

/** Positions at fractional frame `f` (held at the ends of the run), straight between frames. */
export function positionsAt(track: Track, n: number, f: number, out: Float32Array): Float32Array {
  const c = Math.max(0, Math.min(track.frames - 1, f));
  const i0 = Math.floor(c);
  const i1 = Math.min(track.frames - 1, i0 + 1);
  const t = c - i0;
  for (let k = 0; k < 2 * n; k++) {
    const a = track.pos[i0 * 2 * n + k];
    out[k] = a + (track.pos[i1 * 2 * n + k] - a) * t;
  }
  return out;
}

/**
 * The offsets of the views that place meshes: `off` per player, and `ball`, the carriers' share
 * of them (the ball stays at his feet). A function of the track and the frame alone.
 */
export class Separation {
  off: Float32Array;
  carry: Float32Array;
  ball = [0, 0] as [number, number];
  /** The side lean of every pair (separateInto), as of the last update. */
  lean: Float32Array;
  private before: Float32Array;
  private now: Float32Array;
  private after: Float32Array;
  private lastTrack: Track | null = null;
  private lastFrame = NaN;
  constructor(private n: number) {
    this.off = new Float32Array(2 * n);
    this.carry = new Float32Array(n);
    this.lean = new Float32Array(2 * n * n);
    this.before = new Float32Array(2 * n);
    this.now = new Float32Array(2 * n);
    this.after = new Float32Array(2 * n);
  }

  /** Fill for fractional frame `f` of `track`. */
  update(track: Track, f: number): this {
    if (track === this.lastTrack && f === this.lastFrame) return this; // solved already
    this.lastTrack = track;
    this.lastFrame = f;
    const { n, off, carry, ball } = this;
    carrierWeights(track.owner, track.frames, f, carry);
    positionsAt(track, n, f, this.now);
    this.sideLean(track, f);
    separateInto(off, this.now, n, carry, this.lean);
    ball[0] = 0;
    ball[1] = 0;
    for (let j = 0; j < n; j++) {
      ball[0] += carry[j] * off[2 * j];
      ball[1] += carry[j] * off[2 * j + 1];
    }
    return this;
  }

  /**
   * Two bodies heading through each other: the line between them turns half a circle within a
   * frame or two, and with it the side of a push. So the push is leaned to one side of their
   * path: for the pair (i, j) the vector LEAN long, perpendicular to their relative motion v over
   * LEAN_WINDOW frames either side, on the side of the path they are mostly on. Only
   * bodies closing in at speed lean (in proportion to |v| up to LEAN_CLOSING); a pair at rest
   * is pushed along its line. The side comes from the mean of the relative position over
   * the window, which does not flip as they pass.
   */
  private sideLean(track: Track, f: number): void {
    const { n, lean, before, now, after } = this;
    positionsAt(track, n, f - LEAN_WINDOW, before);
    positionsAt(track, n, f + LEAN_WINDOW, after);
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const at = 2 * (i * n + j);
        lean[at] = 0;
        lean[at + 1] = 0;
        const x = (k: number, a: Float32Array) => a[2 * j + k] - a[2 * i + k];
        const dx = now[2 * j] - now[2 * i];
        const dy = now[2 * j + 1] - now[2 * i + 1];
        if (dx * dx + dy * dy >= 4 * MIN_GAP * MIN_GAP) continue; // far from touching
        const vx = x(0, after) - x(0, before);
        const vy = x(1, after) - x(1, before);
        const speed = Math.hypot(vx, vy);
        if (speed < EPS) continue;
        // n: perpendicular to the motion; its side: where the mean relative position lies
        const nx = -vy / speed;
        const ny = vx / speed;
        const mean =
          ((x(0, before) + dx + x(0, after)) * nx + (x(1, before) + dy + x(1, after)) * ny) / 3;
        // Where they miss each other by less than LEAN_SIDE the data cannot say which side;
        // the pair then has a side of its own (by index), blended in so that nothing flips.
        const w = Math.min(1, Math.abs(mean) / LEAN_SIDE);
        const side = w * (mean < 0 ? -1 : 1) + (1 - w) * ((i + j) & 1 ? 1 : -1);
        const k = LEAN * Math.min(1, speed / LEAN_CLOSING) * side;
        lean[at] = k * nx;
        lean[at + 1] = k * ny;
      }
    }
  }
}

const shared = new WeakMap<object, Separation>();

/** One Separation per `key` (the hero): every view of a frame shares one solve, as update memoises it. */
export function sharedSeparation(key: object, n: number): Separation {
  let separation = shared.get(key);
  if (!separation) shared.set(key, (separation = new Separation(n)));
  return separation;
}
