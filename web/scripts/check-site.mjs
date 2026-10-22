// Reads a staged upload back from the live site (SPEC 8): every file must come back with the
// Content-Type, Content-Encoding and Cache-Control it was staged with (batches.tsv, scripts/
// stage.mjs) and, decoded, the build's own bytes. infra/upload_web.sh runs it on the new files
// before index.html goes up, so a deploy that stores them wrongly never reaches a visitor; then on
// index.html itself, and in headless Chrome, rolling back to the previous index.html on failure.
// Written after #115 (2026-10-21), whose gzipped scripts went up as application/octet-stream.
//
//   node scripts/check-site.mjs --site <url> --staged <dir> --dist <dir> --files
//   node scripts/check-site.mjs --site <url> --staged <dir> --dist <dir> --index [--browser]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    site: { type: "string" },
    staged: { type: "string" },
    dist: { type: "string" },
    files: { type: "boolean", default: false },
    index: { type: "boolean", default: false },
    browser: { type: "boolean", default: false },
  },
});
const site = opt.site?.replace(/\/+$/, "");
if (!site || !opt.staged || !opt.dist) {
  console.error("usage: check-site.mjs --site <url> --staged <dir> --dist <dir> --files|--index");
  process.exit(2);
}

function* walk(dir, base = dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path, base);
    else yield relative(base, path).split("\\").join("/");
  }
}

/** [path on the site, expected headers] for every staged file of the chosen batches. */
function expected() {
  const rows = readFileSync(join(opt.staged, "batches.tsv"), "utf8").split("\n").filter(Boolean);
  const out = [];
  for (const row of rows) {
    const [dir, encoding, cache, type] = row.split("\t");
    if ((dir === "index") !== opt.index) continue;
    for (const rel of walk(join(opt.staged, dir))) {
      const want = { type: type === "-" ? null : type, encoding: encoding === "-" ? "" : encoding };
      out.push([rel, { ...want, cache }]);
      if (rel === "index.html") out.push(["", { ...want, cache }]); // the site's root
    }
  }
  return out;
}

async function check([rel, want]) {
  const url = `${site}/${rel}`;
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { headers: { "Accept-Encoding": "gzip" }, cache: "no-store" });
      break;
    } catch (err) {
      if (attempt === 2) return [`${url}: ${err instanceof Error ? err.message : err}`];
    }
  }
  const problems = [];
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const encoding = res.headers.get("content-encoding") ?? "";
  const cache = res.headers.get("cache-control") ?? "";
  if (res.status !== 200) problems.push(`status ${res.status}`);
  if (want.type && type !== want.type)
    problems.push(`Content-Type ${type || "none"}, not ${want.type}`);
  if (encoding !== want.encoding)
    problems.push(`Content-Encoding ${encoding || "none"}, not ${want.encoding || "none"}`);
  if (cache !== want.cache) problems.push(`Cache-Control "${cache}", not "${want.cache}"`);
  const body = Buffer.from(await res.arrayBuffer()); // fetch decodes gzip
  const own = readFileSync(join(opt.dist, rel || "index.html"));
  if (!body.equals(own))
    problems.push(`${body.length} bytes decoded, not the build's ${own.length}`);
  return problems.map((p) => `/${rel}: ${p}`);
}

const list = expected();
const problems = [];
for (let i = 0; i < list.length; i += 8) {
  for (const p of await Promise.all(list.slice(i, i + 8).map(check))) problems.push(...p);
}
console.log(`${opt.index ? "index.html" : "files"}: ${list.length} read back from ${site}`);

if (opt.browser && !problems.length) problems.push(...(await inChrome()));

for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);

/** The page in headless Chrome: it must leave "Loading the match…" and draw, with no script refused. */
async function inChrome() {
  let browser;
  try {
    const { launchChrome } = await import("./gpu.mjs");
    browser = await launchChrome({ software: true });
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    if (process.env.CI) return [`no Chrome to load the page in: ${why}`]; // the runners have one
    console.log(`  (no Chrome here: the page itself was not loaded; ${why})`);
    return [];
  }
  const problems = [];
  try {
    const page = await browser.newPage();
    const origin = new URL(site).origin;
    page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && /MIME|module script|stylesheet/i.test(msg.text()))
        problems.push(`console: ${msg.text()}`);
    });
    page.on("response", (res) => {
      if (res.url().startsWith(origin) && res.status() >= 400)
        problems.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`${site}/?intro=0&autoplay=0`, { timeout: 60_000 });
    await page
      .waitForFunction(
        () => document.querySelector("canvas") && !document.querySelector("#root > .loading"),
        null,
        { timeout: 60_000 },
      )
      .catch(() => problems.push('the page stayed on "Loading the match…" for 60 s'));
    console.log(`page: loaded in Chrome${problems.length ? "" : ", drawn"}`);
  } finally {
    await browser.close();
  }
  return problems;
}
