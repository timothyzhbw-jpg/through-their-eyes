import { describe, expect, it } from "vitest";
import { BOWL, PROFILE, roofHeight, setback } from "../views/stadiumGeometry";
import { heightOf, SCREENS, screenOf } from "./formats";

describe("screen formats", () => {
  it("has the five screens in their formats", () => {
    expect(SCREENS.map((s) => [s.id, s.aspect, s.shape])).toEqual([
      ["main", [16, 9], "wide"],
      ["tunnel", [9, 32], "tall"],
      ["ribbon", [40, 1], "ribbon"],
      ["concourse-a", [16, 9], "wide"],
      ["concourse-b", [16, 9], "wide"],
    ]);
  });

  it("sizes each render target to its aspect, within a texture's limits", () => {
    for (const s of SCREENS) {
      const { width, height } = s.canvas;
      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(width / height).toBeCloseTo(s.aspect[0] / s.aspect[1], 2);
      expect(Math.max(width, height)).toBeLessThanOrEqual(4096);
      // Enough pixels for text: the short side at least 64 px.
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(64);
    }
  });

  it("places each screen where it would be in the bowl", () => {
    const main = screenOf("main");
    const mh = heightOf(main, main.placement.width);
    const d = setback(main.placement.x, main.placement.y);
    // Above the left end stand's roof, facing the pitch (+x).
    expect(main.placement.x).toBeLessThan(-BOWL.halfX);
    expect(main.placement.z - mh / 2).toBeGreaterThan(roofHeight(d)!);
    expect(main.placement.yaw).toBeCloseTo(Math.PI / 2);

    // The ribbon on the far stand's upper-tier fascia, just in front of it.
    const ribbon = screenOf("ribbon");
    const rh = heightOf(ribbon, ribbon.placement.width);
    const fascia = PROFILE[4][0];
    expect(setback(ribbon.placement.x, ribbon.placement.y)).toBeLessThan(fascia);
    expect(setback(ribbon.placement.x, ribbon.placement.y)).toBeGreaterThan(fascia - 0.3);
    expect(ribbon.placement.z - rh / 2).toBeGreaterThanOrEqual(PROFILE[4][1]);
    expect(ribbon.placement.z + rh / 2).toBeLessThanOrEqual(PROFILE[5][1]);
    // Along the straight of the far stand.
    expect(ribbon.placement.width / 2).toBeLessThanOrEqual(BOWL.halfX - BOWL.radius);

    // The tunnel LED beside the tunnel's mouth (6.4 m wide, at x = 0 on the far side), on the
    // ground, in front of the stand.
    const tunnel = screenOf("tunnel");
    const th = heightOf(tunnel, tunnel.placement.width);
    expect(Math.abs(tunnel.placement.x) - tunnel.placement.width / 2).toBeGreaterThan(3.2);
    expect(Math.abs(tunnel.placement.x)).toBeLessThan(8);
    expect(tunnel.placement.z - th / 2).toBeGreaterThanOrEqual(0); // on a low plinth
    expect(tunnel.placement.z - th / 2).toBeLessThan(0.3);
    expect(setback(tunnel.placement.x, tunnel.placement.y)).toBeLessThan(0);
    expect(tunnel.placement.y).toBeGreaterThan(38); // behind the advertising boards

    // The main board stands on the roof.
    expect(main.placement.mount).toBeCloseTo(roofHeight(d)!, 1);

    // The concourse pair hangs under the left end's roof, in front of the upper tier, facing in.
    for (const id of ["concourse-a", "concourse-b"] as const) {
      const c = screenOf(id);
      const ch = heightOf(c, c.placement.width);
      const cd = setback(c.placement.x, c.placement.y);
      expect(cd).toBeLessThan(PROFILE[4][0]); // in front of the upper tier's fascia
      expect(c.placement.z + ch / 2).toBeLessThan(roofHeight(cd)!);
      expect(c.placement.z - ch / 2).toBeGreaterThan(PROFILE[5][1]);
      expect(c.placement.yaw).toBeCloseTo(Math.PI / 2);
    }

    // Nothing over the pitch.
    for (const s of SCREENS) {
      expect(Math.abs(s.placement.x) > 52.5 || Math.abs(s.placement.y) > 34).toBe(true);
    }
  });
});
