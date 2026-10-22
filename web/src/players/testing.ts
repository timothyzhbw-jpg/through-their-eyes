// Test helpers: the committed player models (web/public/models/) read and parsed in node, the way
// vitest runs the players' tests (vite.config.ts). Node has no WebP decoder, so `loadModel` leaves
// a model's images out (the re-skinned model's kit normal map); its nodes, skins, geometry and
// clips are parsed exactly as the app parses them.

import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

// Node's fs without @types/node.
type Fs = { readFileSync(path: URL): Uint8Array };
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } })
  .process;

export interface Glb {
  json: Record<string, unknown>;
  bin: Uint8Array;
}

/** A committed model's JSON and binary chunks. */
export function readGlb(file: string): Glb {
  const bytes = nodeProcess
    .getBuiltinModule("node:fs")
    .readFileSync(new URL(`../../public/models/${file}`, import.meta.url));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const at = 20 + jsonLen;
  const binLen = view.getUint32(at, true);
  return { json, bin: bytes.subarray(at + 8, at + 8 + binLen) };
}

/** Rebuild a GLB from its JSON and binary chunks. */
export function writeGlb({ json, bin }: Glb): ArrayBuffer {
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

/** The model without its images: the textures go, so do the materials' references to them. */
export function withoutImages({ json, bin }: Glb): Glb {
  const copy = structuredClone(json) as Record<string, unknown> & {
    materials?: Record<string, unknown>[];
  };
  for (const key of ["images", "textures", "samplers", "extensionsUsed", "extensionsRequired"])
    delete copy[key];
  for (const m of copy.materials ?? [])
    for (const slot of ["normalTexture", "occlusionTexture", "emissiveTexture"]) delete m[slot];
  return { json: copy, bin };
}

/** A committed model parsed by three.js's GLTFLoader, without its images. */
export function loadModel(file: string): Promise<GLTF> {
  return new GLTFLoader().parseAsync(writeGlb(withoutImages(readGlb(file))), "");
}
