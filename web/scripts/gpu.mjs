// WebGL in a real browser for the GPU tests and the fps script: Chrome or Chromium driven by
// playwright-core (which downloads no browser), and a Vite dev server for test pages.
// Browser lookup: $TTE_CHROME, a Playwright-installed Chromium under $PLAYWRIGHT_BROWSERS_PATH,
// then the system's Google Chrome (GitHub's Ubuntu runners have one). Without a usable GPU,
// Chrome renders WebGL with SwiftShader, its software rasteriser.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const WEB = fileURLToPath(new URL("..", import.meta.url));

const BUNDLED = [
  "chrome-linux64/chrome",
  "chrome-linux/chrome",
  "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  "chrome-win/chrome.exe",
];

function playwrightChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d));
  dirs.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const dir of dirs) {
    const exe = BUNDLED.map((p) => join(root, dir, p)).find(existsSync);
    if (exe) return exe;
  }
  return undefined;
}

/**
 * @param {{ headless?: boolean, software?: boolean }} [options] `software` forces SwiftShader
 *   even where a GPU exists; it is the default on CI, so CI runs are reproducible.
 * @returns {Promise<import("playwright-core").Browser>}
 */
export async function launchChrome({ headless = true, software = Boolean(process.env.CI) } = {}) {
  const executablePath = process.env.TTE_CHROME || playwrightChromium();
  const args = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
  if (software) args.push("--use-angle=swiftshader");
  try {
    return await chromium.launch(
      executablePath ? { headless, args, executablePath } : { headless, args, channel: "chrome" },
    );
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(`no Chrome or Chromium to run WebGL in; set TTE_CHROME to one (${why})`);
  }
}

/**
 * The WebGL renderer of a page, e.g. "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...)".
 * @param {import("playwright-core").Page} page
 * @returns {Promise<string>}
 */
export function rendererOf(page) {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "no WebGL2";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
}

/**
 * Serve web/ as `npm run dev` does, without the app's config, for a test page at `page` (a path
 * under web/). Its imports are bundled before it loads, in their own cache.
 * @param {string} page
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serveTestPage(page) {
  const server = await createServer({
    root: WEB,
    configFile: false,
    logLevel: "error",
    cacheDir: "node_modules/.vite-test-pages",
    server: { port: 0, hmr: false },
    optimizeDeps: { entries: [page] },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error("the Vite dev server has no local URL");
  return { url: new URL(page, base).href, close: () => server.close() };
}
