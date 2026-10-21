// Live stats tags over players in the broadcast view (SPEC 4.6, 7): with the API's stats the
// ball carrier is named, a sprint shows his name and speed, and the tags say they are measured
// from tracking. Without stats the sim's tags are unchanged (broadcast.test.ts).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import fixture from "../stats/fixture_seed3.json";
import { parseStats, prepare, sprintKmh } from "../stats/stats";
import { liveTags, tagSource } from "./broadcastTags";

const hero = parseHero(raw);
const run = hero.runs.factual;
const stats = prepare(parseStats(fixture.stats));
const h8 = hero.ids.indexOf("H8");

describe("broadcast tags with live stats", () => {
  it("names the ball carrier", () => {
    const f = run.owner.findIndex((o) => o >= 0);
    const carrier = run.owner[f];
    const p = hero.players[carrier];
    const name = liveTags(hero, run, f, h8, true, stats).find((t) => t.kind === "name");
    expect(name).toEqual({
      player: carrier,
      kind: "name",
      label: String(p.number),
      text: fixture.stats.players[carrier].short.split(". ")[1].toUpperCase(),
    });
    expect(tagSource("name")).toBe("tracking");
  });

  it("shows a sprint with the stats' name and speed instead of the sim's tag", () => {
    const r = fixture.stats.tracks.speed.find((x) => x.sprint.some(([a, b]) => b - a >= 10))!;
    const at = r.sprint.find(([a, b]) => b - a >= 10)![0] + 9;
    const tags = liveTags(hero, run, at, h8, true, stats);
    const j = hero.ids.indexOf(r.player);
    const kmh = sprintKmh(stats, r.player, at)!;
    expect(tags).toContainEqual({
      player: j,
      kind: "speed",
      label: "SPRINT",
      text: `${fixture.stats.players[j].short} ${kmh.toFixed(1)} km/h`,
    });
    expect(tags.some((t) => t.kind === "sprint")).toBe(false);
    expect(tagSource("speed")).toBe("tracking");
    expect(tagSource("sprint")).toBe("sim");
  });

  it("keeps the stats to what happened: the other run gets the sim's tags only", () => {
    const cf = hero.runs.counterfactual;
    const tags = liveTags(hero, cf, 60, h8, true, stats);
    expect(tags.every((t) => tagSource(t.kind) === "sim")).toBe(true);
  });
});
