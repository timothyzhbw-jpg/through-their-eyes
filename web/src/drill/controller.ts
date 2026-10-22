// Academy drill (SPEC 7) on a hero moment's Session: a scan trainer over Take his eyes' look grid
// and Your call's picture. The viewer is the hero a moment before the pass reaches him; a
// countdown runs to the reception. A drag or the arrow keys turn his head live (snap.ts: the scan
// range and a scan's speed), and the turn becomes the nearest look of the grid when it ends or
// when the ball arrives. At his decision the viewer makes the call from his picture with that look
// (Your call's), and the result puts it next to the grid's run of that look, his real look and no
// look (result.ts). Every look was re-simulated ahead of time: no live re-simulation, no model.
//
// The stage is the app's own first-person view in a derived session: the hero's run up to his
// decision is the no-look run (his own looks in the window removed, as in Take his eyes) with the
// viewer's head written into it as the clock runs. Before his decision a look changes only his
// head and his picture, never where anyone is, so the view shows what that head would see.

import { wrapAngle, type Hero, type Run } from "../data/hero";
import type { Session, ViewSession } from "../session";
import { advance, createPlayback, type PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";
import { lookSession, prefersReducedMotion, type Fetch } from "../takeeyes/controller";
import {
  LOOK_FILES,
  NO_GRID,
  cellAt,
  lookRun,
  parseLooks,
  type LookEntry,
  type Looks,
} from "../takeeyes/looks";
import type { YourCall, YourCallState } from "../yourcall/controller";
import type { CallOption } from "../yourcall/options";
import { pictureOf } from "../yourcall/picture";
import { callHeroOf, drillOptions } from "./result";
import {
  chase,
  clampHead,
  countdown,
  HEAD_SPEED_DEG_S,
  lookAngle,
  snapTurn,
  type Turn,
} from "./snap";

export type Step = "closed" | "loading" | "error" | "ready" | "running" | "calling" | "result";
/** How fast the moment plays: the countdown always counts the moment's own time. */
export type Pace = 0.5 | 1;
export const PACES: readonly Pace[] = [0.5, 1];

const DEG = Math.PI / 180;

/** The look the drill settled on: a cell of the grid, or no look. */
export interface Locked {
  cell: { frame: number; offset: number } | null;
  entry: LookEntry; // the cell's re-simulated look; the grid's no-look run for none
  turn: Turn | null; // the viewer's own turn it came from
  tooSmall: boolean; // the viewer turned, but never far enough for a look
}

export interface DrillState {
  step: Step;
  pace: Pace;
  frame: number; // the drill's clock: the moment's fractional frame
  head: number; // his head now, degrees from the ball, + to his left
  target: number; // where the viewer turns it
  hold: -1 | 0 | 1; // an arrow key held: turning to his right (-1) or left (+1)
  dragging: boolean;
  turn: Turn | null; // the look under way
  small: boolean; // the last turn ended before it was a look
  locked: Locked | null;
  pick: string | null; // the viewer's call
  tries: number; // drills played since the mode opened
  error: string | null;
  reduced: boolean; // prefers reduced motion: the result's board cuts to its end
}

export interface Drill {
  session: Session;
  state: Store<DrillState>;
  playback: PlaybackStore; // his eyes: the live run, the clock's frame
  board: PlaybackStore; // the result's board: what he did, and the look's run as its ghost path
  unavailable: string | null; // why the drill cannot open here; null when it can
  looks(): Looks | null;
  /** Seconds until the ball reaches him, in tenths. */
  countdown(): number;
  /** His eyes: the live run, his head written in as the clock runs. */
  stage(): ViewSession | null;
  /** The result's board: mounted (hidden) from the call on, so it shows at once. */
  boardStage(): ViewSession | null;
  /** Your call's view and markers, for the call: his picture with the drill's look. */
  call(): YourCall | null;
  open(): void;
  close(): void;
  setPace(pace: Pace): void;
  start(): void;
  turnTo(deg: number): void; // a drag: where the head should be, degrees from the ball
  hold(dir: -1 | 0 | 1): void; // an arrow key down (or up, 0)
  release(): void; // the drag or the key ends
  choose(action: string): void;
  again(): void;
  tick(dt: number): void; // wall-clock seconds
}

const INITIAL: DrillState = {
  step: "closed",
  pace: 0.5,
  frame: 0,
  head: 0,
  target: 0,
  hold: 0,
  dragging: false,
  turn: null,
  small: false,
  locked: null,
  pick: null,
  tries: 0,
  error: null,
  reduced: false,
};

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const controllers = new WeakMap<Session, Drill>();

/** The academy drill of this hero moment. `fetchImpl` and `dataUrl`: tests. */
export function drillOf(
  session: Session,
  fetchImpl: Fetch = (url) => fetch(url),
  dataUrl = DATA_URL,
): Drill {
  let d = controllers.get(session);
  if (!d) controllers.set(session, (d = create(session, fetchImpl, dataUrl)));
  return d;
}

function create(session: Session, fetchImpl: Fetch, dataUrl: string): Drill {
  const { hero, moment, controls } = session;
  const file = LOOK_FILES[`${hero.scenario}-${hero.seed}`];
  const unavailable =
    hero.kind !== "hero" || !hero.runs.factual.decision
      ? "This moment has no decision on the ball."
      : !file
        ? NO_GRID
        : null;
  const state = createStore<DrillState>(INITIAL);
  const playback = createPlayback(hero);
  // His eyes and nothing over them: no cone, ghosts, options or alerts while he looks (they come
  // from the look-free run and would disagree with the viewer's head); no slow-down round scans.
  playback.set({
    mode: "factual",
    camera: "pov",
    focus: "pov",
    cone: false,
    beliefGhosts: false,
    ghostsAll: false,
    cfGhost: false,
    options: false,
    blindSide: false,
    pitchControl: false,
    skeleton: false,
    comfort: false,
    motionBlur: false,
    autoSlow: false,
    playing: false,
  });
  // The result's board: what he did from his decision, with the look's run as the ghost path.
  const board = createPlayback(hero);
  board.set({
    mode: "factual",
    focus: "tactical",
    cone: false,
    beliefGhosts: false,
    cfGhost: false,
    options: false,
    blindSide: false,
    pitchControl: false,
    skeleton: false,
    autoSlow: false,
    playing: false,
  });
  let looks: Looks | null = null;
  let loading: Promise<void> | null = null;
  // The live run: the no-look run, his head rewritten from the clock on.
  let live: { session: ViewSession; run: Run; base: Float32Array; pristine: Float32Array } | null =
    null;
  let called: { entry: LookEntry; yc: YourCall } | null = null;
  let result: { entry: LookEntry; session: ViewSession } | null = null;

  const set = (patch: Partial<DrillState>) => state.set(patch);

  const liveOf = (l: Looks) => {
    if (live) return live;
    const run: Run = { ...lookRun(hero, l, l.noLook), name: "factual" };
    const derived: Hero = { ...hero, keyScan: null, runs: { ...hero.runs, factual: run } };
    live = {
      run,
      base: l.noLook.head, // his head with no look, over the window
      pristine: run.head.slice(),
      session: { ...session, hero: derived, playback, whatIfs: null },
    };
    return live;
  };

  /** His head from the clock's frame to the decision: the look-free head turned by `head`. */
  const writeHead = () => {
    if (!looks || !live) return;
    const s = state.get();
    const [start, end] = looks.window;
    const n = hero.n;
    const turn = s.head * DEG;
    for (let f = Math.max(start, Math.floor(s.frame)); f <= end; f++) {
      live.run.head[f * n + hero.hero] = wrapAngle(live.base[f - start] + turn);
    }
  };

  const callOf = (entry: LookEntry): YourCall => {
    if (called?.entry === entry) return called.yc;
    const callHero = callHeroOf(hero, looks!, entry);
    const options: CallOption[] = drillOptions(callHero);
    const ycState = createStore<YourCallState>({
      step: "deciding",
      aim: null,
      pick: null,
      tried: [],
      clip: null,
      morph: 0,
      reduced: state.get().reduced,
    });
    const noop = () => {};
    const yc: YourCall = {
      session: { ...session, hero: callHero },
      state: ycState,
      options,
      picture: pictureOf(callHero),
      unavailable: null,
      open: noop,
      next: noop,
      skip: noop,
      retry: noop,
      close: () => api.close(),
      tick: noop,
      aim: (action) => {
        if (action === null || options.some((o) => o.action === action))
          ycState.set({ aim: action });
      },
      choose: (action) => api.choose(action),
    };
    called = { entry, yc };
    return yc;
  };

  const resultOf = (entry: LookEntry): ViewSession => {
    if (result?.entry === entry) return result.session;
    result = { entry, session: lookSession(session, looks!, entry, board) };
    return result.session;
  };

  /** End the look: the grid's cell for the viewer's turn, or no look (none, or too small). */
  const lock = (turn: Turn | null) => {
    if (!looks) return;
    const cell = turn ? snapTurn(looks, turn) : null;
    const entry = cell ? (cellAt(looks, cell.frame, cell.offset)?.entry ?? null) : null;
    const tooSmall = !!turn && lookAngle(turn.peak) === null;
    set({
      locked: { cell: entry ? cell : null, entry: entry ?? looks.noLook, turn, tooSmall },
      turn: null,
      target: 0,
      hold: 0,
      dragging: false,
    });
  };

  const load = (): Promise<void> => {
    if (looks) return Promise.resolve();
    loading ??= (async () => {
      try {
        const res = await fetchImpl(dataUrl + file);
        if (!res.ok) throw new Error(`${file} could not be fetched`);
        looks = parseLooks(await res.json(), hero, moment);
        playback.set({ frame: looks.window[0], playing: false });
        if (state.get().step === "loading") set({ step: "ready", frame: looks.window[0] });
      } catch (err) {
        loading = null;
        if (state.get().step === "loading")
          set({ step: "error", error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return loading;
  };

  /** The viewer started a turn: the look's first frame is now. */
  const begin = () => {
    const s = state.get();
    if (s.step !== "running" || s.locked || s.turn) return;
    set({ turn: { start: s.frame, peak: 0 }, small: false });
  };

  const api: Drill = {
    session,
    state,
    playback,
    board,
    unavailable,
    looks: () => looks,
    countdown: () => (looks ? countdown(looks.reception, state.get().frame, hero.dt) : 0),
    stage: () => (looks ? liveOf(looks).session : null),
    boardStage() {
      const s = state.get();
      return looks && s.locked && (s.step === "calling" || s.step === "result")
        ? resultOf(s.locked.entry)
        : null;
    },
    call() {
      const s = state.get();
      return looks && s.locked && (s.step === "calling" || s.step === "result")
        ? callOf(s.locked.entry)
        : null;
    },
    open() {
      if (unavailable) return;
      const s = state.get();
      if (s.step !== "closed") return;
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
      set({ ...INITIAL, pace: s.pace, reduced: prefersReducedMotion(), step: "loading" });
      if (looks) {
        set({ step: "ready", frame: looks.window[0] });
        playback.set({ mode: "factual", frame: looks.window[0], playing: false, whatIf: null });
      } else void load();
    },
    close() {
      if (state.get().step === "closed") return;
      set({ step: "closed", hold: 0, dragging: false, turn: null });
    },
    setPace(pace) {
      if (PACES.includes(pace) && state.get().step === "ready") set({ pace });
    },
    start() {
      const s = state.get();
      if (!looks || (s.step !== "ready" && s.step !== "result")) return;
      const l = liveOf(looks);
      l.run.head.set(l.pristine); // every drill starts afresh
      called = null;
      set({
        step: "running",
        frame: looks.window[0],
        head: 0,
        target: 0,
        hold: 0,
        dragging: false,
        turn: null,
        small: false,
        locked: null,
        pick: null,
        tries: s.tries + 1,
      });
      writeHead();
      playback.set({ mode: "factual", frame: looks.window[0], playing: false, whatIf: null });
    },
    turnTo(deg) {
      const s = state.get();
      if (s.step !== "running" || s.locked) return;
      if (deg !== 0) begin();
      set({ target: clampHead(deg), dragging: true });
    },
    hold(dir) {
      const s = state.get();
      if (s.step !== "running" || s.locked) return;
      if (dir !== 0) begin();
      set({ hold: dir });
    },
    release() {
      const s = state.get();
      if (s.step !== "running" || s.locked) {
        set({ dragging: false, hold: 0 });
        return;
      }
      if (s.turn && lookAngle(s.turn.peak) !== null) lock(s.turn);
      // Too small for a look: it does not count, and he may still look before the ball arrives.
      else set({ turn: null, small: !!s.turn, target: 0, hold: 0, dragging: false });
    },
    choose(action) {
      const s = state.get();
      if (s.step !== "calling" || !s.locked) return;
      if (!drillOptions(callHeroOf(hero, looks!, s.locked.entry)).some((o) => o.action === action))
        return;
      set({ step: "result", pick: action });
      const entry = s.locked.entry;
      const end = entry.after.start + entry.after.frames - 1;
      const reduced = state.get().reduced;
      board.set({
        whatIf: entry.id,
        frame: reduced ? Math.min(end, hero.runs.factual.frames - 1) : looks!.decisionFrame,
        playing: !reduced,
        playUntil: null,
      });
    },
    again() {
      const s = state.get();
      if (s.step !== "result" && s.step !== "calling") return;
      if (live) live.run.head.set(live.pristine);
      set({
        step: "ready",
        locked: null,
        pick: null,
        turn: null,
        frame: looks!.window[0],
        head: 0,
      });
      playback.set({ frame: looks!.window[0], playing: false });
      board.set({ whatIf: null, playing: false });
    },
    tick(dt) {
      const s = state.get();
      if (s.step === "result") {
        const stage = api.boardStage();
        if (stage) advance(board, stage.hero, dt);
        return;
      }
      if (s.step !== "running" || !looks) return;
      const match = dt * s.pace; // seconds of the moment
      const frame = s.frame + match / hero.dt;
      const step = HEAD_SPEED_DEG_S * match;
      const target = s.locked ? 0 : s.hold ? clampHead(s.target + s.hold * step) : s.target;
      const head = chase(s.head, target, step);
      let turn = s.turn;
      if (turn && Math.abs(head) > Math.abs(turn.peak)) turn = { ...turn, peak: head };
      set({ frame: Math.min(frame, looks.decisionFrame), head, target, turn });
      // The ball is here: the look ends where it got to (a turn too small is no look).
      if (!state.get().locked && frame >= looks.reception) lock(turn);
      writeHead();
      if (frame >= looks.decisionFrame) {
        set({ step: "calling", frame: looks.decisionFrame, hold: 0, dragging: false });
        board.set({ frame: looks.decisionFrame, whatIf: null, playing: false });
      }
      playback.set({ frame: state.get().frame });
    },
  };
  return api;
}

/** Drive the drill's clock from requestAnimationFrame while it is open. */
export function startDrillClock(d: Drill): () => void {
  let last = performance.now();
  let id = 0;
  const tick = (now: number) => {
    d.tick(Math.min(0.1, (now - last) / 1000));
    last = now;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
