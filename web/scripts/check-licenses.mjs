// Fail if any installed npm package is not under an allowed licence (CLAUDE.md, constraint 5).
// Reads the licence field of every package.json under node_modules; no extra dependency.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "CC0-1.0",
]);
// Packages whose licence field is missing or non-standard, checked by hand.
const REVIEWED = {
  "webgl-constants": "", // no licence field; its LICENSE file is MIT (via drei -> detect-gpu)
};
// MPL-2.0 is allowed only as an unmodified dependency: Vite's CSS minifier and its binaries, and
// axe-core (dev only: the accessibility audit injects its unmodified axe.min.js into the page).
const UNMODIFIED_MPL = /^(lightningcss(-.+)?|axe-core)$/;

function licenceOf(pkg) {
  const raw = pkg.license ?? pkg.licenses;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((l) => l.type ?? l).join(" OR ");
  if (raw && typeof raw === "object") return raw.type ?? "";
  return "";
}

function allowed(expr) {
  // SPDX "A OR B" is fine if any side is allowed; "A AND B" needs both.
  const clean = expr.replace(/[()]/g, "");
  if (clean.includes(" OR ")) return clean.split(" OR ").some((p) => allowed(p.trim()));
  if (clean.includes(" AND ")) return clean.split(" AND ").every((p) => allowed(p.trim()));
  return ALLOWED.has(clean.trim());
}

function* packages(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (name.startsWith("@")) {
      yield* packages(path);
      continue;
    }
    const manifest = join(path, "package.json");
    if (existsSync(manifest)) {
      yield { path, pkg: JSON.parse(readFileSync(manifest, "utf8")) };
      yield* packages(join(path, "node_modules"));
    }
  }
}

const bad = [];
let count = 0;
for (const { path, pkg } of packages("node_modules")) {
  if (!pkg.name || !pkg.version) continue;
  count++;
  const licence = licenceOf(pkg);
  if (allowed(licence) || REVIEWED[pkg.name] === licence) continue;
  if (licence === "MPL-2.0" && UNMODIFIED_MPL.test(pkg.name)) continue;
  bad.push(`${pkg.name}@${pkg.version}: ${licence || "(none)"}  [${path}]`);
}
if (bad.length) {
  console.error(`Disallowed or unknown licences:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log(`licences ok: ${count} packages`);
