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

  it("uses only supplied claim values for a regain", () => {
    const term = TERMS.find((item) => item.id === "regain")!;
    expect(contextLine(term, "en", [claim("high_regain", { regain_distance_m: 18 })])).toBe(
      "Here: the press won the ball 18 m from goal.",
    );
    expect(contextLine(term, "zh", [claim("high_regain", { regain_distance_m: 18 })])).toBe(
      "此刻：这次逼抢在距离球门18米处夺回球权。",
    );
  });

  it("distinguishes an xT value from an xT difference", () => {
    const term = TERMS.find((item) => item.id === "xt")!;
    expect(contextLine(term, "en", [claim("cf_value", { dxt: 0.11 })])).toBe(
      "Here: this moment added +0.11 in expected threat.",
    );
    expect(contextLine(term, "en", [claim("pass_zones", { xt: 0.157 })])).toBe(
      "Here: the ball arrived with xT 0.157.",
    );
  });

  it("does not borrow a similarly named value from another claim", () => {
    const term = TERMS.find((item) => item.id === "scan")!;
    expect(contextLine(term, "en", [claim("passes", { n: 3 })])).toBeNull();
    expect(contextLine(term, "en", [claim("scans_before_reception", { n: 3 })])).toBe(
      "Here: he scanned 3 times before receiving.",
    );
  });
});
