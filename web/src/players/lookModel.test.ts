// The re-skinned model (SPEC 7, the default look): demo/grf/reskin.py only adds to the converted
// model, so the app's animation code must pose both exactly alike. Every bone of every rigged
// player, posed as RiggedPlayers poses it on the seed-3 export (H8's key scan, H9's run, players
// standing), has the same world matrix in both models; the clips are the same numbers; and the
// look's `_LOOK` attribute reaches three.js as a normalised `_look` on every part.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { type ModelMeta, PLAYER_HEIGHT, makeRig, modelClips, poseRig, runMotion } from "./rig";
import { loadModel, readGlb } from "./testing";

const hero = parseHero(raw);
const run = hero.runs.factual;

const base = readGlb("grf_player.glb");
const look = readGlb("grf_player_look.glb");
const v1 = await loadModel("grf_player.glb");
const v2 = await loadModel("grf_player_look.glb");

function bones(gltf: GLTF, id: string, f: number): Map<string, THREE.Matrix4> {
  const meta = gltf.scene.userData as ModelMeta;
  const clips = modelClips(meta);
  const motion = runMotion(hero, run, clips.gait);
  const j = hero.ids.indexOf(id);
  const rig = makeRig(gltf, PLAYER_HEIGHT / meta.height_m);
  const n = hero.n;
  poseRig(rig, motion, clips, j, f, hero.dt, 0, 0, run.body[f * n + j], run.head[f * n + j]);
  rig.holder.updateMatrixWorld(true);
  const out = new Map<string, THREE.Matrix4>();
  rig.model.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.set(o.name, o.matrixWorld.clone());
  });
  return out;
}

describe("the re-skinned model", () => {
  it("keeps the converted model's binary chunk as a prefix, and every accessor", () => {
    expect(look.bin.subarray(0, base.bin.length)).toEqual(base.bin);
    const keep = ["nodes", "skins", "animations", "scenes"] as const;
    for (const key of keep) {
      const a = structuredClone(base.json[key]) as unknown[];
      const b = structuredClone(look.json[key]) as Record<string, unknown>[];
      if (key === "scenes") for (const s of b) delete (s.extras as Record<string, unknown>).look;
      expect(b, key).toEqual(a);
    }
    const accessors = base.json.accessors as unknown[];
    expect((look.json.accessors as unknown[]).slice(0, accessors.length)).toEqual(accessors);
  });

  it("has the same clips, track for track and key for key", () => {
    expect(v2.animations.map((c) => c.name)).toEqual(v1.animations.map((c) => c.name));
    for (const [k, clip] of v1.animations.entries()) {
      const other = v2.animations[k];
      expect(other.duration).toBe(clip.duration);
      expect(other.tracks.map((t) => t.name)).toEqual(clip.tracks.map((t) => t.name));
      for (const [i, t] of clip.tracks.entries()) {
        expect(Array.from(other.tracks[i].times)).toEqual(Array.from(t.times));
        expect(Array.from(other.tracks[i].values)).toEqual(Array.from(t.values));
      }
    }
  });

  it("poses every bone exactly as the converted model: head turn, run, standing", () => {
    const cases: [string, number[]][] = [
      ["H8", [50, 55, 58, 62, 66, 70, 75]], // the key scan and the pass
      ["H9", [40, 60, 80, 100, 120, 139]], // the run onto the pass
      ["A1", [0, 80, 160]], // the keeper, mostly standing
      ["A4", [20, 90]],
    ];
    let compared = 0;
    for (const [id, frames] of cases) {
      for (const f of frames) {
        const a = bones(v1, id, f);
        const b = bones(v2, id, f);
        expect([...b.keys()]).toEqual([...a.keys()]);
        for (const [name, m] of a) {
          expect(Array.from(b.get(name)!.elements), `${id} f${f} ${name}`).toEqual(
            Array.from(m.elements),
          );
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  it("gives every part a normalised `_look` with one RGBA quad per vertex", () => {
    let parts = 0;
    v2.scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const a = mesh.geometry.getAttribute("_look") as THREE.BufferAttribute;
      expect(a.itemSize).toBe(4);
      expect(a.normalized).toBe(true);
      expect(a.count).toBe(mesh.geometry.getAttribute("position").count);
      parts++;
    });
    expect(parts).toBe(4);
  });

  it("puts the cloth normal map on the kit as a WebP image", () => {
    const json = look.json as {
      materials: { name: string; normalTexture?: { index: number } }[];
      textures: { extensions: { EXT_texture_webp: { source: number } } }[];
      images: { mimeType: string }[];
    };
    const kit = json.materials.find((m) => m.name === "kit")!;
    const tex = json.textures[kit.normalTexture!.index];
    expect(json.images[tex.extensions.EXT_texture_webp.source].mimeType).toBe("image/webp");
  });
});
