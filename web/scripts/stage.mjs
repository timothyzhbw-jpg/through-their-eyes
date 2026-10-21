// Stages the build for the Azure Storage static website (SPEC 8), which sends each blob exactly as
// stored, with the Content-Encoding and Cache-Control given at upload, and never compresses on the
// fly: served raw, the JS alone was 1.6 MB on the wire. Each upload batch gets its own directory
// and a line in batches.tsv (directory, encoding or "-", Cache-Control), in upload order:
//
//   assets-gz  gzip  hashed assets that shrink: cached for a year, immutable
//   assets     -     other hashed assets, the same cache
//   gz         gzip  everything else that shrinks (bundled data, the players' model)
//   plain      -     the rest (small or incompressible files)
//   index      -     index.html, last and revalidated on every visit (no-cache), so a visitor
//                    never gets a page whose assets are not uploaded yet
//
// gzip, not Brotli: Storage cannot pick an encoding per request, every browser and proxy takes
// gzip, and Brotli would save only about 20% more.
//
//   node scripts/stage.mjs [build dir, default dist] [out dir, default dist-upload]
//
// infra/upload_web.sh runs it and uploads the batches; scripts/loadperf.mjs serves them locally.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300"; // not hashed: fresh within 5 min of a deploy
export const BATCHES = [
  ["assets-gz", "gzip", IMMUTABLE],
  ["assets", "-", IMMUTABLE],
  ["gz", "gzip", SHORT],
  ["plain", "-", SHORT],
  ["index", "-", "no-cache"],
];
const TEXT = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".svg",
  ".txt",
  ".md",
  ".glb",
  ".map",
  ".wasm",
]);
const MIN_BYTES = 1024; // below this a request costs more than the bytes
const MIN_SAVING = 0.1;

function* walk(dir, base = dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path, base);
    else yield relative(base, path).split("\\").join("/");
  }
}

/** Stage `dist` into `out`; returns { batch: [files] }. */
export function stage(dist, out) {
  rmSync(out, { recursive: true, force: true });
  const staged = Object.fromEntries(BATCHES.map(([b]) => [b, []]));
  for (const rel of walk(dist)) {
    const data = readFileSync(join(dist, rel));
    let bytes = data;
    let gz = false;
    if (rel !== "index.html" && TEXT.has(extname(rel)) && data.length >= MIN_BYTES) {
      const packed = gzipSync(data, { level: constants.Z_BEST_COMPRESSION });
      if (packed.length <= (1 - MIN_SAVING) * data.length) [bytes, gz] = [packed, true];
    }
    const hashed = rel.startsWith("assets/");
    const batch =
      rel === "index.html" ? "index" : hashed ? (gz ? "assets-gz" : "assets") : gz ? "gz" : "plain";
    const target = join(out, batch, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    staged[batch].push(rel);
  }
  const lines = BATCHES.filter(([b]) => staged[b].length).map((row) => row.join("\t"));
  writeFileSync(join(out, "batches.tsv"), lines.join("\n") + "\n");
  return staged;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? join(WEB, "dist");
  const out = process.argv[3] ?? join(WEB, "dist-upload");
  const staged = stage(dist, out);
  for (const [batch, files] of Object.entries(staged)) {
    if (!files.length) continue;
    const size = (b) => files.reduce((s, f) => s + statSync(join(b, f)).size, 0);
    const from = size(dist);
    const to = size(join(out, batch));
    console.log(
      `${batch.padEnd(9)} ${String(files.length).padStart(3)} files  ` +
        `${(from / 1024).toFixed(0).padStart(6)} KB -> ${(to / 1024).toFixed(0).padStart(6)} KB`,
    );
  }
}
