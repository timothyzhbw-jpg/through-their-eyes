// Where a number on screen comes from (SPEC 5, 7): every number carries one small chip saying so,
// in one style. Its words say what the number is first (2026-10-22, outside UX review: "not a
// verified claim" read as "not to be trusted"). A verified claim (✓) is a number the AI crew
// wrote, checked by the Verifier against the match data. Everything else is computed in code
// from the synthetic match, not written by the AI, so the Verifier has nothing to check: read
// from the sim export (sim), measured from tracking and the event feed by analytics/ (tracking),
// estimated by the scan detector from tracked head yaw (detector), taken from the moment's scan
// lens (lens). A sample answer shipped with the app for when the service is not there (sample) is
// AI-style narration that no Verifier checked, and says so. Each call site passes the kind its
// data already carries; the words are here, once.

export type SourceKind = "verified" | "sim" | "tracking" | "detector" | "lens" | "sample";

/** What a number computed in code is not, and what the Verifier checks instead. */
export const NOT_NARRATION =
  "not AI narration. The Verifier checks what the AI crew writes (the ✓ lines) against the match data";

/** A title for a number computed in code: what it is, then that it is not AI narration. */
export const computed = (what: string): string => `${what}: ${NOT_NARRATION}`;

export const SOURCES: Readonly<Record<SourceKind, { label: string; title: string }>> = {
  verified: {
    label: "✓",
    title: "A verified claim: the Verifier checked it against the match data",
  },
  sim: { label: "sim", title: computed("Computed directly by the simulation") },
  tracking: {
    label: "tracking",
    title: computed("Measured from the match's tracking and event feed"),
  },
  detector: {
    label: "detector",
    title: computed("Estimated by the scan detector from tracked head yaw"),
  },
  lens: { label: "lens", title: computed("Computed by the moment's scan lens") },
  sample: {
    label: "sample",
    title: "A sample answer shipped with the app, not checked by the Verifier",
  },
};

/** "How is this checked?", opened: what a kind of number computed in code is (HowChecked.tsx
 * adds that no AI writes it, and how the AI's narration is checked instead). */
export const HOW_CHECKED: Readonly<Record<Exclude<SourceKind, "verified" | "sample">, string>> = {
  sim: "Computed directly by the simulation of this synthetic match, in code.",
  tracking: "Measured in code from the synthetic match's tracking and event feed.",
  detector:
    "Estimated in code by the scan detector from the tracked head yaw, as it would be from real tracking.",
  lens: "Computed in code by the moment's scan lens.",
};
export const NOTHING_TO_CHECK =
  "No AI writes these numbers, so there is nothing for the Verifier to check.";
export const HOW_NARRATION_IS_CHECKED =
  "The lines marked ✓ are different: the AI crew writes them, and the Verifier checks every number in them against the match data before they air.";
