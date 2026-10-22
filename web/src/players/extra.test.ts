// The extra clips (extra.ts; on by default, `?anims=base` turns them off) on the committed model and the seed-3 export: the
// animations-only GLB binds to every bone of grf_player.glb without changing its skeleton, the
// kick plays at the sim's pass events and the shoulder checks at its scans, the head still points
// along the sim's head_yaw, and reduced motion leaves the checks out.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, wrapAngle } from "../data/hero";
import { worldYaw } from "../views/tokens";
import { type ExtraMeta, checkPose, checkTwist, extraClips, shoulderChecks } from "./extra";
import { passPose } from "./gait";
import { NECK_MAX, splitLook } from "./look";
import { type ModelMeta, PLAYER_HEIGHT, makeRig, modelClips, poseRig, runMotion } from "./rig";
import { animsFromSearch } from "./trial";

const hero = parseHero(raw);
const run = hero.runs.factual;
const DEG = Math.PI / 180;

type Fs = { readFileSync(path: URL): Uint8Array };
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } })
  .process;

async function load(file: string): Promise<GLTF> {
  const bytes = nodeProcess
    .getBuiltinModule("node:fs")
    .readFileSync(new URL(`../../public/models/${file}`, import.meta.url));
  return new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, "");
}

const model = await load("grf_player.glb");
const extraGltf = await load("anims_extra.glb");
const meta = model.scene.userData as ModelMeta;
const extra = extraClips(extraGltf);
const clips = modelClips(meta, extra);
const base = modelClips(meta);
const motion = runMotion(hero, run, clips.gait, extra.check);
const baseMotion = runMotion(hero, run, base.gait);

function pose(id: string, f: number, opts: { extra?: boolean; checks?: boolean } = {}) {
  const useExtra = opts.extra ?? true;
  const j = hero.ids.indexOf(id);
  const rig = makeRig(model, PLAYER_HEIGHT / meta.height_m, useExtra ? extra : null);
  const n = hero.n;
  const body = run.body[f * n + j];
  const head = run.head[f * n + j];
  const split = poseRig(
    rig,
    useExtra ? motion : baseMotion,
    useExtra ? clips : base,
    j,
    f,
    hero.dt,
    0,
    0,
    body,
    head,
    opts.checks ?? true,
  );
  rig.holder.updateMatrixWorld(true);
  return { rig, body, head, split, j };
}

describe("the anims switch", () => {
  it("plays the extra clips unless ?anims=base", () => {
    expect(animsFromSearch("")).toBe("extra");
    expect(animsFromSearch("?anims=extra")).toBe("extra");
    expect(animsFromSearch("?seed=3&anims=base")).toBe("base");
  });
});

describe("anims_extra.glb", () => {
  it("binds every track to a bone of grf_player.glb, whose skeleton it does not change", () => {
    const bones = new Map<string, THREE.Object3D>();
    model.scene.traverse((o) => bones.set(o.name, o));
    const own = new Map<string, THREE.Object3D>();
    extraGltf.scene.traverse((o) => own.set(o.name, o));
    expect(extraGltf.animations.map((c) => c.name).sort()).toEqual([
      "pass_short",
      "shoulder_check_l",
      "shoulder_check_r",
    ]);
    for (const clip of extraGltf.animations) {
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const bone = bones.get(nodeName);
        expect(bone, `${clip.name}: ${track.name}`).toBeDefined();
        expect(["quaternion", "position"]).toContain(propertyName);
        // The clips were solved against these exact joint frames.
        const mine = own.get(nodeName)!;
        expect(mine.position.distanceTo(bone!.position)).toBeLessThan(1e-6);
        expect(Math.abs(mine.quaternion.dot(bone!.quaternion))).toBeGreaterThan(1 - 1e-9);
        // The checks never touch the neck; the kick's neck track only tilts the head towards the
        // ball, its yaw is put back on head_yaw by look.ts (tested below).
        if (clip.name !== "pass_short") expect(nodeName).not.toBe("neck");
      }
    }
    // Every bound property resolves on a cloned rig, as the mixer binds it.
    const rig = makeRig(model, 1, extra);
    for (const a of [rig.pass, rig.checkLeft!, rig.checkRight!]) {
      for (const track of a.getClip().tracks) {
        const binding = new THREE.PropertyBinding(rig.model, track.name);
        expect(binding.node, track.name).toBeTruthy();
      }
    }
  });

  it("checks only turn the trunk, as an additive layer; the kick carries the whole body", () => {
    expect(extra.checkLeft.blendMode).toBe(THREE.AdditiveAnimationBlendMode);
    expect(extra.checkRight.blendMode).toBe(THREE.AdditiveAnimationBlendMode);
    for (const c of [extra.checkLeft, extra.checkRight]) {
      expect(c.tracks.map((t) => t.name)).toEqual(["middle.quaternion"]);
    }
    expect(extra.passClip.tracks.length).toBe(14); // 13 joints and the root's bob
  });

  it("carries the sources' credits and sane clip timings", () => {
    const m = extraGltf.scene.userData as ExtraMeta;
    expect(m.credits.join(" ")).toContain("mocap.cs.cmu.edu");
    expect(extra.pass.touch).toBeGreaterThan(0.2);
    expect(extra.pass.touch).toBeLessThan(extra.pass.duration - 0.2);
    expect(Math.abs(extra.pass.kickYaw)).toBeLessThan(10 * DEG);
    const c = extra.check;
    expect(0 < c.reach && c.reach < c.leave && c.leave < c.back && c.back <= c.duration).toBe(true);
    expect(Math.max(...c.twist) / DEG).toBeGreaterThan(8); // the trunk joins the look
    expect(Math.max(...c.twist) / DEG).toBeLessThan(30);
  });
});

describe("timing on the sim's events", () => {
  const h8 = hero.ids.indexOf("H8");

  it("H8's key scan is a shoulder check over his right shoulder, phased by his head", () => {
    const key = run.scans.find((s) => s.player === "H8" && s.key)!;
    const checks = shoulderChecks(hero, run, h8, extra.check);
    expect(checks.length).toBe(1);
    const c = checks[0];
    expect([c.start, c.end]).toEqual([key.start, key.end]);
    expect(c.side).toBe(-1); // head −128° from the body: clockwise, the right shoulder
    expect(c.weight).toBe(1);
    expect(c.start < c.reach && c.reach <= c.leave && c.leave < c.end).toBe(true);
    // The warp lands the clip's phases on the scan's.
    const at = (f: number) => checkPose(f, checks, hero.dt, extra.check);
    expect(at(c.start).time).toBeCloseTo(0, 9);
    expect(at(c.reach).time).toBeCloseTo(extra.check.reach, 9);
    expect(at(c.leave).time).toBeCloseTo(extra.check.leave, 9);
    expect(at(c.end).time).toBeCloseTo(extra.check.back, 9);
    expect(at(c.start - 0.5).weight).toBe(0);
    const tail = (extra.check.duration - extra.check.back) / hero.dt;
    expect(at(c.end + tail + 0.5).weight).toBe(0);
    for (let f = c.start; f <= c.end + tail; f += 0.25) {
      const t = at(f).time;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(extra.check.duration);
    }
  });

  it("plays a check only during scans, on the side the head turns, and the kick at the pass", () => {
    const pass = motion.passes[h8][0];
    expect(pass.frame).toBe(75);
    for (let f = 0; f < run.frames; f++) {
      const { rig } = pose("H8", f);
      const inScan = f >= 50 && f <= 70 + 0.5 / hero.dt; // the scan and the trunk's settle
      if (!inScan) expect(rig.checkRight!.getEffectiveWeight()).toBe(0);
      expect(rig.checkLeft!.getEffectiveWeight()).toBe(0);
      const p = passPose(f, motion.passes[h8], hero.dt, clips.pass);
      expect(rig.pass.getEffectiveWeight()).toBeCloseTo(p.weight, 9);
    }
    expect(pose("H8", 60).rig.checkRight!.getEffectiveWeight()).toBe(1);
    // At the pass event the kick's ball contact is on screen at full weight.
    const { rig } = pose("H8", pass.frame);
    expect(rig.pass.getEffectiveWeight()).toBe(1);
    expect(rig.pass.time).toBeCloseTo(extra.pass.touch, 9);
    expect(rig.pass.getClip().name).toBe("pass_short");
  });

  it("at H8's pass the kick goes along the pass to H9", () => {
    const pass = motion.passes[h8][0];
    const { rig, split } = pose("H8", pass.frame);
    const kick = worldYaw(rig.holder) - split.hips + clips.pass.kickYaw;
    expect(Math.abs(wrapAngle(kick - pass.yaw))).toBeLessThan(1e-6);
  });
});

describe("the head stays the sim's", () => {
  it("points every player's head along head_yaw through checks and kicks", () => {
    for (const f of [20, 30, 50, 55, 58, 60, 64, 66, 70, 72, 75, 80, 100, 120, 140]) {
      for (const id of hero.ids) {
        for (const checks of [true, false]) {
          const { rig, head } = pose(id, f, { checks });
          expect(Math.abs(wrapAngle(worldYaw(rig.neck) - head))).toBeLessThan(1e-3);
          expect(Math.abs(wrapAngle(worldYaw(rig.neck) - worldYaw(rig.middle)))).toBeLessThan(
            NECK_MAX + 0.02,
          );
        }
      }
    }
  });

  it("the trunk joins a smaller look; a big one turns it no further than before", () => {
    // A5's scan from frame 100: the head 8° → 48° off the body, below the neck's 80°, so the
    // engine's split turned only the neck; the check now turns the trunk with it.
    const a5 = hero.ids.indexOf("A5");
    const c = shoulderChecks(hero, run, a5, extra.check).find((s) => s.start === 100)!;
    expect(c.side).toBe(1);
    const f = Math.round((c.reach + c.leave) / 2);
    const on = pose("A5", f);
    const off = pose("A5", f, { checks: false });
    const turned = wrapAngle(worldYaw(on.rig.middle) - worldYaw(off.rig.middle));
    const s = checkPose(f, [c], hero.dt, extra.check);
    const twist = checkTwist(extra.check, s.time, s.weight, s.side);
    expect(turned / DEG).toBeGreaterThan(4);
    expect(Math.abs(turned - twist) / DEG).toBeLessThan(3);
    // H8's key scan, −128°: the trunk's share is the engine's 48° (−128 + 80), check or not.
    const big = pose("H8", 60);
    const split = splitLook(big.body, big.head);
    const trunkOn = wrapAngle(worldYaw(big.rig.middle) - worldYaw(big.rig.holder));
    const ref = pose("H8", 60, { checks: false });
    const trunkOff = wrapAngle(worldYaw(ref.rig.middle) - worldYaw(ref.rig.holder));
    expect(Math.abs(trunkOn - trunkOff) / DEG).toBeLessThan(3);
    expect(Math.abs(split.trunk) / DEG).toBeCloseTo(48, 0);
  });
});

describe("reduced motion", () => {
  it("leaves the checks out and the head exact; the pass still plays", () => {
    for (const f of [52, 58, 64, 68]) {
      const { rig, head } = pose("H8", f, { checks: false });
      expect(rig.checkLeft!.getEffectiveWeight()).toBe(0);
      expect(rig.checkRight!.getEffectiveWeight()).toBe(0);
      expect(Math.abs(wrapAngle(worldYaw(rig.neck) - head))).toBeLessThan(1e-3);
    }
    expect(pose("H8", 75, { checks: false }).rig.pass.getEffectiveWeight()).toBe(1);
  });
});

describe("posing with the extra clips", () => {
  it("is history-free: the same frame gives the same pose, whatever came before", () => {
    const j = hero.ids.indexOf("H8");
    const n = hero.n;
    const rig = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra);
    const at = (f: number) => {
      poseRig(rig, motion, clips, j, f, hero.dt, 0, 0, run.body[f * n + j], run.head[f * n + j]);
      rig.holder.updateMatrixWorld(true);
      return [worldYaw(rig.holder), worldYaw(rig.middle), worldYaw(rig.neck)];
    };
    for (const target of [60, 75]) {
      const fresh = pose("H8", target).rig;
      const once = [worldYaw(fresh.holder), worldYaw(fresh.middle), worldYaw(fresh.neck)];
      for (const history of [
        [target, target, target],
        [57, 64, target],
        [10, 70, target, target],
      ]) {
        let last: number[] = [];
        for (const f of history) last = at(f);
        for (let k = 0; k < 3; k++)
          expect(Math.abs(wrapAngle(last[k] - once[k]))).toBeLessThan(1e-6);
      }
    }
  });

  it("keeps the feet on the ground through the kick and the checks", () => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const [id, frames] of [
      ["H8", [52, 60, 64, 66, 68, 70, 72, 75, 78, 80, 84, 88]],
      ["H4", [6, 10, 15, 20, 25]],
      ["A5", [100, 106, 112]],
    ] as const) {
      for (const f of frames) {
        const { rig } = pose(id, f);
        box.makeEmpty();
        rig.model.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          const p = mesh.geometry.attributes.position;
          for (let i = 0; i < p.count; i++) {
            mesh.getVertexPosition(i, v);
            box.expandByPoint(v.applyMatrix4(mesh.matrixWorld));
          }
        });
        expect(box.min.y, `${id} ${f}`).toBeGreaterThan(-0.05);
        expect(box.min.y, `${id} ${f}`).toBeLessThan(0.15);
        expect(box.max.y).toBeLessThan(PLAYER_HEIGHT + 0.05);
      }
    }
  });
});
