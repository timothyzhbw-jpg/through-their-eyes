// Rigged-player trial (SPEC 7): the gait blend keeps the feet from sliding at every sim speed,
// with the engine's clips alone or with the extra walk, the kick lands its ball contact on the
// pass event after turning to it and never stretches its wind-up, and the head of a rigged player points along head_yaw (within 1e-3 rad) with
// the neck taking head_yaw − body_yaw.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, wrapAngle } from "../data/hero";
import { worldYaw } from "../views/tokens";
import {
  GAIT_FADE,
  RUN_UP,
  type GaitBlend,
  type GaitClips,
  footSpeed,
  gaitBlend,
  gaitPhase,
  gaitRun,
  BALL_LEAVE,
  HOLD_MIN,
  HOP,
  type Kick,
  LOCK_RELEASE,
  PASS_FADE,
  type PassClip,
  TURN_MAX,
  TURN_MIN,
  WINDUP,
  STEP_HOP,
  kickBallWeight,
  kickHop,
  kickFacing,
  kickPose,
  passEvents,
  smoothedSpeeds,
  strollTime,
  turnAngle,
  turnSide,
  turnTime,
} from "./gait";
import { NECK_MAX, TRUNK_MAX, aimLook, splitLook } from "./look";
import { lookFromSearch, riggedFromSearch } from "./trial";

const CLIPS: GaitClips = { walkSpeed: 5.25, sprintSpeed: 7.0, cycle: 0.48 };
const DEG = Math.PI / 180;

describe("animated players switch", () => {
  it("is on by default; only ?rigged=0 starts with the tokens", () => {
    expect(riggedFromSearch("")).toBe(true);
    expect(riggedFromSearch("?rigged=1")).toBe(true);
    expect(riggedFromSearch("?seed=3")).toBe(true);
    expect(riggedFromSearch("?rigged=0")).toBe(false);
    expect(riggedFromSearch("?seed=3&rigged=0")).toBe(false);
  });

  it("wears the upgraded look by default; only ?look=v1 brings back the plain kits", () => {
    expect(lookFromSearch("")).toBe("v2");
    expect(lookFromSearch("?look=v2")).toBe("v2");
    expect(lookFromSearch("?look=other&seed=3")).toBe("v2");
    expect(lookFromSearch("?look=v1")).toBe("v1");
    expect(lookFromSearch("?rigged=1&look=v1")).toBe("v1");
  });
});

describe("gait blend", () => {
  it("weights are a partition of one, idle at rest, walk and sprint at their stride speeds", () => {
    for (let v = 0; v <= 10; v += 0.05) {
      const b = gaitBlend(v, CLIPS);
      expect(b.idle + b.walk + b.sprint).toBeCloseTo(1, 12);
      for (const w of [b.idle, b.walk, b.sprint]) expect(w).toBeGreaterThanOrEqual(0);
    }
    expect(gaitBlend(0, CLIPS)).toMatchObject({ idle: 1, walk: 0, sprint: 0 });
    expect(gaitBlend(5.25, CLIPS)).toMatchObject({ idle: 0, walk: 1, sprint: 0, rate: 1 });
    expect(gaitBlend(7.0, CLIPS)).toMatchObject({ idle: 0, walk: 0, sprint: 1, rate: 1 });
  });

  it("matches the feet to the ground speed at every speed (no sliding)", () => {
    for (let v = 0.05; v <= 10; v += 0.05) {
      expect(footSpeed(gaitBlend(v, CLIPS), CLIPS)).toBeCloseTo(v, 9);
    }
  });

  it("slow speeds shorten the stride instead of playing the jog in slow motion", () => {
    // 1.5 m/s: about 2.2 steps a second with 0.67 m steps, a walk (the engine's slowest
    // locomotion clip is a 5.25 m/s jog, 4.2 steps a second).
    const b = gaitBlend(1.5, CLIPS);
    const stepsPerSecond = (2 * b.rate) / CLIPS.cycle;
    expect(stepsPerSecond).toBeGreaterThan(1.8);
    expect(stepsPerSecond).toBeLessThan(2.6);
    expect(b.walk).toBeLessThan(1);
  });

  it("is continuous in speed", () => {
    let prev = gaitBlend(0, CLIPS);
    for (let v = 0.001; v <= 9; v += 0.001) {
      const b = gaitBlend(v, CLIPS);
      expect(Math.abs(b.walk - prev.walk)).toBeLessThan(0.04);
      expect(Math.abs(b.sprint - prev.sprint)).toBeLessThan(0.01);
      expect(Math.abs(b.rate - prev.rate)).toBeLessThan(0.04);
      prev = b;
    }
  });

  it("gait phase integrates the playback rate along the run, so scrubbing is deterministic", () => {
    const dt = 0.04;
    const speeds = Float32Array.from([0, 1, 2, 5.25, 5.25, 7, 8]);
    const phase = gaitPhase(speeds, dt, CLIPS);
    expect(phase[0]).toBe(0);
    for (let f = 1; f < speeds.length; f++) {
      const step = (gaitBlend(speeds[f - 1], CLIPS).rate * dt) / CLIPS.cycle;
      expect(phase[f] - phase[f - 1]).toBeCloseTo(step, 12);
    }
  });

  it("without the extra walk (?anims=base) the blend is the engine clips' alone, as before", () => {
    for (let v = 0; v <= 10; v += 0.01) {
      const b = gaitBlend(v, CLIPS);
      const m = Math.sqrt(v / 5.25);
      const s = Math.min(1, (v - 5.25) / 1.75);
      const before =
        v >= 5.25
          ? { idle: 0, walk: 1 - s, sprint: s, rate: v / (5.25 + s * 1.75) }
          : { idle: 1 - m, walk: m, sprint: 0, rate: m };
      expect(b).toEqual({ ...before, stroll: 0 });
    }
  });

  it("smoothed speeds follow the sim positions", () => {
    const hero = parseHero(raw);
    const run = hero.runs.factual;
    const h9 = hero.ids.indexOf("H9");
    const speeds = smoothedSpeeds(run.pos, hero.n, h9, run.frames, hero.dt);
    expect(speeds.length).toBe(run.frames);
    // H9's blind-side run: about 7 m/s at the key scan.
    expect(speeds[57]).toBeGreaterThan(6.5);
    expect(speeds[57]).toBeLessThan(7.5);
  });
});

describe("gait blend with the extra walk: a walking gait and the engine's, cross-faded", () => {
  // As anims_extra.glb's walk: 1.01 m/s, a 1.33 s cycle, its left-foot strike shifted onto the jog's.
  const WALK: GaitClips = {
    ...CLIPS,
    stroll: { speed: 1.0126, cycle: 4 / 3, offset: 0.808 },
  };
  const st = WALK.stroll!;
  /** Cycles a second the gait phase advances. */
  const cadence = (b: GaitBlend) => b.rate / WALK.cycle;
  const RUNS = [0, 0.1, 0.5, 0.9, 1];

  it("weights are a partition of one, idle at rest, the walk alone in the walking gait", () => {
    for (const run of RUNS) {
      for (let v = 0; v <= 10; v += 0.01) {
        const b = gaitBlend(v, WALK, run);
        expect(b.idle + b.stroll + b.walk + b.sprint).toBeCloseTo(1, 12);
        for (const w of [b.idle, b.stroll, b.walk, b.sprint]) {
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
        if (run === 0) expect(b.walk + b.sprint).toBe(0);
        if (run === 1) expect(b.stroll).toBe(0);
      }
      expect(gaitBlend(0, WALK, run)).toMatchObject({ idle: 1, stroll: 0, walk: 0, sprint: 0 });
    }
    const atWalk = gaitBlend(st.speed, WALK, 0);
    expect(atWalk).toMatchObject({ idle: 0, stroll: 1, walk: 0, sprint: 0 });
    expect(cadence(atWalk) * st.cycle).toBeCloseTo(1, 12); // the walk at rate 1
  });

  it("the engine's gait is exactly the engine clips' blend (as ?anims=base)", () => {
    for (let v = 0; v <= 10; v += 0.01) expect(gaitBlend(v, WALK, 1)).toEqual(gaitBlend(v, CLIPS));
    expect(gaitBlend(2, WALK)).toEqual(gaitBlend(2, CLIPS)); // the default is the engine's gait
  });

  it("matches the feet to the ground speed at every speed, in either gait and between (no sliding)", () => {
    for (const run of RUNS) {
      for (let v = 0.01; v <= 10; v += 0.01) {
        expect(footSpeed(gaitBlend(v, WALK, run), WALK)).toBeCloseTo(v, 9);
      }
    }
  });

  it("is continuous in speed and in the cross-fade", () => {
    for (const run of RUNS) {
      let prev = gaitBlend(0, WALK, run);
      for (let v = 0.001; v <= 9; v += 0.001) {
        const b = gaitBlend(v, WALK, run);
        for (const k of ["idle", "stroll", "walk", "sprint", "rate"] as const) {
          expect(Math.abs(b[k] - prev[k]), `${k} at ${v} m/s`).toBeLessThan(0.04);
        }
        prev = b;
      }
    }
    for (const v of [0.5, 1.3, 1.5, 1.7, 2.2]) {
      let prev = gaitBlend(v, WALK, 0);
      for (let run = 0.001; run <= 1; run += 0.001) {
        const b = gaitBlend(v, WALK, run);
        for (const k of ["idle", "stroll", "walk", "sprint", "rate"] as const) {
          expect(Math.abs(b[k] - prev[k]), `${k} at ${v} m/s, run ${run}`).toBeLessThan(0.01);
        }
        prev = b;
      }
    }
  });

  it("walks with the walk's own steps, faster as the speed rises, up to the change of gait", () => {
    const steps = (v: number) => 2 * cadence(gaitBlend(v, WALK, 0));
    expect(steps(st.speed)).toBeCloseTo(1.5, 6); // the clip's own cadence at its speed
    expect(steps(1.4)).toBeGreaterThan(1.9); // about 2.1 steps a second at 1.4 m/s, 0.67 m each
    expect(steps(1.4)).toBeLessThan(2.3);
    expect(steps(RUN_UP)).toBeLessThan(2.6); // not a frantic shuffle before the jog takes over
    let prev = 0;
    for (let v = 0.05; v <= RUN_UP; v += 0.05) {
      expect(steps(v)).toBeGreaterThan(prev);
      prev = steps(v);
    }
  });

  it("changes gait with hysteresis, easing over GAIT_FADE", () => {
    const dt = 0.04;
    // Walk, speed up through RUN_UP, hover between the thresholds, slow below RUN_DOWN.
    const plan = [
      ...Array(20).fill(1.0),
      ...Array(20).fill(1.6), // below RUN_UP: still walking
      ...Array(20).fill(2.5), // running
      ...Array(20).fill(1.5), // between the thresholds: still running
      ...Array(40).fill(1.0), // walking again
    ];
    const run = gaitRun(Float32Array.from(plan), dt);
    const fade = Math.ceil(GAIT_FADE / dt);
    expect(Array.from(run.slice(0, 40)).every((w) => w === 0)).toBe(true);
    expect(run[40]).toBeGreaterThan(0);
    expect(run[40 + fade - 2]).toBeLessThan(1);
    expect(Array.from(run.slice(40 + fade, 80)).every((w) => w === 1)).toBe(true);
    expect(run[80]).toBeLessThan(1);
    expect(Array.from(run.slice(80 + fade, 120)).every((w) => w === 0)).toBe(true);
    for (let f = 1; f < run.length; f++) {
      expect(Math.abs(run[f] - run[f - 1])).toBeLessThanOrEqual((1.5 * dt) / GAIT_FADE + 1e-6);
    }
    expect(gaitRun(Float32Array.from([3, 3, 3]), dt)[0]).toBe(1); // starts running if fast
  });

  it("plays the walk on the gait phase, its strike moved onto the jog's", () => {
    expect(strollTime(0, st)).toBeCloseTo(0.808 * st.cycle, 12);
    expect(strollTime(3.25, st)).toBeCloseTo(((3.25 + 0.808) % 1) * st.cycle, 12);
    for (let p = 0; p < 4; p += 0.01) {
      const t = strollTime(p, st);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(st.cycle);
    }
  });

  it("gait phase integrates the playback rate of the gait in use", () => {
    const dt = 0.04;
    const speeds = Float32Array.from([0, 0.5, 1, 1.0126, 1.5, 2.2, 5.25, 7]);
    const run = Float32Array.from([0, 0, 0, 0, 0.3, 1, 1, 1]);
    const phase = gaitPhase(speeds, dt, WALK, run);
    for (let f = 1; f < speeds.length; f++) {
      const step = (gaitBlend(speeds[f - 1], WALK, run[f - 1]).rate * dt) / WALK.cycle;
      expect(phase[f] - phase[f - 1]).toBeCloseTo(step, 12);
    }
    // Without run weights it is the engine's gait.
    const engine = gaitPhase(speeds, dt, WALK);
    const before = gaitPhase(speeds, dt, CLIPS);
    for (let f = 0; f < speeds.length; f++) expect(engine[f]).toBe(before[f]);
  });
});

describe("kick timing", () => {
  const clip: PassClip = {
    duration: 0.94,
    touch: 0.4,
    kickYaw: -1.67 * DEG,
    plant: { time: 0.27, at: [0.065, 0.203] },
    contact: [0.174, 0.624],
    land: 0.82,
  };
  const dt = 0.04;
  const kick: Kick = {
    frame: 75,
    facing: 0.5,
    side: 0,
    sweep: 0.5,
    turn: 0.3,
    hold: 0.42,
    release: 0.2,
    anchor: [0, 0],
    ball: [0.4, 0.1],
  };
  const at = (f: number) => kickPose(f, [kick], dt, clip);
  const windup = kick.frame - WINDUP / dt; // the frame the wind-up starts
  const down = kick.frame + (clip.land! - clip.touch) / dt; // the kicking foot is down

  it("puts the clip's ball contact on the pass event's frame, at full weight", () => {
    const p = at(75);
    expect(p.time).toBeCloseTo(clip.touch, 12);
    expect(p.weight).toBe(1);
    expect(p.facing).toBe(1);
    expect(p.lock).toBe(1);
    expect(p.kick).toBe(kick);
  });

  it("winds up for WINDUP, at the clip's own rate: never stretched", () => {
    expect(at(windup - 0.01).weight).toBe(0);
    expect(at(windup + 0.5).weight).toBeGreaterThan(0);
    expect(at(windup + PASS_FADE / dt).weight).toBeCloseTo(1, 12);
    for (let f = windup; f < down; f += 0.25) {
      expect(at(f + 0.25).time - at(f).time).toBeCloseTo(0.25 * dt, 9);
    }
    expect(at(down).weight).toBeCloseTo(1, 12);
    expect(at(down + PASS_FADE / dt / 2).weight).toBeCloseTo(0.5, 9);
    expect(at(down + PASS_FADE / dt).weight).toBe(0);
  });

  it("turns the body to the kick before the wind-up, and back once the foot is down", () => {
    expect(at(windup).facing).toBe(1);
    expect(at(windup - kick.turn / dt).facing).toBe(0);
    expect(at(windup - kick.turn / dt - 0.25).kick).toBeNull();
    expect(at(windup - kick.turn / dt / 2).facing).toBeCloseTo(0.5, 9);
    expect(at(down).facing).toBe(1);
    expect(at(down + kick.release / dt).facing).toBe(0);
    let prev = 0;
    const step = (1.5 * 0.25 * dt) / Math.min(kick.turn, kick.release) + 1e-9; // smoothstep's slope
    for (let f = windup - kick.turn / dt - 2; f <= down + 20; f += 0.25) {
      const now = at(f).facing;
      expect(Math.abs(now - prev)).toBeLessThanOrEqual(step);
      prev = now;
    }
  });

  it("anchors the body from the wind-up until the kicking foot is down, then lets go", () => {
    expect(at(windup - 0.25).lock).toBe(0);
    expect(at(windup + PASS_FADE / dt / 2).lock).toBeCloseTo(0.5, 9);
    expect(at(windup + PASS_FADE / dt).lock).toBe(1);
    const plant = kick.frame + (clip.plant!.time - clip.touch) / dt;
    expect(at(plant).lock).toBe(1);
    expect(at(down).lock).toBe(1);
    expect(at(down + LOCK_RELEASE / dt / 2).lock).toBeCloseTo(0.5, 9);
    expect(at(down + LOCK_RELEASE / dt).lock).toBe(0);
    // The engine's standing pass has no plant: nothing holds.
    const engine: PassClip = { duration: 0.72, touch: 0.35, kickYaw: 22.46 * DEG };
    expect(kickPose(75, [kick], dt, engine).lock).toBe(0);
    expect(kickPose(75, [kick], dt, engine).weight).toBe(1);
  });

  it("turns at TURN_RATE, never quicker than TURN_MIN nor slower than TURN_MAX", () => {
    expect(turnTime(0)).toBe(TURN_MIN);
    expect(turnTime(72 * DEG)).toBeCloseTo(0.2, 12);
    expect(turnTime(-90 * DEG)).toBeCloseTo(0.25, 12);
    expect(turnTime(Math.PI)).toBe(TURN_MAX);
  });

  it("lifts the feet off the grass: hops through the turn, a lift over each cross-fade", () => {
    const start = windup - kick.turn / dt;
    expect(kickHop(start - 1, kick, dt)).toBe(0);
    expect(kickHop(windup, kick, dt)).toBe(0);
    const mid = kickHop(start + kick.turn / dt / 2, kick, dt);
    expect(mid).toBeCloseTo(HOP * Math.min(1, 0.5 / (Math.PI / 3)), 9); // 29°: a low hop
    const half = { ...kick, sweep: Math.PI, turn: 0.5 };
    const s = windup - half.turn / dt;
    expect(kickHop(s + (0.25 * half.turn) / dt, half, dt)).toBeCloseTo(HOP, 9); // two hops
    expect(kickHop(s + (0.5 * half.turn) / dt, half, dt)).toBeCloseTo(0, 9);
    expect(kickHop(s + (0.75 * half.turn) / dt, half, dt)).toBeCloseTo(HOP, 9);
    expect(kickHop(windup + PASS_FADE / dt / 2, kick, dt)).toBeCloseTo(STEP_HOP, 9);
    expect(kickHop(75, kick, dt)).toBe(0);
    expect(kickHop(down + PASS_FADE / dt / 2, kick, dt)).toBeCloseTo(STEP_HOP, 9);
    expect(kickHop(down + PASS_FADE / dt, kick, dt)).toBeCloseTo(0, 9);
  });

  it("ends the follow-through early when the passer runs on", () => {
    const short = { ...kick, hold: HOLD_MIN };
    const end = kick.frame + HOLD_MIN / dt;
    expect(kickPose(end, [short], dt, clip).weight).toBeCloseTo(1, 12);
    expect(kickPose(end + PASS_FADE / dt, [short], dt, clip).weight).toBeCloseTo(0, 12);
    expect(kickPose(end + LOCK_RELEASE / dt, [short], dt, clip).lock).toBe(0);
  });

  it("moves the ball onto the kicking foot with the turn, and back on its path after", () => {
    expect(kickBallWeight(windup - kick.turn / dt, kick, dt)).toBe(0);
    expect(kickBallWeight(windup, kick, dt)).toBe(1);
    expect(kickBallWeight(75, kick, dt)).toBe(1);
    expect(kickBallWeight(75 + BALL_LEAVE / dt / 2, kick, dt)).toBeCloseTo(0.5, 9);
    expect(kickBallWeight(75 + BALL_LEAVE / dt, kick, dt)).toBe(0);
    expect(kickBallWeight(10, kick, dt)).toBe(0);
    expect(kickBallWeight(140, kick, dt)).toBe(0);
  });

  it("turns half round through the side he looks to; less, the shorter way", () => {
    expect(turnSide(150 * DEG, -60 * DEG)).toBe(-1);
    expect(turnSide(150 * DEG, 60 * DEG)).toBe(1);
    expect(turnSide(150 * DEG, 10 * DEG)).toBe(0); // looking ahead: no side
    expect(turnSide(90 * DEG, -60 * DEG)).toBe(0); // a small turn: the shorter way
    expect(turnAngle(0, 150 * DEG, -1) / DEG).toBeCloseTo(-210, 9);
    expect(turnAngle(0, 150 * DEG, 1) / DEG).toBeCloseTo(150, 9);
    expect(turnAngle(0, 150 * DEG, 0) / DEG).toBeCloseTo(150, 9);
    const round = { ...kick, facing: 150 * DEG, side: -1 as const };
    const half = kickFacing(0, { ...at(75), facing: 0.5, kick: round });
    expect(half / DEG).toBeCloseTo(-105, 9);
  });

  it("finds each player's passes and shots in the run, with their direction", () => {
    const hero = parseHero(raw);
    const passes = passEvents(hero.runs.factual.events, hero.ids);
    const h8 = passes[hero.ids.indexOf("H8")];
    expect(h8.map((p) => p.frame)).toEqual([75]);
    expect(h8[0].yaw / DEG).toBeCloseTo(-1.7, 0); // forward to H9
    expect(passes[hero.ids.indexOf("H4")].map((p) => p.frame)).toEqual([15]);
    const shot = passEvents(
      [
        {
          id: "shot:H9:198",
          type: "shot",
          frame: 198,
          player: "H9",
          attrs: { start: [40, 2], aim: [52.5, -1], speed: 24, outcome: "goal", end_at: 210 },
        },
      ],
      hero.ids,
    )[hero.ids.indexOf("H9")];
    expect(shot).toEqual([{ frame: 198, yaw: Math.atan2(-3, 12.5), start: [40, 2] }]);
  });

  it("turns the body to the kick's facing by the pose's weight, else body_yaw", () => {
    const body = Math.PI; // H8 faces his own goal at the pass
    const pose = (facing: number) => ({ ...at(75), facing });
    expect(kickFacing(body, { ...at(10) })).toBe(body);
    expect(Math.abs(wrapAngle(kickFacing(body, pose(1)) - kick.facing))).toBeLessThan(1e-12);
    const half = kickFacing(body, pose(0.5));
    expect(Math.abs(wrapAngle(half - body))).toBeCloseTo(
      Math.abs(wrapAngle(kick.facing - body)) / 2,
      12,
    );
  });
});

describe("neck angle mapping", () => {
  it("the neck takes head_yaw − body_yaw up to its limit, then the trunk, then the hips", () => {
    const small = splitLook(0.3, 0.3 + 40 * DEG);
    expect(small.neck).toBeCloseTo(40 * DEG, 12);
    expect([small.trunk, small.hips]).toEqual([0, 0]);
    const key = splitLook(0, -128 * DEG); // hero H8's key scan, seed 3
    expect(key.neck).toBeCloseTo(-NECK_MAX, 12);
    expect(key.trunk).toBeCloseTo(-128 * DEG + NECK_MAX, 12);
    expect(Math.abs(key.hips)).toBe(0);
    const back = splitLook(0, 179 * DEG);
    expect(back.neck).toBeCloseTo(NECK_MAX, 12);
    expect(back.trunk).toBeCloseTo(TRUNK_MAX, 12);
    expect(back.hips).toBeCloseTo(179 * DEG - NECK_MAX - TRUNK_MAX, 12);
  });

  it("always adds up to the wrapped head_yaw − body_yaw", () => {
    for (let b = -3.1; b < 3.2; b += 0.37) {
      for (let h = -3.1; h < 3.2; h += 0.29) {
        const s = splitLook(b, h);
        expect(s.hips + s.trunk + s.neck).toBeCloseTo(wrapAngle(h - b), 12);
        expect(Math.abs(s.neck)).toBeLessThanOrEqual(NECK_MAX + 1e-12);
        expect(Math.abs(s.trunk)).toBeLessThanOrEqual(TRUNK_MAX + 1e-12);
      }
    }
    // Across ±pi it takes the short way round.
    const s = splitLook(3.1, -3.1);
    expect(s.neck).toBeCloseTo(2 * Math.PI - 6.2, 12);
  });

  /** holder -> body -> middle -> neck, like the converted skeleton (model faces local +x). */
  function rig(twist = 0) {
    const holder = new THREE.Group();
    const body = new THREE.Bone();
    const middle = new THREE.Bone();
    const neck = new THREE.Bone();
    body.position.y = 0.96;
    middle.position.y = 0.15;
    neck.position.y = 0.5;
    // An animated pose: a little forward lean and some shoulder counter-rotation.
    body.quaternion.setFromEuler(new THREE.Euler(0, 0, -0.06));
    middle.quaternion.setFromEuler(new THREE.Euler(0.05, twist, -0.1));
    neck.quaternion.setFromEuler(new THREE.Euler(0, -0.5 * twist, 0.12));
    holder.add(body);
    body.add(middle);
    middle.add(neck);
    return { holder, middle, neck };
  }

  it("points every rigged player's head along head_yaw in the seed-3 export", () => {
    const hero = parseHero(raw);
    const run = hero.runs.factual;
    const key = hero.keyScan!; // the bundled scan hero has one
    for (const f of [0, key.start, Math.round((key.start + key.end) / 2), key.end, 100]) {
      for (let j = 0; j < hero.n; j++) {
        const bodyYaw = run.body[f * hero.n + j];
        const headYaw = run.head[f * hero.n + j];
        const { holder, middle, neck } = rig(0.2 * Math.sin(f + j));
        const split = aimLook(holder, middle, neck, bodyYaw, headYaw);
        expect(Math.abs(wrapAngle(worldYaw(neck) - headYaw))).toBeLessThan(1e-3);
        expect(Math.abs(wrapAngle(worldYaw(holder) - (bodyYaw + split.hips)))).toBeLessThan(1e-6);
      }
    }
  });

  it("never turns the neck past its limit, even when the clip twists the trunk a lot", () => {
    // The pass clip swings the shoulders round; the head must stay on head_yaw without an owl neck.
    for (const twist of [-2.2, -1.2, 0, 1.2, 2.2]) {
      for (const look of [-170, -128, -60, 0, 60, 128, 170]) {
        const { holder, middle, neck } = rig(twist);
        aimLook(holder, middle, neck, 0.3, 0.3 + look * DEG);
        expect(Math.abs(wrapAngle(worldYaw(neck) - (0.3 + look * DEG)))).toBeLessThan(1e-3);
        expect(Math.abs(wrapAngle(worldYaw(neck) - worldYaw(middle)))).toBeLessThan(
          NECK_MAX + 0.02,
        );
      }
    }
  });

  it("turns the neck by head_yaw − body_yaw relative to the trunk when there is no twist", () => {
    const { holder, middle, neck } = rig(0);
    aimLook(holder, middle, neck, 0.4, 0.4 - 60 * DEG);
    // Relative yaw of the head to the trunk, both measured in the world (the trunk's lean and
    // roll shift its projected yaw by a few tenths of a degree).
    expect(wrapAngle(worldYaw(neck) - worldYaw(middle))).toBeCloseTo(-60 * DEG, 1);
  });
});
