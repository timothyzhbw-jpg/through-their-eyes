// Pass options layer (SPEC 7): width = choice probability, colour = value, the flip between the
// runs is visible, and hover text uses claim values where the payload has them.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { validatePayload, type Narration } from "../narration/payload";
import { heroMoment } from "../plan/moment";
import {
  colorFor,
  hoverContent,
  passOptions,
  pickOption,
  thoughtVsWas,
  toPitch,
  toScreen,
  valueRange,
  widthFor,
  WIDTH_PX,
  type PassOption,
} from "./passOptions";

const hero = parseHero(raw);
const checked = validatePayload(payloadJson, heroMoment(hero), hero);
const narration = (checked.ok ? checked.narration : null) as Narration;
const factual = passOptions(hero, hero.runs.factual);
const without = passOptions(hero, hero.runs.counterfactual);
const find = (options: PassOption[], action: string) => options.find((o) => o.action === action)!;
const brightness = (hex: string) =>
  [1, 3, 5].reduce((sum, k) => sum + parseInt(hex.slice(k, k + 2), 16), 0);

describe("which options are drawn", () => {
  it("shows the top six, plus the chosen option and the runner's", () => {
    for (const options of [factual, without]) {
      expect(options.length).toBeGreaterThanOrEqual(6);
      expect(options.length).toBeLessThanOrEqual(8);
      expect(options.filter((o) => o.chosen)).toHaveLength(1);
      expect(options.some((o) => o.action === "pass:H9")).toBe(true);
    }
    expect(find(factual, "pass:H9").chosen).toBe(true);
    expect(find(without, "pass:H4").chosen).toBe(true);
  });

  it("starts every line at the carrier at the decision", () => {
    const d = hero.runs.factual.decision!;
    const i = (d.frame * hero.n + hero.hero) * 2;
    expect(factual[0].from).toEqual([hero.runs.factual.pos[i], hero.runs.factual.pos[i + 1]]);
  });
});

describe("encodings", () => {
  it("maps choice probability to width, linearly between the bounds", () => {
    expect(widthFor(0)).toBe(WIDTH_PX.min);
    expect(widthFor(1)).toBe(WIDTH_PX.max);
    expect(widthFor(0.5)).toBeCloseTo((WIDTH_PX.min + WIDTH_PX.max) / 2, 9);
    expect(widthFor(2)).toBe(WIDTH_PX.max);
  });

  it("makes the flip obvious: the H9 line nearly vanishes without the look, H4 thickens", () => {
    expect(widthFor(find(factual, "pass:H9").prob)).toBeGreaterThan(8.5);
    expect(widthFor(find(without, "pass:H9").prob)).toBeLessThan(WIDTH_PX.min + 0.1);
    expect(widthFor(find(without, "pass:H4").prob)).toBeGreaterThan(
      widthFor(find(factual, "pass:H4").prob) + 1,
    );
  });

  it("maps value to a colour ramp on one range for both runs", () => {
    const range = valueRange(hero);
    expect(colorFor(range[0], range)).toBe("#3e5d66");
    expect(colorFor(range[1], range)).toBe("#effcff");
    const values = [...factual, ...without].map((o) => o.value).sort((a, b) => a - b);
    const shades = values.map((v) => brightness(colorFor(v, range)));
    expect(shades).toEqual([...shades].sort((a, b) => a - b)); // brighter = more valuable
    // The pass to H9 was the most valuable option with the look, and looked poor without it.
    expect(brightness(colorFor(find(factual, "pass:H9").value, range))).toBeGreaterThan(
      brightness(colorFor(find(without, "pass:H9").value, range)),
    );
  });
});

describe("he thought / it was", () => {
  it("takes the numbers from the claims, per run", () => {
    const f = thoughtVsWas(narration, hero, hero.runs.factual)!;
    expect(f).toMatchObject({ action: "pass:H9", pBelief: "0.72", pTrue: "0.90" });
    expect(f.claim.kind).toBe("computed");
    const c = thoughtVsWas(narration, hero, hero.runs.counterfactual)!;
    expect(c).toMatchObject({ action: "pass:H9", pBelief: "0.05", pTrue: "0.90" });
    expect(c.claim.kind).toBe("counterfactual");
  });

  it("is absent without a supported claim", () => {
    expect(thoughtVsWas(null, hero, hero.runs.factual)).toBeNull();
  });
});

describe("hover", () => {
  it("shows the option and both probabilities, from the claim when there is one", () => {
    const verified = thoughtVsWas(narration, hero, hero.runs.counterfactual);
    const h9 = hoverContent(find(without, "pass:H9"), verified);
    expect(h9.title).toBe("Pass to H9");
    expect(h9.chosen).toBe(false);
    expect(h9.rows.map((r) => [r.label, r.value, r.source, r.kind])).toEqual([
      ["Chance he picked it", "0.00", "sim", undefined],
      ["He thought it would arrive", "0.05", "claim", "counterfactual"],
      ["It was", "0.90", "claim", "counterfactual"],
      ["Value, as he saw it", "-0.017 xT", "sim", undefined],
    ]);
    const h4 = hoverContent(find(without, "pass:H4"), verified);
    expect(h4.chosen).toBe(true);
    expect(h4.rows.every((r) => r.source === "sim")).toBe(true); // no claim: marked unverified
    expect(h4.rows[1].value).toBe(find(without, "pass:H4").pBelief.toFixed(2));
  });
});

describe("picking under the pointer", () => {
  it("finds the line under the pointer and converts between screen and pitch", () => {
    const h9 = find(factual, "pass:H9");
    const mid: [number, number] = [
      (h9.from[0] + h9.target[0]) / 2,
      (h9.from[1] + h9.target[1]) / 2 + 0.3,
    ];
    expect(pickOption(mid, factual, 1)?.action).toBe("pass:H9");
    expect(pickOption([-50, 30], factual, 1)).toBeNull();
    const px = toScreen(mid, 800, 533, 7.2);
    const back = toPitch(px, 800, 533, 7.2);
    expect(back[0]).toBeCloseTo(mid[0], 9);
    expect(back[1]).toBeCloseTo(mid[1], 9);
  });
});
