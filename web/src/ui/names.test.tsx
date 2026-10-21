// @vitest-environment happy-dom
// Fictional names on screen (SPEC 4.6, 7): wherever the app writes a player or a club itself, it
// writes his short name and the club's name, as the narration from the service does
// (agents/context.py). Ids stay the data (the select values, data attributes, evidence).

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { App } from "../App";
import { createApi } from "../api/client";
import { parseHero, runLabels } from "../data/hero";
import { clubName, renameIds, shortName } from "../data/roster";
import { createMatchSession } from "../match/matchSession";
import { optionLabel } from "../options/passOptions";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type ViewSession } from "../session";
import { API, fakeFetch, fakeSockets, MATCH, matchExport, pressureExport } from "../testing";
import { intro } from "./intro";
import { LineupCard } from "./LineupCard";
import { momentLabel, MomentsPanel } from "./Live";
import { Scoreboard } from "./Match";
import { DecisionPanel, StoryPanel } from "./Panels";
import { StageHud } from "./Stage";

vi.mock("../views/PovView", () => ({ PovView: () => <div className="pov-stub" /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <div className="tac-stub" /> }));
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  Canvas: () => <div className="canvas-stub" />,
}));
vi.mock("../session", async (original) => ({
  ...(await original<typeof import("../session")>()),
  startClock: () => () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const ID = /(?<![A-Za-z0-9_:])[HA](?:1[01]|[1-9])(?![A-Za-z0-9_:])/;

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
});

function mount(session: ViewSession, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";
/** The words on screen: text and the labels a screen reader reads, not data attributes. */
function words(el: Element): string {
  const labels = [...el.querySelectorAll("[aria-label], optgroup, option")].map(
    (e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("label") ?? ""}`,
  );
  return `${text(el)} ${labels.join(" ")}`;
}

describe("the names", () => {
  it("are the sim's fictional ones", () => {
    expect(shortName("H8")).toBe("J. Ferriday");
    expect(shortName("Z9")).toBe("Z9");
    expect(clubName(0)).toBe("Kestrel Bay");
    expect(clubName(1)).toBe("Corvane Vale");
    expect(renameIds("H8 passed to H4; A10 beat A1 (scan:H8:0050).")).toBe(
      "J. Ferriday passed to K. Annersley; J. Kestrell beat H. Talvisto (scan:H8:0050).",
    );
  });
});

describe("on screen, a player and a club go by their names", () => {
  it("the lineup card: the clubs and every player", () => {
    intro.set({ open: true });
    const page = mount(offline(), <LineupCard />);
    const card = text(page);
    expect(card).toContain("Kestrel Bay v Corvane Vale");
    expect(card).toContain("J. Ferriday");
    expect(card).not.toMatch(/\bHome\b|\bAway\b/);
    expect(words(page)).not.toMatch(ID);
  });

  it("the eyes picker and the readout over his eyes", () => {
    const page = mount(offline(), <StageHud />);
    const select = page.querySelector<HTMLSelectElement>("select")!;
    const picked = select.selectedOptions[0];
    expect(picked.value).toBe("H8"); // the value is the data
    expect(text(picked)).toBe("J. Ferriday · CM (hero)");
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual([
      "Kestrel Bay",
      "Corvane Vale",
    ]);
    expect(words(page)).not.toMatch(ID);
  });

  it("the story, and the decision's options", () => {
    const session = offline();
    for (const node of [<StoryPanel key="s" />, <DecisionPanel key="d" />]) {
      const page = mount(session, node);
      expect(words(page), node.key!).not.toMatch(ID);
      expect(words(page), node.key!).toContain("Ferriday");
    }
    expect(optionLabel("pass:H4")).toBe("Pass to K. Annersley");
  });

  it("the runs' names when the run forces a pass or a carry", () => {
    expect(runLabels(parseHero(pressureExport())).counterfactual).toBe("If he carried it");
    const forcedPass = parseHero(raw);
    forcedPass.counterfactual = {
      ...forcedPass.counterfactual!,
      intervention: "force_action",
      action: "pass:H4",
    };
    expect(runLabels(forcedPass).counterfactual).toBe("If he passed to K. Annersley");
  });

  it("the moments of a match, its score bug and the legend", () => {
    const m = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });
    expect(momentLabel({ kind: "decision_after_scan", actor: "H8", receiver: "H4" })).toBe(
      "Decision after a scan · J. Ferriday → K. Annersley",
    );
    const moments = mount(m, <MomentsPanel />);
    expect(words(moments)).not.toMatch(ID);
    const score = mount(m, <Scoreboard />);
    expect(text(score)).toContain("Kestrel Bay");
    expect(text(score)).toContain("Corvane Vale");
    const app = mount(offline(), <App autoplay={false} />);
    const legend = text(app.querySelector("footer.legend")!);
    expect(legend).toContain("Kestrel Bay (attacking right)");
    expect(legend).toContain("Corvane Vale");
  });
});
