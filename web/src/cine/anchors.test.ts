// Anchor positions against a hand-built match (anchors.ts). The numbers are the pitch frame:
// yaw 0 is +x, a positive yaw turns toward +y, and a local offset is x forward, y left, h up.
// They are not produced by the function under test.

import { describe, expect, it } from "vitest";
import type { Hero, Run, Scan } from "../data/hero";
import type { ExportPlayer } from "../data/types";
import { anchorPoint, coneEnvelope, smoothedPose } from "./anchors";
import { Anchor as AnchorSchema, type AnchorInput } from "./shot";

const PLAYERS: ExportPlayer[] = [
  { id: "H1", team: 0, role: "cm", number: 1 },
  { id: "A2", team: 1, role: "st", number: 2 },
];

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

function runOf(frames: number, pos: number[], head: number[], body: number[], ball: number[]): Run {
  const n = PLAYERS.length;
  return {
    name: "factual",
    frames,
    pos: Float32Array.from(pos),
    head: Float32Array.from(head),
    body: Float32Array.from(body),
    ball: Float32Array.from(ball),
    ghost: new Float32Array(frames * 2 * n),
    seenBy: new Uint32Array(frames * n),
    sight: false,
    owner: new Int16Array(frames),
    events: [],
    scans: [],
    decision: null,
    action: null,
    possessionValue: 0,
    firstPass: null,
    blindSide: { intervals: [], frames: [] },
    detector: null,
  };
}

function heroOf(run: Run, dt = 1): Hero {
  const cf: Run = { ...run, name: "counterfactual" };
  return {
    kind: "hero",
    scenario: "test",
    seed: 1,
    dt,
    players: PLAYERS,
    ids: PLAYERS.map((p) => p.id),
    n: PLAYERS.length,
    hero: 0,
    heroId: "H1",
    runner: 1,
    runnerId: "A2",
    keyScan: null,
    counterfactual: null,
    vision: null,
    detector: null,
    deltaXt: 0,
    runs: { factual: run, counterfactual: cf },
    reception: 0,
    match: null,
  };
}

/** (frame * n + player) * 2 + xy, the layout sampleInto reads. */
function place(frames: number, at: (frame: number, player: number) => [number, number]): number[] {
  const n = PLAYERS.length;
  const pos = zeros(frames * n * 2);
  for (let f = 0; f < frames; f++) {
    for (let j = 0; j < n; j++) {
      const [x, y] = at(f, j);
      pos[(f * n + j) * 2] = x;
      pos[(f * n + j) * 2 + 1] = y;
    }
  }
  return pos;
}

function yawTrack(frames: number, at: (frame: number, player: number) => number): number[] {
  const n = PLAYERS.length;
  const out = zeros(frames * n);
  for (let f = 0; f < frames; f++) {
    for (let j = 0; j < n; j++) out[f * n + j] = at(f, j);
  }
  return out;
}

// Two frames. H1 stands at (5, 5) with body yaw π/2 and head yaw π. A2 stands at (10, 20)
// facing +y with his head along +x. The ball goes from (1, 2) to (3, 4).
const fixed = heroOf(
  runOf(
    2,
    place(2, (_f, j) => (j === 0 ? [5, 5] : [10, 20])),
    yawTrack(2, (_f, j) => (j === 0 ? Math.PI : 0)),
    yawTrack(2, () => Math.PI / 2),
    [1, 2, 3, 4],
  ),
);
const factual = fixed.runs.factual;

function at(anchor: AnchorInput, frame = 0, role: "eye" | "look" = "eye", smooth = 0): Vec3Like {
  // Yaws are stored as float32: round away the last bits so exact positions compare equal.
  const p = anchorPoint(fixed, factual, frame, smooth, AnchorSchema.parse(anchor), role);
  return p.map((v) => Math.round(v * 1e6) / 1e6 + 0) as Vec3Like;
}
type Vec3Like = [number, number, number];

describe("player anchors", () => {
  it("adds a world offset in pitch axes", () => {
    expect(at({ at: "player", id: "H1", offset: [1, -2, 3], axes: "world" })).toEqual([6, 3, 3]);
  });

  it("points a body offset along the body yaw", () => {
    // Body yaw π/2 turns forward (1, 0) onto +y.
    expect(at({ at: "player", id: "H1", offset: [1, 0, 0], axes: "body" })).toEqual([5, 6, 0]);
  });

  it("points a head offset along the head yaw", () => {
    // Head yaw π turns (2, 0) onto -x, and keeps the height.
    expect(at({ at: "player", id: "H1", offset: [2, 0, 0.5], axes: "head" })).toEqual([3, 5, 0.5]);
  });

  it("places an orbit from the axes' +x, counter-clockwise from above", () => {
    expect(at({ at: "player", id: "H1", orbit: { r: 10, az: 0, h: 2 } })).toEqual([15, 5, 2]);
    expect(at({ at: "player", id: "H1", orbit: { r: 10, az: 90, h: 2 } })).toEqual([5, 15, 2]);
    // Body yaw π/2: az 0 is in front (+y), az 90 is to his left (-x).
    expect(at({ at: "player", id: "A2", orbit: { r: 4, az: 0, h: 3 }, axes: "body" })).toEqual([
      10, 24, 3,
    ]);
    expect(at({ at: "player", id: "A2", orbit: { r: 4, az: 90, h: 3 }, axes: "body" })).toEqual([
      6, 20, 3,
    ]);
  });

  it("adds a local offset on top of the orbit", () => {
    expect(
      at({
        at: "player",
        id: "H1",
        orbit: { r: 10, az: 0, h: 2 },
        offset: [1, 0, 1],
        axes: "world",
      }),
    ).toEqual([16, 5, 3]);
  });
});

describe("eyes and the ball", () => {
  it("sits the eye at 1.72 m and looks 10 m along the head yaw at 1.3 m", () => {
    const eye = at({ at: "eyes", id: "A2" }, 0, "eye");
    const look = at({ at: "eyes", id: "A2" }, 0, "look");
    expect(eye).toEqual([10, 20, 1.72]);
    expect(look).toEqual([20, 20, 1.3]);
  });

  it("puts the ball centre at 0.11 m and adds the offset", () => {
    expect(at({ at: "ball" }, 0)).toEqual([1, 2, 0.11]);
    expect(at({ at: "ball" }, 0.5)).toEqual([2, 3, 0.11]);
    expect(at({ at: "ball", offset: [0, 1, 0.5] }, 0.5)).toEqual([2, 4, 0.61]);
  });
});

describe("smoothing", () => {
  // Five frames, dt = 1. Player H1's x is 0, 0, 9, 0, 0 and his head yaw is 3, 3, 3, -3, -3.
  const xs = [0, 0, 9, 0, 0];
  const heads = [3, 3, 3, -3, -3];
  const jitter = heroOf(
    runOf(
      5,
      place(5, (f, j) => (j === 0 ? [xs[f], 0] : [0, 0])),
      yawTrack(5, (f, j) => (j === 0 ? heads[f] : 0)),
      yawTrack(5, () => 0),
      zeros(10),
    ),
  );
  const run = jitter.runs.factual;

  it("averages a spike to 4 and leaves the raw frame at 9 when smooth is 0", () => {
    const smooth = smoothedPose(jitter, run, 0, 2, 1);
    const raw = smoothedPose(jitter, run, 0, 2, 0);
    expect(smooth.x).toBeCloseTo(4);
    expect(raw.x).toBeCloseTo(9);
  });

  it("averages head yaw around the circle, not through zero", () => {
    // The window covers all five frames. A linear mean of 3 and -3 points forward;
    // the circular mean stays near ±π, so the look point is about 10 m behind him.
    const look = anchorPoint(jitter, run, 2, 2, { at: "eyes", id: "H1" }, "look");
    const pose = smoothedPose(jitter, run, 0, 2, 2);
    expect(look[0] - pose.x).toBeLessThan(-9); // ten metres behind where he (on average) stands
    expect(Math.abs(look[1])).toBeLessThan(1);
    expect(look[2]).toBeCloseTo(1.3);
  });
});

describe("coneEnvelope", () => {
  const scans: Scan[] = [{ id: "s", player: "H1", start: 10, end: 20, key: true }];

  it("rises over the first three frames, holds, and falls over eight", () => {
    expect(coneEnvelope(10, scans, "H1")).toBe(0);
    expect(coneEnvelope(13, scans, "H1")).toBeCloseTo(1);
    expect(coneEnvelope(20, scans, "H1")).toBeCloseTo(1);
    expect(coneEnvelope(24, scans, "H1")).toBeCloseTo(0.5);
    expect(coneEnvelope(28, scans, "H1")).toBe(0);
    expect(coneEnvelope(16, scans, "A2")).toBe(0);
  });
});
