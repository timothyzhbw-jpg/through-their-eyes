// Why the call went as it did (SPEC 7): what he had seen and how his picture rated the call,
// straight from the sim export, with no number (no claim stands behind a count or a time).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { yourCallOf } from "./controller";
import { actionPhrase, whyOf } from "./why";

const hero = parseHero(raw);
const { options } = yourCallOf(createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson));
const why = (pick: string) => whyOf(hero, options, pick)!;

describe("why the call went as it did", () => {
  it("lists the teammates fresh in his picture and those he had not seen lately", () => {
    const d = hero.runs.factual.decision!;
    const w = why("pass:H4");
    // From the decision's belief ages: under the greyed-out threshold, and at or over it.
    expect(w.unseen.sort()).toEqual(["H10", "H7"]);
    expect(w.seen).toContain("H9"); // the runner: his look over the shoulder had found him
    expect(w.seen).not.toContain(hero.heroId);
    for (const id of w.seen) expect(d.belief_age[id]).toBeLessThan(1.5);
    expect(w.seen.length + w.unseen.length).toBe(10); // every teammate but him, once
  });

  it("names the call's receiver and whether his picture of him was fresh", () => {
    expect(why("pass:H4").receiver).toEqual({ id: "H4", seen: true });
    expect(why("pass:H7").receiver).toEqual({ id: "H7", seen: false });
    expect(why("carry").receiver).toBeNull();
  });

  it("says how his picture rated your call against his, in words", () => {
    expect(why("pass:H9").picture).toBe(
      "On his picture this was the most promising option, so it was his call.",
    );
    expect(why("pass:H4").picture).toBe(
      "On his picture the pass to N. Varnhall looked more promising than your call, so that was his choice.",
    );
  });

  it("writes no digit anywhere", () => {
    for (const o of options) {
      const w = why(o.action);
      expect(w.picture, o.action).not.toMatch(/\d/);
    }
    expect(actionPhrase("shot:far")).toBe("the shot at the far post");
    expect(actionPhrase("carry")).toBe("carrying it");
  });
});
