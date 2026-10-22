#!/usr/bin/env node
// Drop approved Blender finals into their beats (SPEC 10). video/blender_map.json says how each
// Blender beat is filled: the clip and in-point, a freeze, name cards, the corner label. The cut
// keeps placeholder cards of the planned lengths until the clips are in out/video/blender/.
//
//   node video/tools/blender_fit.mjs               # which finals are in, their lengths vs the beats
//   node video/tools/blender_fit.mjs --apply       # fill every beat whose clips are approved and in place,
//                                                  # keeping lengths (list approved files in the map's `approved`)
//   node video/tools/blender_fit.mjs --apply --fit # and give "fit" beats their clip's length
//   node video/tools/blender_fit.mjs --apply --fit --preview --dir out/video/blender_v3 \
//       --write out/video/trailer_preview.json      # a preview cut from candidates, trailer.json untouched
//
// After --fit: check the totals it prints (both tellings equal, under output.max_s), then
// re-time the score (video/score/cues, trailer_ref) and run the trailer.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SPEC = path.join(ROOT, "video", "trailer.json");
const MAP = path.join(ROOT, "video", "blender_map.json");
const LABELS = {
  dramatisation: "DRAMATISATION · RENDERED IN BLENDER",
  simulation: "RENDERED IN BLENDER FROM OUR SIMULATION DATA",
};

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const fit = argv.includes("--fit");
// --preview: use the candidates before approval, and mark the whole film as a preview.
// --drop a.mp4,b.mp4: shots the art director dropped; their section goes back to the in-engine
// telling (open: S1/S2, close: S4). --final: approved clips only, and no preview mark.
const preview = argv.includes("--preview");
const final = argv.includes("--final");
const dropAt = argv.indexOf("--drop");
const dropped = new Set(dropAt >= 0 ? (argv[dropAt + 1] ?? "").split(",").filter(Boolean) : []);
const WATERMARK = "PREVIEW · BLENDER SHOTS PENDING APPROVAL";
// --dir <path>: take the clips from another folder inside the repo (candidates for a preview).
const dirAt = argv.indexOf("--dir");
const clipDir = dirAt >= 0 ? argv[dirAt + 1].replace(/\/$/, "") : null;
// --write <path>: write the result there instead of over trailer.json (a preview cut).
const writeAt = argv.indexOf("--write");
const target = writeAt >= 0 ? path.resolve(ROOT, argv[writeAt + 1]) : SPEC;
const relocate = (p) => (clipDir && typeof p === "string" ? p.replace(/^out\/video\/blender\//, `${clipDir}/`) : p);
const spec = JSON.parse(readFileSync(SPEC, "utf8"));
const map = JSON.parse(readFileSync(MAP, "utf8"));
for (const pin of map.pins ?? []) for (const key of ["clip", "corners", "matte", "ref_corners"]) pin[key] = relocate(pin[key]);
for (const entry of map.beats) {
  if (entry.picture.src === "split") {
    entry.picture.left.path = relocate(entry.picture.left.path);
    entry.picture.right.path = relocate(entry.picture.right.path);
  } else entry.picture.path = relocate(entry.picture.path);
}
const pins = new Map((map.pins ?? []).map((pin) => [`out/video/trailer/pins/${pin.id}.mp4`, pin]));

const seconds = (file) => {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return out.status === 0 ? Number(out.stdout.trim()) : null;
};
/** The rendered clips a beat needs (a pinned clip needs its source clip). */
const sources = (picture) => {
  if (picture.src === "split") return [picture.left.path, picture.right.path];
  const pin = pins.get(picture.path);
  return [pin ? pin.clip : picture.path];
};
const round3 = (n) => Math.round(n * 1000) / 1000;

let changed = false;
const fallback = new Set(); // sections that go back to the in-engine telling
console.log("beat                    clip                       in     have       clip len  beat dur");
for (const entry of map.beats) {
  const beat = spec.beats.find((b) => b.id === entry.beat);
  if (!beat) throw new Error(`${entry.beat} is in blender_map.json but not in trailer.json`);
  const files = sources(entry.picture);
  // A clip counts only once it is approved (or for a preview): rejected renders share the
  // finals' file names. A dropped clip never counts.
  const isDropped = files.some((f) => dropped.has(path.basename(f)));
  const approved = !isDropped && (preview || files.every((f) => (map.approved ?? []).includes(path.basename(f))));
  const have = approved && files.every((f) => existsSync(path.join(ROOT, f)));
  if (isDropped && beat.section) fallback.add(beat.section);
  const len = have && entry.picture.src !== "split" ? seconds(path.join(ROOT, files[0])) : null;
  const usable = len != null ? round3(len - (entry.picture.in ?? 0)) : null;
  console.log(
    `${entry.beat.padEnd(23)} ${path.basename(files[0]).padEnd(26)} ${String(entry.picture.in ?? 0).padEnd(6)} ` +
      `${(have ? "yes" : approved ? "no" : "unapproved").padEnd(10)} ${String(usable ?? "-").padEnd(9)} ${beat.dur}`,
  );
  if (!apply || !have) continue;
  beat.picture = entry.picture;
  for (const key of ["letterbox", "fx", "freeze", "sfx"]) {
    if (entry[key] != null) beat[key] = entry[key];
    else delete beat[key];
  }
  if (fit && entry.fit && usable != null) beat.dur = usable;
  const overlays = [...(entry.overlays ?? [])];
  if (entry.label) {
    const key = `label-${entry.label === "simulation" ? "bl" : "dr"}-${String(beat.dur).replace(".", "p")}`;
    spec.titles[key] = { template: "label", dur: beat.dur, alpha: true, params: { text: LABELS[entry.label] } };
    overlays.unshift({ title: key, at: 0.0 });
  }
  beat.overlays = overlays;
  for (const o of overlays) if (map.titles?.[o.title]) spec.titles[o.title] = map.titles[o.title];
  if (pins.has(entry.picture.path)) {
    spec.pins = spec.pins ?? [];
    const pin = pins.get(entry.picture.path);
    if (!spec.pins.some((p) => p.id === pin.id)) spec.pins.push(pin);
  }
  changed = true;
}

if (apply) {
  spec.story = fallback.size ? { open: fallback.has("open") ? "app" : "blender", close: fallback.has("close") ? "app" : "blender" } : "blender";
  if (preview) spec.watermark = WATERMARK;
  if (final) delete spec.watermark;
  changed = true;
  if (fallback.size) console.log(`in-engine telling for: ${[...fallback].join(", ")}`);
}
const pickOf = (b, story) => (typeof story === "string" ? story : (story?.[b.section] ?? "blender"));
const length = (story) => round3(spec.beats.filter((b) => b.story == null || b.story === pickOf(b, story)).reduce((s, b) => s + b.dur, 0));
const blender = length(spec.story ?? "blender");
const app = length("app");
console.log(`\ntotal: this cut ${blender} s, in-engine telling ${app} s; cap ${spec.output?.max_s ?? 120} s`);
if (changed) {
  spec.music = (spec.music ?? []).map((m) => ({ ...m, until: blender }));
  writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`${path.relative(ROOT, target)} written`);
}
let bad = false;
if (Math.abs(blender - app) > 1e-6) {
  // The score is re-timed to whatever is cut; equal tellings only keep the fallback one switch away.
  console.log(`the cut and the in-engine telling differ by ${round3(blender - app)} s: match the app telling's sections before the final`);
  if (!preview) bad = true;
}
if (blender > (spec.output?.max_s ?? 120)) {
  console.log("over output.max_s: trim the feature chapters");
  bad = true;
}
process.exitCode = bad ? 1 : 0;
