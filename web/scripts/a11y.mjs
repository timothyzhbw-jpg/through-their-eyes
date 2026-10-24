// Accessibility audit of the web app (docs/ACCESSIBILITY.md): axe-core's WCAG 2.2 A/AA rules on
// every screen a visitor reaches, on a desktop and a phone, against a site that is already up (the
// live site, or a local build: `npm run build && npx vite preview`). The smoke test runs the same
// rules on its pages and fails on a serious or critical violation; this goes further (menus, Your
// call's reveal, the evidence card, a match's breakdown) and reports every violation, the rules
// axe could not decide (text over the 3D picture), and best-practice findings.
//
//   npm run a11y -- --url https://ttesite1ff906.z14.web.core.windows.net
//   npm run a11y -- --url http://localhost:4173 --only yourcall --reduced-motion
//
// On a deployed site it asks the API for no breakdown that may not be cached (each new one costs
// a unit of the daily model cap): only the casual and analyst ones in English go through; the rest
// fall back to the bundled example, which has the same controls. `--all-breakdowns` lifts that.
// Writes out/a11y/<label>/*.json and a summary, summary.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { devices } from "playwright-core";
import { axe, BLOCKING, WCAG } from "./axe.mjs";
import { launchChrome } from "./gpu.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TIMEOUT = 45_000;

const { values: opt } = parseArgs({
  options: {
    url: { type: "string" },
    only: { type: "string" },
    label: { type: "string" },
    "reduced-motion": { type: "boolean", default: false },
    scheme: { type: "string", default: "dark" }, // the OS colour scheme; the app is dark only
    "all-breakdowns": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    out: { type: "string" },
  },
});
if (!opt.url) throw new Error("--url is required: the site to audit");

const DESKTOP = { name: "desktop", viewport: { width: 1440, height: 900 } };
const PHONE = {
  name: "phone",
  ...(({ defaultBrowserType: _, ...d }) => d)(devices["iPhone 13 Mini"]),
  viewport: { width: 375, height: 812 },
};

const see = async (locator, what) => {
  try {
    await locator.first().waitFor({ state: "visible" });
  } catch {
    throw new Error(`expected ${what}`);
  }
};
const runSwitch = (p) => see(p.getByRole("group", { name: "Run" }), "the run switch");
const scoreBug = (p) =>
  see(p.getByRole("region", { name: "Score and possession" }), "the match's score bug");

/** Every screen, as a path and the steps from its load to the state that is checked. */
const STATES = [
  { name: "lineup-hero", path: "", ready: (p) => see(p.getByRole("dialog"), "the lineup card") },
  { name: "hero", path: "?intro=0&autoplay=0", ready: runSwitch },
  {
    name: "hero-viewer-menu",
    path: "?intro=0&autoplay=0",
    ready: async (p) => {
      await runSwitch(p);
      await p.locator("#settings").click(); // who is watching is in the header's Settings
      await p.getByRole("button", { name: /^Watching as/ }).click();
      await see(p.getByRole("dialog", { name: "Who is watching" }), "the viewer menu");
    },
  },
  {
    name: "hero-settings",
    path: "?intro=0&autoplay=0",
    ready: async (p) => {
      await runSwitch(p);
      await p.locator("#settings").click(); // the moment, follow, sound, view options, the tour
      await see(p.getByRole("group", { name: "Settings" }), "the Settings menu");
    },
  },
  {
    name: "hero-view-options",
    path: "?intro=0&autoplay=0",
    ready: async (p) => {
      await runSwitch(p);
      await p.locator("#settings").click(); // View options is in the header's Settings
      await p.getByRole("button", { name: "View options" }).click();
      await see(p.getByRole("group", { name: "View options" }), "the view options");
    },
  },
  {
    name: "story-end",
    path: "?tour=next",
    ready: (p) =>
      see(p.getByRole("button", { name: "For studios" }).last(), "the end card's choices"),
  },
  {
    name: "door-turn",
    path: "?door=turn",
    ready: (p) => see(p.getByRole("region", { name: "Your turn." }), "Your turn's hub"),
  },
  {
    name: "door-studios",
    path: "?door=studios",
    ready: (p) => see(p.getByRole("tablist", { name: "Studio steps" }), "For studios' steps"),
  },
  {
    name: "door-studios-commentary",
    path: "?step=commentary",
    ready: (p) => see(p.getByRole("tabpanel", { name: /Commentary/ }), "Personalised commentary"),
  },
  {
    name: "hero-playing",
    path: "?intro=0",
    ready: async (p) => {
      await runSwitch(p);
      // The live stream (6.6 s), then the breakdown with its captions.
      await see(p.locator("button.caption"), "a caption");
    },
  },
  {
    name: "evidence-tamper",
    path: "?persona=analyst&tamper=cf_value",
    ready: (p) =>
      see(p.getByRole("region", { name: "Evidence for this line" }), "the evidence card"),
  },
  {
    name: "yourcall-deciding",
    path: "?play=yourcall",
    ready: (p) => see(p.getByRole("group", { name: /^Options of / }), "Your call's markers"),
  },
  {
    name: "yourcall-reveal",
    path: "?play=yourcall",
    ready: async (p) => {
      const markers = p.getByRole("group", { name: /^Options of / }).getByRole("button");
      await see(markers, "Your call's markers");
      await markers.first().click();
      await see(p.getByRole("list", { name: "Reveal" }), "the reveal's steps");
    },
  },
  {
    name: "lineup-match",
    path: "?match=match-1",
    ready: (p) => see(p.getByRole("dialog"), "card"),
  },
  { name: "match", path: "?match=match-1&intro=0&autoplay=0", ready: scoreBug },
  {
    name: "match-live",
    path: "?match=match-1&intro=0",
    ready: async (p) => {
      await scoreBug(p);
      await p.waitForTimeout(4000); // moments the stream has not announced yet are dimmed
    },
  },
  {
    name: "match-breakdown",
    path: "?match=match-1&intro=0&autoplay=0",
    ready: async (p) => {
      await scoreBug(p);
      await p.getByRole("button", { name: "Breakdown", exact: true }).first().click();
      await see(p.getByRole("button", { name: /Back to the match/ }), "Back to the match");
    },
  },
  { name: "press-escape", path: "?match=press_escape-0&intro=0&autoplay=0", ready: runSwitch },
];

/** On a deployed site, only the breakdowns a visitor's first minutes ask for anyway. */
async function guard(context) {
  if (opt["all-breakdowns"]) return;
  await context.route("**/api/breakdowns", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const body = req.postDataJSON() ?? {};
    const persona = body.personas?.[0];
    const language = body.languages?.[0];
    const cached = ["casual", "analyst"].includes(persona) && language === "en";
    const hero = typeof body.match === "string" && !body.match.startsWith("match-");
    return cached && hero ? route.continue() : route.abort();
  });
}

async function audit(browser, device, state) {
  const { name: _, ...options } = device;
  const context = await browser.newContext({
    ...options,
    reducedMotion: opt["reduced-motion"] ? "reduce" : "no-preference",
    colorScheme: opt.scheme,
  });
  context.setDefaultTimeout(TIMEOUT);
  await guard(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(new URL(state.path, opt.url).href);
    await state.ready(page);
    await page.waitForTimeout(800); // a card coming in, fonts
    const result = await axe(page);
    return { ...result, errors };
  } catch (err) {
    return { violations: [], incomplete: [], errors: [...errors, String(err.message ?? err)] };
  } finally {
    await context.close();
  }
}

const label =
  opt.label ??
  `${new URL(opt.url).hostname.split(".")[0]}${opt["reduced-motion"] ? "-reduced" : ""}`;
const out = opt.out ?? join(ROOT, "out", "a11y", label);
mkdirSync(out, { recursive: true });
const states = STATES.filter((s) => !opt.only || s.name.includes(opt.only));
const browser = await launchChrome({ headless: !opt.headed });
const rows = [];
let blocking = 0;
let version = "";
try {
  for (const device of [DESKTOP, PHONE]) {
    for (const state of states) {
      const r = await audit(browser, device, state);
      version ||= r.version ?? "";
      writeFileSync(join(out, `${device.name}-${state.name}.json`), JSON.stringify(r, null, 2));
      const wcag = r.violations.filter((v) => v.tags.some((t) => WCAG.includes(t)));
      const bp = r.violations.filter((v) => !wcag.includes(v));
      const block = wcag.filter((v) => BLOCKING.has(v.impact));
      blocking += block.length;
      rows.push({
        device: device.name,
        state: state.name,
        wcag,
        bp,
        incomplete: r.incomplete,
        errors: r.errors,
      });
      const tag = r.errors.length ? "ERR " : block.length ? "FAIL" : wcag.length ? "warn" : "ok  ";
      console.log(`${tag} ${device.name.padEnd(7)} ${state.name}`);
      for (const v of wcag)
        console.log(`       ${v.impact} ${v.id} ×${v.nodes.length}: ${v.nodes[0]?.target[0]}`);
      for (const v of bp)
        console.log(`       (bp) ${v.impact} ${v.id} ×${v.nodes.length}: ${v.nodes[0]?.target[0]}`);
      for (const e of r.errors) console.log(`       error: ${e}`);
    }
  }
} finally {
  await browser.close();
}

const md = [
  `# Accessibility audit: ${opt.url}`,
  "",
  `axe-core ${version}, WCAG 2.2 A/AA + best practice; reduced motion ${opt["reduced-motion"] ? "on" : "off"}; ${new Date().toISOString()}`,
  "",
  "| Viewport | Screen | WCAG violations | Best practice | Needs review (axe) | Errors |",
  "|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.device} | ${r.state} | ${r.wcag.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(", ") || "none"} | ${r.bp.map((v) => `${v.id} (${v.nodes.length})`).join(", ") || "none"} | ${r.incomplete.map((v) => `${v.id} (${v.nodes.length})`).join(", ") || "none"} | ${r.errors.join("; ") || ""} |`,
  ),
];
writeFileSync(join(out, "summary.md"), `${md.join("\n")}\n`);
console.log(`\n${blocking} serious or critical WCAG violations; ${join(out, "summary.md")}`);
process.exitCode = blocking || rows.some((r) => r.errors.length) ? 1 : 0;
