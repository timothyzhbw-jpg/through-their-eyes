// Sound that a browser lets play (teammates heard nothing): Safari, and every browser on iOS,
// lets an <audio> element play only from inside a tap, and the narration's lines start long after
// the tap that turned the sound on. So the page's one AudioContext is made and woken inside that
// tap, and every clip plays through it; on an iPhone it also plays with the silent switch on. The
// Sound switch is the page's: a moment opened from the match, and the match's recap, keep it. Off
// and never used, the switch says "Tap for sound".

import { afterEach, describe, expect, it, vi } from "vitest";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import raw from "../../public/data/hero_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { SoundEngine } from "../sound/engine";
import {
  API,
  breakdownResponse,
  exportJson,
  fakeFetch,
  fakeSockets,
  health,
  json,
  MATCH,
  MATCH_HERO,
  matchBreakdown,
  matchExport,
  matchInfo,
  render,
  settle,
} from "../testing";
import { SoundToggle } from "../ui/Narration";
import { contextAudio, createSoundSwitch, VoicePlayer, type AudioLike } from "./voice";

const hero = parseHero(raw);
const cue = { line: "L1", speaker: "pbp", t: 0, voice: "v", ssml: "<speak/>", cache_key: "k" };
const silent = (): AudioLike => ({ play: async () => {}, pause() {}, onended: null });

/** Just enough of an AudioContext: what was decoded, started and stopped, and its state. */
function fakeContext(state: AudioContextState = "running") {
  const log: string[] = [];
  const sources: { onended: (() => void) | null; start(): void; stop(): void }[] = [];
  const ctx = {
    state,
    destination: { name: "speakers" },
    currentTime: 0,
    resume: vi.fn(async () => {
      ctx.state = "running";
      log.push("resume");
    }),
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => {
      log.push(`decode ${data.byteLength} B`);
      return { duration: 1.2 } as AudioBuffer;
    }),
    createBufferSource: () => {
      const source = {
        buffer: null as AudioBuffer | null,
        onended: null as (() => void) | null,
        connect: (to: { name?: string }) => log.push(`connect ${to.name}`),
        disconnect: () => {},
        start: () => log.push(`start ${source.buffer?.duration} s`),
        stop: () => {
          log.push("stop");
          source.onended?.();
        },
      };
      sources.push(source);
      return source;
    },
  };
  return { ctx, log, sources };
}

afterEach(() => vi.unstubAllGlobals());

describe("speech through the page's AudioContext", () => {
  it("decodes the clip and plays it to the speakers, ending as the clip ends", async () => {
    const { ctx, log, sources } = fakeContext();
    const audio = contextAudio(ctx as unknown as AudioContext, new Blob(["RIFF-wav!"]));
    const ended = vi.fn();
    audio.onended = ended;
    await audio.play();
    expect(log).toEqual(["decode 9 B", "connect speakers", "start 1.2 s"]);
    sources[0].onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("wakes a suspended context, and a stopped clip neither starts nor reports an end", async () => {
    const { ctx, log, sources } = fakeContext("suspended");
    const late = contextAudio(ctx as unknown as AudioContext, new Blob(["RIFF"]));
    const ended = vi.fn();
    late.onended = ended;
    const playing = late.play();
    late.pause(); // cut off while the clip decodes
    await playing;
    expect(ctx.resume).toHaveBeenCalled();
    expect(log.filter((l) => l.startsWith("start"))).toEqual([]);

    const cut = contextAudio(ctx as unknown as AudioContext, new Blob(["RIFF"]));
    cut.onended = ended;
    await cut.play();
    cut.pause();
    expect(log.at(-1)).toBe("stop");
    expect(sources).toHaveLength(1);
    expect(ended).not.toHaveBeenCalled();
  });
});

describe("the Sound switch's tap", () => {
  it("unlocks the page's audio inside the tap, before any clip is asked for", () => {
    const unlock = vi.fn();
    const voice = new VoicePlayer(async () => new Blob(["RIFF"]), silent, undefined, unlock);
    voice.setOn(true);
    expect(unlock).toHaveBeenCalledTimes(1);
    voice.setOn(false);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("makes and wakes the engine's context in the same call, set to play past the silent switch", () => {
    const { ctx } = fakeContext("suspended");
    const made = vi.fn(() => ctx as unknown as AudioContext);
    const audioSession = { type: "auto" };
    vi.stubGlobal("navigator", { audioSession });
    const engine = new SoundEngine(made);
    expect(engine.context).toBeNull();
    engine.unlock();
    expect(made).toHaveBeenCalledTimes(1);
    expect(engine.context).toBe(ctx);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(audioSession.type).toBe("playback");
    engine.unlock(); // one context for the page
    expect(made).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser without Web Audio", () => {
    const engine = new SoundEngine(() => null);
    expect(() => engine.unlock()).not.toThrow();
    expect(engine.context).toBeNull();
  });
});

describe("one Sound switch for the page", () => {
  it("is shared by every voice on it: on for one is on for all, off stops them all", async () => {
    const sound = createSoundSwitch();
    const paused: string[] = [];
    const audio = (name: string) => (): AudioLike => ({
      play: async () => {},
      pause: () => paused.push(name),
      onended: null,
    });
    const synth = async () => new Blob(["RIFF"]);
    const moment = new VoicePlayer(synth, audio("moment"), sound, () => {});
    const recap = new VoicePlayer(synth, audio("recap"), sound, () => {});
    moment.setOn(true);
    expect(recap.state.get().on).toBe(true);
    await recap.say(cue);
    expect(recap.state.get().status).toBe("playing");
    moment.setOn(false);
    expect(recap.state.get()).toMatchObject({ on: false, status: "idle" });
    expect(paused).toEqual(["recap"]);
    // A voice made while the switch is on starts on.
    sound.set({ on: true });
    expect(new VoicePlayer(synth, silent, sound, () => {}).state.get().on).toBe(true);
  });

  it("stays on when a hero moment's breakdown opens from the match, and on its recap", async () => {
    const raw = matchExport();
    const fetch = fakeFetch({
      "GET /health": health,
      [`GET /api/matches/${MATCH}`]: () => json(matchInfo(raw)),
      [`GET /api/matches/${MATCH}/export`]: () => json(raw),
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
      "POST /api/breakdowns": (body) => json(matchBreakdown(body)),
      "POST /api/tts": () => new Response(new Blob(["RIFF"], { type: "audio/wav" })),
    });
    const session = createMatchSession(parseHero(structuredClone(raw)), {
      api: createApi(API, MATCH, fetch),
      dataUrl: "/data/",
      fetch,
      socket: fakeSockets(),
      makeAudio: silent,
    });
    session.recap.setSound(true); // the match's own Sound switch
    session.controls.openBreakdown(raw.moments.find((m) => m.id === MATCH_HERO)!);
    await settle();
    const opened = session.screen.get().hero!;
    expect(opened.voice.state.get().on).toBe(true);
    opened.controls.setSound(false);
    expect(session.recap.voice.state.get().on).toBe(false);
    expect(session.sound.get().on).toBe(false);

    // The match's live screen has the switch too, not only the recap panel.
    session.controls.backToMatch();
    const html = render(session, <SoundToggle icon />);
    expect(html).toContain('aria-label="Sound"');
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });
});

describe("the switch says what to do", () => {
  function online() {
    const fetch = fakeFetch({
      "POST /api/breakdowns": () => json(breakdownResponse()),
      "POST /api/tts": () => new Response(new Blob(["RIFF"], { type: "audio/wav" })),
    });
    return createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fetch),
      makeAudio: silent,
    });
  }

  it('reads "Tap for sound" until the sound has been on once', () => {
    const session = online();
    const off = render(session, <SoundToggle icon />);
    expect(off).toContain("Tap for sound"); // its name while it shows
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain("aria-label");
    session.controls.setSound(true);
    expect(render(session, <SoundToggle icon />)).not.toContain("Tap for sound");
    session.controls.setSound(false);
    const used = render(session, <SoundToggle icon />);
    expect(used).not.toContain("Tap for sound");
    expect(used).toContain('aria-label="Sound"');
  });

  it("names a failed line in the button, not only in its tooltip", async () => {
    const fetch = fakeFetch({
      "POST /api/breakdowns": () => json(breakdownResponse()),
      "POST /api/tts": () => new Response("busy", { status: 503 }),
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fetch),
      makeAudio: silent,
    });
    session.controls.requestBreakdown();
    await settle();
    session.controls.setSound(true);
    session.controls.openLine("L2");
    await settle();
    expect(session.voice.state.get().status).toBe("failed");
    expect(render(session, <SoundToggle icon />)).toContain("No voice");
  });

  it("is disabled offline, with no call to tap", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const html = render(session, <SoundToggle icon />);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain("Tap for sound");
  });
});
