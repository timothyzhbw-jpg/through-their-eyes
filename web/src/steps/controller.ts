// Scan step-through (SPEC 7) on a hero moment's Session: which step is on screen, in which run,
// with or without the potential passes, and the stage it plays on. The stage is the app's own
// views (first person and the tactical board) in a derived session: the same session with a
// playback store of its own, frozen at the step's frame. Opening it takes over from the breakdown
// and the live stream, as Take his eyes does.

import type { RunName } from "../data/types";
import type { Session, ViewSession } from "../session";
import { createPlayback, type PlaybackState, type PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";
import { prefersReducedMotion, type Fetch } from "../takeeyes/controller";
import { matchingStep, NO_STEPS, parseSteps, STEP_FILES, type Step, type Steps } from "./steps";

export interface StepsState {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  mode: RunName; // with the look (factual), or the other run
  index: number; // the step on screen
  passes: boolean; // potential passes drawn
  reduced: boolean; // prefers reduced motion
}

export interface StepThrough {
  session: Session;
  state: Store<StepsState>;
  playback: PlaybackStore; // the stage's own playback, frozen at the step
  unavailable: string | null; // why it cannot open; null when it can
  steps(): Steps | null;
  /** The steps of the run on screen (empty until loaded). */
  list(): Step[];
  step(): Step | null;
  stage(): ViewSession;
  open(): void;
  close(): void;
  next(): void;
  back(): void;
  go(index: number): void;
  setMode(mode: RunName): void;
  togglePasses(): void;
}

const CLOSED: StepsState = {
  open: false,
  status: "idle",
  error: null,
  mode: "factual",
  index: 0,
  passes: false,
  reduced: false,
};

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const controllers = new WeakMap<Session, StepThrough>();

/** The step-through of this hero moment. `fetchImpl` and `dataUrl`: tests. */
export function stepThroughOf(
  session: Session,
  fetchImpl: Fetch = (url) => fetch(url),
  dataUrl = DATA_URL,
): StepThrough {
  let st = controllers.get(session);
  if (!st) controllers.set(session, (st = create(session, fetchImpl, dataUrl)));
  return st;
}

function create(session: Session, fetchImpl: Fetch, dataUrl: string): StepThrough {
  const { hero, moment, controls } = session;
  const file = STEP_FILES[`${hero.scenario}-${hero.seed}`];
  const unavailable =
    hero.kind !== "hero" || !hero.runs.factual.decision
      ? "This moment has no decision on the ball."
      : !file
        ? NO_STEPS
        : null;
  const state = createStore<StepsState>(CLOSED);
  const playback = createPlayback(hero);
  playback.set({
    playing: false,
    autoSlow: false,
    comfort: false,
    blindSide: false,
    cfGhost: false,
    options: false, // the step-through draws the decision's options itself
    pitchControl: false,
    skeleton: false,
    camera: "pov",
    cone: hero.vision !== null,
    beliefGhosts: true,
    ghostsAll: true, // a look's freeze frame shows his whole picture, as before
  });
  const stage: ViewSession = { ...session, playback };
  let steps: Steps | null = null;
  let loading: Promise<void> | null = null;

  const list = (): Step[] => steps?.runs[state.get().mode].steps ?? [];
  const current = (): Step | null => list()[state.get().index] ?? null;

  /** Freeze the stage on the step: a look in first person, the decision on the board. */
  const frame = () => {
    const step = current();
    if (!step) return;
    const patch: Partial<PlaybackState> = {
      mode: state.get().mode,
      frame: step.frame,
      playing: false,
      playUntil: null,
      povPlayer: hero.heroId ?? playback.get().povPlayer,
      focus: step.kind === "decision" ? "tactical" : "split",
      camera: "pov",
    };
    playback.set(patch);
  };

  const set = (patch: Partial<StepsState>) => {
    state.set(patch);
    frame();
  };

  const load = (): Promise<void> => {
    if (steps) return Promise.resolve();
    loading ??= (async () => {
      try {
        const res = await fetchImpl(dataUrl + file);
        if (!res.ok) throw new Error(`${file} could not be fetched`);
        steps = parseSteps(await res.json(), hero, moment);
        set({ status: "ready", error: null, index: 0 });
      } catch (err) {
        loading = null;
        state.set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return loading;
  };

  return {
    session,
    state,
    playback,
    unavailable,
    steps: () => steps,
    list,
    step: current,
    stage: () => stage,
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
      state.set({
        ...CLOSED,
        open: true,
        status: steps ? "ready" : "loading",
        reduced: prefersReducedMotion(),
      });
      if (steps) frame();
      else void load();
    },
    close: () => state.set({ open: false }),
    next() {
      const s = state.get();
      if (s.index < list().length - 1) set({ index: s.index + 1 });
    },
    back() {
      const s = state.get();
      if (s.index > 0) set({ index: s.index - 1 });
    },
    go(index) {
      if (index >= 0 && index < list().length) set({ index });
    },
    setMode(mode) {
      const s = state.get();
      if (mode === s.mode || !steps) return;
      const index = matchingStep(steps.runs[mode].steps, current() ?? undefined, s.index);
      set({ mode, index });
    },
    togglePasses: () => state.set({ passes: !state.get().passes }),
  };
}
