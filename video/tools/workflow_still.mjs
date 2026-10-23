#!/usr/bin/env node
// The crew workflow diagram as a trailer clip (SPEC 10): docs/crew_workflow-dark.svg, drawn by
// Agent Framework's WorkflowViz from agents/workflow.py, rasterised in Chrome at 1920×1080 on its
// own ground and held for three seconds, into out/video/stills/crew_workflow.mp4 (beat b33b).
//
//   node video/tools/workflow_still.mjs [--svg docs/crew_workflow-dark.svg]

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const at = argv.indexOf("--svg");
const svg = path.resolve(ROOT, at >= 0 ? argv[at + 1] : "docs/crew_workflow-dark.svg");
if (!existsSync(svg)) throw new Error(`${path.relative(ROOT, svg)} is missing (PR #211 adds it)`);
const dir = path.join(ROOT, "out", "video", "stills");
mkdirSync(dir, { recursive: true });
copyFileSync(svg, path.join(dir, "crew_workflow-dark.svg"));
writeFileSync(
  path.join(dir, "crew_workflow.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;background:#0d1117;display:flex;align-items:center;justify-content:center}
img{width:1760px;height:940px;object-fit:contain}
</style></head><body><img src="crew_workflow-dark.svg"></body></html>\n`,
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(dir, "crew_workflow.html")}`);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(dir, "crew_workflow.png") });
await browser.close();
const out = path.join(dir, "crew_workflow.mp4");
const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "3", "-i", path.join(dir, "crew_workflow.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-r", "30", out], { stdio: "inherit" });
if (ff.status !== 0) throw new Error("ffmpeg failed");
console.log(path.relative(ROOT, out));
