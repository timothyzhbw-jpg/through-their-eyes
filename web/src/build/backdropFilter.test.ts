// The build's CSS pipeline keeps backdrop blur in every browser: the PostCSS step, then Lightning
// CSS minifying for Vite's default targets (build.cssTarget, "baseline-widely-available").

import { transform } from "lightningcss";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { dropWebkitBackdropFilter } from "./backdropFilter";

const version = (major: number, minor = 0) => (major << 16) | (minor << 8);
const targets = {
  chrome: version(111),
  edge: version(111),
  firefox: version(114),
  safari: version(16, 4),
};

async function build(css: string): Promise<string> {
  const step = await postcss([dropWebkitBackdropFilter]).process(css, { from: undefined });
  const code = new TextEncoder().encode(step.css);
  const out = transform({ filename: "x.css", code, minify: true, targets });
  return new TextDecoder().decode(out.code);
}

describe("backdrop-filter in the built stylesheet", () => {
  it.each([
    [
      "unprefixed, then prefixed",
      ".a{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
    ],
    [
      "prefixed, then unprefixed",
      ".a{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}",
    ],
    ["unprefixed only", ".a{backdrop-filter:blur(8px)}"],
  ])("%s: both forms come out", async (_, css) => {
    const out = await build(css);
    expect(out).toMatch(/[{;]backdrop-filter:blur\(8px\)/);
    expect(out).toContain("-webkit-backdrop-filter:blur(8px)");
  });

  it("an override to none stays an override in both forms", async () => {
    const out = await build(".a{backdrop-filter:none;-webkit-backdrop-filter:none}");
    expect(out).toMatch(/[{;]backdrop-filter:none/);
    expect(out).toContain("-webkit-backdrop-filter:none");
  });
});
