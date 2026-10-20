// Frames per second of the app with the tactical board's pitch-control overlay off and on
// (SPEC 7): plays the hero moment from the production build in Chrome and times its animation
// frames while both views redraw. Then times the overlay's shader alone, at the board's canvas
// size and at full HD. Prints the WebGL renderer it measured on.
//
//   npm run build && npm run fps            headless; SwiftShader (software) where there is no GPU
//   npm run fps -- --headed                 a window on this machine's GPU (laptop check)
//   npm run fps -- --width 1440 --height 900 --dpr 2 --seconds 4 --runs 3

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launchChrome, rendererOf, serveTestPage } from "./gpu.mjs";

const { values: opt } = parseArgs({
  options: {
    headed: { type: "boolean", default: false },
    software: { type: "boolean", default: false }, // force SwiftShader even with a GPU
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    dpr: { type: "string", default: "1" },
    seconds: { type: "string", default: "4" },
    runs: { type: "string", default: "3" },
  },
});

const web = fileURLToPath(new URL("..", import.meta.url));
if (!existsSync(`${web}/dist/index.html`)) throw new Error("no build: run `npm run build` first");
const server = await preview({
  root: web,
  configFile: false,
  logLevel: "error",
  preview: { port: 0 },
});
const base = server.resolvedUrls?.local[0];
const harness = await serveTestPage("src/pitchControl/harness.html");
const browser = await launchChrome({ headless: !opt.headed, software: opt.software });
try {
  const context = await browser.newContext({
    viewport: { width: Number(opt.width), height: Number(opt.height) },
    deviceScaleFactor: Number(opt.dpr),
  });
  const page = await context.newPage();
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(`${base}?offline=1&autoplay=0`);
  await button("Play").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("canvas").length >= 2);
  await page.waitForTimeout(1500); // models and textures
  const renderer = await rendererOf(page);
  const board = await page.locator(".tac canvas").evaluate((c) => [c.width, c.height]);
  const chip = button("Pitch control");

  /** Play from the key scan and time `seconds` of animation frames. */
  async function measure(overlay) {
    if ((await chip.getAttribute("aria-pressed")) !== String(overlay)) await chip.click();
    await button("Key scan").click();
    await button("Play").click();
    await page.waitForTimeout(300);
    const stamps = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const t = [];
          const tick = (now) => {
            t.push(now);
            if (now - t[0] < ms) requestAnimationFrame(tick);
            else resolve(t);
          };
          requestAnimationFrame(tick);
        }),
      Number(opt.seconds) * 1000,
    );
    await button("Pause").click();
    const gaps = stamps
      .slice(1)
      .map((t, i) => t - stamps[i])
      .sort((a, b) => a - b);
    const span = stamps[stamps.length - 1] - stamps[0];
    return {
      fps: ((stamps.length - 1) * 1000) / span,
      median: gaps[Math.floor(gaps.length / 2)],
      p95: gaps[Math.floor(gaps.length * 0.95)],
    };
  }

  const rows = [];
  for (let r = 0; r < Number(opt.runs); r++) {
    for (const overlay of [false, true]) rows.push({ overlay, ...(await measure(overlay)) });
  }
  console.log(`renderer: ${renderer}`);
  console.log(
    `viewport ${opt.width}x${opt.height} @ dpr ${opt.dpr}; tactical canvas ${board[0]}x${board[1]} px; ` +
      `${opt.seconds} s per run, playing the hero moment at 1x`,
  );
  console.log("| pitch control | fps | median frame ms | p95 frame ms |");
  console.log("|---|---:|---:|---:|");
  for (const r of rows) {
    console.log(
      `| ${r.overlay ? "on" : "off"} | ${r.fps.toFixed(1)} | ${r.median.toFixed(1)} | ${r.p95.toFixed(1)} |`,
    );
  }

  // The shader alone, on the decision snapshot of the parity test.
  const shot = (
    await import("../src/pitchControl/snapshots.json", { with: { type: "json" } })
  ).default.snapshots.find((s) => s.label === "decision");
  const metres = (rows) => rows.map((row) => row.map((v) => v / 1000));
  const bench = await context.newPage();
  await bench.goto(harness.url);
  await bench.waitForFunction(() => window.pitchControlHarness !== undefined);
  console.log("\n| shader alone | canvas px | ms per draw |");
  console.log("|---|---|---:|");
  for (const [name, w, h] of [
    ["tactical canvas", board[0], board[1]],
    ["full HD", 1920, 1080],
  ]) {
    const ms = await bench.evaluate(
      ([home, away, w, h]) => window.pitchControlHarness.bench(home, away, w, h, 30),
      [metres(shot.home), metres(shot.away), w, h],
    );
    console.log(`| ${name} | ${w}x${h} | ${ms.toFixed(2)} |`);
  }
} finally {
  await browser.close();
  await server.close();
  await harness.close();
}
