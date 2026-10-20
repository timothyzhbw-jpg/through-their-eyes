import { describe, expect, it } from "vitest";
import { parseHero } from "../data/hero";
import { exportJson } from "../testing";
import { ControlInputs, controlInputsAt, MAX_PER_TEAM, MODEL } from "./pitchControl";
import fixture from "./snapshots.json";

const hero = parseHero(exportJson);
const run = hero.runs.factual;
const n = hero.n;
const REGENERATE = "stale: run `uv run python -m eval.pitch_control_parity`";

const pos = (f: number, j: number, axis: number) => run.pos[(f * n + j) * 2 + axis];
const team = (t: number) => hero.players.flatMap((p, j) => (p.team === t ? [j] : []));
const rows = (inputs: ControlInputs, side: "home" | "away", count: number) =>
  Array.from({ length: count }, (_, i) => Array.from(inputs[side].slice(4 * i, 4 * i + 4)));

describe("pitch-control inputs (SPEC 4.2)", () => {
  it("uses the numpy kernel's parameters", () => {
    expect({ sigma: MODEL.sigma, reaction: MODEL.reaction, v_max: MODEL.vMax }).toEqual(
      fixture.model,
    );
  });

  it("splits the players by team, in player order", () => {
    const inputs = controlInputsAt(new ControlInputs(), hero, run, 75);
    expect([inputs.homeCount, inputs.awayCount]).toEqual([team(0).length, team(1).length]);
    expect(Math.max(inputs.homeCount, inputs.awayCount)).toBeLessThanOrEqual(MAX_PER_TEAM);
    expect(rows(inputs, "away", 1)[0].slice(0, 2)).toEqual([
      Math.fround(pos(75, team(1)[0], 0)),
      Math.fround(pos(75, team(1)[0], 1)),
    ]);
  });

  it("takes velocities as the backward difference of the positions (the sim's integrator)", () => {
    for (const f of [1, 50, 75, run.frames - 1]) {
      const home = rows(controlInputsAt(new ControlInputs(), hero, run, f), "home", 11);
      team(0).forEach((j, i) => {
        for (const axis of [0, 1]) {
          const v = (pos(f, j, axis) - pos(f - 1, j, axis)) / hero.dt;
          expect(home[i][axis]).toBe(Math.fround(pos(f, j, axis)));
          expect(home[i][2 + axis]).toBeCloseTo(v, 4);
        }
      });
    }
  });

  it("uses the forward difference at frame 0 and interpolates between frames", () => {
    const at = (f: number) => rows(controlInputsAt(new ControlInputs(), hero, run, f), "home", 11);
    const [zero, one] = [at(0), at(1)];
    zero.forEach((row, i) => {
      expect(row[2]).toBeCloseTo(one[i][2], 5);
      expect(row[3]).toBeCloseTo(one[i][3], 5);
    });
    const [a, b, mid] = [at(60), at(61), at(60.25)];
    mid.forEach((row, i) =>
      row.forEach((v, k) => expect(v).toBeCloseTo(0.75 * a[i][k] + 0.25 * b[i][k], 4)),
    );
    expect(at(-5)).toEqual(zero);
    expect(at(run.frames + 10)).toEqual(at(run.frames - 1));
  });

  it("feeds the board the snapshots the shader is parity-tested on", () => {
    expect(fixture.scenario).toBe(hero.scenario);
    expect(fixture.seed).toBe(hero.seed);
    for (const s of fixture.snapshots) {
      const inputs = controlInputsAt(new ControlInputs(), hero, run, s.frame);
      const got = [...rows(inputs, "home", 11), ...rows(inputs, "away", 11)];
      [...s.home, ...s.away].forEach((want: number[], i: number) => {
        // Both are rounded from the sim, positions to 1 mm. The board's velocities are
        // differences of rounded positions: within 2 mm per frame of the sim's when the two files
        // were written on different platforms (as in tests/test_pitch_control_parity.py).
        const mm = (k: number) => Math.abs(got[i][k] * 1000 - want[k]);
        expect(Math.max(mm(0), mm(1)), REGENERATE).toBeLessThanOrEqual(1.01);
        expect(Math.max(mm(2), mm(3)), REGENERATE).toBeLessThanOrEqual(2 / hero.dt + 0.51);
      });
    }
  });
});
