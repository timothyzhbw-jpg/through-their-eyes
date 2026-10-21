// Contrast of the text drawn over the picture (docs/ACCESSIBILITY.md), which axe cannot judge: it
// reports text over the WebGL views as "needs review". Each render is captured twice, once as
// drawn and once with the live screen's text in magenta; the pixels that differ are the glyphs.
// The text's background is every other pixel within 2 px of a glyph in the render as drawn, so a
// halo counts as background, as WCAG counts it. A text box passes when its 5th-percentile ratio
// (its worst 5 % of edge pixels) meets 4.5:1, or 3:1 for large text.
//
//   npm run contrast -- --url http://localhost:4173                     the sweep below
//   npm run contrast -- --url <site> --at 56 --camera broadcast --device phone
//
// The sweep: frames 10, 40, 56, 75, 110 and 150 x first person, broadcast and the tactical board
// x with and without the look x desktop (1440 x 900) and phone (375 x 812): 72 renders.

import { parseArgs } from "node:util";
import { launchChrome } from "./gpu.mjs";

const { values: opt } = parseArgs({
  options: {
    url: { type: "string" },
    at: { type: "string" },
    camera: { type: "string" }, // pov | broadcast | tactical
    run: { type: "string" }, // factual | counterfactual
    device: { type: "string" }, // desktop | phone
    scope: { type: "string", default: ".stage" },
    all: { type: "boolean", default: false }, // print the boxes that pass too
  },
});
if (!opt.url) throw new Error("--url is required: the site to measure");

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};
const FRAMES = ["10", "40", "56", "75", "110", "150"];
const CAMERAS = ["pov", "broadcast", "tactical"];
const RUNS = ["factual", "counterfactual"];

const renders = [];
for (const device of opt.device ? [opt.device] : Object.keys(DEVICES))
  for (const run of opt.run ? [opt.run] : RUNS)
    for (const camera of opt.camera ? [opt.camera] : CAMERAS)
      for (const at of opt.at ? [opt.at] : FRAMES) renders.push({ device, run, camera, at });

const view = { pov: "", broadcast: "&camera=broadcast", tactical: "&view=tactical" };

/** The visible text boxes inside `scope`, with their colour (opacity folded in) and size. */
function textBoxes(scope) {
  const out = [];
  for (const root of document.querySelectorAll(scope)) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || el.closest(".sr-only")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      let opacity = 1;
      for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      if (opacity < 0.05) continue;
      const [red, green, blue, alpha = 1] = cs.color.match(/[\d.]+/g).map(Number);
      const size = parseFloat(cs.fontSize);
      out.push({
        text: n.textContent.trim().slice(0, 40),
        cls: String(el.className?.baseVal ?? el.className).split(" ")[0],
        color: [red, green, blue, alpha * opacity],
        large: size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700),
        rect: [r.left, r.top, r.width, r.height],
      });
    }
  }
  return out;
}

/** The 5th-percentile and median ratio of each box, from the two captures (base64 PNG). */
async function ratios({ drawn, magenta, boxes, dpr }) {
  const load = async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext("2d");
    g.drawImage(img, 0, 0);
    return g;
  };
  const [a, b] = [await load(drawn), await load(magenta)];
  const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (r, g, bl) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const R = Math.max(2, Math.round(2 * dpr));
  const out = [];
  for (const box of boxes) {
    const [x, y, w, h] = box.rect.map((v) => Math.round(v * dpr));
    const x0 = Math.max(0, x - R);
    const y0 = Math.max(0, y - R);
    const W = Math.min(a.canvas.width, x + w + R) - x0;
    const H = Math.min(a.canvas.height, y + h + R) - y0;
    if (W <= 0 || H <= 0) continue;
    const pa = a.getImageData(x0, y0, W, H).data;
    const pb = b.getImageData(x0, y0, W, H).data;
    const glyph = new Uint8Array(W * H);
    let strokes = 0;
    for (let i = 0; i < W * H; i++) {
      const d = Math.abs(pa[4 * i] - pb[4 * i]) + Math.abs(pa[4 * i + 1] - pb[4 * i + 1]);
      if (d + Math.abs(pa[4 * i + 2] - pb[4 * i + 2]) <= 60) continue;
      glyph[i] = 1;
      strokes++;
    }
    if (strokes < 4) continue; // nothing of it drawn here: covered or clipped
    const near = new Uint8Array(W * H);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        if (!glyph[yy * W + xx]) continue;
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const X = xx + dx;
            const Y = yy + dy;
            if (X >= 0 && Y >= 0 && X < W && Y < H) near[Y * W + X] = 1;
          }
      }
    const [tr, tg, tb, ta] = box.color;
    const found = [];
    for (let i = 0; i < W * H; i++) {
      if (glyph[i] || !near[i]) continue;
      const [br, bg, bb] = [pa[4 * i], pa[4 * i + 1], pa[4 * i + 2]];
      const l1 = lum(tr * ta + br * (1 - ta), tg * ta + bg * (1 - ta), tb * ta + bb * (1 - ta));
      const l2 = lum(br, bg, bb);
      found.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
    }
    if (!found.length) continue;
    found.sort((p, q) => p - q);
    const at = (f) => found[Math.min(found.length - 1, Math.floor(f * found.length))];
    out.push({ ...box, p05: at(0.05), p50: at(0.5) });
  }
  return out;
}

const browser = await launchChrome();
let failed = 0;
let measured = 0;
try {
  for (const r of renders) {
    const context = await browser.newContext(DEVICES[r.device]);
    // No breakdown: a paused frame needs none, and a deployed site would spend on it.
    await context.route("**/api/breakdowns", (route) => route.abort());
    const page = await context.newPage();
    await page.goto(new URL(`?intro=0&at=${r.at}&run=${r.run}${view[r.camera]}`, opt.url).href);
    await page.getByRole("group", { name: "Run" }).waitFor({ timeout: 45_000 });
    await page.waitForTimeout(2500); // the models and the fonts
    const boxes = await page.evaluate(textBoxes, opt.scope);
    const drawn = (await page.screenshot({ animations: "disabled" })).toString("base64");
    const ink = `${opt.scope} *, ${opt.scope} *::before, ${opt.scope} *::after`;
    await page.addStyleTag({
      content: `${ink} { color: #f0f !important; -webkit-text-fill-color: #f0f !important; text-decoration-color: transparent !important; }`,
    });
    await page.waitForTimeout(200);
    const magenta = (await page.screenshot({ animations: "disabled" })).toString("base64");
    const dpr = await page.evaluate(() => devicePixelRatio);
    const results = await page.evaluate(ratios, { drawn, magenta, boxes, dpr });
    await context.close();
    const where = `${r.device} ${r.run} ${r.camera} ${r.at}`;
    for (const t of results) {
      measured++;
      const need = t.large ? 3 : 4.5;
      const bad = t.p05 < need;
      if (bad) failed++;
      if (bad || opt.all)
        console.log(
          `${bad ? "FAIL" : "ok  "} ${where}: ${t.p05.toFixed(2)} (median ${t.p50.toFixed(2)}, need ${need}) .${t.cls} ${JSON.stringify(t.text)}`,
        );
    }
    console.log(`${where}: ${results.length} text boxes`);
  }
} finally {
  await browser.close();
}
console.log(`${measured} text boxes in ${renders.length} renders, ${failed} under the threshold`);
process.exitCode = failed ? 1 : 0;
