// axe-core in a Playwright page: inject its bundled, unmodified axe.min.js (MPL-2.0, a dev
// dependency only; scripts/check-licenses.mjs) and run the WCAG 2.2 A and AA rules on the page as
// it is now. The smoke test (scripts/smoke.mjs) and the audit (scripts/a11y.mjs) both use it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA. `best-practice` rules are reported apart. */
export const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Violations that fail the smoke test: a blind or keyboard-only visitor is blocked. */
export const BLOCKING = new Set(["critical", "serious"]);

/**
 * @typedef {{ id: string, impact: string | null, help: string, tags: string[],
 *   nodes: { target: string[], html: string, summary: string }[] }} Finding
 * @param {import("playwright-core").Page} page
 * @param {{ tags?: string[], exclude?: string[] }} [options] `exclude`: CSS selectors to leave out
 * @returns {Promise<{ violations: Finding[], incomplete: Finding[], version: string }>}
 */
export async function axe(page, { tags = [...WCAG, "best-practice"], exclude = [] } = {}) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: SOURCE });
  return page.evaluate(
    async ({ tags, exclude }) => {
      const context = exclude.length ? { exclude: exclude.map((s) => [s]) } : document;
      const result = await window.axe.run(context, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations", "incomplete"],
      });
      const slim = (r) => ({
        id: r.id,
        impact: r.impact,
        help: r.help,
        tags: r.tags,
        nodes: r.nodes.map((n) => ({
          target: n.target.map(String),
          html: n.html.slice(0, 240),
          summary: (n.failureSummary ?? "").slice(0, 400),
        })),
      });
      return {
        violations: result.violations.map(slim),
        incomplete: result.incomplete.map(slim),
        version: window.axe.version,
      };
    },
    { tags, exclude },
  );
}

/** One line per violated rule: "serious color-contrast (3): Elements must meet …". */
export function describe(findings) {
  return findings.map(
    (f) => `${f.impact ?? "?"} ${f.id} (${f.nodes.length}): ${f.help} — ${f.nodes[0]?.target[0]}`,
  );
}
