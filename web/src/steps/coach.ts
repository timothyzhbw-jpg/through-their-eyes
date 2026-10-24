// The coach's example (SPEC 3.6, "Teaching"): the teaching scenario `pro_scan`, a central
// midfielder with his back to goal who looks over his left shoulder, his right, behind him toward
// goal and, as the ball comes, forward to the striker; then drops back and receives on the
// half-turn. The scan story opens it by link; the API serves it without listing it.

import type { ScanDirection } from "./story";

/** The served match id of the coach's example: `pro_scan` on held-out seed 126 (typical of the
 * eval, eval/reports/pro_scan.md). */
export const COACH_MATCH = "pro_scan-126";
export const COACH_LABEL = "Coach's example: three looks, then the half-turn";

/** Where the coach's example opens: the scan story on it. */
export const coachHref = (base: string = import.meta.env.BASE_URL): string =>
  `${base}?play=steps&match=${COACH_MATCH}`;

/** Whether a moment is the coach's example (then the link to it is not shown). */
export const isCoachExample = (scenario: string, seed: number): boolean =>
  `${scenario}-${seed}` === COACH_MATCH;

/** Said on screen wherever the coach's example plays, as the docs say it. */
export const TEACHING_NOTE =
  "The look times are scripted for teaching; what he sees, believes and does follows the sim.";

/** Said with the half-turn: what the sim does and does not model. */
export const TOUCH_NOTE =
  "The sim has no first touch or reception mechanics: the half-turn changes his body angle and " +
  "the options open to him next, not the touch.";

/** The scripted looks' directions, as the coach names them. With his back to goal every look up
 * the pitch is behind his body, so these come from the bundle, not from his head against his
 * body. */
export const TEACHING_WORDS: Record<ScanDirection, string> = {
  L: "over his left shoulder",
  R: "over his right shoulder",
  B: "behind him, toward goal",
  F: "forward, up the pitch to the striker",
};
