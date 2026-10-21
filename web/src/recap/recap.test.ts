// The end-of-match recap in the viewer (SPEC 6, 7): asked for at full time on the live stream,
// checked against the match before anything shows, and its reel played on the match's own
// playback by the script's cue sheet, with the camera director cutting inside each clip.

import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { parseDeepLink } from "../deeplink";
import { directorPrefs } from "../director/director";
import { createMatchSession } from "../match/matchSession";
import { tickSession } from "../session";
import {
  API,
  fakeFetch,
  fakeSockets,
  json,
  MATCH,
  matchExport,
  matchFrameMsg,
  matchHello,
  settle,
  type Route,
} from "../testing";
import { recapFixture } from "./fixture";
import { recapErrors } from "./recap";

const raw = matchExport();
type Body = { personas: string[]; languages: string[] };

function online(routes: Record<string, Route> = {}) {
  const fetch = fakeFetch({
    "POST /api/recaps": (body) => {
      const { personas, languages } = body as Body;
      return json(recapFixture(raw, personas[0], languages[0] as "en" | "zh"));
    },
    "POST /api/tts": () => new Response(new Blob(["RIFF"]), { status: 200 }),
    ...routes,
  });
  const sockets = fakeSockets();
  const hero = parseHero(structuredClone(raw));
  const played: string[] = [];
  const session = createMatchSession(hero, {
    api: createApi(API, MATCH, fetch),
    dataUrl: "/data/",
    fetch,
    socket: sockets,
    makeAudio: () => ({
      play: async () => void played.push("clip"),
      pause: () => {},
      onended: null,
    }),
  });
  return { session, hero, fetch, sockets, played };
}

const posts = (fetch: ReturnType<typeof fakeFetch>) =>
  fetch.calls.filter((c) => c.method === "POST" && c.path === "/api/recaps");

afterEach(() => directorPrefs.set({ auto: false }));

describe("checking a recap against the match", () => {
  const hero = parseHero(structuredClone(raw));
  const fixture = () => recapFixture(raw);

  it("accepts the service's recap", () => {
    expect(recapErrors(fixture(), hero)).toEqual([]);
  });

  it("refuses a caption that is not a verified line", () => {
    const r = fixture();
    const caption = r.result.scripts[0].cues.cues.find((c) => c.type === "caption")!;
    Object.assign(caption, { text: "Home dominated with 7 shots." });
    expect(recapErrors(r, hero)).toEqual([
      expect.stringContaining("its text is not a verified line"),
    ]);
  });

  it("refuses evidence that is not in the match, a claim not supported, a clip off the clock", () => {
    const r = fixture();
    const card = r.result.scripts[0].card;
    Object.assign(card.claims[1], { evidence: ["scan:H8:9999"] });
    Object.assign(card.claims[2], { verdict: "refuted" });
    const clip = r.result.scripts[0].cues.cues.find((c) => c.type === "clip")!;
    Object.assign(clip.data, { match_frame_out: raw.runs.factual.frames + 10 });
    const errors = recapErrors(r, hero);
    expect(errors.some((e) => e.includes("evidence scan:H8:9999 is not in the match"))).toBe(true);
    expect(errors.some((e) => e.includes("k3.bypassed is refuted"))).toBe(true);
    expect(errors.some((e) => e.includes("the clip is outside the match"))).toBe(true);
  });

  it("refuses a response of another shape", () => {
    expect(recapErrors({ key: "x" }, hero)[0]).toMatch(/^cached: /);
  });
});

describe("asking for the recap", () => {
  it("asks once at full time on the live stream, for the audience on screen", async () => {
    const { session, sockets, fetch } = online();
    session.controls.startLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push(matchHello(raw));
    const last = raw.runs.factual.frames - 1;
    ws.push(matchFrameMsg(raw, last), { type: "end", f: last + 1, full_time: true });
    await settle();
    expect(posts(fetch)).toHaveLength(1);
    expect(posts(fetch)[0].body).toEqual({ match: MATCH, personas: ["casual"], languages: ["en"] });
    const state = session.recap.state.get();
    expect(state).toMatchObject({ status: "ready", fullTime: true });
    expect(session.recap.script()!.card.lines[0].text).toBe("Full time: Home 1, Away 0.");
    session.recap.fullTime(); // a second whistle asks nothing more
    await settle();
    expect(posts(fetch)).toHaveLength(1);
  });

  it("does not call it full time when the stream ends before the last frame", async () => {
    const { session, sockets, fetch } = online();
    session.controls.startLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push(matchHello(raw), matchFrameMsg(raw, 10), { type: "end", f: 11, full_time: false });
    await settle();
    expect(posts(fetch)).toHaveLength(0);
    expect(session.recap.state.get().fullTime).toBe(false);
  });

  it("asks again for another persona or language", async () => {
    const { session, fetch } = online();
    await session.recap.request({ language: "zh" });
    expect(session.recap.script()!.card.lines[0].text).toBe("全场结束：主队1比0客队。");
    await session.recap.request({ persona: "analyst" });
    expect(posts(fetch).map((c) => c.body)).toEqual([
      { match: MATCH, personas: ["casual"], languages: ["zh"] },
      { match: MATCH, personas: ["analyst"], languages: ["zh"] },
    ]);
    expect(session.recap.cuesUrl()).toBe(
      `${API}/api/recaps/${"a".repeat(32)}/cues?persona=analyst&language=zh`,
    );
  });

  it("opens as at full time for a deep link's audience", async () => {
    const { session, fetch } = online();
    session.recap.openAtFullTime("analyst", "zh");
    await settle();
    expect(posts(fetch)[0].body).toEqual({
      match: MATCH,
      personas: ["analyst"],
      languages: ["zh"],
    });
    expect(session.recap.state.get()).toMatchObject({ status: "ready", fullTime: true });
    expect(parseDeepLink("?match=match-1&play=recap&persona=analyst")).toMatchObject({
      play: "recap",
      persona: "analyst",
      autoplay: false,
      intro: false,
    });
  });

  it("turns the voice on for audio description, and off again when the audience changes", async () => {
    const { session } = online();
    const on = () => session.recap.voice.state.get().on;
    await session.recap.request({ persona: "audio_description" });
    expect(on()).toBe(true);
    await session.recap.request({ persona: "casual" });
    expect(on()).toBe(false);
    session.recap.setSound(true); // the viewer's own choice stays
    await session.recap.request({ persona: "analyst" });
    expect(on()).toBe(true);
  });

  it("says why when the service refuses", async () => {
    const detail = "rate_limited: try again in a few minutes";
    const { session } = online({ "POST /api/recaps": () => json({ detail }, 429) });
    await session.recap.request();
    expect(session.recap.state.get()).toMatchObject({ status: "failed", error: detail });
  });

  it("shows nothing that does not fit the match", async () => {
    const bad = recapFixture(raw);
    Object.assign(bad.result.scripts[0].card.claims[1], { evidence: ["pass:A1:0001"] });
    const { session } = online({ "POST /api/recaps": () => json(bad) });
    await session.recap.request();
    const state = session.recap.state.get();
    expect(state.status).toBe("failed");
    expect(state.response).toBeNull();
    expect(state.error).toContain("does not fit this match");
  });
});

describe("the reel", () => {
  async function ready() {
    const o = online();
    await o.session.recap.request();
    return o;
  }

  it("watches one key moment: seeks to its clip and plays it", async () => {
    const { session } = await ready();
    const clip = session.recap.state.get().response!.result.reel.clips[1];
    session.recap.watch(clip.moment);
    expect(session.playback.get()).toMatchObject({
      live: false,
      frame: clip.frame_in,
      playUntil: clip.frame_out,
      playing: true,
    });
  });

  it("plays the clips in order on the match clock, by the cue sheet", async () => {
    const { session } = await ready();
    const clips = session.recap.state.get().response!.result.reel.clips;
    session.recap.playReel();
    expect(directorPrefs.get().auto).toBe(true); // the camera director cuts inside the clips
    let reel = session.recap.state.get().reel!;
    expect(reel).toMatchObject({ intro: true, clip: null, caption: null });
    expect(session.playback.get()).toMatchObject({ frame: clips[0].frame_in, playing: false });
    session.recap.tick(0.5); // the result, over the first clip's opening frame
    expect(session.recap.state.get().reel).toMatchObject({ intro: true, caption: "L1" });
    session.recap.tick(1.6); // the first clip
    reel = session.recap.state.get().reel!;
    expect(reel).toMatchObject({ intro: false, clip: clips[0].moment });
    expect(reel.title!.text).toContain("he saw H9");
    expect(session.playback.get()).toMatchObject({
      frame: clips[0].frame_in,
      playUntil: clips[0].frame_out,
      playing: true,
      focus: "broadcast",
    });
    session.recap.tick(2); // the second clip opens on the tactical board
    expect(session.recap.state.get().reel!.clip).toBe(clips[1].moment);
    expect(session.playback.get()).toMatchObject({ frame: clips[1].frame_in, focus: "tactical" });
    session.recap.tick(4); // the outro: the stats, the last frame held
    reel = session.recap.state.get().reel!;
    expect(reel.clip).toBeNull();
    expect(reel.stats.map((c) => c.text)).toEqual(["Home completed 30 of 34 passes."]);
    expect(session.playback.get().playing).toBe(false);
    session.recap.tick(2); // past the end: the reel is over, the viewer's settings are back
    expect(session.recap.state.get().reel).toBeNull();
    expect(directorPrefs.get().auto).toBe(false);
    expect(session.playback.get().autoSlow).toBe(true);
  });

  it("runs on the session clock, and stops when the viewer takes the controls", async () => {
    const { session } = await ready();
    session.recap.playReel();
    tickSession(session, 0.5);
    expect(session.recap.state.get().reel!.t).toBeCloseTo(0.5);
    session.controls.seek(10);
    expect(session.recap.state.get().reel).toBeNull();
  });

  it("speaks each caption's line when the sound is on", async () => {
    const { session, fetch, played } = await ready();
    session.recap.voice.setOn(true);
    session.recap.playReel();
    session.recap.tick(0.5); // the result
    await settle();
    session.recap.tick(2); // the first clip's caption
    await settle();
    const keys = fetch.calls.filter((c) => c.path === "/api/tts").map((c) => c.body);
    const voice = session.recap.script()!.voice;
    expect(keys).toEqual([
      { key: voice.find((v) => v.line === "L1")!.cache_key },
      { key: voice.find((v) => v.line === "L3")!.cache_key },
    ]);
    expect(played.length).toBeGreaterThan(0);
  });
});
