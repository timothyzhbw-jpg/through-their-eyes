// "Your call" (SPEC 7): the options listed at the decision match the export, and the model's
// assessment of each is read from it, with the re-simulated / not re-simulated label.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { heroMoment } from "../plan/moment";
import { parseWhatIfs } from "../whatif/whatif";
import {
  assessmentOf,
  LABEL_HAPPENED,
  LABEL_NOT_RESIMULATED,
  LABEL_RESIMULATED,
} from "./assessment";
import { callOptions, clipOf, newPose, poseAt } from "./options";

const hero = parseHero(raw);
const whatIfs = parseWhatIfs(whatIfJson, hero, heroMoment(hero));
const decision = hero.runs.factual.decision!;

describe("Your call options: blind_side_run", () => {
  it("lists every option the decision model considered, once", () => {
    const actions = callOptions(hero, whatIfs).map((o) => o.action);
    expect(actions.slice().sort()).toEqual(decision.options.map((o) => o.action).sort());
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("labels his own call as what happened, re-simulated ones as such, the rest as not", () => {
    const all = callOptions(hero, whatIfs);
    for (const o of all) {
      const a = assessmentOf(hero, o)!;
      expect(a.outcomeLabel).toBe(
        o.factual
          ? LABEL_HAPPENED
          : o.run.source === "whatif"
            ? LABEL_RESIMULATED
            : LABEL_NOT_RESIMULATED,
      );
    }
    // With the what-ifs every other option was re-simulated; without them none was.
    expect(
      all.filter((o) => !o.factual).every((o) => assessmentOf(hero, o)!.outcome === "resimulated"),
    ).toBe(true);
    const bare = callOptions(hero, null).filter((o) => !o.factual);
    expect(bare.every((o) => assessmentOf(hero, o)!.outcomeLabel === LABEL_NOT_RESIMULATED)).toBe(
      true,
    );
  });

  it("formats his pass to H9 from the export's values", () => {
    // Literals read off hero_seed3.json: prob 0.9856, p_success 0.6497, value 0.0649,
    // p_success_true 0.8253, value_true 0.093.
    const o = callOptions(hero, null).find((x) => x.action === "pass:H9")!;
    const a = assessmentOf(hero, o)!;
    expect(a.believed.map((r) => r.value)).toEqual(["99%", "0.65", "+0.065 xT"]);
    expect(a.truth.map((r) => r.value).slice(0, 2)).toEqual(["0.83", "+0.093 xT"]);
  });

  it("labels carry no digit: every digit on screen is a value read from the export", () => {
    for (const o of callOptions(hero, null)) {
      const a = assessmentOf(hero, o)!;
      const labels = [...a.believed, ...a.truth].map((r) => r.label.replace(/[A-Z]\. \w+/, ""));
      expect(labels.join(" ")).not.toMatch(/\d/);
      expect(a.outcomeLabel).not.toMatch(/\d/);
    }
  });
});

describe("Your call options: a shot and missing true values", () => {
  // A copy of the export where the carry is a shot that is not playable on the true state, and
  // the pass to H4 has a true chance but no true value.
  const h = parseHero(structuredClone(raw));
  const d = h.runs.factual.decision!;
  const carry = d.options.find((x) => x.action === "carry")!;
  carry.action = "shot";
  carry.p_success_true = null;
  carry.value_true = null;
  d.options.find((x) => x.action === "pass:H4")!.value_true = null;
  const options = callOptions(h, null);
  const of = (action: string) =>
    assessmentOf(
      h,
      options.find((x) => x.action === action)!,
    )!;

  it("says a shot it could not play on the truth, and aims at scoring", () => {
    const a = of("shot");
    expect(a.truth.map((r) => r.value)).toEqual(["not playable on the true state"]);
    expect(a.believed[1].label).toMatch(/score/);
  });

  it("leaves out the true value when the export has none", () => {
    const a = of("pass:H4");
    expect(a.truth[0].value).toBe("0.99");
    expect(a.truth.some((r) => r.label === "Value, on the truth")).toBe(false);
  });
});

describe("Your call: an option with no run holds still", () => {
  const moment = heroMoment(hero);
  const none = callOptions(hero, null).find((o) => o.run.source === "none")!;

  it("plays no frames, from the decision to the decision", () => {
    expect(clipOf(hero, moment, none)).toEqual({
      start: moment.decisionFrame,
      end: moment.decisionFrame,
    });
  });

  it("shows the picture at the decision whatever frame is asked for", () => {
    const early = poseAt(hero, none, 0, newPose(hero.n));
    const pos = early.pos.slice();
    const ball = early.ball.slice();
    const late = poseAt(hero, none, decision.frame + 200, newPose(hero.n));
    expect(late.pos).toEqual(pos);
    expect(late.ball).toEqual(ball);
  });
});
