// Camera switches are clean cuts (SPEC 7; Bowen, 2026-10-21: "切镜头别模糊了"): no camera move
// between cameras, and no blur pass on the frames around a cut.

import { describe, expect, it } from "vitest";
import { CUT_GUARD_S, CUT_RAMP_S, CutWatch, viewKey } from "./cut";

const view = (camera: string, focus = "split") => viewKey({ camera, focus });

describe("cuts", () => {
  it("a switch of camera is a cut: blur is off for the guard, then eases back", () => {
    const cuts = new CutWatch();
    cuts.note(view("pov"), 10);
    expect(cuts.blurScale(10)).toBe(1); // the first frame is no cut
    cuts.note(view("broadcast"), 11);
    expect(cuts.inCut(11)).toBe(true);
    expect(cuts.blurScale(11)).toBe(0);
    expect(cuts.blurScale(11 + CUT_GUARD_S - 0.01)).toBe(0);
    const mid = cuts.blurScale(11 + CUT_GUARD_S + CUT_RAMP_S / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(cuts.blurScale(11 + CUT_GUARD_S + CUT_RAMP_S)).toBe(1);
    expect(cuts.inCut(11 + CUT_GUARD_S + CUT_RAMP_S)).toBe(false);
  });

  it("so does a switch of the view in front (the tactical board and back)", () => {
    const cuts = new CutWatch();
    cuts.note(view("pov", "split"), 5);
    cuts.note(view("pov", "tactical"), 6);
    expect(cuts.blurScale(6.1)).toBe(0);
  });

  it("a frame with the same view is no cut, however far the playhead moved", () => {
    const cuts = new CutWatch();
    cuts.note(view("pov"), 1);
    cuts.note(view("pov"), 2);
    cuts.note(view("pov"), 2.01);
    expect(cuts.blurScale(2.01)).toBe(1);
  });

  it("the guard is short: a cut, not a transition", () => {
    expect(CUT_GUARD_S + CUT_RAMP_S).toBeLessThanOrEqual(0.6);
  });
});
