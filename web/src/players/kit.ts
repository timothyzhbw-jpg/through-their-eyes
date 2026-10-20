// Kits for the rigged players, drawn in the fictional clubs' colours (no real marks): a small
// canvas laid out like the model's kit UVs. The regions were read off the source kit template
// (a UV guide with a grid, not used itself): shirt front left half, back right half, shorts
// below each, socks bottom left. UV origin top left, as in glTF (texture.flipY = false).

import * as THREE from "three";
import { COLORS } from "../views/scene";

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
  trim: string; // collar and number
}

export const KITS: [Kit, Kit] = [
  { shirt: COLORS.home, shorts: "#1d2833", socks: COLORS.home, trim: "#ffffff" },
  { shirt: COLORS.away, shorts: "#eef2f6", socks: COLORS.away, trim: "#0f1d3d" },
];

/** Flat colours for the rest of the body, varied by player so the squad is not 22 clones. */
const SKIN = ["#e0b08c", "#c68e64", "#8d5a3b", "#f1c9a5", "#6b4128"];
const HAIR = ["#2a1d15", "#16110e", "#5a3a22", "#a07a4a", "#3b2a1f"];
export const BOOTS = "#15181b";

export function skinTone(j: number): string {
  return SKIN[(j * 3 + 1) % SKIN.length];
}

export function hairColour(j: number): string {
  return HAIR[(j * 7 + 2) % HAIR.length];
}

const SIZE = 256;
const cache = new Map<string, THREE.CanvasTexture>();

export function kitTexture(team: 0 | 1, number: number): THREE.CanvasTexture {
  const key = `${team}:${number}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const kit = KITS[team];
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const c = cv.getContext("2d")!;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    c.fillRect(x0 * SIZE, y0 * SIZE, (x1 - x0) * SIZE, (y1 - y0) * SIZE);
  c.fillStyle = kit.shirt;
  c.fillRect(0, 0, SIZE, SIZE);
  c.fillStyle = kit.shorts;
  rect(0.09, 0.405, 0.41, 0.6);
  rect(0.59, 0.405, 0.91, 0.6);
  c.fillStyle = kit.socks;
  rect(0, 0.57, 0.545, 0.76);
  // Sock tops and collars in the trim colour.
  c.fillStyle = kit.trim;
  rect(0, 0.57, 0.545, 0.59);
  c.beginPath();
  c.moveTo(0.2 * SIZE, 0);
  c.lineTo(0.3 * SIZE, 0);
  c.lineTo(0.25 * SIZE, 0.055 * SIZE);
  c.closePath();
  c.fill();
  rect(0.7, 0, 0.8, 0.02);
  // Shirt number on the back.
  c.font = `700 ${0.19 * SIZE}px "Saira Condensed", "Arial Narrow", sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(String(number), 0.765 * SIZE, 0.23 * SIZE);
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
