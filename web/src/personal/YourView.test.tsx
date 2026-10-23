// @vitest-environment happy-dom
// Personalized viewing on screen (SPEC 7): the moment rail's order, the one-line summary, the menu's
// choices reaching the recap's audience, and no request made by choosing.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { MomentChips } from "../moments/MomentRail";
import { SessionContext } from "../session";
import { API, fakeFetch, fakeSockets, MATCH, matchExport } from "../testing";
import { NO_CHOICES } from "./follow";
import { personal } from "./state";
import { usePersonalSync, YourViewLine, YourViewMenu } from "./YourView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
beforeEach(() => personal.set(NO_CHOICES));
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** What App and MatchView put together: the sync once, the menu, the line and the rail. */
function Page() {
  usePersonalSync(true);
  return (
    <>
      <YourViewMenu />
      <YourViewLine />
      <MomentChips />
    </>
  );
}

function setup() {
  const fetch = fakeFetch({});
  const session = createMatchSession(parseHero(matchExport()), {
    api: createApi(API, MATCH, fetch),
    dataUrl: "/data/",
    socket: fakeSockets(),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <Page />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return { container, session, fetch };
}

const chips = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>("[data-moment]")].map((a) => a.dataset.moment);
const line = (c: HTMLElement) =>
  c.querySelector("[data-testid='your-view-line']")?.textContent ?? "";

describe("Your view", () => {
  it("shows nobody followed and the rail in its own order at first", () => {
    const { container } = setup();
    expect(line(container)).toBe("Your view: Casual fan · English · following nobody yet");
    expect(chips(container)).toEqual(["look", "pressure", "corner", "goal", "match"]);
  });

  it("puts a followed club's and player's moments first and says so", () => {
    const { container } = setup();
    act(() => personal.set({ player: "H8", team: 0 }));
    expect(chips(container).slice(0, 2)).toEqual(["look", "pressure"]);
    expect(line(container)).toContain("following Kestrel Bay and J. Ferriday");
    act(() => personal.set({ player: "H9" }));
    expect(line(container)).toContain("moments in reach involve them");
  });

  it("the mode switch and More reach the recap's audience without asking for anything", () => {
    const { container, session, fetch } = setup();
    act(() => container.querySelector<HTMLButtonElement>(".your-view-toggle")!.click());
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".seg button")];
    const analyst = buttons.find((b) => b.textContent === "Tactical analyst")!;
    act(() => analyst.click());
    expect(session.recap.state.get().persona).toBe("analyst");
    expect(line(container)).toContain("Tactical analyst");
    const zh = buttons.find((b) => b.textContent === "中文")!;
    act(() => zh.click());
    expect(session.recap.state.get().language).toBe("zh");
    expect(personal.get()).toMatchObject({ persona: "analyst", language: "zh" });
    const more = container.querySelector<HTMLSelectElement>(".your-view-row select")!;
    expect([...more.options].map((o) => o.value)).toEqual([
      "",
      "player_fan",
      "coach",
      "audio_description",
    ]);
    // The recap was never asked for: no model call, no cache miss, nothing.
    expect(fetch.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("a page that opens inside a match starts on the choices already made", () => {
    personal.set({ persona: "coach", language: "zh" });
    const { session } = setup();
    expect(session.recap.state.get()).toMatchObject({ persona: "coach", language: "zh" });
  });

  it("lists every player of both clubs to follow", () => {
    const { container } = setup();
    act(() => container.querySelector<HTMLButtonElement>(".your-view-toggle")!.click());
    const selects = container.querySelectorAll<HTMLSelectElement>(".your-view-row select");
    const player = selects[2]!;
    expect(player.options).toHaveLength(23); // "No player" and 22 players
  });
});
