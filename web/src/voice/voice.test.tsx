// Spoken narration (SPEC 6 Voice): off by default; once the viewer turns it on, each caption's cue
// key (never its SSML) goes to /api/tts and the clip plays. Without the live service the switch is
// disabled.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { API, breakdownResponse, fakeFetch, json, render, settle } from "../testing";
import { SoundToggle } from "../ui/Narration";
import { VoicePlayer, type AudioLike } from "./voice";

const hero = parseHero(raw);

function fakeAudio() {
  const played: Blob[] = [];
  const paused: AudioLike[] = [];
  const make = (clip: Blob): AudioLike => {
    const audio: AudioLike = {
      play: async () => {
        played.push(clip);
      },
      pause: () => paused.push(audio),
      onended: null,
    };
    return audio;
  };
  return Object.assign(make, { played, paused });
}

function online() {
  const fetch = fakeFetch({
    "POST /api/breakdowns": () => json(breakdownResponse()),
    "POST /api/tts": () => new Response(new Blob(["RIFF"], { type: "audio/wav" })),
  });
  const audio = fakeAudio();
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    makeAudio: audio,
  });
  return { session, fetch, audio };
}
const ttsCalls = <T extends { path: string }>(calls: T[]) =>
  calls.filter((c) => c.path === "/api/tts");

/** Clips the test can end by hand, and every clip `pause()` stopped. */
function clipAudio() {
  const clips: AudioLike[] = [];
  const paused: AudioLike[] = [];
  const make = (): AudioLike => {
    const audio: AudioLike = {
      play: async () => {},
      pause: () => paused.push(audio),
      onended: null,
    };
    clips.push(audio);
    return audio;
  };
  return Object.assign(make, { clips, paused });
}

/** A short breakdown: captions at 0.2 s and 1.5 s, a camera cut at 1.6 s. */
function replay() {
  const audio = clipAudio();
  const fetch = fakeFetch({
    "POST /api/breakdowns": () => {
      const body = breakdownResponse();
      body.result.plan = {
        moment: body.result.plan.moment,
        duration_s: 3,
        steps: [
          { t: 0, do: "freeze" },
          { t: 1.6, do: "camera", mode: "broadcast" },
        ],
      };
      const cues = body.result.scripts[0].voice;
      cues[0].t = 0.2;
      cues[1].t = 1.5;
      cues[2].t = 2.4;
      return json(body);
    },
    "POST /api/tts": () => new Response(new Blob(["RIFF"], { type: "audio/wav" })),
  });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    makeAudio: audio,
  });
  return { session, audio };
}

describe("voice", () => {
  it("is off by default and says nothing until turned on", async () => {
    const { session, fetch, audio } = online();
    expect(session.voice.state.get().on).toBe(false);
    const html = render(session, <SoundToggle />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Sound</button>"); // "off" is drawn from aria-pressed

    session.controls.requestBreakdown();
    await settle();
    session.controls.openLine("L1"); // a caption comes up
    session.controls.playBreakdown();
    session.runner.tick(1); // the plan's first voice step
    await settle();
    expect(session.playback.get().captionLine).toBe("L1");
    expect(ttsCalls(fetch.calls)).toEqual([]);
    expect(audio.played).toEqual([]);
  });

  it("speaks each caption by its cue key once turned on, and stops when turned off", async () => {
    const { session, fetch, audio } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.setSound(true);
    expect(render(session, <SoundToggle />)).toContain('aria-pressed="true"');
    session.controls.openLine("L2");
    await settle();
    const cue = session.breakdown.get().voice.find((c) => c.line === "L2")!;
    expect(ttsCalls(fetch.calls).map((c) => c.body)).toEqual([{ key: cue.cache_key }]);
    expect(audio.played).toHaveLength(1);
    expect(session.voice.state.get()).toMatchObject({ status: "playing", line: "L2" });

    session.controls.openLine("L1");
    await settle();
    session.controls.openLine("L2"); // the same line again: the clip is reused
    await settle();
    expect(ttsCalls(fetch.calls)).toHaveLength(2);
    expect(audio.played).toHaveLength(3);

    session.controls.setSound(false);
    expect(audio.paused).toHaveLength(3); // each new line cut the last; off cut the third
    expect(session.voice.state.get()).toMatchObject({ on: false, status: "idle" });
  });

  it("is disabled without the live service", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    expect(session.voice.available).toBe(false);
    session.controls.setSound(true);
    expect(session.voice.state.get().on).toBe(false);
    expect(render(session, <SoundToggle />)).toMatch(/<button[^>]*disabled/);
  });

  it("is busy only while sound is on and a clip is loading or playing", async () => {
    const cue = { line: "L1", speaker: "pbp", t: 0, voice: "v", ssml: "<speak/>", cache_key: "k" };
    let resolveClip: (blob: Blob) => void = () => {};
    let current: AudioLike | null = null;
    const voice = new VoicePlayer(
      () => new Promise<Blob>((resolve) => (resolveClip = resolve)),
      () => {
        current = { play: async () => {}, pause: () => {}, onended: null };
        return current;
      },
    );

    expect(voice.busy).toBe(false);
    await voice.say(cue);
    expect(voice.busy).toBe(false);

    voice.setOn(true);
    expect(voice.busy).toBe(false);
    const loading = voice.say(cue);
    expect(voice.state.get().status).toBe("loading");
    expect(voice.busy).toBe(true);
    resolveClip(new Blob(["RIFF"]));
    await loading;
    expect(voice.state.get().status).toBe("playing");
    expect(voice.busy).toBe(true);
    current!.onended?.();
    expect(voice.state.get().status).toBe("idle");
    expect(voice.busy).toBe(false);

    let rejectClip: (err: Error) => void = () => {};
    const failing = new VoicePlayer(
      () => new Promise<Blob>((_, reject) => (rejectClip = reject)),
      fakeAudio(),
    );
    failing.setOn(true);
    const failed = failing.say(cue);
    expect(failing.state.get().status).toBe("loading");
    expect(failing.busy).toBe(true);
    rejectClip(new Error("HTTP 429"));
    await failed;
    expect(failing.state.get()).toMatchObject({ status: "failed", error: "HTTP 429" });
    expect(failing.busy).toBe(false);
  });

  it("does not start a clip whose synthesis finishes after stop", async () => {
    const cue = { line: "L1", speaker: "pbp", t: 0, voice: "v", ssml: "<speak/>", cache_key: "k" };
    let resolveClip: (blob: Blob) => void = () => {};
    const audio = fakeAudio();
    const voice = new VoicePlayer(
      () => new Promise<Blob>((resolve) => (resolveClip = resolve)),
      audio,
    );
    voice.setOn(true);
    const loading = voice.say(cue);
    voice.stop();
    resolveClip(new Blob(["RIFF"]));
    await loading;
    expect(audio.played).toEqual([]);
    expect(voice.state.get()).toMatchObject({ status: "idle", line: null });
  });

  it("reports a failed synthesis and tries again next time", async () => {
    let fail = true;
    const asked: string[] = [];
    const voice = new VoicePlayer(async (key) => {
      asked.push(key);
      if (fail) throw new Error("HTTP 429");
      return new Blob(["RIFF"]);
    }, fakeAudio());
    voice.setOn(true);
    const cue = { line: "L1", speaker: "pbp", t: 0, voice: "v", ssml: "<speak/>", cache_key: "k" };
    await voice.say(cue);
    expect(voice.state.get()).toMatchObject({ status: "failed", error: "HTTP 429" });
    fail = false;
    await voice.say(cue);
    expect(voice.state.get().status).toBe("playing");
    expect(asked).toEqual(["k", "k"]);
  });

  it("lets a breakdown line finish before the next caption, and does not when sound is off", async () => {
    const quiet = replay();
    quiet.session.controls.requestBreakdown();
    await settle();
    quiet.session.controls.playBreakdown();
    const voiceSteps = quiet.session.breakdown
      .get()
      .resolved.plan.steps.filter((s) => s.do === "voice");
    expect(voiceSteps.map((s) => s.t)).toEqual([0.2, 1.5, 2.4]);
    quiet.session.runner.tick(0.2);
    expect(quiet.session.playback.get().captionLine).toBe("L1");
    quiet.session.runner.tick(1.3);
    expect(quiet.session.playback.get().captionLine).toBe("L2");
    expect(quiet.session.runner.status.get().t).toBeCloseTo(1.5);
    quiet.session.runner.tick(0.1);
    expect(quiet.session.playback.get().focus).toBe("broadcast");
    expect(quiet.audio.clips).toEqual([]);

    const { session, audio } = replay();
    session.controls.requestBreakdown();
    await settle();
    session.controls.setSound(true);
    session.controls.playBreakdown();
    session.runner.tick(0.2);
    await settle();
    expect(session.playback.get().captionLine).toBe("L1");
    expect(audio.clips).toHaveLength(1);
    expect(session.voice.busy).toBe(true);

    session.runner.tick(2);
    await settle();
    expect(session.playback.get().captionLine).toBe("L1");
    expect(session.playback.get().focus).not.toBe("broadcast");
    expect(session.runner.status.get().t).toBeCloseTo(1.5);
    expect(session.runner.status.get().status).toBe("running");
    expect(audio.clips).toHaveLength(1);
    expect(audio.paused).toEqual([]);

    audio.clips[0].onended?.();
    expect(session.voice.busy).toBe(false);
    session.runner.tick(0.24);
    expect(session.playback.get().captionLine).toBe("L1");
    expect(audio.clips).toHaveLength(1);

    session.runner.tick(0.01);
    await settle();
    expect(session.playback.get().captionLine).toBe("L2");
    expect(audio.clips).toHaveLength(2);
    expect(audio.paused).toEqual([]);
    expect(session.voice.state.get()).toMatchObject({ status: "playing", line: "L2" });
  });
});
