// Capture kit for the demo video (SPEC 10). Records every shot of shots.json from the public site
// to WebM, then writes one still per shot, a contact sheet, the voice-over script with its numbers
// read off the page's verified claims, and a manifest. Usage and options: README.md, or --help.
//
// Each shot loads its URL in a fresh browser context, runs its `setup` off camera, then records
// its `actions`. Waits are selectors on the app's own DOM (or network idle), never sleeps; `hold`
// is screen time. Frames come from the browser's screencast with their swap times; after the shot
// they are written out at a constant frame rate (VP8 WebM) by the ffmpeg that ships with
// Playwright, so encoding never competes with capture.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { claimTable, fill } from "./lib/claims.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const USAGE = `Usage: npm run capture -- [options]

  --only <ids>         comma-separated shot ids or prefixes (e.g. 03,04-with-without)
  --base-url <url>     record another deployment of the app (e.g. a local stack) instead of the
                       site in shots.json; every shot URL keeps its path and query
  --out <dir>          output directory (default: <repo>/out/video)
  --fps <n>            output frame rate, 30-60 (default: 60)
  --quality <n>        JPEG quality of captured frames, 50-100 (default: 90)
  --headed             show the browser
  --software-gl        draw WebGL with SwiftShader (the CPU) instead of the GPU (Metal on macOS)
  --chromium <path>    Chromium executable to use instead of Playwright's
  --ffmpeg <path>      ffmpeg to encode with (default: the one Playwright installs)
  --no-harvest         skip reading the verified claims (the voice-over uses its fallbacks)
  --list               print the shot plan and exit (no browser)
  -h, --help           this text`;

const DEFAULT_TIMEOUT_S = 20;

// --- the shot list -------------------------------------------------------------------------------

// Action vocabulary of shots.json; tests/test_video_shots.py reads these two objects' keys.
const ACTIONS = {
  wait: ["for"],
  click: [],
  select: ["label", "value"],
  fill: ["label", "text"],
  scroll: [],
  hold: ["s"],
  drag: ["from", "to"],
};

const STATUSES = ["ready", "stand-in", "pending feature", "external"];
const CAPTURED = new Set(["ready", "stand-in"]);

function validate(doc) {
  const problems = [];
  if (!Array.isArray(doc.shots) || doc.shots.length === 0) problems.push("no shots");
  const ids = new Set();
  for (const shot of doc.shots ?? []) {
    const where = `shot ${shot.id ?? "?"}`;
    if (!shot.id || ids.has(shot.id)) problems.push(`${where}: missing or duplicate id`);
    ids.add(shot.id);
    if (!STATUSES.includes(shot.status)) problems.push(`${where}: unknown status ${shot.status}`);
    if (!(shot.target_s > 0)) problems.push(`${where}: target_s must be > 0`);
    if (CAPTURED.has(shot.status) && !shot.url) problems.push(`${where}: no url`);
    for (const a of [...(shot.setup ?? []), ...(shot.actions ?? [])]) {
      const fields = ACTIONS[a.do];
      if (!fields) problems.push(`${where}: unknown action ${a.do}`);
      else
        for (const f of fields)
          if (a[f] === undefined) problems.push(`${where}: ${a.do} needs ${f}`);
      if (a.do === "wait" && !WAITS[a.for]) problems.push(`${where}: unknown wait ${a.for}`);
      if (a.do === "click" && !a.selector && !a.role)
        problems.push(`${where}: click needs a target`);
      if (a.do === "scroll" && a.to === undefined && a.y === undefined)
        problems.push(`${where}: scroll needs to or y`);
    }
  }
  return problems;
}

/** The shot's URL on `base` (another deployment), keeping its path and query. */
function rebase(url, base) {
  if (!base) return url;
  const u = new URL(url);
  return new URL(u.pathname.replace(/^\//, "") + u.search, base.endsWith("/") ? base : `${base}/`)
    .href;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Planned start of every shot on the video's timeline (targets added up). */
function timeline(shots) {
  let t = 0;
  return shots.map((shot) => {
    const at = t;
    t += shot.target_s;
    return { shot, start: at, end: t };
  });
}

// --- waits on the app's DOM ----------------------------------------------------------------------

const afterFrames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = (k) => (k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
        step(n);
      }),
    n,
  );

const breakdownButton = (page, name) =>
  page.locator(".panel.breakdown").getByRole("button", { name, exact: true });

const WAITS = {
  /** The match is loaded, both views have a canvas, fonts and the player model are in. */
  async assets(page, a, timeout) {
    await page.locator("header .brand h1, .load-error").first().waitFor({ timeout });
    const error = page.locator(".load-error");
    if (await error.count()) throw new Error(await error.innerText());
    // A shot that opens on the lineup card (covered: true) waits for the canvases behind it.
    const state = a.covered ? "attached" : "visible";
    await page.locator(".view.pov canvas").waitFor({ state, timeout });
    // views: ["pov"] for a shot that shows only the 3D view (the broadcast camera, focused).
    if (!a.views || a.views.includes("tac"))
      await page.locator(".view.tac canvas").waitFor({ state, timeout });
    await page.waitForLoadState("networkidle", { timeout });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Animated players unless the address asks for the tokens (players/trial.ts).
    if (new URL(page.url()).searchParams.get("rigged") !== "0") {
      await page.waitForFunction(
        () => performance.getEntriesByType("resource").some((e) => /\.glb(\?|$)/.test(e.name)),
        null,
        { timeout },
      );
    }
    await afterFrames(page, 3);
  },
  /** The page follows the live WebSocket stream. */
  live: (page, a, timeout) => page.locator(".live-status.streaming").waitFor({ timeout }),
  /** The stream has detected the hero moment. */
  moment: (page, a, timeout) => page.locator(".moment-list li.hero").waitFor({ timeout }),
  /** The breakdown for `persona` / `language` is on screen (cached, generated or template). */
  async breakdown(page, a, timeout) {
    const want = `${a.persona ?? "casual"} · ${a.language ?? "en"}`;
    const handle = await page.waitForFunction(
      (want) => {
        const panel = document.querySelector(".panel.narration");
        if (!panel) return null;
        const failed = panel.querySelector(".plan-errors");
        if (failed) return { failed: failed.textContent.trim() };
        if (panel.querySelector(".note.waiting")) return null;
        const meta = panel.querySelector(".breakdown-head .meta")?.textContent?.trim();
        const ready = document.querySelector(".panel.breakdown .plan-badge");
        return meta === want && ready ? { ok: true } : null;
      },
      want,
      { timeout },
    );
    const result = await handle.jsonValue();
    if (result.failed) throw new Error(result.failed);
  },
  "breakdown-running": (page, a, timeout) => breakdownButton(page, "Stop").waitFor({ timeout }),
  "breakdown-done": (page, a, timeout) =>
    breakdownButton(page, "Replay breakdown").waitFor({ timeout }),
  /** A narration caption is over the first-person view. */
  caption: (page, a, timeout) => page.locator(".caption").waitFor({ timeout }),
  /** A caption that has claims behind it (it shows "Evidence ›"). */
  "caption-with-evidence": (page, a, timeout) =>
    page.locator(".caption .caption-more").waitFor({ timeout }),
  evidence: (page, a, timeout) => page.locator("section.evidence").waitFor({ timeout }),
  /** Any element, by CSS selector; `state` as in Playwright ("visible" by default, or "detached"). */
  selector: (page, a, timeout) =>
    page.locator(a.selector).first().waitFor({ state: a.state ?? "visible", timeout }),
  /** A what-if answer (or refusal) is shown; with `question`, the answer to that question. */
  "whatif-answer": (page, a, timeout) => {
    const asked = page.locator(".panel.whatif .answer .asked");
    return (a.question ? asked.filter({ hasText: a.question }) : asked)
      .first()
      .waitFor({ timeout });
  },
};

// --- actions -------------------------------------------------------------------------------------

function locate(page, a) {
  const scope = a.within ? page.locator(a.within) : page;
  if (a.selector) return scope.locator(a.selector).first();
  if (a.role) return scope.getByRole(a.role, { name: a.name, exact: a.exact ?? true });
  // Not exact by default: a <label> wrapping a <select> also holds the options' text.
  return scope.getByLabel(a.label, { exact: a.exact ?? false });
}

async function act(page, a) {
  const timeout = (a.timeout_s ?? DEFAULT_TIMEOUT_S) * 1000;
  switch (a.do) {
    case "wait":
      await WAITS[a.for](page, a, timeout);
      break;
    case "click":
      await locate(page, a).click({ timeout });
      break;
    case "select":
      await locate(page, { label: a.label, within: a.within, exact: a.exact }).selectOption(
        a.value,
        {
          timeout,
        },
      );
      break;
    case "fill": {
      // Typed key by key, so the viewer sees the question being written.
      const input = locate(page, { label: a.label, within: a.within, exact: a.exact });
      await input.fill("", { timeout });
      await input.pressSequentially(a.text, { delay: a.key_delay_ms ?? 30, timeout });
      break;
    }
    case "scroll":
      if (a.to !== undefined) {
        await page
          .locator(a.to)
          .first()
          .evaluate(
            (el, block) => el.scrollIntoView({ block, behavior: "instant" }),
            a.block ?? "start",
          );
      } else {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), a.y);
      }
      await afterFrames(page, 2);
      break;
    case "hold":
      await page.waitForTimeout(a.s * 1000); // screen time, not synchronisation
      break;
    case "drag": {
      // From one element's centre to another's, by the mouse, so the viewer sees the drag.
      // With `around` (a selector), the pointer travels on an arc about that element's centre
      // instead of a straight line (a dial is dragged round, not through its middle).
      const centre = async (target) => {
        const box = await locate(page, target).boundingBox({ timeout });
        if (!box) throw new Error(`drag: ${describe(target)} is not on screen`);
        return [box.x + box.width / 2, box.y + box.height / 2];
      };
      const [x0, y0] = await centre(a.from);
      const [x1, y1] = await centre(a.to);
      const steps = a.steps ?? 30;
      const ms = ((a.duration_s ?? 1) * 1000) / steps;
      let path;
      if (a.around) {
        const [cx, cy] = await centre({ selector: a.around });
        // radius_scale < 1 keeps the pointer inside the targets' ring, off the buttons that sit on it.
        const k = a.radius_scale ?? 1;
        const r0 = k * Math.hypot(x0 - cx, y0 - cy);
        const r1 = k * Math.hypot(x1 - cx, y1 - cy);
        const t0 = Math.atan2(y0 - cy, x0 - cx);
        let dt = Math.atan2(y1 - cy, x1 - cx) - t0;
        if (a.clockwise === true && dt < 0) dt += 2 * Math.PI;
        if (a.clockwise === false && dt > 0) dt -= 2 * Math.PI;
        path = (u) => [cx + (r0 + (r1 - r0) * u) * Math.cos(t0 + dt * u), cy + (r0 + (r1 - r0) * u) * Math.sin(t0 + dt * u)];
      } else path = (u) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
      const [sx, sy] = path(0);
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let k = 1; k <= steps; k++) {
        const [x, y] = path(k / steps);
        await page.mouse.move(x, y);
        await page.waitForTimeout(ms);
      }
      await page.mouse.up();
      break;
    }
  }
  if (a.hold) await page.waitForTimeout(a.hold * 1000);
}

const describe = (a) =>
  a.do === "wait"
    ? `wait ${a.for}${a.persona ? ` ${a.persona}/${a.language ?? "en"}` : ""}`
    : a.do === "click"
      ? `click ${a.name ?? a.selector}`
      : a.do === "select"
        ? `select ${a.label} = ${a.value}`
        : a.do === "fill"
          ? `type "${a.text}"`
          : a.do === "scroll"
            ? `scroll ${a.to ?? a.y}`
            : a.do === "drag"
              ? `drag ${a.from.name ?? a.from.selector} → ${a.to.name ?? a.to.selector}`
              : `hold ${a.s} s`;

// --- what the page shows -------------------------------------------------------------------------

/** Badges that say where the breakdown on screen came from, and whether the API answered. */
const pageState = (page) =>
  page.evaluate(() => {
    const texts = (s) =>
      [...document.querySelectorAll(s)].map((e) => e.textContent.trim()).filter(Boolean);
    const box = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    return {
      offline: !!document.querySelector("header .data-badge"),
      narration: texts(
        ".panel.narration .breakdown-head .meta, .panel.narration .breakdown-head .plan-badge",
      ),
      fixture: !!document.querySelector(".panel.narration .plan-badge[data-fixture]"),
      plan: texts(".panel.breakdown .breakdown-head .plan-badge"),
      live: document.querySelector(".live-status")?.textContent?.trim() ?? null,
      crop: {
        pov: box(".view.pov .canvas-wrap"),
        tactical: box(".view.tac .canvas-wrap"),
        stage: box(".stage"),
      },
    };
  });

function warningsOf(state) {
  const w = [];
  if (state.offline)
    w.push("Offline data: the site did not reach the API and played its bundled files");
  if (state.fixture) w.push("narration is the unverified fixture");
  for (const b of ["Template", "Rate-limited", "Daily cap reached"])
    if (state.narration.includes(b)) w.push(`narration badge: ${b}`);
  for (const b of ["Server template", "Template plan (fallback)"])
    if (state.plan.includes(b)) w.push(`plan badge: ${b}`);
  return w;
}

/** Open every narration line and read the claims its evidence card shows (SPEC 7). */
async function readClaims(page, persona, language) {
  const state = await pageState(page);
  const verified = !state.offline && !state.fixture;
  const buttons = page.locator(".panel.narration ol.lines li:not(.withheld) > button");
  const lines = [];
  for (let k = 0; k < (await buttons.count()); k++) {
    const button = buttons.nth(k);
    const id = (await button.locator(".t").innerText()).trim();
    const label = await button.innerText();
    await button.click();
    await page.waitForFunction((label) => {
      const p = document.querySelector("section.evidence .evidence-line");
      return p && label.includes(p.textContent.trim());
    }, label);
    const text = (await page.locator("section.evidence .evidence-line").innerText()).trim();
    const claims = await page.$$eval("section.evidence li.claim", (els) =>
      els.map((el) => ({
        id: el.querySelector(".claim-head code")?.textContent?.trim(),
        verdict: el.querySelector(".claim-verdict")?.textContent?.trim(),
        kind: [...el.classList].find((c) => c.startsWith("kind-"))?.slice(5),
        values: Object.fromEntries(
          [...el.querySelectorAll("dl.values > div")].map((d) => [
            // The machine name (e.g. dxt) is the dt's title; its text is a label for viewers.
            (d.querySelector("dt").getAttribute("title") || d.querySelector("dt").textContent).trim(),
            d.querySelector("dd").textContent.trim(),
          ]),
        ),
      })),
    );
    lines.push({ id, text, claims });
  }
  return { persona, language, verified, badges: state.narration, lines };
}

async function harvest(browser, doc, opts) {
  const page = await newPage(browser, doc.viewport);
  try {
    await page.goto(rebase(`${doc.site}/?autoplay=0&intro=0`, opts.base), { waitUntil: "load" });
    await act(page, { do: "wait", for: "assets" });
    await act(page, { do: "click", role: "button", name: "Ask now" });
    let current = { persona: "casual", language: "en" };
    await act(page, { do: "wait", for: "breakdown", ...current, timeout_s: 90 });
    const sources = [];
    for (const want of doc.harvest) {
      if (want.persona !== current.persona)
        await act(page, { do: "select", label: "Audience", value: want.persona });
      if (want.language !== current.language) {
        const name = want.language === "zh" ? "中文" : want.language.toUpperCase();
        await act(page, {
          do: "click",
          within: "[aria-label='Narration language']",
          role: "button",
          name,
        });
      }
      current = want;
      await act(page, { do: "wait", for: "breakdown", ...want, timeout_s: 90 });
      sources.push(await readClaims(page, want.persona, want.language));
    }
    return sources;
  } finally {
    await page.context().close();
  }
}

/** The shot's voice-over with its {claim.value} slots filled from verified claims, or its fallback. */
function voiceOver(shot, claims) {
  const { text, used, missing } = fill(shot.vo, claims);
  if (!missing.length) return { text, used, missing };
  if (shot.vo_fallback) return { text: shot.vo_fallback, used: [], missing, fallback: true };
  return { text, used, missing };
}

/** Chromium flags for WebGL on the GPU: headless Chromium otherwise draws WebGL with SwiftShader,
 * its CPU rasteriser (about a dozen fps here). On macOS that means ANGLE on Metal. */
function gpuArgs(software) {
  if (software) return ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  return ["--ignore-gpu-blocklist", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])];
}

/** Recorded shots of an earlier manifest whose clip still exists, minus those re-run now. */
function previousShots(file, results) {
  if (!existsSync(file)) return {};
  try {
    const old = JSON.parse(readFileSync(file, "utf8"));
    const dir = path.dirname(file);
    return Object.fromEntries(
      (old.shots ?? [])
        .filter((s) => s.ok && !(s.id in results) && s.video && existsSync(path.join(dir, s.video)))
        .map(({ start, end, vo, ...rest }) => [rest.id, rest]),
    );
  } catch {
    return {};
  }
}

// --- recording -----------------------------------------------------------------------------------

async function newPage(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "en-US",
    colorScheme: "dark",
    reducedMotion: "no-preference", // reduced motion would turn the app's autoplay off
  });
  // Headed Chromium draws scrollbars into the frames; hide them.
  await context.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "html::-webkit-scrollbar{display:none} html{scrollbar-width:none}";
      document.head.append(style);
    });
  });
  return context.newPage();
}

/** Screencast frames (JPEG, with their swap times) written to `dir` while recording. */
class Recorder {
  constructor(page, dir, size, quality) {
    Object.assign(this, { page, dir, size, quality, frames: [], latest: null });
  }
  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    await this.page.screencast.start({
      size: this.size,
      quality: this.quality,
      onFrame: ({ data, timestamp }) => {
        const file = path.join(this.dir, `${this.frames.length}.jpg`);
        writeFileSync(file, data);
        this.frames.push({ t: timestamp, file });
        this.latest = data;
      },
    });
    this.t0 = Date.now();
  }
  async stop() {
    this.t1 = Date.now();
    await this.page.screencast.stop();
  }
  /** Distinct frames the browser delivered per second while recording. */
  capturedFps() {
    const n = this.frames.filter((f) => f.t >= this.t0 && f.t <= this.t1).length;
    return n / ((this.t1 - this.t0) / 1000);
  }
}

/** Write the frames at a constant `fps` (each output frame shows the latest frame swapped by
 * then) into a VP8 WebM. Returns the number of frames written. */
async function encode(ffmpeg, rec, fps, out) {
  if (!rec.frames.length) throw new Error("the screencast delivered no frames");
  const args = [
    ...["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg"],
    ...["-framerate", String(fps), "-i", "pipe:0", "-an", "-c:v", "libvpx", "-pix_fmt", "yuv420p"],
    ...["-b:v", "16M", "-crf", "4", "-qmin", "0", "-qmax", "30", "-auto-alt-ref", "0"],
    ...[
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      "-threads",
      String(Math.min(8, availableParallelism())),
    ],
    ...["-y", out],
  ];
  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  proc.stdin.on("error", () => {}); // a dead ffmpeg is reported by its exit code below
  const done = new Promise((resolve, reject) => {
    proc.on("error", (err) => reject(new Error(`cannot run ffmpeg (${ffmpeg}): ${err.message}`)));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`)),
    );
  });
  const n = Math.max(1, Math.round(((rec.t1 - rec.t0) * fps) / 1000));
  let shown = -1;
  let jpeg = null;
  for (let k = 0; k < n; k++) {
    const t = rec.t0 + (k * 1000) / fps;
    let j = Math.max(shown, 0);
    while (j + 1 < rec.frames.length && rec.frames[j + 1].t <= t) j++;
    if (j !== shown) {
      shown = j;
      jpeg = readFileSync(rec.frames[j].file);
    }
    if (!proc.stdin.write(jpeg)) await Promise.race([once(proc.stdin, "drain"), done]);
  }
  proc.stdin.end();
  await done;
  return n;
}

async function captureShot(browser, shot, opts, outDir) {
  const page = await newPage(browser, shot.viewport);
  const problems = [];
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const rec = new Recorder(page, path.join(outDir, "frames", shot.id), shot.viewport, opts.quality);
  const log = [];
  const result = {
    id: shot.id,
    status: shot.status,
    url: rebase(shot.url, opts.base),
    log,
    problems,
  };
  let phase = "setup";
  try {
    await page.goto(result.url, { waitUntil: "load" });
    for (const a of shot.setup ?? []) await act(page, a);
    phase = "recording";
    await rec.start();
    let still = null;
    for (const a of shot.actions) {
      const t = (Date.now() - rec.t0) / 1000;
      await act(page, a);
      log.push({ t: +t.toFixed(2), action: describe(a) });
      if (a.still) still = { data: rec.latest, state: await pageState(page) };
    }
    await rec.stop();
    still ??= { data: rec.latest, state: await pageState(page) };
    phase = "encoding";
    const stillPath = path.join(outDir, "stills", `${shot.id}.jpg`);
    writeFileSync(stillPath, still.data ?? (await page.screenshot({ type: "jpeg", quality: 90 })));
    const video = path.join(outDir, `${shot.id}.webm`);
    const written = await encode(opts.ffmpeg, rec, opts.fps, video);
    Object.assign(result, {
      ok: true,
      video: path.relative(outDir, video),
      still: path.relative(outDir, stillPath),
      duration_s: +((rec.t1 - rec.t0) / 1000).toFixed(2),
      fps: opts.fps,
      frames_written: written,
      captured_fps: +rec.capturedFps().toFixed(1),
      badges: { narration: still.state.narration, plan: still.state.plan, live: still.state.live },
      crop: still.state.crop,
      warnings: warningsOf(still.state),
    });
  } catch (err) {
    const stillPath = path.join(outDir, "stills", `${shot.id}_FAILED.jpg`);
    await page.screenshot({ path: stillPath, type: "jpeg", quality: 90 }).catch(() => {});
    Object.assign(result, {
      ok: false,
      error: `${phase}: ${err.message.split("\n")[0]}`,
      still: existsSync(stillPath) ? path.relative(outDir, stillPath) : null,
    });
  } finally {
    rmSync(rec.dir, { recursive: true, force: true });
    await page.context().close();
  }
  return result;
}

async function findFfmpeg(given) {
  if (given) return given;
  try {
    const core = await import("playwright-core/lib/coreBundle");
    const { registry } = (core.default ?? core).registry;
    const exe = registry.findExecutable("ffmpeg")?.executablePath();
    if (exe && existsSync(exe)) return exe;
  } catch {
    // fall through to an ffmpeg on PATH
  }
  return "ffmpeg";
}

// --- reports -------------------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function contactSheet(doc, plan, results, vo, meta) {
  const tiles = plan.map(({ shot, start, end }) => {
    const r = results[shot.id];
    const v = vo[shot.id];
    const pill = !CAPTURED.has(shot.status)
      ? shot.status
      : !r
        ? "not run"
        : r.ok
          ? shot.status === "stand-in"
            ? "stand-in · pending feature"
            : "ok"
          : "FAILED";
    const cls = pill === "ok" ? "ok" : pill === "FAILED" ? "bad" : "note";
    const img = r?.still
      ? `<img src="${esc(r.still)}" alt="${esc(shot.id)}">`
      : `<div class="placeholder">${esc(shot.pending ?? "not captured")}</div>`;
    const facts = r?.ok
      ? `${r.duration_s} s recorded (target ${shot.target_s} s) · ${r.captured_fps} captured fps → ${r.fps} fps`
      : r && !r.ok
        ? esc(r.error)
        : `target ${shot.target_s} s`;
    const badges = r?.ok ? [...r.badges.narration, ...r.badges.plan].join(" · ") : "";
    const warn = [
      ...(r?.warnings ?? []),
      ...(v.missing.length ? [`VO slots not on the page: ${v.missing.join(", ")}`] : []),
      ...(shot.status === "stand-in" ? [shot.pending] : []),
    ];
    return `<figure>
  ${img}
  <figcaption>
    <div class="head"><b>${esc(shot.id)}</b><span>${clock(start)}–${clock(end)} · SPEC ${esc(shot.spec_beat)}</span><i class="${cls}">${esc(pill)}</i></div>
    <div class="title">${esc(shot.title)}</div>
    <div class="facts">${facts}${badges ? ` · ${esc(badges)}` : ""}</div>
    ${warn.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
    <div class="vo">VO: ${esc(v.text)}</div>
  </figcaption>
</figure>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contact sheet</title>
<style>
  body { margin: 0; padding: 24px; background: #101512; color: #dfe7e1; font: 14px/1.4 system-ui, sans-serif; width: 1752px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #9fb0a5; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  figure { margin: 0; background: #18201b; border: 1px solid #2a352e; border-radius: 6px; overflow: hidden; }
  img, .placeholder { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  .placeholder { display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; box-sizing: border-box; color: #9fb0a5; background: repeating-linear-gradient(45deg, #18201b 0 12px, #1d2620 12px 24px); }
  figcaption { padding: 10px 12px 12px; }
  .head { display: flex; gap: 10px; align-items: baseline; }
  .head span { color: #9fb0a5; flex: 1; }
  .head i { font-style: normal; font-size: 12px; padding: 1px 8px; border-radius: 10px; }
  .ok { background: #1f5133; } .bad { background: #7a2323; } .note { background: #5a4a17; }
  .title { margin: 4px 0; }
  .facts { color: #9fb0a5; font-size: 12px; }
  .warn { color: #f0c36a; font-size: 12px; }
  .vo { margin-top: 6px; font-style: italic; }
</style></head>
<body>
  <h1>Through Their Eyes · demo video contact sheet</h1>
  <div class="meta">${esc(meta)}</div>
  <div class="grid">${tiles.join("\n")}</div>
</body></html>`;
}

function voiceOverScript(plan, vo, results, meta) {
  const total = plan.at(-1).end;
  const out = [
    "# Voice-over script",
    "",
    `${meta}. Planned length ${clock(total)}.`,
    "",
    "Numbers come only from verified claims read off the page (claims.json). A sentence whose",
    "number the page did not show falls back to a version without it; never type a number in.",
    "",
  ];
  for (const { shot, start, end } of plan) {
    const v = vo[shot.id];
    const r = results[shot.id];
    out.push(`## ${shot.id} · ${clock(start)}–${clock(end)} (${shot.target_s} s) · ${shot.status}`);
    out.push("");
    out.push(`> ${v.text}`);
    out.push("");
    if (v.used.length)
      out.push(
        `Numbers: ${v.used.map((u) => `${u.value} from ${u.slot}, seen in ${u.seen}`).join("; ")}`,
      );
    if (v.missing.length)
      out.push(`Not on the page: ${v.missing.join(", ")}${v.fallback ? " (fallback used)" : ""}`);
    if (r?.ok)
      out.push(
        `Clip: ${r.video}, ${r.duration_s} s; cues: ${r.log.map((l) => `${l.t} s ${l.action}`).join("; ")}`,
      );
    else if (r) out.push(`Clip: FAILED (${r.error})`);
    else if (shot.pending) out.push(`Not captured: ${shot.pending}`);
    out.push("");
  }
  return out.join("\n");
}

// --- main ----------------------------------------------------------------------------------------

async function main() {
  const { values: args } = parseArgs({
    options: {
      only: { type: "string" },
      "base-url": { type: "string" },
      out: { type: "string", default: path.join(ROOT, "out", "video") },
      fps: { type: "string", default: "60" },
      quality: { type: "string", default: "90" },
      headed: { type: "boolean", default: false },
      chromium: { type: "string" },
      ffmpeg: { type: "string" },
      "no-harvest": { type: "boolean", default: false },
      "software-gl": { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (args.help) return console.log(USAGE);
  const doc = JSON.parse(readFileSync(path.join(HERE, "shots.json"), "utf8"));
  const problems = validate(doc);
  if (problems.length) throw new Error(`shots.json:\n  ${problems.join("\n  ")}`);
  const plan = timeline(doc.shots);
  const fps = Number(args.fps);
  const quality = Number(args.quality);
  if (!(fps >= 30 && fps <= 60)) throw new Error("--fps must be between 30 and 60");
  if (!(quality >= 50 && quality <= 100)) throw new Error("--quality must be between 50 and 100");
  const base = args["base-url"] ?? null;
  const only = args.only?.split(",").map((s) => s.trim());
  const chosen = plan.filter(
    ({ shot }) => CAPTURED.has(shot.status) && (!only || only.some((o) => shot.id.startsWith(o))),
  );

  if (args.list) {
    for (const { shot, start, end } of plan)
      console.log(
        `${clock(start)}–${clock(end)}  ${shot.id.padEnd(18)} ${shot.status.padEnd(16)} ${shot.url ? rebase(shot.url, base) : "-"}`,
      );
    return;
  }

  const outDir = path.resolve(args.out);
  mkdirSync(path.join(outDir, "stills"), { recursive: true });
  const opts = { base, fps, quality, ffmpeg: await findFfmpeg(args.ffmpeg) };
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: !args.headed,
    executablePath: args.chromium,
    args: ["--hide-scrollbars", ...gpuArgs(args["software-gl"])],
  });
  const site = base ?? doc.site;
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const meta = `Recorded ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${site} · shot list at ${commit.stdout.trim() || "?"} · Chromium ${browser.version()}${args.headed ? " (headed)" : " (headless)"}`;

  let claims = null;
  try {
    if (!args["no-harvest"] && doc.harvest?.length) {
      console.log("reading the verified claims off the page…");
      const sources = await harvest(browser, doc, opts);
      claims = claimTable(sources);
      writeFileSync(
        path.join(outDir, "claims.json"),
        `${JSON.stringify({ site, sources, claims }, null, 2)}\n`,
      );
    }
  } catch (err) {
    console.error(`  could not read the claims: ${err.message.split("\n")[0]}`);
  }

  const results = {};
  for (const { shot } of chosen) {
    process.stdout.write(`${shot.id}… `);
    const r = await captureShot(browser, shot, opts, outDir);
    results[shot.id] = r;
    console.log(
      r.ok
        ? `${r.duration_s} s, ${r.captured_fps} captured fps${r.warnings.length ? ` · ${r.warnings.join("; ")}` : ""}`
        : `FAILED: ${r.error}`,
    );
  }

  const vo = Object.fromEntries(doc.shots.map((s) => [s.id, voiceOver(s, claims)]));
  writeFileSync(path.join(outDir, "voiceover.md"), voiceOverScript(plan, vo, results, meta));
  // A run with --only keeps what earlier runs recorded for the other shots (their clips stay).
  const previous = previousShots(path.join(outDir, "manifest.json"), results);
  const manifest = {
    meta,
    site,
    fps,
    shots: plan.map(({ shot, start, end }) => ({
      id: shot.id,
      start,
      end,
      ...(results[shot.id] ??
        previous[shot.id] ?? { status: shot.status, captured: false }),
      vo: vo[shot.id],
    })),
  };
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const sheet = path.join(outDir, "contact_sheet.html");
  writeFileSync(sheet, contactSheet(doc, plan, results, vo, meta));
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  await page.goto(pathToFileURL(sheet).href, { waitUntil: "load" });
  await page.screenshot({
    path: path.join(outDir, "contact_sheet.jpg"),
    type: "jpeg",
    quality: 85,
    fullPage: true,
  });
  await browser.close();
  rmSync(path.join(outDir, "frames"), { recursive: true, force: true });

  const failed = Object.values(results).filter((r) => !r.ok);
  const slow = Object.values(results).filter((r) => r.ok && r.captured_fps < 30);
  console.log(
    `\n${outDir}: contact_sheet.jpg, voiceover.md, manifest.json, ${Object.keys(results).length - failed.length} clips`,
  );
  if (slow.length)
    console.log(
      `fewer than 30 captured fps in ${slow.map((r) => r.id).join(", ")}: a still page draws few frames; otherwise close heavy apps`,
    );
  if (failed.length) {
    console.error(`failed: ${failed.map((r) => r.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
