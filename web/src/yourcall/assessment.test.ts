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
import { callOptions } from "./options";

const hero = parseHero(raw);
const whatIfs = parseWhatIfs(whatIfJson, hero, heroMoment(hero));

describe.each([["blind_side_run", hero, whatIfs]])("Your call options: %s", (_name, h, w) => {
  const decision = h.runs.factual.decision!;

  it("lists every option the decision model considered, once", () => {
    const actions = callOptions(h, w).map((o) => o.action);
    expect(actions.slice().sort()).toEqual(decision.options.map((o) => o.action).sort());
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("labels his own call as what happened, re-simulated ones as such, the rest as not", () => {
    const all = callOptions(h, w);
    for (const o of all) {
      const a = assessmentOf(h, o)!;
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
      all.filter((o) => !o.factual).every((o) => assessmentOf(h, o)!.outcome === "resimulated"),
    ).toBe(true);
    const bare = callOptions(h, null).filter((o) => !o.factual);
    expect(bare.every((o) => assessmentOf(h, o)!.outcomeLabel === LABEL_NOT_RESIMULATED)).toBe(
      true,
    );
  });

  it("reads every number from the export: no digit outside the formatted values", () => {
    for (const o of callOptions(h, null)) {
      const a = assessmentOf(h, o)!;
      const e = decision.options.find((x) => x.action === o.action)!;
      expect(a.believed[0].value).toBe(`${Math.round(e.prob * 100)}%`);
      expect(a.believed[1].value).toBe(e.p_success.toFixed(2));
      expect(a.believed[2].value).toBe(`${e.value >= 0 ? "+" : ""}${e.value.toFixed(3)} xT`);
      if (e.p_success_true !== null) {
        expect(a.truth[0].value).toBe(e.p_success_true.toFixed(2));
      } else {
        expect(a.truth[0].value).toBe("not playable on the true state");
      }
      // Labels carry no digits at all: every digit on screen is a value read above.
      const labels = [...a.believed, ...a.truth].map((r) => r.label.replace(/[A-Z]\. \w+/, ""));
      expect(labels.join(" ")).not.toMatch(/\d/);
      expect(a.outcomeLabel).not.toMatch(/\d/);
    }
  });
});
