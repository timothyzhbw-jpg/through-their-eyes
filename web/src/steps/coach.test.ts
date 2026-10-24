// The coach's example (SPEC 3.6, "Teaching"): the teaching bundle's labelled looks and its two
// frozen beats, read the way the scan story reads every bundle. The committed file is
// sim.export.export_steps("pro_scan", 126) (tests/test_steps.py keeps it current); its hero export
// is served by the API, so the parse is checked here on the scan hero's export with the teaching
// fields added, and the committed file's own shape is checked as JSON.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import coachJson from "../../public/data/steps_pro_scan_seed126.json";
import stepsJson from "../../public/data/steps_seed3.json";
import { parseHero } from "../data/hero";
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
  onBoard,
  parseSteps,
  receptionOf,
  STEP_FILES,
  stepTitle,
  type BeatStep,
  type LookStep,
} from "./steps";
import { beatTurn, lookStory, tickLabel, timeline } from "./story";

const hero = parseHero(raw);
const moment = heroMoment(hero);

/** The scan hero's bundle as a teaching file: its one look labelled "F", and both beats. */
function teaching(happened = true) {
  const json = JSON.parse(JSON.stringify(stepsJson));
  json.teaching = true;
  for (const name of ["factual", "counterfactual"] as const) {
    const run = json.runs[name];
    for (const s of run.steps) s.direction = "F";
    const frame = receptionOf(hero, hero.runs[name]);
    const vel = run.final.vel;
    run.beats = [
      { id: "drop_back", frame, start: frame - 30, happened, lines: [], vel },
      { id: "half_turn", frame, start: frame, happened, lines: [], vel },
    ];
  }
  return json;
}

describe("the coach's example: where it opens", () => {
  it("opens the scan story on pro_scan seed 126, by link", () => {
    expect(COACH_MATCH).toBe("pro_scan-126");
    expect(coachHref("/")).toBe("/?play=steps&match=pro_scan-126");
    expect(COACH_LABEL).toBe("Coach's example: three looks, then the half-turn");
    expect(STEP_FILES[COACH_MATCH]).toBe("steps_pro_scan_seed126.json");
    expect(isCoachExample("pro_scan", 126)).toBe(true);
    expect(isCoachExample("blind_side_run", 3)).toBe(false);
  });

  it("says the look times are scripted, in the docs' words", () => {
    expect(TEACHING_NOTE).toBe(
      "The look times are scripted for teaching; what he sees, believes and does follows the sim.",
    );
  });
});

describe("the committed teaching file", () => {
  it("labels the four looks, drops the forward one in the other run, and tells both beats", () => {
    const c = coachJson as unknown as {
      teaching: boolean;
      hero: string;
      runs: Record<
        string,
        {
          reception: number;
          steps: { direction: string; missing: boolean; lines: string[] }[];
          beats: { id: string; frame: number; happened: boolean; lines: string[] }[];
          answers: { en: { lines: { id: string; text: string }[] } };
        }
      >;
    };
    expect(c.teaching).toBe(true);
    expect(c.hero).toBe("H8");
    const fac = c.runs.factual;
    const cf = c.runs.counterfactual;
    expect(fac.steps.map((s) => s.direction)).toEqual(["L", "R", "B", "F"]);
    expect(cf.steps.map((s) => [s.direction, s.missing])).toEqual([
      ["L", false],
      ["R", false],
      ["B", false],
      ["F", true],
    ]);
    expect(fac.beats.map((b) => [b.id, b.happened])).toEqual([
      ["drop_back", true],
      ["half_turn", true],
    ]);
    expect(cf.beats.map((b) => [b.id, b.happened])).toEqual([
      ["drop_back", false],
      ["half_turn", false],
    ]);
    for (const run of [fac, cf]) {
      const said = new Set(run.answers.en.lines.map((l) => l.id));
      for (const b of run.beats) {
        expect(b.frame).toBe(run.reception);
        expect(b.lines.length).toBeGreaterThan(0);
        for (const id of b.lines) expect(said.has(id)).toBe(true); // every beat line verified
      }
    }
    // Digits come from verified slots: the drop-back and half-turn lines say them.
    const text = (id: string) => fac.answers.en.lines.find((l) => l.id === id)!.text;
    expect(text("drop_back")).toMatch(/drops [\d.]+ m back toward it/);
    expect(text("half_turn")).toMatch(/side-on, on the half-turn: his body is \d+° open/);
  });
});

describe("a teaching file in the scan story", () => {
  const steps = parseSteps(teaching(), hero, moment);
  const fac = steps.runs.factual;

  it("puts the beats after his looks and before his decision", () => {
    expect(steps.teaching).toBe(true);
    expect(fac.steps.map((s) => [s.kind, s.id])).toEqual([
      ["look", "scan:H8:0050"],
      ["beat", "drop_back"],
      ["beat", "half_turn"],
      ["decision", "decision"],
    ]);
    const [drop, turn] = fac.steps.slice(1, 3) as BeatStep[];
    expect(stepTitle(drop)).toBe("He drops back");
    expect(stepTitle(turn)).toBe("On the half-turn");
    expect(onBoard(drop)).toBe(true); // told on the board, as the decision
    expect(onBoard(turn)).toBe(false); // through his eyes
    const square = parseSteps(teaching(false), hero, moment).runs.factual.steps[2] as BeatStep;
    expect(stepTitle(square)).toBe(BEAT_TITLES.half_turn[1]);
    expect(beatTurn(hero, hero.runs.factual, square)).toBeNull(); // square: no arc
    expect(beatTurn(hero, hero.runs.factual, drop)).toBeNull();
    expect(beatTurn(hero, hero.runs.factual, turn)?.frame).toBe(turn.frame);
  });

  it("names a labelled look as the coach does, not from his head against his body", () => {
    const look = fac.steps[0] as LookStep;
    const story = lookStory(hero, hero.runs.factual, look, 1)!;
    expect(story.direction).toBe("F");
    expect(story.words).toBe(TEACHING_WORDS.F);
    const tick = timeline(hero, hero.runs.factual, fac.steps).ticks[0];
    expect(tick.label).toBe("F");
    expect(tickLabel(tick, 1)).toBe("Look 1, forward, up the pitch to the striker");
    // An ordinary file keeps its own words.
    const plain = parseSteps(stepsJson, hero, moment);
    expect(plain.teaching).toBe(false);
    const own = lookStory(hero, hero.runs.factual, plain.runs.factual.steps[0] as LookStep, 1)!;
    expect(own.words).not.toBe(TEACHING_WORDS[own.direction]);
  });

  it("refuses a beat that is not at his reception", () => {
    const stale = teaching();
    stale.runs.factual.beats[0].frame += 1;
    expect(() => parseSteps(stale, hero, moment)).toThrow(/not at his reception/);
    const odd = teaching();
    odd.runs.factual.beats[0].id = "first_touch";
    expect(() => parseSteps(odd, hero, moment)).toThrow(/unknown beat/);
  });
});
