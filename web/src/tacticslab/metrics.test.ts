// The Tactics lab's metrics, on real exports from public/data: the blind-side hero's passes, the
// pressure hero's forced runs (interceptions and a tackle) and the far-post hero's shot, plus the
// bundled xT grid. Expected values are worked out here from the definitions, not read from the code.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import withoutLook from "../../public/data/without_look_seed3.json";
import pressWhatIf from "../../public/data/whatif_press_escape_seed0.json";
import shotWhatIf from "../../public/data/whatif_far_post_finish_seed11.json";
import type { ExportEvent } from "../data/types";
import {
  PRESS_ZONE_FROM,
  distanceXg,
  parseXtGrid,
  pressMetrics,
  progression,
  regains,
  shotQuality,
  teamOf,
  xtAt,
} from "./metrics";

const grid = parseXtGrid(withoutLook.xt);
const heroEvents = raw.runs.factual.events as unknown as ExportEvent[];

const optionEvents = (file: { options: { action: string }[] }, action: string): ExportEvent[] =>
  (file.options.find((o) => o.action === action) as unknown as { events: ExportEvent[] }).events;

describe("xG", () => {
  it("is the sim's distance model: 0.35 at 6 m, capped at 0.6, falling with distance", () => {
    expect(distanceXg(6)).toBeCloseTo(0.35, 12);
    expect(distanceXg(0)).toBe(0.6);
    expect(distanceXg(13)).toBeCloseTo(0.35 * Math.exp(-1), 12);
    expect(distanceXg(30)).toBeLessThan(distanceXg(20));
  });

  it("scores the far-post hero's real shot from where it was kicked", () => {
    // H9 kicked from (40.5573, -4.9987) at the goal whose centre is (52.5, 0).
    const d = Math.hypot(52.5 - 40.5573, -4.9987);
    const shots = shotQuality(optionEvents(shotWhatIf, "shot:near"), 0);
    expect(shots.shots).toBe(1);
    expect(shots.list[0].player).toBe("H9");
    expect(shots.list[0].distance).toBeCloseTo(d, 9);
    expect(shots.xg).toBeCloseTo(0.35 * Math.exp(-(d - 6) / 7), 9);
    expect(shots.perShot).toBeCloseTo(shots.xg, 12);
    expect(shotQuality(optionEvents(shotWhatIf, "shot:near"), 1)).toMatchObject({
      shots: 0,
      xg: 0,
      perShot: null,
    });
  });

  it("aims the away team's shot at the goal on the other side", () => {
    const e = {
      id: "shot:A9:0001",
      type: "shot",
      frame: 1,
      player: "A9",
      attrs: { start: [-40, 0] },
    } as unknown as ExportEvent;
    expect(shotQuality([e], 1).list[0].distance).toBeCloseTo(12.5, 12);
    expect(shotQuality([e], 0).shots).toBe(0);
  });
});

describe("xT grid", () => {
  it("reads the bundled grid in 1e-4 units and refuses another unit", () => {
    expect(grid.cols).toBe(16);
    expect(grid.rows).toBe(12);
    expect(grid.grid[15 * 12 + 4]).toBeCloseTo(2216e-4, 12); // the last column, as shipped
    expect(() => parseXtGrid({ ...withoutLook.xt, units: "1" })).toThrow(/units/);
  });

  it("is the cell's value at a cell centre, and mirrors for the team attacking -x", () => {
    const cx = (3 + 0.5) * (105 / 16) - 52.5;
    const cy = (5 + 0.5) * (68 / 12) - 34;
    expect(xtAt(grid, [cx, cy], 0)).toBeCloseTo(grid.grid[3 * 12 + 5], 12);
    expect(xtAt(grid, [-cx, -cy], 1)).toBeCloseTo(xtAt(grid, [cx, cy], 0), 12);
  });

  it("rises toward the goal a team attacks", () => {
    expect(xtAt(grid, [45, 0], 0)).toBeGreaterThan(xtAt(grid, [-30, 0], 0));
    expect(xtAt(grid, [-45, 0], 1)).toBeGreaterThan(xtAt(grid, [30, 0], 1));
  });
});

describe("progression, on the blind-side hero's two passes", () => {
  const home = progression(heroEvents, 0, grid);

  it("counts the passes and what they added in xT", () => {
    expect(home.passes).toBe(2);
    expect(home.completed).toBe(2);
    const [a, b] = home.list;
    expect(a).toMatchObject({ player: "H4", receiver: "H8" });
    expect(b).toMatchObject({ player: "H8", receiver: "H9" });
    // Worked out by hand from the pass events' start and end_at.
    expect(a.xt).toBeCloseTo(
      xtAt(grid, [1.4953, -9.7163], 0) - xtAt(grid, [-21.8546, -9.5409], 0),
      9,
    );
    expect(b.xt).toBeCloseTo(
      xtAt(grid, [40.766, -10.8458], 0) - xtAt(grid, [1.8732, -9.7191], 0),
      9,
    );
    expect(home.xtAdded).toBeCloseTo(a.xt + b.xt, 12);
  });

  it("names the pass that added the most: the long one to the runner", () => {
    expect(home.best?.id).toBe("pass:H8:0075");
    expect(home.best!.xt).toBeGreaterThan(0);
    expect(home.progressive).toBe(2);
  });

  it("has nothing for the team that never passed", () => {
    expect(progression(heroEvents, 1, grid)).toMatchObject({
      passes: 0,
      completed: 0,
      xtAdded: 0,
      best: null,
    });
  });

  it("does not count a pass that was intercepted", () => {
    const lost = optionEvents(pressWhatIf, "pass:H11");
    expect(progression(lost, 0, grid)).toMatchObject({ passes: 1, completed: 0, xtAdded: 0 });
  });
});

describe("regains and the high press, on the pressure hero's forced runs", () => {
  it("finds a tackle in the attacking third as a high regain", () => {
    const events = optionEvents(pressWhatIf, "carry");
    const [tackle] = regains(events);
    expect(tackle).toMatchObject({ kind: "tackle", team: 1, high: true });
    expect(tackle.at[0]).toBeCloseTo(-36.8871, 4);
    const away = pressMetrics(events, 1);
    expect(away).toMatchObject({ regains: 1, highRegains: 1, zoneActions: 1, zonePasses: 0 });
    expect(away.ppda).toBe(0);
    expect(pressMetrics(events, 0)).toMatchObject({ regains: 0, highRegains: 0, ppda: null });
  });

  it("counts an interception in the middle third as a regain but not a high one", () => {
    // H4's 45 m pass kicked from x = -37.6 is cut out at x = -12.1, short of the last third
    // for the away side (which attacks -x: its third begins at x = -17.5).
    const events = optionEvents(pressWhatIf, "pass:H11");
    const away = pressMetrics(events, 1);
    expect(away).toMatchObject({ regains: 1, highRegains: 0, zoneActions: 1, zonePasses: 1 });
    expect(away.ppda).toBe(1);
    expect(away.shotsAfterHighRegain).toBe(0);
  });

  it("draws PPDA's zone at the opponent's own 60% of the pitch", () => {
    expect(PRESS_ZONE_FROM).toBeCloseTo(-10.5, 12);
    const pass = (player: string, x: number) =>
      ({
        id: `pass:${player}:${x}`,
        type: "pass",
        frame: 1,
        player,
        attrs: { start: [x, 0] },
      }) as unknown as ExportEvent;
    const press = (player: string, x: number) =>
      ({
        id: `interception:${player}:${x}`,
        type: "interception",
        frame: 2,
        player,
        attrs: { at: [x, 0] },
      }) as unknown as ExportEvent;
    // Home presses: away passes kicked beyond x = -10.5 count (-11 does not), and so do home's
    // own regains there.
    const m = pressMetrics(
      [
        pass("A3", 30),
        pass("A3", -10),
        pass("A3", -11),
        pass("H3", 30),
        press("H5", 20),
        press("H5", -20),
      ],
      0,
    );
    expect(m).toMatchObject({ zonePasses: 2, zoneActions: 1, regains: 2, highRegains: 1 });
    expect(m.ppda).toBe(2);
  });

  it("credits the shots and xG that follow a high regain within ten seconds", () => {
    const at = (type: string, player: string, frame: number, attrs: object) =>
      ({ id: `${type}:${player}:${frame}`, type, frame, player, attrs }) as unknown as ExportEvent;
    const events = [
      at("interception", "H5", 100, { at: [30, 0] }),
      at("shot", "H9", 200, { start: [44, 0] }), // 100 frames later: inside the window
      at("shot", "H9", 700, { start: [44, 0] }), // 600 frames later: outside it
    ];
    const m = pressMetrics(events, 0);
    expect(m.shotsAfterHighRegain).toBe(1);
    expect(m.xgAfterHighRegain).toBeCloseTo(distanceXg(8.5), 12);
  });

  it("reads the team off the player's letter", () => {
    expect(teamOf("H8")).toBe(0);
    expect(teamOf("A11")).toBe(1);
  });
});
