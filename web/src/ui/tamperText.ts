// "Try a wrong number" in words a viewer reads (SPEC 7): each numeric slot named as its narration
// line uses it, the match data rounded to the decimals the line airs with (explain/builders.py
// `_num`), and the verifier's predicate ("approx(0.1107…, 0.5) is false") as a comparison.

interface SlotText {
  label: string;
  decimals: number; // as the line airs it
}

const SLOTS: Record<string, SlotText> = {
  secs: { label: "seconds since his last look", decimals: 1 },
  dur: { label: "length of the look (s)", decimals: 2 },
  dist: { label: "pass length (m)", decimals: 0 },
  kmh: { label: "pass speed (km/h)", decimals: 1 }, // measured on the tracked ball, as the chips
  gap: { label: "gap (m)", decimals: 1 },
  err: { label: "belief error (m)", decimals: 1 },
  p_belief: { label: "chance he thought it had", decimals: 2 },
  p_true: { label: "real chance", decimals: 2 },
  dxt: { label: "expected threat of the look", decimals: 2 },
  share: { label: "share he saw (%)", decimals: 0 },
  gain: { label: "metres opened up", decimals: 1 },
  pressure: { label: "pressing intensity (%)", decimals: 0 },
  window_s: { label: "window before receiving (s)", decimals: 1 },
  n: { label: "number of looks", decimals: 0 },
};

/** The slot as a viewer reads it; an unknown one is its name with spaces. */
export function slotLabel(slot: string): string {
  return SLOTS[slot]?.label ?? slot.replaceAll("_", " ");
}

/** A value of `slot` as the line airs it; an unknown slot gets at most three decimals. */
export function formatSlot(slot: string, value: number): string {
  const decimals = SLOTS[slot]?.decimals;
  if (decimals !== undefined) return value.toFixed(decimals);
  return String(Number(value.toFixed(3)));
}

const HOLDS: Record<string, string> = {
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  approx: "≈",
  before: "before",
};
const FAILS: Record<string, string> = {
  eq: "≠",
  ne: "=",
  lt: "≥",
  le: ">",
  gt: "≤",
  ge: "<",
  approx: "≉",
  before: "not before",
};

/** A long float from Python's repr, rounded to three decimals; a quoted id, unquoted. */
function operand(text: string): string {
  const t = text.trim();
  if (/^'[^']*'$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+\.\d{4,}(e-?\d+)?$/.test(t)) return String(Number(Number(t).toFixed(3)));
  return t;
}

/**
 * The verifier's reason as comparisons: each `op(a, b) holds` or `op(a, b) is false` (verifier.py
 * `_predicate`) becomes `a ≈ b` or `a ≉ b` with rounded numbers. Anything else, such as a missing
 * evidence event, is left as the verifier wrote it.
 */
export function plainReason(reason: string): string {
  return reason.replace(
    /\b(eq|ne|lt|le|gt|ge|approx|before)\(([^(),]+), ([^(),]+)\) (holds|is false)/g,
    (_, op: string, a: string, b: string, verdict: string) =>
      `${operand(a)} ${(verdict === "holds" ? HOLDS : FAILS)[op]} ${operand(b)}`,
  );
}
