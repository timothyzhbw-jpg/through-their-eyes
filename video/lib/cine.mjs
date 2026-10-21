// Renders one in-engine cinematic (a page that exposes window.__cine) by seeking
// it to every frame. The browser is the caller's; this opens and always closes
// its own context.
import { recordFrames } from "./frames.mjs";

/** Join baseUrl and a cine path. An absolute cine url is used as-is. */
function joinUrl(baseUrl, url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (!baseUrl) return url;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return base + (url.startsWith("/") ? url.slice(1) : url);
}

/**
 * Load `cine` ({ url, shot }) at baseUrl + cine.url, wait until window.__cine is
 * ready, load the shot, and record r.duration seconds. Returns { file, frames, duration }.
 */
export async function renderCine({
  browser,
  baseUrl,
  id,
  cine,
  fps,
  width,
  height,
  outFile,
  ffmpeg,
  log = () => {},
}) {
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
    await page.goto(joinUrl(baseUrl, cine.url), { waitUntil: "load" });
    try {
      await page.waitForFunction(() => window.__cine?.ready === true, null, { timeout: 60_000 });
    } catch (err) {
      const detail = errors.length ? errors.join("\n") : err.message;
      throw new Error(`cine ${id} was not ready: ${detail}`);
    }
    const r = await page.evaluate((shot) => window.__cine.load(shot), cine.shot);
    if (!r || r.ok !== true) {
      const list = Array.isArray(r?.errors) && r.errors.length ? r.errors.join("\n") : "load failed";
      throw new Error(`cine ${id} failed to load: ${list}`);
    }
    const recorded = await recordFrames({
      page,
      fps,
      duration: r.duration,
      draw: (t) => page.evaluate((time) => window.__cine.render(time), t),
      outFile,
      ffmpeg,
      alpha: false,
      log: (message) => log(`[${id}] ${message}`),
    });
    return { file: outFile, frames: recorded.frames, duration: r.duration };
  } finally {
    await context.close();
  }
}
