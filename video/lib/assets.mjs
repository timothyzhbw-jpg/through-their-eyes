// Music and source-effect files named in assets.json (SPEC 10). The list starts empty; the
// lead adds CC0 or public-domain tracks. --check rejects any other licence, and rejects an
// asset whose page URL is not written up in video/CREDITS.md. The download checks sha256
// before the file is renamed into place.

import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const LICENCES = ["CC0-1.0", "Public Domain"];

/**
 * @param {unknown} assets
 * @param {string} credits the text of video/CREDITS.md
 * @returns {{ errors: string[] }}
 */
export function validateAssets(assets, credits) {
  const errors = [];
  if (!Array.isArray(assets)) return { errors: ["assets.json: expected a list"] };
  const seen = new Set();
  assets.forEach((asset, i) => {
    const where = `assets[${i}] (${asset?.id ?? "?"})`;
    if (!asset || typeof asset !== "object") {
      errors.push(`${where}: expected an object`);
      return;
    }
    if (typeof asset.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(asset.id)) {
      errors.push(`${where}: id is not a safe file name`);
    } else if (seen.has(asset.id)) errors.push(`${where}: duplicate id "${asset.id}"`);
    seen.add(asset.id);
    if (asset.kind !== "music" && asset.kind !== "sfx") errors.push(`${where}: kind must be music or sfx`);
    for (const key of ["title", "author", "page", "file"]) {
      if (typeof asset[key] !== "string" || !asset[key]) errors.push(`${where}: ${key} is required`);
    }
    if (typeof asset.file === "string" && !/^https?:\/\//.test(asset.file)) {
      errors.push(`${where}: file must be an http(s) URL`);
    }
    if (!LICENCES.includes(asset.licence)) {
      errors.push(`${where}: licence "${asset.licence}" is not CC0-1.0 or Public Domain`);
    }
    if (typeof asset.page === "string" && asset.page && !credits.includes(asset.page)) {
      errors.push(`${where}: page URL is not in video/CREDITS.md`);
    }
    if (typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(asset.sha256)) {
      errors.push(`${where}: sha256 must be 64 hex characters`);
    }
    if (typeof asset.checked_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asset.checked_on)) {
      errors.push(`${where}: checked_on must be YYYY-MM-DD`);
    }
  });
  return { errors };
}

/** File name under the assets directory: `<id>.<ext>` from the download URL. */
export function assetFileName(asset) {
  let ext = "";
  try {
    ext = path.extname(new URL(asset.file).pathname);
  } catch {
    ext = "";
  }
  return `${asset.id}${ext || ".bin"}`;
}

/**
 * Download one asset to a temp file, check sha256, then rename. A mismatch names both hashes.
 * @param {object} asset
 * @param {string} dest
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function downloadAsset(asset, dest, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(asset.file, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`asset "${asset.id}": download failed (${res.status}) ${asset.file}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual.toLowerCase() !== String(asset.sha256).toLowerCase()) {
    throw new Error(`asset "${asset.id}": sha256 mismatch: expected ${asset.sha256}, got ${actual}`);
  }
  const tmp = `${dest}.partial`;
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
}
