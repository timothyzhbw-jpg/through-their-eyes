// Burned-in captions (SPEC 10): many judges watch muted, so every voice-over line is also on
// screen, as the `caption` title card, over the joined film. The text is the line exactly as
// spoken (slots filled from verified claims), so a number on screen is the number in the voice.

/**
 * When each caption shows: from the line's start until its audio ends plus `tail`, at least
 * `min` seconds, and never into the next caption (`gap` before it) or past the film's end.
 * @param {Array<{ id: string, start: number, duration: number, text: string }>} lines absolute times, s
 * @param {{ tail?: number, min?: number, gap?: number, total?: number }} [opts]
 * @returns {Array<{ id: string, start: number, dur: number, text: string }>}
 */
export function captionTimeline(lines, { tail = 0.25, min = 1.0, gap = 0.05, total = Infinity } = {}) {
  const ordered = [...lines].sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 0; i < ordered.length; i++) {
    const line = ordered[i];
    const next = ordered[i + 1];
    const end = Math.min(next ? next.start - gap : Infinity, total);
    const want = Math.max(min, line.duration + tail);
    const dur = Math.max(0, Math.min(want, end - line.start));
    if (dur < 0.3) continue; // too short to read: the next line has the screen
    out.push({ id: line.id, start: round3(line.start), dur: round3(dur), text: line.text });
  }
  return out;
}

/**
 * Where each caption sits: centred low in the frame, or on the right when a title holds the
 * lower left (a lower-left slam, a tag, the spec sheet) at any moment the caption is up.
 * @param {Array<{ start: number, dur: number }>} cues
 * @param {Array<{ start: number, end: number }>} busy when the lower left is taken, s
 * @returns {Array<{ start: number, dur: number, side: "center" | "right" }>}
 */
export function captionSides(cues, busy) {
  return cues.map((cue) => ({
    ...cue,
    side: busy.some((b) => b.start < cue.start + cue.dur && cue.start < b.end) ? "right" : "center",
  }));
}

/**
 * ffmpeg arguments that lay every caption clip (alpha) over `video` at its start.
 * @param {string} video
 * @param {Array<{ file: string, start: number }>} captions
 * @param {string} out
 * @param {{ fps: number }} size
 */
export function burnArgs(video, captions, out, { fps }) {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", video];
  for (const c of captions) args.push("-i", c.file);
  const parts = [];
  let label = "0:v";
  captions.forEach((c, i) => {
    parts.push(`[${i + 1}:v]setpts=PTS+${c.start}/TB,format=yuva420p[c${i}]`);
    parts.push(`[${label}][c${i}]overlay=0:0:eof_action=pass:format=auto[v${i}]`);
    label = `v${i}`;
  });
  if (!captions.length) parts.push("[0:v]null[v0]");
  const last = captions.length ? `v${captions.length - 1}` : "v0";
  parts.push(`[${last}]fps=${fps},format=yuv420p[vout]`);
  return [
    ...args,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "14",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    out,
  ];
}

/** @param {number} n */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
