// The live match stats panel (SPEC 4.6, 7): persona-aware (the analyst's table, a casual viewer's
// headlines, a player fan's player), measured numbers labelled with their source, only what is
// known at the playhead, and the same panel in a hero moment and in a stitched match.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { createApi } from "../api/client";
import type { Persona } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { createSession, type ViewSession } from "../session";
import fixture from "../stats/fixture_seed3.json";
import { parseStats, prepare } from "../stats/stats";
import { statsStore } from "../stats/store";
import { API, fakeFetch, fakeSockets, matchExport, render } from "../testing";
import { StatsPanel } from "./StatsPanel";

const stats = () => prepare(parseStats(fixture.stats));
const LAST = fixture.stats.frames - 1;

function ready(session: ViewSession, frame = LAST) {
  statsStore(session).set({ status: "ready", stats: stats(), error: null });
  session.playback.set({ frame });
  return session;
}

function hero(persona: Persona, frame = LAST) {
  const session = createSession(parseHero(raw), null, null);
  session.breakdown.set({ persona });
  return ready(session, frame);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the stats panel", () => {
  it("gives the analyst every player's row, labelled as measured from tracking", () => {
    const html = render(hero("analyst"), <StatsPanel />);
    expect(html).toContain('data-audience="table"');
    expect(count(html, "data-player-row=")).toBe(22);
    expect(html).toContain("Joss Ferriday");
    for (const head of ["Distance", "Top speed", "Sprints", "Passes", "Accuracy", "Difficulty"]) {
      expect(html).toContain(head);
    }
    expect(html).toContain('class="source"');
    expect(html).toContain(">tracking<");
    // Measured metrics, never shown as verified claims (as the telemetry panel says of its own).
    expect(html).toContain("not verified claims");
    expect(html).not.toContain("data-verdict");
    // What the feed cannot show is said, not left as a zero (SPEC 4.6).
    expect(html).toContain("Tackles are not modelled yet");
  });

  it("lists the analyst's passes with distance, ball speed and the parts of their difficulty", () => {
    const html = render(hero("analyst"), <StatsPanel />);
    const passes = fixture.stats.cues.filter((c) => c.kind === "pass");
    expect(count(html, "data-pass=")).toBe(passes.length);
    expect(html).toContain("lane");
    expect(html).toContain("km/h");
  });

  it("gives a casual viewer two or three headline numbers and no table", () => {
    const html = render(hero("casual"), <StatsPanel />);
    expect(html).toContain('data-audience="headlines"');
    const n = count(html, "data-headline=");
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    expect(html).not.toContain("<table");
  });

  it("follows the player fan's player, the one whose eyes the first-person view uses", () => {
    const session = hero("player_fan");
    session.playback.set({ povPlayer: "H9" });
    const html = render(session, <StatsPanel />);
    expect(html).toContain('data-audience="player"');
    expect(html).toContain('data-follow="H9"');
    expect(html).toContain("Nico Varnhall");
    expect(html).toContain("<select");
  });

  it("shows only what is known at the playhead", () => {
    const first = fixture.stats.cues.find((c) => c.kind === "pass")!;
    const before = render(hero("analyst", first.frame - 1), <StatsPanel />);
    expect(count(before, "data-pass=")).toBe(0);
    const at = render(hero("analyst", first.frame), <StatsPanel />);
    expect(count(at, "data-pass=")).toBe(1);
  });

  it("says the numbers are for what happened when the other run is on screen", () => {
    const session = hero("analyst");
    session.playback.set({ mode: "counterfactual" });
    expect(render(session, <StatsPanel />)).toContain("what really happened");
  });

  it("renders in a stitched match, with its own audience switch", () => {
    const fetch = fakeFetch({});
    const session = createMatchSession(parseHero(structuredClone(matchExport())), {
      api: createApi(API, "match-1", fetch),
      dataUrl: "/data/",
      fetch,
      socket: fakeSockets(),
    });
    const html = render(ready(session, 0), <StatsPanel />);
    expect(html).toContain('aria-label="Stats for"');
    for (const label of ["Analyst", "Casual", "Player fan"]) expect(html).toContain(label);
  });

  it("says where live stats come from when there is no service", () => {
    const session = createSession(parseHero(raw), null, null);
    const html = render(session, <StatsPanel />);
    expect(statsStore(session).get().status).toBe("offline");
    expect(html).toContain("Live stats come from the match service");
  });
});
