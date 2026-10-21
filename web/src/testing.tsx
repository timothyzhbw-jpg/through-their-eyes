// Test stand-ins for the live service: a routed fetch, a scripted WebSocket, stream messages built
// from the bundled export, responses in the shapes api/main.py returns (copied from the deployed
// service for blind_side_run seed 3), a pressure hero and a stitched match built from the bundled
// export, and server-side rendering of components with a session.

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import raw from "../public/data/hero_seed3.json";
import type { Fetch } from "./api/client";
import type { ExportEvent, ExportMatchMoment, HeroExport, MatchExport } from "./data/types";
import type { SocketFactory, SocketLike } from "./live/feed";
import { SessionContext, type ViewSession } from "./session";

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

// ---------- POST /api/verify ----------

/**
 * A tamper check of cf_value.dxt as the local service answers it (api/tamper.py): `value` other
 * than the verified 0.11 is refuted.
 */
export function verifyResponse(
  value: number,
  patch: Partial<{ status: string; reason: string; line: string | null; airs: boolean }> = {},
) {
  const supported = value === 0.11;
  const text = `That look was worth ${value.toFixed(2)} in expected threat.`;
  return {
    match: "blind_side_run-3",
    claim: "cf_value",
    slot: "dxt",
    language: "en",
    value,
    verified_value: 0.11,
    status: supported ? "supported" : "refuted",
    reason: supported
      ? "approx(0.11074015198311513, 0.11) holds"
      : `approx(0.11074015198311513, ${value}) is false`,
    trace: [{ op: "approx", lhs: 0.11074015198311513, rhs: value, holds: supported }],
    line: text,
    airs: supported,
    violations: supported
      ? []
      : [`unsupported_claim: cf_value: refuted (approx(0.11074015198311513, ${value}) is false)`],
    audited: false,
    ...patch,
  };
}

// ---------- rendering ----------

// ---------- a pressure hero and a stitched match ----------
//
// Stand-ins with the shapes the API serves for press_escape seed 0 and match 1 (sim.export), built
// from the bundled export so the tests stay small: the pressure hero is the bundled moment without
// a key scan, its counterfactual forcing a carry; the match stitches three possessions.

export const PRESS_MOMENT = "m:pressed_decision:H8:0075";

/** Like press_escape-0: `key_scan` null, the counterfactual forces a carry (no pass, no runner). */
export function pressureExport(): HeroExport {
  const e = structuredClone(exportJson);
  for (const run of Object.values(e.runs)) {
    for (const ev of run.events) if (ev.type === "scan") ev.attrs = { ...ev.attrs, key: false };
  }
  const cf = e.runs.counterfactual;
  if (cf.decision) cf.decision = { ...cf.decision, chosen: "carry" };
  cf.action = null; // a carry is not a pass: the ghost runs to the end of the re-simulated run
  return {
    ...e,
    scenario: "press_escape",
    seed: 0,
    runner: null,
    key_scan: null,
    counterfactual: { id: "cf1", intervention: "force_action", action: "carry" },
  };
}

export const MARKER_MOMENT = "m:marker_scan:H8:0139";
export const MARKER_SHIFT_M = 6; // how much further from his man the marker is without the look

/**
 * Like corner_blind_side-0: a marker's look (SPEC 5.1 `marker_scan`), a hero with a key scan and
 * no decision on the ball, so `decision`, `action`, `possession_value` and `delta_xt` are null (the
 * sim's NaN, as the service sends it). The bundled factual run, where the pass to H9 is the pass
 * to his man; in the counterfactual the key scan is dropped and H8 is MARKER_SHIFT_M m further
 * towards −x from the scan on.
 */
export function markerExport(): HeroExport {
  const e = structuredClone(exportJson);
  const key = e.key_scan!;
  const h = e.players.findIndex((p) => p.id === e.hero);
  const factual = e.runs.factual;
  const cf = structuredClone(factual);
  cf.events = cf.events.filter((ev) => ev.id !== key.id);
  cf.pos = cf.pos.map((row, f) =>
    f <= key.start ? row : row.map((v, k) => (k === 2 * h ? v - MARKER_SHIFT_M * 1000 : v)),
  );
  for (const run of [factual, cf]) {
    run.decision = null;
    run.action = null;
    run.possession_value = null;
  }
  return {
    ...e,
    scenario: "corner_blind_side",
    seed: 0,
    delta_xt: null,
    runs: { factual, counterfactual: cf },
  };
}

/** GET /api/matches/<id>/moments for the marker: its card with the scan lens's delta. */
export const markerCards = (delta: number | null = 0.09596) => [
  {
    id: MARKER_MOMENT,
    kind: "marker_scan",
    actor: "H8",
    receiver: "H9",
    anchor_frame: 139,
    selected_lens: "scan",
    lenses: [
      { lens: "scan", available: delta !== null, delta_xt: delta, metrics: {} },
      { lens: "space", available: false, delta_xt: null, metrics: {} },
    ],
  },
];

export const SHOT_MOMENT = "m:decision_after_scan:H8:0075";

/**
 * Like far_post_finish-11 (Module A placed shots, SPEC 3.3): the hero's options include
 * `shot:far` and `shot:near`. With the look he shoots at the far post and scores; without it he
 * shoots at the near post and A1 saves. The bundled runs, with the hero's pass at the decision
 * turned into the shot as sim.export writes it: an action with `aim`, `placement` and `keeper`
 * (no `to` or `target`), and `shot`, `dive` and `goal` / `save` events.
 */
export function shotExport(): HeroExport {
  const e = structuredClone(exportJson);
  const pad = (f: number) => String(f).padStart(4, "0");
  for (const [name, placement, outcome] of [
    ["factual", "far", "goal"],
    ["counterfactual", "near", "saved"],
  ] as const) {
    const run = e.runs[name];
    const d = run.decision!;
    const f = d.frame;
    const end = f + 15;
    const aim: [number, number] = [52.5, placement === "far" ? 3.16 : -3.16];
    const [first, second, ...rest] = d.options;
    const far = { ...first, action: "shot:far", target: [52.5, 3.16] as [number, number] };
    const near = { ...second, action: "shot:near", target: [52.5, -3.16] as [number, number] };
    d.options = placement === "far" ? [far, near, ...rest] : [near, far, ...rest];
    d.chosen = `shot:${placement}`;
    run.action = {
      frame: f,
      start: run.action!.start,
      aim,
      placement,
      keeper: "A1",
      speed: 27.6,
      distance: 50,
      outcome,
      end,
      end_at: aim,
    };
    const shotEnds = run.events.find((ev) => ev.type === "pass" && ev.frame === f)?.attrs.end;
    run.events = run.events.filter(
      (ev) => !(ev.frame === f && ev.type === "pass") && !(ev.frame === shotEnds),
    );
    run.events.push(
      { id: `shot:H8:${pad(f)}`, type: "shot", frame: f, player: "H8",
attrs: { placement, outcome, end } },
      { id: `dive:A1:${pad(f + 5)}`, type: "dive", frame: f + 5, player: "A1", attrs: {} },
      outcome === "goal"
        ? { id: `goal:H8:${pad(end)}`, type: "goal", frame: end, player: "H8", attrs: {} }
        : { id: `save:A1:${pad(end)}`, type: "save", frame: end, player: "A1", attrs: {} },
    ); // prettier-ignore
    run.events.sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
  }
  return { ...e, scenario: "far_post_finish", seed: 11, runner: null };
}

export const CUTBACK_MOMENT = "m:decision_after_scan:H8:0075";

/**
 * Like cutback_scan-7: an ordinary scan hero that is not blind_side_run. With the look he passes
 * to the runner; without it he carries the ball, so the counterfactual run has no action (a carry
 * is not a pass), as sim.export writes it. The bundled runs, renamed.
 */
export function cutbackExport(): HeroExport {
  const e = structuredClone(exportJson);
  const cf = e.runs.counterfactual;
  const [first, ...rest] = cf.decision!.options;
  const carry = rest.find((o) => o.action === "carry") ?? { ...first, action: "carry" };
  cf.decision = {
    ...cf.decision!,
    chosen: "carry",
    options: [
      { ...carry, prob: 0.76 },
      ...cf.decision!.options.filter((o) => o.action !== "carry"),
    ],
  };
  const passFrame = cf.decision.frame;
  const ends = cf.events.find((ev) => ev.type === "pass" && ev.frame === passFrame)?.attrs.end;
  cf.events = cf.events.filter(
    (ev) =>
      !(ev.type === "pass" && ev.frame === passFrame) &&
      !(ev.type === "reception" && ev.frame === ends),
  );
  cf.action = null;
  return { ...e, scenario: "cutback_scan", seed: 7 };
}

export const MATCH = "match-1";
export const OPEN_FRAMES = 60; // the opening open-play possession: the bundled run's first 60 frames
export const BLIND_START = OPEN_FRAMES; // possession 1: blind_side_run 3
export const PRESS_START = OPEN_FRAMES + exportJson.runs.factual.frames; // possession 2: press_escape 0
export const MATCH_HERO = "m:decision_after_scan:H8:0135"; // HERO_MOMENT in match time
export const MATCH_PRESS = "m:pressed_decision:H8:0300"; // PRESS_MOMENT in match time
export const GOAL_FRAME = BLIND_START + 150; // a home goal late in possession 1

/** sim.match.global_id: "<...>:<frame>" moved to match time. */
const globalId = (id: string, start: number) => {
  const k = id.lastIndexOf(":");
  return `${id.slice(0, k)}:${String(Number(id.slice(k + 1)) + start).padStart(4, "0")}`;
};

/** A stitched match of three possessions (open play, the scan hero, the pressure hero). */
export function matchExport(): MatchExport {
  const press = pressureExport();
  const parts = [
    {
      scenario: "possession_play",
      seed: 1000007,
      run: exportJson.runs.factual,
      frames: OPEN_FRAMES,
    },
    { scenario: "blind_side_run", seed: 3, run: exportJson.runs.factual, frames: 0 },
    { scenario: "press_escape", seed: 0, run: press.runs.factual, frames: 0 },
  ];
  const restarts = ["kick_off", "throw_in", "cut"];
  const heroes = [null, "H8", "H8"];
  const local = [null, HERO_MOMENT, PRESS_MOMENT];
  const run: MatchExport["runs"]["factual"] = {
    frames: 0,
    pos: [],
    head: [],
    body: [],
    ball: [],
    owner: [],
    events: [],
    blind_side: { intervals: [], frames: [] },
  };
  const possessions: MatchExport["match"]["possessions"] = [];
  let start = 0;
  parts.forEach((p, index) => {
    const n = p.frames || p.run.frames;
    run.pos.push(...p.run.pos.slice(0, n));
    run.head.push(...p.run.head.slice(0, n));
    run.body.push(...p.run.body.slice(0, n));
    run.ball.push(...p.run.ball.slice(0, n));
    run.owner.push(...p.run.owner.slice(0, n));
    run.blind_side.frames.push(...p.run.blind_side.frames.slice(0, n));
    const events: ExportEvent[] = p.run.events
      .filter((e) => e.frame < n)
      .map((e) => ({ ...e, id: globalId(e.id, start), frame: e.frame + start, possession: index }));
    if (index === 1) {
      events.push({
        id: `goal:H9:${GOAL_FRAME}`,
        type: "goal",
        frame: GOAL_FRAME,
        player: "H9",
        attrs: {},
        possession: 1,
      });
    }
    run.events.push(...events);
    possessions.push({
      index,
      scenario: p.scenario,
      seed: p.seed,
      start,
      frames: n,
      restart: restarts[index],
      score_before: index === 2 ? { home: 1, away: 0 } : { home: 0, away: 0 },
      hero: heroes[index],
      hero_moment: local[index] && globalId(local[index]!, start),
    });
    start += n;
  });
  run.frames = start;
  const lifted = (
    localId: string,
    possession: number,
    lens: string | null,
    hero = false,
  ): ExportMatchMoment => {
    const at = possessions[possession].start;
    const anchor = Number(localId.slice(localId.lastIndexOf(":") + 1));
    return {
      id: globalId(localId, at),
      kind: localId.split(":")[1],
      actor: localId.split(":")[2],
      receiver: null,
      frame_start: at + Math.max(0, anchor - 20),
      frame_end: at + Math.min(possessions[possession].frames - 1, anchor + 40),
      anchor_frame: at + anchor,
      anchor_t: Math.round((at + anchor) * exportJson.dt * 1e4) / 1e4,
      live_only: lens === null,
      selected_lens: lens,
      possession,
      local_id: localId,
      hero,
      start: at,
    };
  };
  return {
    version: exportJson.version,
    kind: "match",
    scenario: "match",
    seed: 1,
    dt: exportJson.dt,
    hero: null,
    players: exportJson.players,
    match: {
      duration_s: Math.round(start * exportJson.dt * 100) / 100,
      score: { home: 1, away: 0 },
      possessions,
    },
    runs: { factual: run },
    moments: [
      lifted("m:sprint:A3:0030", 0, null),
      lifted(HERO_MOMENT, 1, "scan", true),
      lifted("m:line_breaking_pass:H8:0090", 1, "pressure"),
      lifted(PRESS_MOMENT, 2, "pressure", true),
    ],
  };
}

/** GET /api/matches/match-1 (api/main.py match_info). */
export function matchInfo(m: MatchExport = matchExport()) {
  return {
    id: MATCH,
    scenario: "match",
    seed: m.seed,
    dt: m.dt,
    frames: m.runs.factual.frames,
    players: m.players,
    hero: null,
    key_scan: null,
    hero_moment: MATCH_HERO,
    hero_moments: [MATCH_HERO, MATCH_PRESS],
    kind: "match",
    possessions: m.match.possessions,
    score: m.match.score,
  };
}

export const matchHello = (m: MatchExport = matchExport()) => ({
  type: "hello",
  match: MATCH,
  dt: m.dt,
  frames: m.runs.factual.frames,
  players: m.players,
  hero: null,
  kind: "match",
});

export function matchFrameMsg(m: MatchExport, f: number) {
  const run = m.runs.factual;
  return {
    type: "frame",
    f,
    t: Math.round(f * m.dt * 1000) / 1000,
    pos: run.pos[f],
    body: run.body[f],
    head: run.head[f],
    ball: run.ball[f],
    owner: run.owner[f],
    sprint: [],
    blind_side: run.blind_side.frames[f],
  };
}

/** The pressure hero's breakdown: the server's template plan (no scan marker) and two lines. */
export function pressureBreakdown(persona = "casual", language = "en") {
  const base = breakdownResponse({ cached: false }, { persona, language });
  const lines = [
    {
      id: "L1",
      text: "H8 was under heavy pressure when he released the ball.",
      claims: ["heavy_pressure"],
    },
    { id: "L2", text: "Had H8 kept the ball, he would have lost it.", claims: ["cf_carry_lost"] },
  ];
  const script = base.result.scripts[0];
  return {
    ...base,
    source: "offline",
    result: {
      ...base.result,
      request: { moment: PRESS_MOMENT, personas: [persona], languages: [language] },
      plan: {
        moment: PRESS_MOMENT,
        duration_s: 11.6,
        steps: [
          { t: 0.0, do: "freeze" },
          { t: 0.4, do: "rewind", to: -2.4 },
          { t: 0.6, do: "zone", layer: "vision", player: "H8" },
          { t: 0.8, do: "camera", mode: "pov" },
          { t: 1.2, do: "pov", player: "H8", from: -2.4, to: 0.0, speed: 0.5 },
          { t: 1.6, do: "ghost", kind: "belief", cf: null },
          { t: 6.4, do: "camera", mode: "split" },
          { t: 6.6, do: "play", to: 2.0, speed: 1.0 },
          { t: 9.0, do: "ghost", kind: "counterfactual", cf: "cf1" },
        ],
      },
      plan_source: "template",
      scripts: [
        {
          ...script,
          payload: {
            moment: PRESS_MOMENT,
            persona,
            language,
            lines,
            claims: [
              {
                id: "heavy_pressure",
                kind: "computed",
                verdict: "supported",
                values: {},
                evidence: ["pass:H8:0075"],
                seek_frame: 75,
              },
              {
                id: "cf_carry_lost",
                kind: "counterfactual",
                verdict: "supported",
                values: {},
                evidence: ["pass:H8:0075"],
                seek_frame: 75,
              },
            ],
          },
          voice: lines.map((l, k) => ({ ...script.voice[k], line: l.id, ssml: ssml(l.text) })),
        },
      ],
    },
  };
}

/** POST /api/breakdowns for a hero moment of match-1: the hero's breakdown plus where it is. */
export function matchBreakdown(body: unknown, startPatch: Partial<Record<1 | 2, number>> = {}) {
  const { moment, personas, languages } = body as {
    moment: string;
    personas: string[];
    languages: string[];
  };
  const press = moment === MATCH_PRESS;
  const res = press
    ? pressureBreakdown(personas[0], languages[0])
    : breakdownResponse({}, { persona: personas[0], language: languages[0] });
  const index = press ? 2 : 1;
  const start = startPatch[index] ?? (press ? PRESS_START : BLIND_START);
  return { ...res, possession: { index, start, local_moment: press ? PRESS_MOMENT : HERO_MOMENT } };
}

/** Server-render `node` inside the session's context: the HTML a viewer would get. */
export function render(session: ViewSession, node: ReactNode): string {
  return renderToStaticMarkup(
    <SessionContext.Provider value={session}>{node}</SessionContext.Provider>,
  );
}

/** Let pending promises (fake fetches, their JSON) run. */
export async function settle(): Promise<void> {
  for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
}
