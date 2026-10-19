// One Session per loaded moment: the data, the verified narration, the playback store, the plan
// and its runner, and the user controls. Components get it from React context with `useSession()`.

import { createContext, useContext } from "react";
import { clampFrame, type Hero } from "./data/hero";
import type { RunName } from "./data/types";
import {
  claimRun,
  lineOf,
  primaryClaim,
  scriptOf,
  validatePayload,
  type Narration,
} from "./narration/payload";
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
  narration: Narration | null; // null when the render payload failed its checks
  payloadErrors: string[];
  script: Script; // caption text per line id, from the narration
  controls: ReturnType<typeof makeControls>;
}

/** `payloadCandidate` is a render payload (SPEC 5.3); without a valid one there are no captions
 * and a plan with voice steps falls back to the template plan. */
export function createSession(
  hero: Hero,
  planCandidate: unknown,
  payloadCandidate: unknown,
): Session {
  const moment = heroMoment(hero);
  const playback = createPlayback(hero);
  const runner = new BreakdownRunner(playback, hero, moment);
  const checked = validatePayload(payloadCandidate, moment, hero);
  const narration = checked.ok ? checked.narration : null;
  const script = scriptOf(narration);
  const resolved = resolvePlan(planCandidate, moment, script);
  return {
    hero,
    moment,
    playback,
    runner,
    resolved,
    narration,
    payloadErrors: checked.ok ? [] : checked.errors,
    script,
    controls: makeControls(hero, playback, runner, resolved, narration),
  };
}

/** What the viewer can do. Transport controls take over from a running breakdown. */
function makeControls(
  hero: Hero,
  playback: PlaybackStore,
  runner: BreakdownRunner,
  resolved: ResolvedPlan,
  narration: Narration | null,
) {
  const takeOver = () => runner.stop();
  const run = () => hero.runs[playback.get().mode];
  return {
    togglePlay() {
      takeOver();
      const s = playback.get();
      if (s.playing) return playback.set({ playing: false });
      const atEnd = s.frame >= run().frames - 1;
      playback.set({
        playing: true,
        frame: atEnd ? 0 : s.frame,
        playUntil: null,
        captionLine: null,
      });
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

    /**
     * Open a narration line's evidence (SPEC 7) and seek the replay there: to the seek frame of
     * `claimId`, or of the line's first claim that has one. Counterfactual evidence is shown in
     * the re-simulated run, with the other run's ghost path for comparison.
     */
    openLine(lineId: string, claimId?: string) {
      const line = lineOf(narration, lineId);
      if (!narration || !line) return;
      takeOver();
      const claim = claimId ? narration.claims.get(claimId) : primaryClaim(narration, line);
      playback.set({ evidenceLine: lineId, captionLine: lineId });
      if (claim?.seek_frame == null) return;
      const mode = claimRun(claim);
      const scan = claim.evidence.find((e) => hero.runs.factual.scans.some((s) => s.id === e));
      playback.set({
        mode,
        frame: clampFrame(hero.runs[mode], claim.seek_frame),
        playing: false,
        playUntil: null,
        cfGhost: mode === "counterfactual" || playback.get().cfGhost,
        // Mark the scan behind a factual claim; in the re-simulated run that look never happened.
        scanMarker: mode === "factual" ? (scan ?? null) : null,
      });
    },
    /** Seek to one evidence event of a claim, in the run that claim is about. */
    seekEvidence(claimId: string, eventId: string) {
      const claim = narration?.claims.get(claimId);
      if (!claim) return;
      takeOver();
      const mode = claimRun(claim);
      const event = [...hero.runs[mode].events, ...hero.runs.factual.events].find(
        (e) => e.id === eventId,
      );
      if (event) playback.set({ mode, frame: event.frame, playing: false, playUntil: null });
    },
    closeEvidence() {
      playback.set({ evidenceLine: null });
    },
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
