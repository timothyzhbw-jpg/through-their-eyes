// The broadcast camera (SPEC 7: "high side angle, follows the ball, smoothed"), as maths only.
// Like a stadium's main camera it never moves: it sits high behind the near touchline at the
// halfway line and pans, tilts and zooms. A shot is the point on the grass it aims at plus how
// many metres of pitch the frame spans there.
//
// The operator is simulated over the whole run in match time, once (`broadcastPath`): critically
// damped springs pull the aim towards the ball and the zoom towards a width that grows with the
// ball's speed, so passes ease in and out and nothing overshoots; near the edge of the safe frame
// the springs stiffen, and a last-resort clamp keeps the ball inside it. Like an operator who
// reads a pass, from just before the kick until the ball arrives the aim follows a smooth
// S-curve from where the pass starts to where it ends, and the frame widens to hold the receiver;
// the curve starts and stops at rest, so the camera arrives with the ball instead of swinging
// past the receiver (a plain lead ahead of the ball does that). The screen then reads the shot
// at its fractional frame (`shotAt`). So the shot is a function of the frame alone: a seek or a
// plan rewind is a hard cut with no lag, slow motion replays the same camera move slowed down,
// and every screen frame costs one interpolation.
//
// Pitch coordinates as everywhere: metres, origin at the centre spot, x along the length, y
// across; the near touchline is y = -34. three.js maps (x, y, height) to (x, height, -y).

import type { Run } from "../data/hero";

/** Where the camera stands (pitch m) and how high (m): behind the near touchline. */
export const BROADCAST_CAMERA = { x: 0, y: -60, height: 21 };
/** The aim point stays inside this box (pitch m), so the camera never films the stands. */
export const AIM_BOUNDS = { x: 46, y: 30 };
/** Frame width at the aim point (m): base, plus this much per m/s of ball speed, clamped. */
export const WIDTH = { base: 36, perMps: 1.4, min: 30, max: 68 };
/** The ball stays inside this fraction of the half-frame, both ways (NDC of a 16:9 frame). */
export const SAFE_FRAME = { x: 0.78, y: 0.7 };
/** The frame the safe frame is defined on; any canvas shows at least this frame. */
export const REF_ASPECT = 16 / 9;

const OMEGA = { pan: 4, tilt: 3, zoom: 1.5 }; // rad/s of the critically damped springs
const SOFT_EDGE = 0.75; // fraction of the safe frame beyond which the pan springs stiffen
const EDGE_GAIN = 3; // stiffness multiplier added at the safe frame's edge
const SUBSTEPS = 8; // per 25 Hz frame: the operator runs at 200 Hz
// Pass reading: start this long before the kick, widen over this long, keep this slack (m) round
// the receiver, stiffen the springs this much (the S-curve is smooth already), and ease the
// stiffness back over this long after the reception, so the camera settles without overshoot.
const READ = { earlyS: 0.5, openS: 0.6, margin: 4, stiffen: 2.2, settleS: 0.8 };

/** A pass in flight, by frame: the ball leaves at `start` and is received (or lost) at `end`. */
export interface Flight {
  start: number;
  end: number;
}

export interface Shot {
  x: number; // aim point on the grass, pitch m
  y: number;
  width: number; // frame width at the aim point, m
}

export interface BroadcastPath {
  dt: number; // s per frame
  frames: number;
  /** Shot at every substep: (x, y, width) at index 3 * (frame * SUBSTEPS + k). */
  shots: Float32Array;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The ball's position on screen for this shot: NDC of the 16:9 reference frame, x right, y up. */
export function project(shot: Shot, [px, py]: readonly [number, number]): [number, number] {
  const c = BROADCAST_CAMERA;
  // Forward: camera -> aim point; right = forward x up(z); up' = right x forward.
  let fx = shot.x - c.x;
  let fy = shot.y - c.y;
  let fz = -c.height;
  const dist = Math.hypot(fx, fy, fz);
  fx /= dist;
  fy /= dist;
  fz /= dist;
  const rn = Math.hypot(fy, fx);
  const rx = fy / rn;
  const ry = -fx / rn;
  const ux = ry * fz;
  const uy = -rx * fz;
  const uz = rx * fy - ry * fx;
  const dx = px - c.x;
  const dy = py - c.y;
  const dz = -c.height;
  const depth = dx * fx + dy * fy + dz * fz;
  const tanH = shot.width / 2 / dist;
  const tanV = tanH / REF_ASPECT;
  return [(dx * rx + dy * ry) / (depth * tanH), (dx * ux + dy * uy + dz * uz) / (depth * tanV)];
}

/** How far out the ball is, as a fraction of the safe frame (1 = on its edge). */
function edge(shot: Shot, ball: readonly [number, number]): number {
  const [u, v] = project(shot, ball);
  return Math.max(Math.abs(u) / SAFE_FRAME.x, Math.abs(v) / SAFE_FRAME.y);
}

/** One step of `h` s of a critically damped spring towards a fixed target. Returns [x, v]. */
function spring(x: number, v: number, target: number, omega: number, h: number) {
  const x0 = x - target;
  const c = v + omega * x0;
  const e = Math.exp(-omega * h);
  return [target + (x0 + c * h) * e, (c - omega * (x0 + c * h)) * e] as const;
}

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Run the camera operator over a ball track (`ball[2 f + xy]`, m, one row per frame) and the
 * passes in it. Where a pass ends is read off the track itself, at its end frame.
 */
export function broadcastPath(
  ball: Float32Array,
  dt: number,
  flights: readonly Flight[] = [],
): BroadcastPath {
  const frames = ball.length / 2;
  const last = frames - 1;
  const early = READ.earlyS / dt;
  const settle = READ.settleS / dt;
  const endOf = (p: Flight) => Math.min(p.end, last);
  /** Reading the pass in flight at frame q: the aim on its S-curve (null: the ball), the width
   * that holds where it ends, and the springs' stiffness factor. */
  const reading = (q: number): { aim: [number, number] | null; width: number; stiff: number } => {
    const pass = flights.find((p) => q >= p.start - early && q < endOf(p));
    if (pass) {
      const s = Math.max(0, Math.min(pass.start, last));
      const e = endOf(pass);
      const from = s - early;
      const u = smoothstep((q - from) / (e - from));
      const [sx, sy, ex, ey] = [ball[2 * s], ball[2 * s + 1], ball[2 * e], ball[2 * e + 1]];
      const open = smoothstep(((q - from) * dt) / READ.openS);
      return {
        aim: [sx + (ex - sx) * u, sy + (ey - sy) * u],
        width: open * (Math.hypot(ex - sx, ey - sy) / SAFE_FRAME.x + READ.margin),
        stiff: 1 + (READ.stiffen - 1) * open,
      };
    }
    const done = flights.find((p) => q >= endOf(p) && q < endOf(p) + settle);
    const fade = done ? 1 - smoothstep((q - endOf(done)) / settle) : 0;
    return { aim: null, width: 0, stiff: 1 + (READ.stiffen - 1) * fade };
  };
  const shots = new Float32Array(3 * ((frames - 1) * SUBSTEPS + 1));
  const h = dt / SUBSTEPS;
  const widthFor = (speed: number) =>
    clamp(WIDTH.base + WIDTH.perMps * speed, WIDTH.min, WIDTH.max);
  const speedOf = (i: number) =>
    i < frames - 1
      ? Math.hypot(ball[2 * i + 2] - ball[2 * i], ball[2 * i + 3] - ball[2 * i + 1]) / dt
      : 0;
  // Start settled on the ball.
  let x = clamp(ball[0], -AIM_BOUNDS.x, AIM_BOUNDS.x);
  let y = clamp(ball[1], -AIM_BOUNDS.y, AIM_BOUNDS.y);
  let width = widthFor(speedOf(0));
  let vx = 0;
  let vy = 0;
  let vw = 0;
  shots.set([x, y, width], 0);
  for (let i = 0; i < frames - 1; i++) {
    const [x0, y0, x1, y1] = [ball[2 * i], ball[2 * i + 1], ball[2 * i + 2], ball[2 * i + 3]];
    const bvx = (x1 - x0) / dt;
    const bvy = (y1 - y0) / dt;
    const speedWidth = widthFor(Math.hypot(bvx, bvy));
    for (let k = 1; k <= SUBSTEPS; k++) {
      const s = k / SUBSTEPS;
      const b: [number, number] = [x0 + (x1 - x0) * s, y0 + (y1 - y0) * s];
      const read = reading(i + s);
      const [ax, ay] = read.aim ?? b;
      const gx = clamp(ax, -AIM_BOUNDS.x, AIM_BOUNDS.x);
      const gy = clamp(ay, -AIM_BOUNDS.y, AIM_BOUNDS.y);
      const targetWidth = Math.max(speedWidth, Math.min(WIDTH.max, read.width));
      // Stiffen the pan smoothly as the ball nears the edge of the safe frame.
      const out = Math.max(0, (edge({ x, y, width }, b) - SOFT_EDGE) / (1 - SOFT_EDGE));
      const boost = 1 + EDGE_GAIN * out * out;
      const stiff = read.stiff;
      [x, vx] = spring(x, vx, gx, OMEGA.pan * boost * stiff, h);
      [y, vy] = spring(y, vy, gy, OMEGA.tilt * boost * stiff, h);
      [width, vw] = spring(width, vw, targetWidth, OMEGA.zoom * stiff, h);
      // Last resort: move the aim towards the ball just enough to keep it in the safe frame.
      if (edge({ x, y, width }, b) > 1) {
        const bx = clamp(b[0], -AIM_BOUNDS.x, AIM_BOUNDS.x);
        const by = clamp(b[1], -AIM_BOUNDS.y, AIM_BOUNDS.y);
        let lo = 0;
        let hi = 1;
        for (let n = 0; n < 24; n++) {
          const a = (lo + hi) / 2;
          if (edge({ x: x + (bx - x) * a, y: y + (by - y) * a, width }, b) > 1) lo = a;
          else hi = a;
        }
        x += (bx - x) * hi;
        y += (by - y) * hi;
        vx += (bvx - vx) * hi;
        vy += (bvy - vy) * hi;
      }
      // Never aim off the pitch: stop at the bounds.
      if (Math.abs(x) > AIM_BOUNDS.x) [x, vx] = [Math.sign(x) * AIM_BOUNDS.x, 0];
      if (Math.abs(y) > AIM_BOUNDS.y) [y, vy] = [Math.sign(y) * AIM_BOUNDS.y, 0];
      shots.set([x, y, width], 3 * (i * SUBSTEPS + k));
    }
  }
  return { dt, frames, shots };
}

/** The shot at a fractional frame (linear between substeps). */
export function shotAt(path: BroadcastPath, frame: number, out?: Shot): Shot {
  const last = (path.frames - 1) * SUBSTEPS;
  const q = clamp(frame * SUBSTEPS, 0, last);
  const i = Math.min(last - 1, Math.floor(q));
  const s = last > 0 ? q - i : 0;
  const a = 3 * Math.max(0, i);
  const b = last > 0 ? a + 3 : a;
  const m = path.shots;
  const shot = out ?? { x: 0, y: 0, width: 0 };
  shot.x = m[a] + (m[b] - m[a]) * s;
  shot.y = m[a + 1] + (m[b + 1] - m[a + 1]) * s;
  shot.width = m[a + 2] + (m[b + 2] - m[a + 2]) * s;
  return shot;
}

const paths = new WeakMap<Run, BroadcastPath>();

/** The passes of a run (export events with an end frame). */
export function flightsOf(run: Run): Flight[] {
  return run.events
    .filter((e) => e.type === "pass" && typeof e.attrs.end === "number")
    .map((e) => ({ start: e.frame, end: e.attrs.end as number }));
}

/**
 * The camera path of a run, computed on first use. In live mode the stream writes frames into
 * the run as they arrive; they are the same frames as the match export loaded first (the feed
 * checks it is the same match), so the path computed from the export holds.
 */
export function pathFor(run: Run, dt: number): BroadcastPath {
  let path = paths.get(run);
  if (!path) {
    path = broadcastPath(run.ball.subarray(0, 2 * run.frames), dt, flightsOf(run));
    paths.set(run, path);
  }
  return path;
}

export interface CameraPose {
  position: [number, number, number]; // three.js
  target: [number, number, number];
  fov: number; // vertical, degrees (PerspectiveCamera.fov)
}

/**
 * The three.js camera for a shot on a canvas of this aspect ratio. The lens always shows at least
 * the 16:9 reference frame (more at the sides on a wider canvas, more above and below on a
 * narrower one), so the safe frame stays on screen whatever the layout.
 */
export function cameraPose(shot: Shot, aspect: number): CameraPose {
  const c = BROADCAST_CAMERA;
  const dist = Math.hypot(shot.x - c.x, shot.y - c.y, c.height);
  const tanH = shot.width / 2 / dist;
  const tanV = tanH / Math.min(aspect, REF_ASPECT);
  return {
    position: [c.x, c.height, -c.y],
    target: [shot.x, 0, -shot.y],
    fov: (2 * Math.atan(tanV) * 180) / Math.PI,
  };
}
