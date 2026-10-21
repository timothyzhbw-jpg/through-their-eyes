// The capture kit still has no exports, and the trailer loads cine and titles only when it runs them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("capture.mjs exports nothing and --list still prints the shot plan", () => {
  const source = readFileSync(path.join(REPO, "video/capture.mjs"), "utf8");
  assert.equal(/\bexport\b/.test(source), false);
  assert.match(source, /from "\.\/lib\/claims\.mjs"/);
  const run = spawnSync(process.execPath, ["video/capture.mjs", "--list"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /03-breakdown/);
});

test("trailer.mjs imports cine and titles only from inside the steps", () => {
  const source = readFileSync(path.join(REPO, "video/trailer.mjs"), "utf8");
  assert.equal(/from\s+["']\.\/lib\/cine\.mjs["']/.test(source), false);
  assert.equal(/from\s+["']\.\/lib\/titles\.mjs["']/.test(source), false);
  assert.match(source, /"\.\/lib\/cine\.mjs"/);
  assert.match(source, /"\.\/lib\/titles\.mjs"/);
});
