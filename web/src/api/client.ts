// The deployed API service (SPEC 2): the match export, the live stream, cached breakdowns,
// what-if answers and speech. The app uses it when VITE_API_URL is set at build time and the
// service answers quickly; otherwise it plays the bundled files in public/data ("offline data").
// Responses are checked with zod before use, like plans and payloads.

import { z } from "zod";
import { LANGUAGES, type Language } from "../whatif/whatif";

export const MATCH_ID = "blind_side_run-3"; // api/store.py match_id(scenario, seed)
export const PERSONAS = ["casual", "analyst", "player_fan", "coach"] as const; // agents/schemas.py
export type Persona = (typeof PERSONAS)[number];

export const PROBE_TIMEOUT_MS = 3000; // GET /health: past this, the app runs on offline data
export const EXPORT_TIMEOUT_MS = 15000; // the first request after a start re-simulates (≈ 6 s)
export const BREAKDOWN_TIMEOUT_MS = 60000; // a model-backed breakdown takes ≈ 10 s
export const WHAT_IF_TIMEOUT_MS = 30000;
export const TTS_TIMEOUT_MS = 30000;

/** `fetch`, or a stand-in for tests. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The API base URL from VITE_API_URL, without trailing slashes; null when unset or blank. */
export function apiBase(raw: string | undefined): string | null {
  const value = raw?.trim().replace(/\/+$/, "");
  return value ? value : null;
}

export class ApiError extends Error {}

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

/** POST /api/breakdowns: the crew's result plus where it came from (api/main.py). */
export const BreakdownResponse = z.object({
  key: z.string(),
  cached: z.boolean(),
  rate_limited: z.boolean(),
  capped: z.boolean(),
  source: z.enum(["model", "offline"]),
  result: z.object({
    plan: z.unknown(), // a TelestrationPlan, validated like any other before it plays
    plan_source: z.enum(["agent", "template"]),
    plan_errors: z.array(z.string()),
    scripts: z.array(ScriptResult),
    total_ms: z.number(),
  }),
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

export interface Api {
  readonly base: string;
  readonly match: string;
  health(timeoutMs?: number): Promise<z.infer<typeof Health>>;
  exportJson(timeoutMs?: number): Promise<unknown>;
  breakdown(req: {
    moment: string;
    persona: Persona;
    language: Language;
  }): Promise<BreakdownResponse>;
  whatIf(req: { question: string; language: Language; persona: Persona }): Promise<WhatIfResponse>;
  tts(ssml: string): Promise<Blob>;
  /** WebSocket URL of the live stream, starting at frame `start`. */
  liveUrl(start: number, speed?: number): string;
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
    exportJson: (ms = EXPORT_TIMEOUT_MS) => call(`/api/matches/${id}/export`, {}, ms, json()),
    breakdown: ({ moment, persona, language }) =>
      call(
        "/api/breakdowns",
        post({ match, moment, personas: [persona], languages: [language] }),
        BREAKDOWN_TIMEOUT_MS,
        json(BreakdownResponse),
      ) as Promise<BreakdownResponse>,
    whatIf: ({ question, language, persona }) =>
      call(
        "/api/whatif",
        post({ match, question, language, persona }),
        WHAT_IF_TIMEOUT_MS,
        json(WhatIfResponse),
      ) as Promise<WhatIfResponse>,
    tts: (ssml) => call("/api/tts", post({ ssml }), TTS_TIMEOUT_MS, (res) => res.blob()),
    liveUrl: (start, speed = 1) =>
      `${base.replace(/^http/, "ws")}/ws/matches/${id}/live?start=${start}&speed=${speed}`,
  };
}
