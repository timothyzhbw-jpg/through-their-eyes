// The crew trace (SPEC 6): one real run of the agent crew as a timeline. The workflow records it as
// it runs (agents/crewtrace.py) and the API stores it with the cached breakdown or recap, so
// showing it costs no model call: GET /api/breakdowns/<key>/trace and /api/recaps/<key>/trace.
//
// Every time and duration on it is telemetry, the server's wall clock, never a claim. Text is what
// the crew passed along: ids, verified claim templates (placeholders unfilled), reason codes and
// error classes. A breakdown cached before traces were recorded has none, and says so.

import { z } from "zod";
import type { Api } from "../api/client";

const Json = z.unknown();

export const Payload = z.object({
  type: z.string(),
  summary: z.string(),
  data: Json.nullish(),
  truncated: z.boolean().default(false),
});
export type Payload = z.infer<typeof Payload>;

const ModelCall = z.object({
  role: z.string(),
  persona: z.string().nullish(),
  language: z.string().nullish(),
  source: z.enum(["llm", "template"]),
  attempts: z.number(),
  ms: z.number(),
  error: z.string().nullish(),
});
export type ModelCall = z.infer<typeof ModelCall>;

const ToolCall = z.object({
  name: z.string(),
  arguments: z.record(z.string(), Json),
  result: z.string().nullish(),
  error: z.string().nullish(),
  truncated: z.boolean().default(false),
});
export type ToolCall = z.infer<typeof ToolCall>;

const Rejected = z.object({
  persona: z.string(),
  language: z.string(),
  line: z.string(),
  speaker: z.string(),
  text: z.string(),
  problems: z.array(z.string()),
});

const Rewritten = z.object({
  persona: z.string(),
  language: z.string(),
  line: z.string(),
  speaker: z.string(),
  before: z.string(),
  after: z.string().nullable(),
  claims_before: z.array(z.string()),
  claims_after: z.array(z.string()),
});

export const TraceStep = z.object({
  id: z.string(),
  run: z.number().int(),
  step: z.string(),
  round: z.number().int().nullish(),
  start_ms: z.number(),
  end_ms: z.number(),
  source: z.enum(["llm", "template", "code"]),
  attempts: z.number().default(0),
  error: z.string().nullish(),
  resumed: z.boolean().default(false),
  input: Payload.nullish(),
  output: z.array(Payload).default([]),
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  calls: z.array(ModelCall).default([]),
  tools: z.array(ToolCall).default([]),
  rejected: z.array(Rejected).default([]),
  rewritten: z.array(Rewritten).default([]),
  notes: z.array(z.string()).default([]),
  span_id: z.string().nullish(),
});
export type TraceStep = z.infer<typeof TraceStep>;

export const TraceEvent = z.object({
  run: z.number().int(),
  t_ms: z.number(),
  kind: z.enum(["down", "fallback", "waiting", "checkpoint", "back", "resumed"]),
  step: z.string().nullish(),
  detail: z.string(),
  checkpoint: z.string().nullish(),
  superstep: z.number().int().nullish(),
  keys: z.array(z.string()).default([]),
});
export type TraceEvent = z.infer<typeof TraceEvent>;

export const TraceRun = z.object({
  index: z.number().int(),
  kind: z.enum(["run", "bring_back", "resume"]),
  step: z.string().nullish(),
  started: z.string(),
  total_ms: z.number().nullable(),
  model: z.string(),
  down: z.array(z.string()).default([]),
  pending: z.array(z.string()).default([]),
  trace_id: z.string().nullish(),
});
export type TraceRun = z.infer<typeof TraceRun>;

export const CrewTrace = z.object({
  version: z.literal(1),
  story: z.string(),
  subject: z.string(),
  runs: z.array(TraceRun),
  steps: z.array(TraceStep),
  events: z.array(TraceEvent),
});
export type CrewTrace = z.infer<typeof CrewTrace>;

/** GET …/trace (api/main.py `_traced`). */
export const TraceResponse = z.object({
  key: z.string(),
  recorded: z.boolean(),
  trace: CrewTrace.nullable(),
  detail: z.string().optional(),
});
export type TraceResponse = z.infer<typeof TraceResponse>;

export const NOT_RECORDED = "trace not recorded for this cached run"; // api/main.py NOT_RECORDED

export type TraceKind = "breakdowns" | "recaps";

export type TraceState =
  | { status: "loading" }
  | { status: "ready"; trace: CrewTrace }
  | { status: "missing" } // cached before traces were recorded
  | { status: "failed"; error: string };

/** Ask the service for a breakdown's or a recap's crew trace. */
export async function loadTrace(api: Api, kind: TraceKind, key: string): Promise<TraceState> {
  try {
    const res = TraceResponse.safeParse(await api.trace(kind, key));
    if (!res.success) {
      const issue = res.error.issues[0];
      return { status: "failed", error: `unexpected trace: ${issue.path.join(".")}` };
    }
    return res.data.recorded && res.data.trace
      ? { status: "ready", trace: res.data.trace }
      : { status: "missing" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- the timeline ----------

/** The lanes, in the graph's order (agents/workflow.py STEPS); the MCP server starts first. */
export const LANES = [
  "mcp",
  "director",
  "analyst",
  "telestrator",
  "narration",
  "verifier",
  "voice",
] as const;

export const LANE_LABEL: Record<string, string> = {
  mcp: "MCP server",
  director: "Director",
  analyst: "Analyst",
  telestrator: "Telestrator",
  narration: "Narration",
  verifier: "Verifier",
  voice: "Voice",
};

export const SOURCE_LABEL = { llm: "Model", template: "Template", code: "Code" } as const;

export const RUN_LABEL: Record<TraceRun["kind"], string> = {
  run: "The run",
  bring_back: "Bring-back",
  resume: "Resumed run",
};

export interface Bar {
  step: TraceStep;
  left: number; // % of the run's span
  width: number; // %, at least MIN_WIDTH so a step of code stays visible
}

export interface Mark {
  event: TraceEvent;
  left: number; // %
}

export interface RunLane {
  lane: string;
  bars: Bar[];
}

export interface RunView {
  run: TraceRun;
  span: number; // ms the run's axis covers
  lanes: RunLane[];
  marks: Mark[];
  events: TraceEvent[]; // in time order
}

const MIN_WIDTH = 0.8;

/** Each run of the trace on its own axis: its lanes with their bars, and its events. */
export function timeline(trace: CrewTrace): RunView[] {
  const used = new Set(trace.steps.map((s) => s.step));
  const lanes = [
    ...LANES.filter((l) => used.has(l)),
    ...[...used].filter((l) => !(LANES as readonly string[]).includes(l)),
  ];
  return trace.runs.map((run) => {
    const steps = trace.steps.filter((s) => s.run === run.index);
    const events = trace.events.filter((e) => e.run === run.index).sort((a, b) => a.t_ms - b.t_ms);
    const span = Math.max(
      1,
      run.total_ms ?? 0,
      ...steps.map((s) => s.end_ms),
      ...events.map((e) => e.t_ms),
    );
    const pct = (ms: number) => Math.min(100, Math.max(0, (100 * ms) / span));
    return {
      run,
      span,
      lanes: lanes
        .filter((lane) => lane !== "mcp" || steps.some((s) => s.step === "mcp"))
        .map((lane) => ({
          lane,
          bars: steps
            .filter((s) => s.step === lane)
            .map((step) => {
              const left = pct(step.start_ms);
              const width = Math.max(MIN_WIDTH, pct(step.end_ms) - left);
              return { step, left: Math.min(left, 100 - width), width };
            }),
        })),
      marks: events.map((event) => ({ event, left: pct(event.t_ms) })),
      events,
    };
  });
}

/** A duration or a time on the run's clock: "6.5 ms", "1.24 s". Telemetry. */
export function ms(value: number): string {
  if (value < 1000) return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** "Narration · rewrite 1", "Verifier · round 2", "Telestrator". */
export function stepTitle(step: TraceStep): string {
  const name = LANE_LABEL[step.step] ?? step.step;
  if (step.round == null) return name;
  if (step.step === "narration")
    return step.round === 0 ? `${name} · draft` : `${name} · rewrite ${step.round}`;
  return `${name} · round ${step.round + 1}`;
}

/** The run a step belongs to, as a reader would name it. */
export function runTitle(run: TraceRun): string {
  if (run.kind === "bring_back" && run.step)
    return `${RUN_LABEL.bring_back}: the ${LANE_LABEL[run.step] ?? run.step}`;
  return RUN_LABEL[run.kind];
}

/** The class an error message names: "AgentDown: the telestrator is down" -> "AgentDown". */
export const errorClass = (error: string | null | undefined): string | null =>
  error ? error.split(":", 1)[0].trim() || null : null;

/** The step to show first: the first one that fell back, else the first of the last run. */
export function firstStep(trace: CrewTrace): TraceStep | null {
  const last = trace.runs.at(-1)?.index ?? 0;
  return (
    trace.steps.find((s) => s.source === "template" && s.error) ??
    trace.steps.find((s) => s.run === last && s.step !== "mcp") ??
    trace.steps[0] ??
    null
  );
}
