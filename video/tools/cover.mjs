#!/usr/bin/env node
// The 16:9 cover still for the submission page (SPEC 10): H8's eyes at the pass, H9 ringed and
// labelled on the right third, under the trailer's freeze card. The number is a verified claim
// read off the live page (out/video/claims.json, the capture kit's harvest), never typed in: with
// the claim missing the tool stops instead of drawing a fallback.
//
//   node video/tools/cover.mjs                       # -> out/cover_16x9_v2.png
//   node video/tools/cover.mjs --frame 75 --aim 4.5 --fov 18 --out out/cover.png --base-url <site>
//
// --frame: the sim frame (25 Hz) of seed 3; --aim: metres to aim left of H9 (he lands right);
// --fov: vertical field of view in degrees.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { claimTable, resolveTitle } from "../lib/claims.mjs";
import { renderCine } from "../lib/cine.mjs";
import { renderTitle } from "../lib/titles.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: "out/cover_16x9_v2.png" },
    "base-url": { type: "string" },
    frame: { type: "string", default: "75" },
    aim: { type: "string", default: "4.5" },
    fov: { type: "string", default: "18" },
  },
});
const spec = JSON.parse(readFileSync(path.join(ROOT, "video", "trailer.json"), "utf8"));
const baseUrl = args["base-url"] ?? spec.site;
const [width, height, fps] = [1920, 1080, 30];
const work = path.join(ROOT, "out", "video", "cover");
mkdirSync(work, { recursive: true });

// The card: the trailer's freeze template, its number from the look's verified value.
const claimsFile = path.join(ROOT, "out", "video", "claims.json");
if (!existsSync(claimsFile)) throw new Error("out/video/claims.json is missing: run the capture kit first");
const doc = JSON.parse(readFileSync(claimsFile, "utf8"));
const table = doc.claims && typeof doc.claims === "object" ? doc.claims : claimTable(doc.sources ?? []);
const card = {
  id: "cover",
  template: "freeze",
  dur: 1.6,
  alpha: true,
  params: {
    title: "THAT LOOK WAS WORTH",
    // No unit beside the number: the display face has no lowercase, so "xT" would read "XT".
    items: [{ label: "EXPECTED THREAT", value: "{cf_value.dxt}", unit: "", color: "gold" }],
  },
};
const resolved = resolveTitle(card, table);
if (resolved.drop || resolved.fallback) throw new Error(`no verified value for the cover: ${resolved.missing.join(", ")}`);

// The picture: one frame through H8's eyes, aimed beside H9 so he sits on the right third.
const cine = {
  url: "/?cine=1&intro=0&autoplay=0&offline=1",
  shot: {
    id: "cover",
    run: "factual",
    duration: 0.2,
    pov: "H8",
    time: [{ t: 0, frame: Number(args.frame) }],
    camera: [
      {
        t: 0,
        eye: { at: "eyes", id: "H8" },
        look: { at: "player", id: "H9", offset: [0, Number(args.aim), 1.0] },
        fov: Number(args.fov),
      },
    ],
    periphery: 0,
    labels: true,
    rings: true,
    fog: [45, 160],
    bloom: null, // crisp labels, no glow (no blur anywhere)
    motionBlur: false,
  },
};

const { chromium } = await import("playwright");
const browser = await chromium.launch({
  args: ["--ignore-gpu-blocklist", "--hide-scrollbars", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])],
});
const clip = path.join(work, "cover_pov.mp4");
const mov = path.join(work, "cover_card.mov");
try {
  await renderCine({ browser, baseUrl, id: "cover", cine, fps, width, height, outFile: clip, ffmpeg: "ffmpeg" });
  await renderTitle({
    browser,
    id: "cover",
    title: { ...card, params: resolved.params },
    fps,
    width,
    height,
    outFile: mov,
    ffmpeg: "ffmpeg",
  });
} finally {
  await browser.close();
}

// The card once it has settled (1.2 s in) over the picture, sharp, no grade.
const out = path.resolve(ROOT, args.out);
const run = (argv) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...argv], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
};
run([
  "-ss", "0.1", "-i", clip,
  "-ss", "1.2", "-i", mov,
  "-filter_complex", "[1:v]format=rgba[c];[0:v][c]overlay=0:0:format=auto,format=rgb24",
  "-frames:v", "1", out,
]);
console.log(`${path.relative(ROOT, out)}: ${resolved.used.map((u) => `${u.slot} = ${u.value} from ${u.seen}`).join("; ")}`);
