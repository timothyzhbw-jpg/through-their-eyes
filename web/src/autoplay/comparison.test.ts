// The cold load's show (SPEC 2, 7): once the stream has detected the hero moment, the look is
// replayed, then the same seconds re-simulated without it, each with its verified line, and then
// the breakdown. Any viewer action ends the show.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, tickSession, type Session } from "../session";
import {
  API,
  breakdownResponse,
  fakeFetch,
  fakeSockets,
  frameMsg,
  hello,
  HERO_MOMENT,
  json,
  momentMsg,
  settle,
} from "../testing";
import { createPlayback } from "../store/playback";
import { Comparison, comparisonLines, comparisonWindow } from "./comparison";

const hero = parseHero(raw);
const DT = 1 / 30;

function online() {
  const sockets = fakeSockets();
  const fetch = fakeFetch({ "POST /api/breakdowns": () => json(breakdownResponse()) });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    socket: sockets,
  });
  return { session, sockets };
}

/** Tick the session until `done` or `max` seconds; the seconds it took. */
function tickUntil(session: Session, done: () => boolean, max = 30): number {
  let t = 0;
  while (!done() && t < max) {
    tickSession(session, DT);
    t += DT;
  }
  return t;
}

/** Live from frame 0, every frame of the run streamed and followed at 1×, then the hero moment
 * announced when its window closes (the run's last frame): the breakdown is asked for then. */
async function watchToTheMoment(session: Session, sockets: ReturnType<typeof fakeSockets>) {
  session.controls.startLive();
  const ws = sockets.sockets[0];
  ws.open();
  ws.push(hello());
  const last = hero.runs.factual.frames - 1;
  for (let f = 0; f <= last; f++) ws.push(frameMsg(f));
  const live = tickUntil(session, () => session.playback.get().frame >= last - 0.5);
  ws.push(momentMsg(HERO_MOMENT, last));
  await settle();
  return live;
}

describe("the with / without window", () => {
  it("opens just before the key scan and closes a little after the decision, in both runs", () => {
    const w = comparisonWindow(hero, 75);
    expect(w.from).toBe(hero.keyScan!.start - 6);
    expect(w.to).toBe(75 + 30);
    expect(w.to).toBeLessThan(hero.runs.counterfactual.frames);
  });
});

describe("the lines it shows", () => {
  it("the look's line, then the counterfactual line that says what he would have done", async () => {
    const { session } = online();
    session.controls.requestBreakdown();
    await settle();
    const { narration } = session.breakdown.get();
    expect(comparisonLines(narration)).toEqual({ withLook: "L1", withoutLook: "L3" });
    // The bundled example: its pass line, not the first counterfactual line it meets.
    const offline = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const lines = comparisonLines(offline.breakdown.get().narration);
    expect(lines.withoutLook).toBe("L5");
    expect(comparisonLines(null)).toEqual({ withLook: null, withoutLook: null });
  });
});

describe("after the moment is detected", () => {
  it("replays the look, then the run without it with its line, then plays the breakdown", async () => {
    const { session, sockets } = online();
    await watchToTheMoment(session, sockets);
    const w = comparisonWindow(hero, session.moment.decisionFrame);
    expect(session.comparison.status.get().phase).toBe("with");
    tickSession(session, DT); // the breakdown is here: its line goes up
    expect(session.playback.get()).toMatchObject({
      live: false,
      mode: "factual",
      playing: true,
      playUntil: w.to,
      captionLine: "L1",
    });
    expect(session.runner.status.get().status).not.toBe("running");

    const toWithout = tickUntil(session, () => session.comparison.status.get().phase === "without");
    expect(toWithout, "the counterfactual is on screen within 5 s of the moment").toBeLessThan(5);
    expect(session.playback.get()).toMatchObject({
      mode: "counterfactual",
      playing: true,
      cfGhost: true,
      focus: "split",
      captionLine: "L3",
    });
    expect(session.playback.get().frame).toBeLessThan(w.from + 2);

    const toBreakdown = tickUntil(session, () => session.runner.status.get().status === "running");
    expect(toBreakdown).toBeLessThan(6);
    expect(session.comparison.status.get().phase).toBe("done");
  });

  it("starts at the moment even before the breakdown arrives, and shows its lines once it does", async () => {
    const sockets = fakeSockets();
    let release = () => {};
    const fetch = fakeFetch({
      "POST /api/breakdowns": () =>
        new Promise((done) => (release = () => done(json(breakdownResponse())))),
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fetch),
      socket: sockets,
    });
    await watchToTheMoment(session, sockets);
    expect(session.comparison.status.get().phase).toBe("with");
    expect(session.playback.get()).toMatchObject({ live: false, mode: "factual", playing: true });
    expect(session.playback.get().captionLine).toBeNull();
    release();
    await settle();
    tickSession(session, DT);
    expect(session.playback.get().captionLine).toBe("L1");
    tickUntil(session, () => session.comparison.status.get().phase === "without");
    expect(session.playback.get().captionLine).toBe("L3");
    tickUntil(session, () => session.runner.status.get().status === "running");
    expect(session.runner.status.get().status).toBe("running");
  });

  it("plays the breakdown when it arrives if the show ended first", async () => {
    const sockets = fakeSockets();
    let release = () => {};
    const fetch = fakeFetch({
      "POST /api/breakdowns": () =>
        new Promise((done) => (release = () => done(json(breakdownResponse())))),
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fetch),
      socket: sockets,
    });
    await watchToTheMoment(session, sockets);
    tickUntil(session, () => session.comparison.status.get().phase === "done");
    expect(session.runner.status.get().status).not.toBe("running");
    release();
    await settle();
    expect(session.runner.status.get().status).toBe("running");
  });

  it("stops at the viewer's first action, and the breakdown does not start by itself", async () => {
    const { session, sockets } = online();
    await watchToTheMoment(session, sockets);
    expect(session.comparison.status.get().phase).toBe("with");
    session.controls.togglePlay(); // pause
    expect(session.comparison.status.get().phase).toBe("stopped");
    tickUntil(session, () => false, 10);
    expect(session.playback.get().mode).toBe("factual");
    expect(session.runner.status.get().status).not.toBe("running");
  });

  it("plays nothing for a moment with no re-simulated run: the breakdown goes first", () => {
    const playback = createPlayback(hero);
    const before = playback.get();
    const show = new Comparison(playback, { ...hero, counterfactual: null }, 75);
    let then = 0;
    expect(
      show.start(
        () => null,
        () => (then += 1),
      ),
    ).toBe(false);
    expect(playback.get()).toBe(before);
    expect(show.status.get().phase).toBe("idle");
    expect(then).toBe(0);
  });

  it("a viewer who asked for the breakdown gets it, not the show", async () => {
    const { session } = online();
    session.controls.playBreakdown();
    await settle();
    expect(session.runner.status.get().status).toBe("running");
    expect(session.comparison.status.get().phase).toBe("idle");
  });
});

describe("offline, after the lineup card", () => {
  it("the bundled breakdown's show plays at once: the look, then the run without it", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    session.controls.autoplay();
    expect(session.comparison.status.get().phase).toBe("with");
    const t = tickUntil(session, () => session.comparison.status.get().phase === "without");
    expect(t).toBeLessThan(5);
    expect(session.playback.get().captionLine).toBe("L5");
  });
});
