// "Your call" (SPEC 7) on a hero moment's Session: the flow (flow.ts), the clip each beat plays
// and the truth beat's move from his picture to the truth, with their own clock. One controller
// per Session, made on first use, so the Session itself does not change. Opening it takes over
// from the breakdown and the live stream and parks the replay at the decision; closing it leaves
// the replay there.

import type { Session } from "../session";
import { createStore, type Store } from "../store/store";
import { CLOSED, reduce, type FlowEvent, type FlowState } from "./flow";
import { callOptions, clipOf, type CallOption, type Clip } from "./options";
import { pictureOf, type Picture } from "./picture";

/** Seconds the truth beat takes to move everyone from where he pictured them to the truth. */
export const MORPH_S = 0.9;

export interface ClipState extends Clip {
  of: string; // the option whose run plays
  frame: number; // fractional
  playing: boolean;
}

export interface YourCallState extends FlowState {
  clip: ClipState | null; // outcome: the viewer's call; actual and compare: what he did
  morph: number; // truth beat: 0 = his picture, 1 = the truth
  reduced: boolean; // prefers reduced motion: cuts to the end of clips and moves, no playback
}

export interface YourCall {
  session: Session;
  state: Store<YourCallState>;
  options: CallOption[];
  picture: Picture | null;
  unavailable: string | null; // why the mode cannot open; null when it can
  open(): void;
  aim(action: string | null): void;
  choose(action: string): void;
  next(): void;
  skip(): void;
  retry(): void;
  close(): void;
  tick(dt: number): void; // wall-clock seconds
}

const INITIAL: YourCallState = { ...CLOSED, clip: null, morph: 0, reduced: false };

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

const controllers = new WeakMap<Session, YourCall>();

/** The Your call controller of this hero moment. */
export function yourCallOf(session: Session): YourCall {
  let yc = controllers.get(session);
  if (!yc) controllers.set(session, (yc = create(session)));
  return yc;
}

function create(session: Session): YourCall {
  const { hero, moment, playback, controls } = session;
  const options = callOptions(hero, session.whatIfs);
  const picture = pictureOf(hero);
  const his = options.find((o) => o.factual) ?? null;
  const unavailable = !picture
    ? "This moment has no decision on the ball."
    : !his || options.length < 2
      ? "No re-simulated runs of his other options are loaded."
      : null;
  const state = createStore<YourCallState>(INITIAL);
  const ctx = { actions: options.map((o) => o.action) };

  const clipFor = (action: string, reduced: boolean): ClipState | null => {
    const option = options.find((o) => o.action === action);
    if (!option) return null;
    const clip = clipOf(hero, moment, option);
    return reduced
      ? { ...clip, of: action, frame: clip.end, playing: false }
      : { ...clip, of: action, frame: clip.start, playing: true };
  };

  /** Apply a flow event; entering a beat starts what it plays. */
  const dispatch = (event: FlowEvent) => {
    const before = state.get();
    const flow = reduce(before, event, ctx);
    if (flow === before) return;
    const next: YourCallState = { ...before, ...flow };
    if (flow.step !== before.step) {
      const { reduced } = before;
      if (flow.step === "outcome") next.clip = clipFor(flow.pick!, reduced);
      if (flow.step === "truth") {
        next.morph = reduced ? 1 : 0;
        if (next.clip) next.clip = { ...next.clip, frame: next.clip.end, playing: false };
      }
      if (flow.step === "actual" && his) {
        // His own call already played as the outcome: show where it ended.
        next.clip = clipFor(his.action, reduced || flow.pick === his.action);
      }
      if (flow.step === "compare" && his) next.clip = clipFor(his.action, true);
      if (flow.step === "deciding" || flow.step === "closed") {
        next.clip = null;
        next.morph = 0;
      }
    }
    state.set(next);
  };

  return {
    session,
    state,
    options,
    picture,
    unavailable,
    open() {
      if (unavailable) return;
      // Take over from the breakdown and the live stream; the replay waits at the decision.
      controls.leaveLive();
      controls.clearWhatIf();
      session.voice.stop();
      playback.set({
        mode: "factual",
        frame: moment.decisionFrame,
        playing: false,
        playUntil: null,
        captionLine: null,
        evidenceLine: null,
        scanMarker: null,
      });
      // The reveal tells what he did and why with the breakdown's lines: ask for them now.
      if (session.breakdown.get().status === "waiting") controls.requestBreakdown();
      state.set({ reduced: prefersReducedMotion() });
      dispatch({ type: "open" });
    },
    aim: (action) => dispatch({ type: "aim", action }),
    choose: (action) => dispatch({ type: "choose", action }),
    next: () => dispatch({ type: "next" }),
    skip: () => dispatch({ type: "skip" }),
    retry: () => dispatch({ type: "retry" }),
    close: () => dispatch({ type: "close" }),
    tick(dt: number) {
      const s = state.get();
      if (s.clip?.playing) {
        const frame = s.clip.frame + dt / hero.dt;
        state.set({
          clip:
            frame >= s.clip.end
              ? { ...s.clip, frame: s.clip.end, playing: false }
              : { ...s.clip, frame },
        });
      }
      if (s.step === "truth" && s.morph < 1) {
        state.set({ morph: Math.min(1, s.morph + dt / MORPH_S) });
      }
    },
  };
}

/** Drive a controller's clips from requestAnimationFrame while it is open. Returns a stop. */
export function startYourCallClock(yc: YourCall): () => void {
  let last = performance.now();
  let id = 0;
  const tick = (now: number) => {
    yc.tick(Math.min(0.1, (now - last) / 1000));
    last = now;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
