import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import type { ExportEvent } from "../data/types";
import { matchExport } from "../testing";
import { lineup, measure, runMinutes, watchOptions } from "./lineup";
import { playLength } from "./LineupCard";

describe("the pre-match line-up", () => {
  const hero = parseHero(raw);

  it("lists all exported players in their teams, sorted by shirt number", () => {
    const reversed = parseHero({ ...raw, players: [...raw.players].reverse() });
    const before = [...reversed.players];
    const teams = lineup(reversed);
    expect(teams.home).toHaveLength(11);
    expect(teams.away).toHaveLength(11);
    expect([...teams.home, ...teams.away]).toHaveLength(22);
    for (const [name, team] of [
      ["home", 0],
      ["away", 1],
    ] as const) {
      const expected = hero.players
        .filter((player) => player.team === team)
        .sort((a, b) => a.number - b.number);
      expect(teams[name].map(({ number, id, role }) => ({ number, id, role }))).toEqual(
        expected.map(({ number, id, role }) => ({ number, id, role })),
      );
    }
    expect(reversed.players).toEqual(before);
  });

  it("counts H8's factual scans over the exported duration in minutes", () => {
    const minutes = (hero.runs.factual.frames * hero.dt) / 60;
    const scans = hero.runs.factual.scans.filter((scan) => scan.player === "H8").length;
    const h8 = lineup(hero).home.find((player) => player.id === "H8")!;
    expect(runMinutes(hero)).toBe(minutes);
    expect(h8.scans).toBe(scans);
    expect(h8.scansPerMinute).toBe(scans / runMinutes(hero));
    expect(h8.hero).toBe(true);
    expect(lineup(hero).away.every((player) => !player.hero)).toBe(true);
  });

  it("gives players without factual scan events a zero rate", () => {
    const withoutScans = parseHero(raw);
    withoutScans.runs.factual.scans = [];
    const teams = lineup(withoutScans);
    for (const player of [...teams.home, ...teams.away]) {
      expect(player.scans).toBe(0);
      expect(player.scansPerMinute).toBe(0);
    }
  });

  it("counts only the factual run, never the counterfactual's scans", () => {
    const both = structuredClone(raw);
    const extra = both.runs.factual.events.find(
      (event) => event.type === "scan" && event.player === "H8",
    )!;
    const counterfactual = both.runs.counterfactual.events as ExportEvent[];
    counterfactual.push(
      ...Array.from({ length: 4 }, (_, k): ExportEvent => ({
        ...extra,
        id: `scan:H8:cf${k}`,
        frame: extra.frame + k,
      })),
    );
    const h8 = lineup(parseHero(both)).home.find((player) => player.id === "H8")!;
    const factual = lineup(hero).home.find((player) => player.id === "H8")!;
    expect(h8.scans).toBe(factual.scans);
    expect(h8.scansPerMinute).toBe(factual.scansPerMinute);
  });

  it("measures a hero moment in scans and a match of a minute or more in rates", () => {
    expect(runMinutes(hero)).toBeLessThan(1);
    expect(measure(hero)).toBe("count");
    // The test match stitches three short possessions; match-1, the stitched match the card opens
    // on, is about 11¾ min on one clock (SPEC 3.1), so give the fixture that run length.
    const match = matchExport();
    match.runs.factual.frames = Math.round(701.0 / match.dt);
    const stitched = parseHero(match);
    expect(runMinutes(stitched)).toBeGreaterThanOrEqual(1);
    expect(measure(stitched)).toBe("rate");
  });

  it("offers the hero of a single moment", () => {
    expect(watchOptions(hero)).toEqual([{ id: "H8", role: "CM", note: "The hero of this moment" }]);
  });

  it("offers each stitched possession hero once, in match order", () => {
    expect(watchOptions(parseHero(matchExport()))).toEqual([
      { id: "H8", role: "CM", note: "Hero of possession 2" },
    ]);
    const match = matchExport();
    match.match.possessions[0].hero = "A5";
    match.match.possessions[1].hero = "H8";
    match.match.possessions[2].hero = "A5";
    const parsed = parseHero(match);
    expect(watchOptions(parsed)).toEqual([
      {
        id: "A5",
        role: match.players.find((player) => player.id === "A5")!.role,
        note: "Hero of possession 1",
      },
      { id: "H8", role: "CM", note: "Hero of possession 2" },
    ]);
    const teams = lineup(parsed);
    expect([...teams.home, ...teams.away].filter((player) => player.hero).map((p) => p.id)).toEqual(
      ["H8", "A5"],
    );
  });
});

describe("the run's length on the card", () => {
  it("is given in seconds under a minute, in minutes from one minute on", () => {
    expect(playLength(0.11)).toBe("6.6 seconds of play");
    expect(playLength(12.25)).toBe("12.3 minutes of play");
  });
});
