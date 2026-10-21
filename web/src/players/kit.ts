// Kits for the rigged players, drawn in the fictional clubs' colours (no real marks): a small
// canvas laid out like the model's kit UVs. The regions were read off the source kit template
// (a UV guide with a grid, not used itself): shirt front left half, back right half, shorts
// below each, socks bottom left. UV origin top left, as in glTF (texture.flipY = false).
// The upgraded look (`?look=v2`; the trailer paints the same with ~/tte-blender/reskin/
// kit_textures.py) adds a design: models/kit_mask.webp marks side panels (R), raglan sleeves (G)
// and trims (B) in these UVs, defined on the body in 3D so they line up across the UV seams, and
// each kit colours them.

import * as THREE from "three";
import type { ExportPlayer } from "../data/types";
import { COLORS } from "../views/scene";

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
  trim: string; // collar and number; with the design also cuffs, shorts hems and a sock band
  // The design (v2 look): null leaves that part in the garment's colour.
  panel: [string | null, string | null]; // side panels on the shirt, on the shorts
  raglan: string | null; // the sleeves and the wedge from the armpit up to the collar
  sleeve?: string; // keepers: long sleeves down to the wrist (the arms' `_LOOK` mask)
  glove?: string; // keepers: gloves
}

export const KITS: [Kit, Kit] = [
  {
    shirt: COLORS.home,
    shorts: "#1d2833",
    socks: COLORS.home,
    trim: "#ffffff",
    panel: ["#1d2833", COLORS.home],
    raglan: null,
  },
  {
    shirt: COLORS.away,
    shorts: "#eef2f6",
    socks: COLORS.away,
    trim: "#0f1d3d",
    panel: [null, COLORS.away],
    raglan: "#0f1d3d",
  },
];

/** The keepers' kits, as in the trailer's look-dev: teal and violet, clear of both teams, the
 * pitch and the reserved data colours (floodlight, detector, alert). */
export const GK_KITS: [Kit, Kit] = [
  {
    shirt: "#2ec4b6",
    shorts: "#10302d",
    socks: "#2ec4b6",
    trim: "#ffffff",
    panel: [null, "#2ec4b6"],
    raglan: "#1d9a8e",
    sleeve: "#1d9a8e",
    glove: "#e9eef0",
  },
  {
    shirt: "#c062e8",
    shorts: "#2a1638",
    socks: "#c062e8",
    trim: "#ffffff",
    panel: [null, "#c062e8"],
    raglan: "#9447bb",
    sleeve: "#9447bb",
    glove: "#e9eef0",
  },
];

/** Every kit in a fixed order, for one material per kit: home, away, home GK, away GK. */
export const ALL_KITS: Kit[] = [...KITS, ...GK_KITS];

type Wearer = Pick<ExportPlayer, "team" | "role">;

export const isKeeper = (player: Wearer) => player.role === "GK";

/** The player's index into ALL_KITS. */
export const kitSlot = (player: Wearer) => player.team + (isKeeper(player) ? 2 : 0);

/** What the player wears: his team's kit, or its keeper's kit. */
export const kitOf = (player: Wearer): Kit => ALL_KITS[kitSlot(player)];

/** Flat colours for the rest of the body, varied by player so the squad is not 22 clones. */
const SKIN = ["#e0b08c", "#c68e64", "#8d5a3b", "#f1c9a5", "#6b4128"];
const HAIR = ["#2a1d15", "#16110e", "#5a3a22", "#a07a4a", "#3b2a1f"];
export const BOOTS = "#15181b";
export const SOLE = "#c9c4b8"; // v2 look: the boots' sole edge

export function skinTone(j: number): string {
  return SKIN[(j * 3 + 1) % SKIN.length];
}

export function hairColour(j: number): string {
  return HAIR[(j * 7 + 2) % HAIR.length];
}

export const KIT_SIZE = 256;

// Garments by UV (u right, v down, both 0..1).
const inShorts = (u: number, v: number) =>
  ((u >= 0.09 && u < 0.41) || (u >= 0.59 && u < 0.91)) && v >= 0.405 && v < 0.6;
const inSocks = (u: number, v: number) => u < 0.545 && v >= 0.57 && v < 0.76;
/** The short sleeves' ends (their cuffs), on the front and back halves. */
const inCuffs = (u: number, v: number) => {
  const ur = u < 0.5 ? u : u - 0.5;
  return v < 0.15 && (ur < 0.1 || ur > 0.4);
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paint the design into `base` (RGBA, size × size, the garments already in place) from the mask
 * (RGBA, same size): R side panels, G raglan, B trims, each blended in by its coverage. A keeper's
 * long sleeves continue his short ones, so his cuffs take no trim.
 */
export function paintDesign(
  base: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  size: number,
  kit: Kit,
): void {
  const layers = [
    kit.panel[0] && rgb(kit.panel[0]),
    kit.panel[1] && rgb(kit.panel[1]),
    kit.raglan && rgb(kit.raglan),
    rgb(kit.trim),
  ];
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = 4 * (y * size + x);
      const shorts = inShorts(u, v) && !inSocks(u, v);
      const cover = [
        shorts ? 0 : mask[i],
        shorts ? mask[i] : 0,
        mask[i + 1],
        kit.sleeve && inCuffs(u, v) ? 0 : mask[i + 2],
      ];
      for (let k = 0; k < 4; k++) {
        const c = layers[k];
        if (!c || !cover[k]) continue;
        const a = cover[k] / 255;
        for (let ch = 0; ch < 3; ch++) base[i + ch] = base[i + ch] * (1 - a) + c[ch] * a;
      }
    }
  }
}

const cache = new Map<string, THREE.CanvasTexture>();

/** The player's kit texture with his shirt number; with `mask` (the v2 look), its design. */
export function kitTexture(
  player: Wearer & Pick<ExportPlayer, "number">,
  mask?: CanvasImageSource,
): THREE.CanvasTexture {
  const key = `${kitSlot(player)}:${player.number}:${mask ? "design" : "plain"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const kit = kitOf(player);
  const SIZE = KIT_SIZE;
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const c = cv.getContext("2d", { willReadFrequently: !!mask })!;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    c.fillRect(x0 * SIZE, y0 * SIZE, (x1 - x0) * SIZE, (y1 - y0) * SIZE);
  c.fillStyle = kit.shirt;
  c.fillRect(0, 0, SIZE, SIZE);
  c.fillStyle = kit.shorts;
  rect(0.09, 0.405, 0.41, 0.6);
  rect(0.59, 0.405, 0.91, 0.6);
  c.fillStyle = kit.socks;
  rect(0, 0.57, 0.545, 0.76);
  if (mask) {
    const mc = document.createElement("canvas");
    mc.width = SIZE;
    mc.height = SIZE;
    const m = mc.getContext("2d", { willReadFrequently: true })!;
    m.drawImage(mask, 0, 0, SIZE, SIZE);
    const img = c.getImageData(0, 0, SIZE, SIZE);
    paintDesign(img.data, m.getImageData(0, 0, SIZE, SIZE).data, SIZE, kit);
    c.putImageData(img, 0, 0);
    c.fillStyle = kit.trim;
  } else {
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
  }
  // Shirt number on the back.
  c.font = `700 ${0.19 * SIZE}px "Saira Condensed", "Arial Narrow", sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(String(player.number), 0.765 * SIZE, 0.23 * SIZE);
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
