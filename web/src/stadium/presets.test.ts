import { describe, expect, it } from "vitest";
import { screenOf } from "./formats";
import { PRESET_IDS, PRESETS, toThree } from "./presets";

describe("camera presets", () => {
  it("has three, each above the grass", () => {
    expect(PRESET_IDS).toHaveLength(3);
    for (const id of PRESET_IDS) expect(PRESETS[id].position[1]).toBeGreaterThan(1);
  });

  it("films the face of every screen it is framed for, not its back", () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      for (const screen of p.shows) {
        const { x, y, z, yaw } = screenOf(screen).placement;
        const at = toThree(x, y, z);
        // A plane's front faces +z, turned by yaw about the vertical.
        const normal = [Math.sin(yaw), 0, Math.cos(yaw)];
        const toCamera = p.position.map((c, k) => c - at[k]);
        const facing = normal.reduce((s, n, k) => s + n * toCamera[k], 0);
        expect(facing, `${id} on ${screen}`).toBeGreaterThan(0);
        // And the screen is ahead of the camera, within its view's half-angle (about 50°).
        const look = p.target.map((c, k) => c - p.position[k]);
        const toScreen = at.map((c, k) => c - p.position[k]);
        const cos =
          look.reduce((s, v, k) => s + v * toScreen[k], 0) /
          (Math.hypot(...look) * Math.hypot(...toScreen));
        expect(cos, `${id} on ${screen}`).toBeGreaterThan(Math.cos((50 * Math.PI) / 180));
      }
    }
  });
});
