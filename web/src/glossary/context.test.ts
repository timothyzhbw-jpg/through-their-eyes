import { describe, expect, it } from "vitest";
import type { PayloadClaim } from "../narration/payload";
import { contextLine } from "./context";
import { TERMS } from "./terms";

const claim = (id: string, values: PayloadClaim["values"]): PayloadClaim => ({
  id,
  kind: "computed",
  verdict: "supported",
  values,
  evidence: [],
  seek_frame: 1,
});

describe("this moment's context", () => {
  it("omits context when there is no relevant data", () => {
    for (const term of TERMS) {
      expect(contextLine(term, "en", []), term.id).toBeNull();
      expect(contextLine(term, "zh", [claim("unrelated", { distance_m: 18 })]), term.id).toBeNull();
    }
  });

  it("reads xT from the claims the builders emit, at their decimals", () => {
    const term = TERMS.find((item) => item.id === "xt")!;
    expect(contextLine(term, "en", [claim("pass_zones", { xt: 0.157 })])).toBe(
      "Here: the ball arrived with xT 0.157.",
    );
    expect(contextLine(term, "en", [claim("pass_zones", { xt: 0.2 })])).toBe(
      "Here: the ball arrived with xT 0.200.",
    );
    expect(contextLine(term, "en", [claim("cf_value", { dxt: 0.11 })])).toBe(
      "Here: the expected-threat difference is 0.11.",
    );
  });

  it("words a negative xT difference as a cost", () => {
    const term = TERMS.find((item) => item.id === "xt")!;
    expect(contextLine(term, "en", [claim("cf_value", { dxt: -0.11 })])).toBe(
      "Here: this cost 0.11 of expected threat.",
    );
    expect(contextLine(term, "zh", [claim("cf_value", { dxt: -0.11 })])).toBe(
      "此刻：这样处理少了0.11的预期威胁。",
    );
  });

  it("names the final third only from the reception zone claim", () => {
    const term = TERMS.find((item) => item.id === "final-third")!;
    expect(contextLine(term, "en", [claim("shot_placement", { band: "final_third" })])).toBeNull();
    expect(contextLine(term, "en", [claim("reception_zone", { band: "own_half" })])).toBeNull();
    expect(contextLine(term, "en", [claim("reception_zone", { band: "final_third" })])).toBe(
      "Here: the pass was received in the final third.",
    );
  });

  it("has no context line for a term no claim carries", () => {
    for (const id of ["regain", "ppda", "xg", "line-breaking-pass", "pitch-control"]) {
      const term = TERMS.find((item) => item.id === id)!;
      expect(contextLine(term, "en", [claim("anything", { xg: 0.3, ppda: 8 })]), id).toBeNull();
    }
  });

  it("does not borrow a similarly named value from another claim", () => {
    const term = TERMS.find((item) => item.id === "scan")!;
    expect(contextLine(term, "en", [claim("passes", { n: 3 })])).toBeNull();
    expect(contextLine(term, "en", [claim("scans_before_reception", { n: 3 })])).toBe(
      "Here: he scanned 3 times before receiving.",
    );
  });
});
