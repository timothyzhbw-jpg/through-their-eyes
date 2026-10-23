// The stadium's screens (Stadium Screen Studio): five LED surfaces in the formats a matchday
// screen crew works with — the main video board, a tall LED at the players' tunnel, the ribbon
// along the upper tier and two concourse screens. Each has one canvas (its render target) of a
// fixed size, and a place in the 3D bowl (pitch metres, as stadiumGeometry.ts; heights above the
// grass). The 3D preview and the flat Screen wall show the same canvases.

export const SCREEN_IDS = ["main", "tunnel", "ribbon", "concourse-a", "concourse-b"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export type ScreenShape = "wide" | "tall" | "ribbon"; // 16:9, 9:32, 40:1

export interface Placement {
  x: number; // pitch m: the screen's centre
  y: number;
  z: number; // m above the grass: the screen's centre
  yaw: number; // three.js rotation about the vertical: 0 faces pitch -y, +π/2 faces pitch +x
  width: number; // m
  mount?: number; // m: the roof it stands on, for its legs
}

export interface ScreenFormat {
  id: ScreenId;
  label: string;
  where: string; // where it is in the bowl, in words
  aspect: [number, number]; // width : height
  shape: ScreenShape;
  canvas: { width: number; height: number }; // px of its render target
  placement: Placement;
}

/** Height of a screen of `width` m with `aspect`. */
export const heightOf = (f: Pick<ScreenFormat, "aspect">, width: number): number =>
  (width * f.aspect[1]) / f.aspect[0];

// Bowl landmarks (stadiumGeometry.ts and the baked model): the front of the stands at x = ±62,
// y = ±42; the upper tier's fascia 9 m behind the front, 8.4–10.2 m up; the roof from 3 m (27 m up)
// to 23 m (24.5 m) behind it; the players' tunnel at the halfway line of the far stand
// (y = +42), 6.4 m wide.
export const SCREENS: readonly ScreenFormat[] = [
  {
    id: "main",
    label: "Main video board",
    where: "on the roof of the left end stand",
    aspect: [16, 9],
    shape: "wide",
    canvas: { width: 1280, height: 720 },
    placement: { x: -72, y: 0, z: 34, yaw: Math.PI / 2, width: 24, mount: 26.1 },
  },
  {
    id: "tunnel",
    label: "Tunnel LED",
    where: "beside the players' tunnel, far side",
    aspect: [9, 32],
    shape: "tall",
    canvas: { width: 360, height: 1280 },
    placement: { x: -4.7, y: 41.8, z: 2.25, yaw: 0, width: 1.2 },
  },
  {
    id: "ribbon",
    label: "Ribbon board",
    where: "along the far stand's upper tier",
    aspect: [40, 1],
    shape: "ribbon",
    canvas: { width: 2560, height: 64 },
    placement: { x: 0, y: 50.9, z: 9.3, yaw: 0, width: 52 },
  },
  {
    id: "concourse-a",
    label: "Concourse screen A",
    where: "under the left end's roof, standing in for the concourse",
    aspect: [16, 9],
    shape: "wide",
    canvas: { width: 960, height: 540 },
    placement: { x: -70, y: 16, z: 19, yaw: Math.PI / 2, width: 8 },
  },
  {
    id: "concourse-b",
    label: "Concourse screen B",
    where: "under the left end's roof, standing in for the concourse",
    aspect: [16, 9],
    shape: "wide",
    canvas: { width: 960, height: 540 },
    placement: { x: -70, y: -16, z: 19, yaw: Math.PI / 2, width: 8 },
  },
];

export const screenOf = (id: ScreenId): ScreenFormat => SCREENS.find((s) => s.id === id)!;
