// Text and cards come up sharp: no entrance animation in the app's stylesheets fades in through a
// blur (Bowen, 2026-10-21: blur is uncomfortable; any blur must be opt-in). The frosted panels'
// backdrop-filter is not an animation and stays.

import postcss from "postcss";
import { describe, expect, it } from "vitest";

// Vitest stubs CSS imports, so read the stylesheets with Node's fs (no @types/node here).
type Fs = {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string, options: { recursive: true }): string[];
};
const nodeProcess = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): Fs; cwd(): string } }
).process;
const fs = nodeProcess.getBuiltinModule("node:fs");
const src = `${nodeProcess.cwd()}/src`;
const sheets = fs
  .readdirSync(src, { recursive: true })
  .filter((f) => f.endsWith(".css"))
  .sort();

/** Every `filter` with a blur inside a @keyframes rule of `css`. */
function blurredKeyframes(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkAtRules(/keyframes$/, (rule) => {
    rule.walkDecls(/filter$/, (decl) => {
      if (/blur\(/.test(decl.value)) found.push(`@keyframes ${rule.params}: ${decl.value}`);
    });
  });
  return found;
}

describe("entrance animations", () => {
  it("reads the app's stylesheets", () => {
    expect(sheets).toContain("styles.css");
    expect(sheets.length).toBeGreaterThan(5);
  });

  it("finds a blur in a keyframe", () => {
    const css = "@keyframes a { from { opacity: 0; filter: blur(6px) } to { opacity: 1 } }";
    expect(blurredKeyframes(css)).toEqual(["@keyframes a: blur(6px)"]);
    expect(blurredKeyframes(".a { backdrop-filter: blur(8px) }")).toEqual([]);
  });

  it.each(sheets)("%s: no keyframe fades in through a blur", (file) => {
    expect(blurredKeyframes(fs.readFileSync(`${src}/${file}`, "utf8"))).toEqual([]);
  });
});
