// Acceptance checks for the broadcast camera (SPEC 7: "high side angle, follows the ball,
// smoothed"): eased pan and zoom, no overshoot or jitter on fast passes, the ball kept inside a
// safe frame, the aim kept on the pitch, and a hard cut (no lag) on a seek.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { alertsAt, unseenLabel } from "../alerts/blindSide";
import { parseHero, speedAt, type Run } from "../data/hero";
import {
  AIM_BOUNDS,
  broadcastPath,
  BROADCAST_CAMERA,
  flightsOf,
  cameraPose,
  pathFor,
  project,
  REF_ASPECT,
  SAFE_FRAME,
  shotAt,
  WIDTH,
  type Shot,
} from "./broadcast";
import { liveTags, SPRINT_MPS } from "./broadcastTags";

const DT = 0.04; // s per frame, as in the export
const FPS = 60; // screen frames per second

/** A ball track at 25 Hz from a function of match time (s). */
function track(seconds: number, at: (t: number) => [number, number]): Float32Array {
  const frames = Math.round(seconds / DT) + 1;
  const ball = new Float32Array(2 * frames);
  for (let f = 0; f < frames; f++) ball.set(at(f * DT), 2 * f);
  return ball;
}

/** The ball at a fractional frame, linear between frames (as the views sample it). */
function ballAt(ball: Float32Array, f: number): [number, number] {
  const last = ball.length / 2 - 1;
  const i = Math.min(last - 1, Math.max(0, Math.floor(f)));
  const s = Math.min(1, Math.max(0, f - i));
  return [
    ball[2 * i] + (ball[2 * i + 2] - ball[2 * i]) * s,
    ball[2 * i + 1] + (ball[2 * i + 3] - ball[2 * i + 1]) * s,
  ];
}

/** Shots as the screen shows them at 60 fps playing at 1x, with the ball at each. */
function filmed(ball: Float32Array) {
  const path = broadcastPath(ball, DT);
  const frames = ball.length / 2;
  const out: { f: number; shot: Shot; ball: [number, number] }[] = [];
  for (let k = 0; (k * (1 / FPS)) / DT <= frames - 1; k++) {
    const f = (k * (1 / FPS)) / DT;
    out.push({ f, shot: shotAt(path, f), ball: ballAt(ball, f) });
  }
  return out;
}

/** Largest pan acceleration (m/s^2 of the aim point) seen at 60 fps. */
function maxAccel(shots: Shot[]): number {
  let worst = 0;
  for (let k = 2; k < shots.length; k++) {
    const ax = shots[k].x - 2 * shots[k - 1].x + shots[k - 2].x;
    const ay = shots[k].y - 2 * shots[k - 1].y + shots[k - 2].y;
    worst = Math.max(worst, Math.hypot(ax, ay) * FPS * FPS);
  }
  return worst;
}

/** How often the pan reverses along x (sign changes of the velocity above a dead band). */
function reversals(shots: Shot[]): number {
  let count = 0;
  let sign = 0;
  for (let k = 1; k < shots.length; k++) {
    const v = (shots[k].x - shots[k - 1].x) * FPS;
    if (Math.abs(v) < 0.05) continue;
    const s = Math.sign(v);
    if (sign && s !== sign) count++;
    sign = s;
  }
  return count;
}

describe("broadcast camera: easing", () => {
  // The ball rests at the centre spot for 1 s, then jumps 8 m along the touchline and rests.
  const ball = track(4, (t) => (t < 1 ? [0, 0] : [8, 0]));
  const shots = filmed(ball);
  const after = shots.filter((s) => s.f * DT >= 1);

  it("starts settled on the ball", () => {
    expect(shots[0].shot.x).toBeCloseTo(0, 6);
    expect(shots[0].shot.y).toBeCloseTo(0, 6);
    expect(shots[0].shot.width).toBeCloseTo(WIDTH.base, 6);
  });

  it("eases in: the pan starts slowly instead of jumping with the ball", () => {
    const first = after.find((s) => s.f * DT >= 1 + 1 / FPS)!;
    expect(first.shot.x).toBeLessThan(0.08 * 8);
  });

  it("never overshoots and settles within 1.5 s", () => {
    for (let k = 1; k < after.length; k++) {
      expect(after[k].shot.x).toBeGreaterThanOrEqual(after[k - 1].shot.x - 1e-6); // monotone
      expect(after[k].shot.x).toBeLessThanOrEqual(8 + 1e-6);
    }
    const settled = after.find((s) => s.f * DT >= 2.5)!;
    expect(settled.shot.x).toBeGreaterThan(8 * 0.98);
  });

  it("zooms out smoothly while the ball travels fast, and back in when it stops", () => {
    // A 20 m/s pass along the touchline from 1 s to 3 s, then the ball rests.
    const pass = track(6, (t) => [-20 + 20 * Math.min(2, Math.max(0, t - 1)), 0]);
    const zoom = filmed(pass).map((s) => s.shot.width);
    const peak = Math.max(...zoom);
    expect(peak).toBeGreaterThan(WIDTH.base + 10);
    expect(peak).toBeLessThanOrEqual(WIDTH.max + 1e-6);
    let steps = 0;
    for (let k = 1; k < zoom.length; k++) steps = Math.max(steps, Math.abs(zoom[k] - zoom[k - 1]));
    // m/s of frame width: no snap zoom; base to widest (36 -> 68 m) takes 2 s or more.
    expect(steps * FPS).toBeLessThan(16);
    expect(zoom[zoom.length - 1]).toBeLessThan(WIDTH.base + 2);
  });
});

describe("broadcast camera: fast passes", () => {
  // Held 1 s deep on the left, then a 28 m/s diagonal pass of about 75 m, then held.
  const from: [number, number] = [-35, -22];
  const to: [number, number] = [35, 5];
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const flight = len / 28;
  const ball = track(1 + flight + 3, (t) => {
    const s = Math.min(1, Math.max(0, (t - 1) / flight));
    return [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s];
  });
  const shots = filmed(ball);

  it("keeps the ball inside the safe frame on every screen frame", () => {
    for (const { shot, ball: b } of shots) {
      const [u, v] = project(shot, b);
      expect(Math.abs(u)).toBeLessThanOrEqual(SAFE_FRAME.x + 1e-3);
      expect(Math.abs(v)).toBeLessThanOrEqual(SAFE_FRAME.y + 1e-3);
    }
  });

  it("pans without jitter: bounded acceleration and no back-and-forth", () => {
    // A camera locked to the ball would take the kick as a 0 -> 28 m/s step in one 25 Hz frame
    // (700 m/s^2); the broadcast camera takes it as a smooth pan.
    expect(maxAccel(shots.map((s) => s.shot))).toBeLessThan(60);
    expect(reversals(shots.map((s) => s.shot))).toBe(0);
  });
});

describe("broadcast camera: reading a pass", () => {
  // Held 1 s, then a 25 m/s pass of 45 m along the touchline side, then held 2 s.
  const from: [number, number] = [-10, -10];
  const to: [number, number] = [35, -12];
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const flight = len / 25;
  const ball = track(1 + flight + 2, (t) => {
    const s = Math.min(1, Math.max(0, (t - 1) / flight));
    return [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s];
  });
  const pass = { start: Math.round(1 / DT), end: Math.round((1 + flight) / DT) };
  const reading = broadcastPath(ball, DT, [pass]);
  const blind = broadcastPath(ball, DT);
  const mid = (pass.start + pass.end) / 2;

  it("frames where the pass is going while the ball is in flight", () => {
    const [u, v] = project(shotAt(reading, mid), to);
    expect(Math.abs(u)).toBeLessThanOrEqual(0.9); // on screen, clear of the edge
    expect(Math.abs(v)).toBeLessThanOrEqual(0.9);
    // Following the ball alone, the receiver is still off screen then.
    expect(Math.abs(project(shotAt(blind, mid), to)[0])).toBeGreaterThan(1);
  });

  it("arrives with the ball: no swing past the receiver, no jolt, ball always in frame", () => {
    const shots: Shot[] = [];
    for (let f = 0; f <= ball.length / 2 - 1; f += 1 / FPS / DT) {
      const shot = shotAt(reading, f);
      const [u, v] = project(shot, ballAt(ball, f));
      expect(Math.abs(u)).toBeLessThanOrEqual(SAFE_FRAME.x + 1e-3);
      expect(Math.abs(v)).toBeLessThanOrEqual(SAFE_FRAME.y + 1e-3);
      shots.push(shot);
    }
    expect(reversals(shots)).toBe(0);
    expect(maxAccel(shots)).toBeLessThan(60);
    // Past the receiver by less than a pixel (about 7 cm at this zoom).
    expect(Math.max(...shots.map((s) => s.x))).toBeLessThanOrEqual(to[0] + 0.01);
  });

  it("reads the passes of the export, so the hero's pass frames H9 before he receives", () => {
    const hero = parseHero(raw);
    const run = hero.runs.factual;
    const kick = run.action!;
    const receiver = hero.ids.indexOf(kick.to);
    const at = Math.round((kick.frame + kick.end!) / 2);
    const [u] = project(shotAt(pathFor(run, hero.dt), at), [
      run.pos[(at * hero.n + receiver) * 2],
      run.pos[(at * hero.n + receiver) * 2 + 1],
    ]);
    expect(Math.abs(u)).toBeLessThanOrEqual(1); // on screen
  });
});

describe("broadcast camera: bounds", () => {
  it("keeps the aim on the pitch and the zoom in range when the ball goes out", () => {
    // Over the near touchline, then out past the corner flag and beyond.
    const ball = track(5, (t) => [Math.min(80, 20 * t), -20 - 8 * t]);
    for (const { shot } of filmed(ball)) {
      expect(Math.abs(shot.x)).toBeLessThanOrEqual(AIM_BOUNDS.x + 1e-6);
      expect(Math.abs(shot.y)).toBeLessThanOrEqual(AIM_BOUNDS.y + 1e-6);
      expect(shot.width).toBeGreaterThanOrEqual(WIDTH.min - 1e-6);
      expect(shot.width).toBeLessThanOrEqual(WIDTH.max + 1e-6);
    }
  });

  it("films from a fixed position high on the near side, looking across the pitch", () => {
    expect(BROADCAST_CAMERA.height).toBeGreaterThanOrEqual(18);
    expect(BROADCAST_CAMERA.height).toBeLessThanOrEqual(25);
    expect(BROADCAST_CAMERA.y).toBeLessThan(-34); // behind the near touchline
    const near = cameraPose({ x: -30, y: -25, width: 40 }, REF_ASPECT);
    const far = cameraPose({ x: 30, y: 25, width: 40 }, REF_ASPECT);
    expect(near.position).toEqual(far.position);
    // three.js axes: pitch (x, y) -> (x, height, -y); the target is the aim point on the grass.
    expect(far.target).toEqual([30, 0, -25]);
    // The same 40 m of frame width needs a narrower lens far away: the camera zooms, not dollies.
    expect(far.fov).toBeLessThan(near.fov);
  });

  it("keeps the 16:9 safe frame visible at any canvas shape", () => {
    const shot = { x: 10, y: 5, width: 40 };
    const ref = cameraPose(shot, REF_ASPECT);
    for (const aspect of [1.2, 1.6, REF_ASPECT, 2.2]) {
      const pose = cameraPose(shot, aspect);
      // tan of the half angles: at least the reference frame's, both ways.
      const tanV = Math.tan(((pose.fov / 2) * Math.PI) / 180);
      const refTanV = Math.tan(((ref.fov / 2) * Math.PI) / 180);
      expect(tanV).toBeGreaterThanOrEqual(refTanV - 1e-9);
      expect(tanV * aspect).toBeGreaterThanOrEqual(refTanV * REF_ASPECT - 1e-9);
    }
  });
});

describe("broadcast camera: seeks", () => {
  const hero = parseHero(raw);

  it("cuts on a seek with no lag: the shot depends on the frame alone", () => {
    const run = hero.runs.factual;
    const path = pathFor(run, hero.dt);
    // Played from the start up to frame 120 at 60 fps...
    for (let f = 0; f < 120; f += 1 / FPS / hero.dt) shotAt(path, f);
    const played = shotAt(path, 120);
    // ...and seeked straight to 120 from frame 10: the same shot on the first screen frame.
    shotAt(path, 10);
    const seeked = shotAt(path, 120);
    expect(seeked).toEqual(played);
    // Seeking back cuts back: no blend from where the camera was, the same shot as a camera that
    // never showed anything else.
    const fresh = broadcastPath(run.ball.subarray(0, 2 * run.frames), hero.dt, flightsOf(run));
    expect(shotAt(path, 20)).toEqual(shotAt(fresh, 20));
    // Between frames the shot is in between, never a jump: cuts happen only on seeks.
    const mid = shotAt(path, 120.5);
    expect(mid.x).toBeCloseTo((shotAt(path, 120).x + shotAt(path, 121).x) / 2, 1);
  });

  it("is computed once per run", () => {
    expect(pathFor(hero.runs.factual, hero.dt)).toBe(pathFor(hero.runs.factual, hero.dt));
    expect(pathFor(hero.runs.counterfactual, hero.dt)).not.toBe(
      pathFor(hero.runs.factual, hero.dt),
    );
  });
});

describe("broadcast camera: the hero moment (blind_side_run, seed 3)", () => {
  const hero = parseHero(raw);
  for (const name of ["factual", "counterfactual"] as const) {
    it(`keeps the ball in the safe frame, smoothly, in the ${name} run`, () => {
      const run: Run = hero.runs[name];
      const ball = run.ball.subarray(0, 2 * run.frames);
      const shots = filmed(ball);
      for (const { shot, ball: b } of shots) {
        const [u, v] = project(shot, b);
        expect(Math.abs(u)).toBeLessThanOrEqual(SAFE_FRAME.x + 1e-3);
        expect(Math.abs(v)).toBeLessThanOrEqual(SAFE_FRAME.y + 1e-3);
      }
      expect(maxAccel(shots.map((s) => s.shot))).toBeLessThan(60);
    });
  }
});

describe("broadcast live tags (sprint, scan, blind side)", () => {
  const hero = parseHero(raw);
  const run = hero.runs.factual;
  const h8 = hero.ids.indexOf("H8");
  const h9 = hero.ids.indexOf("H9");

  it("tags a sprinter with his speed above the live stream's threshold", () => {
    expect(SPRINT_MPS).toBe(7.0); // api/store.py
    const tags = liveTags(hero, run, 75, h8, true).filter((t) => t.kind === "sprint");
    expect(tags.map((t) => t.player)).toEqual([h9]);
    const kmh = Number(tags[0].text.match(/^H9 (\d+) km\/h$/)![1]);
    expect(kmh).toBe(Math.round(speedAt(hero, run, h9, 75) * 3.6));
    expect(kmh).toBeGreaterThan(SPRINT_MPS * 3.6);
    expect(liveTags(hero, run, 20, h8, true).filter((t) => t.kind === "sprint")).toEqual([]);
  });

  it("tags the POV player's scans, the key scan as such, as the first-person HUD does", () => {
    const key = hero.keyScan;
    const mid = (key.start + key.end) / 2;
    expect(liveTags(hero, run, mid, h8, true)).toContainEqual({
      player: h8,
      kind: "scan",
      label: "KEY SCAN",
      text: "H8",
    });
    expect(liveTags(hero, run, key.end + 1, h8, true).some((t) => t.kind === "scan")).toBe(false);
    // Without the look there is no key scan to tag.
    const cf = liveTags(hero, hero.runs.counterfactual, mid, h8, true);
    expect(cf.some((t) => t.label === "KEY SCAN")).toBe(false);
  });

  it("tags the POV player's blind-side alerts only, and only when the layer is on", () => {
    const frame = 48; // H8 has lost sight of H9 (alert from frame 42 until the key scan)
    expect(liveTags(hero, run, frame, h8, true)).toContainEqual({
      player: h9,
      kind: "blind",
      label: "BLIND SIDE",
      text: `H9 ${unseenLabel(alertsAt(hero, run, frame).find((a) => a.observer === h8)!.unseen)}`,
    });
    expect(liveTags(hero, run, frame, h8, false).some((t) => t.kind === "blind")).toBe(false);
    const h4 = hero.ids.indexOf("H4");
    expect(liveTags(hero, run, frame, h4, true).some((t) => t.kind === "blind")).toBe(false);
  });
});
