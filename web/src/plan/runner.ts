// Execute a validated TelestrationPlan by writing to the playback store. The runner keeps its own
// wall clock: every animation frame calls `tick(dt)`, which applies the steps that are due.
// Playback itself (moving the playhead) stays in `advance()`; a step only sets where it starts,
// how fast it runs and where it stops. Steps are timed on the plan clock, which runs at wall-clock
// speed except where comfort mode slows playback down.

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

  constructor(
    private readonly playback: PlaybackStore,
    private readonly hero: Hero,
    private readonly moment: MomentContext,
  ) {}

  get time(): number {
    return this.t;
  }

  /** Start from the end of the moment, factual run, overlays off. `plan` must be validated. */
  start(plan: TelestrationPlan): void {
    this.plan = plan;
    this.t = 0;
    this.next = 0;
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
    // While a segment plays in comfort mode, playback slows when the head whips round; the plan
    // clock slows with it so later steps stay in sync with the match.
    const s = this.playback.get();
    const nominal = (dt / this.hero.dt) * s.speed;
    this.t += s.playing && nominal > 0 ? dt * (frameStep(this.hero, s, dt) / nominal) : dt;
    while (this.next < plan.steps.length && plan.steps[this.next].t <= this.t + 1e-9) {
      this.apply(plan.steps[this.next]);
      this.next += 1;
    }
    if (this.t >= plan.duration_s) this.finish("done");
    else this.status.set({ t: this.t, applied: this.next });
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
    if (this.status.get().status === "running") this.finish("stopped");
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
