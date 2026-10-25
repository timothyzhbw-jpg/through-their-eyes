// The coach's example (SPEC 3.6, "Teaching"): the coach's sequence (start view, look left,
// drop-back, look right, half-turn, forward pass), and the product owner's rule that every look
// visibly brings something new that opens or closes options. The committed file is
// sim.export.export_steps("pro_scan", 116) (tests/test_steps.py keeps it current); its hero export
// is served by the API, so the parse is checked on the scan hero's export with the teaching fields
// added (teaching.fixture.ts), and the committed file is checked as JSON with the same functions
// the card uses.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import coachJson from "../../public/data/steps_pro_scan_seed116.json";
import stepsJson from "../../public/data/steps_seed3.json";
import { parseHero } from "../data/hero";
import { shortName } from "../data/roster";
import { heroMoment } from "../plan/moment";
import {
  COACH_LABEL,
  COACH_MATCH,
  coachHref,
  isCoachExample,
  TEACHING_NOTE,
  TEACHING_WORDS,
} from "./coach";
import {
  BEAT_TITLES,
  NEW_M,
  onBoard,
  optionChanges,
  parseSteps,
  STEP_FILES,
  stepTitle,
  type BeatStep,
  type LookStep,
  type NewsRow,
  type Picture,
  type Rule,
  type StartStep,
} from "./steps";
import {
  beatThinking,
  beatTurn,
  lookStory,
  lookThinking,
  newsLines,
  optionLines,
  pictureView,
  startThinking,
  tickLabel,
  timeline,
  type PersonOf,
} from "./story";
import { teachingFile } from "./teaching.fixture";

const hero = parseHero(raw);
const moment = heroMoment(hero);

/** Names for the coach's file without its hero export: shirt number from the id, as the sim
 * numbers its players (sim/scenarios/base.py `make_player`). */
const who: PersonOf = (id) => ({
  id,
  number: Number(id.slice(1)),
  name: shortName(id),
  team: id.startsWith("H") ? 0 : 1,
});

const digits = (text: string) => text.match(/\d+(\.\d+)?/g) ?? [];

describe("the coach's example: where it opens", () => {
  it("opens the scan story on pro_scan seed 116, by link", () => {
    expect(COACH_MATCH).toBe("pro_scan-116");
    expect(coachHref("/")).toBe("/?play=steps&match=pro_scan-116");
    expect(COACH_LABEL).toBe("Coach's example: look left, look right, then the half-turn");
    expect(STEP_FILES[COACH_MATCH]).toBe("steps_pro_scan_seed116.json");
    expect(isCoachExample("pro_scan", 116)).toBe(true);
    expect(isCoachExample("blind_side_run", 3)).toBe(false);
  });

  it("says the look times are scripted, in the docs' words", () => {
    expect(TEACHING_NOTE).toBe(
      "The look times are scripted for teaching; what he sees, believes and does follows the sim.",
    );
  });
});

interface CoachRun {
  reception: number;
  decision: number;
  start: { frame: number; options: Picture["options"] };
  steps: {
    id: string;
    start: number;
    frame: number;
    direction: string;
    missing: boolean;
    lines: string[];
    picture: Picture | null;
  }[];
  beats: {
    id: "drop_back" | "half_turn";
    frame: number;
    start: number;
    end: number;
    happened: boolean;
    lines: string[];
    picture: Picture;
    rule: Rule;
  }[];
  final: { frame: number; chosen: string };
  answers: { en: { lines: { id: string; text: string }[] } };
}

const coach = coachJson as unknown as {
  version: number;
  teaching: boolean;
  hero: string;
  runs: { factual: CoachRun; counterfactual: CoachRun };
};

describe("the committed teaching file: the coach's sequence", () => {
  const fac = coach.runs.factual;
  const cf = coach.runs.counterfactual;

  it("looks left, then right, and nothing else; without the right look that one is missing", () => {
    expect(coach.version).toBe(2);
    expect(coach.teaching).toBe(true);
    expect(coach.hero).toBe("H8");
    expect(fac.steps.map((s) => s.direction)).toEqual(["L", "R"]);
    expect(cf.steps.map((s) => [s.direction, s.missing])).toEqual([
      ["L", false],
      ["R", true],
    ]);
  });

  it("runs start view → left look → drop back → right look → half-turn → forward pass", () => {
    const [left, right] = fac.steps;
    const [drop, turn] = fac.beats;
    expect([drop.id, turn.id]).toEqual(["drop_back", "half_turn"]);
    const order = [fac.start.frame, left.frame, drop.frame, right.frame, turn.frame];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(turn.frame).toBe(fac.reception);
    expect(fac.final.frame).toBeGreaterThanOrEqual(fac.reception);
    expect(fac.final.chosen).toBe("pass:H9"); // forward, to the striker
    expect([drop.happened, turn.happened]).toEqual([true, true]);
    // Without the right look he still drops back, but receives square, and does not play forward.
    expect(cf.beats.map((b) => [b.id, b.happened])).toEqual([
      ["drop_back", true],
      ["half_turn", false],
    ]);
    expect(cf.final.chosen).not.toBe("pass:H9");
    // Every beat line is a verified line, its digits from slots.
    for (const run of [fac, cf]) {
      const said = new Set(run.answers.en.lines.map((l) => l.id));
      for (const b of run.beats) for (const id of b.lines) expect(said.has(id)).toBe(true);
    }
    const text = (id: string) => fac.answers.en.lines.find((l) => l.id === id)!.text;
    expect(text("drop_back")).toMatch(/^After his look to the left, .+ drops [\d.]+ m back/);
    expect(text("half_turn")).toMatch(/side-on, on the half-turn: his body is \d+° open/);
  });

  it("drops back on what the left look showed, and turns on what the right look showed", () => {
    const [left, right] = fac.steps;
    const [drop, turn] = fac.beats;
    const top = (p: Picture | null) => p!.news!.find((n) => n.moved > NEW_M)!;
    expect(top(left.picture).id).toBe(drop.rule.nearest); // A6, closer than he thought
    expect(drop.rule.near).toContain(drop.rule.nearest);
    expect(drop.rule.nearest_m).toBeLessThanOrEqual(drop.rule.radius_m);
    expect(drop.rule.after_m!).toBeGreaterThan(drop.rule.nearest_m);
    expect(top(right.picture).id).toBe(turn.rule.nearest); // A5, stepping out to press
    expect(turn.rule.side).not.toBe(0);
    expect(cf.beats[1].rule.side).toBe(0); // without the look, he believes nobody is near
  });
});

describe("every look brings something new that opens or closes options", () => {
  for (const name of ["factual", "counterfactual"] as const) {
    const run = coach.runs[name];
    it(`${name}: each look's diff is its data, and it is told`, () => {
      for (const s of run.steps) {
        if (s.missing) {
          expect(s.picture).toBeNull();
          continue;
        }
        const p = s.picture!;
        // The diff the card marks (↑ / ↓) is the bundle's own, recomputed.
        expect(optionChanges(p.before, p.options)).toEqual([p.opened, p.closed]);
        const lines = optionLines(p.options, p.before, p.opened, p.closed, who, true);
        expect(lines.filter((l) => l.mark === "↑").map((l) => l.action)).toEqual(p.opened);
        expect(lines.filter((l) => l.mark === "↓").map((l) => l.action)).toEqual(p.closed);
        // At least one new item, or the explicit "nothing new" line.
        const news = newsLines(p.news!, who);
        const think = lookThinking(s.direction as "L" | "R", p, who, true);
        if (news.length) expect(news.length).toBeGreaterThan(0);
        else expect(think).toContain("Nothing new");
        // The coach's looks do both: news, and an option opened or closed.
        expect(p.news!.some((n: NewsRow) => n.moved > NEW_M)).toBe(true);
        expect(p.opened.length + p.closed.length).toBeGreaterThan(0);
        expect(think).toMatch(/So .+ is (on|off) \(\d+% → \d+%\)/);
        // Every digit in the line is a value of the data (or a shirt number).
        const values = new Set([
          ...p.news!.flatMap((n) => [n.before, n.after, n.moved].map((m) => m.toFixed(1))),
          ...[...p.before, ...p.options].map((o) => String(Math.round(o.p * 100))),
          ...p.news!.map((n) => String(Number(n.id.slice(1)))),
          ...[...p.before, ...p.options].map((o) => o.action.slice(6)),
        ]);
        for (const d of digits(think)) expect(values.has(d)).toBe(true);
      }
      for (const b of run.beats) {
        expect(optionChanges(b.picture.before, b.picture.options)).toEqual([
          b.picture.opened,
          b.picture.closed,
        ]);
      }
    });
  }

  it("the left look: the No. 6 closer than he thought, and options change", () => {
    const left = coach.runs.factual.steps[0].picture!;
    const think = lookThinking("L", left, who, true);
    expect(think).toMatch(/^Checking my left\. #6 .+ is [\d.]+ m from me, not [\d.]+ m\. So /);
  });

  it("the right look: the No. 5 closing, turning is off and the pass forward is on", () => {
    const right = coach.runs.factual.steps[1].picture!;
    expect(right.opened).toContain("pass:H9");
    expect(right.closed).toContain("carry");
    const think = lookThinking("R", right, who, true);
    expect(think).toMatch(/^Checking my right\. #5 .+ is [\d.]+ m from me, not [\d.]+ m\./);
    expect(think).toContain("turn and carry is off");
    expect(think).toMatch(/pass to #9 .+ is on/);
  });

  it("the start view lists his options before any look; the beats say the rules' reasons", () => {
    const fac = coach.runs.factual;
    expect(fac.start.options.length).toBeGreaterThan(1);
    const start = startThinking("H4", fac.start.options, who);
    expect(start).toMatch(/^I face the ball\. #4 .+ has the ball/);
    expect(start).toContain(`(${Math.round(fac.start.options[0].p * 100)}%)`);
    const [drop, turn] = fac.beats;
    const beat = (b: CoachRun["beats"][number]) =>
      ({ ...b, kind: "beat", vel: new Float32Array() }) as BeatStep;
    expect(beatThinking(beat(drop), who, null)).toMatch(
      new RegExp(
        `^#6 .+ will be ${drop.rule.nearest_m.toFixed(1)} m from me when the ball comes: too tight ` +
          `to take it on my spot\\. I drop back ${drop.rule.moved_m!.toFixed(1)} m`,
      ),
    );
    expect(beatThinking(beat(turn), who, 70)).toMatch(
      /^#5 .+ will be [\d.]+ m from me as the ball arrives: I open my body 70° away from him/,
    );
    const square = coach.runs.counterfactual.beats[1];
    expect(beatThinking(beat(square), who, null)).toMatch(
      /^Nobody I know of will be within 6\.0 m as the ball arrives .+ I take it square\./,
    );
  });
});

describe("a teaching file in the scan story", () => {
  const steps = parseSteps(teachingFile(stepsJson), hero, moment);
  const fac = steps.runs.factual;

  it("opens on his start view, then his look, the beats in time order and his decision", () => {
    expect(steps.teaching).toBe(true);
    expect(fac.steps.map((s) => [s.kind, s.id])).toEqual([
      ["start", "start"],
      ["look", "scan:H8:0050"],
      ["beat", "drop_back"],
      ["beat", "half_turn"],
      ["decision", "decision"],
    ]);
    const start = fac.steps[0] as StartStep;
    expect(stepTitle(start)).toBe("Facing the ball");
    expect(onBoard(start)).toBe(false);
    const [drop, turn] = fac.steps.slice(2, 4) as BeatStep[];
    expect(stepTitle(drop)).toBe("He drops back");
    expect(stepTitle(turn)).toBe("On the half-turn");
    expect(onBoard(drop)).toBe(true); // told on the board, as the decision
    expect(onBoard(turn)).toBe(false); // through his eyes
    const square = parseSteps(teachingFile(stepsJson, false), hero, moment).runs.factual
      .steps[3] as BeatStep;
    expect(stepTitle(square)).toBe(BEAT_TITLES.half_turn[1]);
    expect(beatTurn(hero, hero.runs.factual, square)).toBeNull(); // square: no arc
    expect(beatTurn(hero, hero.runs.factual, drop)).toBeNull();
    expect(beatTurn(hero, hero.runs.factual, turn)?.frame).toBe(turn.frame);
    // An ordinary file has no start step: it opens on his first look.
    expect(parseSteps(stepsJson, hero, moment).runs.factual.steps[0].kind).toBe("look");
  });

  it("puts a picture on every frozen step but the decision", () => {
    for (const s of fac.steps) {
      const view = pictureView(hero, hero.runs.factual, s, true);
      if (s.kind === "decision") expect(view).toBeNull();
      else expect(view!.thinking.length).toBeGreaterThan(0);
    }
  });

  it("names a labelled look as the coach does, not from his head against his body", () => {
    const look = fac.steps[1] as LookStep;
    const story = lookStory(hero, hero.runs.factual, look, 1)!;
    expect(story.direction).toBe("L");
    expect(story.words).toBe(TEACHING_WORDS.L);
    const tick = timeline(hero, hero.runs.factual, fac.steps).ticks[0];
    expect(tick.label).toBe("L");
    expect(tickLabel(tick, 1)).toBe("Look 1, over his left shoulder");
  });

  it("refuses a stale file: a beat out of place, an unknown beat, a diff that is not its data", () => {
    const off = teachingFile(stepsJson);
    off.runs.factual.beats[1].frame += 1;
    expect(() => parseSteps(off, hero, moment)).toThrow(/not at his reception/);
    const early = teachingFile(stepsJson);
    early.runs.factual.beats[0].frame += 1;
    expect(() => parseSteps(early, hero, moment)).toThrow(/not when its rule acted/);
    const odd = teachingFile(stepsJson);
    odd.runs.factual.beats[0].id = "first_touch";
    expect(() => parseSteps(odd, hero, moment)).toThrow(/unknown beat/);
    const lied = teachingFile(stepsJson);
    lied.runs.factual.steps[0].picture.opened = [];
    expect(() => parseSteps(lied, hero, moment)).toThrow(/not its options' diff/);
  });
});
