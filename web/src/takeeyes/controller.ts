// "Take his eyes" (SPEC 3.7, 7) on a hero moment's Session: the flow (flow.ts), the bundled look
// grid (looks.ts, fetched on first open), and what the stage plays. The stage is the app's own
// views (first person and the tactical board) in a derived session: the same session with a hero
// whose "counterfactual" run is the look on show and a playback store of its own, so the views
// draw his head, his sight, his belief ghosts and the gold ghost path of the look's run exactly
// as they draw the hero moment. Opening it takes over from the breakdown and the live stream and
// leaves the replay parked at the decision.

import type { Hero } from "../data/hero";
import type { ViewSession, Session } from "../session";
import { advance, createPlayback, type PlaybackState, type PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";
import type { WhatIfs } from "../whatif/whatif";
import { CLOSED, reduce, type FlowEvent, type FlowState, type ResultView } from "./flow";
import {
  LOOK_FILES,
  NO_GRID,
  aroundHim,
  callLabel,
  cellAt,
  lookRun,
  parseLooks,
  startingCell,
  type LookEntry,
  type Looks,
} from "./looks";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Frames of the moment shown before the look starts, so the turn is seen from the ball. */
export const LEAD_IN = 8;

export interface TakeEyesState extends FlowState {
  reduced: boolean; // prefers reduced motion: clips cut to their end
}

export type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface TakeEyes {
  session: Session;
  state: Store<TakeEyesState>;
  playback: PlaybackStore; // the stage's own playback
  unavailable: string | null; // why the mode cannot open; null when it can
  looks(): Looks | null;
  /** The look the stage shows: the chosen cell while choosing is previewed with no look. */
  shown(): LookEntry | null;
  /** The chosen cell's look; null while none is chosen or it cannot start. */
  chosen(): LookEntry | null;
  /** The session the stage renders (useView inside it): null until the looks are loaded. */
  stage(): ViewSession | null;
  open(): void;
  close(): void;
  pick(at: { frame?: number; offset?: number }): void;
  nudge(kind: "time" | "direction", by: 1 | -1): void;
  look(): void;
  skip(): void;
  view(view: ResultView): void;
  again(): void;
  tick(dt: number): void; // wall-clock seconds
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const controllers = new WeakMap<Session, TakeEyes>();

/** The Take his eyes controller of this hero moment. `fetchImpl` and `dataUrl`: tests. */
export function takeEyesOf(
  session: Session,
  fetchImpl: Fetch = (url) => fetch(url),
  dataUrl = DATA_URL,
): TakeEyes {
  let te = controllers.get(session);
  if (!te) controllers.set(session, (te = create(session, fetchImpl, dataUrl)));
  return te;
}

function create(session: Session, fetchImpl: Fetch, dataUrl: string): TakeEyes {
  const { hero, moment, controls } = session;
  const file = LOOK_FILES[`${hero.scenario}-${hero.seed}`];
  const unavailable =
    hero.kind !== "hero" || !hero.runs.factual.decision
      ? "This moment has no decision on the ball."
      : !file
        ? NO_GRID
        : null;
  const state = createStore<TakeEyesState>({ ...CLOSED, reduced: false });
  const playback = createPlayback(hero);
  playback.set({
    blindSide: false,
    cfGhost: false,
    pitchControl: false,
    skeleton: false,
    comfort: false,
    autoSlow: true,
    options: true,
    camera: "pov",
  });
  let looks: Looks | null = null;
  let loading: Promise<void> | null = null;
  const stages = new Map<string, ViewSession>();

  const dispatch = (event: FlowEvent) => {
    const before = state.get();
    const flow = reduce(before, event);
    if (flow === before) return;
    state.set(flow);
    if (flow.step !== before.step || flow.view !== before.view || flow.frame !== before.frame)
      stagePlayback();
  };

  const entryAt = (s: FlowState): LookEntry | null =>
    looks && s.frame !== null && s.offset !== null
      ? (cellAt(looks, s.frame, s.offset)?.entry ?? null)
      : null;

  const shown = (): LookEntry | null => {
    if (!looks) return null;
    const s = state.get();
    if (s.step === "looking" || (s.step === "result" && s.view !== "none")) return entryAt(s);
    return looks.noLook;
  };

  /** The derived session for one look: the hero with the look's run as "counterfactual". */
  const stageFor = (entry: LookEntry): ViewSession => {
    let stage = stages.get(entry.id);
    if (stage) return stage;
    const run = lookRun(hero, looks!, entry);
    const scan = entry.look ? (run.scans.find((s) => s.start === entry.look!.start) ?? null) : null;
    const derived: Hero = { ...hero, keyScan: scan, runs: { ...hero.runs, counterfactual: run } };
    const ghost: WhatIfs = {
      moment: moment.id,
      decisionFrame: looks!.decisionFrame,
      start: entry.after.start,
      factualAction: looks!.factual.chosen,
      refusal: { en: "", zh: "" },
      options: [
        {
          action: entry.id,
          factual: false,
          question: { en: "", zh: "" },
          id: entry.id,
          run: entry.after,
          answers: {},
          errors: [],
          tag: `${entry.look ? "your look" : "no look"}: ${lowerFirst(callLabel(entry.decision.chosen))}`,
        },
      ],
    };
    stage = { ...session, hero: derived, playback, whatIfs: ghost };
    stages.set(entry.id, stage);
    return stage;
  };

  /** Point the stage's playback at what the current step plays. */
  const stagePlayback = () => {
    const s = state.get();
    if (!looks || s.step === "closed" || s.step === "loading" || s.step === "error") return;
    const decision = looks.decisionFrame;
    const entry = entryAt(s);
    const patch: Partial<PlaybackState> = { whatIf: null, playUntil: null, playing: false };
    if (s.step === "choosing") {
      Object.assign(patch, {
        mode: "counterfactual",
        frame: s.frame ?? decision,
        focus: "tactical",
      });
    } else if (s.step === "looking" && entry?.look) {
      const from = Math.max(looks.window[0], entry.look.start - LEAD_IN);
      Object.assign(patch, {
        mode: "counterfactual",
        frame: s.reduced ? decision : from,
        playing: !s.reduced,
        playUntil: decision,
        focus: "split",
      });
    } else if (s.step === "result" && s.view === "both" && entry) {
      const end = entry.after.start + entry.after.frames - 1;
      Object.assign(patch, {
        mode: "factual",
        whatIf: entry.id,
        frame: s.reduced ? Math.min(end, hero.runs.factual.frames - 1) : decision,
        playing: !s.reduced,
        focus: "tactical",
      });
    } else if (s.step === "result") {
      Object.assign(patch, { mode: "counterfactual", frame: decision, focus: "tactical" });
    }
    playback.set(patch);
  };

  const load = (): Promise<void> => {
    if (looks) return Promise.resolve();
    loading ??= (async () => {
      try {
        const res = await fetchImpl(dataUrl + file);
        if (!res.ok) throw new Error(`${file} could not be fetched`);
        looks = parseLooks(await res.json(), hero, moment);
        const start = startingCell(looks);
        dispatch({ type: "loaded", frame: start.frame, offset: start.offset });
      } catch (err) {
        loading = null;
        dispatch({ type: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return loading;
  };

  return {
    session,
    state,
    playback,
    unavailable,
    looks: () => looks,
    shown,
    chosen: () => entryAt(state.get()),
    stage() {
      const entry = shown();
      return entry ? stageFor(entry) : null;
    },
    open() {
      if (unavailable) return;
      // Take over from the breakdown and the live stream; the replay waits at the decision.
      controls.leaveLive();
      controls.clearWhatIf();
      session.voice.stop();
      session.playback.set({
        mode: "factual",
        frame: moment.decisionFrame,
        playing: false,
        playUntil: null,
        captionLine: null,
        evidenceLine: null,
        scanMarker: null,
      });
      state.set({ reduced: prefersReducedMotion() });
      dispatch({ type: "open", loaded: !!looks });
      if (state.get().step === "loading") {
        if (looks) {
          const start = startingCell(looks);
          dispatch({ type: "loaded", frame: start.frame, offset: start.offset });
        } else void load();
      }
    },
    close: () => dispatch({ type: "close" }),
    pick: (at) => dispatch({ type: "pick", ...at }),
    nudge(kind, by) {
      const s = state.get();
      if (!looks || s.frame === null || s.offset === null) return;
      if (kind === "time") {
        const k = looks.frames.indexOf(s.frame) + by;
        if (k >= 0 && k < looks.frames.length) dispatch({ type: "pick", frame: looks.frames[k] });
      } else {
        const ring = aroundHim(looks);
        const k = ring.indexOf(s.offset) + by;
        if (k >= 0 && k < ring.length) dispatch({ type: "pick", offset: ring[k] });
      }
    },
    look() {
      const entry = entryAt(state.get());
      if (entry) dispatch({ type: "look", id: entry.id });
    },
    skip: () => dispatch({ type: "done" }),
    view: (view) => dispatch({ type: "view", view }),
    again: () => dispatch({ type: "again" }),
    tick(dt: number) {
      const s = state.get();
      if (s.step !== "looking" && s.step !== "result") return;
      const stage = this.stage();
      if (!stage) return;
      const was = playback.get().playing;
      advance(playback, stage.hero, dt);
      if (s.step === "looking" && was && !playback.get().playing) dispatch({ type: "done" });
    },
  };
}

/** Drive the stage's playback from requestAnimationFrame while the mode is open. */
export function startTakeEyesClock(te: TakeEyes): () => void {
  let last = performance.now();
  let id = 0;
  const tick = (now: number) => {
    te.tick(Math.min(0.1, (now - last) / 1000));
    last = now;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
