// Test stand-ins for the live service: a routed fetch, a scripted WebSocket, stream messages built
// from the bundled export, responses in the shapes api/main.py returns (copied from the deployed
// service for blind_side_run seed 3), and server-side rendering of components with a session.

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import raw from "../public/data/hero_seed3.json";
import type { Fetch } from "./api/client";
import type { HeroExport } from "./data/types";
import type { SocketFactory, SocketLike } from "./live/feed";
import { SessionContext, type Session } from "./session";

export const API = "https://api.test";
export const exportJson = raw as unknown as HeroExport;

type Reply = Response | "hang" | "fail";
export type Route = (body: unknown) => Reply | Promise<Reply>;
export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers "METHOD /path" routes (any host) and records every call. Unrouted: 404. */
export function fakeFetch(routes: Record<string, Route>): Fetch & { calls: Call[] } {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url, "http://localhost").pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    const reply = route ? await route(body) : json({ detail: "not found" }, 404);
    if (reply === "fail") throw new TypeError("Failed to fetch");
    if (reply === "hang") return new Promise<Response>(() => {});
    return reply;
  };
  return Object.assign(f, { calls });
}

/** The API's health answer. */
export const health = () =>
  json({ status: "ok", version: "0.4.0", model: "foundry", speech: true });

/** A WebSocket the test plays the server side of. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(...messages: object[]) {
    for (const m of messages) this.onmessage?.({ data: JSON.stringify(m) });
  }
  /** The server closes the connection. */
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

export function fakeSockets(): SocketFactory & { sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const factory = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return Object.assign(factory, { sockets });
}

// ---------- the live stream (api/live.py) ----------

export const hello = () => ({
  type: "hello",
  match: "blind_side_run-3",
  dt: exportJson.dt,
  frames: exportJson.runs.factual.frames,
  players: exportJson.players,
  hero: exportJson.hero,
});

export function frameMsg(f: number, patch: object = {}) {
  const run = exportJson.runs.factual;
  return {
    type: "frame",
    f,
    t: Math.round(f * exportJson.dt * 1000) / 1000,
    pos: run.pos[f],
    body: run.body[f],
    head: run.head[f],
    ball: run.ball[f],
    owner: run.owner[f],
    sprint: [],
    blind_side: run.blind_side.frames[f],
    ...patch,
  };
}

export const eventMsg = (f: number) => ({
  type: "event",
  event: exportJson.runs.factual.events.find((e) => e.frame === f) ?? {
    id: `scan:H8:${String(f).padStart(4, "0")}`,
    type: "scan",
    frame: f,
    player: "H8",
    attrs: {},
  },
});

export const card = (id: string, frameEnd: number, anchor = frameEnd) => ({
  version: 1,
  id,
  kind: id.split(":")[1],
  actor: id.split(":")[2],
  receiver: null,
  anchor_frame: anchor,
  frame_end: frameEnd,
  anchor_t: anchor * exportJson.dt,
  selected_lens: "scan",
});
export const HERO_MOMENT = "m:decision_after_scan:H8:0075";
export const momentMsg = (id: string, frameEnd: number) => ({
  type: "moment",
  card: card(id, frameEnd),
});

// ---------- POST /api/breakdowns ----------

const ssml = (text: string) => `<speak version="1.0" xml:lang="en-US">${text}</speak>`;

type Source = "llm" | "template" | "code";

/** A crew trace (agents/schemas.py StepTrace): every agent on the model unless `sources` says. */
export function crewTrace(
  sources: Partial<Record<string, Source>> = {},
  patch: Partial<Record<string, { error?: string; notes?: string[]; attempts?: number }>> = {},
) {
  const steps = ["director", "analyst", "telestrator", "narration", "verifier", "voice"];
  return steps.map((step) => {
    const source = sources[step] ?? (step === "verifier" || step === "voice" ? "code" : "llm");
    return {
      step,
      source,
      attempts: patch[step]?.attempts ?? 1,
      ms: 1200.5,
      error: patch[step]?.error ?? null,
      notes: patch[step]?.notes ?? [],
    };
  });
}

/** The trace of a drill with the Telestrator down: its call and the retry raised AgentDown. */
export const telestratorDownTrace = () =>
  crewTrace(
    { telestrator: "template" },
    { telestrator: { error: "AgentDown: the telestrator is down", attempts: 2 } },
  );

/** The casual / en script of the deployed service's breakdown (Telestrator plan + 3 lines). */
export function breakdownResponse(
  flags: Partial<{ cached: boolean; rate_limited: boolean; capped: boolean }> = {},
  patch: {
    persona?: string;
    language?: string;
    payload?: object;
    key?: string;
    trace?: object[];
    trace_id?: string | null;
    drill?: { down: string[]; pending: string[] } | null;
    plan_source?: "agent" | "template";
  } = {},
) {
  const persona = patch.persona ?? "casual";
  const language = patch.language ?? "en";
  const lines = [
    {
      id: "L1",
      text: "What did he see? H8 checked his shoulder before the ball reached him.",
      claims: ["scan_before_reception"],
    },
    {
      id: "L2",
      text: "Here's why. That look was worth 0.11 in expected threat.",
      claims: ["cf_value"],
    },
    { id: "L3", text: "Without that look, H8 would have passed to H4.", claims: ["cf_pass"] },
  ];
  return {
    key: patch.key ?? "d05e90c31e6fdbe42d0e9c63a1d1e0ce",
    cached: flags.cached ?? true,
    rate_limited: flags.rate_limited ?? false,
    capped: flags.capped ?? false,
    source: "model",
    drill: patch.drill ?? null,
    result: {
      request: { moment: HERO_MOMENT, personas: [persona], languages: [language] },
      plan: {
        moment: HERO_MOMENT,
        duration_s: 10.0,
        steps: [
          { t: 0.0, do: "freeze" },
          { t: 0.3, do: "rewind", to: -1.0 },
          { t: 0.5, do: "zone", layer: "vision", player: "H8" },
          { t: 0.7, do: "camera", mode: "pov" },
          { t: 1.0, do: "pov", player: "H8", from: -1.0, to: 0.0, speed: 0.5 },
          {
            t: 1.3,
            do: "scan_marker",
            scan: "scan:H8:0050",
            label_claim: "scan_before_reception",
          },
          { t: 1.5, do: "ghost", kind: "belief", cf: null },
          { t: 4.5, do: "camera", mode: "split" },
          { t: 4.7, do: "play", to: 3.5, speed: 1.0 },
          { t: 7.5, do: "ghost", kind: "counterfactual", cf: "cf1" },
        ],
      },
      plan_source: patch.plan_source ?? "agent",
      plan_errors: [],
      tier: "excited",
      scripts: [
        {
          persona,
          language,
          lines: [],
          payload: patch.payload ?? {
            moment: HERO_MOMENT,
            persona,
            language,
            lines,
            claims: [
              {
                id: "scan_before_reception",
                kind: "observed",
                verdict: "supported",
                values: {},
                evidence: ["scan:H8:0050", "reception:H8:0070"],
                seek_frame: 50,
              },
              {
                id: "cf_value",
                kind: "counterfactual",
                verdict: "supported",
                values: { dxt: 0.11 },
                evidence: ["scan:H8:0050"],
                seek_frame: 50,
              },
              {
                id: "cf_pass",
                kind: "counterfactual",
                verdict: "supported",
                values: {},
                evidence: ["scan:H8:0050"],
                seek_frame: 50,
              },
            ],
          },
          dropped: [],
          rewrites: 0,
          voice: lines.map((l, k) => ({
            line: l.id,
            speaker: k % 2 ? "color" : "pbp",
            t: [0.2, 3.13, 6.07][k],
            voice: "en-US-DavisNeural",
            style: null,
            ssml: ssml(l.text),
            cache_key: `cue${k}`,
          })),
        },
      ],
      trace: patch.trace ?? crewTrace(),
      total_ms: 6260.9,
      trace_id: patch.trace_id === undefined ? "4bf92f3577b34da6a3ce929d0e0e4736" : patch.trace_id,
    },
  };
}

// ---------- POST /api/whatif ----------

export function whatIfResponse(question: string) {
  return {
    key: "8ff45b99fdaa131ba1b7c1cf495c7f8f",
    cached: true,
    capped: false,
    answer: {
      question,
      language: "en",
      action: "pass:H4",
      source: "llm",
      refusal: null,
      counterfactual: "force:H8:0075:pass:H4",
      factual_action: "pass:H9",
      claims: [],
      payload: {
        moment: `${HERO_MOMENT}?force:H8:0075:pass:H4`,
        persona: "analyst",
        language: "en",
        lines: [
          {
            id: "Q1",
            text: "If H8 had passed to H4, H4 would have received it.",
            claims: ["whatif_outcome"],
          },
          {
            id: "Q2",
            text: "That option would have been worth 0.11 less in expected threat than what he did.",
            claims: ["whatif_value"],
          },
        ],
        claims: [
          {
            id: "whatif_outcome",
            kind: "counterfactual",
            verdict: "supported",
            values: {},
            evidence: ["pass:H8:0075"],
            seek_frame: 75,
          },
          {
            id: "whatif_value",
            kind: "counterfactual",
            verdict: "supported",
            values: { dxt: 0.11 },
            evidence: ["pass:H8:0075"],
            seek_frame: 75,
          },
        ],
      },
    },
  };
}

export function refusalResponse(question: string) {
  return {
    key: null,
    cached: false,
    capped: true,
    answer: {
      question,
      language: "en",
      action: null,
      source: "template",
      refusal: "That is not something he could do from there.",
      counterfactual: null,
      factual_action: "pass:H9",
      claims: [],
      payload: null,
    },
  };
}

// ---------- rendering ----------

/** Server-render `node` inside the session's context: the HTML a viewer would get. */
export function render(session: Session, node: ReactNode): string {
  return renderToStaticMarkup(
    <SessionContext.Provider value={session}>{node}</SessionContext.Provider>,
  );
}

/** Let pending promises (fake fetches, their JSON) run. */
export async function settle(): Promise<void> {
  for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
}
