// The sound design (SPEC 7): silent until the Sound switch is on, a whoosh as each of his scans
// begins, a sting at the "without the look" reveal (not under reduced motion), the crowd muffled
// through the key-moment beat, and everything ducked under the narration voice.

import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { motion } from "../beat/beat";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { VoicePlayer, type AudioLike } from "../voice/voice";
import { bindSound, type SoundOut } from "./bind";
import { bedCutoff, cuesBetween, DUCK, STING_GAP_S } from "./cues";

const hero = parseHero(raw);
const key = hero.keyScan!;

class Recorder implements SoundOut {
  on: boolean[] = [];
  duck: number[] = [];
  cutoff: number[] = [];
  whooshes: number[] = [];
  stings = 0;
  setOn(on: boolean) {
    this.on.push(on);
  }
  setDuck(gain: number) {
    this.duck.push(gain);
  }
  setMuffle(hz: number) {
    this.cutoff.push(hz);
  }
  whoosh(pan: number) {
    this.whooshes.push(pan);
  }
  sting() {
    this.stings += 1;
  }
}

const silentAudio = (): AudioLike => ({ play: async () => {}, pause() {}, onended: null });

/** The bundled moment with a voice that can be switched on (as online), and a fake clock. */
function setup() {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
  const voice = new VoicePlayer(async () => new Blob(["wav"]), silentAudio);
  const out = new Recorder();
  const clock = { t: 100 };
  const unbind = bindSound({ ...session, voice }, out, () => clock.t);
  return { session, voice, out, clock, unbind, playback: session.playback };
}

/** Play from `from` to `to` in steps of `step` frames. */
function play(
  playback: ReturnType<typeof setup>["playback"],
  from: number,
  to: number,
  step = 0.4,
) {
  playback.set({ frame: from, playing: true });
  for (let f = from + step; f <= to; f += step) playback.set({ frame: f });
}

afterEach(() => motion.set({ reduced: false }));

describe("the sound design", () => {
  it("is silent until the Sound switch is on, and goes off with it", () => {
    const { voice, out, playback } = setup();
    expect(out.on.at(-1)).toBe(false);
    play(playback, key.start - 5, key.start + 5);
    expect(out.whooshes).toEqual([]);
    voice.setOn(true);
    expect(out.on.at(-1)).toBe(true);
    voice.setOn(false);
    expect(out.on.at(-1)).toBe(false);
    play(playback, key.start - 5, key.start + 5);
    playback.set({ mode: "counterfactual" });
    expect(out.whooshes).toEqual([]);
    expect(out.stings).toBe(0);
  });

  it("whooshes as each of his scans begins while it plays, not on a seek or while paused", () => {
    const { voice, out, playback } = setup();
    voice.setOn(true);
    play(playback, key.start - 5, key.start + 5);
    expect(out.whooshes).toHaveLength(1);
    expect(Math.abs(out.whooshes[0])).toBeGreaterThan(0.1); // panned the way he turns
    playback.set({ frame: key.start - 30, playing: true });
    playback.set({ frame: key.start + 2 }); // a seek across it
    playback.set({ frame: key.start - 1, playing: false });
    playback.set({ frame: key.start + 1 }); // scrubbing while paused
    expect(out.whooshes).toHaveLength(1);
  });

  it("only for the player whose eyes these are", () => {
    const { voice, out, playback } = setup();
    voice.setOn(true);
    playback.set({ povPlayer: "A5" });
    const other = hero.runs.factual.scans.find((s) => s.player === "A5")!;
    play(playback, other.start - 2, other.start + 2);
    expect(out.whooshes).toHaveLength(1);
    play(playback, key.start - 2, key.start + 2); // H8's look: not his
    expect(out.whooshes).toHaveLength(1);
  });

  it("stings at the reveal: switching to the run without the look, at most once in a while", () => {
    const { voice, out, playback, clock } = setup();
    voice.setOn(true);
    playback.set({ mode: "counterfactual" });
    expect(out.stings).toBe(1);
    playback.set({ mode: "factual" });
    playback.set({ mode: "counterfactual" });
    expect(out.stings).toBe(1); // too soon after the last
    clock.t += STING_GAP_S + 0.1;
    playback.set({ mode: "factual" });
    playback.set({ mode: "counterfactual" });
    expect(out.stings).toBe(2);
  });

  it("stings when the first caption of a counterfactual stretch comes up", () => {
    const { voice, out, playback, clock } = setup();
    voice.setOn(true);
    playback.set({ captionLine: "L2" }); // observed
    expect(out.stings).toBe(0);
    playback.set({ captionLine: "L3" }); // carries cf_belief_error: "Without that look ..."
    expect(out.stings).toBe(1);
    clock.t += STING_GAP_S + 0.1;
    playback.set({ captionLine: "L4" });
    playback.set({ captionLine: "L5" }); // a new stretch
    expect(out.stings).toBe(2);
    clock.t += STING_GAP_S + 0.1;
    playback.set({ captionLine: "L7" }); // right after another counterfactual line: no
    expect(out.stings).toBe(2);
  });

  it("drops the sting under reduced motion, keeps the whoosh", () => {
    motion.set({ reduced: true });
    const { voice, out, playback } = setup();
    voice.setOn(true);
    play(playback, key.start - 5, key.start + 5);
    playback.set({ mode: "counterfactual", captionLine: "L5" });
    expect(out.stings).toBe(0);
    expect(out.whooshes).toHaveLength(1);
  });

  it("ducks everything under the voice while it speaks", () => {
    const { voice, out } = setup();
    voice.setOn(true);
    expect(out.duck.at(-1)).toBe(1);
    voice.state.set({ status: "loading" });
    expect(out.duck.at(-1)).toBe(1); // nothing to duck under yet
    voice.state.set({ status: "playing" });
    expect(out.duck.at(-1)).toBe(DUCK);
    voice.state.set({ status: "idle" });
    expect(out.duck.at(-1)).toBe(1);
  });

  it("muffles the crowd through the key-moment beat, not under reduced motion", () => {
    const { out, playback } = setup();
    playback.set({ frame: key.start - 20 });
    expect(out.cutoff.at(-1)).toBeCloseTo(bedCutoff(0), 6);
    playback.set({ frame: (key.start + key.end) / 2 });
    expect(out.cutoff.at(-1)).toBeLessThan(800);
    motion.set({ reduced: true });
    playback.set({ frame: (key.start + key.end) / 2 + 1 });
    expect(out.cutoff.at(-1)).toBeCloseTo(bedCutoff(0), 6);
  });

  it("turns the sound off when unbound", () => {
    const { voice, out, unbind } = setup();
    voice.setOn(true);
    unbind();
    expect(out.on.at(-1)).toBe(false);
  });

  it("whooshes nothing for frames the playhead jumped over between runs", () => {
    const ctx = { hero, isReveal: () => false, reduced: false };
    const base = { playing: true, povPlayer: "H8", captionLine: null, live: false };
    const cues = cuesBetween(
      { ...base, frame: key.start - 1, mode: "counterfactual" },
      { ...base, frame: key.start + 1, mode: "factual" },
      ctx,
    );
    expect(cues).toEqual([]);
  });
});
