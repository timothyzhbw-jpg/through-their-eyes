// One Session per loaded moment: the data, the playback store, the plan and its runner, and the
// user controls. Components get it from React context with `useSession()`.

import { createContext, useContext } from "react";
import { clampFrame, type Hero } from "./data/hero";
import type { RunName } from "./data/types";
import { heroMoment, type MomentContext } from "./plan/moment";
import { BreakdownRunner } from "./plan/runner";
import type { Script } from "./plan/schema";
import { resolvePlan, type ResolvedPlan } from "./plan/validate";
import { advance, createPlayback, type Focus, type PlaybackStore } from "./store/playback";

export type Toggle = "cone" | "beliefGhosts" | "cfGhost" | "comfort";

export interface Session {
  hero: Hero;
  moment: MomentContext;
  playback: PlaybackStore;
  runner: BreakdownRunner;
  resolved: ResolvedPlan;
  script: Script;
  controls: ReturnType<typeof makeControls>;
}

export function createSession(hero: Hero, planCandidate: unknown, script: Script): Session {
  const moment = heroMoment(hero);
  const playback = createPlayback(hero);
  const runner = new BreakdownRunner(playback, hero, moment, script);
  const resolved = resolvePlan(planCandidate, moment, script);
  return {
    hero,
    moment,
    playback,
    runner,
    resolved,
    script,
    controls: makeControls(hero, playback, runner, resolved),
  };
}

/** What the viewer can do. Transport controls take over from a running breakdown. */
function makeControls(
  hero: Hero,
  playback: PlaybackStore,
  runner: BreakdownRunner,
  resolved: ResolvedPlan,
) {
  const takeOver = () => runner.stop();
  const run = () => hero.runs[playback.get().mode];
  return {
    togglePlay() {
      takeOver();
      const s = playback.get();
      if (s.playing) return playback.set({ playing: false });
      const atEnd = s.frame >= run().frames - 1;
      playback.set({ playing: true, frame: atEnd ? 0 : s.frame, playUntil: null, caption: null });
    },
    seek(frame: number) {
      takeOver();
      playback.set({ frame: clampFrame(run(), frame), playUntil: null });
    },
    setMode(mode: RunName) {
      takeOver();
      const frame = Math.min(playback.get().frame, hero.runs[mode].frames - 1);
      playback.set({ mode, frame });
    },
    setSpeed(speed: number) {
      takeOver();
      playback.set({ speed });
    },
    setPovPlayer(id: string) {
      takeOver();
      playback.set({ povPlayer: id });
    },
    setFocus(focus: Focus) {
      playback.set({ focus });
    },
    toggle(key: Toggle) {
      playback.set((s) => ({ [key]: !s[key] }));
    },
    playBreakdown() {
      runner.start(resolved.plan);
    },
    stopBreakdown: takeOver,
  };
}

/** Drive the runner and the playhead from requestAnimationFrame. Returns a stop function. */
export function startClock(session: Session): () => void {
  let last = performance.now();
  let id = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    session.runner.tick(dt);
    advance(session.playback, session.hero, dt);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionContext");
  return session;
}
