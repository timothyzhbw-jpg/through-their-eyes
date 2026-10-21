// A shot or a carry can finish with no outcome and no receiver. The story beat must not read
// "Lost: null by nobody."

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { createSession } from "../session";
import { render } from "../testing";
import { StoryPanel } from "./Panels";

describe("an action with no outcome", () => {
  it("says the action was incomplete, and names a receiver only when there is one", () => {
    const data = structuredClone(raw);
    const action = data.runs.factual.action;
    if (!action) throw new Error("the bundled factual run has no action");
    Object.assign(action, { outcome: null, receiver: null });
    const html = render(createSession(parseHero(data), null, null), <StoryPanel />);
    expect(html).toContain("Lost: incomplete.");
    expect(html).not.toContain("null");
    expect(html).not.toContain("nobody");
  });
});
