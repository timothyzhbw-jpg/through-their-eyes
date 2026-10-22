// Static checks for the trailer title cards and the frame-pipe ffmpeg args.
// No browser: the pages are parsed as text, and frames.mjs is imported only for
// the pure argv helper.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TITLES = path.join(ROOT, "titles");

const TEMPLATES = [
  { name: "slam", alpha: true, params: ["lines", "kicker", "stagger", "align", "hold", "out", "backdrop"] },
  { name: "card", alpha: false, params: ["lines", "kicker", "stagger", "align", "hold", "out", "backdrop", "sub"] },
  { name: "freeze", alpha: true, params: ["items", "title"] },
  { name: "verified", alpha: true, params: ["kicker", "items", "stagger"] },
  { name: "refuted", alpha: true, params: ["before", "value", "after", "stamp", "kicker"] },
  { name: "lineup", alpha: false, params: ["header", "cards", "highlight", "stagger", "start"] },
  { name: "redcard", alpha: true, params: ["title", "sub"] },
  { name: "subboard", alpha: true, params: ["off", "on", "caption"] },
  { name: "tag", alpha: true, params: ["text", "sub"] },
  { name: "spec", alpha: false, params: ["header", "rows", "footer"] },
  { name: "end", alpha: false, params: ["name", "tagline", "url", "lines"] },
  { name: "countdown", alpha: true, params: ["label", "sub", "secs"] },
  { name: "caption", alpha: true, params: ["text", "dur"] },
  { name: "label", alpha: true, params: ["text", "corner"] },
  { name: "namecard", alpha: true, params: ["name", "role", "sub", "spot", "side", "scrim"] },
  { name: "chapter", alpha: false, params: ["label", "title"] },
  { name: "duo", alpha: true, params: ["left", "right"] },
];

const read = (file) => readFileSync(file, "utf8");

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ");
}

function comments(html) {
  return [...html.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1]).join("\n");
}

test("every template is a local page that declares its params", () => {
  for (const tmpl of TEMPLATES) {
    const file = path.join(TITLES, `${tmpl.name}.html`);
    assert.equal(existsSync(file), true, `${tmpl.name}.html`);
    const html = read(file);
    assert.match(html, /<link\b[^>]*href="titles\.css"/, `${tmpl.name} links titles.css`);
    assert.match(html, /<script\b[^>]*src="titles\.js"/, `${tmpl.name} links titles.js`);
    assert.match(
      html,
      tmpl.alpha ? /<html\b[^>]*class="[^"]*\balpha\b/ : /<html\b[^>]*class="[^"]*\bopaque\b/,
      `${tmpl.name} alpha flag`,
    );
    const notes = comments(html);
    assert.ok(notes.trim(), `${tmpl.name} declares its params in a comment`);
    for (const name of tmpl.params) {
      assert.match(notes, new RegExp(`\\b${name}\\b`), `${tmpl.name} comment missing ${name}`);
    }
    assert.doesNotMatch(html, /https?:/, `${tmpl.name} loads an external URL`);
    assert.doesNotMatch(html, /(?:\ssrc|\shref)\s*=\s*["'][^"']*\/\//, `${tmpl.name} has a protocol-relative URL`);
    assert.doesNotMatch(html, /url\(\s*["']?(?:https?:|\/\/)/, `${tmpl.name} has a remote url()`);
    assert.doesNotMatch(visibleText(html), /\d/, `${tmpl.name} has a digit in text content`);
    if (tmpl.name === "slam" || tmpl.name === "card") assert.match(html, /__titleBuild\.kinetic/);
    else assert.match(html, new RegExp(`__titleBuild\\.${tmpl.name}`));
  }
});

test("no title page text contains a digit", () => {
  const files = readdirSync(TITLES).filter((name) => name.endsWith(".html"));
  assert.ok(files.includes("index.html"));
  for (const name of files) {
    const html = read(path.join(TITLES, name));
    assert.doesNotMatch(visibleText(html), /\d/, `${name} has a digit in text content`);
    assert.doesNotMatch(html, /(?:\ssrc|\shref)\s*=\s*["'][^"']*(?:https?:|\/\/)/, `${name} src/href`);
    assert.doesNotMatch(html, /url\(\s*["']?[^)"']*(?:https?:|\/\/)/, `${name} url()`);
  }
});

test("samples.json has one entry per template, and the gallery embeds it", () => {
  const samples = JSON.parse(read(path.join(TITLES, "samples.json")));
  assert.deepEqual(
    Object.keys(samples).sort(),
    TEMPLATES.map((tmpl) => tmpl.name).sort(),
  );
  for (const tmpl of TEMPLATES) assert.equal(typeof samples[tmpl.name], "object");
  const index = read(path.join(TITLES, "index.html"));
  assert.match(index, /<input\b[^>]*type="range"/);
  const embedded = index.match(/<script type="application\/json" id="samples">([\s\S]*?)<\/script>/);
  assert.ok(embedded, "index.html embeds samples");
  assert.deepEqual(JSON.parse(embedded[1]), samples);
});

test("Anton and Bebas Neue are local faces, with their OFL files", () => {
  const css = read(path.join(TITLES, "titles.css"));
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  for (const [family, file] of [
    ["Anton", "Anton-Regular.ttf"],
    ["Bebas Neue", "BebasNeue-Regular.ttf"],
  ]) {
    const block = blocks.find((item) => new RegExp(`font-family:\\s*["']${family}["']`).test(item));
    assert.ok(block, `@font-face ${family}`);
    assert.match(block, new RegExp(`url\\(\\s*["']\\./fonts/${file}["']\\)`));
  }
  for (const name of ["Anton-Regular.ttf", "BebasNeue-Regular.ttf", "Anton-OFL.txt", "BebasNeue-OFL.txt"]) {
    assert.equal(existsSync(path.join(TITLES, "fonts", name)), true, name);
  }
  assert.match(css, /PingFang SC/);
  assert.match(css, /Noto Sans CJK SC/);
  assert.match(css, /Microsoft YaHei/);
  assert.doesNotMatch(css, /https?:/);
});

test("motion does not read the clock", () => {
  const banned = /\b(?:setTimeout|requestAnimationFrame|Math\.random)\b|\bDate\b/;
  const files = [
    path.join(TITLES, "titles.js"),
    path.join(TITLES, "titles.css"),
    ...readdirSync(TITLES)
      .filter((name) => name.endsWith(".html"))
      .map((name) => path.join(TITLES, name)),
  ];
  for (const file of files) assert.doesNotMatch(read(file), banned, path.basename(file));
  const js = read(path.join(TITLES, "titles.js")).split("http://www.w3.org/2000/svg").join("");
  assert.doesNotMatch(js, /https?:/);
  new Function(read(path.join(TITLES, "titles.js")));
  for (const tmpl of TEMPLATES) {
    const html = read(path.join(TITLES, `${tmpl.name}.html`));
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
  }
  const index = read(path.join(TITLES, "index.html"));
  for (const match of index.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
});

test("ffmpeg args for opaque H.264 and alpha ProRes", async () => {
  const { ffmpegArgs, recordFrames } = await import("../lib/frames.mjs");
  assert.equal(typeof recordFrames, "function");
  assert.deepEqual(ffmpegArgs({ fps: 60, outFile: "out/card.mp4", alpha: false }), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "-framerate",
    "60",
    "-i",
    "-",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "4",
    "-y",
    "out/card.mp4",
  ]);
  assert.deepEqual(ffmpegArgs({ fps: 30, outFile: "out/slam.mov", alpha: true }), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-c:v",
    "png",
    "-framerate",
    "30",
    "-i",
    "-",
    "-an",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4444",
    "-pix_fmt",
    "yuva444p10le",
    "-threads",
    "4",
    "-y",
    "out/slam.mov",
  ]);
  const { renderCine } = await import("../lib/cine.mjs");
  const { renderTitle } = await import("../lib/titles.mjs");
  assert.equal(typeof renderCine, "function");
  assert.equal(typeof renderTitle, "function");
});

test("no title animates a blur: sharp frames only", () => {
  const css = read(path.join(TITLES, "titles.css"));
  assert.doesNotMatch(css, /blur\(/, "titles.css uses blur()");
  assert.doesNotMatch(read(path.join(TITLES, "titles.js")), /blur\(/, "titles.js uses blur()");
});
