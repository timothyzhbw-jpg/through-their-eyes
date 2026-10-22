#!/usr/bin/env node
// A preview of the score on a rendered cut: the cut's picture, its voice-over and effects mixed
// exactly as the trailer edit mixes them (video/lib/edit.mjs mixGraph: the trailer voice chain,
// the music side-chained under the voice), with our score as the music. Writes a 720p MP4.
//
//   node video/score/preview.mjs --spec <trailer.json> --picture <cut.mp4> --vo <dir> --sfx <dir> \
//     --score out/score/grime/score.wav --out out/score/preview_grime.mp4 [--gain -1] [--duck -9]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { loudnormFilter, mixGraph, timelineOf } from "../lib/edit.mjs";

function args(argv) {
  const out = { gain: 0, duck: -9, lufs: -14, tp: -2, height: 720, crf: 23 }; // tp: the AAC encode overshoots by ~0.5 dB
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    out[key] = argv[i + 1];
  }
  for (const key of ["gain", "duck", "lufs", "tp", "height", "crf"]) out[key] = Number(out[key]);
  for (const key of ["spec", "picture", "vo", "sfx", "score", "out"]) {
    if (!out[key]) throw new Error(`missing --${key}`);
  }
  return out;
}

function ffmpeg(list, { capture = false } = {}) {
  const run = spawnSync("nice", ["-n", "10", "ffmpeg", ...list], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.slice(-2000)}`);
  return capture ? run.stderr : "";
}

const opt = args(process.argv.slice(2));
const { readFileSync } = await import("node:fs");
const spec = JSON.parse(readFileSync(opt.spec, "utf8"));
const timeline = timelineOf(spec.beats);

const vo = [];
const sfx = [];
for (const row of timeline.beats) {
  const beat = spec.beats.find((b) => b.id === row.id);
  for (const line of beat.vo ?? []) {
    const file = path.join(opt.vo, `${line.id}.wav`);
    if (existsSync(file)) vo.push({ start: row.start + (line.at ?? 0), file });
    else console.warn(`no voice file for ${line.id}; skipped`);
  }
  for (const effect of beat.sfx ?? []) {
    const file = path.join(opt.sfx, `${effect.name}.wav`);
    if (existsSync(file)) sfx.push({ start: row.start + effect.at, gainDb: effect.gain_db ?? 0, file });
  }
}
const music = [
  { at: 0, from: 0, until: timeline.duration, gainDb: opt.gain, fadeIn: 0, fadeOut: 0.05, duckDb: opt.duck, file: opt.score },
];
const graph = mixGraph({ videoDuration: timeline.duration, voiceFx: spec.voice?.fx, vo, sfx, music });

mkdirSync(path.dirname(opt.out), { recursive: true });
const premix = opt.out.replace(/\.mp4$/, ".premix.wav");
const mixWav = opt.out.replace(/\.mp4$/, ".mix.wav");
const inputs = [...vo, ...sfx, ...music].flatMap((c) => ["-i", c.file]);
ffmpeg(["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", graph.filter, "-map", "[mix]",
  "-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2", premix]);

const output = { lufs: opt.lufs, true_peak: opt.tp };
const measured = ffmpeg(["-hide_banner", "-i", premix, "-af", loudnormFilter(output), "-f", "null", "-"], { capture: true });
const json = JSON.parse(measured.slice(measured.lastIndexOf("{"), measured.lastIndexOf("}") + 1));
ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", premix, "-af", loudnormFilter(output, json),
  "-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2", mixWav]);

const audioCodec = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout.includes("aac_at")
  ? "aac_at"
  : "aac";
ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", opt.picture, "-i", mixWav, "-map", "0:v:0", "-map", "1:a:0",
  "-vf", `scale=-2:${opt.height}:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", String(opt.crf),
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", audioCodec, "-b:a", "256k", "-ar", "48000",
  "-t", String(timeline.duration), opt.out]);

const loud = ffmpeg(["-hide_banner", "-i", opt.out, "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true });
const lufs = loud.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop();
const peak = loud.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop();
const mb = (statSync(opt.out).size / 1e6).toFixed(1);
console.log(`${opt.out}: ${timeline.duration} s, ${mb} MB, ${lufs}, true ${peak}`);
