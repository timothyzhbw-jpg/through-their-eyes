// "Take his eyes" (SPEC 3.7, 7): the bundled look grid of the scan hero, parsed and spliced into
// runs the views can play. The file is sim.export.export_looks (tests/test_committed_exports.py
// keeps it current).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import lookJson from "../../public/data/look_seed3.json";
import { parseHero } from "../data/hero";
import { heroMoment } from "../plan/moment";
import { LANGUAGES } from "../whatif/whatif";
import {
  aroundHim,
  broughtIntoSight,
  cellAt,
  lookRun,
  parseLooks,
  secondsBefore,
  snapFrame,
  snapOffset,
  startingCell,
  whereLabel,
  callLabel,
} from "./looks";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const looks = parseLooks(lookJson, hero, moment);
const n = hero.n;
const me = hero.hero;

describe("the look grid", () => {
  it("is the moment's: every 0.4 s from the pass to the reception, four directions round him", () => {
    expect(looks.heroId).toBe("H8");
    expect(looks.frames).toEqual([20, 30, 40, 50, 60, 70]);
    expect(looks.frames.map((f) => secondsBefore(looks, f, hero.dt))).toEqual([
      2, 1.6, 1.2, 0.8, 0.4, 0,
    ]);
    expect(looks.offsets).toEqual([90, 150, -150, -90]);
    expect(looks.cells).toHaveLength(24);
    expect(looks.cells.every((c) => c.unavailable === null && c.entry)).toBe(true);
  });

  it("refuses a file for another moment or another schema", () => {
    const other = { ...(lookJson as object), moment: "m:other" };
    expect(() => parseLooks(other, hero, moment)).toThrow(/not/);
    expect(() => parseLooks({ ...(lookJson as object), version: 9 }, hero, moment)).toThrow(
      /version/,
    );
  });

  it("every look airs only lines that pass the checks, in en and zh", () => {
    for (const entry of [looks.noLook, ...looks.cells.map((c) => c.entry!)]) {
      expect(entry.errors, entry.id).toEqual([]);
      for (const lang of LANGUAGES) {
        const narration = entry.answers[lang]!;
        expect(narration.lines.length, `${entry.id} ${lang}`).toBeGreaterThan(0);
        expect(narration.withheld).toEqual([]);
        expect(narration.fixture).toBe(false);
      }
    }
  });

  it("snaps a time and a direction to the grid, round the circle", () => {
    expect(snapFrame(looks, 47)).toBe(50);
    expect(snapFrame(looks, 3)).toBe(20);
    expect(snapOffset(looks, -128)).toBe(-150);
    expect(snapOffset(looks, 170)).toBe(150);
    expect(snapOffset(looks, -175)).toBe(-150);
    expect(snapOffset(looks, 5)).toBe(90); // nearer +90 than -90? both 85 degrees: the first
    expect(snapOffset(looks, -60)).toBe(-90);
    expect(aroundHim(looks)).toEqual([90, 150, -150, -90]);
    expect(whereLabel(-150)).toBe("Over his right shoulder");
    expect(whereLabel(90)).toBe("To his left");
    expect(callLabel("shot:far")).toBe("Shoot at the far post");
    expect(callLabel("pass:H9")).toBe("Pass to H9");
  });

  it("starts from his own look: over his right shoulder, when he really looked", () => {
    expect(looks.ownLooks.map((l) => l.id)).toEqual(["scan:H8:0050"]);
    expect(startingCell(looks)).toEqual({ frame: 50, offset: -150 });
  });

  it("shows how the grid splits: his own look finds the runner, the other way does not", () => {
    expect(looks.factual.chosen).toBe("pass:H9");
    expect(looks.noLook.decision.chosen).toBe("pass:H4");
    expect(cellAt(looks, 50, -150)!.entry!.decision.chosen).toBe("pass:H9");
    expect(cellAt(looks, 50, 90)!.entry!.decision.chosen).toBe("pass:H4");
    expect(cellAt(looks, 70, -150)!.entry!.decision.chosen).toBe("pass:H4"); // too late
    expect(broughtIntoSight(hero, looks, cellAt(looks, 50, -150)!.entry!)).toContain("H9");
    expect(broughtIntoSight(hero, looks, looks.noLook)).toEqual([]);
  });
});

describe("a look's run", () => {
  const entry = cellAt(looks, 50, -150)!.entry!;
  const run = lookRun(hero, looks, entry);
  const fac = hero.runs.factual;
  const [start, end] = looks.window;

  it("is the factual run up to his decision, with his head, sight and belief spliced in", () => {
    expect(run.frames).toBe(end + 1);
    expect(run.pos).toEqual(fac.pos.slice(0, (end + 1) * 2 * n));
    expect(run.ball).toEqual(fac.ball.slice(0, (end + 1) * 2));
    for (let f = 0; f <= end; f++) {
      for (let j = 0; j < n; j++) {
        const head = run.head[f * n + j];
        if (j === me && f >= start) expect(head).toBeCloseTo(entry.head[f - start], 6);
        else expect(head).toBe(fac.head[f * n + j]);
      }
      if (f >= start) expect(run.seenBy[f * n + me]).toBe(entry.seen[f - start]);
    }
    expect(run.ghost.slice(0, start * 2 * n)).toEqual(fac.ghost.slice(0, start * 2 * n));
    expect(run.ghost.slice(start * 2 * n)).toEqual(entry.ghost);
    expect(run.decision?.chosen).toBe("pass:H9");
  });

  it("has his look as its one scan in the window and none of his own", () => {
    const his = run.scans.filter((s) => s.player === "H8" && s.start >= start);
    expect(his.map((s) => [s.id, s.key])).toEqual([["scan:H8:0050", true]]);
    expect(run.events.find((e) => e.id === "scan:H8:0050")!.attrs.added).toBe(true);
    const noLook = lookRun(hero, looks, looks.noLook);
    expect(noLook.scans.filter((s) => s.player === "H8" && s.start >= start)).toEqual([]);
  });

  it("believes the runner where he is once he has seen him, and far off with no look", () => {
    const runner = hero.ids.indexOf("H9");
    const at = (r: typeof run, f: number) => [
      r.ghost[(f * n + runner) * 2] - fac.pos[(f * n + runner) * 2],
      r.ghost[(f * n + runner) * 2 + 1] - fac.pos[(f * n + runner) * 2 + 1],
    ];
    const off = (r: typeof run) => Math.hypot(...(at(r, end) as [number, number]));
    expect(off(run)).toBeLessThan(1);
    expect(off(lookRun(hero, looks, looks.noLook))).toBeGreaterThan(5);
  });

  it("goes on after the decision as its own run: the players on the ball, the rest as factual", () => {
    const after = entry.after;
    expect(after.start).toBe(end);
    const runner = hero.ids.indexOf("H9");
    const k = 10;
    const f = end + k;
    const other = hero.ids.indexOf("A1");
    expect(after.pos[(k * n + other) * 2]).toBe(fac.pos[(f * n + other) * 2]);
    expect(after.events.some((e) => e.type === "pass" && e.attrs.to === "H9")).toBe(true);
    expect(Number.isFinite(after.pos[(k * n + runner) * 2])).toBe(true);
  });
});
