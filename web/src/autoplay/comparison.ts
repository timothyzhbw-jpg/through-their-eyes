// The cold load's show (SPEC 2, 7). A judge who only watches must see the counterfactual within
// about twenty seconds: once the stream has detected the hero moment (offline, once the lineup
// card closes), the look is replayed at its own pace (free play slows down around the scan), then
// the same seconds of the re-simulated run without it, with the other run's path as a ghost on the
// board beside his eyes. Each part shows one verified line of the breakdown, as soon as the
// breakdown is here: the show does not wait for it. A short hold to read the last line, then the
// breakdown plays. Any viewer action ends the show, as it ends a breakdown (session.ts takeOver).

import type { Hero } from "../data/hero";
import type { Narration } from "../narration/payload";
import type { PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";

export type ComparisonPhase = "idle" | "with" | "without" | "hold" | "done" | "stopped";

/** Seconds the run without the look rests on its last frame, so its line can be read. */
export const HOLD_S = 1.5;
const BEFORE_S = 0.25; // the window opens this long before the key scan
const AFTER_S = 1.2; // and closes this long after the decision, the pass on its way

/** The seconds both parts replay: from just before the key scan (without one, a second before
 * the decision) to a little after the decision, inside both runs. */
export function comparisonWindow(hero: Hero, decision: number): { from: number; to: number } {
  const frames = (s: number) => Math.round(s / hero.dt);
  const start = hero.keyScan?.start ?? decision - frames(1);
  const last = Math.min(hero.runs.factual.frames, hero.runs.counterfactual.frames) - 1;
  return {
    from: Math.max(0, start - frames(BEFORE_S)),
    to: Math.min(last, decision + frames(AFTER_S)),
  };
}

/** Claims that say what he would have done instead (explain/builders.py ids). */
const WHAT_HE_WOULD_HAVE_DONE = ["cf_pass", "cf_action"];

/**
 * The breakdown's lines the show uses: for the look, its first line with claims about what
 * happened; for the run without it, the line that says what he would have done, else its first
 * counterfactual line. Null where the breakdown has none (or no breakdown yet).
 */
export function comparisonLines(narration: Narration | null): {
  withLook: string | null;
  withoutLook: string | null;
} {
  if (!narration) return { withLook: null, withoutLook: null };
  const counterfactual = (id: string) => narration.claims.get(id)?.kind === "counterfactual";
  const withLook = narration.lines.find(
    (l) => l.claims.length > 0 && !l.claims.some(counterfactual),
  );
  const withoutLook =
    narration.lines.find((l) => l.claims.some((c) => WHAT_HE_WOULD_HAVE_DONE.includes(c))) ??
    narration.lines.find((l) => l.claims.some(counterfactual));
  return { withLook: withLook?.id ?? null, withoutLook: withoutLook?.id ?? null };
}

export class Comparison {
  readonly status: Store<{ phase: ComparisonPhase }> = createStore({
    phase: "idle" as ComparisonPhase,
  });
  private then: (() => void) | null = null;
  private narration: () => Narration | null = () => null;
  private window = { from: 0, to: 0 };
  private held = 0;

  constructor(
    private readonly playback: PlaybackStore,
    private readonly hero: Hero,
    private readonly decision: number,
  ) {}

  /** Play the show, with the lines of the breakdown `narration` returns once there is one;
   * `then` runs at its end, not after a stop. False, and nothing played, for a moment with no
   * re-simulated run to show. */
  start(narration: () => Narration | null, then: () => void): boolean {
    if (!this.hero.counterfactual) return false;
    this.narration = narration;
    this.window = comparisonWindow(this.hero, this.decision);
    this.then = then;
    this.playback.set({
      mode: "factual",
      frame: this.window.from,
      playing: true,
      playUntil: this.window.to,
      speed: 1,
      autoSlow: true,
      cfGhost: false,
      whatIf: null,
      evidenceLine: null,
      scanMarker: null,
      captionLine: comparisonLines(narration()).withLook,
    });
    this.status.set({ phase: "with" });
    return true;
  }

  /** One clock step of `dt` wall-clock seconds; the playhead itself moves in `advance()`. */
  tick(dt: number): void {
    const { phase } = this.status.get();
    const { playing, captionLine } = this.playback.get();
    const lines = comparisonLines(this.narration());
    // The breakdown came in (or was replaced, which clears the caption): put this part's line up.
    const line = phase === "with" ? lines.withLook : phase === "without" ? lines.withoutLook : null;
    if (line && captionLine === null) this.playback.set({ captionLine: line });
    if (phase === "with" && !playing) {
      this.playback.set({
        mode: "counterfactual",
        frame: this.window.from,
        playing: true,
        playUntil: this.window.to,
        cfGhost: true,
        captionLine: lines.withoutLook,
      });
      this.status.set({ phase: "without" });
    } else if (phase === "without" && !playing) {
      this.held = 0;
      this.status.set({ phase: "hold" });
    } else if (phase === "hold") {
      this.held += dt;
      if (this.held < HOLD_S) return;
      this.status.set({ phase: "done" });
      const then = this.then;
      this.then = null;
      then?.();
    }
  }

  /** The viewer took over: the show ends where it is, and the breakdown does not follow. */
  stop(): void {
    const { phase } = this.status.get();
    this.then = null;
    if (phase === "with" || phase === "without" || phase === "hold") {
      this.status.set({ phase: "stopped" });
    }
  }
}
