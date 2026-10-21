// Execute a validated TelestrationPlan by writing to the playback store. The runner keeps its own
// wall clock: every animation frame calls `tick(dt)`, which applies the steps that are due.
// Playback itself (moving the playhead) stays in `advance()`; a step only sets where it starts,
// how fast it runs and where it stops. The plan clock runs at wall-clock speed, slower while
// comfort mode slows playback, and it waits on a voice step while `hold()` is set, then a short gap.

import type { Hero } from "../data/hero";
import { frameStep, type PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";
import { relToFrame, type MomentContext } from "./moment";
import type { PlanStep, TelestrationPlan } from "./schema";

export type BreakdownStatus = "idle" | "running" | "done" | "stopped";

export interface BreakdownState {
  status: BreakdownStatus;
  t: number; // plan time, s
  applied: number; // steps applied so far
  paused: boolean; // running, held by the viewer's pause: the plan clock and the picture wait
}

/** Wall time after a spoken line before the next one, so the two do not run together. */
export const VOICE_GAP_S = 0.25;
/** A stuck speech request must not freeze one step longer than this. */
export const MAX_HOLD_S = 12;

const EPS = 1e-9;

/** A voice step, or the end of the plan, waiting on `hold()` and then the gap. */
interface VoiceWait {
  held: number; // wall seconds spent on this step
  gap: number | null; // null while hold() is still set; otherwise the gap left
  finish: boolean; // the plan's end: the last caption stays up until the line is spoken
}

export class BreakdownRunner {
  readonly status: Store<BreakdownState> = createStore<BreakdownState>({
    status: "idle",
    t: 0,
    applied: 0,
    paused: false,
  });
  private plan: TelestrationPlan | null = null;
  private t = 0;
  private next = 0;
  private wasPlaying = false; // whether a segment was playing when the viewer paused
  private wait: VoiceWait | null = null;
  private readonly hold: () => boolean;

  constructor(
    private readonly playback: PlaybackStore,
    private readonly hero: Hero,
    private readonly moment: MomentContext,
    options?: { hold?: () => boolean },
  ) {
    this.hold = options?.hold ?? (() => false);
  }

  get time(): number {
    return this.t;
  }

  /** Start from the end of the moment, factual run, overlays off. `plan` must be validated. */
  start(plan: TelestrationPlan): void {
    this.plan = plan;
    this.t = 0;
    this.next = 0;
    this.wait = null;
    this.playback.set({
      mode: "factual",
      frame: this.moment.endFrame,
      playing: false,
      playUntil: null,
      autoSlow: false,
      speed: 1,
      povPlayer: this.moment.hero,
      cone: false,
      beliefGhosts: false,
      cfGhost: false,
      options: true,
      focus: "split",
      camera: "pov",
      scanMarker: null,
      captionLine: null,
      evidenceLine: null,
      whatIf: null,
    });
    this.status.set({ status: "running", t: 0, applied: 0, paused: false });
    this.tick(0);
  }

  tick(dt: number): void {
    const plan = this.plan;
    const { status, paused } = this.status.get();
    if (!plan || status !== "running" || paused) return;
    const left = this.drain(plan, dt);
    if (left === null || this.status.get().status !== "running") return;
    this.advance(plan, left);
  }

  /** Hold the breakdown where it is (the viewer pressed pause): the caption stays up. */
  pause(): void {
    const { status, paused } = this.status.get();
    if (status !== "running" || paused) return;
    this.wasPlaying = this.playback.get().playing;
    this.playback.set({ playing: false });
    this.status.set({ paused: true });
  }

  /** Go on from where `pause` held it. */
  resume(): void {
    const { status, paused } = this.status.get();
    if (status !== "running" || !paused) return;
    if (this.wasPlaying) this.playback.set({ playing: true });
    this.status.set({ paused: false });
  }

  /** Hand control back to the viewer (any transport control but pause calls this). */
  stop(): void {
    this.wait = null;
    if (this.status.get().status === "running") this.finish("stopped");
  }

  /** Wall time left for the plan clock, or null when this tick ends on the wait. */
  private drain(plan: TelestrationPlan, dt: number): number | null {
    const wait = this.wait;
    if (!wait) return dt;
    if (wait.gap === null) {
      if (this.hold() && wait.held < MAX_HOLD_S) {
        wait.held += dt;
        if (wait.held < MAX_HOLD_S) {
          this.publish();
          return null;
        }
        return this.release(plan, wait.held - MAX_HOLD_S);
      }
      wait.gap = VOICE_GAP_S;
    }
    const gap = wait.gap;
    if (gap === null) return null;
    if (dt < gap - EPS) {
      wait.gap = gap - dt;
      this.publish();
      return null;
    }
    return this.release(plan, dt - gap);
  }

  /**
   * The wait is over: apply the voice step it was sitting on (the end of the plan just finishes)
   * and return the wall time still to run, or null when a new wait or the finish took the tick.
   */
  private release(plan: TelestrationPlan, excess: number): number | null {
    const finish = this.wait?.finish ?? false;
    this.wait = null;
    if (finish) {
      this.finish("done");
      return null;
    }
    // The step that was waiting applies once. hold() applies again to whatever follows it.
    let skipped = true;
    while (this.next < plan.steps.length && plan.steps[this.next].t <= this.t + EPS) {
      const step = plan.steps[this.next];
      if (step.do === "voice" && !skipped && this.hold()) {
        this.wait = { held: 0, gap: null, finish: false };
        this.publish();
        return null;
      }
      skipped = false;
      this.apply(step);
      this.next += 1;
    }
    return Math.max(0, excess);
  }

  private advance(plan: TelestrationPlan, dt: number): void {
    const gained = dt > 0 ? this.clockStep(dt) : 0;
    const target = this.t + gained;
    if (!this.applyUntil(plan, target, dt, gained)) return;
    this.t = target;
    this.settle(plan, dt, gained);
  }

  /** Apply due steps up to `limit`. A held voice step stops the clock on that step. */
  private applyUntil(plan: TelestrationPlan, limit: number, dt: number, gained: number): boolean {
    while (this.next < plan.steps.length && plan.steps[this.next].t <= limit + EPS) {
      const step = plan.steps[this.next];
      if (step.do === "voice" && this.hold()) {
        const over = Math.max(0, limit - step.t);
        const wall = gained > EPS ? (over / gained) * dt : 0;
        this.t = step.t;
        this.arm(plan, wall, false);
        return false;
      }
      this.apply(step);
      this.next += 1;
    }
    return true;
  }

  /** Start waiting, or carry on at once when this step has already been held for 12 s. */
  private arm(plan: TelestrationPlan, held: number, finish: boolean): void {
    if (held >= MAX_HOLD_S) {
      this.wait = { held, gap: null, finish };
      const left = this.release(plan, held - MAX_HOLD_S);
      if (left === null || this.status.get().status !== "running") return;
      this.advance(plan, left);
      return;
    }
    this.wait = { held, gap: null, finish };
    this.publish();
  }

  /** Reach `duration_s` only once a held last line has been spoken, plus the gap. */
  private settle(plan: TelestrationPlan, dt: number, gained: number): void {
    if (!(this.t >= plan.duration_s)) {
      this.publish();
      return;
    }
    if (!this.hold()) {
      this.finish("done");
      return;
    }
    const over = Math.max(0, this.t - plan.duration_s);
    const wall = gained > EPS ? (over / gained) * dt : 0;
    this.t = plan.duration_s;
    this.arm(plan, wall, true);
  }

  /** Plan seconds covered by `dt` wall seconds. Comfort mode slows the clock with playback. */
  private clockStep(dt: number): number {
    const s = this.playback.get();
    const nominal = (dt / this.hero.dt) * s.speed;
    return s.playing && nominal > 0 ? dt * (frameStep(this.hero, s, dt) / nominal) : dt;
  }

  private publish(): void {
    this.status.set({ t: this.t, applied: this.next });
  }

  private finish(status: BreakdownStatus): void {
    this.playback.set({ autoSlow: true, playUntil: null, speed: 1, captionLine: null });
    this.status.set({ status, t: this.t, applied: this.next, paused: false });
  }

  private frame(rel: number): number {
    return relToFrame(this.moment, rel);
  }

  private apply(step: PlanStep): void {
    const set = this.playback.set;
    switch (step.do) {
      case "freeze":
        set({ playing: false, playUntil: null });
        break;
      case "rewind":
        set({ frame: this.frame(step.to), playing: false, playUntil: null });
        break;
      case "play":
        set({ playing: true, playUntil: this.frame(step.to), speed: step.speed });
        break;
      case "camera":
        set(
          step.mode === "pov" || step.mode === "broadcast"
            ? { focus: step.mode, camera: step.mode }
            : { focus: step.mode },
        );
        break;
      case "pov":
        set({
          camera: "pov", // a first-person clip is filmed in first person, whatever the focus
          povPlayer: step.player,
          comfort: true, // eased yaw in every plan POV clip (SPEC 7)
          frame: this.frame(step.from),
          playUntil: this.frame(step.to),
          speed: step.speed,
          playing: true,
        });
        break;
      case "scan_marker":
        set({ scanMarker: step.scan });
        break;
      case "zone":
        set({ cone: true, povPlayer: step.player });
        break;
      case "ghost":
        set(step.kind === "belief" ? { beliefGhosts: true } : { cfGhost: true });
        break;
      case "voice":
        set({ captionLine: step.line }); // validation made sure the line exists
        break;
    }
  }
}
