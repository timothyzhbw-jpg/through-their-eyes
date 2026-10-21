// "Your call" (SPEC 7): the steps of the mode. The viewer decides at the hero's decision with
// only his picture, then sees what the call led to, the true picture, what he did and why, and
// the two compared; from there one tap tries another option or goes back to the replay.

import { describe, expect, it } from "vitest";
import { CLOSED, reduce, type FlowContext, type FlowEvent, type FlowState } from "./flow";

const ctx: FlowContext = { actions: ["pass:H9", "pass:H4", "carry"] };
const run = (events: FlowEvent[], from: FlowState = CLOSED) =>
  events.reduce((s, e) => reduce(s, e, ctx), from);
const deciding = run([{ type: "open" }]);

describe("Your call: the flow", () => {
  it("opens at the decision with nothing aimed or picked", () => {
    expect(deciding).toEqual({ step: "deciding", aim: null, pick: null, tried: [] });
  });

  it("aims only at one of his options, and only while deciding", () => {
    expect(run([{ type: "aim", action: "pass:H4" }], deciding).aim).toBe("pass:H4");
    expect(
      run(
        [
          { type: "aim", action: "pass:H4" },
          { type: "aim", action: null },
        ],
        deciding,
      ).aim,
    ).toBeNull();
    expect(run([{ type: "aim", action: "pass:H2" }], deciding)).toBe(deciding);
    expect(run([{ type: "aim", action: "pass:H4" }])).toBe(CLOSED);
  });

  it("plays a call through every beat: outcome, truth, what he did, compared", () => {
    const steps: string[] = [];
    let s = run([{ type: "choose", action: "pass:H4" }], deciding);
    expect(s).toMatchObject({ step: "outcome", pick: "pass:H4", aim: null, tried: ["pass:H4"] });
    for (let k = 0; k < 4; k++) {
      steps.push(s.step);
      s = reduce(s, { type: "next" }, ctx);
    }
    expect(steps).toEqual(["outcome", "truth", "actual", "compare"]);
    expect(s.step).toBe("compare"); // the last beat waits for the viewer
  });

  it("takes his own call through the same beats", () => {
    const s = run(
      [{ type: "choose", action: "pass:H9" }, { type: "next" }, { type: "next" }],
      deciding,
    );
    expect(s).toMatchObject({ step: "actual", pick: "pass:H9" });
  });

  it("refuses a call he did not have, and any call outside the decision", () => {
    expect(run([{ type: "choose", action: "shot" }], deciding)).toBe(deciding);
    const outcome = run([{ type: "choose", action: "carry" }], deciding);
    expect(run([{ type: "choose", action: "pass:H4" }], outcome)).toBe(outcome);
    expect(run([{ type: "choose", action: "pass:H4" }])).toBe(CLOSED);
  });

  it("skips from any beat to the comparison", () => {
    for (const beats of [0, 1, 2]) {
      const events: FlowEvent[] = [{ type: "choose", action: "carry" }];
      for (let k = 0; k < beats; k++) events.push({ type: "next" });
      expect(run([...events, { type: "skip" }], deciding).step).toBe("compare");
    }
    expect(run([{ type: "skip" }], deciding)).toBe(deciding);
  });

  it("tries another option in one step, remembering the calls already tried", () => {
    const compare = run(
      [{ type: "choose", action: "pass:H4" }, { type: "skip" }, { type: "retry" }],
      deciding,
    );
    expect(compare).toEqual({ step: "deciding", aim: null, pick: null, tried: ["pass:H4"] });
    const again = run([{ type: "choose", action: "pass:H4" }, { type: "skip" }], compare);
    expect(again.tried).toEqual(["pass:H4"]);
    const third = run([{ type: "retry" }, { type: "choose", action: "carry" }], again);
    expect(third.tried).toEqual(["pass:H4", "carry"]);
  });

  it("goes back to the replay in one step from anywhere, and forgets the calls", () => {
    for (const s of [deciding, run([{ type: "choose", action: "carry" }], deciding)]) {
      expect(reduce(s, { type: "close" }, ctx)).toEqual(CLOSED);
    }
    expect(reduce(CLOSED, { type: "next" }, ctx)).toBe(CLOSED);
  });

  it("opens afresh when opened again", () => {
    const outcome = run([{ type: "choose", action: "carry" }], deciding);
    expect(reduce(outcome, { type: "open" }, ctx)).toEqual({
      step: "deciding",
      aim: null,
      pick: null,
      tried: ["carry"],
    });
  });
});
