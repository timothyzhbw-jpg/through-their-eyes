import { describe, expect, it } from "vitest";
import { TERMS } from "./terms";

describe("glossary terms", () => {
  it("covers the football and analytics vocabulary in English and Chinese", () => {
    expect(TERMS).toHaveLength(20);
    for (const term of TERMS) {
      expect(term.aliases.en.length, term.id).toBeGreaterThan(0);
      expect(term.aliases.zh.length, term.id).toBeGreaterThan(0);
      expect(term.definition.en.trim(), term.id).toMatch(/[A-Za-z]/);
      expect(term.definition.zh.trim(), term.id).toMatch(/[\u3400-\u9fff]/);
      if (term.analyst) {
        expect(term.analyst.en.trim(), term.id).toMatch(/[A-Za-z]/);
        expect(term.analyst.zh.trim(), term.id).toMatch(/[\u3400-\u9fff]/);
      }
    }
    expect(TERMS.find((term) => term.id === "xt")?.definition.zh).toContain("预期威胁");
  });
});
