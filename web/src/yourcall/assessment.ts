// "Your call" (SPEC 7): how the decision model rated the option the viewer picked, read from the
// decision record of the sim export (hero.runs.factual.decision.options): the weight his belief
// gave it (softmax chance), what he thought it would do (P(success) and xT on his belief), and
// what was true (the same option re-scored on the true state). Nothing here is typed by hand: each
// number is formatted from the export, and the card marks them as read from the sim, not verified
// claims. Whether the option has a re-simulated outcome is told beside it, never invented.

import type { Hero } from "../data/hero";
import { isShot } from "../data/hero";
import { shortName } from "../data/roster";
import { hasRun, type CallOption } from "./options";

export const LABEL_RESIMULATED = "Re-simulated";
export const LABEL_HAPPENED = "What happened";
export const LABEL_NOT_RESIMULATED = "Not re-simulated in this demo";

export interface AssessmentRow {
  label: string;
  value: string; // formatted from the export
}

export interface Assessment {
  action: string;
  outcome: "factual" | "resimulated" | "none";
  outcomeLabel: string; // LABEL_*
  believed: AssessmentRow[]; // what he believed about the option at that moment
  truth: AssessmentRow[]; // what was true
}

const percent = (p: number) => `${Math.round(p * 100)}%`;
const fixed = (v: number, digits: number) => v.toFixed(digits);
const xt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} xT`;

/** The model's view of `option` at his decision; null when the export has no such option. */
export function assessmentOf(hero: Hero, option: CallOption): Assessment | null {
  const d = hero.runs.factual.decision;
  const o = d?.options.find((x) => x.action === option.action);
  if (!d || !o) return null;
  const aim = isShot(o.action) ? "score" : "arrive";
  const outcome = option.factual ? "factual" : hasRun(option) ? "resimulated" : "none";

  const believed: AssessmentRow[] = [
    { label: "Weight his picture gave it", value: percent(o.prob) },
    { label: `He thought it would ${aim}`, value: fixed(o.p_success, 2) },
    { label: "Value, as he saw it", value: xt(o.value) },
  ];
  const truth: AssessmentRow[] = [];
  if (o.p_success_true === null) {
    truth.push({ label: `Would it ${aim}`, value: "not playable on the true state" });
  } else {
    truth.push({ label: `It would ${aim}`, value: fixed(o.p_success_true, 2) });
    if (o.value_true !== null)
      truth.push({ label: "Value, on the truth", value: xt(o.value_true) });
  }
  const error = o.receiver ? d.belief_error[o.receiver] : undefined;
  if (o.receiver && error !== undefined) {
    truth.push({
      label: `${shortName(o.receiver)} was`,
      value: `${fixed(error, 1)} m from where he pictured him`,
    });
  }
  return {
    action: o.action,
    outcome,
    outcomeLabel:
      outcome === "factual"
        ? LABEL_HAPPENED
        : outcome === "resimulated"
          ? LABEL_RESIMULATED
          : LABEL_NOT_RESIMULATED,
    believed,
    truth,
  };
}
