// Stages the build for the Azure Storage static website (SPEC 8), which sends each blob exactly as
// stored, with the Content-Type, Content-Encoding and Cache-Control given at upload, and never
// compresses on the fly: served raw, the JS alone was 1.6 MB on the wire. Each upload batch gets
// its own directory and a line in batches.tsv (directory, encoding or "-", Cache-Control,
// Content-Type or "-"), in upload order:
//
//   assets/<type>  hashed files from the build, gzipped where that pays
//   files/<type>   everything else but index.html (bundled data, the players' model, …)
//   index          index.html, last and revalidated on every visit (no-cache)
//
// Every batch names its Content-Type: `az storage blob upload-batch` guesses one from the
// extension only when no Content-Encoding is given, so on 2026-10-21 (#115) every gzipped file
// went up as application/octet-stream and browsers refused the scripts. infra/upload_web.sh reads
// each file back from the site (scripts/check-site.mjs) before index.html goes up.
//
// Cache: 5 minutes for everything but index.html, hashed or not, until that check has run clean on
// a few deploys: a file served wrongly under its final hashed name with a year's `immutable` stays
// broken in every browser that fetched it.
//
// gzip, not Brotli: Storage cannot pick an encoding per request, every browser and proxy takes
// gzip, and Brotli would save only about 20% more.
//
//   node scripts/stage.mjs [build dir, default dist] [out dir, default dist-upload]

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

const WEB = fileURLToPath(new URL("..", import.meta.url));
export const CACHE = "public, max-age=300";
export const INDEX_CACHE = "no-cache";
/** What a browser needs each file served as. Unknown extensions are left to az's guess. */
export const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".md": "text/markdown",
};
const TEXT = new Set([".js", ".mjs", ".css", ".json", ".map", ".svg", ".txt", ".md", ".glb"]);
const MIN_BYTES = 1024; // below this a request costs more than the bytes
const MIN_SAVING = 0.1;

function* walk(dir, base = dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path, base);
    else yield relative(base, path).split("\\").join("/");
  }
}

/** Stage `dist` into `out`. Returns the batches in upload order. */
export function stage(dist, out) {
  rmSync(out, { recursive: true, force: true });
  const batches = new Map(); // dir -> { dir, encoding, cache, type, files }
  for (const rel of walk(dist)) {
    const data = readFileSync(join(dist, rel));
    const ext = extname(rel).toLowerCase();
    let bytes = data;
    let encoding = "-";
    if (rel !== "index.html" && TEXT.has(ext) && data.length >= MIN_BYTES) {
      const packed = gzipSync(data, { level: constants.Z_BEST_COMPRESSION });
      if (packed.length <= (1 - MIN_SAVING) * data.length) [bytes, encoding] = [packed, "gzip"];
    }
    const type = TYPES[ext] ?? "-";
    const group = rel === "index.html" ? "index" : rel.startsWith("assets/") ? "assets" : "files";
    const dir =
      group === "index"
        ? "index"
        : `${group}/${type === "-" ? "other" : type.replace("/", "-")}${encoding === "gzip" ? "-gz" : ""}`;
    if (!batches.has(dir)) {
      const cache = group === "index" ? INDEX_CACHE : CACHE;
      batches.set(dir, { dir, encoding, cache, type, files: [] });
    }
    const target = join(out, dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    batches.get(dir).files.push(rel);
  }
  const order = (b) => (b.dir === "index" ? 2 : b.dir.startsWith("assets/") ? 0 : 1);
  const list = [...batches.values()].sort(
    (a, b) => order(a) - order(b) || (a.dir < b.dir ? -1 : 1),
  );
  const lines = list.map((b) => [b.dir, b.encoding, b.cache, b.type].join("\t"));
  writeFileSync(join(out, "batches.tsv"), lines.join("\n") + "\n");
  return list;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? join(WEB, "dist");
  const out = process.argv[3] ?? join(WEB, "dist-upload");
  for (const b of stage(dist, out)) {
    const size = (base) => b.files.reduce((s, f) => s + statSync(join(base, f)).size, 0);
    const from = size(dist);
    const to = size(join(out, b.dir));
    console.log(
      `${b.dir.padEnd(32)} ${String(b.files.length).padStart(3)} files  ` +
        `${(from / 1024).toFixed(0).padStart(6)} KB -> ${(to / 1024).toFixed(0).padStart(6)} KB`,
    );
  }
}
