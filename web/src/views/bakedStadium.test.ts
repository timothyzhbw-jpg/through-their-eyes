// The baked stadium (SPEC 7): the file is within its budget and in the formats the app decodes,
// its geometry sits where the app's own stadium is (stadiumGeometry.ts, pitch coordinates mapped
// to three.js as (x, height, -y)), it loads after the first frame, and the procedural stadium
// stays when it cannot load.

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armBakedStadium,
  dress,
  groundLightFor,
  loadBakedStadium,
  stadium,
  stadiumFromSearch,
  STADIUM_URL,
} from "./bakedStadium";
import { PITCH } from "./scene";
import { BOARDS, FLOODLIGHTS, PROFILE, setback } from "./stadiumGeometry";

const FILE = fileURLToPath(new URL("../../public/models/stadium_baked.glb", import.meta.url));
const BUDGET = 3_000_000; // bytes on the wire: the static site serves the file as it is

// ---------------------------------------------------------------- a minimal GLB reader

interface Gltf {
  json: {
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    images?: { bufferView: number; mimeType: string }[];
    materials: { name: string }[];
    meshes: {
      primitives: { attributes: Record<string, number>; indices?: number; material: number }[];
    }[];
    nodes: {
      mesh?: number;
      children?: number[];
      matrix?: number[];
      translation?: number[];
      rotation?: number[];
      scale?: number[];
    }[];
    scenes: { nodes: number[] }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
      normalized?: boolean;
      count: number;
      type: string;
    }[];
    bufferViews: {
      buffer: number;
      byteOffset?: number;
      byteLength: number;
      byteStride?: number;
      extensions?: Record<string, MeshoptView>;
    }[];
  };
  bin: Uint8Array;
}
interface MeshoptView {
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
  filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL";
}

function readGlb(bytes: Uint8Array): Gltf {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  let at = 12;
  let json: Gltf["json"] | null = null;
  let bin: Uint8Array = new Uint8Array();
  while (at < bytes.byteLength) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) bin = chunk;
    at += 8 + length;
  }
  return { json: json!, bin };
}

const decoded = new Map<number, Uint8Array>();
function bufferView(g: Gltf, k: number): Uint8Array {
  const cached = decoded.get(k);
  if (cached) return cached;
  const bv = g.json.bufferViews[k];
  const ext = bv.extensions?.EXT_meshopt_compression ?? bv.extensions?.KHR_meshopt_compression;
  let out: Uint8Array;
  if (ext) {
    const source = g.bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, source, ext.mode, ext.filter);
  } else {
    out = g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  }
  decoded.set(k, out);
  return out;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS: Record<number, [new (b: ArrayBuffer) => ArrayLike<number>, number, number]> = {
  5120: [Int8Array, 1, 127],
  5121: [Uint8Array, 1, 255],
  5122: [Int16Array, 2, 32767],
  5123: [Uint16Array, 2, 65535],
  5125: [Uint32Array, 4, 4294967295],
  5126: [Float32Array, 4, 1],
};

/** An accessor's values, element by element (normalized integers mapped to [0, 1] or [-1, 1]). */
function accessor(g: Gltf, k: number): number[][] {
  const a = g.json.accessors[k];
  const data = bufferView(g, a.bufferView);
  const stride =
    g.json.bufferViews[a.bufferView].extensions?.EXT_meshopt_compression?.byteStride ??
    g.json.bufferViews[a.bufferView].byteStride;
  const [Array_, size, max] = ARRAYS[a.componentType];
  const n = COMPONENTS[a.type];
  const out: number[][] = [];
  const step = stride ?? n * size;
  for (let i = 0; i < a.count; i++) {
    const start = data.byteOffset + (a.byteOffset ?? 0) + i * step;
    const copy = data.buffer.slice(start, start + n * size) as ArrayBuffer;
    const values = Array.from(new Array_(copy));
    out.push(a.normalized ? values.map((v) => Math.max(v / max, -1)) : values);
  }
  return out;
}

/** World positions (three.js frame) of every primitive, by material name. */
function positionsByMaterial(g: Gltf): Map<string, THREE.Vector3[]> {
  const out = new Map<string, THREE.Vector3[]>();
  const visit = (k: number, parent: THREE.Matrix4) => {
    const node = g.json.nodes[k];
    const local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else
      local.compose(
        new THREE.Vector3(...((node.translation ?? [0, 0, 0]) as [number, number, number])),
        new THREE.Quaternion(
          ...((node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]),
        ),
        new THREE.Vector3(...((node.scale ?? [1, 1, 1]) as [number, number, number])),
      );
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const p of g.json.meshes[node.mesh].primitives) {
        const name = g.json.materials[p.material].name;
        const list = out.get(name) ?? [];
        for (const v of accessor(g, p.attributes.POSITION))
          list.push(new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(world));
        out.set(name, list);
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const k of g.json.scenes[0].nodes) visit(k, new THREE.Matrix4());
  return out;
}

/** Triangles of every primitive of one material, as world positions. */
function triangles(g: Gltf, material: string): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  const visit = (k: number, parent: THREE.Matrix4) => {
    const node = g.json.nodes[k];
    const local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else
      local.compose(
        new THREE.Vector3(...((node.translation ?? [0, 0, 0]) as [number, number, number])),
        new THREE.Quaternion(
          ...((node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]),
        ),
        new THREE.Vector3(...((node.scale ?? [1, 1, 1]) as [number, number, number])),
      );
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const p of g.json.meshes[node.mesh].primitives) {
        if (g.json.materials[p.material].name !== material || p.indices === undefined) continue;
        const pos = accessor(g, p.attributes.POSITION).map((v) =>
          new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(world),
        );
        const idx = accessor(g, p.indices).map((v) => v[0]);
        for (let i = 0; i + 2 < idx.length; i += 3)
          out.push([pos[idx[i]], pos[idx[i + 1]], pos[idx[i + 2]]]);
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const k of g.json.scenes[0].nodes) visit(k, new THREE.Matrix4());
  return out;
}

/** A three.js point back in pitch coordinates: (x, y, height). */
const pitch = (v: THREE.Vector3) => ({ x: v.x, y: -v.z, h: v.y });

// ---------------------------------------------------------------- the file

describe("the baked stadium's file", () => {
  let g: Gltf;
  let byMaterial: Map<string, THREE.Vector3[]>;
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    g = readGlb(new Uint8Array(readFileSync(FILE)));
    byMaterial = positionsByMaterial(g);
  });

  it("stays within its budget, meshopt-compressed, with WebP textures", () => {
    expect(statSync(FILE).size).toBeLessThanOrEqual(BUDGET);
    expect(g.json.extensionsRequired).toEqual(
      expect.arrayContaining(["EXT_meshopt_compression", "EXT_texture_webp"]),
    );
    expect(g.json.images?.length).toBeGreaterThan(0);
    for (const image of g.json.images ?? []) {
      expect(image.mimeType).toBe("image/webp");
      const bytes = g.bin.subarray(
        g.json.bufferViews[image.bufferView].byteOffset ?? 0,
        (g.json.bufferViews[image.bufferView].byteOffset ?? 0) + 12,
      );
      expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
    }
  });

  it("has every part the app dresses, by material name", () => {
    for (const name of [
      "stadium",
      "crowd",
      "baked_vc",
      "lamp",
      "strip",
      "board",
      "ribbon",
      "pitch",
      "apron",
    ])
      expect(byMaterial.get(name)?.length, name).toBeGreaterThan(0);
  });

  it("lays the pitch exactly over the app's: 105 x 68 m at the centre spot, on the grass", () => {
    const pts = byMaterial.get("pitch")!.map(pitch);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-PITCH.halfLength, 1);
    expect(Math.max(...xs)).toBeCloseTo(PITCH.halfLength, 1);
    expect(Math.min(...ys)).toBeCloseTo(-PITCH.halfWidth, 1);
    expect(Math.max(...ys)).toBeCloseTo(PITCH.halfWidth, 1);
    for (const p of pts) expect(Math.abs(p.h)).toBeLessThan(0.01);
  });

  it("maps the grass's light onto the app's own pitch plane as the file's pitch reads it", () => {
    // The file's pitch carries the light map's UVs (TEXCOORD_1); groundLightFor must give the
    // app's PlaneGeometry (u along x, v along y, from the corner at -x, -y) the same ones.
    const node = g.json.nodes.find((n) => n.mesh !== undefined)!;
    const world = new THREE.Matrix4().compose(
      new THREE.Vector3(...((node.translation ?? [0, 0, 0]) as [number, number, number])),
      new THREE.Quaternion(),
      new THREE.Vector3(...((node.scale ?? [1, 1, 1]) as [number, number, number])),
    );
    const prim = g.json.meshes
      .flatMap((m) => m.primitives)
      .find((p) => g.json.materials[p.material].name === "pitch")!;
    const pos = accessor(g, prim.attributes.POSITION);
    const uv1 = accessor(g, prim.attributes.TEXCOORD_1);
    const tex = groundLightFor(new THREE.Texture(), PITCH.length, PITCH.width);
    tex.updateMatrix();
    pos.forEach((v, i) => {
      const p = pitch(new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(world));
      const uv = new THREE.Vector2(
        (p.x + PITCH.halfLength) / PITCH.length,
        (p.y + PITCH.halfWidth) / PITCH.width,
      ).applyMatrix3(tex.matrix);
      expect(uv.x).toBeCloseTo(uv1[i][0], 3);
      expect(uv.y).toBeCloseTo(uv1[i][1], 3);
    });
  });

  it("builds the stands on the app's bowl: from its front to the back wall, never higher", () => {
    const pts = byMaterial.get("stadium")!.map(pitch);
    const back = PROFILE[PROFILE.length - 1][0];
    let front = 0;
    for (const p of pts) {
      const d = setback(p.x, p.y);
      expect(d).toBeGreaterThan(-0.05);
      expect(d).toBeLessThan(back + 0.05);
      expect(p.h).toBeGreaterThan(-0.05);
      expect(p.h).toBeLessThan(28.5); // the roof's top
      if (Math.abs(d) < 0.05 && p.h < 0.05) front++;
    }
    expect(front).toBeGreaterThan(40); // the front wall stands on the grass all round
  });

  it("seats every spectator on one of the app's two rakes (the seats of stadiumGeometry.ts)", () => {
    const tris = triangles(g, "crowd");
    expect(tris.length).toBeGreaterThan(2 * 12000);
    // The rakes, as the seats of stadiumGeometry.ts use them: the tiers overlap at 9.6-10.4 m.
    const rake = ([d0, h0]: readonly number[], [d1, h1]: readonly number[], d: number) =>
      h0 + ((h1 - h0) * (d - d0)) / (d1 - d0);
    const tiers = [
      { from: 0.5, to: 10.5, at: (d: number) => rake(PROFILE[1], PROFILE[2], d) },
      { from: 9.5, to: 20.7, at: (d: number) => rake(PROFILE[5], PROFILE[6], d) },
    ];
    for (const tri of tris) {
      const low = tri.map(pitch).reduce((a, b) => (b.h < a.h ? b : a));
      const d = setback(low.x, low.y);
      // The quad stands 12 cm below the rake under its seat, as the procedural crowd does.
      const off = Math.min(
        ...tiers
          .filter((t) => d >= t.from && d <= t.to)
          .map((t) => Math.abs(low.h - (t.at(d) - 0.12))),
      );
      expect(off).toBeLessThan(0.05);
    }
  });

  it("puts a lamp bank on each of the app's four masts, at their height", () => {
    const pts = byMaterial.get("lamp")!.map(pitch);
    const perMast = FLOODLIGHTS.map(() => 0);
    for (const p of pts) {
      const k = FLOODLIGHTS.findIndex((m) => Math.hypot(p.x - m.x, p.y - m.y) < 8);
      expect(k).toBeGreaterThanOrEqual(0);
      perMast[k]++;
      expect(Math.abs(p.h - FLOODLIGHTS[k].height)).toBeLessThan(4);
    }
    for (const n of perMast) expect(n).toBeGreaterThan(0);
  });

  it("runs the boards where the app's are: 4 m beyond the touchlines, 5.5 m behind the goals", () => {
    for (const v of byMaterial.get("board")!) {
      const p = pitch(v);
      const onTouchline =
        Math.abs(Math.abs(p.y) - BOARDS.touchline.y) < 0.01 &&
        Math.abs(p.x) <= BOARDS.touchline.halfLength + 0.01;
      const onGoalLine =
        Math.abs(Math.abs(p.x) - BOARDS.goalLine.x) < 0.01 &&
        Math.abs(p.y) <= BOARDS.goalLine.halfLength + 0.01;
      expect(onTouchline || onGoalLine).toBe(true);
      expect(p.h).toBeGreaterThan(-0.01);
      expect(p.h).toBeLessThan(BOARDS.height + 0.01);
    }
  });
});

// ---------------------------------------------------------------- loading and the fallback

vi.mock("./scene", async (original) => ({
  ...(await original<typeof import("./scene")>()),
  getPitchTexture: () => new THREE.Texture(),
}));

const textures = () => ({
  words: new THREE.Texture(),
  silhouettes: new THREE.Texture(),
});

function fakeScene(): THREE.Group {
  const scene = new THREE.Group();
  for (const name of ["stadium", "crowd", "baked_vc", "lamp", "board", "pitch", "apron"]) {
    const material = new THREE.MeshStandardMaterial({ name });
    if (name === "stadium" || name === "pitch" || name === "apron")
      material.map = new THREE.Texture();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  }
  return scene;
}

describe("loading the baked stadium", () => {
  beforeEach(() => stadium.set({ mode: "baked", status: "off", model: null }));

  it("is picked by ?stadium=, the procedural one being the default for now", () => {
    expect(stadiumFromSearch("?stadium=baked")).toBe("baked");
    expect(stadiumFromSearch("?stadium=procedural")).toBe("procedural");
    expect(stadiumFromSearch("?stadium=nonsense")).toBe(stadiumFromSearch(""));
  });

  it("waits for the first frame, then a second and an idle moment, at low priority", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => new Response(new ArrayBuffer(8)));
      armBakedStadium({ fetch, parse: async () => fakeScene(), textures });
      expect(stadium.get().status).toBe("waiting");
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledWith(STADIUM_URL, { priority: "low" });
      await vi.runAllTimersAsync();
      expect(stadium.get().status).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is never fetched when the procedural stadium is asked for", () => {
    stadium.set({ mode: "procedural" });
    const fetch = vi.fn();
    armBakedStadium({ fetch, parse: async () => fakeScene() });
    expect(stadium.get().status).toBe("off");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the procedural stadium when the file is missing or broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadBakedStadium({
      fetch: async () => new Response("no", { status: 404 }),
      parse: async () => fakeScene(),
    });
    expect(stadium.get()).toMatchObject({ status: "failed", model: null });
    stadium.set({ status: "off" });
    await loadBakedStadium({
      fetch: async () => new Response(new ArrayBuffer(8)),
      parse: async () => {
        throw new Error("not a glTF");
      },
    });
    expect(stadium.get()).toMatchObject({ status: "failed", model: null });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("dresses every part unlit, and keeps the grass's light for the app's own grass", () => {
    const scene = fakeScene();
    const light = (scene.children[5] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const model = dress(scene, textures());
    const meshes: THREE.Mesh[] = [];
    model.scene.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    expect(meshes).toHaveLength(5); // the pitch and the apron are not drawn
    for (const m of meshes) expect(m.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(meshes[0].material).toMatchObject({ map: expect.any(THREE.Texture) }); // the stands
    expect(meshes[1].material).toMatchObject({ vertexColors: true, alphaTest: 0.5 }); // crowd
    expect(model.groundLight).toBe(light.map);
  });
});
