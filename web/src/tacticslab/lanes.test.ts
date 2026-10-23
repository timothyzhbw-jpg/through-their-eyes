// Pass lanes (tacticslab/lanes.ts) on the bundled blind-side hero's decision, and on crafted
// options for the blocked cases the bundled export does not have.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { passOptions, type PassOption } from "../options/passOptions";
import { boardPlayers, laneEnds } from "./board";
import { OPEN_P, laneCounts, laneOf, lanesAt, nearestOpponent } from "./lanes";

const hero = parseHero(raw);
const run = hero.runs.factual;
const decision = run.decision!;

describe("pass lanes at the decision", () => {
  const lanes = lanesAt(hero, run);

  it("are the pass options the options module has, carries and shots left out", () => {
    const passes = passOptions(hero, run).filter((o) => o.kind === "pass");
    expect(lanes.map((l) => l.action)).toEqual(passes.map((p) => p.action));
    expect(lanes.length).toBeGreaterThan(1);
    expect(lanes.filter((l) => l.chosen).map((l) => l.action)).toEqual([decision.chosen]);
  });

  it("call a lane open when the pass would have arrived at least 60% of the time on the truth", () => {
    expect(OPEN_P).toBe(0.6);
    for (const l of lanes) {
      expect(l.state).toBe(l.pTrue !== null && l.pTrue >= 0.6 ? "open" : "blocked");
    }
    const chosen = lanes.find((l) => l.chosen)!;
    // He thought 0.65, it was 0.83: the sim's numbers for his pass to the runner.
    expect(chosen.pBelief).toBeCloseTo(0.6497, 4);
    expect(chosen.pTrue).toBeCloseTo(0.8253, 4);
    expect(chosen.state).toBe("open");
    expect(chosen.misread).toBe(false);
    expect(laneCounts(lanes)).toEqual({ open: lanes.length, blocked: 0 });
  });

  it("read the pressure on the receiver as the nearest opponent at the decision frame", () => {
    const j = hero.ids.indexOf("H9");
    const at = (k: number) => [
      run.pos[(decision.frame * hero.n + k) * 2],
      run.pos[(decision.frame * hero.n + k) * 2 + 1],
    ];
    const by = hero.players
      .map((p, k) =>
        p.team === hero.players[j].team
          ? Infinity
          : Math.hypot(at(k)[0] - at(j)[0], at(k)[1] - at(j)[1]),
      )
      .reduce((a, b) => Math.min(a, b));
    expect(nearestOpponent(hero, run, "H9", decision.frame)).toBeCloseTo(by, 9);
    expect(lanes.find((l) => l.receiver === "H9")!.pressure).toBeCloseTo(by, 9);
    expect(nearestOpponent(hero, run, "Z99", decision.frame)).toBeNull();
  });

  it("have none for a run with no decision", () => {
    expect(lanesAt(hero, { ...run, decision: null })).toEqual([]);
  });
});

describe("blocked lanes", () => {
  const base = passOptions(hero, run).find((o) => o.kind === "pass")!;
  const option = (patch: Partial<PassOption>): PassOption => ({ ...base, ...patch });

  it("are the ones that would not have arrived", () => {
    const l = laneOf(hero, run, option({ pBelief: 0.9, pTrue: 0.3 }), decision.frame)!;
    expect(l).toMatchObject({ state: "blocked", playable: true, misread: true });
  });

  it("include a pass the sim found no way to play, and one he wrote off that was open", () => {
    const none = laneOf(hero, run, option({ pBelief: 0.7, pTrue: null }), decision.frame)!;
    expect(none).toMatchObject({ state: "blocked", playable: false, misread: true });
    const open = laneOf(hero, run, option({ pBelief: 0.3, pTrue: 0.95 }), decision.frame)!;
    expect(open).toMatchObject({ state: "open", misread: true });
    expect(laneCounts([none, open])).toEqual({ open: 1, blocked: 1 });
  });

  it("are not made of a carry or a shot", () => {
    expect(laneOf(hero, run, option({ kind: "carry", receiver: null }), decision.frame)).toBeNull();
  });
});

describe("the board", () => {
  it("places the 22 players at the decision frame, pitch y drawn up, with the carrier marked", () => {
    const players = boardPlayers(hero, run);
    expect(players).toHaveLength(22);
    expect(players.filter((p) => p.carrier).map((p) => p.id)).toEqual([decision.player]);
    const j = hero.ids.indexOf(decision.player);
    expect(players[j].x).toBeCloseTo(run.pos[(decision.frame * hero.n + j) * 2], 6);
    expect(players[j].y).toBeCloseTo(-run.pos[(decision.frame * hero.n + j) * 2 + 1], 6);
  });

  it("stops a lane short of the receiver and puts its middle halfway", () => {
    const e = laneEnds({ from: [0, 0], to: [20, 10] } as never);
    expect(e.x1).toBe(0);
    expect(Math.abs(e.y1)).toBe(0);
    expect(Math.hypot(e.x2 - 20, e.y2 + 10)).toBeCloseTo(1.6, 9);
    expect(e.mx).toBeCloseTo(e.x2 / 2, 12);
    expect(e.y2).toBeLessThan(0); // pitch +y is up, SVG y is down
  });
});
