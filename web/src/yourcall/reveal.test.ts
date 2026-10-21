// "Your call" (SPEC 7): what the viewer may pick, the picture he decides on, and what each beat
// of the reveal says. The picture is the hero's belief at the decision; every number shown comes
// from a verified line (the breakdown's narration, or the precomputed what-if answers).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { checkPayload, validatePayload, type Narration } from "../narration/payload";
import { heroMoment } from "../plan/moment";
import { PRESS_MOMENT, pressureBreakdown, pressureExport } from "../testing";
import { parseWhatIfs } from "../whatif/whatif";
import { callOptions, clipOf } from "./options";
import { pictureOf, STALE_S } from "./picture";
import { revealOf, type Reveal } from "./reveal";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const whatIfs = parseWhatIfs(whatIfJson, hero, moment);
const check = validatePayload(payloadJson, moment, hero);
if (!check.ok) throw new Error(check.errors.join("; "));
const narration = check.narration;
const options = callOptions(hero, whatIfs);
const reveal = (pick: string, n: Narration | null = narration, language: "en" | "zh" = "en") =>
  revealOf({ hero, options, whatIfs, narration: n, language, pick })!;
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

/** Every string of a reveal outside its verified lines: titles and labels. */
function labels(r: Reveal): string[] {
  return [r.outcome.title, r.truth.title, r.actual.title, r.compare.yours, r.compare.his];
}

describe("Your call: his options", () => {
  it("offers every option he weighed, each with a run to play", () => {
    const decision = hero.runs.factual.decision!;
    expect(options.map((o) => o.action).sort()).toEqual(
      decision.options.map((o) => o.action).sort(),
    );
    expect(options.filter((o) => o.factual).map((o) => o.action)).toEqual([decision.chosen]);
    for (const o of options) {
      expect(o.run.source).toBe(o.factual ? "factual" : "whatif");
    }
  });

  it("marks each pass over the receiver where he pictured him, and aims it where he would", () => {
    const h9 = options.find((o) => o.action === "pass:H9")!;
    const exported = hero.runs.factual.decision!.options.find((o) => o.action === "pass:H9")!;
    expect(h9).toMatchObject({ kind: "pass", label: "Pass to H9", receiver: "H9", short: "9" });
    expect(h9.anchor).toEqual(exported.receiver_believed);
    expect(h9.target).toEqual(exported.target);
    const carry = options.find((o) => o.action === "carry")!;
    expect(carry).toMatchObject({ kind: "carry", label: "Carry", receiver: null });
    expect(carry.anchor).toEqual(carry.target);
  });

  it("lists them across the pitch as he faces the attack, not by how likely he was to pick them", () => {
    // Home attacks +x: from behind him, his left is +y.
    const ys = options.map((o) => o.anchor[1]);
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    expect(options[0].factual).toBe(false);
  });

  it("without precomputed what-ifs offers only the runs the export holds", () => {
    expect(callOptions(hero, null).map((o) => o.action)).toEqual(["pass:H9"]);
    const press = parseHero(pressureExport());
    const pressOptions = callOptions(press, null);
    expect(pressOptions.map((o) => [o.action, o.run.source]).sort()).toEqual([
      ["carry", "counterfactual"],
      ["pass:H9", "factual"],
    ]);
  });

  it("plays each call from the decision until it is resolved", () => {
    const decision = hero.runs.factual.decision!.frame;
    const h9 = clipOf(
      hero,
      moment,
      options.find((o) => o.factual)!,
    );
    expect(h9.start).toBe(decision);
    expect(h9.end).toBeGreaterThanOrEqual(moment.endFrame);
    expect(h9.end).toBeLessThan(hero.runs.factual.frames);
    const h4 = options.find((o) => o.action === "pass:H4")!;
    const run = h4.run.source === "whatif" ? h4.run.run : null;
    expect(clipOf(hero, moment, h4)).toEqual({ start: decision, end: decision + run!.frames - 1 });
  });
});

describe("Your call: his picture at the decision", () => {
  const picture = pictureOf(hero)!;
  const ids = (pick: (p: (typeof picture.players)[number]) => boolean) =>
    picture.players
      .filter(pick)
      .map((p) => p.id)
      .sort();

  it("puts everyone where he believed they were, himself where he is", () => {
    const f = picture.frame;
    const n = hero.n;
    expect(f).toBe(hero.runs.factual.decision!.frame);
    for (const p of picture.players) {
      const k = (f * n + p.j) * 2;
      expect(p.truth).toEqual([hero.runs.factual.pos[k], hero.runs.factual.pos[k + 1]]);
      const ghost = [hero.runs.factual.ghost[k], hero.runs.factual.ghost[k + 1]];
      expect(p.believed).toEqual(p.j === picture.carrier ? p.truth : ghost);
    }
    expect(picture.players[picture.carrier].id).toBe("H8");
  });

  it("greys the players he had not seen lately, and the runner is not one: he looked", () => {
    const ages = hero.runs.factual.decision!.belief_age;
    expect(ids((p) => p.stale)).toEqual(
      Object.keys(ages)
        .filter((id) => ages[id] >= STALE_S)
        .sort(),
    );
    expect(ids((p) => p.stale)).toEqual(["A3", "A4", "H10", "H7"]);
    expect(ids((p) => p.stale)).not.toContain(hero.runnerId);
  });

  it("knows who was not where he pictured them, for the truth beat", () => {
    expect(ids((p) => p.off)).toEqual(["A3", "A4", "H10", "H7"]);
  });
});

describe("Your call: the reveal", () => {
  it("a forced call: its re-simulated outcome, the truth, what he did and why, compared", () => {
    const r = reveal("pass:H4");
    expect(r.same).toBe(false);
    expect(r.pick.action).toBe("pass:H4");
    expect(r.his.action).toBe("pass:H9");
    expect(texts(r.outcome.lines)).toEqual(["If H8 had passed to H4, H4 would have received it."]);
    expect(r.outcome.lines[0]).toMatchObject({ kinds: ["counterfactual"], source: "verified" });
    expect(texts(r.compare.lines)).toEqual([
      "That option would have been worth 0.10 less in expected threat than what he did.",
    ]);
    expect(r.truth.lines.map((l) => l.id)).toEqual(["L3", "L6"]); // his picture, he thought / it was
    expect(r.truth.moved).toEqual(["A3", "A4", "H10", "H7"]);
    expect(r.actual.lines.map((l) => l.id)).toEqual(["L2", "L4", "L5", "L7"]);
    expect(r.actual.lines.every((l) => l.source === "fixture")).toBe(true);
    expect(r.compare).toMatchObject({ yours: "Pass to H4", his: "Pass to H9" });
  });

  it("his own call: the outcome is what happened, and nothing is compared", () => {
    const r = reveal("pass:H9");
    expect(r.same).toBe(true);
    expect(r.outcome.title).toBe("You made his call: Pass to H9");
    expect(r.outcome.lines.map((l) => l.id)).toEqual(["L4"]); // H9 took the pass
    expect(r.actual.lines.map((l) => l.id)).toEqual(["L2", "L5", "L7"]);
    expect(r.compare.lines).toEqual([]);
  });

  it("shows each line once, and never a line the verifier withheld", () => {
    for (const pick of options.map((o) => o.action)) {
      const r = reveal(pick);
      const shown = [r.outcome, r.truth, r.actual, r.compare].flatMap((b) => b.lines);
      const ids = shown.map((l) => `${l.source}:${l.id}`);
      expect(new Set(ids).size).toBe(ids.length);
      const allowed = new Set(narration.lines.map((l) => l.id));
      for (const l of shown.filter((l) => l.source !== "verified")) expect(allowed).toContain(l.id);
    }
  });

  it("says no number that is not in a verified line", () => {
    for (const pick of options.map((o) => o.action)) {
      for (const label of labels(reveal(pick))) {
        expect(label.replace(/\b[HA]\d{1,2}\b/g, "")).not.toMatch(/\d/);
      }
    }
  });

  it("speaks the breakdown's language: the what-if answers in Chinese", () => {
    const r = reveal("pass:H4", narration, "zh");
    expect(texts(r.outcome.lines)).toEqual(["如果H8把球传给H4，H4会接到球。"]);
  });

  it("without the breakdown yet, still has the re-simulated outcome and the comparison", () => {
    const r = reveal("pass:H10", null);
    expect(texts(r.outcome.lines)).toEqual([
      "If H8 had passed to H10, A7 would have intercepted it.",
    ]);
    expect(r.compare.lines).toHaveLength(1);
    expect(r.truth.lines).toEqual([]);
    expect(r.actual.lines).toEqual([]);
    expect(r.truth.moved).toEqual(["A3", "A4", "H10", "H7"]);
  });

  it("refuses a call he did not have", () => {
    expect(
      revealOf({ hero, options, whatIfs, narration, language: "en", pick: "shot" }),
    ).toBeNull();
  });

  it("the pressure hero: the forced carry's outcome is the breakdown's counterfactual line", () => {
    const press = parseHero(pressureExport());
    const pm = heroMoment(press, PRESS_MOMENT);
    const res = pressureBreakdown();
    const checked = checkPayload(res.result.scripts[0].payload, {
      moment: pm.id,
      events: new Set(press.runs.factual.events.map((e) => e.id)),
      frames: () => press.runs.factual.frames,
    });
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const pressOptions = callOptions(press, null);
    const r = revealOf({
      hero: press,
      options: pressOptions,
      whatIfs: null,
      narration: checked.narration,
      language: "en",
      pick: "carry",
    })!;
    expect(texts(r.outcome.lines)).toEqual(["Had H8 kept the ball, he would have lost it."]);
    expect(texts(r.truth.lines)).toEqual([
      "H8 was under heavy pressure when he released the ball.",
    ]);
    expect(r.actual.lines).toEqual([]);
    expect(r.compare).toMatchObject({ yours: "Carry", his: "Pass to H9", lines: [] });
  });
});
