// The live ingest stream (SPEC 2): frames are applied in order and written into the run the views
// draw, events and moments arrive after their frame, a seek drops what was in flight, and the
// viewer's transport maps to the stream's control messages.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, tickSession } from "../session";
import {
  API,
  breakdownResponse,
  card,
  eventMsg,
  exportJson,
  fakeFetch,
  fakeSockets,
  frameMsg,
  hello,
  HERO_MOMENT,
  json,
  momentMsg,
  settle,
} from "../testing";
import { followLive, LIVE_MAX_LAG, LiveFeed } from "./feed";

function connected() {
  const hero = parseHero(raw);
  const sockets = fakeSockets();
  const seen: string[] = [];
  const feed = new LiveFeed(hero, (start) => `wss://api.test/live?start=${start}`, sockets, {
    onMoment: (m) => seen.push(m.id),
  });
  feed.connect(0);
  const ws = sockets.sockets[0];
  ws.open();
  ws.push(hello());
  return { hero, feed, ws, seen, sockets };
}

describe("live stream", () => {
  it("applies frames in order and writes them into the run the views draw", () => {
    const { hero, feed, ws } = connected();
    expect(feed.state.get().status).toBe("streaming");
    const run = hero.runs.factual;
    // The stream's ball, not the export's: move it 1 m in x on frame 1.
    const ball = exportJson.runs.factual.ball[1];
    ws.push(frameMsg(0), frameMsg(1, { ball: [ball[0] + 1000, ball[1]], sprint: ["H9"] }));
    expect(feed.state.get().latest).toBe(1);
    expect(run.ball[2]).toBeCloseTo(ball[0] / 1000 + 1, 5);
    expect(feed.state.get().sprint).toEqual(["H9"]);
    // A frame that is not newer than the last one applied is dropped, with its events.
    ws.push(frameMsg(0, { ball: [0, 0] }), eventMsg(0));
    expect(run.ball[0]).toBeCloseTo(exportJson.runs.factual.ball[0][0] / 1000, 5);
    expect(feed.state.get().lastEvent).toBeNull();
    ws.push(frameMsg(2));
    expect(feed.state.get().latest).toBe(2);
  });

  it("announces moments in arrival order, once each, with their frame", () => {
    const { feed, ws, seen } = connected();
    ws.push(frameMsg(0), frameMsg(1), eventMsg(1));
    expect(feed.state.get().lastEvent?.frame).toBe(1);
    ws.push(frameMsg(2), momentMsg("m:line_breaking_pass:H4:0015", 2));
    ws.push(frameMsg(3), momentMsg("m:sprint:H9:0085", 3), momentMsg(HERO_MOMENT, 3));
    ws.push(frameMsg(4), momentMsg("m:sprint:H9:0085", 4)); // seen before: not again
    expect(seen).toEqual(["m:line_breaking_pass:H4:0015", "m:sprint:H9:0085", HERO_MOMENT]);
    expect(feed.state.get().moments.map((m) => m.id)).toEqual(seen);
  });

  it("drops frames in flight after a seek until the frame sought arrives", () => {
    const { hero, feed, ws, seen } = connected();
    ws.push(frameMsg(0), frameMsg(1), frameMsg(2));
    feed.seek(120.4);
    expect(ws.sent.at(-1)).toEqual({ type: "seek", f: 120 });
    expect(feed.state.get().latest).toBe(119); // holds until 120 arrives
    // Sent by the server before it saw the seek: dropped, with their events and moments.
    ws.push(frameMsg(3, { ball: [0, 0] }), eventMsg(3), momentMsg("m:stale:H1:0003", 3));
    expect(hero.runs.factual.ball[6]).not.toBe(0);
    expect(seen).toEqual([]);
    expect(feed.state.get().latest).toBe(119);
    ws.push(frameMsg(120), eventMsg(120), frameMsg(121));
    expect(feed.state.get().latest).toBe(121);
    expect(feed.state.get().lastEvent?.frame).toBe(120);
  });

  it("maps pause, resume, speed and stop to control messages, queued until open", () => {
    const hero = parseHero(raw);
    const sockets = fakeSockets();
    const feed = new LiveFeed(hero, (s) => `wss://x/live?start=${s}`, sockets);
    feed.connect(30);
    const ws = sockets.sockets[0];
    expect(ws.url).toBe("wss://x/live?start=30");
    feed.pause(); // before the socket is open: queued
    expect(ws.sent).toEqual([]);
    ws.open();
    ws.push(hello());
    feed.resume();
    feed.setSpeed(0.5);
    expect(ws.sent).toEqual([{ type: "pause" }, { type: "resume" }, { type: "speed", x: 0.5 }]);
    feed.stop();
    expect(ws.sent.at(-1)).toEqual({ type: "stop" });
    expect(ws.closed).toBe(true);
    expect(feed.state.get().status).toBe("off");
  });

  it("ends on `end`, and is lost if it closes before", () => {
    const a = connected();
    a.ws.push(frameMsg(0), { type: "end", f: 1 });
    a.ws.drop();
    expect(a.feed.state.get().status).toBe("ended");
    const b = connected();
    b.ws.push(frameMsg(0));
    b.ws.drop();
    expect(b.feed.state.get()).toMatchObject({ status: "lost", error: "the live stream closed" });
  });

  it("refuses a stream for another match", () => {
    const hero = parseHero(raw);
    const sockets = fakeSockets();
    const feed = new LiveFeed(hero, () => "wss://x", sockets);
    feed.connect();
    sockets.sockets[0].open();
    sockets.sockets[0].push({ ...hello(), frames: 999 });
    expect(feed.state.get()).toMatchObject({ status: "lost" });
    expect(feed.state.get().error).toMatch(/another match/);
  });
});

describe("live playhead", () => {
  const dt = 0.04;
  it("plays at the chosen speed but never past the last frame received", () => {
    expect(followLive(15, 20, dt, 1, 0.04)).toBeCloseTo(16);
    expect(followLive(15, 20, dt, 0.5, 0.04)).toBeCloseTo(15.5);
    expect(followLive(19.5, 20, dt, 1, 0.04)).toBe(20);
    expect(followLive(20, 20, dt, 1, 0.04)).toBe(20); // waiting for the next frame
  });
  it("catches up after a burst, and holds before the frame sought arrives", () => {
    expect(followLive(10, 10 + LIVE_MAX_LAG + 5, dt, 1, 0.04)).toBe(10 + LIVE_MAX_LAG + 4);
    expect(followLive(120, 119, dt, 1, 0.04)).toBe(120);
    expect(followLive(0, -1, dt, 1, 0.04)).toBe(0);
  });
});

describe("live mode in the session", () => {
  function online() {
    const hero = parseHero(raw);
    const sockets = fakeSockets();
    const fetch = fakeFetch({ "POST /api/breakdowns": () => json(breakdownResponse()) });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
      socket: sockets,
    });
    return { session, sockets, fetch };
  }

  it("follows the stream, and the transport sends control messages", () => {
    const { session, sockets } = online();
    const { controls, playback } = session;
    controls.goLive();
    const ws = sockets.sockets[0];
    expect(ws.url).toBe("wss://api.test/ws/matches/blind_side_run-3/live?start=0&speed=1");
    expect(playback.get()).toMatchObject({ live: true, mode: "factual", playing: true, frame: 0 });
    ws.open();
    ws.push(hello(), frameMsg(0), frameMsg(1), frameMsg(2));
    tickSession(session, 0.04);
    expect(playback.get().frame).toBeCloseTo(1);
    tickSession(session, 0.1);
    expect(playback.get().frame).toBe(2); // not past the stream
    controls.togglePlay();
    expect(ws.sent.at(-1)).toEqual({ type: "pause" });
    expect(playback.get().playing).toBe(false);
    controls.togglePlay();
    expect(ws.sent.at(-1)).toEqual({ type: "resume" });
    controls.seek(100);
    expect(ws.sent.at(-1)).toEqual({ type: "seek", f: 100 });
    expect(playback.get().frame).toBe(100);
    controls.setSpeed(0.5);
    expect(ws.sent.at(-1)).toEqual({ type: "speed", x: 0.5 });
  });

  it("leaves live mode for the run without the look, and when the stream ends", () => {
    const { session, sockets } = online();
    session.controls.goLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push(hello(), frameMsg(0));
    session.controls.setMode("counterfactual");
    expect(ws.sent.at(-1)).toEqual({ type: "stop" });
    expect(session.playback.get()).toMatchObject({ live: false, mode: "counterfactual" });

    session.controls.goLive(); // from where the stream was
    const again = sockets.sockets[1];
    expect(again.url).toContain("start=1");
    again.open();
    again.push(hello(), frameMsg(1), frameMsg(2), { type: "end", f: 3 });
    expect(session.playback.get()).toMatchObject({ live: false, playing: false, frame: 2 });
    session.controls.goLive(); // after the end: from the start
    expect(sockets.sockets[2].url).toContain("start=0");
  });

  it("asks for the breakdown when the stream detects the moment, then plays it", async () => {
    const { session, sockets, fetch } = online();
    session.controls.startLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push(hello(), frameMsg(0), momentMsg("m:line_breaking_pass:H4:0015", 0));
    await settle();
    expect(fetch.calls).toEqual([]); // not the hero moment
    expect(session.breakdown.get().status).toBe("waiting");
    const last = exportJson.runs.factual.frames - 1;
    ws.push(frameMsg(last), { type: "moment", card: card(HERO_MOMENT, last, 75) });
    ws.push({ type: "end", f: last + 1 });
    await settle();
    expect(fetch.calls.map((c) => [c.method, c.path])).toEqual([["POST", "/api/breakdowns"]]);
    expect(session.breakdown.get().status).toBe("ready");
    expect(session.runner.status.get().status).toBe("running");
    expect(session.playback.get().live).toBe(false);
  });
});
