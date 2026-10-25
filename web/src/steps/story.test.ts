// The scan step-through as a coaching story (SPEC 7): the direction of a look against his body, who
// came into view, how his picture changed, the thinking caption, the decision's link to the looks,
// the half-turn rule (both branches) and the honest scan count. Every sentence is a template with
// data slots: the tests check that no digit in one is missing from the data it was filled from.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import stepsJson from "../../public/data/steps_seed3.json";
import { parseHero, type Hero } from "../data/hero";
import { heroMoment } from "../plan/moment";
import { parseSteps, type LookStep, type OptionRow } from "./steps";
import {
  ARC_RADIUS_M,
  BEHIND_MIN,
  classifyDirection,
  decisionStory,
  fewScansLine,
  FORWARD_MAX,
  halfTurn,
  halfTurnArc,
  HALF_TURN_CAPTION,
  lookStory,
  optionLines,
  optionsClause,
  personLookup,
  PUBLISHED_SCANS,
  scanDirection,
  scansBeforeReceiving,
  SHIFT,
  thinkingCaption,
  timeline,
  type OptionLine,
} from "./story";

const hero = parseHero(raw);
const steps = parseSteps(stepsJson, hero, heroMoment(hero));
const fac = steps.runs.factual.steps;
const cf = steps.runs.counterfactual.steps;
const look = fac[0] as LookStep;
const deg = (d: number) => (d * Math.PI) / 180;

/** Every number in a sentence, as written ("#9" is 9, "4.8 m" is 4.8). */
const numbersIn = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];

/** The numbers a caption may hold, worked out from the raw export: shirt numbers, belief errors to
 * a decimal, the decision record's own figures, counts. Independent of story.ts. */
function allowedFromData(name: "factual" | "counterfactual", frames: number[]) {
  const run = raw.runs[name];
  const ok = new Set<string>(raw.players.map((p) => String(p.number)));
  const ids = raw.players.map((p) => p.id);
  for (const f of frames)
    for (let j = 0; j < ids.length; j++) {
      const e =
        Math.hypot(
          run.ghost[f][2 * j] - run.pos[f][2 * j],
          run.ghost[f][2 * j + 1] - run.pos[f][2 * j + 1],
        ) / 1000;
      ok.add(e.toFixed(1));
    }
  const d = run.decision!;
  for (const v of Object.values(d.belief_error)) ok.add(v.toFixed(1));
  for (const v of Object.values(d.belief_age)) ok.add(v.toFixed(1));
  for (const o of d.options) ok.add(String(Math.round(o.prob * 100)));
  for (let k = 0; k <= 22; k++) ok.add(String(k)); // counts and look numbers
  return ok;
}

describe("an option's change", () => {
  const who = personLookup(hero);
  const row = (action: string, p: number): OptionRow => ({ action, p, prob: 0, value: p });

  it("marks rises and falls at exactly SHIFT, but not below it, and keeps marked rows", () => {
    const before = [
      row("carry", 0.25),
      row("pass:H9", 0.45),
      row("pass:H4", 0.25),
      row("pass:H7", 0.45),
      row("pass:H6", 0.45),
      row("pass:H5", 0.5),
    ];
    const options = [
      row("carry", 0.25 + SHIFT),
      row("pass:H9", 0.45 - SHIFT),
      row("pass:H4", 0.25 + SHIFT - 0.001),
      row("pass:H7", 0.45 - SHIFT + 0.001),
      row("pass:H6", 0.45 + SHIFT),
      row("pass:H5", 0.5),
    ];
    const lines = optionLines(options, before, [], [], who, true);
    expect(lines.map((l) => [l.action, l.mark])).toEqual([
      ["carry", "↗"],
      ["pass:H9", "↘"],
      ["pass:H4", ""],
      ["pass:H7", ""],
      ["pass:H6", "↗"],
    ]);
  });

  it("keeps opened and closed instead of rise and fall marks", () => {
    const options = [row("carry", 0.95), row("pass:H9", 0.05)];
    const before = [row("carry", 0.25), row("pass:H9", 0.85)];
    const lines = optionLines(options, before, ["carry"], ["pass:H9"], who);
    expect(lines.map((l) => l.mark)).toEqual(["↑", "↓"]);
  });

  it("does not mark a rise or fall without a baseline for that action", () => {
    const options = [row("carry", 0.95)];
    expect(optionLines(options, null, [], [], who)[0]!.mark).toBe("");
    expect(optionLines(options, [], [], [], who)[0]!.mark).toBe("");
  });

  it("orders negative then positive changes by size, with two of each and the remainder", () => {
    const line = (
      label: string,
      before: number,
      now: number,
      mark: OptionLine["mark"],
    ): OptionLine => ({ action: label, label, before, now, mark });
    const lines = [
      line("Turn and carry", 0.79, 0.57, "↘"),
      line("Pass to #9", 0.53, 0.85, "↗"),
      line("Pass to #7", 0.5, 0.4, "↘"),
      line("Back pass to #4", 0.6, 0.2, "↓"),
      line("Pass to #6", 0.2, 0.51, "↑"),
      line("Pass to #5", 0.2, 0.4, "↗"),
    ];
    expect(optionsClause(lines, "So")).toBe(
      "So back pass to #4 is off (60% → 20%), turn and carry falls (79% → 57%), " +
        "pass to #9 rises (53% → 85%), pass to #6 is on (20% → 51%), and 2 more.",
    );
    expect(optionsClause([], "So")).toBe("No option opens, closes or moves much.");
  });
});

describe("direction against his body", () => {
  it("classifies forward, left, right and behind from the head yaw relative to the body", () => {
    expect(classifyDirection(0)).toBe("F");
    expect(classifyDirection(FORWARD_MAX - 0.01)).toBe("F");
    expect(classifyDirection(-(FORWARD_MAX - 0.01))).toBe("F");
    expect(classifyDirection(deg(90))).toBe("L"); // counter-clockwise is his left
    expect(classifyDirection(deg(-90))).toBe("R");
    expect(classifyDirection(FORWARD_MAX + 0.001)).toBe("L");
    expect(classifyDirection(BEHIND_MIN - 0.01)).toBe("L");
    expect(classifyDirection(BEHIND_MIN + 0.001)).toBe("B");
    expect(classifyDirection(deg(-170))).toBe("B");
    expect(classifyDirection(deg(180))).toBe("B");
    expect(classifyDirection(deg(350))).toBe("F"); // wraps
  });

  it("reads the hero's key scan off the head and body yaw in the export", () => {
    const d = scanDirection(hero, hero.runs.factual, look.frame);
    const j = hero.hero;
    const f = look.frame;
    const rel =
      (((raw.runs.factual.head[f][j] - raw.runs.factual.body[f][j]) / 1e4) * 180) / Math.PI;
    expect(d.degrees).toBe(Math.round(Math.abs(((rel + 540) % 360) - 180)));
    expect(d.code).toBe("B"); // over the right shoulder: past 120° from his body
    expect(d.rel).toBeLessThan(0); // clockwise: to his right
  });
});

describe("a look's story", () => {
  const story = lookStory(hero, hero.runs.factual, look, 1)!;

  it("names who came into view by shirt number and name", () => {
    expect(story.inView.map((p) => p.id)).toEqual(look.sight);
    const nine = story.inView.find((p) => p.id === "H9")!;
    expect(nine.number).toBe(9);
    expect(nine.name).toMatch(/Varnhall/);
  });

  it("finds the pictures the look corrected, from the belief ghosts", () => {
    expect(story.changes.length).toBeGreaterThan(0);
    for (const c of story.changes) {
      expect(c.after).toBeLessThanOrEqual(1);
      expect(c.before - c.after).toBeGreaterThanOrEqual(1);
    }
    const gains = story.changes.map((c) => c.before - c.after);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    expect(story.changes.map((c) => c.person.id)).toContain("H9");
  });

  it("has no story for a look the run does not take", () => {
    expect(lookStory(hero, hero.runs.counterfactual, cf[0] as LookStep, 1)).toBeNull();
  });

  it("captions it from a template, and every digit is in the data", () => {
    expect(story.thinking).toMatch(/^Checking behind me\./);
    expect(story.thinking).toMatch(/now I know where he is/);
    const ok = allowedFromData("factual", [look.start, look.end]);
    for (const n of numbersIn(story.thinking))
      expect(ok.has(n), `${n} in "${story.thinking}"`).toBe(true);
  });

  it("falls back to words with no digits when nothing moved or nobody came into view", () => {
    const quiet = thinkingCaption("L", story.inView, []);
    expect(quiet).toBe("Checking my left. Everyone I can see is where I thought.");
    expect(thinkingCaption("F", [], [])).toBe("Checking ahead. Nobody comes into view.");
    expect(numbersIn(quiet)).toEqual([]);
  });

  it("says how many more it corrected, as a count from the data", () => {
    const many = Array.from({ length: 4 }, (_, k) => ({
      person: story.inView[k],
      before: 3 + k,
      after: 0,
    }));
    expect(thinkingCaption("R", story.inView, many)).toMatch(/2 more corrected\.$/);
  });
});

describe("the decision, linked to the looks", () => {
  it("says what he chose and what the looks showed of it", () => {
    const s = decisionStory(hero, hero.runs.factual, fac)!;
    expect(s.lines[0]).toBe("He chose: Pass to #9 N. Varnhall.");
    expect(s.lines[1]).toMatch(/^Look 1 brought #9 N\. Varnhall into view\./);
    expect(s.lines[2]).toMatch(/of its weight\.$/);
  });

  it("says so when he never looked at the man he picked", () => {
    const s = decisionStory(hero, hero.runs.counterfactual, cf)!;
    expect(s.lines[0]).toBe("He chose: Pass to #4 K. Annersley.");
    expect(s.lines[1]).toMatch(/^He never looked at #4 K\. Annersley before deciding\./);
  });

  it("holds no digit that is not in the decision record or the roster", () => {
    for (const [name, list] of [
      ["factual", fac],
      ["counterfactual", cf],
    ] as const) {
      const s = decisionStory(hero, hero.runs[name], list)!;
      const ok = allowedFromData(name, []);
      for (const line of s.lines)
        for (const n of numbersIn(line)) expect(ok.has(n), `${n} in "${line}"`).toBe(true);
    }
  });
});

describe("scans before receiving", () => {
  it("counts the hero's scans in the 10 s before the ball reaches him", () => {
    expect(scansBeforeReceiving(hero, hero.runs.factual)).toBe(1);
    expect(scansBeforeReceiving(hero, hero.runs.counterfactual)).toBe(0);
  });

  it("adds the honest line only when he made fewer than players average", () => {
    expect(fewScansLine(1)).toBe(
      `Players average about ${PUBLISHED_SCANS} scans in the 10 s before receiving; he made 1.`,
    );
    expect(fewScansLine(0)).toMatch(/he made 0\.$/);
    expect(fewScansLine(PUBLISHED_SCANS)).toBeNull();
    expect(fewScansLine(5)).toBeNull();
  });

  it("takes the average from the realism report's published value", () => {
    const report = readFileSync(
      new URL("../../../eval/reports/realism.md", import.meta.url),
      "utf8",
    );
    const row = report
      .split("\n")
      .find((l) => l.startsWith("| Scans in the 10 s before receiving"))!;
    expect(row).toBeDefined();
    const published = Number(
      /(\d+(?:\.\d+)?) ± [\d.]+\s*\|\s*[\d.]+ to [\d.]+ \(mean/.exec(row)![1],
    );
    expect(published).toBe(3.0); // Jordet et al. (2020), as printed in the report
    expect(Math.round(published)).toBe(PUBLISHED_SCANS);
  });
});

describe("the half-turn", () => {
  // The hero receives with his back to the pass (body 180°), the pass going the other way: no half-turn.
  const reception = 70;
  const j = hero.hero;
  const withBody = (bodyRad: number, target?: [number, number]): Hero => {
    const copy = JSON.parse(JSON.stringify(raw));
    copy.runs.factual.body[reception][j] = Math.round(bodyRad * 1e4);
    if (target) {
      const d = copy.runs.factual.decision;
      d.options.find((o: { action: string }) => o.action === d.chosen).target = target;
    }
    return parseHero(copy);
  };

  it("says nothing when the data does not show him receiving side-on", () => {
    expect(halfTurn(hero, hero.runs.factual)).toBeNull();
    expect(halfTurn(hero, hero.runs.counterfactual)).toBeNull();
    // facing the ball (0° to it) or turned right away from it (180°), even if he faces the play
    expect(halfTurn(withBody(deg(180), [2, 30]), hero.runs.factual)).toBeNull();
    expect(halfTurn(withBody(deg(150), [2, 30]), hero.runs.factual)).toBeNull();
  });

  it("says nothing when he is side-on to the ball but turned away from his next action", () => {
    const h = withBody(deg(60), [2, -30]); // action to the south, body to the north-east
    expect(halfTurn(h, h.runs.factual)).toBeNull();
  });

  it("captions a half-turn when his body is open to the ball and to the next action", () => {
    // The ball comes from the west (bearing 180°), his pass goes north (90°), his body faces 60°.
    const h = withBody(deg(60), [2, 30]);
    const t = halfTurn(h, h.runs.factual)!;
    expect(t).not.toBeNull();
    expect(t.caption).toBe(HALF_TURN_CAPTION);
    expect(t.frame).toBe(reception);
    expect(t.ballDeg).toBeGreaterThanOrEqual(110);
    expect(t.ballDeg).toBeLessThanOrEqual(130);
    expect(t.actionDeg).toBeLessThanOrEqual(35);
    expect(t.goalDeg).toBeGreaterThan(0);
    for (const n of numbersIn(t.detail))
      expect([t.ballDeg, t.actionDeg, t.goalDeg].map(String)).toContain(n);
  });

  it("draws a thin arc from the incoming ball to his body's facing", () => {
    const h = withBody(deg(60), [2, 30]);
    const t = halfTurn(h, h.runs.factual)!;
    const { arc, tick } = halfTurnArc(t);
    for (const p of arc)
      expect(Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1])).toBeCloseTo(ARC_RADIUS_M, 6);
    const ang = (p: number[]) => Math.atan2(p[1] - t.pos[1], p[0] - t.pos[0]);
    expect(ang(arc[0])).toBeCloseTo(t.toBall, 6);
    expect(Math.cos(ang(arc.at(-1)!) - t.body)).toBeCloseTo(1, 6);
    expect(ang(tick[1])).toBeCloseTo(t.body, 6);
  });
});

describe("the scan timeline", () => {
  it("has a tick per scan, labelled by direction, and the decision", () => {
    const tl = timeline(hero, hero.runs.factual, fac);
    expect(tl.ticks.map((t) => [t.stepId, t.label, t.stepIndex])).toEqual([
      ["scan:H8:0050", "B", 0],
    ]);
    expect(tl.ticks[0].frac).toBeCloseTo((look.frame - tl.from) / (tl.to - tl.from), 9);
    expect(tl.decision).toBe(1);
    expect(tl.reception).toBeLessThan(1);
    expect(tl.reception).toBeGreaterThan(tl.ticks[0].frac);
  });

  it("marks a look the run does not take with a dash, not a direction", () => {
    const tl = timeline(hero, hero.runs.counterfactual, cf);
    expect(tl.ticks.map((t) => [t.label, t.missing])).toEqual([["–", true]]);
  });
});
