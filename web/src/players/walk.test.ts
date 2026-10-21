// The walk (walk.ts; with the extra clips, `?walk=0` leaves it out) on the committed model and
// the seed-3 export: anims_walk.glb binds to every bone of grf_player.glb without changing its
// skeleton, its left-foot strike lands on the jog's, the planted foot keeps the ground's speed in
// the walking gait, the engine's gait poses exactly as without the walk, and walking players keep
// their heads on head_yaw and their feet on (not in) the ground, history-free.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, wrapAngle } from "../data/hero";
import { worldYaw } from "../views/tokens";
import { extraClips } from "./extra";
import { RUN_UP, gaitBlend, gaitPhase, gaitRun, strollTime } from "./gait";
import { NECK_MAX } from "./look";
import {
  type ModelMeta,
  type Motion,
  type Rig,
  PLAYER_HEIGHT,
  makeRig,
  modelClips,
  poseRig,
  runMotion,
} from "./rig";
import { walkFromSearch } from "./trial";
import { type WalkMeta, walkClips } from "./walk";

const hero = parseHero(raw);
const run = hero.runs.factual;

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
const walkGltf = await load("anims_walk.glb");
const meta = model.scene.userData as ModelMeta;
const extra = extraClips(extraGltf);
const walk = walkClips(walkGltf);
const clips = modelClips(meta, extra, walk);
const base = modelClips(meta);
const motion = runMotion(hero, run, clips.gait, extra.check);
const baseMotion = runMotion(hero, run, base.gait);

function pose(id: string, f: number) {
  const j = hero.ids.indexOf(id);
  const rig = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra, walk);
  const n = hero.n;
  const body = run.body[f * n + j];
  const head = run.head[f * n + j];
  poseRig(rig, motion, clips, j, f, hero.dt, 0, 0, body, head);
  rig.holder.updateMatrixWorld(true);
  return { rig, body, head, j };
}

describe("the walk switch", () => {
  it("plays the walk unless ?walk=0, which keeps the kick and the checks", () => {
    expect(walkFromSearch("")).toBe(true);
    expect(walkFromSearch("?walk=1")).toBe(true);
    expect(walkFromSearch("?seed=3&walk=0")).toBe(false);
    const noWalk = modelClips(meta, extra, null);
    expect(noWalk.gait.stroll).toBeNull();
    expect(noWalk.extra).toBe(extra);
    expect(noWalk.pass).toEqual(clips.pass);
    const rig = makeRig(model, 1, extra, null);
    expect(rig.stroll).toBeNull();
    expect(rig.soles).toBeNull();
  });
});

describe("anims_walk.glb", () => {
  it("binds its one clip to bones of grf_player.glb, whose skeleton it does not change", () => {
    const bones = new Map<string, THREE.Object3D>();
    model.scene.traverse((o) => bones.set(o.name, o));
    const own = new Map<string, THREE.Object3D>();
    walkGltf.scene.traverse((o) => own.set(o.name, o));
    expect(walkGltf.animations.map((c) => c.name)).toEqual(["walk"]);
    for (const track of walk.clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      const bone = bones.get(nodeName);
      expect(bone, track.name).toBeDefined();
      expect(["quaternion", "position"]).toContain(propertyName);
      const mine = own.get(nodeName)!;
      expect(mine.position.distanceTo(bone!.position)).toBeLessThan(1e-6);
      expect(Math.abs(mine.quaternion.dot(bone!.quaternion))).toBeGreaterThan(1 - 1e-9);
    }
    const rig = makeRig(model, 1, extra, walk);
    for (const track of rig.stroll!.getClip().tracks) {
      expect(new THREE.PropertyBinding(rig.model, track.name).node, track.name).toBeTruthy();
    }
  });

  it("credits Quaternius and says where the walk comes from", () => {
    const m = walkGltf.scene.userData as WalkMeta;
    expect(m.credits.join(" ")).toContain("Quaternius");
    expect(m.clips.walk.source).toContain("Walk_Loop");
    expect(m.clips.walk.license).toContain("CC0");
  });
});

describe("the walking gait", () => {
  const st = clips.gait.stroll!;
  const v3 = new THREE.Vector3();

  /** Every boot vertex in the world, per foot (the model faces +x, its right is +z). */
  function boots(rig: Rig): Record<"left" | "right", THREE.Vector3[]> {
    rig.holder.updateMatrixWorld(true);
    const pts: Record<"left" | "right", THREE.Vector3[]> = { left: [], right: [] };
    rig.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || (mesh.material as THREE.Material).name !== "boots") return;
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const w = mesh.getVertexPosition(i, v3).applyMatrix4(mesh.matrixWorld).clone();
        pts[w.z < 0 ? "left" : "right"].push(w);
      }
    });
    return pts;
  }

  /** One player running straight along +x at a steady speed, in the gait gaitRun gives it. */
  function steady(v: number, c = clips, frames = 400): Motion {
    const speeds = new Float32Array(frames).fill(v);
    const run = c.gait.stroll ? gaitRun(speeds, hero.dt) : new Float32Array(frames).fill(1);
    return {
      speeds: [speeds],
      run: [run],
      phase: [gaitPhase(speeds, hero.dt, c.gait, run)],
      passes: [[]],
      checks: [[]],
    };
  }

  /**
   * How fast the boot's contact point moves backwards while it is on the ground (m/s), over one
   * cycle in 80 samples: the median, and the share of contact samples off v by more than half.
   * The contact point is the boot's lowest vertex; that same vertex is followed to the next
   * sample, so a foot rolling heel to toe does not count as moving.
   */
  function contactSpeed(v: number) {
    const rig = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra, walk);
    const motion = steady(v);
    const cycles = (gaitBlend(v, clips.gait, motion.run[0][0]).rate / clips.gait.cycle) * hero.dt;
    const N = 80;
    const samples: Record<"left" | "right", THREE.Vector3[]>[] = [];
    for (let k = 0; k <= N; k++) {
      poseRig(rig, motion, clips, 0, 20 + k / N / cycles, hero.dt, 0, 0, 0, 0, false);
      samples.push(boots(rig));
    }
    const dtk = (1 / N / cycles) * hero.dt;
    const speeds: number[] = [];
    for (const side of ["left", "right"] as const) {
      for (let k = 0; k < N; k++) {
        const pts = samples[k][side];
        const i = pts.reduce((m, w, n) => (w.y < pts[m].y ? n : m), 0);
        if (pts[i].y > 0.006) continue;
        speeds.push(-(samples[k + 1][side][i].x - pts[i].x) / dtk);
      }
    }
    speeds.sort((a, b) => a - b);
    return {
      median: speeds[Math.floor(speeds.length / 2)],
      off: speeds.filter((b) => Math.abs(b - v) > 0.5 * v).length / speeds.length,
    };
  }

  it("is a loop on the skeleton, with its stride speed and strike phase from the build", () => {
    expect(st.cycle).toBeCloseTo(4 / 3, 5); // Quaternius Walk_Loop: two steps in 1.33 s
    expect(st.speed).toBeGreaterThan(0.95); // its 0.975 m/s, for our longer legs
    expect(st.speed).toBeLessThan(1.1);
    expect(walk.clip.duration).toBeCloseTo(st.cycle, 5);
    for (const track of walk.clip.tracks) {
      const n = track.getValueSize();
      const first = Array.from(track.values.slice(0, n));
      const last = Array.from(track.values.slice(track.values.length - n));
      for (let k = 0; k < n; k++) expect(last[k], track.name).toBeCloseTo(first[k], 4);
    }
    const w = (walkGltf.scene.userData as WalkMeta).clips.walk;
    expect(w.left_strike_phase).toBeGreaterThanOrEqual(0);
    expect(w.left_strike_phase).toBeLessThan(1);
    expect(st.offset).toBeCloseTo(w.left_strike_phase! - w.engine_left_strike_phase!.walk, 12);
  });

  it("strikes the left foot on the same gait phase as the jog", () => {
    // Measured on this model, as the build measured it: from the swing's top, the first sample
    // the left boot drops within 12 mm of its lowest.
    const rig = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra, walk);
    const strike = (action: THREE.AnimationAction, time: (p: number) => number) => {
      for (const a of [rig.idle, rig.walk, rig.sprint, rig.pass, rig.stroll!]) {
        a.setEffectiveWeight(0);
      }
      action.setEffectiveWeight(1);
      const ys: number[] = [];
      for (let p = 0; p < 1; p += 0.005) {
        action.time = time(p);
        rig.mixer.update(0);
        ys.push(Math.min(...boots(rig).left.map((w) => w.y)));
      }
      const level = Math.min(...ys) + 0.012;
      const top = ys.indexOf(Math.max(...ys));
      for (let k = 1; k <= ys.length; k++) {
        const i = (top + k) % ys.length;
        if (ys[i] < level) return i / ys.length;
      }
      throw new Error("no strike");
    };
    const jog = strike(rig.walk, (p) => p * clips.gait.cycle);
    const walked = strike(rig.stroll!, (p) => strollTime(p, st));
    console.log("left strike: jog at phase %s, walk at %s", jog.toFixed(3), walked.toFixed(3));
    expect(Math.abs(((walked - jog + 1.5) % 1) - 0.5)).toBeLessThan(0.03);
  });

  it("keeps the planted foot moving with the ground at walking speeds (no sliding)", () => {
    const rows: string[] = [];
    for (const v of [0.3, 0.6, 1.0, 1.4, RUN_UP - 0.05]) {
      const { median, off } = contactSpeed(v);
      rows.push(
        `${v.toFixed(2)} m/s: ${(median / v).toFixed(2)} v, ${(100 * off).toFixed(0)}% off`,
      );
      expect(Math.abs(median - v) / v, `${v} m/s`).toBeLessThan(0.06);
      expect(off, `${v} m/s`).toBeLessThan(0.2); // touch-down and toe-off
    }
    console.log("contact point speed, walking gait: %s", rows.join("; "));
  });

  it("the engine's gait poses the body exactly as without the walk", () => {
    const noWalk = modelClips(meta, extra, null);
    for (const v of [RUN_UP + 0.1, 3, 6]) {
      const a = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra, walk);
      const b = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra, null);
      const ma = steady(v);
      const mb = steady(v, noWalk);
      expect(Array.from(ma.run[0]).every((w) => w === 1)).toBe(true);
      for (const f of [30, 37.5, 52]) {
        poseRig(a, ma, clips, 0, f, hero.dt, 0, 0, 0.4, 0.4, false);
        poseRig(b, mb, noWalk, 0, f, hero.dt, 0, 0, 0.4, 0.4, false);
        expect(a.model.position.y).toBe(0);
        a.model.traverse((o) => {
          const other = b.model.getObjectByName(o.name);
          if (!o.name || !other) return;
          // the neck is re-aimed after the mixer: rounding only
          expect(Math.abs(o.quaternion.dot(other.quaternion)), o.name).toBeGreaterThan(1 - 1e-7);
          expect(o.position.distanceTo(other.position), o.name).toBeLessThan(1e-9);
        });
      }
    }
  });

  it("`?anims=base` has no walk: the engine's clips alone", () => {
    expect(base.gait.stroll).toBeNull();
    expect(makeRig(model, 1, null).stroll).toBeNull();
    expect(makeRig(model, 1, null).soles).toBeNull();
    expect(baseMotion.run.every((r) => r.every((w) => w === 1))).toBe(true);
    for (let v = 0; v < 8; v += 0.1) expect(gaitBlend(v, base.gait, 0).stroll).toBe(0);
  });

  /** Seed-3 player-frames in the walking gait (walking on), or changing gait. */
  function seed3(which: "walking" | "changing"): [string, number][] {
    const out: [string, number][] = [];
    hero.ids.forEach((id, j) => {
      for (let f = 0; f < run.frames; f++) {
        const w = motion.run[j][f];
        const walking = w === 0 && gaitBlend(motion.speeds[j][f], clips.gait, 0).stroll >= 0.5;
        if (which === "walking" ? walking && f % 3 === 0 : w > 0 && w < 1) out.push([id, f]);
      }
    });
    return out;
  }

  it("on seed 3: the head on head_yaw, the neck within its limit, the feet on the ground", () => {
    const walking = seed3("walking");
    const changing = seed3("changing");
    expect(walking.length).toBeGreaterThan(30);
    expect(changing.length).toBeGreaterThan(10);
    const box = new THREE.Box3();
    const floor = new Map<string, number>(); // the walking gait on the ground, a change as before
    for (const [id, f] of walking) floor.set(`${id} ${f}`, -1e-4);
    for (const [id, f] of changing) floor.set(`${id} ${f}`, -0.05);
    for (const [id, f] of [...walking, ...changing]) {
      const { rig, head } = pose(id, f);
      if (rig.pass.getEffectiveWeight() < 1) {
        expect(rig.stroll!.getEffectiveWeight(), `${id} ${f}`).toBeGreaterThan(0);
      }
      expect(Math.abs(wrapAngle(worldYaw(rig.neck) - head)), `${id} ${f}`).toBeLessThan(1e-3);
      expect(Math.abs(wrapAngle(worldYaw(rig.neck) - worldYaw(rig.middle)))).toBeLessThan(
        NECK_MAX + 0.02,
      );
      box.makeEmpty();
      rig.model.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        const p = mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          box.expandByPoint(mesh.getVertexPosition(i, v3).applyMatrix4(mesh.matrixWorld));
        }
      });
      // On the ground, not in it: the walking gait lifts the model out of any sink, fading out
      // as the engine's gait (which can sink a few cm, as before) takes over.
      expect(box.min.y, `${id} ${f}`).toBeGreaterThan(floor.get(`${id} ${f}`)!);
      expect(box.min.y, `${id} ${f}`).toBeLessThan(0.05);
      expect(box.max.y).toBeLessThan(PLAYER_HEIGHT + 0.08);
    }
  });

  it("walking poses are history-free: the same frame gives the same pose, whatever came before", () => {
    const poses = [...seed3("walking"), ...seed3("changing")];
    const n = hero.n;
    for (const [id, target] of [poses[0], poses[Math.floor(poses.length / 2)], poses.at(-1)!]) {
      const j = hero.ids.indexOf(id);
      const rig = makeRig(model, PLAYER_HEIGHT / meta.height_m, extra, walk);
      const ankle = rig.model.getObjectByName("left_ankle")!;
      const at = (f: number) => {
        poseRig(rig, motion, clips, j, f, hero.dt, 0, 0, run.body[f * n + j], run.head[f * n + j]);
        rig.holder.updateMatrixWorld(true);
        const p = ankle.getWorldPosition(new THREE.Vector3());
        return [worldYaw(rig.holder), worldYaw(rig.middle), worldYaw(rig.neck), p.x, p.y, p.z];
      };
      const once = at(target);
      for (const history of [
        [target, target],
        [0, Math.max(0, target - 7), target],
        [run.frames - 1, target],
      ]) {
        let last: number[] = [];
        for (const f of history) last = at(f);
        for (let k = 0; k < 3; k++)
          expect(Math.abs(wrapAngle(last[k] - once[k]))).toBeLessThan(1e-6);
        for (let k = 3; k < 6; k++) expect(Math.abs(last[k] - once[k])).toBeLessThan(1e-6);
      }
    }
  });
});
