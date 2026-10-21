// The shot spec and its maths (shot.ts), without a scene: defaults, the rejections load()
// makes, easing, the time track (including a rewind), camera interpolation, and the handheld
// shake. Expected numbers are worked out by hand so a copied formula cannot pass itself.

import { describe, expect, it } from "vitest";
import {
  cameraAt,
  CineShot,
  ease,
  frameAt,
  loadShot,
  pitchToWorld,
  shakeAt,
  type Vec3,
} from "./shot";

const base = {
  id: "wide",
  duration: 4,
  time: [{ t: 0, frame: 0 }],
  camera: [
    {
      t: 0,
      eye: { at: "world", p: [0, 0, 2] as Vec3 },
      look: { at: "world", p: [1, 0, 1] as Vec3 },
    },
  ],
};

describe("CineShot schema", () => {
  it("fills the documented defaults and leaves fov unset", () => {
    const shot = CineShot.parse({
      id: "min",
      duration: 2,
      time: [{ t: 0, frame: 4 }],
      camera: [
        {
          t: 0,
          eye: { at: "player", id: "H8", orbit: { r: 8, az: 0, h: 3 } },
          look: { at: "ball" },
        },
      ],
    });
    expect(shot.run).toBe("factual");
    expect(shot.smooth).toBe(0.2);
    expect(shot.shake).toBeNull();
    expect(shot.pov).toBeNull();
    expect(shot.dof).toBeNull();
    expect(shot.bloom).toEqual({ strength: 0.6, radius: 0.5, threshold: 0.85 });
    expect(shot.motionBlur).toBe(true);
    expect(shot.periphery).toBe(0);
    expect(shot.cone).toBeNull();
    expect(shot.rings).toBe(false);
    expect(shot.labels).toBe(false);
    expect(shot.ghosts).toBe(false);
    expect(shot.fog).toEqual([60, 220]);
    expect(shot.exposure).toBe(1);
    expect(shot.letterbox).toBeNull();
    expect(shot.time[0].ease).toBe("linear");
    expect(shot.camera[0].ease).toBe("linear");
    expect(shot.camera[0].roll).toBe(0);
    expect(shot.camera[0].fov).toBeUndefined();
    const eye = shot.camera[0].eye;
    expect(eye.at).toBe("player");
    if (eye.at === "player") expect(eye.axes).toBe("world");
  });

  it("keeps an explicit null and defaults a cone radius to 35 m", () => {
    const shot = CineShot.parse({
      ...base,
      bloom: null,
      shake: null,
      letterbox: null,
      cone: { id: "H8", opacity: 0.4, flash: 1 },
    });
    expect(shot.bloom).toBeNull();
    expect(shot.shake).toBeNull();
    expect(shot.letterbox).toBeNull();
    expect(shot.cone?.radius).toBe(35);
  });

  it("rejects a broken spec with the field in the message", () => {
    const bad = [
      { ...base, duration: 0 },
      { ...base, time: [] },
      { ...base, camera: [] },
      { ...base, time: [{ t: 0, frame: 0, ease: "bounce" }] },
      { ...base, periphery: 2 },
      { ...base, smooth: -0.1 },
      { ...base, extra: true },
      { ...base, duration: 2, time: [{ t: 0, frame: 0 }, { t: 4, frame: 1 }] },
      { ...base, time: [{ t: 1, frame: 8 }, { t: 0, frame: 0 }] },
      { ...base, time: [{ t: -0.2, frame: 0 }] },
    ];
    for (const input of bad) {
      const parsed = CineShot.safeParse(input);
      expect(parsed.success, JSON.stringify(input)).toBe(false);
    }
    const outside = loadShot(
      { ...base, duration: 2, time: [{ t: 0, frame: 0 }, { t: 4, frame: 9 }] },
      { ids: ["H8"], heroId: "H8", hasVision: true },
    );
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.errors.join(" ")).toMatch(/time\.1\.t/);
    const order = loadShot(
      { ...base, time: [{ t: 1, frame: 3 }, { t: 1, frame: 4 }] },
      { ids: ["H8"], heroId: "H8", hasVision: true },
    );
    expect(order.ok).toBe(false);
    if (!order.ok) expect(order.errors.join(" ")).toMatch(/time\.1\.t/);
  });

  it("rejects unknown players, eyes, ghosts without a hero, and a cone without vision", () => {
    const data = { ids: ["H8", "A4"], heroId: "H8" as string | null, hasVision: true };
    const eyes = loadShot(
      {
        ...base,
        camera: [{ t: 0, eye: { at: "eyes", id: "Z9" }, look: { at: "world", p: [0, 0, 1] } }],
      },
      data,
    );
    expect(eyes.ok).toBe(false);
    if (!eyes.ok) expect(eyes.errors.join(" ")).toMatch(/eyes/);
    if (!eyes.ok) expect(eyes.errors.join(" ")).toMatch(/Z9/);

    const pov = loadShot({ ...base, pov: "NOPE" }, data);
    expect(pov.ok).toBe(false);
    if (!pov.ok) expect(pov.errors.join(" ")).toMatch(/NOPE/);

    const ghosts = loadShot({ ...base, ghosts: true }, { ...data, heroId: null });
    expect(ghosts.ok).toBe(false);
    if (!ghosts.ok) expect(ghosts.errors.join(" ")).toMatch(/ghosts/);

    const cone = loadShot(
      { ...base, cone: { id: "H8", opacity: 0.2, flash: 1 } },
      { ...data, hasVision: false },
    );
    expect(cone.ok).toBe(false);
    if (!cone.ok) expect(cone.errors.join(" ")).toMatch(/vision/);

    const ok = loadShot(base, { ...data, heroId: null, hasVision: false });
    expect(ok.ok).toBe(true);
  });
});

describe("ease", () => {
  it("is 0 at the start, 1 at the end, and monotone", () => {
    for (const kind of ["linear", "in", "out", "inOut"] as const) {
      expect(ease(kind, 0)).toBe(0);
      expect(ease(kind, 1)).toBe(1);
      let prev = -1;
      for (let i = 0; i <= 10; i++) {
        const v = ease(kind, i / 10);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
    expect(ease("in", 0.5)).toBeCloseTo(0.125);
    expect(ease("out", 0.5)).toBeCloseTo(0.875);
    expect(ease("inOut", 0.5)).toBeCloseTo(0.5);
    expect(ease("linear", -2)).toBe(0);
    expect(ease("linear", 3)).toBe(1);
  });
});

describe("frameAt", () => {
  const shot = CineShot.parse({
    ...base,
    duration: 4,
    time: [
      { t: 1, frame: 100 },
      { t: 3, frame: 40, ease: "out" },
    ],
  });

  it("holds the end keys and eases the segment between them", () => {
    expect(frameAt(shot, 0)).toBe(100);
    expect(frameAt(shot, 1)).toBe(100);
    expect(frameAt(shot, 3)).toBe(40);
    expect(frameAt(shot, 4)).toBe(40);
    // u = 0.5, ease out = 0.875, 100 + (40 - 100) * 0.875 = 47.5
    expect(frameAt(shot, 2)).toBeCloseTo(47.5);
  });

  it("follows a segment whose frame goes backwards", () => {
    const rewind = CineShot.parse({
      ...base,
      time: [
        { t: 0, frame: 100 },
        { t: 2, frame: 40, ease: "linear" },
      ],
    });
    expect(frameAt(rewind, 1)).toBeCloseTo(70);
    const slow = CineShot.parse({
      ...base,
      time: [
        { t: 0, frame: 0, ease: "linear" },
        { t: 2, frame: 100, ease: "in" },
      ],
    });
    expect(frameAt(slow, 1)).toBeCloseTo(12.5);
  });
});

describe("cameraAt", () => {
  it("sweeps orbit azimuth through the parameters, 0 to 300 through 150", () => {
    const shot = CineShot.parse({
      ...base,
      duration: 2,
      camera: [
        {
          t: 0,
          eye: { at: "player", id: "H8", orbit: { r: 10, az: 0, h: 2 }, axes: "body" },
          look: { at: "world", p: [0, 0, 1] },
          fov: 30,
          roll: 0,
        },
        {
          t: 2,
          eye: { at: "player", id: "H8", orbit: { r: 10, az: 300, h: 4 }, axes: "body" },
          look: { at: "world", p: [0, 0, 1] },
          fov: 50,
          roll: 10,
          ease: "linear",
        },
      ],
    });
    const azAt = (t: number) => {
      let az = Number.NaN;
      let eyeCalls = 0;
      cameraAt(shot, t, (anchor, role) => {
        if (role === "eye") {
          eyeCalls += 1;
          if (anchor.at === "player" && anchor.orbit) az = anchor.orbit.az;
        }
        return [0, 0, 0];
      });
      return { az, eyeCalls };
    };
    expect(azAt(0)).toEqual({ az: 0, eyeCalls: 1 });
    expect(azAt(1).az).toBeCloseTo(150);
    expect(azAt(1).eyeCalls).toBe(1);
    expect(azAt(2).az).toBeCloseTo(300);
    const mid = cameraAt(shot, 1, () => [0, 0, 0]);
    expect(mid.fov).toBeCloseTo(40);
    expect(mid.roll).toBeCloseTo(5);
  });

  it("lerps resolved points when the two eyes are different anchors", () => {
    const shot = CineShot.parse({
      ...base,
      duration: 2,
      camera: [
        { t: 0, eye: { at: "world", p: [0, 0, 0] }, look: { at: "world", p: [0, 0, 1] }, fov: 20, roll: -4 },
        { t: 2, eye: { at: "ball" }, look: { at: "world", p: [0, 0, 1] }, fov: 40, roll: 6 },
      ],
    });
    let eyeCalls = 0;
    const pose = cameraAt(shot, 1, (anchor, role) => {
      if (role === "eye") eyeCalls += 1;
      if (anchor.at === "world") return [anchor.p[0], anchor.p[1], anchor.p[2]];
      if (anchor.at === "ball") return [10, 0, 2];
      return [0, 0, 0];
    });
    expect(eyeCalls).toBe(2);
    expect(pose.eye).toEqual([5, 0, 1]);
    expect(pose.fov).toBeCloseTo(30);
    expect(pose.roll).toBeCloseTo(1);
  });

  it("uses the first-person horizontal field when an eyes key omits fov", () => {
    const shot = CineShot.parse({
      ...base,
      camera: [{ t: 0, eye: { at: "eyes", id: "H8" }, look: { at: "eyes", id: "H8" } }],
    });
    const wide = cameraAt(shot, 0, () => [0, 0, 0], 16 / 9);
    const square = cameraAt(shot, 0, () => [0, 0, 0], 1);
    expect(wide.fov).not.toBeCloseTo(40);
    expect(wide.fov).toBeLessThan(95);
    expect(square.fov).toBeCloseTo(95);
    expect(wide.fov).toBeLessThan(square.fov);
  });
});

describe("shakeAt", () => {
  it("is zero without a shake and repeats itself for the same time", () => {
    expect(shakeAt(null, 1.2)).toEqual([0, 0, 0]);
    const shake = { amp: 0.2, freq: 3 };
    const a = shakeAt(shake, 1.25);
    const b = shakeAt(shake, 1.25);
    expect(a).toEqual(b);
    expect(a.some((v) => v !== 0)).toBe(true);
    for (const v of a) expect(Math.abs(v)).toBeLessThanOrEqual(0.2);
    expect(shakeAt(shake, 0.4)).not.toEqual(a);
  });
});

describe("pitchToWorld", () => {
  it("maps pitch (x, y, height) to three.js (x, height, -y)", () => {
    expect(pitchToWorld([3, 4, 5])).toEqual([3, 5, -4]);
  });
});
