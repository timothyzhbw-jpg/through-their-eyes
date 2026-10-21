// The live ingest stream (SPEC 2, api/live.py): the API replays the match at wall-clock speed over
// a WebSocket. Messages, in order: `hello`; per frame a `frame`, then that frame's `event`s and
// the `moment`s detected on it; finally `end`. Each frame is written into the factual run the
// views draw from (positions, body and head yaw, ball, owner, blind-side alerts), so in live mode
// the board shows what the stream sent. The viewer controls the stream with `pause`, `resume`,
// `seek`, `speed` and `stop` messages.
//
// Ordering: after a seek, frames already in flight from the old position are dropped, with their
// events and moments, until the frame sought arrives. Frames that are not newer than the last one
// applied are dropped too. A moment is announced once, the first time it is detected.

import { z } from "zod";
import type { Hero } from "../data/hero";
import type { ExportEvent } from "../data/types";
import { createStore, type Store } from "../store/store";

/** A MomentCard as the stream sends it (explain/cards.py); only the fields the viewer shows. In
 * a stitched match the card is in match time and says which possession it is in. */
export const LiveMoment = z.object({
  id: z.string(),
  kind: z.string(),
  actor: z.string().nullable(),
  receiver: z.string().nullable().optional(),
  anchor_frame: z.number().int(),
  frame_end: z.number().int(),
  anchor_t: z.number(),
  selected_lens: z.string().nullable().optional(),
  live_only: z.boolean().optional(),
  possession: z.number().int().optional(), // stitched match only (explain/match.py)
  local_id: z.string().optional(),
  hero: z.boolean().optional(),
  start: z.number().int().optional(),
});
export type LiveMoment = z.infer<typeof LiveMoment>;

const Hello = z.object({
  type: z.literal("hello"),
  match: z.string(),
  dt: z.number(),
  frames: z.number().int(),
  players: z.array(z.object({ id: z.string() })),
  hero: z.string().nullable(), // null: a stitched match
  kind: z.enum(["hero", "match"]).optional(),
});

export interface FrameMessage {
  type: "frame";
  f: number;
  t: number;
  pos: number[]; // 2 * players, mm
  body: number[]; // players, 1e-4 rad
  head: number[];
  ball: number[]; // 2, mm
  owner: number;
  sprint: string[]; // players above sprint speed (live overlay)
  blind_side: [number, number, number][]; // [observer, target, frames unseen]
}

/** off: no stream; lost: closed or failed before its end. */
export type LiveStatus = "off" | "connecting" | "streaming" | "paused" | "ended" | "lost";

export interface LiveState {
  status: LiveStatus;
  latest: number; // last frame applied from the stream; -1 before the first
  moments: LiveMoment[]; // detected on the stream, in the order they arrived
  lastEvent: ExportEvent | null;
  sprint: string[]; // sprinting in the latest frame
  error: string | null;
}

/** What the feed needs of a WebSocket; tests pass a fake. */
export interface SocketLike {
  readonly readyState: number; // 1 = open
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export const browserSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

const OPEN = 1;

/** Write one stream frame into the factual run, in metres and radians (as `hero.ts` converts). */
export function applyFrame(hero: Hero, msg: FrameMessage): void {
  const run = hero.runs.factual;
  const n = hero.n;
  const f = msg.f;
  for (let k = 0; k < 2 * n; k++) run.pos[f * 2 * n + k] = msg.pos[k] * 1e-3;
  for (let j = 0; j < n; j++) {
    run.head[f * n + j] = msg.head[j] * 1e-4;
    run.body[f * n + j] = msg.body[j] * 1e-4;
  }
  run.ball[2 * f] = msg.ball[0] * 1e-3;
  run.ball[2 * f + 1] = msg.ball[1] * 1e-3;
  run.owner[f] = msg.owner;
  run.blindSide.frames[f] = msg.blind_side;
}

function frameProblem(hero: Hero, msg: FrameMessage): string | null {
  const frames = hero.runs.factual.frames;
  if (!Number.isInteger(msg.f) || msg.f < 0 || msg.f >= frames)
    return `frame ${msg.f} out of range`;
  const n = hero.n;
  if (msg.pos?.length !== 2 * n || msg.head?.length !== n || msg.body?.length !== n) {
    return `frame ${msg.f}: expected ${n} players`;
  }
  if (msg.ball?.length !== 2 || !Array.isArray(msg.blind_side)) return `frame ${msg.f}: malformed`;
  return null;
}

export interface FeedHooks {
  onMoment?: (card: LiveMoment) => void;
}

export class LiveFeed {
  readonly state: Store<LiveState> = createStore<LiveState>({
    status: "off",
    latest: -1,
    moments: [],
    lastEvent: null,
    sprint: [],
    error: null,
  });
  private ws: SocketLike | null = null;
  private queue: string[] = [];
  private pendingSeek: number | null = null;
  private dropping = false; // the last frame was dropped: so are its events and moments

  constructor(
    private readonly hero: Hero,
    private readonly url: (start: number) => string,
    private readonly socket: SocketFactory = browserSocket,
    private readonly hooks: FeedHooks = {},
  ) {}

  /** Open the stream at frame `start`; any previous stream is closed. */
  connect(start = 0): void {
    this.detach();
    const first = Math.max(0, Math.min(this.hero.runs.factual.frames - 1, Math.round(start)));
    const ws = this.socket(this.url(first));
    this.ws = ws;
    this.queue = [];
    this.pendingSeek = null;
    this.dropping = false;
    this.state.set({ status: "connecting", latest: first - 1, sprint: [], error: null });
    ws.onopen = () => {
      if (ws !== this.ws) return;
      for (const data of this.queue) ws.send(data);
      this.queue = [];
    };
    ws.onmessage = (ev) => {
      if (ws === this.ws) this.receive(ev.data);
    };
    ws.onerror = () => {
      if (ws === this.ws) this.lose("the live stream could not connect");
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.ws = null;
      if (this.state.get().status !== "ended") this.lose("the live stream closed");
    };
  }

  get isOpen(): boolean {
    const s = this.state.get().status;
    return this.ws !== null && (s === "connecting" || s === "streaming" || s === "paused");
  }

  pause(): void {
    this.send({ type: "pause" });
    if (this.state.get().status === "streaming") this.state.set({ status: "paused" });
  }

  resume(): void {
    this.send({ type: "resume" });
    if (this.state.get().status === "paused") this.state.set({ status: "streaming" });
  }

  /** Jump the stream to frame `f`; frames still in flight from before are dropped. */
  seek(f: number): void {
    const frame = Math.max(0, Math.min(this.hero.runs.factual.frames - 1, Math.round(f)));
    this.send({ type: "seek", f: frame });
    this.pendingSeek = frame;
    this.dropping = true;
    this.state.set({ latest: frame - 1 });
  }

  setSpeed(x: number): void {
    this.send({ type: "speed", x });
  }

  /** End the stream on purpose (the viewer left live mode). */
  stop(): void {
    this.send({ type: "stop" });
    this.detach();
    this.state.set({ status: "off", sprint: [] });
  }

  private send(msg: object): void {
    const data = JSON.stringify(msg);
    if (!this.ws) return;
    if (this.ws.readyState === OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
  }

  private lose(error: string): void {
    this.detach();
    this.state.set({ status: "lost", error, sprint: [] });
  }

  private receive(data: unknown): void {
    let msg: { type?: unknown } & Record<string, unknown>;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return this.lose("the live stream sent something that is not JSON");
    }
    switch (msg.type) {
      case "hello":
        return this.hello(msg);
      case "frame":
        return this.frame(msg as unknown as FrameMessage);
      case "event":
        if (!this.dropping) this.state.set({ lastEvent: msg.event as ExportEvent });
        return;
      case "moment": {
        if (this.dropping) return;
        const card = LiveMoment.safeParse(msg.card);
        if (!card.success || this.state.get().moments.some((m) => m.id === card.data.id)) return;
        this.state.set((s) => ({ moments: [...s.moments, card.data] }));
        this.hooks.onMoment?.(card.data);
        return;
      }
      case "end":
        this.state.set({ status: "ended", sprint: [] });
        this.detach();
        return;
      case "error":
        return this.lose(`the live stream refused: ${String(msg.detail)}`);
    }
  }

  private hello(msg: unknown): void {
    const hello = Hello.safeParse(msg);
    const run = this.hero.runs.factual;
    const ids = hello.success ? hello.data.players.map((p) => p.id).join() : "";
    if (
      !hello.success ||
      hello.data.frames !== run.frames ||
      ids !== this.hero.ids.join() ||
      hello.data.hero !== this.hero.heroId ||
      (hello.data.kind ?? "hero") !== this.hero.kind
    ) {
      return this.lose("the live stream is for another match than the loaded export");
    }
    const status = this.state.get().status;
    if (status === "connecting") this.state.set({ status: "streaming" });
  }

  private frame(msg: FrameMessage): void {
    if (this.pendingSeek !== null) {
      if (msg.f !== this.pendingSeek) {
        this.dropping = true;
        return;
      }
      this.pendingSeek = null;
    } else if (msg.f <= this.state.get().latest) {
      this.dropping = true;
      return;
    }
    const problem = frameProblem(this.hero, msg);
    if (problem) return this.lose(`the live stream sent a bad frame: ${problem}`);
    this.dropping = false;
    applyFrame(this.hero, msg);
    this.state.set({ latest: msg.f, sprint: msg.sprint ?? [] });
  }
}

/** Live playback never runs ahead of the stream; further behind than this, it catches up. */
export const LIVE_MAX_LAG = 6; // frames

/**
 * The live playhead after `dtWall` seconds: it plays at the chosen speed but stops at the last
 * frame received, and jumps forward when it falls more than `maxLag` frames behind (a burst
 * after a network stall; a key-moment beat allows more, beat/beat.ts). Before the frame sought
 * has arrived it holds.
 */
export function followLive(
  frame: number,
  latest: number,
  dt: number,
  speed: number,
  dtWall: number,
  maxLag = LIVE_MAX_LAG,
): number {
  if (latest < 0 || frame >= latest) return frame;
  let next = frame + (dtWall / dt) * speed;
  if (latest - next > maxLag) next = latest - 1;
  return Math.min(next, latest);
}
