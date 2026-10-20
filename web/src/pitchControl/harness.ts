// Test page for the pitch-control shader: draws the tactical board's material and mesh with
// three.js in a real browser and hands the pixels back (pitchControl.gpu.test.ts), or times it
// (scripts/fps.mjs).

import * as THREE from "three";
import { PITCH } from "../views/scene";
import {
  ControlInputs,
  createPitchControlMaterial,
  createPitchControlMesh,
  MAX_PER_TEAM,
  setControlInputs,
} from "./pitchControl";

/** One team: a row of [x, y, vx, vy] per player, m and m/s. */
export type Rows = number[][];

export interface Overlay {
  pixels: number[]; // RGBA bytes at 1 px per m, rows from -y like the grid
  background: number[]; // RGBA bytes of the pitch green under the overlay
}

export interface Harness {
  /** P(home controls) at the centre of every 1 m cell, x fastest from (-x, -y). */
  control(home: Rows, away: Rows): number[];
  /** The board's colour ramp over the pitch green, 1 px per m. */
  overlay(home: Rows, away: Rows): Overlay;
  /** Milliseconds per draw of the colour ramp over a width x height canvas, GPU work included. */
  bench(home: Rows, away: Rows, width: number, height: number, draws: number): number;
}

declare global {
  interface Window {
    pitchControlHarness?: Harness;
  }
}

const NX = PITCH.length; // 1 px per m: pixel centres are the backend grid's cell centres
const NY = PITCH.width;
const GREEN = "#245638"; // a stripe of the pitch texture (scene.ts)

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(NX, NY, false);
renderer.setClearColor(GREEN, 1);
const gl = renderer.getContext();

// The tactical board's camera (TacticalView): straight down, screen up = pitch +y, here framing
// the pitch exactly. Rows of the image then run from -y to +y, columns from -x to +x.
const camera = new THREE.OrthographicCamera(
  -PITCH.halfLength,
  PITCH.halfLength,
  PITCH.halfWidth,
  -PITCH.halfWidth,
  1,
  300,
);
camera.up.set(0, 0, -1);
camera.position.set(0, 100, 0);
camera.lookAt(0, 0, 0);

function sceneWith(material: THREE.ShaderMaterial): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(createPitchControlMesh(material));
  return scene;
}

const raw = createPitchControlMaterial({ raw: true });
const ramp = createPitchControlMaterial();
const rawScene = sceneWith(raw);
const rampScene = sceneWith(ramp);
const empty = new THREE.Scene();
const target = new THREE.WebGLRenderTarget(NX, NY, {
  type: THREE.FloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
});

function pack(home: Rows, away: Rows): ControlInputs {
  const inputs = new ControlInputs();
  for (const [rows, out] of [
    [home, inputs.home],
    [away, inputs.away],
  ] as const) {
    if (rows.length > MAX_PER_TEAM) throw new Error(`${rows.length} players in a team`);
    rows.forEach((row, i) => out.set(row, 4 * i));
  }
  inputs.homeCount = home.length;
  inputs.awayCount = away.length;
  return inputs;
}

window.pitchControlHarness = {
  control(home, away) {
    setControlInputs(raw, pack(home, away));
    renderer.setRenderTarget(target);
    renderer.render(rawScene, camera);
    const rgba = new Float32Array(4 * NX * NY);
    renderer.readRenderTargetPixels(target, 0, 0, NX, NY, rgba);
    renderer.setRenderTarget(null);
    return Array.from({ length: NX * NY }, (_, k) => rgba[4 * k]);
  },

  overlay(home, away) {
    renderer.setRenderTarget(null);
    renderer.render(empty, camera); // just the pitch green, cleared as the overlay's render clears
    const background = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, background);
    setControlInputs(ramp, pack(home, away));
    renderer.render(rampScene, camera);
    const pixels = new Uint8Array(4 * NX * NY);
    gl.readPixels(0, 0, NX, NY, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), background: Array.from(background) };
  },

  bench(home, away, width, height, draws) {
    const pixel = new Uint8Array(4);
    const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    renderer.setRenderTarget(null);
    renderer.setSize(width, height, false);
    setControlInputs(ramp, pack(home, away));
    renderer.render(rampScene, camera);
    finish(); // compiled and warm
    const start = performance.now();
    for (let i = 0; i < draws; i++) renderer.render(rampScene, camera);
    finish(); // readPixels waits for the GPU
    const ms = (performance.now() - start) / draws;
    renderer.setSize(NX, NY, false);
    return ms;
  },
};
