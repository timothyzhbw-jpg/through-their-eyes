// The edit as pure ffmpeg argument lists (SPEC 10). Nothing here spawns ffmpeg, so the
// timeline, the per-beat filters and the mix can be unit-tested. A small runner in
// ffmpeg.mjs executes the lists.
//
// Picture length of beat i is dur + tail, where tail is the outgoing transition (0 for a
// cut). The incoming beat starts at the sum of the previous durs; the outgoing tail overlaps
// it, so the film's length is the sum of the durs (plus a last tail, which the spec forbids).

import { trailerVoiceFilters } from "./vo.mjs";

/** @type {Record<string, string>} */
export const XFADE = {
  fade: "fade",
  flash: "fadewhite",
  dip: "fadeblack",
  whip: "smoothleft",
  glitch: "pixelize",
};

const GRADE = {
  none: "",
  night: "eq=contrast=1.15:brightness=-0.06:saturation=0.85,colorbalance=bs=0.1:bm=0.04:bh=0.02",
  cool: "colorbalance=bs=0.08:bm=0.03:rs=-0.04",
  warm: "colorbalance=rs=0.1:gs=0.03:bs=-0.08",
  bleach: "eq=saturation=0.35:contrast=1.25",
  mono: "hue=s=0",
  danger: "eq=contrast=1.2:saturation=1.15,colorbalance=rs=0.18:gs=-0.05:bs=-0.08",
};

const LIMIT = (10 ** (-1 / 20)).toFixed(6); // -1 dBFS

/** @param {number} n */
export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** @param {number} n */
function num(n) {
  return String(round3(n));
}

/** @param {{ out?: { type?: string, dur?: number } }} beat */
export function transitionOf(beat) {
  const out = beat?.out ?? { type: "cut" };
  const type = out.type ?? "cut";
  return { type, dur: type === "cut" ? 0 : Number(out.dur) || 0 };
}

/** @param {{ picture?: { src?: string, id?: string, shot?: string, path?: string } }} beat */
export function pictureLabel(beat) {
  const p = beat.picture ?? {};
  if (p.src === "black") return "black";
  if (p.src === "cine") return `cine:${p.id}`;
  if (p.src === "capture") return `capture:${p.shot}`;
  if (p.src === "title") return `title:${p.id}`;
  if (p.src === "image") return `image:${p.path}`;
  return String(p.src ?? "?");
}

/**
 * Nominal starts, tails and the xfade/concat joins.
 * An xfade's offset equals the incoming beat's nominal start.
 * @param {object[]} beats
 */
export function timelineOf(beats) {
  let start = 0;
  const rows = beats.map((beat) => {
    const tr = transitionOf(beat);
    const row = {
      id: beat.id,
      start: round3(start),
      dur: beat.dur,
      tail: tr.dur,
      length: round3(beat.dur + tr.dur),
      out: tr.type,
      picture: pictureLabel(beat),
    };
    start += beat.dur;
    return row;
  });
  const joins = [];
  let acc = rows.length ? rows[0].length : 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const tail = rows[i].tail;
    if (tail === 0) {
      joins.push({ op: "concat", from: rows[i].id, to: rows[i + 1].id });
      acc = round3(acc + rows[i + 1].length);
    } else {
      joins.push({
        op: "xfade",
        from: rows[i].id,
        to: rows[i + 1].id,
        transition: rows[i].out,
        xfade: XFADE[rows[i].out],
        dur: tail,
        offset: round3(acc - tail),
      });
      acc = round3(acc + rows[i + 1].length - tail);
    }
  }
  const lastTail = rows.length ? rows[rows.length - 1].tail : 0;
  return { beats: rows, joins, duration: round3(start + lastTail), assembled: round3(acc) };
}

/**
 * Filter graph for one beat intermediate.
 * @param {object} beat
 * @param {{
 *   fps?: number, width?: number, height?: number, file?: string,
 *   sourceDuration?: number, cropBox?: { x: number, y: number, w: number, h: number } | null,
 *   overlays?: Array<{ file: string, at: number }>,
 * }} [env]
 */
export function beatGraph(beat, env = {}) {
  const fps = env.fps ?? 30;
  const w = env.width ?? 1920;
  const h = env.height ?? 1080;
  const picture = beat.picture ?? { src: "black" };
  const length = round3(beat.dur + transitionOf(beat).dur);
  const playFor = beat.freeze ? beat.freeze.at : length;
  const speed = picture.speed ?? 1;
  const inputs = [];
  const parts = [];
  let inputCount = 0;
  const addInput = (argv) => {
    const index = inputCount++;
    inputs.push(argv);
    return index;
  };

  let label = "src";
  if (picture.src === "black") {
    parts.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${num(playFor)}[src]`);
  } else {
    if (!env.file) throw new Error(`beat ${beat.id}: no file for ${picture.src}`);
    const index =
      picture.src === "image"
        ? addInput(["-loop", "1", "-framerate", String(fps), "-i", env.file])
        : addInput(["-i", env.file]);
    const filters = [];
    if (picture.src === "cine" || picture.src === "capture") {
      const inn = picture.in ?? 0;
      const available =
        env.sourceDuration != null ? Math.max(0, env.sourceDuration - inn) : playFor * speed;
      const take = Math.max(1 / fps, Math.min(playFor * speed, available));
      filters.push(`trim=start=${num(inn)}:duration=${num(take)}`);
      filters.push(speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${num(speed)}`);
    } else {
      filters.push(`trim=duration=${num(playFor)}`, "setpts=PTS-STARTPTS");
    }
    filters.push(`fps=${fps}`);
    const box = resolveCrop(picture, env);
    if (box) filters.push(`crop=${Math.round(box.w)}:${Math.round(box.h)}:${Math.round(box.x)}:${Math.round(box.y)}`);
    filters.push(...coverOrPush(picture, w, h, beat.dur));
    parts.push(`[${index}:v]${filters.join(",")}[src]`);
  }

  // Hold the last frame and cut to the exact length, whatever the source gave: a beat that comes
  // out short would shift every later xfade offset (a freeze holds its frame the same way).
  parts.push(
    `[${label}]tpad=stop_mode=clone:stop_duration=${num(length)},trim=duration=${num(length)},setpts=PTS-STARTPTS[held]`,
  );
  label = "held";
  if (beat.freeze?.punch) {
    parts.push(`[${label}]${punch(beat.freeze.at, beat.freeze.punch, fps, w, h)}[punched]`);
    label = "punched";
  }
  const look = lookOf(beat, w, h, fps);
  if (look) {
    parts.push(`[${label}]${look}[look]`);
    label = "look";
  }
  (env.overlays ?? []).forEach((overlay, i) => {
    const index = addInput(["-i", overlay.file]);
    parts.push(`[${index}:v]setpts=PTS+${num(overlay.at)}/TB,fps=${fps},format=rgba[ov${i}]`);
    parts.push(`[${label}][ov${i}]overlay=0:0:eof_action=pass:format=auto[ovd${i}]`);
    label = `ovd${i}`;
  });
  if (beat.letterbox) {
    const bars = letterbox(beat.letterbox, w, h);
    if (bars) {
      parts.push(`[${label}]${bars}[box]`);
      label = "box";
    }
  }
  parts.push(`[${label}]format=yuv420p,setsar=1[vout]`);
  return { inputs, filter: parts.join(";"), duration: length, fps };
}

/**
 * argv for one silent H.264 intermediate.
 * @param {object} beat
 * @param {object} env
 * @param {string} outFile
 */
export function beatCommand(beat, env, outFile) {
  const graph = beatGraph(beat, env);
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...graph.inputs.flat(),
    "-filter_complex",
    graph.filter,
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(graph.fps),
    "-t",
    num(graph.duration),
    outFile,
  ];
  return { args, filter: graph.filter, inputs: graph.inputs, duration: graph.duration };
}

/** @param {object[]} beats @param {number} [fps] */
export function joinFilter(beats, fps = 30) {
  const plan = timelineOf(beats);
  if (!beats.length) throw new Error("no beats to join");
  const parts = beats.map(
    (_, i) => `[${i}:v]fps=${fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[b${i}]`,
  );
  if (beats.length === 1) {
    parts.push("[b0]format=yuv420p[vout]");
    return { filter: parts.join(";"), duration: plan.duration, plan };
  }
  let current = "b0";
  plan.joins.forEach((join, k) => {
    const input = `b${k + 1}`;
    const out = k === plan.joins.length - 1 ? "vout" : `j${k}`;
    if (join.op === "concat") parts.push(`[${current}][${input}]concat=n=2:v=1:a=0[${out}]`);
    else {
      parts.push(
        `[${current}][${input}]xfade=transition=${join.xfade}:duration=${num(join.dur)}:offset=${num(join.offset)}[${out}]`,
      );
    }
    current = out;
  });
  return { filter: parts.join(";"), duration: plan.duration, plan };
}

/** @param {object[]} beats @param {string[]} files @param {string} outFile @param {number} [fps] */
export function joinCommand(beats, files, outFile, fps = 30) {
  const joined = joinFilter(beats, fps);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const file of files) args.push("-i", file);
  args.push(
    "-filter_complex",
    joined.filter,
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-t",
    num(joined.duration),
    outFile,
  );
  return { args, ...joined };
}

/**
 * Sidechain settings so a voice sitting about 18 dB over the threshold dips the music by
 * about `duckDb`.
 * @param {number} duckDb
 */
export function duckFilter(duckDb) {
  const dip = Math.min(17, Math.abs(duckDb));
  const ratio = 1 / Math.max(0.05, 1 - dip / 18);
  return `sidechaincompress=threshold=0.015:ratio=${ratio.toFixed(3)}:attack=20:release=350:makeup=1`;
}

/**
 * The 48 kHz stereo mix: voice, effects, music ducked under the voice, then a limiter.
 * Input order is every voice-over, then every effect, then every music file.
 * @param {{
 *   videoDuration: number,
 *   voiceFx?: string,
 *   vo?: Array<{ start: number }>,
 *   sfx?: Array<{ start: number, gainDb: number }>,
 *   music?: Array<{ at: number, from: number, until: number, gainDb: number, fadeIn: number, fadeOut: number, duckDb: number }>,
 * }} plan
 */
export function mixGraph(plan) {
  const vo = plan.vo ?? [];
  const sfx = plan.sfx ?? [];
  const music = plan.music ?? [];
  const parts = [];
  const voLabels = vo.map((clip, i) => {
    const chain = [
      plan.voiceFx === "trailer" ? trailerVoiceFilters() : "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `adelay=${ms(clip.start)}|${ms(clip.start)}`,
    ];
    parts.push(`[${i}:a]${chain.join(",")}[vo${i}]`);
    return `vo${i}`;
  });
  let voBus = null;
  if (voLabels.length === 1) voBus = voLabels[0];
  else if (voLabels.length > 1) {
    parts.push(`${voLabels.map((label) => `[${label}]`).join("")}amix=inputs=${voLabels.length}:normalize=0:duration=longest[vobus]`);
    voBus = "vobus";
  }
  const sfxLabels = sfx.map((clip, i) => {
    const index = vo.length + i;
    parts.push(
      `[${index}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${num(clip.gainDb)}dB,adelay=${ms(clip.start)}|${ms(clip.start)}[sfx${i}]`,
    );
    return `sfx${i}`;
  });
  if (music.length && voBus) {
    const splits = music.map((_, i) => `[vosc${i}]`).join("");
    parts.push(`[${voBus}]asplit=${music.length + 1}[vomix]${splits}`);
    voBus = "vomix";
  }
  const musicLabels = music.map((clip, i) => {
    const index = vo.length + sfx.length + i;
    const play = Math.max(0, clip.until - clip.at);
    const fadeOut = Math.min(clip.fadeOut ?? 0, play);
    const chain = [
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `atrim=start=${num(clip.from)}:duration=${num(play)}`,
      "asetpts=PTS-STARTPTS",
      `afade=t=in:st=0:d=${num(clip.fadeIn ?? 0)}`,
      `afade=t=out:st=${num(Math.max(0, play - fadeOut))}:d=${num(fadeOut)}`,
      `volume=${num(clip.gainDb)}dB`,
      `adelay=${ms(clip.at)}|${ms(clip.at)}`,
    ];
    parts.push(`[${index}:a]${chain.join(",")}[mus${i}]`);
    if (voBus) {
      parts.push(`[mus${i}][vosc${i}]${duckFilter(clip.duckDb ?? 0)}[musd${i}]`);
      return `musd${i}`;
    }
    return `mus${i}`;
  });
  const mixers = [voBus, ...sfxLabels, ...musicLabels].filter(Boolean);
  const tail = `alimiter=limit=${LIMIT}:level=0,apad=whole_dur=${num(plan.videoDuration)},atrim=duration=${num(plan.videoDuration)}[mix]`;
  if (mixers.length === 0) parts.push(`anullsrc=channel_layout=stereo:sample_rate=48000,${tail}`);
  else if (mixers.length === 1) parts.push(`[${mixers[0]}]${tail}`);
  else parts.push(`${mixers.map((label) => `[${label}]`).join("")}amix=inputs=${mixers.length}:normalize=0:duration=longest,${tail}`);
  return { filter: parts.join(";"), inputs: vo.length + sfx.length + music.length };
}

/** @param {{ lufs: number, true_peak: number }} output @param {object | null} [measured] */
export function loudnormFilter(output, measured = null) {
  const base = `loudnorm=I=${output.lufs}:TP=${output.true_peak}:LRA=11`;
  if (!measured) return `${base}:print_format=json`;
  // loudnorm's linear pass cannot hold the true peak on its own; a limiter at the target (sample
  // peaks) keeps the final AAC, which overshoots a little, near it.
  const ceiling = Math.pow(10, output.true_peak / 20).toFixed(4);
  return (
    `${base}:measured_I=${measured.input_i}:measured_LRA=${measured.input_lra}` +
    `:measured_TP=${measured.input_tp}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true` +
    `,aresample=48000,alimiter=limit=${ceiling}:attack=1:release=60:level=false`
  );
}

/** @param {string} video @param {string} audio @param {string} out @param {{ width: number, height: number, fps: number }} size */
/** `audioCodec`: "aac_at" (Apple's AudioToolbox encoder, where ffmpeg has it) keeps the limited peaks;
 * ffmpeg's own "aac" overshoots them by up to 3 dB. */
export function muxArgs(video, audio, out, { width, height, fps, audioCodec = "aac" }) {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    video,
    "-i",
    audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-crf",
    "18",
    "-preset",
    "slow",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    audioCodec,
    "-b:a",
    "320k",
    "-ar",
    "48000",
    "-r",
    String(fps),
    "-s",
    `${width}x${height}`,
    "-shortest",
    out,
  ];
}

/** @param {string} file */
export function measureArgs(file) {
  return ["-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"];
}

/**
 * The contact sheet as HTML (screenshotted by Playwright): one tile per beat, four columns, each
 * with the beat id, its start, its picture and what is said over it. HTML rather than ffmpeg's
 * drawtext, which many ffmpeg builds (Homebrew's among them) leave out.
 * @param {Array<{ id: string, start: string, picture: string, image: string, vo?: string }>} tiles
 * @param {{ title: string, cols?: number }} opts
 */
export function contactSheetHtml(tiles, { title, cols = 4 }) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cells = tiles
    .map(
      (t) => `<figure><img src="${esc(t.image)}"><figcaption><b>${esc(t.id)}</b> <span>${esc(t.start)}</span>
<i>${esc(t.picture)}</i>${t.vo ? `<q>${esc(t.vo)}</q>` : ""}</figcaption></figure>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body { margin: 0; padding: 24px; background: #080e0b; color: #efede5; font: 15px/1.35 -apple-system, "Helvetica Neue", Arial, sans-serif; width: 1872px; }
h1 { font-size: 22px; margin: 0 0 16px; }
main { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 16px; }
figure { margin: 0; background: #111a16; border-radius: 8px; overflow: hidden; }
img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
figcaption { padding: 8px 10px 10px; }
b { color: #f6d566; } span { color: #95a7ba; } i { display: block; color: #95a7ba; font-style: normal; }
q { display: block; margin-top: 4px; font-style: italic; }
</style>
<h1>${esc(title)}</h1>
<main>
${cells}
</main>`;
}

/** @param {object} picture @param {{ cropBox?: { x: number, y: number, w: number, h: number } | null }} env */
function resolveCrop(picture, env) {
  if (Array.isArray(picture.crop)) {
    const [x, y, w, h] = picture.crop;
    return { x, y, w, h };
  }
  if (typeof picture.crop === "string") return env.cropBox ?? null;
  return null;
}

/** @param {object} picture @param {number} w @param {number} h @param {number} beatDur */
function coverOrPush(picture, w, h, beatDur) {
  if (!picture.push) {
    return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`];
  }
  const [z0, z1] = picture.push;
  const W = w * 2;
  const H = h * 2;
  const z = `${z0}+(${z1}-${z0})*min(1,t/${num(beatDur)})`;
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    `scale=w='trunc(${W}*(${z})/2)*2':h='trunc(${H}*(${z})/2)*2':eval=frame`,
    `crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})/2`,
    `scale=${w}:${h}`,
  ];
}


/** @param {number} at @param {number} punch @param {number} fps @param {number} w @param {number} h */
function punch(at, punch, fps, w, h) {
  const n0 = Math.round(at * fps);
  const z = `1+(${punch}-1)*sin(PI*min(1,max(0,(n-${n0})/4)))`;
  const W = w * 2;
  const H = h * 2;
  return [
    `scale=${W}:${H}`,
    `scale=w='trunc(${W}*(${z})/2)*2':h='trunc(${H}*(${z})/2)*2':eval=frame`,
    `crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})/2`,
    `scale=${w}:${h}`,
  ].join(",");
}

/** @param {object} beat @param {number} w @param {number} h @param {number} fps */
function lookOf(beat, w, h, fps) {
  const parts = [];
  const grade = GRADE[beat.grade ?? "none"] ?? "";
  if (grade) parts.push(grade);
  for (const name of beat.fx ?? []) {
    const filter = fxFilter(name, w, h, fps);
    if (filter) parts.push(filter);
  }
  return parts.join(",");
}

/** @param {string} name @param {number} w @param {number} h @param {number} fps */
function fxFilter(name, w, h, fps) {
  if (name === "grain") return "noise=alls=8:allf=t+u";
  if (name === "vignette") return "vignette=PI/5";
  if (name === "chroma") return "format=rgba,rgbashift=rh=4:bh=-4:rv=-4:bv=4";
  if (name === "rewind") {
    return "format=rgba,rgbashift=rh=8:bh=-8,boxblur=8:1,noise=alls=10:allf=t,drawgrid=width=iw:height=6:thickness=1:color=black@0.2";
  }
  if (name === "shake") {
    const W = Math.round(w * 1.04);
    const H = Math.round(h * 1.04);
    return `scale=${W}:${H},crop=${w}:${h}:x='(in_w-${w})/2+8*sin(n*0.7)':y='(in_h-${h})/2+6*sin(n*1.1)'`;
  }
  if (name === "flash-in") return `fade=t=in:st=0:d=${num(4 / fps)}:c=white`;
  return "";
}

/** @param {number} aspect @param {number} w @param {number} h */
function letterbox(aspect, w, h) {
  const contentH = Math.round(w / aspect);
  const bar = Math.floor((h - contentH) / 2);
  if (!(bar > 0)) return "";
  return `drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`;
}

/** @param {number} seconds */
function ms(seconds) {
  return String(Math.round(seconds * 1000));
}
