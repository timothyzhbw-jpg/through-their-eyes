// Rigged-player trial (SPEC 7): the gait blend keeps the feet from sliding at every sim speed,
// the pass clip lands its ball contact on the pass event, and the head of a rigged player points
// along head_yaw (within 1e-3 rad) with the neck taking head_yaw − body_yaw.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, wrapAngle } from "../data/hero";
import { worldYaw } from "../views/tokens";
import {
  type GaitClips,
  footSpeed,
  gaitBlend,
  gaitPhase,
  passEvents,
  passFacing,
  passPose,
  smoothedSpeeds,
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

describe("pass clip", () => {
  const clip = { duration: 0.72, touch: 0.35, kickYaw: 22.46 * DEG };
  const pass = [{ frame: 75, yaw: -0.07 }];
  it("puts the ball contact on the pass event's frame", () => {
    const p = passPose(75, pass, 0.04, clip);
    expect(p.time).toBeCloseTo(0.35, 12);
    expect(p.weight).toBe(1);
    expect(p.yaw).toBe(-0.07);
  });
  it("fades in before the clip starts and out after it ends", () => {
    expect(passPose(60, pass, 0.04, clip).weight).toBe(0); // 0.6 s before contact
    expect(passPose(67, pass, 0.04, clip).weight).toBeGreaterThan(0);
    expect(passPose(84, pass, 0.04, clip).weight).toBeGreaterThan(0); // 0.36 s after: ending
    expect(passPose(90, pass, 0.04, clip).weight).toBe(0);
  });
  it("turns the body over a longer window than the clip, so it does not spin", () => {
    const before = passPose(60, pass, 0.04, clip); // 0.25 s before the clip starts
    expect(before.weight).toBe(0);
    expect(before.facing).toBeGreaterThan(0);
    expect(passPose(75, pass, 0.04, clip).facing).toBe(1);
    expect(passPose(90, pass, 0.04, clip).facing).toBeGreaterThan(0); // just after the clip
    expect(passPose(97, pass, 0.04, clip).facing).toBe(0);
    let prev = 0;
    for (let f = 55; f <= 98; f += 0.25) {
      const now = passPose(f, pass, 0.04, clip).facing;
      expect(Math.abs(now - prev)).toBeLessThan(0.04); // under 1/42 per 10 ms: no snap
      prev = now;
    }
  });
  it("finds each player's passes in the run, with the pass direction", () => {
    const hero = parseHero(raw);
    const passes = passEvents(hero.runs.factual.events, hero.ids);
    const h8 = passes[hero.ids.indexOf("H8")];
    expect(h8.map((p) => p.frame)).toEqual([75]);
    expect(h8[0].yaw / DEG).toBeCloseTo(-4.5, 0); // forward to H9
    expect(passes[hero.ids.indexOf("H4")].map((p) => p.frame)).toEqual([15]);
  });
  it("turns the body so the kick goes along the pass while the clip plays, else body_yaw", () => {
    const body = Math.PI; // H8 faces his own goal at the pass
    expect(passFacing(body, { facing: 0, yaw: -0.07 }, clip)).toBe(body);
    const full = passFacing(body, { facing: 1, yaw: -0.07 }, clip);
    expect(wrapAngle(full + clip.kickYaw - -0.07)).toBeCloseTo(0, 12);
    const half = passFacing(body, { facing: 0.5, yaw: -0.07 }, clip);
    expect(Math.abs(wrapAngle(half - body))).toBeCloseTo(Math.abs(wrapAngle(full - body)) / 2, 12);
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
