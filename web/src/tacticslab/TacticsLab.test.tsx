// The Tactics lab on screen (tacticslab/TacticsLab.tsx): the cards on the bundled hero moment and
// on a stitched match, each metric with its definition and source chip, links to the hero moment
// and the With / Without comparison, the lane board, and the entry points.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import withoutLook from "../../public/data/without_look_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { createSession } from "../session";
import { TacticsCards } from "../tactics/TacticsCards";
import { tacticsStore } from "../tactics/store";
import { parseTactics } from "../tactics/tactics";
import tacticsFixture from "../tactics/fixture.json";
import { API, fakeFetch, fakeSockets, matchExport, render } from "../testing";
import { CARD_IDS, buildCards, compareHref, momentHref } from "./cards";
import { XG_CAP, XG_D0, XG_PEAK, XG_SCALE, distanceXg, parseXtGrid } from "./metrics";
import { TacticsLabPanel } from "./TacticsLab";

const xt = parseXtGrid(withoutLook.xt);
const hero = () => createSession(parseHero(raw), null, null);

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
  const cards = buildCards(parseHero(raw), xt);

  it("are the five tactics, in order, each tied to a hero moment", () => {
    expect(cards.map((c) => c.id)).toEqual([...CARD_IDS]);
    expect(CARD_IDS).toEqual(["high_press", "decisions", "corners", "shot_quality", "progression"]);
    expect(cards.map((c) => c.moment.scenario)).toEqual([
      "press_escape",
      "press_escape",
      "corner_blind_side",
      "far_post_finish",
      "blind_side_run",
    ]);
  });

  it("give every metric a definition and a source", () => {
    for (const c of cards) {
      for (const m of c.metrics) {
        expect(m.definition.length, `${c.id} / ${m.label}`).toBeGreaterThan(20);
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

  it("measure the bundled moment: its two passes, no regains, no shots", () => {
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(by.progression.metrics[0].values).toEqual(["2 · 2", "0 · 0"]);
    expect(by.high_press.metrics[0].values).toEqual(["0", "0"]);
    expect(by.shot_quality.empty).toMatch(/No shot/);
    expect(by.progression.watch?.frame).toBe(75); // the long pass to the runner
    expect(by.decisions.watch?.frame).toBe(parseHero(raw).runs.factual.decision!.frame);
  });

  it("print the xG model's constants from the code that computes it", () => {
    const xg = cards.find((c) => c.id === "shot_quality")!.metrics.find((m) => m.label === "xG")!;
    for (const k of [XG_CAP, XG_PEAK, XG_D0, XG_SCALE]) expect(xg.definition).toContain(String(k));
    expect(distanceXg(XG_D0)).toBeCloseTo(XG_PEAK);
  });

  it("wait for the xT grid rather than invent progression", () => {
    const p = buildCards(parseHero(raw), null).find((c) => c.id === "progression")!;
    expect(p.empty).toMatch(/loading/);
  });

  it("link to the moment and to its With / Without comparison", () => {
    expect(momentHref("progression")).toBe("/?intro=0");
    expect(compareHref("progression")).toBe("/?intro=0&run=counterfactual&at=decision");
    expect(compareHref("high_press")).toBe(
      "/?match=press_escape-0&intro=0&run=counterfactual&at=decision",
    );
    // A moment told inside the match opens through the match; its run toggle does the rest.
    expect(compareHref("corners")).toBe("/?match=match-1&moment=corner_blind_side");
    expect(momentHref("shot_quality")).toBe("/?match=match-1&moment=far_post_finish");
  });
});

describe("the Tactics lab panel", () => {
  const html = render(hero(), <TacticsLabPanel xt={xt} />);

  it("is a chapter you can jump to", () => {
    expect(html).toContain('id="tactics-lab"');
    expect(html).toContain("Why tactics");
    for (const t of [
      "High press",
      "Decisions under pressure",
      "Corners",
      "Shot quality",
      "Progression",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("shows each metric's definition and source chip", () => {
    expect(html).toContain("Opponent passes per defensive action");
    expect(html).toContain('data-source="tracking"');
    expect(html).toContain('data-source="sim"');
    expect(html).toContain("Measured over this moment");
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
    expect(m).toContain("Measured over this match");
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
