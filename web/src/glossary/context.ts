import type { PayloadClaim } from "../narration/payload";
import type { GlossaryTerm, Language } from "./terms";

export type ContextClaim = Pick<PayloadClaim, "id" | "values">;

// Only claims the Python builders emit (explain/builders.py, extra_looks.py, look_cost.py) are read,
// each by its claim id and slot key. Decimals follow the slot: dxt 2 (builders), xt 3 (XT_DECIMALS).
const find = (claims: readonly ContextClaim[], ids: readonly string[], key: string) => {
  for (const claim of claims) {
    if (!ids.includes(claim.id)) continue;
    const value = claim.values[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
};

/** A moment-specific line, or nothing. Every value comes from a supplied verified claim. */
export function contextLine(
  term: GlossaryTerm,
  language: Language,
  claims: readonly ContextClaim[],
): string | null {
  const zh = language === "zh";
  switch (term.id) {
    case "xt": {
      const difference = find(claims, ["cf_value"], "dxt");
      if (difference !== null) {
        const size = Math.abs(difference).toFixed(2);
        if (difference < 0) {
          return zh
            ? `此刻：这样处理少了${size}的预期威胁。`
            : `Here: this cost ${size} of expected threat.`;
        }
        return zh
          ? `此刻：两种处理的预期威胁相差${size}。`
          : `Here: the expected-threat difference is ${size}.`;
      }
      const value = find(claims, ["pass_zones", "extra_zones"], "xt");
      return value === null
        ? null
        : zh
          ? `此刻：球到位时的预期威胁为${value.toFixed(3)}。`
          : `Here: the ball arrived with xT ${value.toFixed(3)}.`;
    }
    case "scan": {
      const value = find(claims, ["scans_before_reception"], "n");
      if (value === null || !Number.isInteger(value)) return null;
      return zh
        ? `此刻：他在接球前回头观察了${value}次。`
        : `Here: he scanned ${value} ${value === 1 ? "time" : "times"} before receiving.`;
    }
    case "final-third": {
      const present = claims.some(
        (claim) => claim.id === "reception_zone" && claim.values.band === "final_third",
      );
      return present
        ? zh
          ? "此刻：这脚传球在前场三区找到了队友。"
          : "Here: the pass was received in the final third."
        : null;
    }
    default:
      return null;
  }
}
