// Academy drill (SPEC 7): a free look, turned live, becomes one cell of the precomputed look grid.
// Any turn maps to the nearest cell (time × direction), the physical scan range is respected, and
// the countdown is the moment's own time to the reception. Both bundled grids are checked raw.

import { describe, expect, it } from "vitest";
import blindSide from "../../public/data/look_seed3.json";
import pressEscape from "../../public/data/look_press_escape_seed0.json";
import {
  chase,
  clampHead,
  countdown,
  HEAD_SPEED_DEG_S,
  lookAngle,
  NO_LOOK_DEG,
  SCAN_MAX_DEG,
  SCAN_MIN_DEG,
  snapDirection,
  snapTurn,
  type Grid,
} from "./snap";

const grids: [string, Grid & { reception: number; window: number[] }][] = [
  ["blind_side_run seed 3", blindSide as never],
  ["press_escape seed 0", pressEscape as never],
];
const DT = 0.04;

describe("the physical scan range", () => {
  it("is the sim's: a scan turns 70-150 degrees from the ball", () => {
    expect([SCAN_MIN_DEG, SCAN_MAX_DEG]).toEqual([70, 150]);
    expect(HEAD_SPEED_DEG_S).toBe(404); // the sim's mean peak scan speed (SPEC 3.4)
  });

  it("clamps the live head to 150 degrees either side", () => {
    expect(clampHead(0)).toBe(0);
    expect(clampHead(120)).toBe(120);
    expect(clampHead(200)).toBe(150);
    expect(clampHead(-500)).toBe(-150);
  });

  it("counts a turn as a look only past half the shortest scan, then clamps it into the range", () => {
    expect(lookAngle(0)).toBeNull();
    expect(lookAngle(NO_LOOK_DEG - 0.1)).toBeNull();
    expect(lookAngle(-(NO_LOOK_DEG - 0.1))).toBeNull();
    expect(lookAngle(NO_LOOK_DEG)).toBe(70);
    expect(lookAngle(-50)).toBe(-70);
    expect(lookAngle(118)).toBe(118);
    expect(lookAngle(-149)).toBe(-149);
    expect(lookAngle(150)).toBe(150);
  });

  it("chases the target no faster than a scan turns", () => {
    const step = HEAD_SPEED_DEG_S * 0.04; // one frame of match time
    expect(chase(0, 150, step)).toBeCloseTo(step);
    expect(chase(10, 12, step)).toBe(12);
    expect(chase(-100, 0, step)).toBeCloseTo(-100 + step);
  });
});

describe.each(grids)("snapping on the %s grid", (_, grid) => {
  it("has directions on both sides inside the scan range", () => {
    for (const o of grid.offsets) {
      expect(Math.abs(o)).toBeGreaterThanOrEqual(SCAN_MIN_DEG);
      expect(Math.abs(o)).toBeLessThanOrEqual(SCAN_MAX_DEG);
    }
    expect(grid.offsets.some((o) => o > 0) && grid.offsets.some((o) => o < 0)).toBe(true);
  });

  it("maps any direction to the nearest grid direction on its side, ties to the wider look", () => {
    for (let deg = -150; deg <= 150; deg += 0.5) {
      if (Math.abs(deg) < SCAN_MIN_DEG) continue;
      const snapped = snapDirection(grid, deg);
      expect(Math.sign(snapped)).toBe(Math.sign(deg));
      const best = Math.min(
        ...grid.offsets
          .filter((o) => Math.sign(o) === Math.sign(deg))
          .map((o) => Math.abs(o - deg)),
      );
      expect(Math.abs(snapped - deg)).toBeCloseTo(best, 9);
    }
    // 120 degrees is as far from 90 as from 150: over his shoulder, as the grid's labels say.
    expect(snapDirection(grid, 120)).toBe(150);
    expect(snapDirection(grid, -120)).toBe(-150);
    expect(snapDirection(grid, 119.5)).toBe(90);
    expect(snapDirection(grid, -119.5)).toBe(-90);
  });

  it("maps any turn to the nearest cell: the time it started, the widest it went", () => {
    const [from] = grid.window;
    for (let start = from; start <= grid.reception; start += 0.25) {
      for (let peak = -150; peak <= 150; peak += 2.5) {
        const cell = snapTurn(grid, { start, peak });
        if (Math.abs(peak) < NO_LOOK_DEG) {
          expect(cell).toBeNull();
          continue;
        }
        expect(cell).not.toBeNull();
        const gap = Math.min(...grid.frames.map((f) => Math.abs(f - start)));
        expect(Math.abs(cell!.frame - start)).toBe(gap);
        expect(grid.frames).toContain(cell!.frame);
        expect(cell!.offset).toBe(snapDirection(grid, lookAngle(peak)!));
        const raw = grid.cells.find((c) => c.frame === cell!.frame && c.offset === cell!.offset);
        expect(raw?.unavailable).toBeNull();
      }
    }
  });

  it("puts a turn before the grid's first time on its first cell, and halfway ties earlier", () => {
    const first = grid.frames[0];
    expect(snapTurn(grid, { start: grid.window[0], peak: 140 })!.frame).toBe(first);
    const [a, b] = grid.frames;
    expect(snapTurn(grid, { start: (a + b) / 2, peak: 140 })!.frame).toBe(a);
  });

  it("counts down the moment's own time to the reception, in tenths, reaching 0 there", () => {
    const [from] = grid.window;
    const left = (grid.reception - from) * DT; // from the pass to him
    expect(countdown(grid.reception, from, DT)).toBeGreaterThanOrEqual(left - 1e-9);
    expect(countdown(grid.reception, from, DT) - left).toBeLessThan(0.1);
    expect(countdown(grid.reception, grid.reception, DT)).toBe(0);
    expect(countdown(grid.reception, grid.reception + 3, DT)).toBe(0);
    expect(countdown(grid.reception, grid.reception - 10, DT)).toBeCloseTo(0.4, 9);
    // between frames it shows the tenth not yet reached
    expect(countdown(grid.reception, grid.reception - 10.5, DT)).toBeCloseTo(0.5, 9);
  });
});

describe("a grid cell that cannot start", () => {
  it("is skipped for the nearest cell in time that can, in the same direction", () => {
    const grid: Grid = {
      frames: [20, 30, 40],
      offsets: [90, 150, -150, -90],
      cells: [20, 30, 40].flatMap((frame) =>
        [90, 150, -150, -90].map((offset) => ({
          frame,
          offset,
          unavailable: frame === 30 && offset === 150 ? "a scan is under way" : null,
        })),
      ),
    };
    expect(snapTurn(grid, { start: 31, peak: 140 })).toEqual({ frame: 40, offset: 150 });
    expect(snapTurn(grid, { start: 29, peak: 140 })).toEqual({ frame: 20, offset: 150 });
    expect(snapTurn(grid, { start: 30, peak: -140 })).toEqual({ frame: 30, offset: -150 });
  });
});
