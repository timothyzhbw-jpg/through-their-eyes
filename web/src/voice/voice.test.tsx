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

describe("voice", () => {
  it("is off by default and says nothing until turned on", async () => {
    const { session, fetch, audio } = online();
    expect(session.voice.state.get().on).toBe(false);
    const html = render(session, <SoundToggle />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Sound off");

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
});
