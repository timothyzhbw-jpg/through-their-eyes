// The end-of-match recap (SPEC 6, 7): the crew's recap of a stitched match, asked for at full
// time on the live stream or from the Moments panel (POST /api/recaps, agents/recap.py).
//
// - The card: the final score, one verified sentence per key moment with a Watch button that
//   seeks the match to it, and the headline match stats. Every sentence is a line of the
//   recap's card payload (SPEC 5.3), checked here like any payload before it is shown.
// - The reel: the key moments' clips in order on the match's own playback, timed by the
//   script's overlay cue sheet (the same JSON a broadcast graphics engine reads): the score bug
//   over an intro, each clip with its moment's title and the voices' captions (a clip holds its
//   last frame while its lines still run), then the stats. The auto camera director is on while
//   it plays, so the cameras cut inside each clip as they do live (web/src/director).
//
// Nothing here writes a number: every text is a verified line, every value a verified claim's.

import { z } from "zod";
import { ApiError, PERSONAS, StepTrace, VoiceCue, type Api, type Persona } from "../api/client";
import type { Hero } from "../data/hero";
import { directorPrefs } from "../director/director";
import { RenderPayload } from "../narration/payload";
import type { PlaybackState, PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";
import { browserAudio, VoicePlayer, type MakeAudio } from "../voice/voice";
import { LANGUAGES, type Language } from "../whatif/whatif";

const Value = z.union([z.boolean(), z.number(), z.string(), z.null()]);

/** One timed overlay cue (agents/recap.py Cue): seconds on the reel's clock, SMPTE timecodes. */
export const Cue = z.object({
  id: z.string(),
  type: z.enum(["score_bug", "clip", "moment_title", "caption", "stat"]),
  t: z.number(),
  until: z.number(),
  tc: z.string(),
  tc_out: z.string(),
  moment: z.string().nullish(),
  line: z.string().nullish(),
  speaker: z.string().nullish(),
  text: z.string().nullish(),
  claims: z.array(z.string()),
  data: z.record(z.string(), Value),
});
export type Cue = z.infer<typeof Cue>;

export const CueSheet = z.object({
  version: z.literal(1),
  match: z.string(),
  persona: z.string(),
  language: z.string(),
  fps: z.number().int(),
  duration_s: z.number(),
  cues: z.array(Cue),
});
export type CueSheet = z.infer<typeof CueSheet>;

const RecapMoment = z.object({
  id: z.string(),
  rank: z.number().int(),
  kind: z.string(),
  tags: z.array(z.string()),
  actor: z.string(),
  receiver: z.string().nullable(),
  lens: z.string().nullable(),
  hero: z.boolean(), // it has a breakdown of its own
  possession: z.number().int(),
  anchor_frame: z.number().int(),
});
export type RecapMoment = z.infer<typeof RecapMoment>;

const RecapScript = z.object({
  persona: z.string(),
  language: z.string(),
  payload: RenderPayload, // what the voices say, on the reel
  card: RenderPayload, // the card: "S" the score, "K<n>" a key moment, "T<n>" a stat
  card_moments: z.record(z.string(), z.string().nullable()),
  voice: z.array(VoiceCue),
  cues: CueSheet,
});
export type RecapScript = z.infer<typeof RecapScript>;

const ReelClip = z.object({
  moment: z.string(),
  possession: z.number().int(),
  frame_in: z.number().int(),
  frame_out: z.number().int(),
  speed: z.number(),
  camera: z.enum(["broadcast", "tactical"]),
});

/** POST /api/recaps (api/main.py). */
export const RecapResponse = z.object({
  key: z.string(),
  cached: z.boolean(),
  rate_limited: z.boolean(),
  capped: z.boolean(),
  source: z.enum(["model", "offline"]),
  result: z.object({
    score: z.object({ home: z.number().int(), away: z.number().int() }),
    moments: z.array(RecapMoment),
    stats: z.array(z.string()),
    reel: z.object({ match: z.string(), clips: z.array(ReelClip) }),
    reel_source: z.enum(["agent", "template"]),
    tier: z.string(),
    scripts: z.array(RecapScript),
    trace: z.array(StepTrace),
    total_ms: z.number(),
  }),
});
export type RecapResponse = z.infer<typeof RecapResponse>;

/**
 * Why a recap cannot be shown on this match, empty when it can: the schema, then every claim
 * supported with its evidence in the match and its seek frame on the clock, every line's claims
 * known, every caption a line of the script and every clip inside the match.
 */
export function recapErrors(raw: unknown, hero: Hero): string[] {
  const parsed = RecapResponse.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".") || "recap"}: ${i.message}`);
  }
  const run = hero.runs.factual;
  const events = new Set(run.events.map((e) => e.id));
  const errors: string[] = [];
  for (const s of parsed.data.result.scripts) {
    const where = `${s.persona}/${s.language}`;
    for (const [name, payload] of [
      ["payload", s.payload],
      ["card", s.card],
    ] as const) {
      const claims = new Map(payload.claims.map((c) => [c.id, c]));
      for (const c of payload.claims) {
        if (c.verdict !== "supported") errors.push(`${where} ${name}: ${c.id} is ${c.verdict}`);
        for (const e of c.evidence) {
          if (!events.has(e)) errors.push(`${where} ${name}: evidence ${e} is not in the match`);
        }
        if (c.seek_frame != null && (c.seek_frame < 0 || c.seek_frame >= run.frames)) {
          errors.push(`${where} ${name}: ${c.id} seeks outside the match`);
        }
      }
      for (const line of payload.lines) {
        const missing = line.claims.filter((id) => !claims.has(id));
        if (missing.length) errors.push(`${where} ${name}: ${line.id} cites ${missing.join(", ")}`);
      }
    }
    const said = new Set([...s.payload.lines, ...s.card.lines].map((l) => l.text));
    for (const cue of s.cues.cues) {
      if (cue.text != null && !said.has(cue.text)) {
        errors.push(`${where} cue ${cue.id}: its text is not a verified line`);
      }
      if (cue.type !== "clip") continue;
      const lo = Number(cue.data.match_frame_in);
      const hi = Number(cue.data.match_frame_out);
      if (!(lo >= 0 && hi >= lo && hi < run.frames)) {
        errors.push(`${where} cue ${cue.id}: the clip is outside the match`);
      }
    }
  }
  return errors;
}

export type RecapStatus = "idle" | "loading" | "ready" | "failed";

/** The reel on screen: where its clock is and which cues are up. */
export interface ReelState {
  t: number; // s on the reel's clock
  clip: string | null; // the moment whose clip plays (or holds); null in the intro and outro
  caption: string | null; // the payload line whose caption is up
  title: Cue | null; // the moment's title (a lower third)
  stats: Cue[]; // the stats up so far (the outro)
  intro: boolean; // before the first clip: the result
}

export interface RecapState {
  status: RecapStatus;
  persona: Persona;
  language: Language;
  response: RecapResponse | null; // the recap for (persona, language), once checked
  error: string | null;
  fullTime: boolean; // the live stream reached the final whistle
  reel: ReelState | null; // the reel is playing
}

export interface RecapOptions {
  api: Api | null; // the recap needs the live service
  hero: Hero; // the stitched match
  playback: PlaybackStore;
  takeOver: () => void; // leave the live stream: the recap drives the playhead
  makeAudio?: MakeAudio;
}

export interface Recap {
  state: Store<RecapState>;
  voice: VoicePlayer;
  /** Ask for the recap, for another persona or language when given. */
  request(patch?: { persona?: Persona; language?: Language }): Promise<void>;
  /** The live stream reached full time: fetch the recap. */
  fullTime(): void;
  /** Seek the match to a key moment and play its clip. */
  watch(moment: string): void;
  playReel(): void;
  stopReel(): void;
  /** One clock step of `dt` wall-clock seconds while the reel plays. */
  tick(dt: number): void;
  /** The script for the persona and language on screen. */
  script(): RecapScript | null;
  /** GET /api/recaps/<key>/cues for the script on screen: the machine-readable cue sheet. */
  cuesUrl(): string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A recap the service refused: why, in a sentence the viewer can act on. */
function refusal(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) {
    return err.detail ?? "Too many requests from this address: try again in a few minutes.";
  }
  return message(err);
}

export function createRecap(options: RecapOptions): Recap {
  const { api, hero, playback } = options;
  const state = createStore<RecapState>({
    status: "idle",
    persona: "casual",
    language: "en",
    response: null,
    error: null,
    fullTime: false,
    reel: null,
  });
  const voice = new VoicePlayer(
    api ? (key) => api.tts(key) : null,
    options.makeAudio ?? browserAudio,
  );
  let turn = 0;
  let saved: Pick<PlaybackState, "autoSlow" | "speed"> | null = null; // restored after the reel
  let auto: boolean | null = null; // the viewer's auto director, restored after the reel

  const script = (): RecapScript | null => {
    const { response, persona, language } = state.get();
    return (
      response?.result.scripts.find((s) => s.persona === persona && s.language === language) ??
      null
    );
  };

  async function request(patch: { persona?: Persona; language?: Language } = {}) {
    const persona = patch.persona ?? state.get().persona;
    const language = patch.language ?? state.get().language;
    if (!PERSONAS.includes(persona) || !LANGUAGES.includes(language)) return;
    stopReel();
    state.set({ persona, language });
    if (!api) {
      state.set({ status: "failed", error: "The recap needs the live service." });
      return;
    }
    const mine = ++turn;
    state.set({ status: "loading", error: null });
    try {
      const raw = await api.recap({ persona, language });
      if (mine !== turn) return;
      const errors = recapErrors(raw, hero);
      if (errors.length) throw new Error(`the recap does not fit this match: ${errors[0]}`);
      state.set({ status: "ready", response: RecapResponse.parse(raw), error: null });
    } catch (err) {
      if (mine === turn) state.set({ status: "failed", error: refusal(err) });
    }
  }

  const cues = () => script()?.cues.cues ?? [];
  const at = (type: Cue["type"], t: number) =>
    cues().find((c) => c.type === type && c.t <= t && t < c.until) ?? null;

  /** Put the playhead where the reel is at `t`: a clip starts playing when its cue starts. */
  function show(t: number) {
    const before = state.get().reel;
    const clip = at("clip", t);
    const caption = at("caption", t);
    const title = at("moment_title", t);
    const first = cues().find((c) => c.type === "clip");
    const reel: ReelState = {
      t,
      clip: clip?.moment ?? null,
      caption: caption?.line ?? null,
      title,
      stats: cues().filter((c) => c.type === "stat" && c.t <= t),
      intro: first ? t < first.t : false,
    };
    if (clip && clip.moment !== before?.clip) {
      playback.set({
        live: false,
        mode: "factual",
        frame: Number(clip.data.match_frame_in),
        playUntil: Number(clip.data.match_frame_out),
        playing: true,
        speed: Number(clip.data.speed),
        focus: clip.data.camera === "tactical" ? "tactical" : "broadcast",
        camera: "broadcast",
      });
    } else if (!clip && before?.clip !== null && !reel.intro) {
      playback.set({ playing: false, playUntil: null }); // the outro holds the last frame
    }
    if (reel.caption !== before?.caption) {
      voice.say(script()?.voice.find((v) => v.line === reel.caption));
    }
    state.set({ reel });
  }

  function playReel() {
    const s = script();
    if (!s) return;
    options.takeOver();
    voice.stop();
    const first = s.cues.cues.find((c) => c.type === "clip");
    const p = playback.get();
    saved = { autoSlow: p.autoSlow, speed: p.speed };
    auto = directorPrefs.get().auto;
    directorPrefs.set({ auto: true }); // the camera director cuts inside each clip
    playback.set({
      live: false,
      playing: false,
      playUntil: null,
      autoSlow: false, // the cue sheet times the clips at their own speed
      mode: "factual",
      frame: first ? Number(first.data.match_frame_in) : p.frame,
    });
    state.set({ reel: null });
    show(0);
  }

  function stopReel() {
    if (!state.get().reel) return;
    voice.stop();
    state.set({ reel: null });
    playback.set({ playing: false, playUntil: null, ...(saved ?? {}) });
    if (auto !== null) directorPrefs.set({ auto });
    saved = auto = null;
  }

  return {
    state,
    voice,
    request,
    fullTime() {
      state.set({ fullTime: true });
      const { status } = state.get();
      if (status === "idle" || status === "failed") void request();
    },
    watch(moment) {
      const clip = state.get().response?.result.reel.clips.find((c) => c.moment === moment);
      if (!clip) return;
      stopReel();
      options.takeOver();
      playback.set({
        live: false,
        mode: "factual",
        frame: clip.frame_in,
        playUntil: clip.frame_out,
        playing: true,
      });
    },
    playReel,
    stopReel,
    tick(dt) {
      const reel = state.get().reel;
      const s = script();
      if (!reel || !s) return;
      const t = reel.t + dt;
      if (t >= s.cues.duration_s) {
        stopReel();
        return;
      }
      show(t);
    },
    script,
    cuesUrl() {
      const { response, persona, language } = state.get();
      if (!api || !response) return null;
      const q = new URLSearchParams({ persona, language });
      return `${api.base}/api/recaps/${encodeURIComponent(response.key)}/cues?${q}`;
    },
  };
}
