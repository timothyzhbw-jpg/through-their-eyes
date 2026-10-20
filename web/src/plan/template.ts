// The fallback plan: built from the moment alone, so it is valid by construction for any seed.
// Freeze, rewind to just before the key scan, POV through it, mark it, show the beliefs, play the
// outcome, then the counterfactual ghost. A hero without a key scan (a pressure moment) gets the
// POV of the last 2.4 s up to his decision and no scan marker, like agents/plan.py's template.
// No voice steps: it needs no Script.

import { frameToRel, type MomentContext } from "./moment";
import type { PlanStep, TelestrationPlan } from "./schema";

const POV_SPEED = 0.5;
const POV_LEAD_S = 0.6; // POV starts this long before the key scan
const POV_MAX_S = 2.4; // below MAX_POV_CLIP_S
const OUTCOME_S = 2.0; // match time shown after the decision

const round = (x: number) => Math.round(x * 100) / 100;

export function templatePlan(m: MomentContext): TelestrationPlan {
  const first = frameToRel(m, 0);
  const last = frameToRel(m, m.frames - 1);
  const decision = frameToRel(m, m.decisionFrame);
  const lead = m.keyScan ? frameToRel(m, m.keyScan.start) - POV_LEAD_S : decision - POV_MAX_S;

  const from = round(Math.max(first, lead));
  const to = round(Math.min(last, from + POV_MAX_S, Math.max(decision, from + 0.4)));
  const playTo = round(Math.min(last, Math.max(to, decision + OUTCOME_S)));
  const povStart = 1.2;
  const povEnd = round(povStart + (to - from) / POV_SPEED);
  const playStart = round(povEnd + 0.6);
  const playEnd = round(playStart + (playTo - to));

  const steps: PlanStep[] = [
    { t: 0, do: "freeze" },
    { t: 0.4, do: "rewind", to: from },
    { t: 0.6, do: "zone", layer: "vision", player: m.hero },
    { t: 0.8, do: "camera", mode: "pov" },
    { t: povStart, do: "pov", player: m.hero, from, to, speed: POV_SPEED },
    ...(m.keyScan ? [{ t: 1.4, do: "scan_marker" as const, scan: m.keyScan.id }] : []),
    { t: 1.6, do: "ghost", kind: "belief" },
    { t: round(povEnd + 0.4), do: "camera", mode: "split" },
    { t: playStart, do: "play", to: playTo, speed: 1 },
    { t: round(playEnd + 0.4), do: "ghost", kind: "counterfactual", cf: m.counterfactual },
  ];
  return { moment: m.id, duration_s: round(playEnd + 3), steps };
}
