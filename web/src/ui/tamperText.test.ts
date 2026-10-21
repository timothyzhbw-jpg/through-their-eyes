// "Try a wrong number" in words a viewer reads (SPEC 7): each number named as the narration names
// it, the match data rounded as it airs, and the verifier's predicate as a comparison.

import { describe, expect, it } from "vitest";
import { formatSlot, plainReason, slotLabel } from "./tamperText";

describe("tamper wording", () => {
  it("names each numeric slot as the narration line uses it", () => {
    expect(slotLabel("dxt")).toBe("expected threat of the look");
    expect(slotLabel("p_true")).toBe("real chance");
    expect(slotLabel("kmh")).toBe("pass speed (km/h)");
    expect(slotLabel("some_new_slot")).toBe("some new slot"); // unknown: readable, never blank
  });

  it("rounds the match data to the decimals the line airs with", () => {
    expect(formatSlot("dxt", 0.11074015198311513)).toBe("0.11");
    expect(formatSlot("dist", 23.6)).toBe("24");
    expect(formatSlot("gap", 2.345)).toBe("2.3");
    expect(formatSlot("unknown", 0.123456)).toBe("0.123");
    expect(formatSlot("unknown", 3)).toBe("3");
  });

  it("turns the verifier's predicate into a comparison with rounded numbers", () => {
    expect(plainReason("approx(0.11074015198311513, 0.5) is false")).toBe("0.111 ≉ 0.5");
    expect(plainReason("approx(0.11074015198311513, 0.11) holds")).toBe("0.111 ≈ 0.11");
    expect(plainReason("eq('H4', 'H8') is false")).toBe("H4 ≠ H8");
    expect(plainReason("lt(2.0, 1.5) is false; approx(0.3, 0.30000000000000004) holds")).toBe(
      "2.0 ≥ 1.5; 0.3 ≈ 0.3",
    );
    expect(plainReason("all 2 conditions hold")).toBe("all 2 conditions hold");
    expect(plainReason("evidence: no event scan:H8:0050")).toBe("evidence: no event scan:H8:0050");
  });
});
