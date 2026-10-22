// Camera switches are clean cuts (SPEC 7; Bowen, 2026-10-21: "切镜头别模糊了"): no camera move
// between cameras, and no blur pass on the frames around a cut.

import { describe, expect, it } from "vitest";
import { CUT_GUARD_FRAMES, CUT_GUARD_S, CUT_RAMP_S, CutWatch, viewKey } from "./cut";

// Vitest stubs CSS imports, so read the stylesheets from disk.
type Fs = {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string, o: { recursive: true }): string[];
};
const nodeProcess = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): Fs; cwd(): string } }
).process;
const fs = nodeProcess.getBuiltinModule("node:fs");
const src = `${nodeProcess.cwd()}/src`;

const view = (camera: string, focus = "split") => viewKey({ camera, focus });

describe("cuts", () => {
  /** Draw frames of `view` every `dt` s from `from` up to `to`, as the 3D view does. */
  const draw = (cuts: CutWatch, v: string, from: number, to: number, dt = 1 / 60) => {
    for (let t = from; t <= to + 1e-9; t += dt) cuts.note(v, t);
  };

  it("a switch of camera is a cut: blur is off for the guard, then eases back", () => {
    const cuts = new CutWatch();
    cuts.note(view("pov"), 10);
    expect(cuts.blurScale(10)).toBe(1); // the first frame is no cut
    cuts.note(view("broadcast"), 11);
    expect(cuts.inCut(11)).toBe(true);
    expect(cuts.blurScale(11)).toBe(0);
    draw(cuts, view("broadcast"), 11 + 1 / 60, 11 + CUT_GUARD_S - 0.01);
    expect(cuts.blurScale(11 + CUT_GUARD_S - 0.01)).toBe(0);
    draw(cuts, view("broadcast"), 11 + CUT_GUARD_S, 11 + CUT_GUARD_S + CUT_RAMP_S / 2);
    const mid = cuts.blurScale(11 + CUT_GUARD_S + CUT_RAMP_S / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(cuts.blurScale(11 + CUT_GUARD_S + CUT_RAMP_S)).toBe(1);
    expect(cuts.inCut(11 + CUT_GUARD_S + CUT_RAMP_S)).toBe(false);
  });

  it("slow frames: the first frames after a cut are sharp however long each one takes", () => {
    // A software renderer (the CI runner's SwiftShader) or a struggling phone: 0.4 s a frame,
    // longer than the whole guard. Time alone would let the second frame blur.
    const cuts = new CutWatch();
    cuts.note(view("pov"), 0);
    let t = 1;
    cuts.note(view("broadcast"), t);
    for (let k = 0; k < CUT_GUARD_FRAMES; k++) {
      if (k > 0) cuts.note(view("broadcast"), t);
      expect(cuts.blurScale(t), `frame ${k} after the cut`).toBe(0);
      t += 0.4;
    }
    cuts.note(view("broadcast"), t);
    expect(cuts.blurScale(t)).toBe(1); // then the blur is back, at once: the time has long passed
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
    // At 60 fps the frames are a small part of the time guard.
    expect(CUT_GUARD_FRAMES / 60).toBeLessThan(CUT_GUARD_S / 2);
  });

  it("no stylesheet blurs the page: text rises in by opacity and position only (LOOKDEV 2b)", () => {
    const sheets = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith(".css"));
    expect(sheets).toContain("styles.css");
    for (const sheet of sheets) {
      const css = fs.readFileSync(`${src}/${sheet}`, "utf8");
      // A frosted panel's static backdrop-filter stays; a filter blur on the page does not.
      const blurs = css.match(/(?<![-\w])filter\s*:[^;}]*blur\(/g) ?? [];
      expect(blurs, sheet).toEqual([]);
    }
    const styles = fs.readFileSync(`${src}/styles.css`, "utf8");
    for (const name of ["tt-rise", "tt-cap"]) {
      const frames = styles.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`))![0];
      expect(frames).toContain("opacity");
      expect(frames).toContain("transform");
    }
  });
});
