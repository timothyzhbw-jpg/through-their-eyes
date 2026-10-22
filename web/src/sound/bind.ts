// The sound design on a hero moment's session (SPEC 7): it follows the Sound switch (the voice's
// `on`, so it is off by default and off whenever the switch is), ducks under the voice while a
// line is spoken, muffles the crowd with the key-moment beat, and plays the cues of cues.ts.

import { motion, pushAt } from "../beat/beat";
import { lineKinds, lineOf } from "../narration/payload";
import type { Session } from "../session";
import { bedCutoff, cuesBetween, duckFor, STING_GAP_S } from "./cues";

/** What the bindings need of the sound engine (engine.ts; tests pass a recorder). */
export interface SoundOut {
  setOn(on: boolean): void;
  setDuck(gain: number): void;
  setMuffle(cutoffHz: number): void;
  whoosh(pan: number): void;
  sting(): void;
}

/** Wire `out` to the session; returns the unbinding (which also turns the sound off). */
export function bindSound(
  session: Pick<Session, "hero" | "playback" | "voice" | "breakdown">,
  out: SoundOut,
  now: () => number = () => performance.now() / 1000,
): () => void {
  const { hero, playback, voice, breakdown } = session;
  let prev = playback.get();
  let lastSting = -Infinity;
  const isReveal = (lineId: string) => {
    const narration = breakdown.get().narration;
    const line = lineOf(narration, lineId);
    return !!narration && !!line && lineKinds(narration, line).includes("counterfactual");
  };
  const onVoice = () => {
    const v = voice.state.get();
    out.setOn(v.on);
    out.setDuck(duckFor(v));
  };
  const onPlayback = () => {
    const next = playback.get();
    const reduced = motion.get().reduced;
    out.setMuffle(bedCutoff(reduced ? 0 : pushAt(hero, hero.runs[next.mode], next.frame)));
    if (voice.state.get().on) {
      for (const cue of cuesBetween(prev, next, { hero, isReveal, reduced })) {
        if (cue.kind === "whoosh") out.whoosh(cue.pan);
        else if (now() - lastSting >= STING_GAP_S) {
          lastSting = now();
          out.sting();
        }
      }
    }
    prev = next;
  };
  onVoice();
  onPlayback();
  const stops = [voice.state.subscribe(onVoice), playback.subscribe(onPlayback)];
  return () => {
    stops.forEach((stop) => stop());
    out.setOn(false);
  };
}

/** A stitched match's live screen: the crowd follows the match's Sound switch (its recap's voice)
 * and ducks under that voice. No scans or reveals of its own to cue. Returns the unbinding. */
export function bindMatchSound(voice: Pick<Session["voice"], "state">, out: SoundOut): () => void {
  const onVoice = () => {
    const v = voice.state.get();
    out.setOn(v.on);
    out.setDuck(duckFor(v));
  };
  onVoice();
  const stop = voice.state.subscribe(onVoice);
  return () => {
    stop();
    out.setOn(false);
  };
}
