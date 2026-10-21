// A shot has no outcome, and a pass can still be in flight when the clip ends. The story beat
// must not read "Lost: null by nobody."

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { createSession } from "../session";
import { render } from "../testing";
import { StoryPanel } from "./Panels";

describe("an action with no outcome", () => {
  it("says he shoots when the decision is a shot", () => {
    const data = structuredClone(raw);
    const run = data.runs.factual;
    if (!run.decision || !run.action) throw new Error("the bundled factual run has no action");
    Object.assign(run.decision, { chosen: "shot" });
    Object.assign(run.action, { outcome: null, receiver: null });
    const html = render(createSession(parseHero(data), null, null), <StoryPanel />);
    expect(html).toContain("He shoots.");
    expect(html).not.toContain("Lost");
    expect(html).not.toContain("null");
    expect(html).not.toContain("nobody");
  });

  it("says a pass is still running when it has not finished", () => {
    const data = structuredClone(raw);
    const action = data.runs.factual.action;
    if (!action) throw new Error("the bundled factual run has no action");
    Object.assign(action, { outcome: null, receiver: null });
    const html = render(createSession(parseHero(data), null, null), <StoryPanel />);
    expect(html).toContain("The pass is still running when the clip ends.");
    expect(html).not.toContain("Lost");
    expect(html).not.toContain("null");
    expect(html).not.toContain("nobody");
  });
});
