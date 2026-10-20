// Spoken narration (SPEC 6 Voice): each line's cue key goes to the API's /api/tts, which speaks
// the SSML its own crew wrote for that key (Azure AI Speech), and the WAV plays as its caption
// comes up. Off by default: sound starts only when the viewer turns it on. Without the live service
// there are no cues and no speech, so the switch is disabled. Clips are kept per cue key, so a
// replayed line is not fetched twice.

import type { VoiceCue } from "../api/client";
import { createStore, type Store } from "../store/store";

export interface VoiceState {
  on: boolean;
  status: "idle" | "loading" | "playing" | "failed";
  line: string | null; // line being spoken (or fetched)
  error: string | null;
}

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

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class VoicePlayer {
  readonly state: Store<VoiceState> = createStore<VoiceState>({
    on: false,
    status: "idle",
    line: null,
    error: null,
  });
  private audio: AudioLike | null = null;
  private clips = new Map<string, Promise<Blob>>();
  private turn = 0;

  constructor(
    private readonly synthesize: ((key: string) => Promise<Blob>) | null,
    private readonly makeAudio: MakeAudio = browserAudio,
  ) {}

  /** Speech needs the live service. */
  get available(): boolean {
    return this.synthesize !== null;
  }

  setOn(on: boolean): void {
    if (!this.available) return;
    if (!on) this.stop();
    this.state.set({ on, error: null });
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
