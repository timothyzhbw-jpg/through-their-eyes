// YouTube captions for the trailer (SPEC 10): out/video/trailer.srt and .vtt, from the timeline
// the render uses. Every spoken voice-over line becomes one or more cues that follow its speech:
// the start the render gives it, the length of its synthesized audio (a planned length before the
// voice-over has been made), numbers filled from verified claims by lib/claims.mjs. Title cards
// that are not spoken are not captioned. Each cue is at most 2 lines of 42 characters, split at
// clause boundaries.
//
//   node tools/captions.mjs [--spec trailer.json] [--story blender|app] [--naming ids|names]
//                           [--vo-dir out/video/trailer/vo] [--out out/video]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { claimTable, resolveVo } from "../lib/claims.mjs";
import { timelineOf } from "../lib/edit.mjs";
import { namedSpec, storyBeats } from "../lib/spec.mjs";
import { estimateSpeechSeconds, wavSeconds } from "../lib/vo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

export const MAX_LINES = 2;
export const MAX_CHARS = 42;
const GAP = 0.04; // s between a cue and the next line's start

const CJK = /[　-鿿＀-￯]/;
const CLAUSE = /[^,.;:!?—…，。、；：！？]+[,.;:!?—…，。、；：！？]*["”’)）]*/g;

/**
 * Every spoken line of the spec with its absolute start, as the render resolves them (the same
 * `timelineOf` and `resolveVo`). Dropped lines (a missing claim, no fallback) are not spoken.
 * @param {{ beats: object[] }} spec
 * @param {Record<string, object>} table claim table
 * @param {object | null} doc claims.json
 * @returns {Array<{ id: string, start: number, text: string, speaker?: string }>}
 */
export function spokenLines(spec, table, doc) {
  const timeline = timelineOf(spec.beats);
  const lines = [];
  for (const row of timeline.beats) {
    const beat = spec.beats.find((item) => item.id === row.id);
    for (const line of beat.vo ?? []) {
      const resolved = resolveVo(line, table, doc);
      if (resolved.drop) continue;
      lines.push({
        id: line.id,
        start: row.start + (line.at ?? 0),
        text: cleanText(resolved.text),
        ...(line.speaker ? { speaker: line.speaker } : {}),
      });
    }
  }
  return lines;
}

/** The line as spoken on screen: pause marks become spaces, whitespace collapses. */
export function cleanText(text) {
  return String(text ?? "")
    .replace(/\s*\[pause \d+\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split text into display lines of at most `max` characters, at clause boundaries, then at words
 * (or characters, for Chinese) only when one clause is longer than a line.
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
export function splitLines(text, max = MAX_CHARS) {
  const pieces = [];
  for (const clause of text.match(CLAUSE) ?? []) {
    const bit = clause.trim();
    if (!bit) continue;
    if (bit.length <= max) pieces.push(bit);
    else pieces.push(...breakLong(bit, max));
  }
  const lines = [];
  for (const piece of pieces) {
    const last = lines.length - 1;
    const glue = last >= 0 && !CJK.test(lines[last].slice(-1)) && !CJK.test(piece[0]) ? " " : "";
    if (last >= 0 && lines[last].length + glue.length + piece.length <= max && !endsSentence(lines[last])) {
      lines[last] += glue + piece;
    } else {
      lines.push(piece);
    }
  }
  return lines;
}

/** @param {string} s */
function endsSentence(s) {
  return /[.!?。！？…]["”’)）]*$/.test(s);
}

/** One clause longer than a line, cut at spaces where it has them, anywhere where it has none. */
function breakLong(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * One spoken line's cues: its display lines taken `maxLines` at a time, the line's time shared
 * out by characters.
 * @param {{ id: string, text: string }} line
 * @param {number} start s
 * @param {number} end s
 */
export function cuesFor(line, start, end) {
  const lines = splitLines(line.text);
  const groups = [];
  for (let i = 0; i < lines.length; i += MAX_LINES) groups.push(lines.slice(i, i + MAX_LINES));
  const weights = groups.map((g) => g.join("").length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = start;
  return groups.map((group, i) => {
    const to = i === groups.length - 1 ? end : at + ((end - start) * weights[i]) / total;
    const cue = { id: line.id, start: round3(at), end: round3(to), lines: group };
    at = to;
    return cue;
  });
}

/**
 * All cues of the film, in order. A line lasts as long as its audio, ends before the next line
 * starts, and never runs past `total`.
 * @param {Array<{ id: string, start: number, text: string }>} lines
 * @param {(line: { id: string, text: string }) => number} duration s of speech
 * @param {number} total film length, s
 */
export function buildCues(lines, duration, total = Infinity) {
  const ordered = [...lines].sort((a, b) => a.start - b.start);
  const cues = [];
  ordered.forEach((line, i) => {
    const next = ordered[i + 1];
    const end = Math.min(line.start + duration(line), next ? next.start - GAP : Infinity, total);
    if (!(end > line.start)) return;
    cues.push(...cuesFor(line, line.start, end));
  });
  return cues;
}

/** @param {number} s @param {string} sep */
export function timestamp(s, sep) {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
}

/** @param {Array<{ start: number, end: number, lines: string[] }>} cues */
export function toSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${timestamp(c.start, ",")} --> ${timestamp(c.end, ",")}\n${c.lines.join("\n")}\n`)
    .join("\n");
}

/** @param {Array<{ start: number, end: number, lines: string[] }>} cues */
export function toVtt(cues) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = cues
    .map((c) => `${timestamp(c.start, ".")} --> ${timestamp(c.end, ".")}\n${c.lines.map(esc).join("\n")}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** @param {number} n */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      spec: { type: "string" },
      story: { type: "string" },
      naming: { type: "string" },
      "vo-dir": { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  const finals = path.resolve(args.out ?? path.join(ROOT, "out", "video"));
  const voDir = path.resolve(args["vo-dir"] ?? path.join(finals, "trailer", "vo"));
  const spec = JSON.parse(readFileSync(path.resolve(args.spec ?? path.join(ROOT, "video", "trailer.json")), "utf8"));
  // The same two reductions the render applies before it reads the beats.
  spec.beats = storyBeats(spec, args.story);
  Object.assign(spec, namedSpec(spec, args.naming));

  const claimsFile = path.join(finals, "claims.json");
  const doc = existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")) : null;
  const table = doc ? (doc.claims && typeof doc.claims === "object" ? doc.claims : claimTable(doc.sources ?? [])) : {};

  let planned = 0;
  const duration = (line) => {
    const wav = path.join(voDir, `${line.id}.wav`);
    if (existsSync(wav)) return wavSeconds(wav);
    planned++;
    return estimateSpeechSeconds(line.text);
  };
  const cues = buildCues(spokenLines(spec, table, doc), duration, timelineOf(spec.beats).duration);
  mkdirSync(finals, { recursive: true });
  writeFileSync(path.join(finals, "trailer.srt"), toSrt(cues));
  writeFileSync(path.join(finals, "trailer.vtt"), toVtt(cues));
  console.log(`captions: ${cues.length} cues -> ${path.relative(process.cwd(), finals)}/trailer.{srt,vtt}`);
  if (planned) console.log(`  ${planned} lines have no synthesized voice yet; their length is estimated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
