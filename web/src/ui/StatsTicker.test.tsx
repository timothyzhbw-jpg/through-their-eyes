// The stats ticker over the live screen (SPEC 4.6, 7): the in-view tags as text, whichever
// camera is on (the broadcast camera also draws them over the players), labelled as tracking.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { createSession } from "../session";
import fixture from "../stats/fixture_seed3.json";
import { parseStats, prepare } from "../stats/stats";
import { statsStore } from "../stats/store";
import { render } from "../testing";
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
  it("shows the live tags as text with their source", () => {
    const html = render(session(sprint), <StatsTicker />);
    expect(html).toContain("SPRINT");
    expect(html).toContain("km/h");
    expect(html).toContain(">tracking<");
    expect(html).toContain('aria-live="polite"');
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
