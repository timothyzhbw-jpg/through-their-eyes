// assets.json: only CC0 or public domain, and the page URL has to be in CREDITS.md.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assetFileName, downloadAsset, validateAssets } from "../lib/assets.mjs";

function asset(over = {}) {
  return {
    id: "bed",
    kind: "music",
    title: "Bed",
    author: "A",
    page: "https://example.com/bed",
    file: "https://example.com/bed.ogg",
    licence: "CC0-1.0",
    sha256: "ab".repeat(32),
    checked_on: "2026-10-21",
    ...over,
  };
}

test("an empty list is valid", () => {
  assert.deepEqual(validateAssets([], "").errors, []);
});

test("any other licence is rejected", () => {
  const { errors } = validateAssets([asset({ licence: "CC-BY-4.0" })], "https://example.com/bed");
  assert.ok(errors.some((error) => error.includes('licence "CC-BY-4.0" is not CC0-1.0 or Public Domain')));
});

test("a page URL missing from the credits is rejected", () => {
  const { errors } = validateAssets([asset()], "no urls here");
  assert.ok(errors.some((error) => error.includes("page URL is not in video/CREDITS.md")));
  assert.deepEqual(validateAssets([asset({ licence: "Public Domain" })], "see https://example.com/bed").errors, []);
});

test("a sha256 mismatch names the expected and the actual hash", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tte-asset-"));
  const body = Buffer.from("not-the-file");
  const actual = createHash("sha256").update(body).digest("hex");
  const item = asset();
  await assert.rejects(
    () =>
      downloadAsset(item, path.join(dir, assetFileName(item)), {
        fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => body }),
      }),
    (err) => {
      assert.match(err.message, new RegExp(`expected ${item.sha256}`));
      assert.match(err.message, new RegExp(`got ${actual}`));
      return true;
    },
  );
});

test("the download file name keeps the URL extension", () => {
  assert.equal(assetFileName(asset()), "bed.ogg");
});
