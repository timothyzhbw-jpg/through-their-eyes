// The pitch-control layer is drawn on the tactical board of a hero moment and of a stitched match
// (SPEC 3.1, 7), so it reads the playback of either session. Found live on 2026-10-20: it asked for
// a hero session, and opening match-1 threw before anything was drawn.

import { describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { API, fakeFetch, fakeSockets, MATCH, matchExport, render } from "../testing";
import { PitchControlLayer } from "./PitchControlLayer";

// useFrame needs a Canvas; the frame loop is not what this test is about.
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  useFrame: () => {},
}));

describe("the pitch-control layer", () => {
  it("renders on the tactical board of a stitched match", () => {
    const hero = parseHero(structuredClone(matchExport()));
    const fetch = fakeFetch({});
    const session = createMatchSession(hero, {
      api: createApi(API, MATCH, fetch),
      dataUrl: "/data/",
      fetch,
      socket: fakeSockets(),
    });
    expect(() => render(session, <PitchControlLayer hero={hero} renderOrder={0} />)).not.toThrow();
  });

  it("renders on the tactical board of a hero moment", () => {
    const hero = parseHero(raw);
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null);
    expect(() => render(session, <PitchControlLayer hero={hero} renderOrder={0} />)).not.toThrow();
  });
});
