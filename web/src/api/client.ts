// The deployed API service (SPEC 2): the match export, the live stream, cached breakdowns,
// what-if answers, speech and tamper checks. The app uses it when VITE_API_URL is set at build time and the
// service answers quickly; otherwise it plays the bundled files in public/data ("offline data").
// Responses are checked with zod before use, like plans and payloads.

import { z } from "zod";
import { LANGUAGES, type Language } from "../whatif/whatif";

export const MATCH_ID = "blind_side_run-3"; // the default: api/settings.py match_id(scenario, seed)
// agents/schemas.py Persona
export const PERSONAS = ["casual", "analyst", "player_fan", "coach", "audio_description"] as const;
export type Persona = (typeof PERSONAS)[number];
/** Audiences who listen rather than watch (agents/delivery.py DESCRIBED): sound on, large print. */
export const DESCRIBED: ReadonlySet<Persona> = new Set<Persona>(["audio_description"]);
/** The crew steps that call a model: the ones the Producer can take down (agents/schemas.py). */
export const AGENTS = ["director", "analyst", "telestrator", "narration"] as const;
export type Agent = (typeof AGENTS)[number];

export const PROBE_TIMEOUT_MS = 3000; // GET /health: past this, the app runs on offline data
export const EXPORT_TIMEOUT_MS = 15000; // the first request after a start re-simulates (≈ 6 s)
export const BREAKDOWN_TIMEOUT_MS = 60000; // a model-backed breakdown takes ≈ 10 s
export const WHAT_IF_TIMEOUT_MS = 30000;
export const TTS_TIMEOUT_MS = 30000;
export const VERIFY_TIMEOUT_MS = 10000; // the verifier alone, no model: well under a second

/** `fetch`, or a stand-in for tests. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The API base URL from VITE_API_URL, without trailing slashes; null when unset or blank. */
export function apiBase(raw: string | undefined): string | null {
  const value = raw?.trim().replace(/\/+$/, "");
  return value ? value : null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null, // the HTTP status of a refused request
    readonly detail: string | null = null, // the service's `detail`, when it is a sentence
  ) {
    super(message);
  }
}

/** FastAPI's `{"detail": "..."}`, when the detail is one sentence (not a list of field errors). */
function detailOf(body: string): string | null {
  try {
    const detail: unknown = JSON.parse(body)?.detail;
    return typeof detail === "string" ? detail : null;
  } catch {
    return null;
  }
}

export const Health = z.object({
  status: z.literal("ok"),
  version: z.string(),
  model: z.string(),
  speech: z.boolean(),
});

/** One spoken line of a script (agents/schemas.py VoiceCue): when, who, and its SSML. */
export const VoiceCue = z.object({
  line: z.string(),
  speaker: z.string(),
  t: z.number(), // s on the plan clock
  voice: z.string(),
  ssml: z.string(),
  cache_key: z.string(),
});
export type VoiceCue = z.infer<typeof VoiceCue>;

const ScriptResult = z.object({
  persona: z.string(),
  language: z.string(),
  payload: z.unknown(), // a render payload (SPEC 5.3), checked against the moment before use
  voice: z.array(VoiceCue),
});

/** GET /api/matches: the matches the service plays (TTE_MATCHES). */
export const MatchList = z.array(
  z.object({ id: z.string(), scenario: z.string(), seed: z.number() }),
);
export type MatchList = z.infer<typeof MatchList>;

/** GET /api/matches/<id>: what the viewer needs before the export (api/main.py match_info). */
export const MatchInfoResponse = z.object({
  id: z.string(),
  kind: z.enum(["hero", "match"]).default("hero"),
  hero_moment: z.string(), // the first hero moment's id (a hero scenario: its only one)
  hero_moments: z.array(z.string()),
});
export type MatchInfoResponse = z.infer<typeof MatchInfoResponse>;
/** One step of the crew run (agents/schemas.py StepTrace): who answered, the model or a template. */
export const StepTrace = z.object({
  step: z.string(),
  source: z.enum(["llm", "template", "code"]),
  attempts: z.number(),
  ms: z.number(),
  error: z.string().nullable(),
  notes: z.array(z.string()),
});
export type StepTrace = z.infer<typeof StepTrace>;

/** A failure drill's state: the agents still down, and the ones waiting to be brought back. */
export const Drill = z.object({ down: z.array(z.enum(AGENTS)), pending: z.array(z.enum(AGENTS)) });
export type Drill = z.infer<typeof Drill>;

/** POST /api/breakdowns: the crew's result plus where it came from (api/main.py). */
export const BreakdownResponse = z.object({
  key: z.string(),
  cached: z.boolean(),
  rate_limited: z.boolean(),
  capped: z.boolean(),
  source: z.enum(["model", "offline"]),
  drill: Drill.nullish(), // a failure drill; absent or null for a normal breakdown
  result: z.object({
    plan: z.unknown(), // a TelestrationPlan, validated like any other before it plays
    plan_source: z.enum(["agent", "template"]),
    plan_errors: z.array(z.string()),
    scripts: z.array(ScriptResult),
    trace: z.array(StepTrace),
    total_ms: z.number(),
    trace_id: z.string().nullish(), // operation_Id in Application Insights; null: tracing off
  }),
  // A hero moment of a stitched match: its possession. The plan and payload are in the
  // possession's local frames; add `start` for the match clock.
  possession: z
    .object({ index: z.number().int(), start: z.number().int(), local_moment: z.string() })
    .optional(),
});
export type BreakdownResponse = z.infer<typeof BreakdownResponse>;

/** POST /api/whatif (agents/whatif.py WhatIfAnswer). */
export const WhatIfResponse = z.object({
  key: z.string().nullable(),
  cached: z.boolean(),
  capped: z.boolean(),
  answer: z.object({
    question: z.string(),
    language: z.enum(LANGUAGES),
    action: z.string().nullable(), // the option the question was mapped to; null: refused
    refusal: z.string().nullable(),
    counterfactual: z.string().nullable(), // what-if run id, "force:H8:0075:pass:H4"
    factual_action: z.string().nullable(),
    payload: z.unknown(), // render payload of the answer, null when refused
  }),
});
export type WhatIfResponse = z.infer<typeof WhatIfResponse>;

/** POST /api/verify (api/tamper.py): one claim checked with one number changed; not audited. */
export const VerifyResponse = z.object({
  match: z.string(),
  claim: z.string(),
  slot: z.string(),
  language: z.enum(LANGUAGES),
  value: z.number(),
  verified_value: z.number(),
  status: z.enum(["supported", "refuted", "inconclusive"]),
  reason: z.string(),
  line: z.string().nullable(), // the sentence with that number, whether or not it would air
  airs: z.boolean(),
  violations: z.array(z.string()),
});
export type VerifyResponse = z.infer<typeof VerifyResponse>;

export interface Api {
  readonly base: string;
  readonly match: string;
  health(timeoutMs?: number): Promise<z.infer<typeof Health>>;
  matches(): Promise<MatchList>;
  info(timeoutMs?: number): Promise<MatchInfoResponse>;
  exportJson(timeoutMs?: number): Promise<unknown>;
  /** `moment`: a hero moment id (in match time for a stitched match). `fail`: agents taken down
   * for this one run (the failure drill). */
  breakdown(req: {
    moment: string;
    persona: Persona;
    language: Language;
    fail?: Agent[];
  }): Promise<BreakdownResponse>;
  /** Re-run a drill's downed agent from the workflow checkpoint. */
  bringBack(req: { key: string; step: Agent }): Promise<BreakdownResponse>;
  /** `moment`: which hero moment, in a match with several; absent: the first. */
  whatIf(req: {
    question: string;
    language: Language;
    persona: Persona;
    moment?: string;
  }): Promise<WhatIfResponse>;
  tts(ssml: string): Promise<Blob>;
  verify(req: {
    claim: string;
    slot: string;
    value: number;
    language: Language;
    moment?: string;
  }): Promise<VerifyResponse>;
  /** WebSocket URL of the live stream, starting at frame `start`. */
  liveUrl(start: number, speed?: number): string;
  /** The same service for another match (a possession's own scenario run, say). */
  withMatch(match: string): Api;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createApi(
  base: string,
  match: string = MATCH_ID,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Api {
  /** One request, read with `read`, failing after `ms` even if the fetch ignores the abort. */
  async function call<T>(
    path: string,
    init: RequestInit,
    ms: number,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ApiError(`${path}: no answer within ${ms / 1000} s`));
      }, ms);
    });
    const request = (async () => {
      let res: Response;
      try {
        res = await fetchImpl(`${base}${path}`, { ...init, signal: abort.signal });
      } catch (err) {
        throw new ApiError(`${path}: ${message(err)}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ApiError(
          `${path}: HTTP ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`,
          res.status,
          detailOf(detail),
        );
      }
      return read(res);
    })();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  const json = (schema?: z.ZodType) => async (res: Response) => {
    const body: unknown = await res.json();
    if (!schema) return body;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(`unexpected response: ${issue.path.join(".")}: ${issue.message}`);
    }
    return parsed.data;
  };
  const post = (body: object): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const id = encodeURIComponent(match);

  return {
    base,
    match,
    health: (ms = PROBE_TIMEOUT_MS) =>
      call("/health", {}, ms, json(Health)) as Promise<z.infer<typeof Health>>,
    matches: () =>
      call("/api/matches", {}, PROBE_TIMEOUT_MS, json(MatchList)) as Promise<MatchList>,
    info: (ms = EXPORT_TIMEOUT_MS) =>
      call(`/api/matches/${id}`, {}, ms, json(MatchInfoResponse)) as Promise<MatchInfoResponse>,
    exportJson: (ms = EXPORT_TIMEOUT_MS) => call(`/api/matches/${id}/export`, {}, ms, json()),
    breakdown: ({ moment, persona, language, fail = [] }) =>
      call(
        "/api/breakdowns",
        post({
          match,
          moment,
          personas: [persona],
          languages: [language],
          ...(fail.length ? { fail } : {}),
        }),
        BREAKDOWN_TIMEOUT_MS,
        json(BreakdownResponse),
      ) as Promise<BreakdownResponse>,
    bringBack: ({ key, step }) =>
      call(
        `/api/breakdowns/${encodeURIComponent(key)}/bring-back`,
        post({ step }),
        BREAKDOWN_TIMEOUT_MS,
        json(BreakdownResponse),
      ) as Promise<BreakdownResponse>,
    whatIf: ({ question, language, persona, moment }) =>
      call(
        "/api/whatif",
        post({ match, question, language, persona, ...(moment ? { moment } : {}) }),
        WHAT_IF_TIMEOUT_MS,
        json(WhatIfResponse),
      ) as Promise<WhatIfResponse>,
    tts: (ssml) => call("/api/tts", post({ ssml }), TTS_TIMEOUT_MS, (res) => res.blob()),
    verify: ({ claim, slot, value, language, moment }) =>
      call(
        "/api/verify",
        post({ match, claim, slot, value, language, ...(moment ? { moment } : {}) }),
        VERIFY_TIMEOUT_MS,
        json(VerifyResponse),
      ) as Promise<VerifyResponse>,
    liveUrl: (start, speed = 1) =>
      `${base.replace(/^http/, "ws")}/ws/matches/${id}/live?start=${start}&speed=${speed}`,
    withMatch: (other) => createApi(base, other, fetchImpl),
  };
}
