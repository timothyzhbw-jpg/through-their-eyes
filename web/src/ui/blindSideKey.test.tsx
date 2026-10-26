import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { render } from "../testing";
import { StageBlindSideKey } from "./BlindSideOverlay";

const hero = parseHero(raw);
const TEXT = "Blind side: an opponent closing in that he has not seen";

describe("the blind-side line key", () => {
  it("appears with the broadcast and board lines, not without lines or in first person", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    session.playback.set({ frame: hero.keyScan!.start - 1, camera: "broadcast", focus: "split" });
    expect(render(session, <StageBlindSideKey />)).toContain(TEXT);

    session.playback.set({ focus: "tactical" });
    expect(render(session, <StageBlindSideKey />)).toContain(TEXT);

    session.playback.set({ camera: "pov", focus: "pov" });
    expect(render(session, <StageBlindSideKey />)).toBe("");

    session.playback.set({ camera: "broadcast", focus: "split", blindSide: false });
    expect(render(session, <StageBlindSideKey />)).toBe("");

    session.playback.set({ blindSide: true, frame: 0 });
    expect(render(session, <StageBlindSideKey />)).toBe("");
  });
});
