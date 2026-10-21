// End-to-end smoke test of the web app (SPEC 7, 8): the production build, talking to a local API
// service, opened page by page in headless Chromium. Every page must show its main view with no
// console error and no uncaught exception; a screenshot of each goes to out/smoke/. The unit tests
// render the app's pieces; this loads the whole app as a visitor gets it. On 2026-10-20
// `?match=match-1` rendered a black page on the live site ("useSession needs a hero moment, not a
// match") although every unit test passed.
//
//   npm run smoke                                    start the API, build for it, serve, test
//   npm run smoke -- --api http://localhost:8765     an API that is already running
//   npm run smoke -- --only match --headed           pages whose name has "match", in a window
//
// Starting the API needs uv and the Python environment (`uv sync` at the repo root). It runs
// offline whatever this shell has set: no model, no Speech, no Cosmos DB, no telemetry, a fresh
// breakdown cache, and the three matches the pages need. Pages find what they check by role and
// accessible name, as a screen reader does, so a new layout or style does not break them; a
// renamed control does, and then the test is updated with it.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { devices } from "playwright-core";
import { build, preview } from "vite";
import { launchChrome } from "./gpu.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MATCHES = "blind_side_run:3,match:1,press_escape:0";
const TIMEOUT = 45_000; // per step: the first load fetches the export, fonts and models
const SETTLE = 2_500; // after the checks, so late errors (models, stream, breakdown) surface
const BLANK = 20_000; // bytes: a screenshot of the page's background alone; a drawn page is ~400K

const { values: opt } = parseArgs({
  options: {
    api: { type: "string" }, // an API that is already running; else one is started on :8765
    only: { type: "string" }, // run the pages whose name contains this
    headed: { type: "boolean", default: false },
    out: { type: "string", default: join(ROOT, "out", "smoke") },
  },
});

const DESKTOP = { viewport: { width: 1440, height: 900 } };
// The phone is an iPhone as Playwright describes it (viewport, pixel ratio, touch, Safari's user
// agent), drawn by Chromium: the layout an iPhone gets, not WebKit's rendering.
const { defaultBrowserType: _, ...PHONE } = devices["iPhone 17"];
const { defaultBrowserType: _se, ...PHONE_320 } = devices["iPhone SE"]; // 320 px
const { defaultBrowserType: _mini, ...PHONE_375 } = devices["iPhone 13 Mini"]; // 375 px

/** The README's tour for judges, and the pages around it. `intro=0` skips the lineup card, which
 * the two lineup pages open and close as a visitor does. */
const PAGES = [
  { name: "hero", path: "?autoplay=0&intro=0", check: (p) => hero(p) },
  {
    name: "press-escape",
    path: "?match=press_escape-0&autoplay=0&intro=0",
    check: (p) => hero(p),
  },
  { name: "match-1", path: "?match=match-1&autoplay=0&intro=0", check: (p) => match(p) },
  { name: "match-1-breakdowns", path: "?match=match-1&intro=0", check: breakdownsAndBack },
  { name: "lineup-hero", path: "", check: (p, shoot) => lineup(p, shoot, "Skip", hero) },
  {
    name: "lineup-match-1",
    path: "?match=match-1",
    check: (p, shoot) => lineup(p, shoot, "Start watching", match),
  },
  { name: "link-tamper", path: "?persona=analyst&tamper=cf_value", check: tamper },
  {
    name: "link-decision-tactical",
    path: "?at=decision&view=tactical",
    check: (p) => hero(p, { main: "board" }),
  },
  { name: "tour", path: "?tour=1", check: (p, shoot) => tour(p, shoot) },
  {
    name: "phone-tour",
    path: "?tour=1",
    device: PHONE,
    check: (p, shoot, note) => phone(p, (q) => tour(q, shoot), note),
  },
  {
    name: "phone-hero",
    path: "?intro=0",
    device: PHONE,
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-match-1",
    path: "?match=match-1&intro=0",
    device: PHONE,
    check: (p) => phone(p, match),
  },
  {
    name: "phone-320-hero",
    path: "?intro=0",
    device: PHONE_320,
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-320-match-1",
    path: "?match=match-1&intro=0",
    device: PHONE_320,
    check: (p) => phone(p, match),
  },
  {
    name: "phone-375-hero",
    path: "?intro=0",
    device: PHONE_375,
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-375-match-1",
    path: "?match=match-1&intro=0",
    device: PHONE_375,
    check: (p) => phone(p, match),
  },
];

/** Wait for `locator` (its first match) to be on screen, or `attached` to the page. */
async function see(locator, what, state = "visible") {
  try {
    await locator.first().waitFor({ state });
  } catch {
    throw new Error(`expected ${what}`);
  }
}

/** The main view on screen with its WebGL canvas: the 3D view (first person or broadcast) or the
 * tactical board. Only the main one: a layout may show one view at a time (a phone does), and a
 * view that fails to draw logs an error anyway. */
async function mainView(page, main) {
  const view =
    main === "board"
      ? page.getByRole("figure", { name: "Tactical view from above" })
      : page.getByRole("figure", { name: /^(First-person|Broadcast) view$/ });
  await see(view, `the ${main === "board" ? "tactical board" : "3D view"} on screen`);
  await see(view.locator("canvas"), "its WebGL canvas");
}

/** A hero moment: its views and its run switch; at the top level, the live service's control
 * (not the "Offline data" badge); inside a match, the way back. */
async function hero(page, { main = "eyes", inMatch = false } = {}) {
  if (inMatch) {
    await see(page.getByRole("button", { name: /Back to the match/ }), "Back to the match");
  } else {
    await see(page.getByRole("group", { name: "Live stream" }), "the live stream control");
  }
  await see(page.getByRole("group", { name: "Run" }), "a hero moment's run switch");
  await mainView(page, main);
}

/** A stitched match: the score bug, its views, the live service and every possession's moments. */
async function match(page) {
  await see(page.getByRole("group", { name: "Live stream" }), "the live stream control");
  const score = page.getByRole("region", { name: "Score and possession" });
  await see(score.filter({ hasText: /Possession \d+ of \d+/ }), "the score bug with a possession");
  await mainView(page, "eyes");
  await see(page.getByRole("region", { name: "Possession 1" }), "the Moments panel", "attached");
}

/** `?persona=analyst&tamper=cf_value`: the evidence card with "Try a wrong number" open. */
async function tamper(page) {
  await hero(page);
  await see(page.getByRole("region", { name: "Evidence for this line" }), "the evidence card");
  await see(
    page.getByRole("button", { name: "Try a wrong number", expanded: true }),
    '"Try a wrong number" open',
  );
}

/** `?tour=1`, the judges' tour (SPEC 7, web/src/tour/): its card on screen at every step, Next
 * through to the end without pressing the steps' own buttons (the drill would run the crew),
 * then Done closes it and the hero moment works as before. */
async function tour(page, shoot) {
  const card = page.getByRole("dialog").filter({ hasText: /^Tour · \d+ of \d+/ });
  for (let k = 1; ; k++) {
    await see(card.filter({ hasText: new RegExp(`^Tour · ${k} of `) }), `the tour's step ${k}`);
    const [box, size] = await Promise.all([
      card.boundingBox(),
      page.evaluate(() => [innerWidth, innerHeight]),
    ]);
    const [w, h] = size;
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > w || box.y + box.height > h) {
      throw new Error(`expected the tour's step ${k} card on screen, got ${JSON.stringify(box)}`);
    }
    await shoot(`step-${k}`);
    const done = card.getByRole("button", { name: "Done" });
    if (await done.count()) {
      await done.click();
      break;
    }
    if (k > 12) throw new Error("expected the tour to end within 12 steps");
    await card.getByRole("button", { name: "Next" }).click();
  }
  try {
    await card.waitFor({ state: "detached" });
  } catch {
    throw new Error('expected "Done" to close the tour');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await hero(page);
}

/** The pre-match lineup card (SPEC 7, 10) opens over the whole page on a link that is not to a
 * spot: shown, closed with `button` ("Start watching" or "Skip"), then the page's main view. */
async function lineup(page, shoot, button, then) {
  const card = page.getByRole("dialog");
  await see(card, "the lineup card");
  await see(card.getByRole("list", { name: "Home line-up" }), "the home line-up on the card");
  await shoot("card");
  // The card also closes by itself after a few seconds (INTRO_MS), and a slow runner can reach
  // the button after that: a card that is already gone has closed, which is what this checks.
  try {
    await card.getByRole("button", { name: button }).click({ timeout: 2000 });
  } catch {
    /* closed by itself, or the click is retried by the wait below */
  }
  try {
    await card.first().waitFor({ state: "detached", timeout: 15_000 });
  } catch {
    throw new Error(`expected "${button}" or the timer to close the lineup card`);
  }
  await then(page);
}

/** On a phone the page should scroll only up and down, and no two header controls overlap or run
 * off screen, with the live stream running (its status and the header's buttons are then all
 * there). */
async function phone(page, check) {
  await check(page);
  await see(page.locator(".live-status.streaming"), "the live stream running", "attached");
  const { wide, width, overlaps, offscreen } = await page.evaluate(() => {
    const root = document.documentElement;
    const wide = root.scrollWidth;
    const width = root.clientWidth;
    const found = [
      ...document.querySelectorAll(
        ".stage-head :is(.brand, .live-chip, .live-status, button, select)",
      ),
    ].filter((el) => {
      if (el.closest(".popover")) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    // A control that holds another is the other's box, not its own: keep the leaves.
    const controls = found.filter(
      (el) => !found.some((other) => other !== el && el.contains(other)),
    );
    const name = (el) => {
      const text = el.textContent.replace(/\s+/g, " ").trim();
      const hint = (text || el.getAttribute("aria-label") || "").slice(0, 14);
      return `${el.classList[0] ?? el.tagName.toLowerCase()} ${hint}`.trim();
    };
    const rects = controls.map((el) => el.getBoundingClientRect());
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 0.5 && down > 0.5)
          overlaps.push(`${name(controls[i])} x ${name(controls[j])}`);
      }
    }
    const offscreen = controls
      .filter((_, i) => rects[i].left < -0.5 || rects[i].right > width + 0.5)
      .map(name);
    return { wide, width, overlaps, offscreen };
  });
  if (wide > width) throw new Error(`scrolls sideways: ${wide} px wide in ${width} px`);
  if (overlaps.length) throw new Error(`header controls overlap: ${overlaps.join(", ")}`);
  if (offscreen.length) throw new Error(`header controls off screen: ${offscreen.join(", ")}`);
}

/** The match live, then each hero moment's breakdown from the Moments panel and back. */
async function breakdownsAndBack(page, shoot) {
  await match(page);
  await shoot("live");
  const open = page.getByRole("button", { name: "Breakdown", exact: true });
  const n = await open.count();
  if (n === 0) throw new Error("expected a Breakdown button in the Moments panel");
  for (let i = 0; i < n; i++) {
    await open.nth(i).click();
    await hero(page, { inMatch: true });
    await page.waitForTimeout(SETTLE);
    await shoot(`breakdown-${i + 1}`);
    await page.getByRole("button", { name: /Back to the match/ }).click();
    await match(page);
  }
  await page.waitForTimeout(SETTLE);
  await shoot("back");
}

/** Start the API offline on `url`'s port. `ready()` resolves once it is warm (/health answers);
 * `stop()` once it has exited. */
function startApi(url, cache) {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(FOUNDRY|AZURE|TTE)_/.test(name) && name !== "IDENTITY_ENDPOINT",
      ),
    ),
    APPLICATIONINSIGHTS_CONNECTION_STRING: "",
    TTE_MATCHES: MATCHES,
    TTE_CACHE_DIR: cache,
  };
  // --no-env-file: a UV_ENV_FILE in the shell must not bring the removed settings back.
  const args = ["run", "--no-env-file", "uvicorn", "api.main:app", "--port", new URL(url).port];
  const child = spawn("uv", args, { cwd: ROOT, env, detached: true, stdio: "pipe" });
  const log = createWriteStream(join(opt.out, "api.log"));
  // Two pipes into one file: neither may end it, or the other's last lines would be lost (or
  // written after the end). It is closed once the child has.
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (err) => log.write(`could not start uv: ${err.message}\n`));
  const exited = new Promise((resolve) =>
    child.on("close", () => {
      log.end();
      resolve("exited");
    }),
  );
  // The group may already be gone (uv killed by a signal): then there is nothing to signal.
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch (err) {
      if (err.code !== "ESRCH") throw err;
    }
  };
  return {
    /** Last resort, synchronous (for an exit handler): kill the group at once. */
    kill() {
      if (child.pid && child.exitCode === null && child.signalCode === null) signal("SIGKILL");
    },
    // The whole process group (uv and uvicorn). Uvicorn heeds SIGTERM only once it is warm.
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      signal("SIGTERM");
      const late = await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000, "late"))]);
      if (late === "late") signal("SIGKILL");
      await exited;
    },
    async ready() {
      for (const deadline = Date.now() + 180_000; Date.now() < deadline;) {
        const up = await Promise.race([health(url), exited]);
        if (up === "exited") throw new Error(`the API exited: see ${join(opt.out, "api.log")}`);
        if (up) return up;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("the API did not answer /health within 3 minutes");
    },
  };
}

/** The API's /health, or null while it does not answer. */
async function health(url) {
  try {
    const res = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Open one page in a fresh context; resolves to its console errors and uncaught exceptions, and
 * notes (on the screenshots, and what a page reports without failing). */
async function visit(browser, base, page) {
  const context = await browser.newContext(page.device ?? DESKTOP);
  context.setDefaultTimeout(TIMEOUT);
  // The web fonts are the only requests outside this machine: answered empty, so a run needs no
  // network (text falls back to system fonts in the screenshots).
  const local = new Set([new URL(base).hostname, "localhost", "127.0.0.1"]);
  await context.route(
    (url) => !local.has(url.hostname),
    (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  const tab = await context.newPage();
  const errors = [];
  const notes = [];
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const where = msg.location().url;
    errors.push(`console error: ${msg.text()}${where ? ` (${where})` : ""}`);
  });
  // An uncaught exception fails the page at once: the checks would only time out after it.
  let fail = () => {};
  const thrown = new Promise((_, reject) => (fail = reject));
  thrown.catch(() => {});
  tab.on("pageerror", (err) => {
    errors.push(`uncaught: ${err.message}`);
    fail(new Error("stopped at an uncaught exception"));
  });
  tab.on("crash", () => {
    errors.push("the page crashed");
    fail(new Error("stopped at the crash"));
  });
  // Now and then, right after the app swaps screens, SwiftShader hands back a capture with only
  // the page's background in it while every check on the page passes; it is retaken once. The
  // screenshots are for people: no check looks at pixels. Finite CSS animations (a card coming in)
  // are run to their end first, so a screenshot shows the page at rest.
  const capture = (path) => tab.screenshot({ path, animations: "disabled" });
  const shoot = async (suffix) => {
    const name = `${page.name}${suffix ? `-${suffix}` : ""}.png`;
    if ((await capture(join(opt.out, name))).length >= BLANK) return;
    await tab.waitForTimeout(500);
    const again = await capture(join(opt.out, name));
    notes.push(`${name}: a blank capture, retaken${again.length < BLANK ? ", blank again" : ""}`);
  };
  try {
    await tab.goto(new URL(page.path, base).href);
    const checks = page.check(tab, shoot, (n) => notes.push(n));
    checks.catch(() => {}); // left behind if the page throws first
    await Promise.race([checks, thrown]);
    await Promise.race([tab.waitForTimeout(SETTLE), thrown]);
  } catch (err) {
    const text = await tab
      .locator("#root")
      .innerText({ timeout: 1000 })
      .catch(() => "");
    const shown = text.trim().replace(/\s+/g, " ").slice(0, 200) || "(an empty page)";
    errors.unshift(`${err instanceof Error ? err.message : String(err)}; the page shows: ${shown}`);
  } finally {
    await shoot("").catch(() => {});
    await context.close();
  }
  return { errors, notes };
}

mkdirSync(opt.out, { recursive: true });
const pages = PAGES.filter((p) => !opt.only || p.name.includes(opt.only));
if (!pages.length) throw new Error(`no page name contains "${opt.only}"`);
const t0 = performance.now();
const apiUrl = opt.api ?? "http://localhost:8765";
if (!opt.api && (await health(apiUrl))) {
  throw new Error(`an API already answers at ${apiUrl}: stop it, or pass --api ${apiUrl}`);
}
const tmp = mkdtempSync(join(tmpdir(), "tte-smoke-"));
const api = opt.api ? null : startApi(apiUrl, join(tmp, "cache"));
// Whoever ends this process (a signal handler of ours, Playwright's own, an uncaught error), the
// API's process group is killed and the temporary directory removed.
process.on("exit", () => {
  api?.kill();
  rmSync(tmp, { recursive: true, force: true });
});
for (const [name, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(name, async () => {
    try {
      await api?.stop();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      process.exit(code);
    }
  });
}
let server, browser;
let failed = 0;
try {
  // Build while the API warms up: VITE_API_URL is read at build time.
  process.env.VITE_API_URL = apiUrl;
  const dist = join(tmp, "dist");
  await build({ root: WEB, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
  const up = api ? await api.ready() : await health(apiUrl);
  if (!up) throw new Error(`no API answers /health at ${apiUrl}`);
  console.log(`API ${apiUrl}: ${JSON.stringify(up)}`);
  server = await preview({
    root: WEB,
    configFile: false,
    logLevel: "error",
    build: { outDir: dist },
    preview: { port: 0 },
  });
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error("the preview server has no local URL");
  browser = await launchChrome({ headless: !opt.headed });
  for (const page of pages) {
    const t = performance.now();
    const { errors, notes } = await visit(browser, base, page);
    const s = ((performance.now() - t) / 1000).toFixed(1);
    if (errors.length) failed++;
    console.log(`${errors.length ? "FAIL" : "ok  "} ${page.name} /${page.path} (${s} s)`);
    for (const e of errors) console.log(`       ${e}`);
    for (const n of notes) console.log(`       note: ${n}`);
  }
} finally {
  await browser?.close();
  await server?.close();
  try {
    await api?.stop();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
const total = ((performance.now() - t0) / 1000).toFixed(0);
console.log(
  `${pages.length - failed} of ${pages.length} pages passed in ${total} s; screenshots in ${opt.out}`,
);
process.exitCode = failed ? 1 : 0;
