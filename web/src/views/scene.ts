// Shared pieces of both 3D views: colours, the pitch-to-three.js mapping, canvas textures, and
// the hook that redraws a view when playback state changes.

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import type { Store } from "../store/store";
import { FIELD, LAW1 } from "./fieldMarkings";

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
export const PITCH = {
  length: LAW1.length,
  width: LAW1.width,
  halfLength: FIELD.halfLength,
  halfWidth: FIELD.halfWidth,
};
/** What the tactical board shows: the pitch plus a 3 m apron, centred on the centre spot. */
export const BOARD_EXTENT = { x: 111, y: 74 };

/** CSS pixels per metre on a tactical board of this size (the orthographic camera's zoom). */
export function boardZoom(width: number, height: number): number {
  return Math.max(1e-3, Math.min(width / BOARD_EXTENT.x, height / BOARD_EXTENT.y));
}

/** Pitch markings drawn once into a canvas texture (20 px per metre), by Law 1 (fieldMarkings). */
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
  const L = FIELD.halfLength;
  const W = FIELD.halfWidth;
  // A line belongs to the area it bounds: the outer edges of the touchlines and goal lines are
  // the edge of the field, so each line is drawn half its width inside its coordinate.
  const half = LAW1.lineWidth / 2;
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.fillStyle = "rgba(255,255,255,0.85)";
  c.lineWidth = LAW1.lineWidth * s;
  c.strokeRect(
    X(-L + half),
    Y(W - half),
    (PITCH.length - LAW1.lineWidth) * s,
    (PITCH.width - LAW1.lineWidth) * s,
  );
  c.beginPath();
  c.moveTo(X(0), Y(W));
  c.lineTo(X(0), Y(-W));
  c.stroke();
  c.beginPath();
  c.arc(X(0), Y(0), LAW1.centreCircle * s, 0, 2 * Math.PI);
  c.stroke();
  const dot = (x: number, y: number) => {
    c.beginPath();
    c.arc(X(x), Y(y), 0.12 * s, 0, 2 * Math.PI);
    c.fill();
  };
  dot(0, 0); // the centre mark
  for (const g of [-1, 1]) {
    const gx = g * L;
    const box = (depth: number, halfWidth: number) =>
      c.strokeRect(Math.min(X(gx), X(gx - g * depth)), Y(halfWidth), depth * s, 2 * halfWidth * s);
    box(LAW1.penaltyAreaDepth, FIELD.penaltyAreaHalfWidth);
    box(LAW1.goalAreaDepth, FIELD.goalAreaHalfWidth);
    const mark = gx - g * LAW1.penaltyMark;
    dot(mark, 0);
    // The penalty arc, outside the penalty area, facing the centre of the field. On the canvas
    // the y axis points down, so the angle is measured on mirrored y.
    const facing = g > 0 ? Math.PI : 0;
    c.beginPath();
    c.arc(
      X(mark),
      Y(0),
      LAW1.penaltyArc * s,
      facing - FIELD.penaltyArcHalfAngle,
      facing + FIELD.penaltyArcHalfAngle,
    );
    c.stroke();
    // A quarter circle of 1 m in each corner, inside the field.
    for (const h of [-1, 1]) {
      const toCentre = Math.atan2(h, -g); // canvas angle toward the field from corner (gx, h·W)
      c.beginPath();
      c.arc(X(gx), Y(h * W), LAW1.cornerArc * s, toCentre - Math.PI / 4, toCentre + Math.PI / 4);
      c.stroke();
    }
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
    font: '700 78px "Saira Condensed", "Arial Narrow", sans-serif',
    outline: "rgba(11,18,16,0.85)",
    width: 192,
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
