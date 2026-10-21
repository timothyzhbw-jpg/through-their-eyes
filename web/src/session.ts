// One Session per loaded moment: the data, the breakdown on screen (verified narration + plan),
// the playback store, the plan runner, the live stream and the voice, and the user controls.
// Components get it from React context with `useSession()`.
//
// With the live service (`options.api`) the match plays from the WebSocket stream (SPEC 2), the
// breakdown is asked for once the stream detects the moment (or when the viewer asks), per
// persona and language, and free what-if questions, speech and tamper checks ("Try a wrong
// number") work. Without it, the bundled fixture and the hand-written plan play as before
// ("offline data").
//
// A stitched match (SPEC 3.1) has a MatchSession instead (match/matchSession.ts): the whole match
// live, no breakdown of its own. Each of its hero moments opens a Session of the possession's own
// run (`options.possession`): local frames, shown on the match clock (`offset`). The views shared
// by both read a ViewSession with `useView()`.

import { createContext, useContext } from "react";
import {
  DESCRIBED,
  PERSONAS,
  type Agent,
  type Api,
  type BreakdownResponse,
  type Persona,
} from "./api/client";
import {
  apiBreakdown,
  bundledBreakdown,
  type BreakdownState,
  type BreakdownView,
} from "./breakdown/breakdown";
import { clampFrame, type Hero } from "./data/hero";
import type { RunName } from "./data/types";
import type { MatchSession } from "./match/matchSession";
import {
  followLive,
  LiveFeed,
  type FeedHooks,
  type LiveMoment,
  type SocketFactory,
} from "./live/feed";
import { claimRun, lineOf, primaryClaim, RenderPayload } from "./narration/payload";
import { heroMoment, type MomentContext } from "./plan/moment";
import { BreakdownRunner } from "./plan/runner";
import { IDLE_PRODUCER, toggled, type ProducerState } from "./producer/producer";
import {
  advance,
  createPlayback,
  type Camera3D,
  type Focus,
  type PlaybackStore,
} from "./store/playback";
import type { YawSource } from "./skeleton/skeleton";
import { createStore, useStore, type Store } from "./store/store";
import { IDLE_TAMPER, numericValues, tamperError, type TamperState } from "./tamper/tamper";
import { VoicePlayer, type MakeAudio } from "./voice/voice";
import { answerOf, IDLE_ASK, type AskState } from "./whatif/ask";
import {
  LANGUAGES,
  optionOf,
  parseWhatIfs,
  seekFrame,
  type Language,
  type WhatIfs,
} from "./whatif/whatif";

export type Toggle =
  | "cone"
  | "beliefGhosts"
  | "cfGhost"
  | "comfort"
  | "options"
  | "blindSide"
  | "pitchControl"
  | "skeleton";

export interface SessionOptions {
  api?: Api | null; // the live service; null or absent: offline data
  offline?: string | null; // why there is no live service (shown on the badge)
  socket?: SocketFactory; // WebSocket stand-in for tests
  makeAudio?: MakeAudio; // <audio> stand-in for tests
  momentId?: string | null; // the hero moment's id as the service names it (heroMoment)
  possession?: PossessionRef | null; // a hero moment of a stitched match
}

/** A hero moment inside a stitched match: where its possession sits on the match clock. */
export interface PossessionRef {
  index: number;
  start: number; // match frame of the possession's first frame: match frame = local + start
  moment: string; // the hero moment's id in match time: breakdowns and what-ifs ask by it
}

/** What the views shared by a hero moment and a stitched match can do. */
export interface ViewControls {
  togglePlay(): void;
  seek(frame: number): void;
  setMode(mode: RunName): void;
  setSpeed(speed: number): void;
  setPovPlayer(id: string): void;
  setFocus(focus: Focus): void;
  setCamera(camera: Camera3D): void;
  toggle(key: Toggle): void;
  setSkeletonSource(source: YawSource): void;
  goLive(): void;
  leaveLive(): void;
  replayMoment(card: LiveMoment): void;
}

export interface Session {
  kind: "hero";
  hero: Hero;
  moment: MomentContext;
  playback: PlaybackStore;
  runner: BreakdownRunner;
  breakdown: Store<BreakdownState>; // narration, plan and voice for the chosen persona/language
  producer: Store<ProducerState>; // the failure drill: agents to take down, a request in flight
  whatIfs: WhatIfs | null; // precomputed "What if…?" answers; null hides the box
  whatIfError: string | null;
  ask: Store<AskState>; // the latest free what-if question
  tamper: Store<TamperState>; // the evidence card's "Try a wrong number"
  api: Api | null;
  offline: string | null;
  feed: LiveFeed | null; // the live stream; null offline (and inside a stitched match)
  voice: VoicePlayer;
  possession: PossessionRef | null; // inside a stitched match: its possession
  offset: number; // frames added on the clock: the possession's start, else 0
  controls: Controls;
}

/** A hero moment's Session or a stitched match's: what the shared views read. */
export type ViewSession = Session | MatchSession;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The persona and language of a bundled payload, for the switches while offline. */
function bundledVoice(payload: unknown): { persona: Persona; language: Language } {
  const parsed = RenderPayload.safeParse(payload);
  const persona = PERSONAS.find((p) => parsed.success && p === parsed.data.persona) ?? "casual";
  const language = LANGUAGES.find((l) => parsed.success && l === parsed.data.language) ?? "en";
  return { persona, language };
}

/**
 * `payloadCandidate` is the bundled render payload (SPEC 5.3) and `planCandidate` the plan it
 * plays with; offline they are the breakdown, online they stand in when the service fails.
 * Without a valid payload there are no captions and a plan with voice steps falls back to the
 * template plan.
 */
export function createSession(
  hero: Hero,
  planCandidate: unknown,
  payloadCandidate: unknown,
  whatIfCandidate: unknown = null,
  options: SessionOptions = {},
): Session {
  const api = options.api ?? null;
  const possession = options.possession ?? null;
  const moment = heroMoment(hero, options.momentId);
  const playback = createPlayback(hero);
  const runner = new BreakdownRunner(playback, hero, moment);
  const bundled = bundledBreakdown(payloadCandidate, planCandidate, moment, hero);
  const breakdown = createStore<BreakdownState>(
    api
      ? {
          ...bundled,
          narration: null,
          payloadErrors: [],
          script: {},
          voice: [],
          origin: null,
          persona: "casual",
          language: "en",
          status: "waiting",
          error: null,
        }
      : { ...bundled, ...bundledVoice(payloadCandidate), status: "ready", error: null },
  );
  let whatIfs: WhatIfs | null = null;
  let whatIfError: string | null = null;
  try {
    whatIfs = whatIfCandidate ? parseWhatIfs(whatIfCandidate, hero, moment) : null;
  } catch (err) {
    whatIfError = message(err);
  }
  const hooks: FeedHooks = {};
  // Inside a stitched match the stream belongs to the match; the possession is a replay.
  const feed =
    api && !possession
      ? new LiveFeed(hero, (start) => api.liveUrl(start), options.socket, hooks)
      : null;
  const voice = new VoicePlayer(api ? (key) => api.tts(key) : null, options.makeAudio);
  const parts = {
    kind: "hero" as const,
    hero,
    moment,
    playback,
    runner,
    breakdown,
    producer: createStore<ProducerState>(IDLE_PRODUCER),
    whatIfs,
    whatIfError,
    ask: createStore<AskState>(IDLE_ASK),
    tamper: createStore<TamperState>(IDLE_TAMPER),
    api,
    offline: api ? null : (options.offline ?? "no live service"),
    feed,
    voice,
    possession,
    offset: possession?.start ?? 0,
  };
  const controls = makeControls(parts, bundled);
  hooks.onMoment = controls.momentDetected;

  // The stream ended (or broke): the viewer is left in the replay at the last frame received.
  feed?.state.subscribe(() => {
    const { status, latest } = feed.state.get();
    if (!playback.get().live || (status !== "ended" && status !== "lost")) return;
    playback.set({ live: false, playing: false, frame: Math.max(0, latest) });
  });
  // Speak each caption as it comes up (only while sound is on).
  let caption: string | null = null;
  playback.subscribe(() => {
    const line = playback.get().captionLine;
    if (line === caption) return;
    caption = line;
    if (line) void voice.say(breakdown.get().voice.find((c) => c.line === line));
  });
  return { ...parts, controls };
}

export interface TransportDeps {
  hero: Hero;
  playback: PlaybackStore;
  feed: LiveFeed | null;
  takeOver: () => void; // a viewer action: a hero Session stops its running breakdown
  beforeLive: () => void; // going live: a hero Session stops the voice and the what-if
}

/** Live, before the stream has detected the hero moment: the run switch is locked so the
 * stream is never interrupted (the counterfactual run is not on the stream). */
export function runLocked(live: boolean, moments: readonly LiveMoment[], momentId: string) {
  return live && !moments.some((m) => m.id === momentId);
}

/**
 * Play, seek, speed, run, POV and overlays, and the live stream: the controls a hero moment and
 * a stitched match share. `endLive` stops the stream and leaves the replay where it is.
 */
export function transportControls(d: TransportDeps) {
  const { hero, playback, feed, takeOver } = d;
  const run = () => hero.runs[playback.get().mode];
  const isLive = () => playback.get().live && !!feed?.isOpen;
  /** Stop the stream: the replay takes over at the current frame. */
  const endLive = () => {
    if (!playback.get().live) return;
    feed?.stop();
    playback.set({ live: false });
  };
  /** Watch the match from the live stream (SPEC 2): from where it was, or again from the start. */
  const goLive = () => {
    if (!feed) return;
    takeOver();
    d.beforeLive();
    const { status, latest } = feed.state.get();
    const last = hero.runs.factual.frames - 1;
    const start = status === "ended" || latest >= last ? 0 : Math.max(0, latest + 1);
    playback.set({
      live: true,
      mode: "factual",
      frame: start,
      playing: true,
      playUntil: null,
      speed: 1,
      whatIf: null,
      captionLine: null,
      evidenceLine: null,
      scanMarker: null,
    });
    feed.connect(start);
  };
  const controls: ViewControls = {
    togglePlay() {
      takeOver();
      const st = playback.get();
      if (isLive()) {
        if (st.playing) feed!.pause();
        else feed!.resume();
        playback.set({ playing: !st.playing });
        return;
      }
      if (st.playing) return playback.set({ playing: false });
      const atEnd = st.frame >= run().frames - 1;
      playback.set({
        playing: true,
        frame: atEnd ? 0 : st.frame,
        playUntil: null,
        captionLine: null,
      });
    },
    seek(frame: number) {
      takeOver();
      if (isLive()) {
        feed!.seek(frame);
        playback.set({ frame: clampFrame(run(), Math.round(frame)), playUntil: null });
        return;
      }
      playback.set({ frame: clampFrame(run(), frame), playUntil: null });
    },
    setMode(mode: RunName) {
      if (mode === "counterfactual" && !hero.counterfactual) return; // a match has one run
      takeOver();
      if (mode !== "factual") endLive(); // the stream is the factual run
      const frame = Math.min(playback.get().frame, hero.runs[mode].frames - 1);
      playback.set({ mode, frame });
    },
    setSpeed(speed: number) {
      takeOver();
      if (isLive()) feed!.setSpeed(speed);
      playback.set({ speed });
    },
    setPovPlayer(id: string) {
      takeOver();
      playback.set({ povPlayer: id });
    },
    setFocus(focus: Focus) {
      playback.set({ focus });
    },
    /** Film the 3D view in first person or from the broadcast camera; a focused 3D view stays
     * focused. Like the overlay toggles, it does not stop a breakdown. */
    setCamera(camera: Camera3D) {
      playback.set((st) => ({
        camera,
        focus: st.focus === "pov" || st.focus === "broadcast" ? camera : st.focus,
      }));
    },
    toggle(key: Toggle) {
      playback.set((st) => ({ [key]: !st[key] }));
    },
    /** The skeleton's head yaw: true, or as tracked (drawn only where the export has it). */
    setSkeletonSource(source: YawSource) {
      playback.set({ skeletonSource: source });
    },
    goLive,
    /** Leave the stream and keep the replay where it is. */
    leaveLive() {
      takeOver();
      endLive();
      playback.set({ playing: false });
    },
    /** Replay a detected moment from its anchor, out of live mode. */
    replayMoment(card: LiveMoment) {
      takeOver();
      endLive();
      playback.set({
        mode: "factual",
        frame: clampFrame(hero.runs.factual, card.anchor_frame),
        playing: false,
        playUntil: null,
      });
    },
  };
  return { controls, endLive };
}

export type Controls = ReturnType<typeof makeControls>;

/** What the viewer can do. Transport controls take over from a running breakdown. */
function makeControls(s: Omit<Session, "controls">, bundled: BreakdownView) {
  const {
    hero,
    moment,
    playback,
    runner,
    breakdown,
    producer,
    whatIfs,
    ask,
    tamper,
    api,
    voice,
    possession,
  } = s;
  let auto = false; // autoplay: play the breakdown by itself once the moment is detected
  let momentSeen = false; // the stream has detected the hero moment
  let playWhenReady = false; // the viewer pressed play before the breakdown arrived
  let asking = false; // a breakdown request is in flight
  let askAgain = false; // the viewer chose again meanwhile: ask for that one next
  let askTurn = 0;
  let tamperTurn = 0;
  let tamperLink: string | null = null; // ?tamper=<claim id>: open its card once a breakdown is here
  let soundByAudience = false; // the voice is on because audio description was chosen

  /** Any viewer action ends a running breakdown and the autoplay. */
  const takeOver = () => {
    runner.stop();
    auto = false;
  };
  const { controls: transport, endLive: leaveLive } = transportControls({
    hero,
    playback,
    feed: s.feed,
    takeOver,
    beforeLive: () => {
      voice.stop();
      ask.set(IDLE_ASK);
    },
  });
  const replay = () => {
    takeOver();
    leaveLive();
  };
  const startBreakdown = () => {
    leaveLive();
    voice.stop();
    runner.start(breakdown.get().resolved.plan);
  };
  const resetTamper = () => {
    tamperTurn += 1;
    tamper.set(IDLE_TAMPER);
  };
  /**
   * Open a narration line's evidence (SPEC 7) and seek the replay there: to the seek frame of
   * `claimId`, or of the line's first claim that has one. Counterfactual evidence is shown in
   * the re-simulated run, with the other run's ghost path for comparison.
   */
  const openLine = (lineId: string, claimId?: string) => {
    const { narration } = breakdown.get();
    const line = lineOf(narration, lineId);
    if (!narration || !line) return;
    replay();
    if (playback.get().evidenceLine !== lineId) resetTamper();
    const claim = claimId ? narration.claims.get(claimId) : primaryClaim(narration, line);
    playback.set({ evidenceLine: lineId, captionLine: lineId });
    if (claim?.seek_frame == null) return;
    const mode = claimRun(claim);
    const scan = claim.evidence.find((e) => hero.runs.factual.scans.some((sc) => sc.id === e));
    playback.set({
      mode,
      frame: clampFrame(hero.runs[mode], claim.seek_frame),
      playing: false,
      playUntil: null,
      cfGhost: mode === "counterfactual" || playback.get().cfGhost,
      // Mark the scan behind a factual claim; in the re-simulated run that look never happened.
      scanMarker: mode === "factual" ? (scan ?? null) : null,
    });
  };
  /**
   * The deep link's claim, on the breakdown now on screen: the line that carries it, or else
   * the first line with a claim that has a number, opened with "Try a wrong number" open. The
   * link is spent on the first breakdown shown, so a later one never opens the card by surprise.
   */
  const openLinkedTamper = () => {
    const wanted = tamperLink;
    tamperLink = null;
    const { narration } = breakdown.get();
    if (!wanted || !narration) return;
    const hasNumber = (id: string) => {
      const c = narration.claims.get(id);
      return !!c && numericValues(c).length > 0;
    };
    const line =
      narration.lines.find((l) => l.claims.includes(wanted)) ??
      narration.lines.find((l) => l.claims.some(hasNumber));
    if (!line) {
      console.warn(`tamper=${wanted}: no line of this breakdown has a claim with a number`);
      return;
    }
    const claim = line.claims.includes(wanted) ? wanted : line.claims.find(hasNumber)!;
    if (claim !== wanted) console.warn(`tamper=${wanted}: no line carries it; opened ${claim}`);
    openLine(line.id, claim);
    tamper.set({ open: claim });
  };
  /** Put a new breakdown on screen; the old one's captions and evidence close. */
  const show = (next: Partial<BreakdownState>) => {
    runner.stop();
    voice.stop();
    playback.set({ captionLine: null, evidenceLine: null });
    resetTamper();
    breakdown.set(next);
    openLinkedTamper();
    if (playWhenReady || (auto && momentSeen)) {
      playWhenReady = false;
      auto = false;
      startBreakdown();
    }
  };
  /**
   * Ask the service for the chosen persona and language. One request at a time: a new one can
   * take ≈ 10 s and each counts against the server's per-client limit, so a choice made meanwhile
   * is asked for when the current one returns, and the stale answer is not shown.
   */
  async function requestBreakdown(): Promise<void> {
    if (!api) return;
    if (asking) {
      askAgain = true;
      return;
    }
    asking = true;
    const { persona, language } = breakdown.get();
    breakdown.set({ status: "loading", error: null });
    try {
      const res = await api.breakdown({
        moment: possession?.moment ?? moment.id,
        persona,
        language,
      });
      checkPossession(res.possession, possession, moment.id);
      if (!askAgain)
        show({ ...apiBreakdown(res, persona, language, moment, hero), status: "ready" });
    } catch (err) {
      tamperLink = null; // the linked breakdown never came: open nothing later
      if (!askAgain) show({ ...bundled, status: "failed", error: message(err) });
    } finally {
      asking = false;
      if (askAgain) {
        askAgain = false;
        void requestBreakdown();
      }
    }
  }
  /**
   * A failure drill or a bring-back (SPEC 6): its breakdown replaces the one on screen. It waits
   * for no other request and none waits for it; a failure leaves the breakdown as it was.
   */
  async function produce(busy: Agent | "drill", call: () => Promise<BreakdownResponse>) {
    if (!api || asking || producer.get().busy) return;
    const { persona, language } = breakdown.get();
    asking = true;
    producer.set({ busy, error: null });
    try {
      const res = await call();
      checkPossession(res.possession, possession, moment.id);
      if (!askAgain) {
        show({
          ...apiBreakdown(res, persona, language, moment, hero),
          status: "ready",
          error: null,
        });
        if (busy === "drill") producer.set({ down: [] });
      }
    } catch (err) {
      producer.set({ error: message(err) });
    } finally {
      asking = false;
      producer.set({ busy: null });
      if (askAgain) {
        askAgain = false;
        void requestBreakdown();
      }
    }
  }
  /** Switch persona or language; online, the new breakdown is asked for at once (unless the
   * moment has not been detected yet: then it is asked for in the new choice). */
  const choose = (patch: { persona?: Persona; language?: Language }) => {
    const current = breakdown.get();
    if (!api) return; // offline there is only the bundled breakdown
    const next = { ...current, ...patch };
    if (next.persona === current.persona && next.language === current.language) return;
    breakdown.set(patch);
    if (next.persona !== current.persona) followAudience(next.persona);
    if (current.status !== "waiting") void requestBreakdown();
  };
  /** Audio description is heard, not watched: choosing it turns the voice on, and leaving it turns
   * the voice off again unless the viewer has set the sound since. Other audiences start silent. */
  const followAudience = (persona: Persona) => {
    if (DESCRIBED.has(persona)) {
      if (voice.state.get().on) return;
      voice.setOn(true);
      soundByAudience = voice.state.get().on;
    } else if (soundByAudience) {
      soundByAudience = false;
      voice.setOn(false);
    }
  };
  return {
    ...transport,
    setMode(mode: RunName) {
      // Any mode, including the pressed factual button: take-over would cancel the autoplay.
      if (s.feed && runLocked(playback.get().live, s.feed.state.get().moments, moment.id)) return;
      transport.setMode(mode);
    },

    /** Play the breakdown; online and not here yet, ask for it and play it when it arrives. */
    playBreakdown() {
      const status = breakdown.get().status;
      if (status === "ready" || status === "failed") return startBreakdown();
      playWhenReady = true;
      if (status === "waiting") void requestBreakdown();
    },
    stopBreakdown: takeOver,
    /** Ask the service now instead of waiting for the stream to detect the moment. */
    requestBreakdown: () => void requestBreakdown(),
    setPersona: (persona: Persona) => choose({ persona }),
    setLanguage: (language: Language) => choose({ language }),
    setSound: (on: boolean) => {
      soundByAudience = false; // the viewer's own choice
      voice.setOn(on);
    },

    /** Pick an agent to take down (or not) in the next failure drill. */
    toggleDown(agent: Agent) {
      producer.set((p) => ({ down: toggled(p.down, agent), error: null }));
    },
    /** Run the crew with the picked agents down, for the chosen persona and language. */
    runDrill() {
      const fail = producer.get().down;
      if (!api || !fail.length) return;
      const { persona, language } = breakdown.get();
      const id = possession?.moment ?? moment.id;
      void produce("drill", () => api.breakdown({ moment: id, persona, language, fail }));
    },
    /** Bring a downed agent of the drill on screen back: its step re-runs from the checkpoint. */
    bringBack(agent: Agent) {
      const origin = breakdown.get().origin;
      if (!api || origin?.kind !== "api" || !origin.drill?.pending.includes(agent)) return;
      void produce(agent, () => api.bringBack({ key: origin.key, step: agent }));
    },

    /** Autoplay online: watch live, then play the breakdown once the moment is detected. */
    startLive() {
      transport.goLive();
      auto = s.feed !== null;
    },
    /** A moment arrived on the stream; the hero moment's breakdown is asked for now (SPEC 2). */
    momentDetected(card: LiveMoment) {
      if (card.id !== moment.id) return;
      momentSeen = true;
      const status = breakdown.get().status;
      if (status === "waiting") void requestBreakdown();
      else if (auto && (status === "ready" || status === "failed")) {
        auto = false;
        startBreakdown();
      }
    },

    openLine,
    /** Seek to one evidence event of a claim, in the run that claim is about. */
    seekEvidence(claimId: string, eventId: string) {
      const claim = breakdown.get().narration?.claims.get(claimId);
      if (!claim) return;
      replay();
      const mode = claimRun(claim);
      const event = [...hero.runs[mode].events, ...hero.runs.factual.events].find(
        (e) => e.id === eventId,
      );
      if (event) playback.set({ mode, frame: event.frame, playing: false, playUntil: null });
    },
    closeEvidence() {
      resetTamper();
      playback.set({ evidenceLine: null });
    },

    /** Open (or, with null, close) a claim's "Try a wrong number" in the evidence card. */
    openTamper(claimId: string | null) {
      resetTamper();
      tamper.set({ open: claimId });
    },
    /**
     * Ask the live service's verifier about one claim with `slot` set to `value` (SPEC 5.3, 7),
     * in the breakdown's language. Only the latest answer is shown.
     */
    async tryValue(claimId: string, slot: string, value: number) {
      if (!api) return;
      const turn = ++tamperTurn;
      tamper.set({ status: "checking", claim: claimId, slot, value, result: null, error: null });
      try {
        const language = breakdown.get().language;
        const result = await api.verify({
          claim: claimId,
          slot,
          value,
          language,
          moment: possession?.moment,
        });
        if (turn === tamperTurn) tamper.set({ status: "done", result });
      } catch (err) {
        if (turn === tamperTurn) tamper.set({ status: "failed", error: tamperError(err) });
      }
    },
    /**
     * Deep link ?tamper=<claim id>: open the evidence card on that claim with its control open.
     * Online the breakdown is asked for now and the card opens when it arrives.
     */
    openTamperLink(claimId: string) {
      tamperLink = claimId;
      const status = breakdown.get().status;
      if (status === "waiting") void requestBreakdown();
      else if (status !== "loading") openLinkedTamper();
    },

    /**
     * Ask one of the suggested "What if…?" questions: replay the actual run from the decision with
     * the forced run drawn over it as a ghost. Picking what he actually did clears the ghost.
     */
    askWhatIf(action: string) {
      const option = optionOf(whatIfs, action);
      if (!whatIfs || !option) return;
      replay();
      ask.set(IDLE_ASK);
      playback.set({
        whatIf: option.factual ? null : action,
        mode: "factual",
        frame: whatIfs.start,
        playing: true,
        playUntil: null,
        speed: 1,
        captionLine: null,
        evidenceLine: null,
      });
    },
    /**
     * Ask the live service a question of the viewer's own (SPEC 6). A verified answer replays the
     * moment from the decision, with the forced run as the ghost when the bundled what-ifs have it.
     */
    async askFree(question: string, language: Language) {
      const q = question.trim();
      if (!api || !q) return;
      replay();
      const turn = ++askTurn;
      ask.set({ ...IDLE_ASK, status: "asking", question: q, language });
      playback.set({ whatIf: null });
      try {
        const res = await api.whatIf({
          question: q,
          language,
          persona: breakdown.get().persona,
          moment: possession?.moment,
        });
        if (turn !== askTurn) return;
        const answer = answerOf(res, hero, moment, whatIfs);
        ask.set(answer);
        if (answer.status !== "answered") return;
        const option = optionOf(whatIfs, answer.action);
        playback.set({
          whatIf: option && !option.factual && option.run ? answer.action : null,
          mode: "factual",
          frame: whatIfs?.start ?? moment.decisionFrame,
          playing: true,
          playUntil: null,
          speed: 1,
          captionLine: null,
          evidenceLine: null,
        });
      } catch (err) {
        if (turn === askTurn) ask.set({ ...ask.get(), status: "failed", error: message(err) });
      }
    },
    clearWhatIf() {
      askTurn += 1;
      ask.set(IDLE_ASK);
      playback.set({ whatIf: null });
    },
    /** Seek to a what-if claim's evidence: the actual run at that frame, the ghost on top. */
    seekWhatIf(frame: number) {
      replay();
      playback.set({
        mode: "factual",
        frame: seekFrame(hero, frame),
        playing: false,
        playUntil: null,
      });
    },
  };
}

/**
 * A breakdown of a stitched match's hero moment says where it is: it must be this moment, in
 * this possession, or its local frames would be placed on the wrong stretch of the match clock.
 */
function checkPossession(
  got: BreakdownResponse["possession"],
  want: PossessionRef | null,
  localMoment: string,
): void {
  if (!want) return;
  if (!got)
    throw new Error(`the breakdown of ${want.moment} does not say which possession it is in`);
  if (got.index !== want.index || got.start !== want.start || got.local_moment !== localMoment) {
    throw new Error(
      `the breakdown is for ${got.local_moment} in possession ${got.index} from frame ` +
        `${got.start}, not ${localMoment} in possession ${want.index} from frame ${want.start}`,
    );
  }
}

/** Drive the playhead from requestAnimationFrame: the stream's in live mode, else the runner and
 * the replay clock. Returns a stop function. */
export function startClock(session: ViewSession): () => void {
  let last = performance.now();
  let id = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tickSession(session, dt);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/** One clock step of `dt` wall-clock seconds. */
export function tickSession(session: ViewSession, dt: number): void {
  const { playback, feed, hero } = session;
  const s = playback.get();
  if (s.live && feed) {
    if (!s.playing) return;
    const next = followLive(s.frame, feed.state.get().latest, hero.dt, s.speed, dt);
    if (next !== s.frame) playback.set({ frame: next });
    return;
  }
  if (session.kind === "hero") session.runner.tick(dt);
  advance(playback, hero, dt);
}

export const SessionContext = createContext<ViewSession | null>(null);

/** The session on screen, a hero moment's or a stitched match's: for the shared views. */
export function useView(): ViewSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useView outside SessionContext");
  return session;
}

/** The hero moment's session on screen (breakdown, narration, what-ifs). */
export function useSession(): Session {
  const session = useView();
  if (session.kind !== "hero") throw new Error("useSession needs a hero moment, not a match");
  return session;
}

/** The breakdown on screen; re-renders when it changes. */
export function useBreakdown(): BreakdownState {
  return useStore(useSession().breakdown, (b) => b);
}
