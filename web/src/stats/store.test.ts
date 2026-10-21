// Loading the live match stats from the API (GET /api/matches/<id>/stats?tracks=true, SPEC 4.6):
// once per session on screen, for the match that session plays; offline there is nothing to load.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { createApi, type Fetch } from "../api/client";
import { parseHero } from "../data/hero";
import { createSession } from "../session";
import { API, json, settle } from "../testing";
import fixture from "./fixture_seed3.json";
import { statsStore } from "./store";

function online(reply: () => Response) {
  const urls: string[] = [];
  const fetch: Fetch = async (url) => {
    urls.push(url);
    return reply();
  };
  const api = createApi(API, "blind_side_run-3", fetch);
  return { session: createSession(parseHero(raw), null, null, null, { api }), urls };
}

describe("the stats store", () => {
  it("loads the session's match once, with its tracks", async () => {
    const { session, urls } = online(() => json(fixture.stats));
    const store = statsStore(session);
    expect(store.get().status).toBe("loading");
    expect(statsStore(session)).toBe(store); // one store per session
    await settle();
    expect(store.get().status).toBe("ready");
    expect(store.get().stats?.raw.match).toBe("blind_side_run-3");
    expect(urls).toEqual([`${API}/api/matches/blind_side_run-3/stats?tracks=true`]);
  });

  it("fails visibly when the service refuses or sends something else", async () => {
    const refused = online(() => json({ detail: "boom" }, 500));
    statsStore(refused.session);
    await settle();
    expect(statsStore(refused.session).get()).toMatchObject({ status: "failed", stats: null });
    const wrong = online(() => json({ players: "nope" }));
    statsStore(wrong.session);
    await settle();
    expect(statsStore(wrong.session).get().status).toBe("failed");
  });

  it("is offline without a service", () => {
    const session = createSession(parseHero(raw), null, null);
    expect(statsStore(session).get()).toMatchObject({ status: "offline", stats: null });
  });
});
