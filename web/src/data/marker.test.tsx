// A marker's look (corner_blind_side, SPEC 3.6 and 5.1 `marker_scan`): the hero is a defender
// with a key scan and no decision on the ball. The story, the counterfactual card, the headline
// and the timeline must tell it as his look at the man he marks, never as a decision that is not
// there, and the look's worth comes from the scan lens (or the verified claim), not a NaN.

import { describe, expect, it } from "vitest";
import { createApi } from "../api/client";
import { scenarioLabel } from "../match/match";
import { heroMoment } from "../plan/moment";
import { createSession } from "../session";
import {
  API,
  exportJson,
  fakeFetch,
  health,
  json,
  MARKER_MOMENT,
  markerCards,
  markerExport,
  render,
} from "../testing";
import { StoryPanel, VerdictPanel } from "../ui/Panels";
import { blurbOf, momentKicker, momentTitle } from "../ui/Stage";
import { Transport } from "../ui/Transport";
import { parseHero, runLabels, type Hero } from "./hero";
import { loadData } from "./load";

const raw = markerExport();
const hero = parseHero(raw);
const h = raw.players.findIndex((p) => p.id === "H8");
const r = raw.players.findIndex((p) => p.id === "H9");
const RESOLVED = 139; // reception:H9:0139, the end of pass:H8:0075

/** Marker to man at a frame of an exported run, m (the export is in mm). */
function separation(run: "factual" | "counterfactual", f: number): number {
  const p = raw.runs[run].pos[f];
  return Math.hypot(p[2 * h] - p[2 * r], p[2 * h + 1] - p[2 * r + 1]) / 1000;
}

const session = (mode: "factual" | "counterfactual", value: Partial<Hero> = {}) => {
  const s = createSession({ ...hero, ...value }, null, null, null, { momentId: MARKER_MOMENT });
  s.playback.set({ mode });
  return s;
};

describe("a marker's look", () => {
  it("loads as a marker: his man, the pass to him and where each run resolved it", () => {
    expect(hero.runs.factual.decision).toBeNull();
    expect(hero.deltaXt).toBeNull();
    expect(hero.marker).not.toBeNull();
    const m = hero.marker!;
    expect(m.man).toBe("H9");
    expect(m.pass.id).toBe("pass:H8:0075");
    for (const run of ["factual", "counterfactual"] as const) {
      expect(m.resolved[run]).toEqual({ frame: RESOLVED, type: "reception", player: "H9" });
      expect(m.separation[run]).toBeCloseTo(separation(run, RESOLVED), 3);
    }
    expect(m.separation.counterfactual).toBeGreaterThan(m.separation.factual);
    expect(parseHero(exportJson).marker).toBeNull();
  });

  it("anchors the moment where the pass to his man resolves, like the service's card", () => {
    expect(hero.reception).toBe(RESOLVED);
    const m = heroMoment(hero, MARKER_MOMENT);
    expect(m.anchorFrame).toBe(RESOLVED);
    expect(m.decisionFrame).toBe(RESOLVED);
    expect(momentKicker(hero, m.decisionFrame, 0)).toBe(
      `Moment · ${(RESOLVED * hero.dt).toFixed(2)} s · Perception`,
    );
  });

  it("tells the story of his look and his man, with no receiving and no decision", () => {
    const factual = render(session("factual"), <StoryPanel />);
    expect(factual).not.toMatch(/drops in to receive|Decision|chosen with probability/);
    expect(factual).toContain("H8 marks H9");
    expect(factual).toContain("H8 checks over his shoulder");
    expect(factual).toContain(
      `H9 receives it with H8 ${separation("factual", RESOLVED).toFixed(1)} m from him.`,
    );
    const times = [...factual.matchAll(/class="t">([\d.]+) s</g)].map((m) => Number(m[1]));
    expect(times.length).toBeGreaterThan(4);
    expect(times).toEqual([...times].sort((a, b) => a - b)); // the playhead's beat is found in order
    const cf = render(session("counterfactual"), <StoryPanel />);
    expect(cf).toContain("H8 keeps his eyes on the ball");
    expect(cf).toContain(
      `H9 receives it with H8 ${separation("counterfactual", RESOLVED).toFixed(1)} m from him.`,
    );
  });

  it("compares how close he was to his man in each run, not an empty action", () => {
    const html = render(session("factual"), <VerdictPanel />);
    expect(html).toContain(`${separation("factual", RESOLVED).toFixed(1)} m from H9`);
    expect(html).toContain(`${separation("counterfactual", RESOLVED).toFixed(1)} m from H9`);
  });

  it("shows no value until there is one, rather than +0.000", () => {
    const html = render(session("factual"), <VerdictPanel />);
    expect(html).not.toContain("0.000");
    expect(html).not.toContain("NaN");
    expect(html).toContain("comes with the breakdown");
  });

  it("shows the scan lens's value, marked as the lens's", () => {
    const html = render(
      session("factual", { deltaXt: 0.09596, deltaSource: "lens" }),
      <VerdictPanel />,
    );
    expect(html).toContain("+0.096");
    expect(html).toContain("scan lens");
    expect(runLabels(hero).gain).toBe("Worth of the look to his side");
  });

  it("has its own headline, blurb and label", () => {
    expect(momentTitle(hero)).toEqual(["One look kept him", "with his man."]);
    const same = parseHero({ ...raw, runs: { ...raw.runs, counterfactual: raw.runs.factual } });
    expect(momentTitle(same)).toEqual(["One look, and", "the same outcome."]);
    expect(blurbOf(hero)).toMatch(/short corner/);
    expect(blurbOf(hero)).not.toMatch(/A hero moment:/);
    expect(scenarioLabel("corner_blind_side")).toBe("The corner");
  });

  it("marks where the ball reaches his man on the timeline, not a decision at 0 s", () => {
    const html = render(session("factual"), <Transport />);
    expect(html).not.toContain(">Decision<");
    expect(html).toContain(">Ball arrives<");
  });
});

describe("loading a marker's look from the service", () => {
  const routes = (moments: () => Response) =>
    fakeFetch({
      "GET /health": health,
      "GET /api/matches/corner_blind_side-0": () =>
        json({
          id: "corner_blind_side-0",
          kind: "hero",
          hero_moment: MARKER_MOMENT,
          hero_moments: [MARKER_MOMENT],
        }),
      "GET /api/matches/corner_blind_side-0/export": () => json(raw),
      "GET /api/matches/corner_blind_side-0/moments": moments,
    });
  const load = (fetch: ReturnType<typeof fakeFetch>) =>
    loadData({ apiBase: API, dataUrl: "/data/", fetch, match: "corner_blind_side-0" });

  it("takes the look's worth from the hero card's scan lens", async () => {
    const data = await load(routes(() => json(markerCards())));
    expect(data.momentId).toBe(MARKER_MOMENT);
    expect(data.hero.deltaXt).toBeCloseTo(0.09596, 6);
    expect(data.hero.deltaSource).toBe("lens");
  });

  it("still loads, with no value, when the cards are missing or the lens is unavailable", async () => {
    const failed = await load(routes(() => json({ detail: "boom" }, 500)));
    expect(failed.hero.deltaXt).toBeNull();
    expect(failed.api).not.toBeNull();
    const unavailable = await load(routes(() => json(markerCards(null))));
    expect(unavailable.hero.deltaXt).toBeNull();
  });

  it("asks for the cards only for a hero without a value", async () => {
    const fetch = fakeFetch({
      "GET /health": health,
      "GET /api/matches/blind_side_run-3": () =>
        json({ id: "blind_side_run-3", kind: "hero", hero_moment: "m", hero_moments: ["m"] }),
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
    });
    const data = await loadData({ apiBase: API, dataUrl: "/data/", fetch });
    expect(data.hero.deltaSource).toBe("sim");
    expect(fetch.calls.some((c) => c.path.endsWith("/moments"))).toBe(false);
    expect(createApi(API, "corner_blind_side-0").match).toBe("corner_blind_side-0");
  });
});
