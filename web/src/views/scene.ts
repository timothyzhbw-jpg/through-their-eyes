// Shared pieces of both 3D views: colours, the pitch-to-three.js mapping, canvas textures, and
// the hook that redraws a view when playback state changes.

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import type { Store } from "../store/store";

export const COLORS = {
  bg: "#0b1210",
  fg: "#e6eee9",
  muted: "#8ea39a",
  home: "#ff7a5c",
  away: "#5b86ff",
  sight: "#a6ecff",
  gold: "#ffd36b",
  white: "#ffffff",
};

export const teamColor = (team: number) => (team === 0 ? COLORS.home : COLORS.away);

// Pitch (x, y) in metres maps to three.js (x, height, -y): y is up and the pitch lies in XZ.
export const PITCH = { length: 105, width: 68, halfLength: 52.5, halfWidth: 34 };
/** What the tactical board shows: the pitch plus a 3 m apron, centred on the centre spot. */
export const BOARD_EXTENT = { x: 111, y: 74 };

/** CSS pixels per metre on a tactical board of this size (the orthographic camera's zoom). */
export function boardZoom(width: number, height: number): number {
  return Math.max(1e-3, Math.min(width / BOARD_EXTENT.x, height / BOARD_EXTENT.y));
}

/** Pitch markings drawn once into a canvas texture (20 px per metre). */
let pitchTexture: THREE.CanvasTexture | null = null;
export function getPitchTexture(): THREE.CanvasTexture {
  if (pitchTexture) return pitchTexture;
  const s = 20;
  const cv = document.createElement("canvas");
  cv.width = PITCH.length * s;
  cv.height = PITCH.width * s;
  const c = cv.getContext("2d")!;
  for (let k = 0; k < 14; k++) {
    c.fillStyle = k % 2 ? "#1f4a32" : "#245638";
    c.fillRect(k * 7.5 * s, 0, 7.5 * s + 1, PITCH.width * s);
  }
  const X = (x: number) => (x + PITCH.halfLength) * s;
  const Y = (y: number) => (PITCH.halfWidth - y) * s;
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.fillStyle = "rgba(255,255,255,0.85)";
  c.lineWidth = 0.12 * s;
  c.strokeRect(X(-52.5) + 2, Y(34) + 2, PITCH.length * s - 4, PITCH.width * s - 4);
  c.beginPath();
  c.moveTo(X(0), Y(34));
  c.lineTo(X(0), Y(-34));
  c.stroke();
  c.beginPath();
  c.arc(X(0), Y(0), 9.15 * s, 0, 2 * Math.PI);
  c.stroke();
  for (const g of [-1, 1]) {
    const gx = g * PITCH.halfLength;
    c.strokeRect(Math.min(X(gx), X(gx - g * 16.5)), Y(20.16), 16.5 * s, 40.32 * s);
    c.strokeRect(Math.min(X(gx), X(gx - g * 5.5)), Y(9.16), 5.5 * s, 18.32 * s);
    c.beginPath();
    c.arc(X(gx - g * 11), Y(0), 0.25 * s, 0, 2 * Math.PI);
    c.fill();
  }
  pitchTexture = new THREE.CanvasTexture(cv);
  pitchTexture.colorSpace = THREE.SRGBColorSpace;
  pitchTexture.anisotropy = 8;
  return pitchTexture;
}

export interface LabelStyle {
  color: string;
  font: string;
  outline?: string; // dark stroke behind the text
  width?: number; // canvas px; the plane showing it should have the same aspect ratio
  height?: number;
}

export const LABEL = {
  shirt: {
    font: '700 84px "IBM Plex Mono", ui-monospace, monospace',
    outline: "rgba(11,18,16,0.85)",
  },
  token: { font: '700 92px "IBM Plex Mono", ui-monospace, monospace' },
  name: {
    // Wide enough for a short name ("J. Ferriday", data/roster.ts), centred.
    font: '700 78px "Saira Condensed", "Arial Narrow", sans-serif',
    outline: "rgba(11,18,16,0.85)",
    width: 512,
    height: 96,
  },
  tag: {
    font: '600 66px "Saira Condensed", "Arial Narrow", sans-serif',
    outline: "rgba(11,18,16,0.92)",
    width: 512,
    height: 96,
  },
} satisfies Record<string, Omit<LabelStyle, "color">>;

/** A text texture (shirt number, name, tag), cached by content and style. */
const labels = new Map<string, THREE.CanvasTexture>();
export function getLabelTexture(text: string, style: LabelStyle): THREE.CanvasTexture {
  const { color, font, outline, width = 128, height = 128 } = style;
  const key = [text, color, font, outline, width, height].join("|");
  const hit = labels.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const c = cv.getContext("2d")!;
  c.font = font;
  c.textAlign = "center";
  c.textBaseline = "middle";
  const y = height * 0.53;
  if (outline) {
    c.lineWidth = 10;
    c.lineJoin = "round";
    c.strokeStyle = outline;
    c.strokeText(text, width / 2, y);
  }
  c.fillStyle = color;
  c.fillText(text, width / 2, y);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  labels.set(key, tex);
  return tex;
}

/** Re-render this canvas whenever the store changes (the canvases use frameloop="demand"). */
export function useRedrawOn<T>(store: Store<T>): void {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => store.subscribe(() => invalidate()), [store, invalidate]);
}
