// A hero without a key scan (press_escape, SPEC 3.6): its lens is pressure and its counterfactual
// forces an action instead of dropping a look. The breakdown player must work the same way: the
// template plan has no scan marker, the run toggle and ghost name the forced action, and the
// counterfactual ghost is the forced carry.

import { describe, expect, it } from "vitest";
import { createApi } from "../api/client";
import { heroMoment } from "../plan/moment";
import { templatePlan } from "../plan/template";
import { validatePlan } from "../plan/validate";
import { createSession, tickSession } from "../session";
import { createPlayback, frameStep } from "../store/playback";
import {
  API,
  exportJson,
  fakeFetch,
  json,
  PRESS_MOMENT,
  pressureBreakdown,
  pressureExport,
  render,
  settle,
} from "../testing";
import { RunToggle } from "../ui/RunToggle";
import { StoryPanel } from "../ui/Panels";
import { Transport } from "../ui/Transport";
import { parseHero, runLabels } from "./hero";

const hero = parseHero(pressureExport());

describe("a hero without a key scan", () => {
  it("loads with no key scan and a forced-action counterfactual", () => {
    expect(hero.kind).toBe("hero");
    expect(hero.keyScan).toBeNull();
    expect(hero.counterfactual).toEqual({
      id: "cf1",
      intervention: "force_action",
      action: "carry",
    });
    expect(hero.runs.counterfactual).not.toBe(hero.runs.factual);
    expect(runLabels(hero)).toMatchObject({
      factual: "What he did",
      counterfactual: "If he carried it",
    });
  });

  it("names the moment as the service does, and still knows the scan hero's", () => {
    const m = heroMoment(hero, PRESS_MOMENT);
    expect(m.id).toBe(PRESS_MOMENT);
    expect(m.keyScan).toBeNull();
    expect(m.counterfactual).toBe("cf1");
    expect(runLabels(parseHero(exportJson))).toMatchObject({
      factual: "With the look",
      counterfactual: "Without the look",
    });
  });

  it("builds a template plan without a scan marker: POV up to the decision, then the ghost", () => {
    const m = heroMoment(hero, PRESS_MOMENT);
    const plan = templatePlan(m);
    const v = validatePlan(plan, m, {});
    expect(v.ok ? [] : v.errors).toEqual([]);
    expect(plan.steps.some((s) => s.do === "scan_marker")).toBe(false);
    const pov = plan.steps.find((s) => s.do === "pov");
    expect(pov).toMatchObject({ player: hero.heroId, from: -2.4, to: 0 });
    expect(plan.steps.at(-1)).toMatchObject({ do: "ghost", kind: "counterfactual", cf: "cf1" });
  });

  it("starts the replay before the decision and never slows for a key scan", () => {
    const playback = createPlayback(hero);
    const decision = hero.runs.factual.decision!.frame;
    expect(playback.get().frame).toBeLessThan(decision);
    const s = { ...playback.get(), frame: decision - 25, autoSlow: true };
    expect(frameStep(hero, s, 0.04)).toBeCloseTo(1, 6);
  });

  it("plays the service's breakdown with no scan marker and the forced carry as the ghost", async () => {
    const fetch = fakeFetch({ "POST /api/breakdowns": () => json(pressureBreakdown()) });
    const session = createSession(hero, null, null, null, {
      api: createApi(API, "press_escape-0", fetch),
      momentId: PRESS_MOMENT,
    });
    session.controls.playBreakdown();
    await settle();
    expect(fetch.calls[0].body).toMatchObject({ match: "press_escape-0", moment: PRESS_MOMENT });
    expect(session.breakdown.get().resolved).toMatchObject({ source: "given", errors: [] });
    const marks = new Set<string | null>();
    for (let k = 0; k < 2000 && session.runner.status.get().status === "running"; k++) {
      tickSession(session, 1 / 30);
      marks.add(session.playback.get().scanMarker);
    }
    expect(session.runner.status.get().status).toBe("done");
    expect([...marks]).toEqual([null]);
    expect(session.playback.get().cfGhost).toBe(true);
  });

  it("labels the runs by the forced action and drops the key-scan jump", () => {
    const session = createSession(hero, null, null);
    const toggle = render(session, <RunToggle />);
    expect(toggle).toContain("What he did");
    expect(toggle).toContain("If he carried it");
    expect(toggle).not.toContain("look");
    const transport = render(session, <Transport />);
    expect(transport).not.toContain("Key scan");
    expect(transport).toContain("Decision");
    const story = render(session, <StoryPanel />);
    expect(story).not.toContain("shoulder");
    expect(story).toContain("Decision");
  });
});
