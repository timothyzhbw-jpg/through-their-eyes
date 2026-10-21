// Stylesheet rules the minifier depends on.
//
// Lightning CSS (Vite's CSS minifier) folds a rule's `backdrop-filter` followed by
// `-webkit-backdrop-filter` into the prefixed declaration alone, which Chrome and Edge ignore: every
// glass panel then lost its blur there. Written unprefixed, it emits both forms for the build
// targets, so the prefix must never be written by hand.

import { describe, expect, it } from "vitest";

// Node's fs without @types/node: vitest runs these tests in node (vite.config.ts).
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

describe("stylesheets", () => {
  it("finds the stylesheets", () => {
    expect(sheets).toContain("styles.css");
  });

  it.each(sheets)("%s writes backdrop-filter unprefixed only", (sheet) => {
    const css = fs.readFileSync(`${src}/${sheet}`, "utf8");
    expect(css).not.toMatch(/-webkit-backdrop-filter/);
  });
});
