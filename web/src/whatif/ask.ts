// Free "What if…?" questions (SPEC 6, 7) go to the live service, POST /api/whatif: it maps the
// question to one of the hero's options (or refuses), forces it, re-simulates and verifies the
// answer. The answer's payload is checked like a precomputed one; when the bundled what-ifs hold
// the forced run of that option, it is drawn as the ghost path.

import type { WhatIfResponse } from "../api/client";
import type { Hero } from "../data/hero";
import { checkPayload, type Narration } from "../narration/payload";
import type { MomentContext } from "../plan/moment";
import { optionOf, type Language, type WhatIfs } from "./whatif";

export const MAX_QUESTION = 300; // api/main.py WhatIfBody

export interface AskState {
  status: "idle" | "asking" | "answered" | "refused" | "failed";
  question: string;
  language: Language;
  action: string | null; // the option the question was mapped to
  narration: Narration | null; // the verified answer
  refusal: string | null; // the service's refusal, when the question matches no option
  cached: boolean;
  capped: boolean; // the daily model cap was reached: the question was mapped by rules
  error: string | null;
}

export const IDLE_ASK: AskState = {
  status: "idle",
  question: "",
  language: "en",
  action: null,
  narration: null,
  refusal: null,
  cached: false,
  capped: false,
  error: null,
};

/** The service's answer, checked against the moment and, if known, the forced run. */
export function answerOf(
  res: WhatIfResponse,
  hero: Hero,
  m: MomentContext,
  whatIfs: WhatIfs | null,
): AskState {
  const a = res.answer;
  const base = {
    ...IDLE_ASK,
    question: a.question,
    language: a.language,
    action: a.action,
    cached: res.cached,
    capped: res.capped,
  };
  if (a.action === null || a.payload == null) {
    return { ...base, status: "refused", refusal: a.refusal ?? "No answer to that question." };
  }
  const run = optionOf(whatIfs, a.action)?.run ?? null;
  const checked = checkPayload(a.payload, {
    moment: `${m.id}?${a.counterfactual}`,
    events: new Set([
      ...hero.runs.factual.events.map((e) => e.id),
      ...(run?.events ?? []).map((e) => e.id),
    ]),
    frames: () => Math.max(hero.runs.factual.frames, run ? run.start + run.frames : 0),
  });
  if (!checked.ok) {
    return {
      ...base,
      status: "failed",
      error: `the answer failed its checks: ${checked.errors[0]}`,
    };
  }
  return { ...base, status: "answered", narration: checked.narration };
}
