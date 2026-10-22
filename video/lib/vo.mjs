// Voice-over SSML for Azure AI Speech (SPEC 10), plus the timing warnings the report lists.
// The only markup inside the spoken text is `[pause 400]`, which becomes a break. Everything
// else is escaped. Synthesis itself is video/tts.py; this module only builds the SSML and
// reads the WAV it writes.

import { readFileSync } from "node:fs";
import { readWav } from "./wav.mjs";

/**
 * @typedef {{ name: string, lang: string, rate?: string, pitch?: string, fx?: string }} Voice
 */

/**
 * The voice for a line. `en` (and anything unlabelled) uses the main voice; another language
 * uses `voices[lang]`, keeping the main voice's rate and pitch when the override omits them.
 * @param {{ voice: Voice, voices?: Record<string, Partial<Voice>> }} spec
 * @param {string | undefined} lang
 * @param {string} [speaker] a key of `spec.speakers`
 * @returns {Voice}
 */
export function voiceFor(spec, lang, speaker) {
  // A named speaker (e.g. the coach in the story) has a voice of its own, untouched by the
  // narrator's rate, pitch and trailer processing.
  if (speaker && spec.speakers?.[speaker]) {
    const who = spec.speakers[speaker];
    return { name: who.name, lang: who.lang ?? "en-US", rate: who.rate ?? "0%", pitch: who.pitch ?? "0%", fx: who.fx };
  }
  const base = spec.voice;
  const code = lang || base.lang;
  const same =
    !lang || lang === base.lang || (lang === "en" && String(base.lang).toLowerCase().startsWith("en"));
  if (same) return { ...base, rate: base.rate ?? "0%", pitch: base.pitch ?? "0%" };
  const over = spec.voices?.[lang] ?? {};
  return {
    name: over.name ?? base.name,
    lang: over.lang ?? code,
    rate: over.rate ?? base.rate ?? "0%",
    pitch: over.pitch ?? base.pitch ?? "0%",
    fx: base.fx,
  };
}

/** Escape text for SSML, then turn `[pause N]` into a break. The digits live only in the break. */
export function ssmlText(text) {
  const parts = String(text).split(/(\[pause\s+\d+\])/g);
  return parts
    .map((part) => {
      const pause = part.match(/^\[pause\s+(\d+)\]$/);
      if (pause) return `<break time="${pause[1]}ms"/>`;
      return escapeXml(part);
    })
    .join("");
}

/**
 * One `<speak>` document.
 * @param {{ text: string, voice: Voice, style?: string, degree?: number }} line
 */
export function buildSsml(line) {
  const { voice } = line;
  const inner = `<prosody rate="${escapeXml(voice.rate ?? "0%")}" pitch="${escapeXml(voice.pitch ?? "0%")}">${ssmlText(line.text)}</prosody>`;
  const voiced =
    line.style != null && line.style !== ""
      ? `<mstts:express-as style="${escapeXml(line.style)}"${
          line.degree != null ? ` styledegree="${line.degree}"` : ""
        }>${inner}</mstts:express-as>`
      : inner;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeXml(voice.lang)}">` +
    `<voice name="${escapeXml(voice.name)}">${voiced}</voice></speak>`
  );
}

/**
 * A planned length for a line we have not synthesized (the `--no-vo` stand-in, and the
 * "does the planned VO fit" warning). About two and a half words a second, plus pauses.
 * @param {string} text
 */
export function estimateSpeechSeconds(text) {
  let pauses = 0;
  for (const match of String(text).matchAll(/\[pause\s+(\d+)\]/g)) pauses += Number(match[1]) / 1000;
  const bare = String(text)
    .replace(/\[pause\s+\d+\]/g, " ")
    .replace(/\{[a-z_]+\.[a-z_]+\}/g, " x ");
  const words = bare.split(/\s+/).filter(Boolean).length;
  return words / 2.5 + pauses;
}

/**
 * ffmpeg audio filters that make the read sound like a trailer: pitch down about 4% at the
 * same tempo, a 70 Hz high-pass, a little 120 Hz, a gentle compressor, a short quiet room.
 * The WAV arrives at 24 kHz mono; this resamples to 48 kHz.
 */
export function trailerVoiceFilters() {
  const pitch = 0.96;
  const rate = Math.round(48000 * pitch);
  const tempo = (1 / pitch).toFixed(6);
  return [
    "aresample=48000",
    `asetrate=${rate}`,
    "aresample=48000",
    `atempo=${tempo}`,
    "highpass=f=70",
    "equalizer=f=120:t=q:w=1:g=3",
    "acompressor=threshold=-18dB:ratio=2.5:attack=8:release=80:makeup=2",
    "aecho=0.8:0.88:30:0.18",
  ].join(",");
}

/**
 * A line longer than the gap before the next line starts. A line may run on over later beats (a
 * trailer voice crosses cuts); it may not run into the next line, or past `total` (the trailer's end).
 * @param {Array<{ id: string, beat: string, beatStart: number, beatDur: number, at: number, duration: number }>} lines
 * @param {number} [total] the trailer's length in seconds
 * @returns {string[]}
 */
export function voRoomWarnings(lines, total = Infinity) {
  const ordered = [...lines].sort((a, b) => a.beatStart + a.at - (b.beatStart + b.at));
  const warnings = [];
  for (let i = 0; i < ordered.length; i++) {
    const line = ordered[i];
    const abs = line.beatStart + line.at;
    const next = ordered[i + 1];
    const gap = next ? next.beatStart + next.at - abs : total - abs;
    if (line.duration > gap + 0.02) {
      const limit = next ? `the next line (${next.id})` : "the end of the trailer";
      warnings.push(
        `vo "${line.id}" on ${line.beat} is ${line.duration.toFixed(2)}s, longer than the ${gap.toFixed(2)}s before ${limit}`,
      );
    }
  }
  return warnings;
}

/** Seconds of audio in a WAV file. */
export function wavSeconds(file) {
  return readWav(readFileSync(file)).duration;
}

/** @param {string} s */
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}
