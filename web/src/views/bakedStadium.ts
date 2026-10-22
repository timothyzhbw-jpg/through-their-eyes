// The baked stadium (SPEC 7): the same bowl as the procedural one (stadiumGeometry.ts), modelled
// in Blender from our own procedural scripts with its floodlight lighting and ambient occlusion
// baked in, plus a stepped terrace, a 3D crowd, lattice masts, roof trusses, a row of lamps along
// the roof's edge, a players' tunnel and dugouts. One GLB, web/public/models/stadium_baked.glb: meshopt geometry
// (decoder: meshoptimizer, MIT, bundled with three) and WebP textures.
//
// It never delays the first frame: the procedural stadium draws first, the file is fetched at low
// priority once the canvas has drawn and the page is idle, and the baked one is swapped in when it
// is ready. If it fails to load, the procedural stadium stays. It is the default except on
// Data Saver, a connection slower than 4G or a device with under 4 GB of memory;
// `?stadium=procedural` or `?stadium=baked` decides.
//
// Everything in the file but the grass is unlit: the light is in its textures and vertex colours.
// The players and the grass stay lit by the scene's lights. By material name:
// - stadium: stands and roof; map = albedo x baked light, in the scene's light units.
// - crowd: a quad per spectator; COLOR_0 = the square root of its baked colour (8 bits keep the
//   darks), alpha = its bob seed; TEXCOORD_0 picks one of four silhouettes drawn here.
// - baked_vc: masts, trusses and lamp housings, board frames, tunnel and dugouts; COLOR_0 as
//   for the crowd.
// - lamp, roof_lamp: the masts' and the roof edge's lamp faces (userData.lamp). tunnel_glow: the
//   tunnel's far end and the dugouts' canopy lights, kept dark.
// - board, ribbon: the boards and the upper tier's ribbon; our own words are drawn on them here.
// - pitch, apron: the grass, only to carry the ground's light (no colour) and show where it lies;
//   they are not drawn. The app's own grass (Ground in Stadium.tsx) keeps its markings, colour and
//   lighting, and that light shapes it (grassMaterial, groundLightFor).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createStore } from "../store/store";

export const STADIUM_URL = `${import.meta.env.BASE_URL}models/stadium_baked.glb`;

export type StadiumMode = "baked" | "procedural";
/** The baked stadium is the default (compared 2026-10-21: richer, no slower to load, same fps). */
export const DEFAULT_STADIUM: StadiumMode = "baked";

/** What the browser says about the visitor's connection and device (absent outside Chrome). */
export interface DeviceHints {
  saveData?: boolean;
  effectiveType?: string; // "slow-2g" | "2g" | "3g" | "4g"
  deviceMemory?: number; // GB, rounded down
}

/** `?stadium=` decides when given. Otherwise the baked stadium, unless the visitor saves data,
 * is on a connection slower than 4G or has under 4 GB of memory: their 0.8 MB and ~20 MB of
 * GPU memory go to the procedural stadium instead. */
export function stadiumFromSearch(search: string, hints: DeviceHints = {}): StadiumMode {
  const v = new URLSearchParams(search).get("stadium");
  if (v === "baked" || v === "procedural") return v;
  const slow = hints.effectiveType !== undefined && hints.effectiveType !== "4g";
  const small = hints.deviceMemory !== undefined && hints.deviceMemory < 4;
  return hints.saveData || slow || small ? "procedural" : DEFAULT_STADIUM;
}

/** Light stored in the ground's map is the light divided by this (headroom above the pitch). */
export const GROUND_GAIN = 2;
/** The pitch's median light in the map (the procedural scene's light on the grass, ~0.69). */
const GRASS_MEDIAN = 0.69;
/** The ground's light map spans the app's apron plane: 130 x 92 m round the centre spot. */
export const GROUND_LIGHT_EXTENT = { x: 130, y: 92 };
/** How much of the baked light's variation the grass shows (1: all of it). */
const GRASS_CONTRAST = 0.7;
export const NIGHT_LAMP = "#fff2d8";
/** The roof-edge lamps' colour, as a multiple of the lamp colour (see dress). */
export const ROOF_LAMP_LEVEL = 0.2;

export interface BakedModel {
  /** The dressed scene; every canvas shows its own clone (geometry and materials shared). */
  scene: THREE.Group;
  /** Seconds, for the crowd's bob; written by whichever canvas draws. */
  time: { value: number };
  /** The ground's baked light (glTF UVs over GROUND_LIGHT_EXTENT), or null if the file has none. */
  groundLight: THREE.Texture | null;
}

export type Status = "off" | "waiting" | "loading" | "ready" | "failed";
export const stadium = createStore<{ mode: StadiumMode; status: Status; model: BakedModel | null }>(
  { mode: modeFromUrl(), status: "off", model: null },
);

function modeFromUrl(): StadiumMode {
  try {
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
      deviceMemory?: number;
    };
    return stadiumFromSearch(window.location.search, {
      saveData: nav.connection?.saveData,
      effectiveType: nav.connection?.effectiveType,
      deviceMemory: nav.deviceMemory,
    });
  } catch {
    return DEFAULT_STADIUM;
  }
}

export interface LoadDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  parse: (buffer: ArrayBuffer) => Promise<THREE.Group>;
  textures?: () => AppTextures;
}

/** What the app draws on the file's surfaces itself (canvas textures). */
export interface AppTextures {
  words: THREE.Texture | null; // our words for the boards and the ribbon
  silhouettes: THREE.Texture; // the crowd's four spectators
}

async function parseGlb(buffer: ArrayBuffer): Promise<THREE.Group> {
  // Its own chunk, fetched only for the baked stadium.
  const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buffer, "");
  return gltf.scene;
}

const defaultDeps = (): LoadDeps => ({
  fetch: (url, init) => window.fetch(url, init),
  parse: parseGlb,
});

/** Fetch, parse and dress the stadium once; the store says how it went. */
export async function loadBakedStadium(deps: LoadDeps = defaultDeps()): Promise<void> {
  if (stadium.get().status === "loading" || stadium.get().status === "ready") return;
  stadium.set({ status: "loading" });
  try {
    const res = await deps.fetch(STADIUM_URL, { priority: "low" } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const scene = await deps.parse(await res.arrayBuffer());
    const model = dress(scene, (deps.textures ?? appTextures)());
    stadium.set({ status: "ready", model });
    mark("tte:stadium-baked");
  } catch (error) {
    console.warn("Baked stadium failed to load; keeping the procedural one.", error);
    stadium.set({ status: "failed", model: null });
  }
}

/** Call `done` once the stadium will not change any more: the baked one is in or has failed, or
 * the procedural one was asked for. Capture waits for it, so a shot films one stadium. */
export function whenStadiumSettled(done: () => void): void {
  const settled = () => {
    const s = stadium.get();
    return s.mode !== "baked" || s.status === "ready" || s.status === "failed";
  };
  if (settled()) return done();
  const off = stadium.subscribe(() => {
    if (!settled()) return;
    off();
    done();
  });
}

/** Start loading after the canvas has drawn and the page is idle (called on the first frame). */
let firstFrame = false;
export function armBakedStadium(deps?: LoadDeps): void {
  if (!firstFrame) {
    firstFrame = true;
    mark("tte:stadium-first-frame"); // for either stadium: the load-time comparison reads it
  }
  const s = stadium.get();
  if (s.mode !== "baked" || s.status !== "off") return;
  stadium.set({ status: "waiting" });
  const start = () => void loadBakedStadium(deps);
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => void })
    .requestIdleCallback;
  // A second after the first frame, then when idle: the hero's data and the players come first.
  setTimeout(() => (idle ? idle(start, { timeout: 2000 }) : start()), 1000);
}

function mark(name: string) {
  try {
    performance.mark(name);
    document.documentElement.dataset.stadium = stadium.get().status;
  } catch {
    // not in a browser
  }
}

// ---------------------------------------------------------------- dressing

/** Square the stored colour back to linear light (it was stored as its square root). Optional
 * bob for the crowd: a third of it on its own beat, like the procedural crowd. */
function vertexColourMaterial(params: THREE.MeshBasicMaterialParameters, bob?: BobUniforms) {
  const m = new THREE.MeshBasicMaterial({ ...params, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    let vs = shader.vertexShader.replace(
      "#include <color_vertex>",
      `#if defined( USE_COLOR_ALPHA )
        vColor = vec4( color.rgb * color.rgb, 1.0 );
      #elif defined( USE_COLOR )
        vColor = color.rgb * color.rgb;
      #endif`,
    );
    if (bob) {
      shader.uniforms.uTime = bob.time;
      shader.uniforms.uBob = bob.amplitude;
      vs = vs
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nuniform float uBob;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float seed = color.a;
          transformed.y += uBob * step(0.66, seed) * max(0.0, sin(uTime * (4.0 + 3.0 * seed) + 6.2832 * seed));`,
        );
    }
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => (bob ? "baked-crowd" : "baked-vc");
  return m;
}

interface BobUniforms {
  time: { value: number };
  amplitude: { value: number };
}

/** Four spectators, white on transparent, in one 4 x 1 atlas (the crowd's UVs pick one): seated,
 * seated and leaning, standing, arms up. Heads at the top (glTF UVs: v grows downwards). */
export function silhouettes(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  const W = 64;
  const H = 128;
  cv.width = 4 * W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#ffffff";
  const head = (x: number, y: number, r: number) => {
    c.beginPath();
    c.arc(x, y, r, 0, 2 * Math.PI);
    c.fill();
  };
  const body = (x: number, y: number, w: number, h: number, r: number) => {
    c.beginPath();
    c.roundRect(x, y, w, h, [r, r, 0, 0]);
    c.fill();
  };
  // Seated (0.8 m quad): head and shoulders, as the procedural crowd.
  head(32, 26, 16);
  body(6, 48, 52, 80, 22);
  // Seated, leaning to one side.
  head(W + 26, 30, 15);
  body(W + 4, 50, 50, 78, 20);
  // Standing (1.25 m quad): a smaller head, shoulders, the hint of a waist.
  head(2 * W + 32, 16, 10);
  body(2 * W + 14, 30, 36, 98, 14);
  // Arms up: standing, two raised arms.
  head(3 * W + 32, 22, 10);
  body(3 * W + 16, 36, 32, 92, 12);
  c.save();
  c.lineCap = "round";
  c.strokeStyle = "#ffffff";
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(3 * W + 20, 42);
  c.lineTo(3 * W + 8, 4);
  c.moveTo(3 * W + 44, 42);
  c.lineTo(3 * W + 56, 4);
  c.stroke();
  c.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}

/** Our own words for the boards and the ribbon: the procedural boards' texture (Stadium.tsx). */
let makeWords: (() => THREE.Texture) | null = null;
export function setBoardWords(make: () => THREE.Texture) {
  makeWords = make;
}
function appTextures(): AppTextures {
  return { words: boardWords(), silhouettes: silhouettes() };
}

function boardWords(): THREE.Texture | null {
  if (!makeWords) return null;
  const tex = makeWords();
  tex.flipY = false; // glTF UVs
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** The grass stays the procedural one, lit by the scene's lights as before (its colour, the
 * sky's tint, its sheen), and the baked light shapes it: the map's luminance over the pitch's
 * median, softened by GRASS_CONTRAST, multiplies it (its hue stays the grass's own). So the pitch looks as it did at its
 * median, with the floodlights' pools, the darker edges and the boards' glow added. The light
 * map is only read here (lightMapIntensity 0 keeps three from adding it as light). */
export function grassMaterial(
  params: THREE.MeshStandardMaterialParameters,
  lightMap: THREE.Texture,
) {
  const m = new THREE.MeshStandardMaterial({ ...params, lightMap, lightMapIntensity: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = { value: GROUND_GAIN / GRASS_MEDIAN };
    shader.uniforms.uContrast = { value: GRASS_CONTRAST };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uBake;\nuniform float uContrast;",
      )
      .replace(
        "#include <opaque_fragment>",
        `float bake = dot( texture2D( lightMap, vLightMapUv ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        outgoingLight *= pow( max( bake * uBake, 1e-3 ), uContrast );
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => "baked-grass";
  return m;
}

/** The ground's light for a plane of `width` x `height` m centred on the centre spot, as
 * three.js builds it (PlaneGeometry: u along x, v along the pitch's y): its UVs mapped onto the
 * map's (glTF: v grows toward -y), with the map spanning GROUND_LIGHT_EXTENT. */
export function groundLightFor(light: THREE.Texture, width: number, height: number) {
  const { x: W, y: H } = GROUND_LIGHT_EXTENT;
  const tex = light.clone();
  tex.channel = 0;
  tex.repeat.set(width / W, -height / H);
  tex.offset.set((W - width) / 2 / W, 1 - (H - height) / 2 / H);
  tex.needsUpdate = true;
  return tex;
}

/** Replace the file's materials by name with unlit ones (see the header). */
export function dress(scene: THREE.Group, textures: AppTextures): BakedModel {
  const time = { value: 0 };
  scene.updateMatrixWorld(true);
  const { words } = textures;
  let groundLight: THREE.Texture | null = null;
  const grass: THREE.Mesh[] = [];
  const lamp = new THREE.Color(NIGHT_LAMP).multiplyScalar(2.5);
  // The roof's lamps sit at the top of the first-person frame, behind the header and the HUD:
  // dim, so they read as lamps but stay well below the HUD text (luma about 90 against 183).
  const roofLamp = new THREE.Color(NIGHT_LAMP).multiplyScalar(ROOF_LAMP_LEVEL);
  const cache = new Map<string, THREE.Material>();
  const crowdMaps = new Map<number, THREE.Material>();
  const shared = (name: string, make: () => THREE.Material) => {
    let m = cache.get(name);
    if (!m) cache.set(name, (m = make()));
    return m;
  };
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const old = mesh.material as THREE.MeshStandardMaterial;
    const map = old.map;
    switch (old.name) {
      case "stadium":
        if (map) map.wrapS = THREE.RepeatWrapping; // the loop of the stands closes on itself
        mesh.material = shared(old.name, () => new THREE.MeshBasicMaterial({ map }));
        break;
      case "crowd": {
        // The node's scale dequantizes the positions: the bob is 9 cm in the world.
        const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld).y || 1;
        let m = crowdMaps.get(scale);
        if (!m) {
          m = vertexColourMaterial(
            { map: textures.silhouettes, alphaTest: 0.5, side: THREE.DoubleSide },
            { time, amplitude: { value: 0.09 / scale } },
          );
          crowdMaps.set(scale, m);
        }
        mesh.material = m;
        break;
      }
      case "baked_vc":
        mesh.material = shared(old.name, () => vertexColourMaterial({ side: THREE.DoubleSide }));
        break;
      case "lamp":
      case "roof_lamp":
        mesh.material = shared(old.name, () => {
          const m = new THREE.MeshBasicMaterial({
            color: old.name === "lamp" ? lamp : roofLamp,
            side: THREE.DoubleSide,
          });
          m.userData.lamp = true; // lamp faces: a high quality tier may scale them for bloom
          return m;
        });
        break;
      case "tunnel_glow":
        // Near black: the tunnel reads as a dark opening, not a flat panel or an object of interest.
        mesh.material = shared(old.name, () => new THREE.MeshBasicMaterial({ color: "#0b0e10" }));
        break;
      case "board":
      case "ribbon":
        mesh.material = shared(
          old.name,
          () =>
            new THREE.MeshBasicMaterial({
              map: words,
              color: old.name === "board" ? "#a2ada8" : "#5a625f", // text luma <= 110 and <= 50
            }),
        );
        break;
      case "pitch":
      case "apron":
        groundLight ??= map;
        grass.push(mesh);
        continue; // the material keeps the map; the mesh goes below
      default:
        break;
    }
    if (old !== mesh.material) {
      // Which part of the file it dresses, so a look can tint the baked crowd or stands
      // (MeshBasicMaterial.color multiplies the baked colour).
      (mesh.material as THREE.Material).userData.part = old.name;
      old.dispose();
    }
  }
  for (const mesh of grass) mesh.removeFromParent();
  return { scene, time, groundLight };
}
