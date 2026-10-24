import type { PayloadClaim } from "../narration/payload";
import type { GlossaryTerm, Language } from "./terms";

export type ContextClaim = Pick<PayloadClaim, "id" | "values">;

const number = (claims: readonly ContextClaim[], keys: readonly string[], id?: RegExp) => {
  for (const claim of claims) {
    if (id && !id.test(claim.id)) continue;
    for (const key of keys) {
      const value = claim.values[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return null;
};

const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;

/** A moment-specific line, or nothing. Every value comes from a supplied verified claim. */
export function contextLine(
  term: GlossaryTerm,
  language: Language,
  claims: readonly ContextClaim[],
): string | null {
  const zh = language === "zh";
  switch (term.id) {
    case "high-press":
    case "regain": {
      const value = number(claims, ["regain_distance_m", "distance_to_goal_m"], /regain|press/);
      if (value === null) return null;
      return zh
        ? `此刻：这次逼抢在距离球门${value}米处夺回球权。`
        : `Here: the press won the ball ${value} m from goal.`;
    }
    case "ppda": {
      const value = number(claims, ["ppda"], /ppda|press/);
      return value === null
        ? null
        : zh
          ? `此刻：这项逼抢数据为${value}。`
          : `Here: PPDA is ${value}.`;
    }
    case "xt": {
      const difference = number(claims, ["dxt"], /value|threat|pass|look/);
      if (difference !== null) {
        return zh
          ? `此刻：这一处理带来${signed(difference)}的预期威胁变化。`
          : `Here: this moment added ${signed(difference)} in expected threat.`;
      }
      const value = number(claims, ["xt"], /value|threat|pass|look|zone/);
      return value === null
        ? null
        : zh
          ? `此刻：球到位时的预期威胁为${value}。`
          : `Here: the ball arrived with xT ${value}.`;
    }
    case "xg": {
      const value = number(claims, ["xg"], /shot|goal|xg/);
      return value === null
        ? null
        : zh
          ? `此刻：这次射门的预期进球为${value}。`
          : `Here: this shot has xG ${value}.`;
    }
    case "scan": {
      const value = number(claims, ["n", "scans"], /scan/);
      if (value === null) return null;
      return zh
        ? `此刻：他在接球前扭头观察了${value}次。`
        : `Here: he scanned ${value} ${value === 1 ? "time" : "times"} before receiving.`;
    }
    case "final-third": {
      const present = claims.some((claim) => claim.values.band === "final_third");
      return present
        ? zh
          ? "此刻：这次传球在前场三区被接到。"
          : "Here: the pass was received in the final third."
        : null;
    }
    case "line-breaking-pass": {
      const value = number(claims, ["bypassed", "min_bypassed"], /line|pass/);
      if (value === null) return null;
      return zh
        ? `此刻：这脚传球越过了${value}名防守球员。`
        : `Here: the pass went beyond ${value} ${value === 1 ? "defender" : "defenders"}.`;
    }
    case "pitch-control": {
      const value = number(claims, ["pitch_control", "control"], /pitch|control/);
      return value === null
        ? null
        : zh
          ? `此刻：该区域的场地控制值为${value}。`
          : `Here: pitch control in this area is ${value}.`;
    }
    case "body-orientation": {
      const value = number(claims, ["body_deg", "orientation_deg"], /turn|orientation|body/);
      return value === null
        ? null
        : zh
          ? `此刻：他的身体朝向为${value}度。`
          : `Here: his body orientation is ${value}°.`;
    }
    default:
      return null;
  }
}
