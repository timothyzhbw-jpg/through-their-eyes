#!/usr/bin/env node
// The 16:9 cover still for the submission page (SPEC 10): H8's eyes at the pass, H9 ringed and
// labelled on the right third, under the trailer's freeze card. The number is a verified claim
// read off the live page (out/video/claims.json, the capture kit's harvest), never typed in: with
// the claim missing the tool stops instead of drawing a fallback.
//
//   node video/tools/cover.mjs                       # -> out/cover_16x9_v3.png
//   node video/tools/cover.mjs --frame 70 --aim 5 --lift 4 --fov 24 --out out/cover.png --base-url <site>
//
// --frame: the sim frame (25 Hz) of seed 3; --aim: metres to aim left of H9 (he lands right);
// --lift: metres to aim above him (the players drop below the card, the crowd fills it);
// --fov: vertical field of view in degrees. The defaults leave no player inside the card.
// Only H9 keeps his shirt-number label: the frame is rendered with labels and without, and the
// one gold label (the runner's) is copied from the first into the second.

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
    out: { type: "string", default: "out/cover_16x9_v3.png" },
    "base-url": { type: "string" },
    frame: { type: "string", default: "70" },
    aim: { type: "string", default: "5" },
    fov: { type: "string", default: "24" },
    lift: { type: "string", default: "4" },
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
        look: { at: "player", id: "H9", offset: [0, Number(args.aim), 1.0 + Number(args.lift)] },
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
const bare = path.join(work, "cover_pov_nolabels.mp4");
const mov = path.join(work, "cover_card.mov");
try {
  await renderCine({ browser, baseUrl, id: "cover", cine, fps, width, height, outFile: clip, ffmpeg: "ffmpeg" });
  const unlabelled = { ...cine, shot: { ...cine.shot, labels: false } };
  await renderCine({ browser, baseUrl, id: "cover", cine: unlabelled, fps, width, height, outFile: bare, ffmpeg: "ffmpeg" });
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

const run = (argv, input) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...argv], { input, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
};
const frameOf = (file) => run(["-ss", "0.1", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);

// H9's label: the gold pixels that differ between the two renders (the boards' gold text is in
// both, so it drops out), padded for the outline; copied into the frame with no labels.
const on = frameOf(clip);
const pic = Buffer.from(frameOf(bare));
let [x0, y0, x1, y1] = [width, height, -1, -1];
for (let i = 0; i < width * height; i++) {
  const o = i * 3;
  const diff = Math.abs(on[o] - pic[o]) + Math.abs(on[o + 1] - pic[o + 1]) + Math.abs(on[o + 2] - pic[o + 2]);
  const [r, g, b] = [on[o], on[o + 1], on[o + 2]];
  if (diff < 60 || !(r > 190 && g > 140 && b < 140 && r - b > 70)) continue;
  const x = i % width;
  const y = (i / width) | 0;
  [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
}
if (x1 < 0) throw new Error("H9's label is not in the frame");
if (x1 - x0 > 120 || y1 - y0 > 120) throw new Error(`more than one gold label? box ${x0},${y0}–${x1},${y1}`);
const pad = 8;
for (let y = Math.max(0, y0 - pad); y <= Math.min(height - 1, y1 + pad); y++) {
  const a = (y * width + Math.max(0, x0 - pad)) * 3;
  const z = (y * width + Math.min(width - 1, x1 + pad) + 1) * 3;
  on.copy(pic, a, a, z);
}

// The card once it has settled (1.2 s in) over the picture, sharp, no grade.
const out = path.resolve(ROOT, args.out);
run(
  [
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-i", "-",
    "-ss", "1.2", "-i", mov,
    "-filter_complex", "[1:v]format=rgba[c];[0:v][c]overlay=0:0:format=auto,format=rgb24",
    "-frames:v", "1", out,
  ],
  pic,
);
console.log(`H9's label kept at ${x0},${y0}–${x1},${y1}`);
console.log(`${path.relative(ROOT, out)}: ${resolved.used.map((u) => `${u.slot} = ${u.value} from ${u.seen}`).join("; ")}`);
