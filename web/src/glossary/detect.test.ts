import { describe, expect, it } from "vitest";
import { detectTerms } from "./detect";

const ids = (text: string, language: "en" | "zh" = "en") =>
  detectTerms(text, language)
    .filter((part) => part.term)
    .map((part) => part.term!.id);

describe("term detection", () => {
  it("finds English terms, long forms, plurals and flexible hyphens", () => {
    expect(ids("A high press, two regains and a line-breaking pass into the final third.")).toEqual(
      ["high-press", "regain", "line-breaking-pass", "final-third"],
    );
    expect(ids("Expected threat (xT), counter‑attack and half turn.")).toEqual([
      "xt",
      "xt",
      "counter-attack",
      "body-orientation",
    ]);
  });

  it("does not hit inside other words", () => {
    expect(ids("The scanner rescans markingremarkably, and xGrowth mixes xT2.")).toEqual([]);
    expect(ids("PPDA")).toEqual(["ppda"]);
    expect(ids("PPDA2")).toEqual([]);
  });

  it("finds native Chinese commentary terms without Latin-only boundaries", () => {
    expect(ids("高位逼抢后迅速反抢，传球进入前场三区并提升预期威胁。", "zh")).toEqual([
      "high-press",
      "counter-press",
      "final-third",
      "xt",
    ]);
  });

  it("prefers the longest term and leaves all other text intact", () => {
    const parts = detectTerms("A set piece and a high press.");
    expect(parts.map((part) => part.text).join("")).toBe("A set piece and a high press.");
    expect(parts.filter((part) => part.term).map((part) => part.term!.id)).toEqual([
      "set-piece",
      "high-press",
    ]);
  });
});
