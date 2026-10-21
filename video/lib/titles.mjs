// Renders one title card (video/titles/<template>.html) by seeking window.__title
// to every frame. Slots in `title.params` are already filled by the edit engine.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordFrames } from "./frames.mjs";

const TITLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../titles");

function asBool(value) {
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no" || s === "") return false;
  }
  return !!value;
}

/**
 * Open the template, call __title.setup(params), wait until fonts are in and
 * ready is true, then record `title.dur` seconds. Returns { file, frames, duration, alpha }.
 */
export async function renderTitle({
  browser,
  id,
  title,
  fps,
  width,
  height,
  outFile,
  ffmpeg,
  log = () => {},
}) {
  if (!/^[a-z0-9-]+$/.test(title.template ?? "")) {
    throw new Error(`title ${id} has a bad template name`);
  }
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const errors = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    const file = path.join(TITLES_DIR, `${title.template}.html`);
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate((params) => window.__title.setup(params), title.params ?? {});
    try {
      await page.waitForFunction(() => window.__title?.ready === true, null, { timeout: 30_000 });
    } catch (err) {
      const detail = errors.length ? errors.join("\n") : err.message;
      throw new Error(`title ${id} (${title.template}) was not ready: ${detail}`);
    }
    const alpha = asBool(title.alpha);
    const recorded = await recordFrames({
      page,
      fps,
      duration: title.dur,
      draw: (t) => page.evaluate((time) => window.__title.seek(time), t),
      outFile,
      ffmpeg,
      alpha,
      log: (message) => log(`[${id}] ${message}`),
    });
    return { file: outFile, frames: recorded.frames, duration: title.dur, alpha };
  } finally {
    await context.close();
  }
}
