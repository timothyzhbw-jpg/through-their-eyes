// A scan hero that is not blind_side_run (cutback_scan, SPEC 3.6): the winger looks into the box
// and cuts it back to the runner; without the look he carries the ball. The story is built from the
// runs (blind_side_run keeps its own hand-written beats), the counterfactual card names the carry,
// and the scenario has its own blurb and label.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { scenarioLabel } from "../match/match";
import { createSession } from "../session";
import { CUTBACK_MOMENT, cutbackExport, render } from "../testing";
import { StoryPanel, VerdictPanel } from "../ui/Panels";
import { blurbOf, momentTitle } from "../ui/Stage";
import { parseHero } from "./hero";

const hero = parseHero(cutbackExport());

const session = (mode: "factual" | "counterfactual") => {
  const s = createSession(hero, null, null, null, { momentId: CUTBACK_MOMENT });
  s.playback.set({ mode });
  return s;
};

describe("a scan hero other than the blind-side run", () => {
  it("tells the move from the runs, not the blind-side run's script", () => {
    const factual = render(session("factual"), <StoryPanel />);
    expect(factual).not.toMatch(/at the back|drops in to receive|back to goal|over his shoulder/);
    expect(factual).toContain("H4 plays it to H8.");
    expect(factual).toContain("H8 looks away from the ball");
    expect(factual).toContain("Decision: pass to H9");
    expect(factual).toContain("Completed to H9.");
    const times = [...factual.matchAll(/class="t">([\d.]+) s</g)].map((m) => Number(m[1]));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("ends the run without the look with the carry", () => {
    const cf = render(session("counterfactual"), <StoryPanel />);
    expect(cf).toContain("H8 keeps his eyes on the ball");
    expect(cf).toContain("Decision: carry forward");
    expect(cf).toContain("He keeps the ball.");
    expect(cf).not.toContain("Completed");
  });

  it("names the carry on the counterfactual card", () => {
    const html = render(session("factual"), <VerdictPanel />);
    expect(html).toContain("Pass to H9");
    expect(html).toContain("Carry forward");
    expect(html).toContain("in expected threat (xT)");
  });

  it("has its own headline, blurb and label", () => {
    expect(momentTitle(hero)).toEqual(["One look changed his", "pass."]);
    expect(blurbOf(hero)).toMatch(/box/);
    expect(blurbOf(hero)).not.toMatch(/A hero moment:/);
    expect(scenarioLabel("cutback_scan")).toBe("The cutback");
  });

  it("keeps the blind-side run's own story", () => {
    const html = render(createSession(parseHero(raw), null, null), <StoryPanel />);
    expect(html).toContain("drops in to receive with his back to goal");
    expect(html).toContain("checks over his shoulder");
  });
});
