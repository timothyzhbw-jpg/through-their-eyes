// Academy drill (SPEC 7): the result is the grid's. For every look the viewer can end up with, the
// calls, the lines and his picture come straight from the bundled look file (re-simulated and
// verified ahead of time), never from new arithmetic.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import lookJson from "../../public/data/look_seed3.json";
import { parseHero } from "../data/hero";
import { heroMoment } from "../plan/moment";
import { cellAt, parseLooks } from "../takeeyes/looks";
import { pictureOf } from "../yourcall/picture";
import { whyOf } from "../yourcall/why";
import { callHeroOf, drillOptions, drillResult, lookWords, pictureWords } from "./result";

const hero = parseHero(raw);
const looks = parseLooks(lookJson, hero, heroMoment(hero));
const file = lookJson as unknown as {
  factual: { chosen: string };
  no_look: { decision: { chosen: string; belief_age: Record<string, number> }; answers: never };
  cells: {
    frame: number;
    offset: number;
    id: string;
    decision: { chosen: string; options: { action: string }[] };
    answers: Record<"en" | "zh", { lines: { text: string; claims: string[] }[] }>;
  }[];
};
const entries = [looks.noLook, ...looks.cells.map((c) => c.entry!)];
const rawOf = (id: string) => file.cells.find((c) => c.id === id);

describe("the drill's result", () => {
  it("is the grid's for every look and every call: calls and verified lines as bundled", () => {
    for (const entry of entries) {
      const callHero = callHeroOf(hero, looks, entry);
      for (const option of drillOptions(callHero)) {
        for (const language of ["en", "zh"] as const) {
          const r = drillResult({ hero, looks, entry, pick: option.action, language });
          const cell = rawOf(entry.id);
          expect(r.simCall).toBe(cell ? cell.decision.chosen : file.no_look.decision.chosen);
          expect(r.hisCall).toBe(file.factual.chosen);
          expect(r.noLookCall).toBe(file.no_look.decision.chosen);
          expect(r.pick).toBe(option.action);
          expect(r.sameAsHis).toBe(option.action === file.factual.chosen);
          if (cell) {
            expect(r.narration!.lines.map((l) => l.text)).toEqual(
              cell.answers[language].lines.map((l) => l.text),
            );
          }
        }
      }
    }
  });

  it("names whom the look brought into sight with its verified line, and airs the rest", () => {
    for (const entry of entries) {
      const r = drillResult({ hero, looks, entry, pick: "carry", language: "en" });
      const lines = entry.answers.en!.lines;
      expect(r.saw).toBe(lines.find((l) => l.claims.includes("look_saw")) ?? null);
      expect([r.saw, ...r.lines].filter(Boolean).length).toBe(
        lines.filter((l) => !l.claims.includes("look_when")).length,
      );
      if (entry.look) expect(r.saw?.text, entry.id).toMatch(/into his sight/);
      else expect(r.saw).toBeNull();
    }
  });

  it("says when and where in the grid's own values", () => {
    const at = (frame: number, offset: number) => cellAt(looks, frame, offset)!.entry!;
    expect(lookWords(looks, at(40, -150), hero.dt)).toBe(
      "1.2 s before the ball, 150° over his right shoulder",
    );
    expect(lookWords(looks, at(70, 90), hero.dt)).toBe("as the ball arrived, 90° to his left");
    expect(lookWords(looks, looks.noLook, hero.dt)).toBe("No scan");
    expect(
      drillResult({ hero, looks, entry: at(70, 90), pick: "carry", language: "en" }).late,
    ).toBe(true);
  });

  it("tells whether the runner was fresh in the picture: with the look over the shoulder, not without", () => {
    const over = cellAt(looks, 50, -150)!.entry!;
    const r = drillResult({ hero, looks, entry: over, pick: "pass:H9", language: "en" });
    expect(r.runner).toEqual({ id: "H9", fresh: true });
    expect(r.simCall).toBe("pass:H9");
    const none = drillResult({ hero, looks, entry: looks.noLook, pick: "pass:H9", language: "en" });
    expect(none.runner).toEqual({ id: "H9", fresh: false });
    expect(none.simCall).toBe("pass:H4");
    expect(r.hisLooks).toEqual(["Over his right shoulder"]);
  });
});

describe("the picture to call from", () => {
  it("is Your call's picture of the look's belief at his decision", () => {
    const entry = cellAt(looks, 50, -150)!.entry!;
    const callHero = callHeroOf(hero, looks, entry);
    const picture = pictureOf(callHero)!;
    const n = hero.n;
    const f = looks.decisionFrame;
    expect(picture.frame).toBe(f);
    for (const p of picture.players) {
      if (p.j === hero.hero) continue;
      const k = ((f - looks.window[0]) * n + p.j) * 2;
      expect(p.believed[0]).toBeCloseTo(entry.ghost[k], 6);
      expect(p.believed[1]).toBeCloseTo(entry.ghost[k + 1], 6);
      expect(p.stale).toBe((entry.decision.belief_age[p.id] ?? 0) >= 1.5);
    }
    // with no look, the runner is a grey ghost of an old picture
    const blind = pictureOf(callHeroOf(hero, looks, looks.noLook))!;
    expect(blind.players.find((p) => p.id === "H9")!.stale).toBe(true);
  });

  it("offers every option of the look's decision, none marked as his", () => {
    for (const entry of entries) {
      const options = drillOptions(callHeroOf(hero, looks, entry));
      expect(options.map((o) => o.action).sort()).toEqual(
        entry.decision.options.map((o) => o.action).sort(),
      );
      expect(options.some((o) => o.factual)).toBe(false);
    }
  });

  it("explains a call against the look's own picture, as Your call does", () => {
    const entry = looks.noLook;
    const callHero = callHeroOf(hero, looks, entry);
    const why = whyOf(callHero, drillOptions(callHero), "pass:H9")!;
    expect(why.receiver).toEqual({ id: "H9", seen: false });
    expect(why.picture).toMatch(/looked more promising than your call/);
  });
});

describe("the call in words", () => {
  it("rates the viewer's call on the look's picture, with no number", () => {
    const blind = callHeroOf(hero, looks, looks.noLook);
    expect(pictureWords(blind, "pass:H4")).toBe("With your look he makes this call too.");
    expect(pictureWords(blind, "pass:H9")).toBe(
      "On your picture the pass to K. Annersley looked more promising, and with your look he goes for it.",
    );
    const over = callHeroOf(hero, looks, cellAt(looks, 50, -150)!.entry!);
    expect(pictureWords(over, "pass:H9")).toBe("With your look he makes this call too.");
    for (const entry of entries) {
      const callHero = callHeroOf(hero, looks, entry);
      for (const o of drillOptions(callHero))
        expect(pictureWords(callHero, o.action)).not.toMatch(/\d/);
    }
  });

  it("says when the receiver of a pass was not fresh in the picture", () => {
    const blind = callHeroOf(hero, looks, looks.noLook);
    const stale = Object.entries(looks.noLook.decision.belief_age).find(
      ([id, age]) => age >= 1.5 && id.startsWith("H") && id !== "H9" && id !== "H8",
    )![0];
    expect(pictureWords(blind, `pass:${stale}`)).toMatch(/^You had not seen .+ lately/);
  });
});
