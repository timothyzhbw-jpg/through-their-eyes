// The committed model, posed as RiggedPlayers poses it (rig.ts), on the seed-3 export: the head
// points along head_yaw, the neck stays within its limit, the feet stay on the ground, and at
// H8's pass the kick goes along the pass.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import raw from "../../public/data/hero_seed3.json";
import { parseHero, wrapAngle } from "../data/hero";
import { worldYaw } from "../views/tokens";
import { NECK_MAX } from "./look";
import { type ModelMeta, PLAYER_HEIGHT, makeRig, modelClips, poseRig, runMotion } from "./rig";

const hero = parseHero(raw);
const run = hero.runs.factual;
const DEG = Math.PI / 180;

// Node's fs without @types/node: vitest runs these tests in node (vite.config.ts).
type Fs = { readFileSync(path: URL): Uint8Array };
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } })
  .process;

async function loadModel(): Promise<GLTF> {
  const bytes = nodeProcess
    .getBuiltinModule("node:fs")
    .readFileSync(new URL("../../public/models/grf_player.glb", import.meta.url));
  const copy = new Uint8Array(bytes); // own ArrayBuffer, exactly the file
  return new GLTFLoader().parseAsync(copy.buffer, "");
}

const gltf = await loadModel();
const meta = gltf.scene.userData as ModelMeta;
const clips = modelClips(meta);
const motion = runMotion(hero, run, clips.gait);

function pose(id: string, f: number) {
  const j = hero.ids.indexOf(id);
  const rig = makeRig(gltf, PLAYER_HEIGHT / meta.height_m);
  const n = hero.n;
  const body = run.body[f * n + j];
  const head = run.head[f * n + j];
  const split = poseRig(rig, motion, clips, j, f, hero.dt, 0, 0, body, head);
  rig.holder.updateMatrixWorld(true);
  return { rig, body, head, split };
}

/** Facing of a joint: the pitch yaw of its local +x (the model faces +x). */
const yawOf = (o: THREE.Object3D) => worldYaw(o);

describe("the committed rigged player, posed on seed 3", () => {
  it("reads the clip metadata the converter wrote", () => {
    expect(clips.gait.walkSpeed).toBeCloseTo(5.25, 6);
    expect(clips.gait.sprintSpeed).toBeCloseTo(7.0, 6);
    expect(clips.gait.cycle).toBeCloseTo(0.48, 6);
    expect(clips.pass.touch).toBeCloseTo(0.35, 6);
    expect(clips.pass.kickYaw / DEG).toBeCloseTo(22.46, 1);
  });

  it("points every player's head along head_yaw with the neck within its limit", () => {
    for (const f of [20, 50, 57, 64, 70, 75, 100, 140]) {
      for (const id of hero.ids) {
        const { rig, head } = pose(id, f);
        expect(Math.abs(wrapAngle(yawOf(rig.neck) - head))).toBeLessThan(1e-3);
        expect(Math.abs(wrapAngle(yawOf(rig.neck) - yawOf(rig.middle)))).toBeLessThan(
          NECK_MAX + 0.02,
        );
      }
    }
  });

  it("H8's key scan: the head turns over the shoulder, the hips stay on body_yaw", () => {
    // Frame 58: the head is at −127°, before the turn into the pass (from ~0.3 s before the clip)
    // starts opening the hips; the scan's hold, frames 59–62, overlaps that turn since the sim's
    // head speed was calibrated (#20).
    const { rig, body, head, split } = pose("H8", 58);
    expect(wrapAngle(head - body) / DEG).toBeCloseTo(-127, 0);
    expect(Math.abs(split.hips)).toBe(0);
    expect(Math.abs(wrapAngle(yawOf(rig.holder) - body))).toBeLessThan(1e-6);
  });

  it("H8's pass: at the contact the kick goes along the pass to H9", () => {
    const pass = motion.passes[hero.ids.indexOf("H8")][0];
    const { rig, split } = pose("H8", pass.frame);
    const pelvis = rig.model.getObjectByName("body")!;
    // The model turns so that the clip's kick direction lines up with the pass (hips included).
    const kick = yawOf(rig.holder) - split.hips + clips.pass.kickYaw;
    expect(Math.abs(wrapAngle(kick - pass.yaw))).toBeLessThan(1e-6);
    console.log(
      "H8 at the pass: holder %s°, pelvis %s°, trunk %s°, head %s°, pass %s°",
      (yawOf(rig.holder) / DEG).toFixed(0),
      (yawOf(pelvis) / DEG).toFixed(0),
      (yawOf(rig.middle) / DEG).toFixed(0),
      (yawOf(rig.neck) / DEG).toFixed(0),
      (pass.yaw / DEG).toFixed(0),
    );
  });

  it("poses are history-free: the same frame gives the same pose, whatever came before", () => {
    // The mixer skips writing a bone whose animated value did not change, so the look's extra
    // trunk and neck turns must not pile up across redraws (pauses, scrubbing, idle players).
    const j = hero.ids.indexOf("H8");
    const n = hero.n;
    const rig = makeRig(gltf, PLAYER_HEIGHT / meta.height_m);
    const at = (f: number) => {
      poseRig(rig, motion, clips, j, f, hero.dt, 0, 0, run.body[f * n + j], run.head[f * n + j]);
      rig.holder.updateMatrixWorld(true);
      return [yawOf(rig.holder), yawOf(rig.middle), yawOf(rig.neck)];
    };
    const fresh = pose("H8", 75);
    const once = [yawOf(fresh.rig.holder), yawOf(fresh.rig.middle), yawOf(fresh.rig.neck)];
    for (const history of [
      [75, 75, 75],
      [57, 57, 75],
      [10, 70, 75, 75],
    ]) {
      let last: number[] = [];
      for (const f of history) last = at(f);
      for (let k = 0; k < 3; k++) expect(Math.abs(wrapAngle(last[k] - once[k]))).toBeLessThan(1e-6);
    }
  });

  it("keeps the feet on the ground through every clip", () => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const [id, frames] of [
      ["H9", [40, 50, 57, 60]], // sprinting
      ["H8", [57, 66, 70, 75, 80]], // idle, then the pass
      ["A6", [30, 90]],
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
        expect(box.min.y).toBeGreaterThan(-0.05);
        expect(box.min.y).toBeLessThan(0.15);
        expect(box.max.y).toBeLessThan(PLAYER_HEIGHT + 0.05);
      }
    }
  });
});
