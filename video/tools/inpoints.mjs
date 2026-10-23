#!/usr/bin/env node
// Capture in-points against the captures on disk (SPEC 10). After a re-capture the app's timing
// moves (a slower model call, a new layout), so a beat can start before the thing it shows or run
// past the clip's end. For every capture beat (and capture half of a split) this prints the window
// it plays, the capture's length and the capture kit's action log inside that window, and flags a
// window that runs past the end.
//
//   node video/tools/inpoints.mjs                 # the Blender telling of video/trailer.json
//   node video/tools/inpoints.mjs --spec out/video/trailer_edit.json

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storyBeats } from "../lib/spec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const specAt = argv.indexOf("--spec");
const specPath = path.resolve(ROOT, specAt >= 0 ? argv[specAt + 1] : "video/trailer.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const manifestPath = path.join(ROOT, "out", "video", "manifest.json");
if (!existsSync(manifestPath)) throw new Error("out/video/manifest.json is missing: run the capture kit first");
const shots = new Map(JSON.parse(readFileSync(manifestPath, "utf8")).shots.map((s) => [s.id, s]));

const r2 = (n) => Math.round(n * 100) / 100;
let late = 0;
for (const beat of storyBeats(spec)) {
  const p = beat.picture ?? {};
  const parts = p.src === "split" ? [["L", p.left], ["R", p.right]] : [["", p]];
  for (const [side, part] of parts) {
    if (part?.src !== "capture") continue;
    const shot = shots.get(part.shot);
    const from = part.in ?? 0;
    const to = from + beat.dur * (part.speed ?? p.speed ?? 1);
    const len = shot?.duration_s ?? null;
    const acts = (shot?.log ?? []).filter((a) => a.t >= from - 0.5 && a.t <= to).map((a) => `${a.t}s ${a.action}`);
    const over = len != null && to > len + 1e-6;
    if (over || len == null) late += 1;
    console.log(
      `${(beat.id + (side ? `:${side}` : "")).padEnd(22)} ${part.shot.padEnd(17)} ${String(r2(from)).padStart(6)} → ${String(r2(to)).padEnd(6)} ` +
        `of ${len == null ? "MISSING" : r2(len)}${over ? "  PAST THE END" : ""}${acts.length ? `  [${acts.join("; ")}]` : ""}`,
    );
  }
}
process.exitCode = late ? 1 : 0;
