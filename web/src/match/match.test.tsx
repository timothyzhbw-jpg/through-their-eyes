// The stitched match in the viewer (SPEC 2, 3.1, 7): `?match=match-1` loads it from the service,
// the live view plays the whole match clock with the possession, restart and score on screen and
// possession boundaries on the timeline, the Moments panel lists every moment with its lens, and
// either hero moment opens its breakdown, played on the possession's own run (local frames) and
// shown on the match clock (local frame + the possession's start).

import { describe, expect, it } from "vitest";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { HERO_FILE, loadData, matchFromUrl, PAYLOAD_FILE, WHAT_IF_FILE } from "../data/load";
import { tickSession } from "../session";
import {
  API,
  BLIND_START,
  exportJson,
  fakeFetch,
  fakeSockets,
  GOAL_FRAME,
  health,
  HERO_MOMENT,
  json,
  MATCH,
  MATCH_HERO,
  MATCH_PRESS,
  matchBreakdown,
  matchExport,
  matchFrameMsg,
  matchHello,
  matchInfo,
  OPEN_FRAMES,
  PRESS_MOMENT,
  PRESS_START,
  pressureExport,
  render,
  settle,
  type Route,
  verifyResponse,
} from "../testing";
import { MomentsPanel } from "../ui/Live";
import { numbered, Transport } from "../ui/Transport";
import { possessionAt, scoreAt } from "./match";
import { createMatchSession, type MatchSessionOptions } from "./matchSession";
import { Scoreboard } from "../ui/Match";

const raw = matchExport();

const bundled: Record<string, Route> = {
  [`GET /data/${HERO_FILE}`]: () => json(exportJson),
  [`GET /data/${PAYLOAD_FILE}`]: () => json(payloadJson),
  [`GET /data/${WHAT_IF_FILE}`]: () => json(whatIfJson),
};
const service: Record<string, Route> = {
  "GET /health": health,
  [`GET /api/matches/${MATCH}`]: () => json(matchInfo(raw)),
  [`GET /api/matches/${MATCH}/export`]: () => json(raw),
  "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
  "GET /api/matches/press_escape-0/export": () => json(pressureExport()),
  "POST /api/breakdowns": (body) => json(matchBreakdown(body)),
};

function online(routes: Record<string, Route> = {}, options: Partial<MatchSessionOptions> = {}) {
  const fetch = fakeFetch({ ...bundled, ...service, ...routes });
  const sockets = fakeSockets();
  const hero = parseHero(structuredClone(raw));
  const session = createMatchSession(hero, {
    api: createApi(API, MATCH, fetch),
    dataUrl: "/data/",
    fetch,
    socket: sockets,
    ...options,
  });
  return { session, hero, fetch, sockets };
}

const card = (id: string) => raw.moments.find((m) => m.id === id)!;

/** Run the open hero breakdown to its end on the session clock. */
function playToEnd(session: ReturnType<typeof online>["session"]) {
  const hero = session.screen.get().hero!;
  const marks = new Set<string | null>();
  for (let k = 0; k < 2000 && hero.runner.status.get().status === "running"; k++) {
    tickSession(hero, 1 / 30);
    marks.add(hero.playback.get().scanMarker);
  }
  return { hero, marks };
}

describe("the stitched match export", () => {
  const hero = parseHero(structuredClone(raw));
  const match = hero.match!;

  it("is one run on the match clock, with its possessions and moments, and nothing to compare", () => {
    expect(hero.kind).toBe("match");
    expect(hero.heroId).toBeNull();
    expect(hero.keyScan).toBeNull();
    expect(hero.counterfactual).toBeNull();
    expect(hero.runs.factual.frames).toBe(raw.runs.factual.frames);
    // No counterfactual run: both run names show the stitched run.
    expect(hero.runs.counterfactual).toBe(hero.runs.factual);
    expect(hero.runs.factual.sight).toBe(false);
    expect(match.possessions.map((p) => [p.start, p.restart])).toEqual([
      [0, "kick_off"],
      [BLIND_START, "throw_in"],
      [PRESS_START, "cut"],
    ]);
    expect(match.moments.filter((m) => m.hero).map((m) => m.id)).toEqual([MATCH_HERO, MATCH_PRESS]);
  });

  it("finds the possession and the score at any frame", () => {
    expect(possessionAt(match, 0).index).toBe(0);
    expect(possessionAt(match, OPEN_FRAMES - 0.5).index).toBe(0);
    expect(possessionAt(match, OPEN_FRAMES).index).toBe(1);
    expect(possessionAt(match, PRESS_START - 1).index).toBe(1);
    expect(possessionAt(match, PRESS_START).index).toBe(2);
    expect(possessionAt(match, 1e6).index).toBe(2);
    expect(scoreAt(hero, GOAL_FRAME - 1)).toEqual({ home: 0, away: 0 });
    expect(scoreAt(hero, GOAL_FRAME)).toEqual({ home: 1, away: 0 });
    expect(scoreAt(hero, PRESS_START + 10)).toEqual({ home: 1, away: 0 });
  });
});

describe("picking the match", () => {
  it("reads ?match= and keeps the blind-side hero the default", () => {
    expect(matchFromUrl("")).toBe("blind_side_run-3");
    expect(matchFromUrl("?match=match-1&autoplay=0")).toBe("match-1");
    expect(matchFromUrl("?match=")).toBe("blind_side_run-3");
    expect(matchFromUrl("?match=../../etc")).toBe("blind_side_run-3");
  });

  it("loads the stitched match from the service", async () => {
    const fetch = fakeFetch({ ...bundled, ...service });
    const data = await loadData({ apiBase: API, dataUrl: "/data/", fetch, match: MATCH });
    expect(data.offline).toBeNull();
    expect(data.api?.match).toBe(MATCH);
    expect(data.hero.kind).toBe("match");
    expect(fetch.calls.map((c) => c.path)).toContain(`/api/matches/${MATCH}/export`);
  });

  it("plays the bundled hero moment offline, and says the match needs the live service", async () => {
    const fetch = fakeFetch(bundled);
    const data = await loadData({ apiBase: null, dataUrl: "/data/", fetch, match: MATCH });
    expect(data.api).toBeNull();
    expect(data.hero.kind).toBe("hero");
    expect(data.offline).toMatch(/match-1 needs the live service/);
  });
});

describe("the live match", () => {
  it("streams the whole match clock and announces moments of every possession", () => {
    const { session, sockets } = online();
    session.controls.startLive();
    const ws = sockets.sockets[0];
    expect(ws.url).toBe("wss://api.test/ws/matches/match-1/live?start=0&speed=1");
    ws.open();
    ws.push(matchHello(raw));
    expect(session.feed!.state.get().status).toBe("streaming");
    const last = raw.runs.factual.frames - 1;
    ws.push(matchFrameMsg(raw, 0), { type: "moment", card: card(MATCH_HERO) });
    ws.push(matchFrameMsg(raw, last)); // the last frame of the last possession is in range
    expect(session.feed!.state.get().latest).toBe(last);
    const moment = session.feed!.state.get().moments[0];
    expect(moment).toMatchObject({ id: MATCH_HERO, possession: 1, hero: true, start: BLIND_START });
  });

  it("refuses a stream for another match", () => {
    const { session, sockets } = online();
    session.controls.startLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push({ ...matchHello(raw), frames: 12 });
    expect(session.feed!.state.get().status).toBe("lost");
  });

  it("shows the possession, its restart and the score as the playhead moves", () => {
    const { session } = online();
    session.playback.set({ frame: BLIND_START + 10 });
    let html = render(session, <Scoreboard />);
    expect(html).toContain("Possession 2 of 3");
    expect(html).toContain("Throw-in");
    expect(html).toContain("The blind-side run");
    expect(html).toMatch(/Home.*0.*–.*0.*Away/s);
    session.playback.set({ frame: PRESS_START + 5 });
    html = render(session, <Scoreboard />);
    expect(html).toContain("Possession 3 of 3");
    expect(html).toContain("Escaping the press");
    expect(html).toMatch(/Home.*1.*–.*0.*Away/s);
  });

  it("marks possession boundaries and hero moments on the timeline, on the match clock", () => {
    const { session } = online();
    session.playback.set({ frame: PRESS_START });
    const html = render(session, <Transport />);
    // Server rendering has no layout: the timeline's svg needs a width, so check its data.
    expect(html).toContain(`data-possessions="${OPEN_FRAMES},${PRESS_START}"`);
    expect(html).toContain(`data-heroes="${OPEN_FRAMES + 75},${PRESS_START + 75}"`);
    expect(html).toContain(`${(PRESS_START * raw.dt).toFixed(2)} s`);
    expect(html).not.toContain("Key scan");
  });

  it("numbers only the possessions whose number fits on the timeline", () => {
    // match-1 has 20 possessions on a few hundred pixels on a phone; a hero lasts about 6 s.
    expect(numbered([6, 10, 30, 40, 46, 70])).toEqual([true, false, true, false, true, true]);
    expect(numbered([6, 22, 38], 16)).toEqual([true, true, true]);
    expect(numbered([])).toEqual([]);
  });

  it("lists every moment with its lens; the two hero moments open breakdowns", () => {
    const { session } = online();
    const html = render(session, <MomentsPanel />);
    for (const m of raw.moments) expect(html).toContain(`${m.anchor_t.toFixed(2)} s`);
    expect(html).toContain("scan lens");
    expect(html).toContain("pressure lens");
    expect(html).toContain("live only");
    expect(html.match(/>Breakdown</g)).toHaveLength(2);
    expect(html).toContain("Possession 2");
  });

  it.each([
    [0, "No hero moments are available for breakdowns; every moment replays only."],
    [1, "The 1 hero moment opens its breakdown"],
    [3, "The 3 hero moments open their breakdowns"],
  ] as const)("describes the %i hero moments actually available", (count, copy) => {
    const { session } = online();
    session.match.moments = session.match.moments.map((m, index) => ({
      ...m,
      hero: index < count,
    }));
    const html = render(session, <MomentsPanel />);
    expect(html).toContain(copy);
    expect(html.match(/>Breakdown</g) ?? []).toHaveLength(count);
  });

  it("says in words, not only by a dimmer colour, which moments the stream has not reached", () => {
    const { session, sockets } = online();
    session.controls.startLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push(matchHello(raw), matchFrameMsg(raw, 0), { type: "moment", card: card(MATCH_HERO) });
    const html = render(session, <MomentsPanel />);
    const rows = html.match(/<li[^>]*>.*?<\/li>/gs)!;
    const ahead = rows.filter((r) => /^<li class="[^"]*\bahead\b/.test(r));
    expect(ahead).toHaveLength(raw.moments.length - 1);
    for (const r of ahead)
      expect(r).toContain('<span class="sr-only"> · not on the stream yet</span>');
    expect(rows.filter((r) => r.includes("not on the stream yet"))).toHaveLength(ahead.length);
  });
});

describe("hero breakdowns inside the match", () => {
  it("opens the scan hero's breakdown on its possession, in local frames", async () => {
    const { session, fetch } = online();
    session.controls.openBreakdown(card(MATCH_HERO));
    await settle();
    const hero = session.screen.get().hero!;
    expect(hero).not.toBeNull();
    expect(fetch.calls.map((c) => c.path)).toContain("/api/matches/blind_side_run-3/export");
    const post = fetch.calls.find((c) => c.path === "/api/breakdowns")!;
    expect(post.body).toMatchObject({ match: MATCH, moment: MATCH_HERO });
    expect(hero.moment.id).toBe(HERO_MOMENT);
    expect(hero.possession).toMatchObject({ index: 1, start: BLIND_START, moment: MATCH_HERO });
    const b = hero.breakdown.get();
    expect(b.status).toBe("ready");
    expect(b.error).toBeNull();
    expect(b.narration?.lines.map((l) => l.id)).toEqual(["L1", "L2", "L3"]);
    expect(hero.runner.status.get().status).toBe("running");
    // The hero session's clock reads match time.
    hero.runner.stop();
    hero.playback.set({ frame: 75 });
    expect(render(hero, <Transport />)).toContain(`${((BLIND_START + 75) * raw.dt).toFixed(2)} s`);
  });

  it("plays the pressure hero: no scan marker, the forced carry as the ghost", async () => {
    const { session, fetch } = online();
    session.controls.openBreakdown(card(MATCH_PRESS));
    await settle();
    expect(fetch.calls.map((c) => c.path)).toContain("/api/matches/press_escape-0/export");
    const post = fetch.calls.find((c) => c.path === "/api/breakdowns")!;
    expect(post.body).toMatchObject({ match: MATCH, moment: MATCH_PRESS });
    const { hero, marks } = playToEnd(session);
    expect(hero.moment.id).toBe(PRESS_MOMENT);
    expect(hero.hero.keyScan).toBeNull();
    expect(hero.hero.counterfactual).toMatchObject({
      intervention: "force_action",
      action: "carry",
    });
    expect(hero.breakdown.get().resolved).toMatchObject({ source: "given", errors: [] });
    expect([...marks]).toEqual([null]);
    expect(hero.runner.status.get().status).toBe("done");
    expect(hero.playback.get().cfGhost).toBe(true);
    expect(hero.hero.runs.counterfactual.decision?.chosen).toBe("carry");
  });

  it("checks a wrong number against the possession's own hero moment", async () => {
    const { session, fetch } = online({
      "POST /api/verify": (body) => json(verifyResponse((body as { value: number }).value)),
    });
    session.controls.openBreakdown(card(MATCH_PRESS));
    await settle();
    const hero = session.screen.get().hero!;
    hero.runner.stop();
    await hero.controls.tryValue("cf_value", "dxt", 0.5);
    const post = fetch.calls.find((c) => c.path === "/api/verify")!;
    expect(post.body).toMatchObject({ match: MATCH, moment: MATCH_PRESS, claim: "cf_value" });
  });

  it("refuses a breakdown placed in another possession than the moment's", async () => {
    const { session } = online({
      "POST /api/breakdowns": (body) => json(matchBreakdown(body, { 1: BLIND_START + 1 })),
    });
    session.controls.openBreakdown(card(MATCH_HERO));
    await settle();
    const b = session.screen.get().hero!.breakdown.get();
    expect(b.status).toBe("failed");
    expect(b.error).toMatch(/possession/);
  });

  it("goes back to the match where the breakdown left off, mapping local frames with start", async () => {
    const { session } = online();
    session.controls.startLive();
    session.controls.openBreakdown(card(MATCH_HERO));
    await settle();
    expect(session.playback.get().live).toBe(false); // opening a breakdown leaves the stream
    const hero = session.screen.get().hero!;
    hero.controls.seek(80);
    session.controls.backToMatch();
    expect(session.screen.get().hero).toBeNull();
    expect(session.playback.get()).toMatchObject({ frame: BLIND_START + 80, playing: false });
    // Opening it again reuses the loaded hero (no second export or breakdown request).
    session.controls.openBreakdown(card(MATCH_HERO));
    await settle();
    expect(session.screen.get().hero).toBe(hero);
  });

  it("uses the bundled export for the scan hero when the service does not serve it", async () => {
    const { session, fetch } = online({
      "GET /api/matches/blind_side_run-3/export": () => json({ detail: "unknown" }, 404),
    });
    session.controls.openBreakdown(card(MATCH_HERO));
    await settle();
    expect(session.screen.get().hero?.moment.id).toBe(HERO_MOMENT);
    expect(fetch.calls.map((c) => c.path)).toContain(`/data/${HERO_FILE}`);
  });

  it("says why when a hero's export cannot be loaded, and stays on the match", async () => {
    const { session } = online({
      "GET /api/matches/press_escape-0/export": () => json({ detail: "unknown" }, 404),
    });
    session.controls.openBreakdown(card(MATCH_PRESS));
    await settle();
    expect(session.screen.get()).toMatchObject({ hero: null, opening: null });
    expect(session.screen.get().error).toMatch(/press_escape-0.*HTTP 404/);
  });
});
