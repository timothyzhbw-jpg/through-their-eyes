// The shot the capture page is filming, shared by the React tree and the capture API.
// render() writes it and then advance() draws one frame; the camera and the post chain read it
// inside that frame, so a shot takes effect without waiting for a React render.

import type { ViewSession } from "../session";
import type { CineShot, Vec3 } from "./shot";

export interface DrawnPose {
  eye: Vec3;
  look: Vec3;
  fov: number;
}

export const cineRuntime: {
  shot: CineShot | null;
  t: number;
  blurSigma: number;
  drawn: DrawnPose | null;
} = {
  shot: null,
  t: 0,
  blurSigma: 0,
  drawn: null,
};

let view: ViewSession | null = null;

export function bindView(next: ViewSession): void {
  view = next;
}

export function requireView(): ViewSession {
  if (!view) throw new Error("cine is not mounted");
  return view;
}

type ShotListener = (shot: CineShot) => void;
let shotListener: ShotListener | null = null;

/** The letterbox subscribes during render, so load() can flush the bars before it returns. */
export function onShot(listener: ShotListener | null): void {
  shotListener = listener;
}

export function publishShot(shot: CineShot): void {
  cineRuntime.shot = shot;
  shotListener?.(shot);
}
