// "What if…?" box (SPEC 6, 7): suggested questions from the options, verified counterfactual
// answers, the forced run as a ghost from the decision, and the factual choice marked.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { lineKinds, primaryClaim } from "../narration/payload";
import { EXAMPLE_PLAN } from "../plan/example";
import { heroMoment } from "../plan/moment";
import { createSession } from "../session";
import { ballPath, ghostAt, involvedPlayers, optionOf, parseWhatIfs } from "./whatif";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const whatIfs = parseWhatIfs(whatIfJson, hero, moment);
const h4 = optionOf(whatIfs, "pass:H4")!;

describe("what-if answers", () => {
  it("has one question per option, with what he did marked and not re-simulated", () => {
    const decision = hero.runs.factual.decision!;
    expect(whatIfs.options.map((o) => o.action)).toEqual(decision.options.map((o) => o.action));
    const factual = whatIfs.options.filter((o) => o.factual);
    expect(factual.map((o) => o.action)).toEqual([decision.chosen]);
    expect(factual[0].run).toBeNull();
    expect(h4.question).toEqual({ en: "What if he passed to H4?", zh: "如果他传给H4呢？" });
  });

  it("accepts every precomputed answer, in both languages, all counterfactual", () => {
    for (const o of whatIfs.options.filter((o) => !o.factual)) {
      expect(o.errors).toEqual([]);
      for (const lang of ["en", "zh"] as const) {
        const answer = o.answers[lang]!;
        expect(answer.lines.length).toBeGreaterThan(0);
        for (const line of answer.lines) {
          expect(lineKinds(answer, line)).toEqual(["counterfactual"]);
        }
      }
    }
    expect(h4.answers.en!.lines[0].text).toBe("If H8 had passed to H4, H4 would have received it.");
  });

  it("rejects an answer about another what-if and keeps the reason", () => {
    const tampered = structuredClone(whatIfJson) as typeof whatIfJson;
    const target = tampered.options.find((o) => o.action === "pass:H4")!;
    target.answers!.en.moment = `${moment.id}?force:H8:0075:pass:H1`;
    const parsed = optionOf(parseWhatIfs(tampered, hero, moment), "pass:H4")!;
    expect(parsed.answers.en).toBeUndefined();
    expect(parsed.answers.zh).toBeDefined();
    expect(parsed.errors.join()).toMatch(/en: moment/);
  });

  it("refuses a file for another moment", () => {
    expect(() => parseWhatIfs({ ...whatIfJson, moment: "m:x" }, hero, moment)).toThrow();
  });
});

describe("the ghost path", () => {
  const n = hero.n;
  const out = { pos: new Float32Array(2 * n), ball: new Float32Array(2) };

  it("starts at the decision, from the same state as what happened", () => {
    const run = h4.run!;
    expect(ghostAt(run, n, run.start - 1, out)).toBe(false);
    expect(ghostAt(run, n, run.start, out)).toBe(true);
    const f = run.start;
    for (let k = 0; k < 2 * n; k++) {
      expect(Math.abs(out.pos[k] - hero.runs.factual.pos[f * 2 * n + k])).toBeLessThan(2e-3);
    }
  });

  it("draws ghosts only for the players on the ball in the forced run", () => {
    expect([...involvedPlayers(h4.run!)].sort()).toEqual(["H4", "H8"]);
  });

  it("goes back to H4 where the actual pass went forward to H9", () => {
    const path = ballPath(h4.run!);
    const end = path[path.length - 1];
    const actual = hero.runs.factual.action!.end_at!;
    expect(end[0]).toBeLessThan(hero.runs.factual.action!.start[0] - 10); // backwards
    expect(actual[0]).toBeGreaterThan(30); // forwards, into the box
  });
});

describe("asking a question", () => {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
  const { controls, playback } = session;

  it("replays from the decision with the ghost, and takes over from a breakdown", () => {
    controls.playBreakdown();
    controls.askWhatIf("pass:H4");
    expect(session.runner.status.get().status).toBe("stopped");
    expect(playback.get()).toMatchObject({
      whatIf: "pass:H4",
      mode: "factual",
      frame: whatIfs.start,
      playing: true,
    });
  });

  it("asking about what he did clears the ghost", () => {
    controls.askWhatIf(whatIfs.factualAction);
    expect(playback.get().whatIf).toBeNull();
    expect(playback.get().frame).toBe(whatIfs.start);
  });

  it("seeks to an answer's evidence in the actual run", () => {
    controls.askWhatIf("pass:H4");
    const answer = h4.answers.en!;
    const claim = primaryClaim(answer, answer.lines[0])!;
    controls.seekWhatIf(claim.seek_frame!);
    expect(playback.get()).toMatchObject({ mode: "factual", frame: 75, playing: false });
    expect(playback.get().whatIf).toBe("pass:H4");
  });

  it("works without a what-if file", () => {
    const bare = createSession(hero, EXAMPLE_PLAN, payloadJson);
    expect(bare.whatIfs).toBeNull();
    bare.controls.askWhatIf("pass:H4"); // no-op
    expect(bare.playback.get().whatIf).toBeNull();
  });
});
