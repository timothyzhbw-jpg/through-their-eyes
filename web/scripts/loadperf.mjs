// Cold-load timings of the web app as a judge gets it (SPEC 7, 8): each load is a fresh Chrome
// with an empty cache, on a laptop (1440 x 900) and a phone (375 x 812), plain and throttled to
// DevTools' "Fast 3G" with a 4x CPU slowdown. Per load: the first paint ("Loading the match…"),
// the first WebGL draw, when the players are drawn (the draw calls jump once the rigged players'
// model has loaded; the tokens before it are hidden), the main thread's blocking time, and the
// bytes on the wire by kind and by host. Prints the median of the runs as a Markdown table.
//
//   npm run loadperf                                          the live site
//   npm run loadperf -- --serve dist-upload                   a staged upload (scripts/stage.mjs),
//                                                             served on the live site's origin
//   npm run loadperf -- --serve dist                          a build, with the headers the site
//                                                             sent before the staged upload
//   npm run loadperf -- --path "/?match=match-1" --runs 5 --profiles phone-3g --json out.json
//   npm run loadperf -- --serve dist-upload --profiles desktop-broadband,phone-broadband
//                                                             a local build on this Mac's network
//                                                             to the site (it has none of its own)
//   npm run loadperf -- --from before.json --from after.json     the tables of earlier runs
//
// --serve maps the live host name to a local HTTPS server (self-signed, port 8443) inside Chrome
// only, so the page keeps the site's origin: the API's CORS, the live stream and the fonts behave
// as on the real site. The server sends what Azure Storage would: the bytes as staged, the
// Content-Encoding and Cache-Control of each upload batch, HTTP/1.1. Needs openssl.

import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { devices } from "playwright-core";
import { launchChrome, rendererOf } from "./gpu.mjs";

const SITE = "https://ttesite1ff906.z14.web.core.windows.net";
const PORT = 8443;

const { values: opt } = parseArgs({
  options: {
    url: { type: "string", default: SITE },
    path: { type: "string", multiple: true },
    serve: { type: "string" }, // a build (dist) or a staged upload (dist-upload)
    runs: { type: "string", default: "3" },
    profiles: { type: "string", default: "desktop,phone,desktop-3g,phone-3g" },
    timeout: { type: "string", default: "90" }, // seconds per load
    settle: { type: "string", default: "1.5" }, // seconds after the players, for late requests
    json: { type: "string" },
    software: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    from: { type: "string", multiple: true }, // print the table of earlier --json files
  },
});

// DevTools' "Fast 3G" preset (now "3G"): 1.6 Mbps down and 750 kbps up at 90%, 562.5 ms RTT.
const FAST_3G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1.6e6 / 8) * 0.9,
  uploadThroughput: (750e3 / 8) * 0.9,
};
// What this Mac gets from the site (Nashville to North Central US, 2026-10-21): about 100 ms per
// round trip and 20 Mbps; for local builds served with --serve, which have no network of their own.
const BROADBAND = {
  offline: false,
  latency: 100,
  downloadThroughput: 20e6 / 8,
  uploadThroughput: 5e6 / 8,
};
const { defaultBrowserType: _, ...PHONE } = devices["iPhone 13 Mini"]; // 375 x 812 @ 3
const LAPTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PROFILES = {
  desktop: { device: LAPTOP },
  phone: { device: PHONE },
  "desktop-broadband": { device: LAPTOP, network: BROADBAND },
  "phone-broadband": { device: PHONE, network: BROADBAND },
  "desktop-3g": { device: LAPTOP, network: FAST_3G, cpu: 4 },
  "phone-3g": { device: PHONE, network: FAST_3G, cpu: 4 },
};

// Runs in the page before its scripts: DOM milestones, long tasks, and draw calls per frame.
function instrument() {
  const T = {
    loading: null,
    ui: null,
    canvas: null,
    firstDraw: null,
    offline: null,
    frames: [],
    longTasks: [],
    lcp: [], // [time, area px², "tag.class text…"] per largest-contentful-paint entry
  };
  window.__ttePerf = T;
  new MutationObserver(() => {
    const now = performance.now();
    if (T.loading === null && document.querySelector(".loading")) T.loading = now;
    if (T.canvas === null && document.querySelector("canvas")) T.canvas = now;
    if (T.ui === null && document.querySelector("header, .app, .match-app")) T.ui = now;
  }).observe(document, { childList: true, subtree: true });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) T.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // no long-task timing in this browser
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const el = e.element;
        const name = el ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}` : "?";
        const text = (el?.textContent ?? "").trim().slice(0, 40);
        T.lcp.push([e.startTime, e.size, `${name} ${text}`]);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // no LCP timing in this browser
  }
  let calls = 0;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const name of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
    ]) {
      const original = proto[name];
      if (!original) continue;
      proto[name] = function (...args) {
        calls++;
        if (T.firstDraw === null) T.firstDraw = performance.now();
        return original.apply(this, args);
      };
    }
  }
  // Frames are drawn in requestAnimationFrame callbacks; this one runs first in each frame, so it
  // sees the calls of the frame before, stamped with that frame's end.
  const tick = () => {
    if (calls) T.frames.push([performance.now(), calls]);
    calls = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// --- the local stand-in for the Storage static website -------------------------------------

const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** blob path -> { file, encoding, cache, type }: a build as one batch (the headers the site sent
 * before the staged upload), or the batches of a staged upload (scripts/stage.mjs, batches.tsv)
 * with the Content-Type each names. A batch that names none gets what `az storage blob
 * upload-batch` stores: a guess from the extension, or none at all (application/octet-stream)
 * when it has a Content-Encoding, the #115 failure. */
function blobsOf(dir) {
  const blobs = new Map();
  const walk = (base, sub, batch) => {
    for (const name of execFileSync("ls", ["-A", join(base, sub)], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)) {
      const rel = sub ? `${sub}/${name}` : name;
      if (statSync(join(base, rel)).isDirectory()) walk(base, rel, batch);
      else blobs.set(rel, { file: join(base, rel), ...batch });
    }
  };
  const tsv = join(dir, "batches.tsv");
  if (!existsSync(tsv)) {
    walk(dir, "", { encoding: "", cache: "public, max-age=300", type: null });
    return blobs;
  }
  for (const line of readFileSync(tsv, "utf8").split("\n").filter(Boolean)) {
    const [sub, encoding, cache, type = "-"] = line.split("\t");
    const named = type === "-" ? (encoding === "-" ? null : "application/octet-stream") : type;
    walk(join(dir, sub), "", { encoding: encoding === "-" ? "" : encoding, cache, type: named });
  }
  return blobs;
}

function serveLikeAzure(dir) {
  const blobs = blobsOf(resolve(dir));
  const keys = mkdtempSync(join(tmpdir(), "tte-loadperf-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-keyout",
      join(keys, "key.pem"),
      "-out",
      join(keys, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  const server = createServer(
    { key: readFileSync(join(keys, "key.pem")), cert: readFileSync(join(keys, "cert.pem")) },
    (req, res) => {
      let path = normalize(decodeURIComponent(new URL(req.url, "https://x").pathname)).slice(1);
      if (path === "" || path.endsWith("/")) path += "index.html";
      // Static website: a missing blob gets the error document (index.html), status 404.
      const blob = blobs.get(path) ?? blobs.get("index.html");
      const status = blobs.has(path) ? 200 : 404;
      const size = statSync(blob.file).size;
      const headers = {
        "Content-Type": blob.type ?? TYPES[extname(path)] ?? "application/octet-stream",
        "Content-Length": size,
        "Cache-Control": blob.cache,
        ETag: `"${size}-${statSync(blob.file).mtimeMs}"`,
      };
      if (blob.encoding) headers["Content-Encoding"] = blob.encoding;
      res.writeHead(status, headers);
      createReadStream(blob.file).pipe(res);
    },
  );
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

// --- one cold load ----------------------------------------------------------------------------

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function kindOf(url, mime, type) {
  if (url.endsWith(".glb")) return "model";
  if (type === "Font" || /font/.test(mime)) return "font";
  if (type === "Script" || /javascript/.test(mime)) return "js";
  if (type === "Stylesheet" || /css/.test(mime)) return "css";
  if (/json/.test(mime)) return "json";
  if (type === "Document") return "html";
  return "other";
}

async function load(browser, profile, url, timeoutS) {
  const context = await browser.newContext({ ...profile.device, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (profile.network) await cdp.send("Network.emulateNetworkConditions", profile.network);
  if (profile.cpu) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  const requests = new Map();
  cdp.on("Network.responseReceived", ({ requestId, response, type }) => {
    requests.set(requestId, {
      url: response.url,
      kind: kindOf(response.url, response.mimeType, type),
      host: new URL(response.url).host,
      encoding: response.headers["content-encoding"] ?? response.headers["Content-Encoding"] ?? "",
      cache: response.headers["cache-control"] ?? response.headers["Cache-Control"] ?? "",
      bytes: 0,
    });
  });
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength, timestamp }) => {
    const r = requests.get(requestId);
    if (r) Object.assign(r, { bytes: encodedDataLength, end: timestamp });
  });
  await page.addInitScript(instrument);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit", timeout: timeoutS * 1000 });
  // Done when the model has loaded and a frame after it drew the players, or at the timeout.
  const deadline = t0 + timeoutS * 1000;
  let glbEnd = null;
  let players = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
      const glb = performance
        .getEntriesByType("resource")
        .find((e) => e.name.endsWith(".glb") && e.responseEnd > 0);
      return { glbEnd: glb ? glb.responseEnd : null, frames: window.__ttePerf.frames };
    });
    glbEnd = state.glbEnd;
    if (glbEnd === null) continue;
    // The players' frame: the first after the model whose draw calls clearly exceed every frame
    // before the model arrived (22 players, several meshes each).
    const before = Math.max(0, ...state.frames.filter(([t]) => t <= glbEnd).map(([, n]) => n));
    const hit = state.frames.find(([t, n]) => t > glbEnd && n >= before + 20);
    if (hit) {
      players = hit[0];
      break;
    }
  }
  // Late requests of the first screen; a longer --settle also sees later LCP candidates (a
  // caption). LCP stops at the first input, which a judge gives within seconds; a lab run gives none.
  await page.waitForTimeout(Number(opt.settle) * 1000);
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const T = window.__ttePerf;
    const badge = [...document.querySelectorAll("*")].some(
      (e) => e.childElementCount === 0 && /Offline data/.test(e.textContent ?? ""),
    );
    return {
      ttfb: nav?.responseStart ?? null,
      fcp: fcp?.startTime ?? null,
      loading: T.loading,
      ui: T.ui,
      canvas: T.canvas,
      firstDraw: T.firstDraw,
      longTasks: T.longTasks,
      lcp: T.lcp,
      offline: badge,
    };
  });
  const renderer = await rendererOf(page).catch(() => "?");
  await context.close();
  const until = players ?? Infinity;
  const tbt = perf.longTasks
    .filter(([start]) => start < until)
    .reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
  const list = [...requests.values()];
  const bytes = {};
  for (const r of list) {
    bytes[r.kind] = (bytes[r.kind] ?? 0) + r.bytes;
    bytes[`@${r.host}`] = (bytes[`@${r.host}`] ?? 0) + r.bytes;
    bytes.total = (bytes.total ?? 0) + r.bytes;
  }
  return { ...perf, glbEnd, players, tbt, bytes, requests: list, renderer };
}

// --- main ---------------------------------------------------------------------------------------

const KB = (b) => (b === null ? "—" : (b / 1024).toFixed(0));
const S = (ms) => (ms === null ? "—" : (ms / 1000).toFixed(2));

/** The median of each profile and path, as a Markdown table. */
function report(results, source) {
  const runs = Math.max(...results.map((r) => r.run)) + 1;
  console.log(`renderer: ${results[0]?.renderer}; ${runs} cold loads each, median; ${source}`);
  console.log(
    "| profile | path | first paint s | first draw s | players s | LCP s | TBT ms | total KB | JS KB | CSS KB | fonts KB | JSON KB | model KB | offline |",
  );
  console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  const keys = [...new Set(results.map((r) => `${r.profile} ${r.path}`))];
  for (const key of keys) {
    const rs = results.filter((r) => `${r.profile} ${r.path}` === key);
    const m = (f) => median(rs.map(f));
    console.log(
      `| ${rs[0].profile} | \`${rs[0].path}\` | ${S(m((r) => r.fcp))} | ${S(m((r) => r.firstDraw))} | ` +
        `${S(m((r) => r.players))} | ${S(m((r) => r.lcp?.at(-1)?.[0] ?? null))} | ` +
        `${m((r) => r.tbt)?.toFixed(0)} | ${KB(m((r) => r.bytes.total))} | ` +
        `${KB(m((r) => r.bytes.js ?? 0))} | ${KB(m((r) => r.bytes.css ?? 0))} | ` +
        `${KB(m((r) => r.bytes.font ?? 0))} | ${KB(m((r) => r.bytes.json ?? 0))} | ` +
        `${KB(m((r) => r.bytes.model ?? 0))} | ${rs.filter((r) => r.offline).length}/${rs.length} |`,
    );
  }
}

if (opt.from) {
  for (const file of opt.from) report(JSON.parse(readFileSync(file, "utf8")), file);
  process.exit(0);
}

const paths = opt.path ?? ["/"];
const site = new URL(opt.url);
const server = opt.serve ? await serveLikeAzure(opt.serve) : null;
const args = server
  ? [`--host-resolver-rules=MAP ${site.hostname} 127.0.0.1:${PORT}`, "--ignore-certificate-errors"]
  : [];
if (process.platform === "darwin" && !opt.software) args.push("--use-angle=metal");
const results = [];
try {
  for (const name of opt.profiles.split(",")) {
    const profile = PROFILES[name];
    if (!profile) throw new Error(`unknown profile ${name}: ${Object.keys(PROFILES).join(", ")}`);
    for (const path of paths) {
      for (let run = 0; run < Number(opt.runs); run++) {
        // A fresh browser per load: no HTTP cache, no open connections, no DNS cache.
        const browser = await launchChrome({ headless: !opt.headed, software: opt.software, args });
        try {
          const r = await load(browser, profile, new URL(path, site).href, Number(opt.timeout));
          results.push({ profile: name, path, run, ...r });
          console.error(
            `${name} ${path} #${run + 1}: first paint ${S(r.fcp)} s, first draw ${S(r.firstDraw)} s, ` +
              `players ${S(r.players)} s, ${KB(r.bytes.total)} KB` +
              (r.offline ? ", OFFLINE" : ""),
          );
        } finally {
          await browser.close();
        }
      }
    }
  }
} finally {
  server?.close();
}
if (opt.json) writeFileSync(opt.json, JSON.stringify(results, null, 1));
report(results, opt.serve ? `${opt.serve} served as ${site.host}` : site.href);
