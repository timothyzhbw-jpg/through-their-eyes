// Capture renderer in headless Chrome (SPEC 10): the app served by Vite at ?cine=1, driven one
// frame at a time. Needs Chrome or Chromium; see scripts/gpu.mjs. Without one the launch throws
// and this suite fails.

import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchChrome, rendererOf } from "../../scripts/gpu.mjs";

const ORBIT = {
  id: "orbit-h8",
  duration: 3,
  time: [
    { t: 0, frame: 0 },
    { t: 3, frame: 60 },
  ],
  camera: [
    {
      t: 0,
      eye: { at: "player", id: "H8", orbit: { r: 12, az: 40, h: 6 }, axes: "body" },
      look: { at: "player", id: "H8", offset: [0, 0, 1.2] },
    },
    {
      t: 3,
      eye: { at: "player", id: "H8", orbit: { r: 12, az: 200, h: 6 }, axes: "body" },
      look: { at: "player", id: "H8", offset: [0, 0, 1.2] },
    },
  ],
  cone: { id: "H8", opacity: 0.5, flash: 1 },
};

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];

beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    logLevel: "error",
    server: { port: 0, hmr: false },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error("the Vite dev server has no local URL");
  browser = await launchChrome();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    const text = msg.text();
    if (/GL Driver Message \(OpenGL, Performance/.test(text)) return;
    // React Three Fiber 9 still builds a THREE.Clock; three 0.186 warns about it in every app.
    if (/THREE\.Clock: This module has been deprecated/.test(text)) return;
    if (msg.type() === "error" || msg.type() === "warning") pageErrors.push(text);
  });
  const url = new URL("/", base);
  url.search = "cine=1&intro=0&autoplay=0&offline=1";
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 120_000 });
  try {
    await page.waitForFunction(() => window.__cine?.ready === true, undefined, {
      timeout: 120_000,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cine did not become ready (${pageErrors.join(" | ") || "no page error"}): ${why}`,
    );
  }
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
}, 60_000);

describe("cinematic capture (SPEC 10)", () => {
  it("refuses render before a shot is loaded", async () => {
    const message = await page.evaluate(() => {
      try {
        window.__cine.render(0);
        return "";
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });
    expect(message).toMatch(/load/i);
  });

  it("rejects a shot that names a player the data does not have", async () => {
    const rejected = await page.evaluate(() =>
      window.__cine.load({
        id: "bad",
        duration: 1,
        time: [{ t: 0, frame: 0 }],
        camera: [
          {
            t: 0,
            eye: { at: "world", p: [0, 0, 8] },
            look: { at: "player", id: "NO_SUCH_PLAYER", offset: [0, 0, 1] },
          },
        ],
      }),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.join(" ")).toMatch(/NO_SUCH_PLAYER/);
  });

  it("orbits H8 with a cone, and the same t draws the same picture", async () => {
    const ids = await page.evaluate(() => window.__cine.info().players.map((p) => p.id));
    if (!ids.includes("H8")) throw new Error(`bundled data has no H8 (players: ${ids.join(", ")})`);

    const loaded = await page.evaluate((shot) => window.__cine.load(shot), ORBIT);
    expect(loaded.ok).toBe(true);

    const at0 = await page.evaluate(() => window.__cine.render(0));
    expect(at0.frame).toBe(0);
    const atMid = await page.evaluate(() => window.__cine.render(1.5));
    expect(atMid.frame).toBe(30);

    const variance = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return 0;
      const url = canvas.toDataURL();
      const image = new Image();
      image.src = url;
      await image.decode();
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      const ctx = copy.getContext("2d");
      if (!ctx) return 0;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let n = 0;
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < data.length; i += 16) {
        const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += y;
        sum2 += y * y;
        n += 1;
      }
      const mean = sum / n;
      return sum2 / n - mean * mean;
    });
    expect(variance).toBeGreaterThan(1);

    const first = await page.evaluate(() => {
      window.__cine.render(1.5);
      const canvas = document.querySelector("canvas");
      return canvas ? canvas.toDataURL() : "";
    });
    const second = await page.evaluate(() => {
      window.__cine.render(1.5);
      const canvas = document.querySelector("canvas");
      return canvas ? canvas.toDataURL() : "";
    });
    expect(first.length).toBeGreaterThan(1000);
    expect(second).toBe(first);
  }, 60_000);

  it("draws without a WebGL error or warning", async () => {
    const renderer = await rendererOf(page);
    expect(renderer).not.toBe("no WebGL2");
    expect(pageErrors).toEqual([]);
  });
});
