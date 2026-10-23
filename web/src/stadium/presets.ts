// The 3D preview's three camera presets. three.js coordinates: x along the pitch, y up, z = -pitch
// y (scene.ts). A preset is a cut, never a flight: the camera jumps to it.

import type { ScreenId } from "./formats";

export const PRESET_IDS = ["bowl", "board", "tunnel"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface Preset {
  id: PresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  shows: ScreenId[]; // the screens it is framed for
}

export const PRESETS: Record<PresetId, Preset> = {
  bowl: {
    id: "bowl",
    label: "Whole bowl",
    position: [56, 23, 6],
    target: [-30, 14, -8],
    shows: ["main", "tunnel", "ribbon", "concourse-a", "concourse-b"],
  },
  board: {
    id: "board",
    label: "Main board",
    position: [-22, 22, 20],
    target: [-72, 31, 0],
    shows: ["main", "concourse-a", "concourse-b"],
  },
  tunnel: {
    id: "tunnel",
    label: "Tunnel mouth",
    position: [-13, 4, -24],
    target: [-3, 3.2, -42],
    shows: ["tunnel", "ribbon"],
  },
};

/** Pitch placement (x, y, height) to three.js coordinates. */
export const toThree = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];
