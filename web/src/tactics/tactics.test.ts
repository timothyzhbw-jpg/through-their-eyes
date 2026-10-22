// The tactics cards' data (SPEC 4.8): the service's view parses, each card's sentence is picked
// by language and withheld unless every claim behind it is supported, the sentence's numbers are
// the card's own, and the formatting writes no number the data does not hold.

import { describe, expect, it } from "vitest";
import fixture from "./fixture.json";
import {
  clock,
  optionLabel,
  parseTactics,
  pct,
  seekFrame,
  sentence,
  share,
  signed,
  type TacticsView,
} from "./tactics";

const view = () => parseTactics(structuredClone(fixture));

/** Every number written in a text, as written; a player id ("A9") is a name, not a number. */
const numbers = (text: string) => text.match(/(?<![A-Za-z\d.])\d+(?:\.\d+)?/g) ?? [];

describe("the tactics view", () => {
  it("parses the service's cards and both languages", () => {
    const v = view();
    expect(v.cards.source).toBe("tracking");
    expect(v.cards.build_up.teams.map((t) => t.team)).toEqual([0, 1]);
    expect(Object.keys(v.lines).sort()).toEqual(["en", "zh"]);
    expect(() => parseTactics({ cards: {}, lines: {} })).toThrow();
  });

  it("picks each card's sentence by language, falling back to English", () => {
    const v = view();
    expect(sentence(v, "build_up", "en")?.line.text).toMatch(/^Building short under pressure/);
    expect(sentence(v, "build_up", "zh")?.line.text).toMatch(/在压力下短传出球/);
    expect(sentence(v, "set_pieces", "zh")?.language).toBe("zh");
    const fallback = sentence(v, "set_pieces", "es");
    expect(fallback?.language).toBe("en");
    expect(fallback?.line.text).toBe(sentence(v, "set_pieces", "en")?.line.text);
  });

  it("withholds a sentence whose claim is not supported or not in the payload", () => {
    const v: TacticsView = view();
    for (const lang of ["en", "zh"]) v.lines[lang].claims[0].verdict = "refuted";
    expect(sentence(v, "build_up", "en")).toBeNull();
    const w: TacticsView = view();
    for (const lang of ["en", "zh"]) w.lines[lang].claims = [];
    expect(sentence(w, "set_pieces", "zh")).toBeNull();
  });

  it("writes in a sentence only the numbers of its verified claims", () => {
    const v = view();
    for (const lang of ["en", "zh"]) {
      for (const card of ["build_up", "set_pieces"] as const) {
        const said = sentence(v, card, lang)!;
        const values = said.claims.flatMap((c) => Object.values(c.values).map(String));
        for (const n of numbers(said.line.text)) {
          expect(values.some((value) => Number(value) === Number(n))).toBe(true);
        }
      }
    }
  });

  it("says the card's own numbers", () => {
    const v = view();
    const team = v.cards.build_up.teams[v.cards.build_up.team];
    const [build] = sentence(v, "build_up", "en")!.claims;
    expect(build.values.n).toBe(team.pressed_short.passes);
    expect(build.values.done).toBe(team.pressed_short.completed);
    expect(build.values.pct).toBe(Math.round(team.pressed_short.completion! * 100));
    const [corner] = sentence(v, "set_pieces", "en")!.claims;
    const sp = v.cards.set_pieces;
    expect(corner.values.c).toBe(sp.corners);
    expect(corner.values.xt).toBe(Number(sp.best!.peak_xt!.toFixed(2)));
    expect(corner.values.n).toBe(sp.open_play);
  });

  it("seeks to the earliest evidence", () => {
    const said = sentence(view(), "build_up", "en")!;
    const frames = said.claims.map((c) => c.seek_frame!).filter((f) => f != null);
    expect(seekFrame(said)).toBe(Math.min(...frames));
  });
});

describe("the tactics formatting", () => {
  it("formats shares, signs and clocks", () => {
    expect(pct(0.6842)).toBe("68%");
    expect(pct(null)).toBe("–");
    expect(share({ passes: 19, completed: 13, completion: 0.6842, xt: null })).toBe("13/19 · 68%");
    expect(share({ passes: 0, completed: 0, completion: null, xt: null })).toBe("–");
    expect(signed(0.0126)).toBe("+0.013");
    expect(signed(-0.0032)).toBe("−0.003");
    expect(signed(0.00001)).toBe("0.000");
    expect(clock(275.96)).toBe("4:35");
    expect(clock(5)).toBe("0:05");
  });

  it("labels an option by its receiver and distance", () => {
    const pass = { action: "pass:H7", kind: "pass", to: "H7", length_m: 34.54, long: true,
      p_success: 0.82, value: 0.0126 }; // prettier-ignore
    expect(optionLabel(pass)).toBe("H7, 35 m");
    expect(optionLabel({ ...pass, action: "carry", kind: "carry", to: null })).toBe("carry");
  });
});
