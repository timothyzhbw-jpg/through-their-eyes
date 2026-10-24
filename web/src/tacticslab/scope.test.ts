// The Tactics cards are measured on the moment that shows their tactic, never on a moment that
// holds none of it, and never lead with zeros or dashes (SPEC 4.8, 7).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import withoutLook from "../../public/data/without_look_seed3.json";
import pressWhatIf from "../../public/data/whatif_press_escape_seed0.json";
import type { Api } from "../api/client";
import { parseHero, type Hero } from "../data/hero";
import { matchExport, pressureExport } from "../testing";
import { CARD_IDS, buildCards, isBlank, type LabCard } from "./cards";
import { CARD_SCENARIO, NO_SCOPE, loadScope, missingScenarios, type Scope } from "./scope";
import { parseXtGrid } from "./metrics";

const xt = parseXtGrid(withoutLook.xt);
const bundled = () => parseHero(raw); // blind_side_run 3: two passes, no regains, no shots
const press = () => parseHero(pressureExport());
const byId = (cards: LabCard[]) => Object.fromEntries(cards.map((c) => [c.id, c]));
const scopeOf = (heroes: Record<string, Hero>, match: Hero | null = null): Scope => ({
  heroes,
  match,
  loading: false,
  online: true,
});

/** The events of one forced run of the pressure moment (an interception, in the middle third). */
const forcedEvents = (action: string) =>
  (
    pressWhatIf.options.find((o) => o.action === action) as unknown as {
      events: Hero["runs"]["factual"]["events"];
    }
  ).events;

/** A hero with its factual run's events replaced. */
const withEvents = (h: Hero, events: Hero["runs"]["factual"]["events"]): Hero => ({
  ...h,
  runs: { ...h.runs, factual: { ...h.runs.factual, events } },
});

/** No card of any scope may lead with an empty value, or print a table of them. */
function expectNoBlankLead(cards: LabCard[]) {
  for (const c of cards) {
    if (c.empty) continue;
    const lead = c.metrics[0];
    expect(lead, c.id).toBeDefined();
    expect(lead.values.every(isBlank), `${c.id} leads with ${lead.label}: ${lead.values}`).toBe(
      false,
    );
  }
}

describe("isBlank", () => {
  it("is zeros and dashes, alone or together", () => {
    for (const v of ["0", "0 · 0", "0 · 0.00", "0.00", "–", "+0.00", ""])
      expect(isBlank(v), v).toBe(true);
    for (const v of ["2 · 2", "0.35", "1 · 0.12", "+0.04", "6.1 m", "H8 → H9 +0.02"]) {
      expect(isBlank(v), v).toBe(false);
    }
  });
});

describe("a card's moment", () => {
  it("is the one that shows its tactic, whichever moment the page opened on", () => {
    expect(CARD_SCENARIO).toEqual({
      high_press: "press_escape",
      decisions: "press_escape",
      corners: "corner_blind_side",
      shot_quality: "far_post_finish",
      progression: "blind_side_run",
      counter_attack: "press_escape",
      build_up: "press_escape",
      transition: "press_escape",
    });
    expect(missingScenarios(bundled()).sort()).toEqual([
      "corner_blind_side",
      "far_post_finish",
      "press_escape",
    ]);
    expect(missingScenarios(press())).toContain("blind_side_run");
    expect(missingScenarios(press())).not.toContain("press_escape");
  });

  it("High press and Decisions are measured on the pressure moment, labelled so", () => {
    const cards = byId(buildCards(bundled(), xt, scopeOf({ press_escape: press() })));
    for (const id of ["high_press", "decisions"] as const) {
      expect(cards[id].measured, id).toMatch(/Under pressure \(press_escape\)/);
      expect(cards[id].scope).toBe("this moment");
    }
    // Progression stays on the page's own moment, the one that shows it.
    expect(cards.progression.measured).toMatch(/The look \(blind_side_run\)/);
    expect(cards.progression.metrics[0].values).toEqual(["2 · 2", "0 · 0"]);
    expect(cards.decisions.metrics.length).toBeGreaterThan(0);
  });

  it("is not watchable on the page's clock when it is another moment's", () => {
    const cards = byId(buildCards(bundled(), xt, scopeOf({ press_escape: press() })));
    expect(cards.decisions.watch).toBeNull();
    expect(cards.decisions.here).toBe(false);
    expect(cards.progression.watch).not.toBeNull();
    expect(cards.progression.here).toBe(true);
  });

  it("measures the pressure moment as its own page does", () => {
    const own = byId(buildCards(press(), xt));
    const from = byId(buildCards(bundled(), xt, scopeOf({ press_escape: press() })));
    expect(from.high_press.metrics).toEqual(own.high_press.metrics);
    expect(own.high_press.here).toBe(true);
  });
});

describe("a card with nothing to lead with", () => {
  it("never leads with zeros or dashes, on any scope", () => {
    const scopes: Scope[] = [
      NO_SCOPE,
      { ...NO_SCOPE, online: true, loading: true },
      scopeOf({ press_escape: press() }),
      scopeOf({ press_escape: withEvents(press(), []) }, bundled()),
    ];
    for (const s of scopes) {
      expectNoBlankLead(buildCards(bundled(), xt, s));
      expectNoBlankLead(buildCards(press(), xt, s));
    }
  });

  it("offline says the moment needs the live service, with no numbers", () => {
    const c = byId(buildCards(bundled(), xt))["high_press"];
    expect(c.empty).toMatch(/live service/);
    expect(c.empty).toMatch(/press_escape/);
    expect(c.metrics).toEqual([]);
    expect(c.measured).toMatch(/press_escape/);
  });

  it("says it is loading while the service answers, and when it could not", () => {
    const loading = byId(buildCards(bundled(), xt, { ...NO_SCOPE, online: true, loading: true }));
    expect(loading.corners.empty).toMatch(/Loading/);
    const failed = byId(buildCards(bundled(), xt, { ...NO_SCOPE, online: true }));
    expect(failed.corners.empty).toMatch(/could not be loaded/);
  });

  it("falls back to the whole stitched match when the moment holds none of the events", () => {
    const empty = withEvents(press(), []);
    const match = withEvents(parseHero(matchExport()), forcedEvents("pass:H11"));
    const c = byId(buildCards(bundled(), xt, scopeOf({ press_escape: empty }, match))).high_press;
    expect(c.scope).toBe("this match");
    expect(c.measured).toMatch(/whole stitched match \(match-1\).*press_escape/);
    expect(c.watch).toBeNull();
    expectNoBlankLead([c]);
  });

  it("says why when nothing at all is measured, and shows no table", () => {
    const empty = withEvents(press(), []);
    const c = byId(buildCards(bundled(), xt, scopeOf({ press_escape: empty }))).high_press;
    expect(c.empty).toBeTruthy();
    const quiet = withEvents(
      press(),
      [...forcedEvents("pass:H11")].filter((e) => e.type === "pass"),
    );
    const d = byId(buildCards(bundled(), xt, scopeOf({ press_escape: quiet }))).high_press;
    expect(d.empty).toMatch(/Nothing to measure on Under pressure \(press_escape\)/);
    expect(d.empty).toMatch(/NUMBERS\.md M4/);
  });

  it("puts the metrics that have a value first, and says why each zero is zero", () => {
    // One interception in the middle third: a regain, but not a high one.
    const c = byId(
      buildCards(
        bundled(),
        xt,
        scopeOf({ press_escape: withEvents(press(), forcedEvents("pass:H11")) }),
      ),
    ).high_press;
    expect(c.empty).toBeNull();
    expect(c.metrics[0].label).toBe("Regains");
    expect(c.metrics[0].values).toEqual(["0", "1"]); // the away side won it
    expect(c.metrics[0].zeroWhy).toBeUndefined();
    const high = c.metrics.find((m) => m.label === "High regains")!;
    expect(high.values.every(isBlank)).toBe(true);
    expect(high.zeroWhy).toMatch(/attacking third/);
    const firstZero = c.metrics.findIndex((m) => m.values.every(isBlank));
    expect(firstZero).toBeGreaterThan(0);
    expect(c.metrics.slice(0, firstZero).every((m) => !m.zeroWhy)).toBe(true);
    expect(c.metrics.slice(firstZero).every((m) => m.zeroWhy)).toBe(true);
  });

  it("a zero regain row says the sim has no open-play tackles", () => {
    const c = byId(
      buildCards(bundled(), xt, scopeOf({ press_escape: withEvents(press(), []) })),
    ).high_press;
    const regains = c.metrics.find((m) => m.label === "Regains")!;
    expect(regains.zeroWhy).toMatch(/no open-play tackles \(docs\/NUMBERS\.md M4\)/);
  });
});

describe("loading the moments", () => {
  const exports: Record<string, unknown> = {
    "match-1": matchExport(),
    "press_escape-0": pressureExport(),
  };
  let asks: string[] = [];
  const api = (): Api => {
    const make = (id: string): Api =>
      ({
        withMatch: (other: string) => make(other),
        exportJson: async () => {
          asks.push(id);
          if (!(id in exports)) throw new Error(`${id}: HTTP 404`);
          return structuredClone(exports[id]);
        },
      }) as unknown as Api;
    return make("match-1");
  };

  it("takes each card's hero from the stitched match's possessions, once per service", async () => {
    asks = [];
    const service = api();
    const scope = await loadScope(service, ["press_escape", "corner_blind_side"], "/data/");
    expect(scope.online).toBe(true);
    expect(scope.match?.kind).toBe("match");
    expect(Object.keys(scope.heroes)).toEqual(["press_escape"]); // the test match has no corner
    expect(asks).toEqual(["match-1", "press_escape-0"]);
    await loadScope(service, ["press_escape"], "/data/");
    expect(asks).toHaveLength(2);
  });

  it("a later page on the same service loads the scenarios the first page did not ask for", async () => {
    asks = [];
    const service = api();
    const first = await loadScope(service, ["corner_blind_side"], "/data/");
    expect(Object.keys(first.heroes)).toEqual([]);
    const second = await loadScope(service, ["press_escape"], "/data/");
    expect(Object.keys(second.heroes)).toEqual(["press_escape"]);
    const third = await loadScope(service, ["corner_blind_side", "press_escape"], "/data/");
    expect(Object.keys(third.heroes)).toEqual(["press_escape"]);
    expect(asks).toEqual(["match-1", "press_escape-0"]); // the match once, each hero once
  });

  it("builds the press cards from what it loaded", async () => {
    const scope = await loadScope(api(), ["press_escape"], "/data/");
    const cards = byId(buildCards(bundled(), xt, scope));
    expect(cards.high_press.measured).toMatch(/press_escape|stitched match/);
    for (const id of CARD_IDS) expect(cards[id].measured).not.toBe("");
  });
});
