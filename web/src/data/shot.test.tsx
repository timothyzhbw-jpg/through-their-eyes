// A placed shot (far_post_finish, Module A, SPEC 3.3 and 3.6): the hero's options include
// `shot:near` and `shot:far`, and his action is a shot with an aim and a keeper, not a pass. The
// labels, the board's options, Your call, the story and the counterfactual cards must name the
// post, the tactical board must draw the shot without a pass target, and a goal is never "Lost".

import { describe, expect, it } from "vitest";
import { scenarioLabel } from "../match/match";
import type { Narration } from "../narration/payload";
import { passOptions, optionLabel } from "../options/passOptions";
import { createSession } from "../session";
import { render, SHOT_MOMENT, shotExport } from "../testing";
import { StoryPanel, VerdictPanel } from "../ui/Panels";
import { blurbOf, momentTitle } from "../ui/Stage";
import { callOptions } from "../yourcall/options";
import {
  actionLabel,
  actionTarget,
  isShot,
  parseHero,
  placedShot,
  runLabels,
  shotPost,
  type Hero,
} from "./hero";

const raw = shotExport();
const hero = parseHero(raw);

const session = (mode: "factual" | "counterfactual", value: Partial<Hero> = {}) => {
  const s = createSession({ ...hero, ...value }, null, null, null, { momentId: SHOT_MOMENT });
  s.playback.set({ mode });
  return s;
};

describe("a placed shot", () => {
  it("names the post", () => {
    expect(actionLabel("shot:far")).toBe("Shoot at the far post");
    expect(actionLabel("shot:near")).toBe("Shoot at the near post");
    expect(actionLabel("shot")).toBe("Shoot");
    expect(optionLabel("shot:far")).toBe("Far-post shot");
    expect(optionLabel("shot:near")).toBe("Near-post shot");
    expect([isShot("shot:far"), isShot("shot"), isShot("pass:H9"), isShot(null)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([shotPost("shot:near"), shotPost("shot")]).toEqual(["near", null]);
    const forced = parseHero({
      ...raw,
      counterfactual: { id: "cf1", intervention: "force_action", action: "shot:near" },
    });
    expect(runLabels(forced).counterfactual).toBe("If he shot at the near post");
  });

  it("aims a shot at its aim point: a shot has no pass target", () => {
    const act = hero.runs.factual.action!;
    expect(act.target).toBeUndefined();
    expect(actionTarget(act)).toEqual([52.5, 3.16]);
    expect(actionTarget(hero.runs.counterfactual.action!)).toEqual([52.5, -3.16]);
  });

  it("draws both posts on the board as shots, not carries", () => {
    const options = passOptions(hero, hero.runs.factual);
    const shots = options.filter((o) => o.action.startsWith("shot:"));
    expect(shots.map((o) => [o.action, o.kind, o.label])).toEqual([
      ["shot:far", "shot", "Far-post shot"],
      ["shot:near", "shot", "Near-post shot"],
    ]);
  });

  it("offers his own shot in Your call as a shot, with the post on its marker", () => {
    const [own] = callOptions(hero, null);
    expect(own).toMatchObject({
      action: "shot:far",
      kind: "shot",
      label: "Far-post shot",
      short: "Far post",
      factual: true,
    });
  });

  it("tells the shot and its end, never a lost pass", () => {
    const factual = render(session("factual"), <StoryPanel />);
    expect(factual).not.toMatch(/drops in to receive|starts a run behind|Lost|the runner/);
    expect(factual).toContain("Decision: shoot at the far post");
    expect(factual).toContain("Goal.");
    const cf = render(session("counterfactual"), <StoryPanel />);
    expect(cf).toContain("Decision: shoot at the near post");
    expect(cf).toContain("A1 saves it.");
    const times = [...factual.matchAll(/class="t">([\d.]+) s</g)].map((m) => Number(m[1]));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("compares where he shot and how it ended in each run", () => {
    const html = render(session("factual"), <VerdictPanel />);
    expect(html).toContain("Shoot at the far post · goal");
    expect(html).toContain("Shoot at the near post · saved by A1");
  });

  it("has its own headline, blurb and label", () => {
    expect(momentTitle(hero)).toEqual(["One look changed his", "shot."]);
    expect(blurbOf(hero)).toMatch(/keeper/);
    expect(blurbOf(hero)).not.toMatch(/A hero moment:/);
    expect(scenarioLabel("far_post_finish")).toBe("The far post");
  });

  it("does not show the export's possession value: a goal's value is an outcome, not a chance", () => {
    expect(raw.delta_xt).not.toBeNull();
    expect(placedShot(hero)).toBe(true);
    expect(hero.deltaXt).toBeNull();
    const html = render(session("factual"), <VerdictPanel />);
    expect(html).not.toContain(raw.delta_xt!.toFixed(3));
    expect(html).not.toContain("(xT)");
    expect(runLabels(hero).gain).toBe("Chance of scoring gained by looking");
  });

  it("shows the scan lens's gain in his chance of scoring, marked as the lens's", () => {
    const html = render(
      session("factual", { deltaXt: 0.523342, deltaSource: "lens" }),
      <VerdictPanel />,
    );
    expect(html).toContain("+0.523");
    expect(html).toContain("Chance of scoring gained by looking, on the true positions.");
    expect(html).toContain("scan lens");
    expect(html).not.toContain("Expected threat is");
  });

  it("shows the verified chances before and after when the narration airs cf_shot_value", () => {
    const s = session("factual", { deltaXt: 0.523342, deltaSource: "lens" });
    const claim = {
      id: "cf_shot_value",
      kind: "counterfactual",
      verdict: "supported",
      values: { p0: 0.26, p1: 0.79 },
      evidence: [],
    };
    const line = {
      id: "L8",
      text: "The look raised his chance of scoring from 0.26 to 0.79.",
      claims: ["cf_shot_value"],
    };
    s.breakdown.set({
      narration: {
        fixture: false,
        lines: [line],
        withheld: [],
        claims: new Map([[claim.id, claim]]),
      } as unknown as Narration,
    });
    const html = render(s, <VerdictPanel />);
    expect(html).toContain("0.26 → 0.79");
    expect(html).toContain("checked by the verifier");
    expect(html).not.toContain("+0.523");
  });
});
