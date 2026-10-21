// A keeper's step (screened_shot, SPEC 3.6 C2): the hero is the keeper, with no decision and no
// key scan but one step across his goal that clears his sight of the shot. The counterfactual
// drops the step. The run toggle, the timeline, the story, the counterfactual card, the headline
// and the worth (the sight lens: his chance of saving it) must tell a step, not a decision.

import { describe, expect, it } from "vitest";
import { scenarioLabel } from "../match/match";
import { heroMoment } from "../plan/moment";
import { createPlayback } from "../store/playback";
import { createSession } from "../session";
import {
  API,
  fakeFetch,
  health,
  json,
  render,
  STEP_MOMENT,
  stepCards,
  stepExport,
} from "../testing";
import { StoryPanel, VerdictPanel } from "../ui/Panels";
import { blurbOf, momentKicker, momentTitle } from "../ui/Stage";
import { Transport } from "../ui/Transport";
import type { Narration } from "../narration/payload";
import { parseHero, runLabels, type Hero } from "./hero";
import { loadData } from "./load";

const raw = stepExport();
const hero = parseHero(raw);

const session = (mode: "factual" | "counterfactual", value: Partial<Hero> = {}) => {
  const s = createSession({ ...hero, ...value }, null, null, null, { momentId: STEP_MOMENT });
  s.playback.set({ mode });
  return s;
};

describe("a keeper's step", () => {
  it("loads the step, the shot he faces and how it ended in each run", () => {
    expect(hero.keyScan).toBeNull();
    expect(hero.deltaXt).toBeNull();
    const step = hero.keeperStep!;
    expect(step).toMatchObject({ id: "step:H1:0013", frame: 13, shooter: "A9" });
    expect(step.lateral).toBeCloseTo(0.6436, 4);
    expect(step.shot.id).toBe("shot:A9:0035");
    expect(step.resolved.factual).toEqual({ frame: 52, type: "save", player: "H1" });
    expect(step.resolved.counterfactual).toEqual({ frame: 55, type: "goal", player: "A9" });
    expect(hero.reception).toBe(52); // anchored at the save, like the service's card
    expect(heroMoment(hero, STEP_MOMENT).anchorFrame).toBe(52);
    expect(createPlayback(hero).get().frame).toBe(35); // opens as the shot is struck
  });

  it("names the runs after the step", () => {
    expect(runLabels(hero)).toMatchObject({
      factual: "With the step",
      counterfactual: "Without the step",
      tag: { factual: "with the step", counterfactual: "without the step" },
      gain: "Chance of saving it gained by the step",
    });
  });

  it("tells his step and the shot, never a decision or a press", () => {
    const factual = render(session("factual"), <StoryPanel />);
    expect(factual).not.toMatch(/Decision|closing him down|keeps the ball|takes it/);
    expect(factual).toContain("H1 steps 0.6 m across.");
    expect(factual).toContain("A9 shoots.");
    expect(factual).toContain("H1 saves it.");
    const times = [...factual.matchAll(/class="t">([\d.]+) s</g)].map((m) => Number(m[1]));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const cf = render(session("counterfactual"), <StoryPanel />);
    expect(cf).toContain("Same moment, but H1 stays where he is. No step.");
    expect(cf).toContain("A9 scores.");
  });

  it("compares how the shot ended, and shows his chance of saving it", () => {
    const html = render(
      session("factual", { deltaXt: 0.7, deltaSource: "lens" }),
      <VerdictPanel />,
    );
    expect(html).toContain("Take the step");
    expect(html).toContain("He saves it");
    expect(html).toContain("A9 scores");
    expect(html).toContain("+0.700");
    expect(html).toContain("Chance of saving it gained by the step, on the true positions.");
    expect(html).not.toContain("Expected threat is");
  });

  it("shows the verified chances when the narration airs cf_save_chance", () => {
    const s = session("factual", { deltaXt: 0.7, deltaSource: "lens" });
    const claim = {
      id: "cf_save_chance",
      kind: "counterfactual",
      verdict: "supported",
      values: { p0: 0, p1: 0.7 },
      evidence: [],
    };
    const line = {
      id: "L5",
      text: "The step raised H1's chance of saving it from 0.00 to 0.70.",
      claims: [claim.id],
    };
    s.breakdown.set({
      narration: {
        fixture: false,
        lines: [line],
        withheld: [],
        claims: new Map([[claim.id, claim]]),
      } as unknown as Narration,
    });
    expect(render(s, <VerdictPanel />)).toContain("0.00 → 0.70");
  });

  it("marks the key step and where the ball arrives on the timeline", () => {
    const html = render(session("factual"), <Transport />);
    expect(html).toContain(">Key step<");
    expect(html).toContain(">Ball arrives<");
    expect(html).not.toContain(">Decision<");
  });

  it("has its own headline, kicker, blurb and label", () => {
    expect(momentTitle(hero)).toEqual(["One step, and", "he saves it."]);
    expect(momentKicker(hero, 52, 0)).toBe(`Moment · ${(52 * hero.dt).toFixed(2)} s · Perception`);
    expect(blurbOf(hero)).toMatch(/keeper/);
    expect(blurbOf(hero)).not.toMatch(/A hero moment:/);
    expect(scenarioLabel("screened_shot")).toBe("The save");
  });

  it("loads the sight lens's value from the hero card", async () => {
    const fetch = fakeFetch({
      "GET /health": health,
      "GET /api/matches/screened_shot-0": () =>
        json({
          id: "screened_shot-0",
          kind: "hero",
          hero_moment: STEP_MOMENT,
          hero_moments: [STEP_MOMENT],
        }),
      "GET /api/matches/screened_shot-0/export": () => json(raw),
      "GET /api/matches/screened_shot-0/moments": () => json(stepCards()),
    });
    const data = await loadData({
      apiBase: API,
      dataUrl: "/data/",
      fetch,
      match: "screened_shot-0",
    });
    expect(data.hero.deltaXt).toBeCloseTo(0.7, 6);
    expect(data.hero.deltaSource).toBe("lens");
  });
});
