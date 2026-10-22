// "Take his eyes" (SPEC 7): the steps of the mode as a pure reducer.

import { describe, expect, it } from "vitest";
import { CLOSED, reduce, type FlowState } from "./flow";

const choosing: FlowState = { ...CLOSED, step: "choosing", frame: 50, offset: -150 };

describe("Take his eyes: the flow", () => {
  it("opens by loading the grid, then starts at the cell it is given", () => {
    const loading = reduce(CLOSED, { type: "open", loaded: false });
    expect(loading.step).toBe("loading");
    expect(reduce(loading, { type: "loaded", frame: 50, offset: -150 })).toEqual(choosing);
    expect(reduce(loading, { type: "failed", error: "404" })).toMatchObject({
      step: "error",
      error: "404",
    });
  });

  it("reopens where the viewer left it", () => {
    const closed = reduce(choosing, { type: "close" });
    expect(closed.step).toBe("closed");
    expect(reduce(closed, { type: "open", loaded: true })).toMatchObject({
      step: "choosing",
      frame: 50,
      offset: -150,
    });
  });

  it("picks a time and a direction while choosing, and from the result goes back to choosing", () => {
    const later = reduce(choosing, { type: "pick", frame: 60 });
    expect(later).toMatchObject({ step: "choosing", frame: 60, offset: -150 });
    expect(reduce(later, { type: "pick", frame: 60 })).toBe(later); // no change: same object
    const result: FlowState = { ...choosing, step: "result" };
    expect(reduce(result, { type: "pick", offset: 90 })).toMatchObject({
      step: "choosing",
      offset: 90,
    });
    const looking: FlowState = { ...choosing, step: "looking" };
    expect(reduce(looking, { type: "pick", offset: 90 })).toBe(looking);
  });

  it("looks, then shows the result with both runs; each look is remembered once", () => {
    const looking = reduce(choosing, { type: "look", id: "look:H8:0050:-150" });
    expect(looking).toMatchObject({ step: "looking", tried: ["look:H8:0050:-150"] });
    const result = reduce(looking, { type: "done" });
    expect(result).toMatchObject({ step: "result", view: "both" });
    expect(reduce(result, { type: "view", view: "none" }).view).toBe("none");
    const again = reduce(result, { type: "again" });
    expect(again.step).toBe("choosing");
    expect(reduce(again, { type: "look", id: "look:H8:0050:-150" }).tried).toEqual([
      "look:H8:0050:-150",
    ]);
  });

  it("ignores what does not apply", () => {
    expect(reduce(CLOSED, { type: "look", id: "x" })).toBe(CLOSED);
    expect(reduce(CLOSED, { type: "close" })).toBe(CLOSED);
    expect(reduce(choosing, { type: "done" })).toBe(choosing);
    expect(reduce(choosing, { type: "view", view: "picture" })).toBe(choosing);
    expect(reduce(choosing, { type: "loaded", frame: 1, offset: 1 })).toBe(choosing);
  });
});
