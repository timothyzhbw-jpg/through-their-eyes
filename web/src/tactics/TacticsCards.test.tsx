// The tactics cards on screen (SPEC 4.8, 7): in the analyst's stats panel and in the recap, for a
// hero moment and a stitched match; measured numbers carry the "tracking" chip, the sim's
// recorded options the "sim" chip, each sentence its claim kind and a verified stamp; a match's
// stats panel keeps them folded until full time; offline and inside a match's hero, nothing.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { createApi, type Fetch, type Persona } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { createSession, type ViewSession } from "../session";
import { API, fakeFetch, fakeSockets, json, matchExport, render, settle } from "../testing";
import { StatsPanel } from "../ui/StatsPanel";
import fixture from "./fixture.json";
import { tacticsStore } from "./store";
import { parseTactics } from "./tactics";
import { TacticsCards } from "./TacticsCards";

function ready<T extends ViewSession>(session: T): T {
  tacticsStore(session).set({ status: "ready", tactics: parseTactics(fixture), error: null });
  return session;
}

function hero(persona: Persona = "analyst") {
  const session = createSession(parseHero(raw), null, null);
  session.breakdown.set({ persona });
  return ready(session);
}

function match() {
  const fetch = fakeFetch({});
  const session = createMatchSession(parseHero(structuredClone(matchExport())), {
    api: createApi(API, "match-1", fetch),
    dataUrl: "/data/",
    fetch,
    socket: fakeSockets(),
  });
  return ready(session);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the tactics cards", () => {
  it("shows both cards in a hero moment, each with its verified sentence", () => {
    const html = render(hero(), <TacticsCards where="stats" />);
    expect(html).toContain('data-card="build_up"');
    expect(html).toContain('data-card="set_pieces"');
    expect(html).toContain("Why build from the back?");
    expect(html).toContain("Why focus on set pieces?");
    expect(html).toContain("Building short under pressure, Kestrel Bay kept the ball on");
    expect(html).toContain("M. Quillan got the ball");
    expect(count(html, ">verified<")).toBe(2);
    expect(html).toContain("kind-computed");
    expect(html).not.toContain("<details");
  });

  it("labels measured numbers as tracking and the sim's recorded options as sim", () => {
    const html = render(hero(), <TacticsCards where="stats" />);
    expect(count(html, ">tracking<")).toBe(2);
    expect(html).toContain(">sim<");
    const alt = fixture.cards.build_up.alternatives[0];
    expect(html).toContain(`data-decision="${alt.id}"`);
    expect(html).toContain(`${alt.chosen.to}, ${Math.round(alt.chosen.length_m!)} m`);
    expect(html).toContain("Short under pressure");
    const team = fixture.cards.build_up.teams[0].pressed_short;
    expect(html).toContain(`${team.completed}/${team.passes}`);
  });

  it("is honest about what the sim cannot show yet", () => {
    const html = render(hero(), <TacticsCards where="stats" />);
    expect(html).toContain("by construction");
    expect(html).toContain("favours the corner");
    expect(html).toContain("Tackles are not modelled yet");
  });

  it("says what is simulated and who decides, without calling the passes scripted", () => {
    const html = render(match(), <TacticsCards where="stats" />);
    expect(html).toContain("whether the ball arrives");
    expect(html).toContain("the decision model chooses on what the player believed");
    expect(html).toContain("a passing rule does");
    expect(html).not.toContain("scripted");
  });

  it("speaks the recap's language", () => {
    const html = render(match(), <TacticsCards where="recap" language="zh" />);
    expect(html).toContain('lang="zh"');
    expect(html).toContain("在压力下短传出球");
    expect(html).toContain("Why build from the back?"); // the interface stays in English
  });

  it("stays folded in a match's stats panel until full time", () => {
    const session = match();
    const live = render(session, <TacticsCards where="stats" />);
    expect(live).toContain("<details");
    expect(live).toContain("including what is still to come");
    session.playback.set({ frame: session.hero.runs.factual.frames - 1 });
    const full = render(session, <TacticsCards where="stats" />);
    expect(full).not.toContain("<details");
    expect(full).toContain("Tactics at full time");
  });

  it("is shown in the recap whatever the playhead", () => {
    expect(render(match(), <TacticsCards where="recap" />)).not.toContain("<details");
  });

  it("is in the analyst's stats panel only", () => {
    expect(render(hero("analyst"), <StatsPanel />)).toContain('data-card="build_up"');
    expect(render(hero("casual"), <StatsPanel />)).not.toContain('data-card="build_up"');
  });

  it("draws nothing offline or in a hero moment opened from a match", () => {
    const offline = createSession(parseHero(raw), null, null);
    expect(render(offline, <TacticsCards where="stats" />)).toBe("");
    const inside = ready(
      createSession(parseHero(raw), null, null, null, {
        api: createApi(API, "match-1", fakeFetch({})),
        possession: { index: 1, start: 750, moment: "m:x" },
      }),
    );
    expect(render(inside, <TacticsCards where="stats" />)).toBe("");
  });

  it("says when the cards could not be loaded", () => {
    const session = hero();
    tacticsStore(session).set({ status: "failed", tactics: null, error: "boom" });
    expect(render(session, <TacticsCards where="stats" />)).toContain("could not be loaded: boom");
  });
});

describe("the tactics store", () => {
  it("loads the session's match once and fails visibly on a bad reply", async () => {
    const urls: string[] = [];
    const reply = { body: fixture as unknown };
    const fetch: Fetch = async (url) => {
      urls.push(url);
      return json(reply.body);
    };
    const api = createApi(API, "press_escape-0", fetch);
    const session = createSession(parseHero(raw), null, null, null, { api });
    const store = tacticsStore(session);
    expect(store.get().status).toBe("loading");
    expect(tacticsStore(session)).toBe(store);
    await settle();
    expect(store.get().status).toBe("ready");
    expect(urls).toEqual([`${API}/api/matches/press_escape-0/tactics`]);
    reply.body = { cards: "nope" };
    const other = createSession(parseHero(raw), null, null, null, { api });
    tacticsStore(other);
    await settle();
    expect(tacticsStore(other).get().status).toBe("failed");
  });
});
