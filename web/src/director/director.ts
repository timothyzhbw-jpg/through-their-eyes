// The camera director on a session (a hero moment's or a stitched match's): it watches the
// playhead, asks the rules (rules.ts) what is worth switching to, keeps the chip (pick.ts), and,
// with the auto director on, cuts the cameras itself. Live, it knows only what the stream has
// sent: its events as they arrive, its moments, the blind-side alerts in its frames. In a
// replay, or offline, it reads the run's own events up to the playhead.
//
// The director writes the camera (`camera`, `povPlayer`, `focus`) straight into the playback
// store, like the camera switch: it never stops a breakdown or the autoplay. While a breakdown
// runs, its plan chooses the cameras: the director shows nothing and does not cut.

import type { ExportEvent } from "../data/types";
import type { LiveFeed, LiveMoment } from "../live/feed";
import type { MomentContext } from "../plan/moment";
import type { ViewSession } from "../session";
import type { PlaybackState } from "../store/playback";
import { createStore, type Store } from "../store/store";
import { AutoCutter, autoTarget, linger, pick, shotPatch } from "./pick";
import {
  candidates,
  eventKnowledge,
  type Announced,
  type Knowledge,
  type Shot,
  type Suggestion,
} from "./rules";

export interface DirectorPrefs {
  auto: boolean; // the auto director cuts by itself
}

/** `?director=auto` starts with the auto director on (for filming). */
export function autoFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("director") === "auto";
}

function fromUrl(): boolean {
  try {
    return autoFromSearch(window.location.search);
  } catch {
    return false;
  }
}

/** The viewer's choice, kept across the match and its breakdowns. */
export const directorPrefs = createStore<DirectorPrefs>({ auto: fromUrl() });

export interface DirectorState {
  show: Suggestion | null; // the chip
  directing: boolean; // a breakdown is running: its plan chooses the cameras
}

const REPLAY_LEAD_S = 1; // a replay starts this long before the moment's anchor
const SCAN_LOOKBACK_S = 4; // scans are shorter than this
const SEEK_FRAMES = 12; // a playhead jump further than this forward is a seek, not play

/** The live stream's events as they arrive, once each, in frame order (seeks resend some). */
export class StreamLog {
  readonly events: ExportEvent[] = [];
  private readonly ids = new Set<string>();
  private last: ExportEvent | null = null;

  constructor(private readonly feed: LiveFeed) {}

  attach(): () => void {
    this.take();
    return this.feed.state.subscribe(() => this.take());
  }

  private take(): void {
    const e = this.feed.state.get().lastEvent;
    if (!e || e === this.last) return;
    this.last = e;
    if (typeof e.id !== "string" || !Number.isInteger(e.frame) || this.ids.has(e.id)) return;
    this.ids.add(e.id);
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].frame > e.frame) i--;
    this.events.splice(i, 0, e);
  }
}

/** `player` is in the middle of a scan at frame `f`, as far as the client knows. */
export function inScan(k: Knowledge, player: string, f: number): boolean {
  const oldest = f - Math.round(SCAN_LOOKBACK_S / k.dt);
  for (let i = k.events.length - 1; i >= 0 && k.events[i].frame >= oldest; i--) {
    const e = k.events[i];
    if (e.frame > f || e.type !== "scan" || e.player !== player) continue;
    if (f <= Number(e.attrs.end)) return true;
  }
  return false;
}

/** Offline (or in a match's breakdown) nothing announces the hero moment: it counts as
 * detected once its action is resolved, where its breakdown starts. */
function heroCard(moment: MomentContext): LiveMoment {
  return {
    id: moment.id,
    kind: moment.id.split(":")[1] ?? "moment",
    actor: moment.hero,
    anchor_frame: moment.anchorFrame,
    frame_end: moment.endFrame,
    anchor_t: moment.anchorFrame * moment.dt,
    selected_lens: null,
  };
}

const viewKey = (s: PlaybackState) => `${s.camera}|${s.povPlayer}|${s.focus}`;

/** What the director keeps per session, not per bar: a match's bar unmounts while a breakdown is
 * open over it, and the one that mounts on the way back carries on from here. */
interface Kept {
  dismissed: Set<string>; // dismissed, or a breakdown or replay taken
  cutter: AutoCutter;
  view: string; // the camera on screen at the last update
}
const kept = new WeakMap<ViewSession, Kept>();

function keptFor(session: ViewSession): Kept {
  let k = kept.get(session);
  if (!k) kept.set(session, (k = { dismissed: new Set(), cutter: new AutoCutter(), view: "" }));
  return k;
}

export class Director {
  readonly state: Store<DirectorState> = createStore<DirectorState>({
    show: null,
    directing: false,
  });
  private readonly log: StreamLog | null;
  private readonly kept: Kept;
  private readonly dismissed: Set<string>;
  private readonly cutter: AutoCutter;
  private readonly teams: ReadonlyMap<string, number>;
  private current: string | null = null; // the suggestion on screen at the last update
  private ended: number | null = null; // frame the chip on screen ended, while it lingers
  private frame = -1;
  private mode = "";
  private cutting = false; // the director is writing the camera itself

  constructor(
    private readonly session: ViewSession,
    private readonly clock: () => number = () => performance.now() / 1000,
  ) {
    this.log = session.feed ? new StreamLog(session.feed) : null;
    this.kept = keptFor(session);
    this.dismissed = this.kept.dismissed;
    this.cutter = this.kept.cutter;
    this.teams = new Map(session.hero.players.map((p) => [p.id, p.team] as const));
  }

  /** Follow the session; returns the function that stops. */
  attach(): () => void {
    const { session } = this;
    const offs = [
      this.log?.attach(),
      session.playback.subscribe(() => this.update()),
      directorPrefs.subscribe(() => {
        this.cutter.reset(); // turned on: the first cut may come at once
        this.update();
      }),
      session.kind === "hero" ? session.runner.status.subscribe(() => this.update()) : undefined,
      // A breakdown opened (from the chip or the Moments panel) is not suggested again; the
      // store says so before the bar unmounts.
      session.kind === "match"
        ? session.screen.subscribe(() => {
            const { opening, hero } = session.screen.get();
            for (const id of [opening, hero?.possession?.moment]) {
              if (id) this.dismissed.add(`moment:${id}`);
            }
          })
        : undefined,
    ];
    this.update();
    return () => offs.forEach((off) => off?.());
  }

  /** What the director knows at the playhead. */
  knowledge(s: PlaybackState = this.session.playback.get()): Knowledge {
    const { hero } = this.session;
    const live = s.live && this.log !== null;
    const events = live ? this.log!.events : hero.runs[s.mode].events;
    return eventKnowledge(hero, hero.runs[s.mode], events, this.moments(live, s.mode), this.teams);
  }

  private moments(live: boolean, mode: PlaybackState["mode"]): Announced[] {
    const { session } = this;
    if (session.kind === "match") {
      const cards: LiveMoment[] =
        live && session.feed ? session.feed.state.get().moments : session.match.moments;
      return cards.map((card) => ({ card, breakdown: !!card.hero && session.api !== null }));
    }
    if (mode !== "factual") return []; // the moments happened in the factual run
    const cards = session.feed ? session.feed.state.get().moments : [heroCard(session.moment)];
    return cards.map((card) => ({ card, breakdown: card.id === session.moment.id }));
  }

  private directing(): boolean {
    const { session } = this;
    return session.kind === "hero" && session.runner.status.get().status === "running";
  }

  update(): void {
    const s = this.session.playback.get();
    const now = this.clock();
    const view = viewKey(s);
    if (view !== this.kept.view) {
      if (!this.cutting) this.cutter.viewerCut(now);
      this.kept.view = view;
    }
    const f = Math.floor(s.frame);
    // A new run, or a seek: start afresh, and let nothing from before linger.
    const jumped = s.mode !== this.mode || f < this.frame || f > this.frame + SEEK_FRAMES;
    if (jumped) {
      this.current = null;
      this.ended = null;
    }
    this.mode = s.mode;
    this.frame = f;
    if (this.directing()) {
      this.current = null;
      return this.show(null, true);
    }
    // A breakdown that has played (or was stopped) is not suggested again.
    if (this.session.kind === "hero" && this.session.runner.status.get().status !== "idle") {
      this.dismissed.add(`moment:${this.session.moment.id}`);
    }
    const k = this.knowledge(s);
    const cands = candidates(k, f);
    const picked = pick(cands, f, s, this.current, this.dismissed, k.dt);
    this.current = picked.show?.id ?? null;
    if (directorPrefs.get().auto) {
      const target = autoTarget(cands, s, this.dismissed);
      const shot = this.cutter.decide(target, f, k.dt, now, s, (p) => inScan(k, p, f));
      if (shot) return this.cut(shot); // the cut updates again, with the new camera
    }
    const shown = this.state.get().show;
    const previous = !jumped && shown && !this.dismissed.has(shown.id) ? shown : null;
    if (picked.show || picked.top) this.ended = null;
    else if (previous && this.ended === null) this.ended = f;
    const next = linger(picked, previous, this.ended, f, k.dt);
    if (!next) this.ended = null;
    this.show(next, false);
  }

  /** Take the suggestion on screen: cut to its camera, open the breakdown, or replay it. */
  take(): void {
    const s = this.state.get().show;
    if (!s) return;
    const { session } = this;
    if (s.action === "breakdown") {
      this.dismissed.add(s.id);
      if (session.kind === "hero") session.controls.playBreakdown();
      else {
        const card = session.match.moments.find((m) => m.id === s.moment?.id);
        if (card) session.controls.openBreakdown(card);
      }
      return this.update();
    }
    if (s.action === "replay" && s.moment) {
      this.dismissed.add(s.id);
      const { controls, hero } = session;
      controls.replayMoment(s.moment);
      controls.seek(Math.max(0, s.moment.anchor_frame - Math.round(REPLAY_LEAD_S / hero.dt)));
      controls.togglePlay();
    }
    this.cutter.viewerCut(this.clock());
    if (s.shot) this.cut(s.shot);
    else this.update();
  }

  /** Hide the chip; that suggestion does not come back. */
  dismiss = (): void => {
    const s = this.state.get().show;
    if (!s) return;
    this.dismissed.add(s.id);
    this.update();
  };

  private cut(shot: Shot): void {
    const { playback } = this.session;
    this.cutting = true;
    try {
      playback.set(shotPatch(shot, playback.get()));
    } finally {
      this.cutting = false;
    }
  }

  private show(next: Suggestion | null, directing: boolean): void {
    const cur = this.state.get();
    const same =
      cur.directing === directing &&
      cur.show?.id === next?.id &&
      cur.show?.title === next?.title &&
      cur.show?.reason === next?.reason;
    if (!same) this.state.set({ show: next, directing });
  }
}
