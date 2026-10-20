// The Producer's failure drill (SPEC 6). Take agents of the crew down for one fresh breakdown: their
// model calls fail as in an outage, so each retries once and airs its template. The panel shows
// which steps ran on the model, on their templates or as code (StepTrace.source). Bring back one
// downed agent: the server resumes the workflow from its checkpoint and re-runs that step, plus
// only the steps that read its output, and the new breakdown replaces the one on screen.

import { AGENTS, type Agent, type StepTrace } from "../api/client";
import type { BreakdownOrigin } from "../breakdown/breakdown";

export interface ProducerState {
  down: Agent[]; // the agents to take down in the next drill, in crew order
  busy: "drill" | Agent | null; // a drill, or the bring-back of that agent, is in flight
  error: string | null; // why the last drill or bring-back failed (the breakdown stays)
}

export const IDLE_PRODUCER: ProducerState = { down: [], busy: null, error: null };

/** The crew in the order of BreakdownResult.trace (agents/workflow.py STEPS). */
export const CREW = [
  "director",
  "analyst",
  "telestrator",
  "narration",
  "verifier",
  "voice",
] as const;

export const STEP_LABEL: Record<(typeof CREW)[number], string> = {
  director: "Director",
  analyst: "Analyst",
  telestrator: "Telestrator",
  narration: "Narration",
  verifier: "Verifier",
  voice: "Voice",
};

/** The note agents/workflow.py adds to a step re-run after its agent came back. */
export const BACK_NOTE = "re-run from the checkpoint: the agent is back";

export interface CrewStep {
  step: (typeof CREW)[number];
  agent: Agent | null; // the agent behind the step; null for the code steps
  source: StepTrace["source"] | null; // null: not known (no breakdown from the service)
  attempts: number;
  error: string | null; // the full error, as in the trace
  errorClass: string | null; // "AgentDown", "TimeoutError", …
  back: boolean; // re-run from the checkpoint after a bring-back
  pending: boolean; // fell back after an error: can be brought back
}

const isAgent = (step: string): step is Agent => (AGENTS as readonly string[]).includes(step);

/** Each crew step of the breakdown on screen, with what its trace says. */
export function crewSteps(origin: BreakdownOrigin | null): CrewStep[] {
  const api = origin?.kind === "api" ? origin : null;
  return CREW.map((step) => {
    const t = api?.trace.find((s) => s.step === step);
    const agent = isAgent(step) ? step : null;
    return {
      step,
      agent,
      source: t?.source ?? null,
      attempts: t?.attempts ?? 0,
      error: t?.error ?? null,
      errorClass: t?.error ? t.error.split(":", 1)[0].trim() : null,
      back: !!t?.notes.includes(BACK_NOTE),
      pending: !!agent && !!api?.drill?.pending.includes(agent),
    };
  });
}

/** `down` with `agent` switched in or out, kept in crew order. */
export function toggled(down: Agent[], agent: Agent): Agent[] {
  const next = down.includes(agent) ? down.filter((a) => a !== agent) : [...down, agent];
  return AGENTS.filter((a) => next.includes(a));
}
