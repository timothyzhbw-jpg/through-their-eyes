// Spoken narration (SPEC 6 Voice): each line's cue key goes to the API's /api/tts, which speaks
// the SSML its own crew wrote for that key (Azure AI Speech), and the WAV plays as its caption
// comes up. Off by default: sound starts only when the viewer turns it on or chooses audio
// description (session.ts). Without the live service there are no cues and no speech, so the
// switch is disabled. Clips are kept per cue key, so a replayed line is not fetched twice.
//
// Lines start long after the tap that turned the sound on, and Safari (and every browser on iOS)
// lets an <audio> element play only from inside a tap. So the tap makes and wakes the page's one
// AudioContext (sound/engine.ts `unlock`), and every clip plays through it: a running context may
// start a clip at any time. The Sound switch is the page's (`SoundSwitch`): every voice on it,
// a moment's, one opened from the match and the match's recap, follows it.

import type { VoiceCue } from "../api/client";
import { soundEngine } from "../sound/engine";
import { createStore, type Store } from "../store/store";

export interface VoiceState {
  on: boolean;
  status: "idle" | "loading" | "playing" | "failed";
  line: string | null; // line being spoken (or fetched)
  error: string | null;
}

/** The Sound switch every voice of a page follows. `asked`: it has been on at least once. */
export interface SoundSwitch {
  on: boolean;
  asked: boolean;
}
export const createSoundSwitch = (): Store<SoundSwitch> =>
  createStore<SoundSwitch>({ on: false, asked: false });

/** What the player needs of an <audio> element; tests pass a fake. */
export interface AudioLike {
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
}
export type MakeAudio = (clip: Blob) => AudioLike;

/** An <audio> element on an object URL, released when the clip ends or is stopped. */
export const browserAudio: MakeAudio = (clip) => {
  const url = URL.createObjectURL(clip);
  const audio = new Audio(url);
  const release = () => URL.revokeObjectURL(url);
  const like: AudioLike = {
    play: () => audio.play(),
    pause() {
      audio.pause();
      release();
    },
    onended: null,
  };
  audio.onended = () => {
    release();
    like.onended?.();
  };
  return like;
};

/** A clip decoded and played through `ctx` to the speakers. A stopped clip reports no end. */
export function contextAudio(ctx: AudioContext, clip: Blob): AudioLike {
  let source: AudioBufferSourceNode | null = null;
  let stopped = false;
  const like: AudioLike = {
    async play() {
      // Not awaited: a clip started on a context that is still waking plays once it is awake.
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      const buffer = await ctx.decodeAudioData(await clip.arrayBuffer());
      if (stopped) return;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (!stopped) like.onended?.();
      };
      source.start();
    },
    pause() {
      stopped = true;
      try {
        source?.stop();
      } catch {
        // already ended
      }
    },
    onended: null,
  };
  return like;
}

/** Through the page's AudioContext once the Sound switch's tap has made it; else an <audio>. */
export const pageAudio: MakeAudio = (clip) => {
  const ctx = soundEngine.context;
  return ctx ? contextAudio(ctx, clip) : browserAudio(clip);
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class VoicePlayer {
  readonly state: Store<VoiceState>;
  private audio: AudioLike | null = null;
  private clips = new Map<string, Promise<Blob>>();
  private turn = 0;

  /** `unlock` runs inside the tap that turns the sound on (the page's AudioContext). */
  constructor(
    private readonly synthesize: ((key: string) => Promise<Blob>) | null,
    private readonly makeAudio: MakeAudio = pageAudio,
    readonly sound: Store<SoundSwitch> = createSoundSwitch(),
    private readonly unlock: () => void = () => soundEngine.unlock(),
  ) {
    this.state = createStore<VoiceState>({
      on: !!synthesize && sound.get().on,
      status: "idle",
      line: null,
      error: null,
    });
    sound.subscribe(() => {
      const on = this.available && sound.get().on;
      if (on === this.state.get().on) return;
      if (!on) this.stop();
      this.state.set({ on, error: null });
    });
  }

  /** Speech needs the live service. */
  get available(): boolean {
    return this.synthesize !== null;
  }

  /** Sound is on and a clip is loading or playing. */
  get busy(): boolean {
    const { on, status } = this.state.get();
    return on && (status === "loading" || status === "playing");
  }

  /** The page's switch: every voice on it follows. Call it from the tap itself. */
  setOn(on: boolean): void {
    if (!this.available) return;
    if (on) this.unlock();
    if (!on) this.stop();
    this.sound.set((s) => ({ on, asked: s.asked || on }));
    if (this.state.get().error) this.state.set({ error: null });
  }

  /** Speak one line, cutting off the previous one. Does nothing while sound is off. */
  async say(cue: VoiceCue | undefined): Promise<void> {
    if (!cue || !this.synthesize || !this.state.get().on) return;
    this.stop();
    const turn = this.turn;
    this.state.set({ status: "loading", line: cue.line, error: null });
    try {
      let clip = this.clips.get(cue.cache_key);
      if (!clip) {
        clip = this.synthesize(cue.cache_key);
        this.clips.set(cue.cache_key, clip);
        clip.catch(() => this.clips.delete(cue.cache_key));
      }
      const blob = await clip;
      if (turn !== this.turn || !this.state.get().on) return;
      const audio = this.makeAudio(blob);
      this.audio = audio;
      audio.onended = () => {
        if (this.audio !== audio) return;
        this.audio = null;
        this.state.set({ status: "idle", line: null });
      };
      this.state.set({ status: "playing" });
      await audio.play();
    } catch (err) {
      if (turn === this.turn) this.state.set({ status: "failed", line: null, error: message(err) });
    }
  }

  stop(): void {
    this.turn += 1;
    this.audio?.pause();
    this.audio = null;
    if (this.state.get().status !== "idle") this.state.set({ status: "idle", line: null });
  }
}
