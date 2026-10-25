// The Tactics lab on screen (tacticslab/TacticsLab.tsx): the cards on the bundled hero moment and
// on a stitched match, each metric with its definition and source chip, links to the hero moment
// and the With / Without comparison, the lane board, and the entry points.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import withoutLook from "../../public/data/without_look_seed3.json";
import pressWhatIf from "../../public/data/whatif_press_escape_seed0.json";
import shotWhatIf from "../../public/data/whatif_far_post_finish_seed11.json";
import { createApi } from "../api/client";
import { parseHero, type Hero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { createSession } from "../session";
import { TacticsCards } from "../tactics/TacticsCards";
import { tacticsStore } from "../tactics/store";
import { parseTactics } from "../tactics/tactics";
import tacticsFixture from "../tactics/fixture.json";
import { API, fakeFetch, fakeSockets, matchExport, pressureExport, render } from "../testing";
import type { Scope } from "./scope";
import matchFixture from "./fixture_match1_transitions.json";
import { CARD_IDS, buildCards, compareHref, momentHref } from "./cards";
import { XG_CAP, XG_D0, XG_PEAK, XG_SCALE, distanceXg, parseXtGrid } from "./metrics";
import { TacticsLabPanel } from "./TacticsLab";

const xt = parseXtGrid(withoutLook.xt);
const hero = () => createSession(parseHero(raw), null, null);

/** A hero whose factual run holds the events of one forced run of a bundled what-if file. */
const heroWith = (scenario: string, file: unknown, action: string): Hero => {
  const base = parseHero(scenario === "press_escape" ? pressureExport() : raw);
  const option = (file as { options: { action: string; events: unknown[] }[] }).options.find(
    (o) => o.action === action,
  )!;
  return {
    ...base,
    scenario,
    runs: { ...base.runs, factual: { ...base.runs.factual, events: option.events as never } },
  };
};

/** What the page loads for the cards when the journey opened on the bundled moment. */
const scope: Scope = {
  heroes: {
    press_escape: heroWith("press_escape", pressWhatIf, "pass:H11"),
    far_post_finish: heroWith("far_post_finish", shotWhatIf, "shot:near"),
  },
  match: null,
  loading: false,
  online: true,
};

function match() {
  const fetch = fakeFetch({});
  return createMatchSession(parseHero(structuredClone(matchExport())), {
    api: createApi(API, "match-1", fetch),
    dataUrl: "/data/",
    fetch,
    socket: fakeSockets(),
  });
}

describe("the cards", () => {
  const cards = buildCards(parseHero(raw), xt, scope);
  const matchCards = buildCards(parseHero(matchFixture), xt);

  it("keep only tactics at the top level, each tied to an example", () => {
    expect(cards.map((c) => c.id)).toEqual([...CARD_IDS]);
    expect(CARD_IDS).toEqual(["high_press", "counter_attack", "build_up", "transition", "corners"]);
    expect(cards.map((c) => c.moment.scenario)).toEqual([
      "press_escape",
      null,
      "press_escape",
      null,
      "corner_blind_side",
    ]);
  });

  it("put decisions, progression and shot quality under tactics, with explanations and sources", () => {
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(by.high_press.metrics.map((m) => m.label)).toContain("Decisions under pressure");
    const counter = matchCards.find((c) => c.id === "counter_attack")!;
    expect(counter.metrics.map((m) => m.label)).toEqual(
      expect.arrayContaining(["Progression · xT gained", "Shot quality · xG"]),
    );
    expect(by.build_up.metrics.map((m) => m.label)).toEqual(
      expect.arrayContaining(["Progression · xT gained", "Decisions under pressure"]),
    );
    const corners = matchCards.find((c) => c.id === "corners")!;
    expect(corners.metrics.map((m) => m.label)).toContain("Shot quality · shots from corners · xG");
    for (const c of [...cards, ...matchCards]) {
      for (const m of c.metrics) {
        expect(m.definition.length, `${c.id} / ${m.label}`).toBeGreaterThan(20);
        expect(m.pro.length, `${c.id} / ${m.label} Pro`).toBeGreaterThan(20);
        expect(m.plain.length, `${c.id} / ${m.label} Plain`).toBeGreaterThan(20);
        expect(["sim", "tracking"]).toContain(m.source);
      }
    }
  });

  it("say on the press card what the sim's defensive actions are", () => {
    const press = cards.find((c) => c.id === "high_press")!;
    const ppda = press.metrics.find((m) => m.label.startsWith("PPDA"))!;
    expect(ppda.definition).toMatch(/interceptions and tackles/);
    expect(ppda.definition).toMatch(/challenges and fouls/);
    expect(press.limits).toMatch(/interceptions only/);
  });

  it("measure a tactic and all its parameters on the same scope", () => {
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    const buildProgression = by.build_up.metrics.find((m) => m.label.startsWith("Progression"))!;
    expect(buildProgression.values).toHaveLength(2);
    expect(by.high_press.metrics[0].label).toBe("Regains");
    expect(by.high_press.metrics[0].values).not.toEqual(["0", "0"]);
    expect(by.high_press.measured).toMatch(/Under pressure \(press_escape\)/);
    expect(by.build_up.measured).toMatch(/Under pressure \(press_escape\)/);
    expect(by.high_press.metrics.find((m) => m.label === "Decisions under pressure")).toBeDefined();
  });

  it("keeps the whole-match fallback scope to one clause", () => {
    const empty = parseHero(raw);
    empty.runs.factual.events = [];
    const withMatch = buildCards(parseHero(raw), xt, {
      ...scope,
      heroes: { ...scope.heroes, press_escape: empty },
      match: scope.heroes.press_escape!,
    });
    expect(withMatch.find((c) => c.id === "high_press")!.measured).toBe(
      "the whole stitched match (match-1) for Under pressure (press_escape)",
    );
  });

  it("print the xG model's constants from the code that computes it", () => {
    const withCounter = matchCards.find((c) => c.id === "counter_attack")!;
    const xg = withCounter.metrics.find((m) => m.label === "Shot quality · xG")!;
    for (const k of [XG_CAP, XG_PEAK, XG_D0, XG_SCALE]) expect(xg.definition).toContain(String(k));
    expect(distanceXg(XG_D0)).toBeCloseTo(XG_PEAK);
  });

  it("wait for the xT grid rather than invent progression", () => {
    const counter = buildCards(parseHero(matchFixture), null).find(
      (c) => c.id === "counter_attack",
    )!;
    expect(counter.empty).toMatch(/loading/);
  });

  it("link every tactic to its moment and With / Without comparison", () => {
    expect(momentHref("build_up")).toBe("/?match=press_escape-0&intro=0");
    expect(compareHref("build_up")).toBe(
      "/?match=press_escape-0&intro=0&run=counterfactual&at=decision",
    );
    expect(compareHref("high_press")).toBe(
      "/?match=press_escape-0&intro=0&run=counterfactual&at=decision",
    );
    // A moment told inside the match opens through the match; its run toggle does the rest.
    expect(compareHref("corners")).toBe("/?match=match-1&moment=corner_blind_side");
    expect(compareHref("counter_attack")).toBe(
      "/?match=match-1&intro=0&run=counterfactual&at=decision",
    );
  });
});

describe("the Tactics lab panel", () => {
  const html = render(hero(), <TacticsLabPanel xt={xt} scope={scope} />);

  it("puts five tactic tabs above the high-press parameter rows", () => {
    expect(html).toContain('id="tactics-lab"');
    expect(html).toContain("Why tactics");
    for (const t of [
      "High press",
      "Counter-attack",
      "Possession play / breaking the press",
      "Transition after losing the ball",
      "Set pieces (corners)",
    ]) {
      expect(html).toContain(`data-tactic="${t}"`);
    }
    for (const p of [
      "Regains",
      "High regains",
      "PPDA",
      "Decisions under pressure",
      "Shots within 10 s of a high regain · xG",
    ]) {
      // Terms in a row's name are glossary buttons, so read the text, not the markup.
      expect(html.replace(/<[^>]+>/g, "")).toContain(p);
    }
    expect(html.indexOf('aria-label="Tactics"')).toBeLessThan(
      html.indexOf('data-card="high_press"'),
    );
  });

  it("folds each parameter definition under its row and keeps its source chip", () => {
    const session = hero();
    session.breakdown.set({ persona: "analyst" });
    const pro = render(session, <TacticsLabPanel xt={xt} scope={scope} />);
    expect(pro).toContain("<summary>What it counts</summary>");
    expect(pro).toContain("Opponent passes per defensive action");
    expect(pro).toContain('data-parameter="decisions"');
    expect(pro).toContain('class="lab-parameter-explanation"');
    expect(pro).toContain('data-source="tracking"');
    expect(pro).toContain('data-source="sim"');
    expect(pro).toContain("Measured over this moment");
  });

  it("puts the moment links before the card's limitations disclosure", () => {
    expect(html).toContain("<summary>What these numbers leave out</summary>");
    expect(html.indexOf('data-link="moment"')).toBeLessThan(
      html.indexOf("What these numbers leave out"),
    );
  });

  it("links the card to its hero moment and the With / Without comparison", () => {
    expect(html).toContain('href="/?match=press_escape-0&amp;intro=0"');
    expect(html).toContain(
      'href="/?match=press_escape-0&amp;intro=0&amp;run=counterfactual&amp;at=decision"',
    );
    expect(html).toContain("With / without the look");
  });

  it("draws the pass lanes at his decision, open and blocked told by dash and cross", () => {
    expect(html).toContain("Pass lanes at");
    expect(html).toContain('data-state="open"');
    expect(html).toContain("Nearest opponent to the receiver");
    expect(html).toContain("<svg");
    expect(html).toContain("chosen");
  });

  it("says a match has no lanes of its own", () => {
    const m = render(match(), <TacticsLabPanel xt={xt} />);
    expect(m).toContain("Measured on:</strong> this match");
    expect(m).toContain("no decision of its own");
    expect(m).not.toContain("<svg");
  });

  it("says nothing is demo data: no audience or sponsor figure on it", () => {
    expect(html).not.toContain("Demo data");
  });
});

describe("the way in", () => {
  it("is linked from the match's tactics cards", () => {
    const session = createSession(parseHero(raw), null, null);
    tacticsStore(session).set({
      status: "ready",
      tactics: parseTactics(tacticsFixture),
      error: null,
    });
    expect(render(session, <TacticsCards where="stats" />)).toContain('href="#tactics-lab"');
  });
});
