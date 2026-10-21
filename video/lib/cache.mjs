// Step cache. The hash of a step's inputs sits next to its output as `<file>.hash`;
// a step is skipped when the output exists and that hash is unchanged. `--force` ignores it.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** @param {unknown[]} parts */
export function digest(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(typeof part === "string" ? part : JSON.stringify(part));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** @param {string} file @param {string} hash */
export function isCached(file, hash) {
  const side = `${file}.hash`;
  if (!existsSync(file) || !existsSync(side)) return false;
  return readFileSync(side, "utf8").trim() === hash;
}

/** @param {string} file @param {string} hash */
export function storeHash(file, hash) {
  writeFileSync(`${file}.hash`, `${hash}\n`);
}
