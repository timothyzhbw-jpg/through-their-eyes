// The kick on the sim's passes and shots (SPEC 7), posed as RiggedPlayers poses it, at the sim's
// positions, with the 3D views' ball (kickBall): for every pass and shot of both bundled seed-3
// runs, and with TTE_KICK_EXPORTS=<dir> of every export there (hero exports and a stitched
// match, from GET /api/matches/<id>/export):
// - the kicking boot is fastest within a frame of the pass event: the contact is on it;
// - there the boot meets the ball;
// - the plant foot stays put from the plant until the kicking foot is down.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import raw from "../../public/data/hero_seed3.json";
import { type Hero, Sample, parseHero, sampleInto } from "../data/hero";
import { extraClips } from "./extra";
import {
  type ModelMeta,
  PLAYER_HEIGHT,
  type Sole,
  kickBall,
  makeRig,
  modelClips,
  poseRig,
  runMotion,
} from "./rig";
import { loadModel } from "./testing";
import { walkClips } from "./walk";

// Node's fs and env without @types/node.
type Fs = { readFileSync(path: string, enc: "utf8"): string; readdirSync(path: string): string[] };
const nodeProcess = globalThis as unknown as {
  process: { env: Record<string, string | undefined>; getBuiltinModule(id: string): Fs };
};

const model = await loadModel("grf_player.glb");
const extra = extraClips(await loadModel("anims_extra.glb"));
const walk = walkClips(await loadModel("anims_walk.glb"));
const meta = model.scene.userData as ModelMeta;
const clips = modelClips(meta, extra, walk);
const scale = PLAYER_HEIGHT / meta.height_m;
const BALL_R = 0.11;
const STEP = 0.25; // sub-frames
const RAMP = 0.05; // s, the clip's own foot lock eases in (build.py lock_feet)

function exports(): [string, Hero][] {
  const out: [string, Hero][] = [["seed 3 (bundled)", parseHero(raw)]];
  const dir = nodeProcess.process.env.TTE_KICK_EXPORTS;
  if (!dir) return out;
  const fs = nodeProcess.process.getBuiltinModule("node:fs");
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    // sim.export writes Python's NaN where a value is undefined (corner_blind_side's delta_xt).
    const text = fs.readFileSync(`${dir}/${file}`, "utf8").replace(/\bNaN\b/g, "null");
    out.push([file, parseHero(JSON.parse(text))]);
  }
  return out;
}

const point = new THREE.Vector3();

/** The centroid and every vertex of one boot, skinned as drawn. */
function boot(
  soles: Sole[],
  side: "left" | "right",
): { at: THREE.Vector3; verts: THREE.Vector3[] } {
  const verts: THREE.Vector3[] = [];
  for (const { bones, weights, points } of soles) {
    if (!bones.some((b) => b.name === `${side}_ankle`)) continue;
    const v = new THREE.Vector3();
    for (let k = 0; k < bones.length; k++) {
      v.addScaledVector(point.copy(points[k]).applyMatrix4(bones[k].matrixWorld), weights[k]);
    }
    verts.push(v);
  }
  const at = new THREE.Vector3();
  for (const v of verts) at.add(v);
  return { at: at.divideScalar(verts.length), verts };
}

interface Measured {
  name: string;
  frame: number;
  fastest: number; // sub-frame of the kicking boot's top speed
  reach: number; // m, the kicking boot's nearest vertex to the ball's centre at the event
  slide: number; // m, the plant ankle's drift while it holds
}

function measure(hero: Hero): Measured[] {
  const out: Measured[] = [];
  for (const mode of ["factual", "counterfactual"] as const) {
    const run = hero.runs[mode];
    if (mode === "counterfactual" && run === hero.runs.factual) continue;
    const motion = runMotion(hero, run, clips, scale);
    const sample = new Sample(hero.n);
    const ball: [number, number] = [0, 0];
    const rig = makeRig(model, scale, extra, walk);
    motion.kicks.forEach((kicks, j) => {
      for (const kick of kicks) {
        const pose = (f: number) => {
          sampleInto(sample, hero, run, f, false);
          poseRig(rig, motion, clips, j, f, hero.dt, sample.pos[2 * j], sample.pos[2 * j + 1],
            sample.body[j], sample.head[j]); // prettier-ignore
          rig.holder.updateMatrixWorld(true);
        };
        // The kicking boot's speed around the event, every quarter frame.
        let fastest = NaN;
        let top = -1;
        let prev: THREE.Vector3 | null = null;
        for (let f = kick.frame - 4; f <= kick.frame + 3; f += STEP) {
          pose(f);
          const now = boot(rig.soles!, "right").at;
          if (prev) {
            const v = now.distanceTo(prev) / (STEP * hero.dt);
            if (v > top) {
              top = v;
              fastest = f - STEP / 2;
            }
          }
          prev = now;
        }
        // At the event: the boot against the ball as the 3D views draw it.
        pose(kick.frame);
        sampleInto(sample, hero, run, kick.frame, false);
        kickBall(motion, kick.frame, hero.dt, ball);
        const centre = new THREE.Vector3(
          sample.ball[0] + ball[0],
          BALL_R,
          -(sample.ball[1] + ball[1]),
        );
        const reach = Math.min(...boot(rig.soles!, "right").verts.map((v) => v.distanceTo(centre)));
        // The plant ankle while the foot holds: from the plant (eased in) until the kick is down.
        const from = kick.frame + (clips.pass.plant!.time + RAMP - clips.pass.touch) / hero.dt;
        const to = kick.frame + kick.hold / hero.dt;
        const ankle = rig.model.getObjectByName("left_ankle")!;
        let slide = 0;
        let first: THREE.Vector3 | null = null;
        for (let f = Math.ceil(from / STEP) * STEP; f <= to; f += STEP) {
          pose(f);
          const at = ankle.getWorldPosition(new THREE.Vector3());
          at.y = 0;
          if (!first) first = at.clone();
          slide = Math.max(slide, at.distanceTo(first));
        }
        out.push({ name: `${mode} ${hero.ids[j]}`, frame: kick.frame, fastest, reach, slide });
      }
    });
  }
  return out;
}

describe.each(exports())("the kick on %s", (_, hero) => {
  const kicks = measure(hero);
  it("finds its passes and shots", () => {
    expect(kicks.length).toBeGreaterThan(0);
  });
  it("strikes on the pass event: the kicking boot is fastest within a frame of it", () => {
    const off = kicks.map((k) => Math.abs(k.fastest - k.frame));
    console.log(
      "%s: %d kicks, |contact - event| max %s frames",
      _,
      kicks.length,
      Math.max(...off).toFixed(2),
    );
    for (const k of kicks)
      expect(Math.abs(k.fastest - k.frame), `${k.name} @${k.frame}`).toBeLessThanOrEqual(1);
  });
  it("meets the ball with the kicking boot at the event", () => {
    const worst = Math.max(...kicks.map((k) => k.reach));
    console.log("%s: boot to ball centre at the event, worst %s m", _, worst.toFixed(3));
    for (const k of kicks) expect(k.reach, `${k.name} @${k.frame}`).toBeLessThan(BALL_R + 0.05);
  });
  it("keeps the plant foot still while it holds", () => {
    const worst = Math.max(...kicks.map((k) => k.slide));
    console.log("%s: plant foot drift, worst %s m", _, worst.toFixed(4));
    for (const k of kicks) expect(k.slide, `${k.name} @${k.frame}`).toBeLessThan(0.01);
  });
});
