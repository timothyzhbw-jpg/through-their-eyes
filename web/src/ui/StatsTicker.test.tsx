// The stats ticker over the live screen (SPEC 4.6, 7): the in-view tags as text in his eyes and on
// the board, labelled as tracking, with the data on the pitch on (View options); the broadcast
// camera draws them over the players itself, so there the ticker keeps only its spoken line.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { createSession } from "../session";
import fixture from "../stats/fixture_seed3.json";
import { parseStats, prepare } from "../stats/stats";
import { statsStore } from "../stats/store";
import { render } from "../testing";
import { setPitchData } from "./pitchData";
import { StatsTicker } from "./StatsTicker";

function session(frame: number, mode: "factual" | "counterfactual" = "factual") {
  const s = createSession(parseHero(raw), null, null);
  statsStore(s).set({ status: "ready", stats: prepare(parseStats(fixture.stats)), error: null });
  s.playback.set({ frame, mode });
  return s;
}

const sprint = (() => {
  const r = fixture.stats.tracks.speed.find((x) => x.sprint.some(([a, b]) => b - a >= 10))!;
  return r.sprint.find(([a, b]) => b - a >= 10)![0] + 9;
})();

describe("the stats ticker", () => {
  beforeEach(() => setPitchData(true)); // "Show data on the pitch" (off by default: below)
  afterEach(() => setPitchData(false));

  it("keeps the tags off the picture until the data on the pitch is turned on", () => {
    setPitchData(false);
    const off = render(session(sprint), <StatsTicker />);
    expect(off).not.toContain("stat-chip");
    expect(off).toMatch(/aria-live="polite">[^<]*SPRINT/); // still said to a screen reader
    setPitchData(true);
    expect(render(session(sprint), <StatsTicker />)).toContain("stat-chip");
  });

  it("shows the live tags as text with their source", () => {
    const html = render(session(sprint), <StatsTicker />);
    expect(html).toContain("SPRINT");
    expect(html).toContain("km/h");
    expect(html).toContain(">tracking<");
    expect(html).toContain('aria-live="polite"');
  });

  it("leaves the broadcast picture to its own tags, and still says them to a screen reader", () => {
    const s = session(sprint);
    s.playback.set({ camera: "broadcast", focus: "broadcast" });
    const html = render(s, <StatsTicker />);
    expect(html).not.toContain("stat-chip"); // views/broadcastTags.ts draws them, with `tracking`
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/aria-live="polite">[^<]*SPRINT/);
    s.playback.set({ focus: "tactical" }); // the board as the main view keeps the ticker
    expect(render(s, <StatsTicker />)).toContain("stat-chip");
  });

  it("names the ball carrier", () => {
    const owner = parseHero(raw).runs.factual.owner;
    const f = owner.findIndex((o) => o >= 0);
    const surname = fixture.stats.players[owner[f]].short.split(". ")[1].toUpperCase();
    expect(render(session(f), <StatsTicker />)).toContain(surname);
  });

  it("shows nothing for the other run or before the stats load", () => {
    expect(render(session(sprint, "counterfactual"), <StatsTicker />)).toBe("");
    const bare = createSession(parseHero(raw), null, null);
    expect(render(bare, <StatsTicker />)).toBe("");
  });
});
