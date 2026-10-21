// The re-skinned model (SPEC 7, the default look): demo/grf/reskin.py only adds to the converted
// model, so the app's animation code must pose both exactly alike. Every bone of every rigged
// player, posed as RiggedPlayers poses it on the seed-3 export (H8's key scan, H9's run, players
// standing), has the same world matrix in both models; the clips are the same numbers; and the
// look's `_LOOK` attribute reaches three.js as a normalised `_look` on every part.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { type ModelMeta, PLAYER_HEIGHT, makeRig, modelClips, poseRig, runMotion } from "./rig";

const hero = parseHero(raw);
const run = hero.runs.factual;

// Node's fs without @types/node: vitest runs these tests in node (vite.config.ts).
type Fs = { readFileSync(path: URL): Uint8Array };
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } })
  .process;

function readGlb(name: string): { json: Record<string, unknown>; bin: Uint8Array } {
  const bytes = nodeProcess
    .getBuiltinModule("node:fs")
    .readFileSync(new URL(`../../public/models/${name}`, import.meta.url));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const at = 20 + jsonLen;
  const binLen = view.getUint32(at, true);
  return { json, bin: bytes.subarray(at + 8, at + 8 + binLen) };
}

/** Rebuild a GLB from its JSON and binary chunk. */
function glb(json: Record<string, unknown>, bin: Uint8Array): ArrayBuffer {
  let doc = new TextEncoder().encode(JSON.stringify(json));
  const pad = (-doc.length & 3) as number;
  if (pad) doc = new Uint8Array([...doc, ...new Array(pad).fill(0x20)]);
  const binPad = -bin.length & 3;
  const total = 12 + 8 + doc.length + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); // "glTF"
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, doc.length, true);
  v.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(doc, 20);
  const at = 20 + doc.length;
  v.setUint32(at, bin.length + binPad, true);
  v.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
  out.set(bin, at + 8);
  return out.buffer;
}

const base = readGlb("grf_player.glb");
const look = readGlb("grf_player_look.glb");

/** The look model without its image (node has no WebP decoder; the image is not geometry). */
function lookWithoutImages(): ArrayBuffer {
  const json = structuredClone(look.json) as Record<string, unknown> & {
    materials: Record<string, unknown>[];
  };
  for (const key of ["images", "textures", "samplers", "extensionsUsed", "extensionsRequired"])
    delete json[key];
  for (const m of json.materials) delete m.normalTexture;
  return glb(json, look.bin);
}

const parse = (buffer: ArrayBuffer): Promise<GLTF> => new GLTFLoader().parseAsync(buffer, "");
const v1 = await parse(glb(base.json, base.bin));
const v2 = await parse(lookWithoutImages());

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
