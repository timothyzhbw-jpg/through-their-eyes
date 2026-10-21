// End-to-end smoke test of the web app (SPEC 7, 8): the production build, talking to a local API
// service, opened page by page in headless Chromium. Every page must show its main view with no
// console error, no uncaught exception and no serious or critical WCAG violation (axe-core); a
// screenshot of each goes to out/smoke/. The unit tests
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
import { axe, BLOCKING, describe, WCAG } from "./axe.mjs";
import { launchChrome } from "./gpu.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MATCHES = "blind_side_run:3,corner_blind_side:0,match:1,press_escape:0";
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
  { name: "link-eyes", path: "?play=eyes", check: takeEyes },
  { name: "link-eyes-press-escape", path: "?match=press_escape-0&play=eyes", check: takeEyes },
  {
    name: "link-eyes-match-1",
    path: "?match=match-1&play=eyes",
    check: async (p) => {
      await see(p.getByRole("button", { name: /Back to the match/ }), "Back to the match");
      await takeEyes(p);
    },
  },
  {
    name: "phone-320-eyes",
    path: "?play=eyes",
    device: PHONE_320,
    check: (p) => phone(p, takeEyes, { live: false }),
  },
  { name: "link-recap", path: "?match=match-1&play=recap", check: recap },
  // The key-moment beat (SPEC 7) at a spot inside the key scan, after the runner came into sight.
  { name: "beat-eyes", path: "?at=60", check: (p) => beat(p, { push: 1 }) },
  { name: "beat-broadcast", path: "?at=66&camera=broadcast", check: (p) => beat(p, { push: 1 }) },
  {
    name: "beat-reduced-motion",
    path: "?at=60",
    device: { ...DESKTOP, reducedMotion: "reduce" },
    check: (p) => beat(p, { push: 0 }),
  },
  // The render tiers (SPEC 7, src/quality/): the post chain loads, draws, and says which tier.
  { name: "quality-high", path: "?at=60&quality=high", check: (p) => tier(p, "high") },
  {
    name: "quality-high-broadcast",
    path: "?at=66&camera=broadcast&quality=high",
    check: (p) => tier(p, "high"),
  },
  {
    name: "phone-quality-medium",
    path: "?intro=0&quality=medium",
    device: PHONE,
    check: (p) => phone(p, (q) => tier(q, "medium")),
  },
  // No head-turn blur unless the viewer turns it on, and none right after a camera cut, even then
  // (beat/cut.ts).
  { name: "cut-no-blur", path: "?autoplay=0&intro=0", check: cutNoBlur },
  {
    name: "link-decision-tactical",
    path: "?at=decision&view=tactical",
    check: (p) => hero(p, { main: "board" }),
  },
  { name: "tour", path: "?tour=1", check: (p, shoot) => tour(p, shoot) },
  {
    name: "tour-recap",
    path: "?match=match-1&play=recap&tour=recap",
    check: (p, shoot) => tour(p, shoot, match),
  },
  {
    name: "phone-tour",
    path: "?tour=1",
    device: PHONE,
    check: (p, shoot) => tour(p, shoot),
  },
  {
    // a narrow desktop: from 901 px the viewer button shows its full label, and the hero's header
    // also carries Your call and Take his eyes; checked like a phone's (no overlap, on screen)
    name: "desktop-960-hero",
    path: "?intro=0",
    device: { viewport: { width: 960, height: 800 } },
    check: (p) => phone(p, hero),
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
  await see(page.getByRole("region", { name: "Key moments" }), "the Moments panel", "attached");
}

/** The key-moment beat on the 3D view: pushed in (or not, under reduced motion) and the runner
 * ringed; the canvas says so in data-beat-push and data-beat-ring (beat/BeatLayers.tsx). */
async function beat(page, { push }) {
  await hero(page);
  const canvas = page
    .getByRole("figure", { name: /^(First-person|Broadcast) view$/ })
    .locator("canvas");
  try {
    await page.waitForFunction(
      ([el, want]) => Number(el.dataset.beatRing) > 0 && Number(el.dataset.beatPush) === want,
      [await canvas.elementHandle(), push],
    );
  } catch {
    const data = await canvas.evaluate((el) => ({ ...el.dataset }));
    throw new Error(`expected the beat with push ${push} and a ring, got ${JSON.stringify(data)}`);
  }
}

/** A hero moment drawn at a render tier: the 3D canvas carries data-quality once the tier's
 * chunk has loaded and taken over drawing. */
async function tier(page, want) {
  await hero(page);
  const canvas = page.locator(".view.pov canvas");
  try {
    await page.waitForFunction(
      ([el, t]) => el.dataset.quality === t,
      [await canvas.elementHandle(), want],
    );
  } catch {
    const data = await canvas.evaluate((el) => ({ ...el.dataset }));
    throw new Error(`expected the ${want} tier on the 3D canvas, got ${JSON.stringify(data)}`);
  }
}

/** The first-person head-turn blur is off by default (Bowen: blur is uncomfortable): play through
 * the key scan, where his head whips round, and the canvas stays sharp. Then turn "Motion blur"
 * on in View options, play into the scan again, cut to the broadcast camera and back, and read
 * the blur on the frames right after each cut: it must be 0. */
async function cutNoBlur(page) {
  await hero(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  // The replay opens inside the key scan (frames 50-70); play past its end.
  const byDefault = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = document.querySelector(".view.pov canvas");
    const timeline = document.querySelector('input[aria-label="Timeline"]');
    const t0 = performance.now();
    let most = 0;
    while (Number(timeline.value) < 72 && performance.now() - t0 < 20_000) {
      await frame();
      most = Math.max(most, Number(el.dataset.blurSigma ?? 0));
    }
    return { most, frame: Number(timeline.value) };
  });
  if (byDefault.frame < 72)
    throw new Error(`play did not pass the key scan (frame ${byDefault.frame})`);
  if (byDefault.most > 0) {
    throw new Error(`expected no head-turn blur by default, got sigma ${byDefault.most} px`);
  }

  await page.goto(page.url());
  await hero(page);
  await page.getByRole("button", { name: "View options" }).click();
  const blur = page.getByRole("button", { name: "Motion blur" });
  await blur.click();
  if ((await blur.getAttribute("aria-pressed")) !== "true")
    throw new Error("Motion blur did not turn on");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const canvas = page.locator(".view.pov canvas");
  // Turned on, the blur comes on as his head whips round.
  await page.waitForFunction(
    (el) => Number(el.dataset.blurSigma) > 0,
    await canvas.elementHandle(),
    {
      timeout: 15_000,
    },
  );
  const after = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = document.querySelector(".view.pov canvas");
    const pick = (name) =>
      [...document.querySelectorAll('[aria-label="Camera"] button')]
        .find((b) => b.textContent.trim() === name)
        .click();
    const seen = [];
    for (const name of ["Broadcast", "His eyes"]) {
      pick(name);
      for (let k = 0; k < 4; k++) {
        await frame();
        seen.push(Number(el.dataset.blurSigma ?? 0));
      }
    }
    return seen;
  });
  if (after.some((sigma) => sigma > 0)) {
    throw new Error(`expected no blur right after a camera cut, got sigma ${after.join(", ")} px`);
  }
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

/** `?tour=1`, the judges' tour (SPEC 7, web/src/tour/), or its match steps (the recap): its card
 * on screen at every step and no sideways scroll, Next through to the end without pressing the
 * steps' own buttons (the drill would run the crew), then Done closes it and the page works as
 * before. A tour link opens
 * paused (no stream), so the phone's header check, which wants the stream running, is not run. */
async function tour(page, shoot, after = hero) {
  const card = page.getByRole("dialog").filter({ hasText: /^Tour · \d+ of \d+/ });
  for (let k = 1; ; k++) {
    await see(card.filter({ hasText: new RegExp(`^Tour · ${k} of `) }), `the tour's step ${k}`);
    const [box, size] = await Promise.all([
      card.boundingBox(),
      page.evaluate(() => [innerWidth, innerHeight, document.documentElement.scrollWidth]),
    ]);
    const [w, h, wide] = size;
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > w || box.y + box.height > h) {
      throw new Error(`expected the tour's step ${k} card on screen, got ${JSON.stringify(box)}`);
    }
    if (wide > w) throw new Error(`expected no sideways scroll at step ${k}: ${wide} px in ${w}`);
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
  await after(page);
}

/** `?play=eyes`: Take his eyes (SPEC 7) in the live screen's place: the board with the dial, the
 * times and the directions to look; a look plays through his eyes, and the result airs its
 * verified lines. */
async function takeEyes(page) {
  await see(page.getByRole("region", { name: "Take his eyes" }), "Take his eyes");
  await see(page.getByRole("radiogroup", { name: "When he looks" }), "the times to look");
  await see(page.getByRole("radiogroup", { name: /^Where [HA]\d+ looks$/ }), "the directions");
  await mainView(page, "board");
  await page.getByRole("button", { name: "Look", exact: true }).click();
  const play = page.getByRole("button", { name: "See what he does" });
  await see(play, "the look playing through his eyes");
  await play.click();
  await see(page.getByRole("list", { name: "Verified lines" }), "the look's verified lines");
}

/** `?match=match-1&play=recap`: the end-of-match recap (SPEC 6), written offline here: the
 * full-time card on the live screen, the recap card with a Watch per key moment, and the reel's
 * captions once it plays. */
async function recap(page, shoot) {
  await match(page);
  await see(page.getByRole("region", { name: "Full time", exact: true }), "the full-time card");
  const card = page.getByRole("region", { name: "Full time · the recap" });
  await see(card.getByRole("button", { name: "Watch", exact: true }), "a key moment's Watch");
  await shoot("card");
  await page.getByRole("button", { name: "Play the recap reel" }).first().click();
  await see(page.locator(".recap-caption").filter({ hasText: /\S/ }), "a caption of the reel");
  await page.waitForTimeout(SETTLE);
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
 * there). `live: false` for a screen that takes the live screen's place (Take his eyes). */
async function phone(page, check, { live = true } = {}) {
  await check(page);
  if (live) {
    await see(page.locator(".live-status.streaming"), "the live stream running", "attached");
    // Once the lineup card is gone the header still says what this is (SPEC 0): name and note.
    await see(page.locator(".stage-head .brand h1"), "the product name in the header");
    // The note shows on a phone's header (up to 480 px); a tablet and a narrow desktop hide it.
    if ((page.viewportSize()?.width ?? 0) <= 480) {
      await see(
        page.locator(".stage-head .brand .sub").filter({ hasText: /synthetic match/i }),
        'the "synthetic match" note in the header',
      );
    }
  }
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
      // 1 px or less: visually hidden for screen readers (the brand on a phone), not on screen.
      return rect.width > 1 && rect.height > 1 && getComputedStyle(el).visibility !== "hidden";
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
    // Accessibility (docs/ACCESSIBILITY.md): axe's WCAG 2.2 A/AA rules on the page as it is now.
    // A serious or critical violation fails the page; a lesser one is a note.
    const { violations } = await axe(tab, { tags: WCAG });
    const blocking = violations.filter((v) => BLOCKING.has(v.impact));
    for (const line of describe(blocking)) errors.push(`axe: ${line}`);
    for (const line of describe(violations.filter((v) => !blocking.includes(v)))) {
      notes.push(`axe: ${line}`);
    }
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
