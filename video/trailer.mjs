// Trailer edit (SPEC 10). One command turns trailer.json into the < 2:00 film: assets, captured
// shots, cine clips, title cards, voice-over, synthesized effects, then the ffmpeg edit.
// Each step is cached on a hash of its inputs (`<file>.hash`) and skipped when nothing changed.
//
// `renderCine` and `renderTitle` live in modules another part of the work owns. They are
// imported inside the steps that call them, so `--check` never loads a browser.
//
//   node video/trailer.mjs --check          validate and print the timeline
//   npm run trailer                         build (from video/)
//   node video/trailer.mjs --step edit --only b03

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { assetFileName, copyLocalAsset, downloadAsset, validateAssets } from "./lib/assets.mjs";
import { digest, isCached, storeHash } from "./lib/cache.mjs";
import { burnArgs, captionSides, captionTimeline } from "./lib/captions.mjs";
import { claimTable, resolveTitle, resolveVo } from "./lib/claims.mjs";
import {
  beatCommand,
  contactSheetHtml,
  joinCommand,
  joinFilter,
  loudnormFilter,
  measureArgs,
  mixGraph,
  muxArgs,
  timelineOf,
} from "./lib/edit.mjs";
import { parseDuration, parseEbur128, parseLoudnorm, runFfmpeg, runProcess } from "./lib/ffmpeg.mjs";
import { renderReport } from "./lib/report.mjs";
import { SFX_DEFAULT_DUR, conflictingSfx, writeSfx } from "./lib/sfx.mjs";
import { storyBeats, validateTrailer } from "./lib/spec.mjs";
import { buildSsml, estimateSpeechSeconds, voiceFor, voRoomWarnings, wavSeconds } from "./lib/vo.mjs";
import { encodeWav16Mono, readWav, trimSilence } from "./lib/wav.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
/** The edit's own code: a change to it re-renders what it built (caches key on it). */
const ENGINE = digest(
  ["trailer.mjs", "lib/edit.mjs", "lib/sfx.mjs", "lib/vo.mjs", "lib/report.mjs", "lib/captions.mjs"].map((f) =>
    readFileSync(path.join(HERE, f), "utf8"),
  ),
);

const STEPS = ["assets", "capture", "cine", "pin", "titles", "vo", "sfx", "edit", "sheet", "report"];

const USAGE = `Usage: node video/trailer.mjs [options]

  --check              validate the spec and print the timeline (no browser, network or ffmpeg)
  --list               print the timeline only
  --spec <path>        trailer.json to build (default: video/trailer.json)
  --step <names>       run only these steps, comma-separated
  --force              ignore caches
  --only <ids>         edit: re-render these beats (ids or prefixes); reuse the others
  --story <name>       blender (default) or app: which telling of the story to cut
  --base-url <url>     site passed to cine and to the capture kit
  --out <dir>          work directory (default: out/video/trailer)
  --headed             show the browser for cine and titles
  --ffmpeg <path>      ffmpeg with libx264 (default: ffmpeg on PATH)
  --no-vo              silent voice-over of the planned lengths; do not call Azure
  -h, --help           this text

The finished film is out/video/trailer.mp4, with trailer_contact.jpg and trailer_report.md
beside it. Work files (clips, voice, mix) go under --out.`;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);


async function main() {
  let args;
  try {
    ({ values: args } = parseArgs({
      args: process.argv.slice(2),
      options: {
        check: { type: "boolean", default: false },
        list: { type: "boolean", default: false },
        spec: { type: "string" },
        step: { type: "string" },
        force: { type: "boolean", default: false },
        only: { type: "string" },
        "base-url": { type: "string" },
        story: { type: "string" },
        out: { type: "string" },
        headed: { type: "boolean", default: false },
        ffmpeg: { type: "string", default: "ffmpeg" },
        "no-vo": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const specPath = path.resolve(args.spec ?? path.join(HERE, "trailer.json"));
  const spec = readJson(specPath);
  if (args.story && !["blender", "app"].includes(args.story)) throw new Error(`--story must be blender or app`);
  spec.beats = storyBeats(spec, args.story); // one telling of the story; the other's beats drop out
  const shots = readJson(path.join(HERE, "shots.json"));
  const assets = readJson(path.join(HERE, "assets.json"));
  const credits = readFileSync(path.join(HERE, "CREDITS.md"), "utf8");
  const checked = validateTrailer(spec, {
    root: ROOT,
    shotIds: new Set((shots.shots ?? []).map((shot) => shot.id)),
    assets,
    harvest: shots.harvest ?? [],
  });
  const errors = [...validateAssets(assets, credits).errors, ...checked.errors];
  if (errors.length) {
    console.error(`${path.relative(ROOT, specPath)}:`);
    for (const error of errors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  if (args.list || args.check) {
    printTimeline(spec);
    if (args.check && checked.warnings.length) {
      console.log("warnings:");
      for (const warning of checked.warnings) console.log(`  ${warning}`);
    }
    return;
  }

  const steps = selectSteps(args.step);
  const ctx = {
    spec,
    assets,
    shots,
    root: ROOT,
    outDir: path.resolve(args.out ?? path.join(ROOT, "out", "video", "trailer")),
    finalsDir: path.join(ROOT, "out", "video"),
    force: args.force,
    only: args.only?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    baseUrl: args["base-url"] ?? spec.site,
    headed: args.headed,
    ffmpeg: args.ffmpeg,
    noVo: args["no-vo"],
    warnings: checked.warnings,
  };
  mkdirSync(ctx.outDir, { recursive: true });
  mkdirSync(ctx.finalsDir, { recursive: true });
  for (const step of steps) {
    const t0 = Date.now();
    console.log(`▸ ${step}`);
    await STEP[step](ctx);
    console.log(`  ${step} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}

const STEP = {
  assets: stepAssets,
  capture: stepCapture,
  cine: stepCine,
  pin: stepPin,
  titles: stepTitles,
  vo: stepVo,
  sfx: stepSfx,
  edit: stepEdit,
  sheet: stepSheet,
  report: stepReport,
};

/** Download every asset, check its sha256, and keep the file only when the hash matches. */
async function stepAssets(ctx) {
  const dir = path.join(ctx.outDir, "assets");
  mkdirSync(dir, { recursive: true });
  if (!ctx.assets.length) {
    console.log("  no assets");
    return;
  }
  for (const asset of ctx.assets) {
    const dest = path.join(dir, assetFileName(asset));
    const source = asset.local ? path.resolve(ctx.root, asset.local) : null;
    const hash = digest(["asset-v1", asset, source ? fileStamp(source) : null]);
    if (fresh(dest, hash, ctx.force)) {
      console.log(`  ${asset.id}: cached`);
      continue;
    }
    if (source) {
      console.log(`  ${asset.id}: copy ${asset.local}`);
      copyLocalAsset(asset, ctx.root, dest);
    } else {
      console.log(`  ${asset.id}: download`);
      await downloadAsset(asset, dest);
    }
    storeHash(dest, hash);
  }
}

/**
 * Corner-pin a picture onto a screen in a rendered clip (video/pin.py): the coach's tablet shows
 * a cine shot, mapped so its last frame matches that shot full frame. Output: <out>/pins/<id>.mp4.
 */
async function stepPin(ctx) {
  const pins = ctx.spec.pins ?? [];
  if (!pins.length) {
    console.log("  no pins");
    return;
  }
  const dir = path.join(ctx.outDir, "pins");
  mkdirSync(dir, { recursive: true });
  for (const pin of pins) {
    const out = path.join(dir, `${pin.id}.mp4`);
    const clip = path.resolve(ctx.root, pin.clip);
    const corners = path.resolve(ctx.root, pin.corners);
    const matte = path.resolve(ctx.root, pin.matte);
    const source = path.join(ctx.outDir, "cine", `${pin.source.cine}.mp4`);
    for (const f of [clip, corners, matte, source]) {
      if (!existsSync(f)) throw new Error(`pin ${pin.id}: missing ${path.relative(ctx.root, f)}`);
    }
    const mattes = readdirSync(matte).filter((f) => f.endsWith(".png")).sort();
    const hash = digest(["pin-v2", pin, fileStamp(clip), fileStamp(corners), fileStamp(source), mattes.length,
      fileStamp(path.join(matte, mattes[mattes.length - 1] ?? "")), fileStamp(path.join(HERE, "pin.py"))]);
    if (fresh(out, hash, ctx.force)) {
      console.log(`  ${pin.id}: cached`);
      continue;
    }
    const extra = [];
    if (pin.source_time) extra.push("--source-time", String(pin.source_time));
    if (pin.ev) extra.push("--ev", String(pin.ev));
    if (pin.ev_ramp_frames) extra.push("--ev-ramp-frames", String(pin.ev_ramp_frames));
    if (pin.ref_corners) extra.push("--ref-corners", path.resolve(ctx.root, pin.ref_corners));
    await runProcess("uv", ["run", "--no-sync", "python", "video/pin.py", "--clip", clip, "--corners", corners,
      "--matte", matte, "--source", source, "--source-offset-y", String(pin.source_offset_y ?? 0), ...extra, "--out", out],
      { cwd: ctx.root, inherit: true });
    storeHash(out, hash);
  }
}

async function stepCapture(ctx) {
  const shots = [
    ...new Set(ctx.spec.beats.filter((b) => b.picture?.src === "capture").map((b) => b.picture.shot)),
  ];
  const captureDir = path.join(ctx.root, "out", "video");
  const webm = (id) => path.join(captureDir, `${id}.webm`);
  const claims = path.join(captureDir, "claims.json");
  const missing = shots.filter((id) => !existsSync(webm(id)));
  if (!ctx.force && missing.length === 0 && existsSync(claims)) {
    console.log("  shots and claims.json are in place");
    return;
  }
  let only = ctx.force ? shots : missing;
  if (!only.length) only = shots.length ? [shots[0]] : [fallbackShot(ctx)];
  const args = [path.join(HERE, "capture.mjs"), "--only", only.join(","), "--out", captureDir];
  if (ctx.baseUrl) args.push("--base-url", ctx.baseUrl);
  console.log(`  capture ${only.join(", ")}`);
  await runProcess(process.execPath, args, { cwd: ctx.root, inherit: true });
  if (!existsSync(claims)) throw new Error("capture did not write out/video/claims.json");
}

async function stepCine(ctx) {
  const ids = [
    ...new Set(ctx.spec.beats.filter((b) => b.picture?.src === "cine").map((b) => b.picture.id)),
  ];
  if (!ids.length) {
    console.log("  no cine shots");
    return;
  }
  const pending = [];
  for (const id of ids) {
    const outFile = path.join(ctx.outDir, "cine", `${id}.mp4`);
    const hash = digest(["cine-v1", ctx.spec.cine[id], ctx.baseUrl, ctx.spec.output]);
    if (fresh(outFile, hash, ctx.force)) console.log(`  ${id}: cached`);
    else pending.push({ id, outFile, hash });
  }
  if (!pending.length) return;
  const { renderCine } = await loadModule("./lib/cine.mjs", "renderCine");
  await withBrowser(ctx, async (browser) => {
    for (const job of pending) {
      mkdirSync(path.dirname(job.outFile), { recursive: true });
      const result = await renderCine({
        browser,
        baseUrl: ctx.baseUrl,
        id: job.id,
        cine: ctx.spec.cine[job.id],
        fps: ctx.spec.output.fps,
        width: ctx.spec.output.width,
        height: ctx.spec.output.height,
        outFile: job.outFile,
        ffmpeg: ctx.ffmpeg,
        log: (message) => console.log(`  ${message}`),
      });
      storeHash(job.outFile, job.hash);
      console.log(`  ${job.id}: ${result.frames} frames, ${result.duration}s`);
    }
  });
}

async function stepTitles(ctx) {
  const { table } = loadClaims(ctx);
  const titles = resolveUsedTitles(ctx.spec, table);
  const pending = [];
  for (const title of titles.values()) {
    if (title.drop) {
      console.log(`  ${title.id}: dropped (${title.warning})`);
      continue;
    }
    const outFile = titlePath(ctx, title);
    // The page that draws it is part of the key: a change to the template, its CSS or JS re-renders.
    const page = ["titles.css", "titles.js", `${title.render.template}.html`].map((f) =>
      fileStamp(path.join(HERE, "titles", f)),
    );
    const hash = digest(["title-v2", title.render, ctx.spec.output, ...page]);
    if (fresh(outFile, hash, ctx.force)) console.log(`  ${title.id}: cached`);
    else pending.push({ title, outFile, hash });
  }
  if (!pending.length) return;
  const { renderTitle } = await loadModule("./lib/titles.mjs", "renderTitle");
  await withBrowser(ctx, async (browser) => {
    for (const job of pending) {
      mkdirSync(path.dirname(job.outFile), { recursive: true });
      const result = await renderTitle({
        browser,
        id: job.title.id,
        title: job.title.render,
        fps: ctx.spec.output.fps,
        width: ctx.spec.output.width,
        height: ctx.spec.output.height,
        outFile: job.outFile,
        ffmpeg: ctx.ffmpeg,
        log: (message) => console.log(`  ${message}`),
      });
      storeHash(job.outFile, job.hash);
      console.log(`  ${job.title.id}: ${result.alpha ? "with alpha" : "opaque"}, ${result.duration}s`);
    }
  });
}

async function stepVo(ctx) {
  const dir = path.join(ctx.outDir, "vo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "MODE"), ctx.noVo ? "silent\n" : "azure\n");
  const { table, doc } = loadClaims(ctx);
  const lines = resolveLines(ctx.spec, table, doc);
  /** @type {Array<{ id: string, ssml: string, out: string, ssmlPath: string }>} */
  const jobs = [];
  for (const line of lines) {
    if (line.drop) {
      console.log(`  ${line.id}: dropped`);
      continue;
    }
    const voice = voiceFor(ctx.spec, line.lang, line.speaker);
    const ssml = buildSsml({ text: line.text, voice, style: line.style, degree: line.degree });
    const out = path.join(dir, `${line.id}.wav`);
    const ssmlPath = path.join(dir, `${line.id}.ssml`);
    const prev = existsSync(ssmlPath) ? readFileSync(ssmlPath, "utf8") : "";
    if (!ctx.force && prev === ssml && existsSync(out)) {
      console.log(`  ${line.id}: unchanged`);
      continue;
    }
    if (ctx.noVo) {
      const seconds = Math.max(0.05, estimateSpeechSeconds(line.text));
      const n = Math.max(1, Math.round(seconds * 24000));
      writeFileSync(out, encodeWav16Mono(new Float64Array(n), 24000));
      writeFileSync(ssmlPath, ssml);
      console.log(`  ${line.id}: silent ${seconds.toFixed(2)}s`);
      continue;
    }
    jobs.push({ id: line.id, ssml, out: path.resolve(out), ssmlPath });
  }
  if (jobs.length) await synthesize(ctx, dir, jobs);
  // Azure pads each line with silence (about 0.15 s before, 0.9 s after): cut it, so timing,
  // warnings and the ducking follow the speech. Idempotent, so every run trims every line.
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".wav"))) {
    const wavPath = path.join(dir, file);
    const wav = readWav(readFileSync(wavPath));
    const [speech] = trimSilence(wav);
    if (speech.length && speech.length < wav.frames) writeFileSync(wavPath, encodeWav16Mono(speech, wav.sampleRate));
  }
}

async function synthesize(ctx, dir, jobs) {
  const jobsPath = path.join(dir, "jobs.json");
  writeFileSync(jobsPath, JSON.stringify(jobs.map(({ id, ssml, out }) => ({ id, ssml, out }))));
  try {
    const uv = ["run"];
    if (existsSync(path.join(ctx.root, ".env"))) uv.push("--env-file", ".env");
    uv.push("python", "video/tts.py", jobsPath);
    console.log(`  synthesize ${jobs.map((job) => job.id).join(", ")}`);
    await runProcess("uv", uv, { cwd: ctx.root, inherit: true });
    for (const job of jobs) {
      if (!existsSync(job.out)) throw new Error(`tts did not write ${job.out}`);
      writeFileSync(job.ssmlPath, job.ssml);
    }
  } finally {
    rmSync(jobsPath, { force: true });
  }
}

async function stepSfx(ctx) {
  const dir = path.join(ctx.outDir, "sfx");
  mkdirSync(dir, { recursive: true });
  const conflict = conflictingSfx(ctx.spec.beats);
  if (conflict) throw new Error(conflict);
  const wanted = new Map();
  for (const beat of ctx.spec.beats) {
    for (const effect of beat.sfx ?? []) {
      wanted.set(effect.name, effect.dur ?? SFX_DEFAULT_DUR[effect.name]);
    }
  }
  if (!wanted.size) {
    console.log("  no sound effects");
    return;
  }
  for (const [name, dur] of wanted) {
    const file = path.join(dir, `${name}.wav`);
    const hash = digest(["sfx-v1", name, dur]);
    if (fresh(file, hash, ctx.force)) {
      console.log(`  ${name}: cached`);
      continue;
    }
    writeSfx(name, dur, file);
    storeHash(file, hash);
    console.log(`  ${name}: ${dur}s`);
  }
}

async function stepEdit(ctx) {
  const { width, height, fps } = ctx.spec.output;
  const manifest = readJsonIf(path.join(ctx.finalsDir, "manifest.json"));
  const titles = titlesWithFiles(ctx, loadClaims(ctx).table);
  const beatDir = path.join(ctx.outDir, "beats");
  mkdirSync(beatDir, { recursive: true });
  const beatFiles = [];
  for (const beat of ctx.spec.beats) {
    const outFile = path.join(beatDir, `${beat.id}.mp4`);
    beatFiles.push(outFile);
    const reuse = ctx.only && !ctx.only.some((prefix) => beat.id === prefix || beat.id.startsWith(prefix));
    if (reuse && existsSync(outFile)) {
      console.log(`  ${beat.id}: reused`);
      continue;
    }
    const built = await beatEnv(ctx, beat, titles, manifest);
    const hash = digest([
      "beat-v1",
      ENGINE,
      beat,
      built.picture,
      built.env.overlays,
      built.env.cropBox ?? null,
      built.env.sourceDuration ?? null,
      fileStamp(built.env.file),
      ...(built.env.files ?? []).map(fileStamp),
      ...(built.env.overlays ?? []).map((overlay) => fileStamp(overlay.file)), // a re-rendered title re-renders its beats
      ctx.spec.output,
    ]);
    if (!reuse && fresh(outFile, hash, ctx.force)) {
      console.log(`  ${beat.id}: cached`);
      continue;
    }
    const command = beatCommand({ ...beat, picture: built.picture }, { ...built.env, fps, width, height }, outFile);
    await runFfmpeg(ctx.ffmpeg, command.args);
    storeHash(outFile, hash);
    console.log(`  ${beat.id}: ${command.duration}s`);
  }

  const timeline = timelineOf(ctx.spec.beats);
  const joined = path.join(ctx.outDir, "joined.mp4");
  const joinHash = digest(["join-v1", ENGINE, joinFilter(ctx.spec.beats, fps).filter, ...beatFiles.map(fileStamp)]);
  if (fresh(joined, joinHash, ctx.force)) console.log("  join: cached");
  else {
    const command = joinCommand(ctx.spec.beats, beatFiles, joined, fps);
    await runFfmpeg(ctx.ffmpeg, command.args);
    storeHash(joined, joinHash);
    console.log(`  join: ${command.duration}s`);
  }

  const mix = await mixPlan(ctx, timeline);
  const premix = path.join(ctx.outDir, "premix.wav");
  const mixWav = path.join(ctx.outDir, "mix.wav");
  const mixHash = digest([
    "mix-v1",
    ENGINE,
    mix.graph.filter,
    ctx.spec.output.lufs,
    ctx.spec.output.true_peak,
    ctx.spec.voice?.fx ?? "",
    ...mix.files.map(fileStamp),
  ]);
  if (fresh(mixWav, mixHash, ctx.force)) console.log("  mix: cached");
  else {
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    for (const file of mix.files) args.push("-i", file);
    args.push(
      "-filter_complex",
      mix.graph.filter,
      "-map",
      "[mix]",
      "-c:a",
      "pcm_s24le",
      "-ar",
      "48000",
      "-ac",
      "2",
      premix,
    );
    await runFfmpeg(ctx.ffmpeg, args);
    const measured = await runFfmpeg(ctx.ffmpeg, [
      "-hide_banner",
      "-i",
      premix,
      "-af",
      loudnormFilter(ctx.spec.output),
      "-f",
      "null",
      "-",
    ]);
    const loud = parseLoudnorm(measured.stderr);
    await runFfmpeg(ctx.ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      premix,
      "-af",
      loudnormFilter(ctx.spec.output, loud),
      "-c:a",
      "pcm_s24le",
      "-ar",
      "48000",
      "-ac",
      "2",
      mixWav,
    ]);
    storeHash(mixWav, mixHash);
    console.log("  mix: normalised");
  }

  // Captions over the joined film (they cross cuts, so they go on after the join).
  const picture = await burnCaptions(ctx, timeline, joined);

  const finalMp4 = path.join(ctx.finalsDir, "trailer.mp4");
  const muxHash = digest(["mux-v2", ENGINE, fileStamp(picture), fileStamp(mixWav), ctx.spec.output]);
  if (fresh(finalMp4, muxHash, ctx.force)) console.log("  mux: cached");
  else {
    const audioCodec = (await hasEncoder(ctx.ffmpeg, "aac_at")) ? "aac_at" : "aac";
    await runFfmpeg(ctx.ffmpeg, muxArgs(picture, mixWav, finalMp4, { width, height, fps, audioCodec }));
    storeHash(finalMp4, muxHash);
    console.log(`  mux: ${path.relative(ctx.root, finalMp4)}`);
  }
}

/**
 * Every voice-over line as a burned-in caption (spec `captions`, on unless `enabled: false`):
 * the `caption` card rendered per line, laid over the joined film. Lines in a language listed in
 * `skip_languages` (default zh: the app's own caption is on screen) get none.
 * @returns {Promise<string>} the picture to mux: the captioned film, or `joined` without captions
 */
async function burnCaptions(ctx, timeline, joined) {
  const opts = ctx.spec.captions ?? {};
  if (opts.enabled === false && !ctx.spec.watermark) return joined;
  const skip = new Set(opts.skip_languages ?? ["zh"]);
  const { table, doc } = loadClaims(ctx);
  const lines = resolveLines(ctx.spec, table, doc)
    .filter((line) => !line.drop && !skip.has(line.lang ?? "en"))
    .map((line) => {
      const wav = path.join(ctx.outDir, "vo", `${line.id}.wav`);
      return {
        id: line.id,
        start: line.beatStart + line.at,
        duration: existsSync(wav) ? wavSeconds(wav) : 2,
        text: String(line.text ?? "").replace(/\s*\[pause \d+\]\s*/g, " ").trim(),
      };
    });
  const cues = captionSides(
    captionTimeline(lines, { tail: opts.tail ?? 0.25, min: opts.min ?? 1.0, total: timeline.duration }),
    lowerLeftWindows(ctx.spec, timeline),
  );
  const dir = path.join(ctx.outDir, "captions");
  mkdirSync(dir, { recursive: true });
  const page = ["titles.css", "titles.js", "caption.html"].map((f) => fileStamp(path.join(HERE, "titles", f)));
  const { width, height, fps } = ctx.spec.output;
  const todo = [];
  for (const cue of cues) {
    cue.file = path.join(dir, `${cue.id}.mov`);
    cue.hash = digest(["caption-v2", cue.text, cue.dur, cue.side, ctx.spec.output, ...page]);
    if (!fresh(cue.file, cue.hash, ctx.force)) todo.push(cue);
  }
  if (todo.length) {
    const { renderTitle } = await import("./lib/titles.mjs");
    const { chromium } = await import("playwright");
    const launch = () => chromium.launch({ args: ["--hide-scrollbars"] });
    let browser = await launch();
    try {
      for (const cue of todo) {
        const params = { text: cue.text, dur: cue.dur, side: cue.side };
        const title = { template: "caption", dur: cue.dur, alpha: true, params };
        const job = { id: cue.id, title, fps, width, height, outFile: cue.file, ffmpeg: ctx.ffmpeg, log: () => {} };
        try {
          await renderTitle({ browser, ...job });
        } catch (err) {
          // On a loaded machine Chromium is sometimes killed mid-render: relaunch once and retry.
          if (!/closed|crash/i.test(String(err?.message))) throw err;
          await browser.close().catch(() => {});
          browser = await launch();
          await renderTitle({ browser, ...job });
        }
        storeHash(cue.file, cue.hash);
      }
    } finally {
      await browser.close();
    }
  }
  console.log(`  captions: ${cues.length} lines (${todo.length} rendered)`);
  const watermark = ctx.spec.watermark ? await watermarkStill(ctx, ctx.spec.watermark) : null;
  const out = path.join(ctx.outDir, "captioned.mp4");
  const hash = digest(["captioned-v2", ENGINE, fileStamp(joined), ...cues.map((c) => [c.start, fileStamp(c.file)]), watermark ? fileStamp(watermark) : null]);
  if (!fresh(out, hash, ctx.force)) {
    await runFfmpeg(ctx.ffmpeg, burnArgs(joined, cues, out, { fps, watermark, duration: timeline.duration }));
    storeHash(out, hash);
  }
  writeFileSync(path.join(ctx.outDir, "captions.json"), `${JSON.stringify(cues.map(({ file, hash, ...c }) => c), null, 2)}\n`);
  return out;
}

/**
 * When a title holds the lower left of the frame (a lower-left slam, a tag, the spec sheet), so
 * captions move right instead of covering it.
 * @param {object} spec
 * @param {{ beats: Array<{ id: string, start: number, dur: number }> }} timeline
 */
function lowerLeftWindows(spec, timeline) {
  const holds = (id) => {
    const t = spec.titles?.[id];
    return Boolean(t) && (t.template === "tag" || t.template === "spec" || t.params?.align === "lower-left");
  };
  const out = [];
  spec.beats.forEach((beat, i) => {
    const { start, dur } = timeline.beats[i];
    if (beat.picture?.src === "title" && holds(beat.picture.id)) out.push({ start, end: start + dur });
    for (const o of beat.overlays ?? []) {
      if (!holds(o.title)) continue;
      const end = Math.min(o.at + spec.titles[o.title].dur, dur);
      out.push({ start: start + o.at, end: start + end });
    }
  });
  return out;
}

/** A still of the watermark (the label template, top left) as a PNG with alpha. */
async function watermarkStill(ctx, text) {
  const dir = path.join(ctx.outDir, "captions");
  mkdirSync(dir, { recursive: true });
  const mov = path.join(dir, "watermark.mov");
  const png = path.join(dir, "watermark.png");
  const page = ["titles.css", "titles.js", "label.html"].map((f) => fileStamp(path.join(HERE, "titles", f)));
  const hash = digest(["watermark-v1", text, ctx.spec.output, ...page]);
  if (!fresh(png, hash, ctx.force)) {
    const { renderTitle } = await import("./lib/titles.mjs");
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--hide-scrollbars"] });
    try {
      const { width, height, fps } = ctx.spec.output;
      const title = { template: "label", dur: 0.2, alpha: true, params: { text, corner: "top-left" } };
      await renderTitle({ browser, id: "watermark", title, fps, width, height, outFile: mov, ffmpeg: ctx.ffmpeg, log: () => {} });
    } finally {
      await browser.close();
    }
    await runFfmpeg(ctx.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", mov, "-frames:v", "1", "-pix_fmt", "rgba", png]);
    storeHash(png, hash);
  }
  return png;
}

/** Whether this ffmpeg build has an encoder (`ffmpeg -encoders`). */
async function hasEncoder(ffmpeg, name) {
  const { spawnSync } = await import("node:child_process");
  const out = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return out.status === 0 && new RegExp(`\\s${name}\\s`).test(out.stdout);
}

async function stepSheet(ctx) {
  const timeline = timelineOf(ctx.spec.beats);
  const out = path.join(ctx.finalsDir, "trailer_contact.jpg");
  const frames = timeline.beats.map((beat) => path.join(ctx.outDir, "beats", `${beat.id}.mp4`));
  const hash = digest(["sheet-v1", ENGINE, timeline, ...frames.map(fileStamp)]);
  if (fresh(out, hash, ctx.force)) {
    console.log("  cached");
    return;
  }
  const tmp = path.join(ctx.outDir, "sheet");
  mkdirSync(tmp, { recursive: true });
  const jpgs = [];
  for (const beat of timeline.beats) {
    const jpg = path.join(tmp, `${beat.id}.jpg`);
    await runFfmpeg(ctx.ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(roundTo(Math.max(0, beat.dur / 2 - 1 / ctx.spec.output.fps), 3)),
      "-i",
      path.join(ctx.outDir, "beats", `${beat.id}.mp4`),
      "-frames:v",
      "1",
      jpg,
    ]);
    jpgs.push(jpg);
  }
  const said = (beat) =>
    (beat.vo ?? [])
      .map((line) => line.text ?? (line.line ? `(${line.lang} line from the app)` : ""))
      .join(" ")
      .replace(/\[pause \d+\]/g, "…");
  const describe = (p) =>
    p.src === "capture" ? `capture:${p.shot}` : p.src === "cine" ? `cine:${p.id}` : p.src === "title" ? `title:${p.id}` : p.src === "image" ? `image:${p.path}` : p.src === "clip" ? `clip:${p.path.split("/").pop()}` : p.src;
  const html = contactSheetHtml(
    timeline.beats.map((beat, i) => ({
      id: beat.id,
      start: clock(beat.start),
      picture: describe(ctx.spec.beats[i].picture),
      image: pathToFileURL(jpgs[i]).href,
      vo: said(ctx.spec.beats[i]),
    })),
    { title: `Through Their Eyes · trailer contact sheet · ${clock(timeline.duration)}` },
  );
  const htmlPath = path.join(tmp, "contact_sheet.html");
  writeFileSync(htmlPath, html);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.screenshot({ path: out, type: "jpeg", quality: 85, fullPage: true });
  } finally {
    await browser.close();
  }
  storeHash(out, hash);
  console.log(`  ${path.relative(ctx.root, out)}`);
}

async function stepReport(ctx) {
  const out = path.join(ctx.finalsDir, "trailer_report.md");
  const finalMp4 = path.join(ctx.finalsDir, "trailer.mp4");
  const claimsPath = path.join(ctx.finalsDir, "claims.json");
  const modePath = path.join(ctx.outDir, "vo", "MODE");
  const hash = digest(["report-v1", ENGINE, ctx.spec, fileStamp(finalMp4), fileStamp(claimsPath), fileStamp(modePath)]);
  if (fresh(out, hash, ctx.force)) {
    console.log("  cached");
    return;
  }
  if (!existsSync(finalMp4)) throw new Error("out/video/trailer.mp4 is missing; run the edit step");
  const measured = await runFfmpeg(ctx.ffmpeg, measureArgs(finalMp4));
  const loudness = parseEbur128(measured.stderr);
  const duration = parseDuration(measured.stderr) ?? timelineOf(ctx.spec.beats).duration;
  // The film as encoded must stay clear of 2:00: fail at output.fail_at_s (default 117 s) of
  // measured length, after the report is written so it shows what ran long.
  const failAt = ctx.spec.output?.fail_at_s ?? 117;
  const encoded = await probe(ctx.ffmpeg, finalMp4);
  const { table, doc } = loadClaims(ctx);
  const titles = resolveUsedTitles(ctx.spec, table);
  const lines = resolveLines(ctx.spec, table, doc);
  const timeline = timelineOf(ctx.spec.beats);
  const warnings = reportWarnings(ctx, timeline, lines, titles, modePath);
  const spoken = lines.map((line) => ({
    id: line.id,
    beat: line.beat,
    at: line.at,
    text: line.drop ? (line.text ?? line.fallback ?? "") : line.text,
    dropped: line.drop,
    fallback: line.fallback,
    narration: line.narration,
    used: line.used,
    missing: line.missing,
  }));
  const shown = [...titles.values()].map((title) => ({
    id: title.id,
    where: titleUses(ctx.spec, title.id),
    text: flattenText(title.drop ? title.source.params : title.params).join(" · "),
    dropped: title.drop,
    fallback: title.fallback,
    used: title.used,
    missing: title.missing,
  }));
  // Photosensitivity (WCAG 2.3.1): flashes per second on the encoded film, and any red flash.
  const flashes = await filmFlashes(ctx, finalMp4);
  const flashLine =
    `Flashes (WCAG 2.3.1, whole frame and each quarter): at most ${flashes.general.maxPerSecond} in any 1 s ` +
    `(limit 3)${flashes.general.at != null ? `, at ${flashes.general.at.toFixed(2)} s` : ""}; ` +
    `${flashes.general.flashes} in all; saturated-red flashes: ${flashes.red.flashes} (limit 0).`;
  writeFileSync(out, renderReport({ timeline, spoken, shown, warnings, loudness, duration }).replace(/\n## Timeline/, `\n${flashLine}\n\n## Timeline`));
  storeHash(out, hash);
  console.log(
    `  ${duration.toFixed(2)}s, ${loudness.integrated.toFixed(1)} LUFS, true peak ${loudness.truePeak.toFixed(1)} dBFS`,
  );
  console.log(`  flashes: max ${flashes.general.maxPerSecond}/s, red ${flashes.red.flashes}`);
  if (flashes.general.maxPerSecond > 3 || flashes.red.flashes > 0) {
    rmSync(`${out}.hash`, { force: true });
    throw new Error(`out/video/trailer.mp4 fails the photosensitivity guard: ${flashLine}`);
  }
  if (encoded >= failAt) {
    rmSync(`${out}.hash`, { force: true }); // run the check again next time
    throw new Error(`out/video/trailer.mp4 is ${encoded.toFixed(2)} s, at or over the ${failAt} s limit (output.fail_at_s)`);
  }
}

/** Picture inputs for one beat: which file, how long the source is, which overlays survived. */
async function beatEnv(ctx, beat, titles, manifest) {
  let picture = beat.picture;
  let file;
  let sourceDuration;
  let cropBox = null;
  let files;
  let sourceDurations;
  if (picture.src === "cine") {
    file = path.join(ctx.outDir, "cine", `${picture.id}.mp4`);
    sourceDuration = await probe(ctx.ffmpeg, file);
  } else if (picture.src === "capture") {
    file = path.join(ctx.finalsDir, `${picture.shot}.webm`);
    sourceDuration = await probe(ctx.ffmpeg, file);
    if (typeof picture.crop === "string") cropBox = manifestCrop(manifest, picture.shot, picture.crop);
  } else if (picture.src === "title") {
    const title = titles.get(picture.id);
    if (!title || title.drop) picture = { src: "black" };
    else {
      file = title.file;
      sourceDuration = await probe(ctx.ffmpeg, file);
    }
  } else if (picture.src === "image") {
    file = path.resolve(ctx.root, picture.path);
  } else if (picture.src === "split") {
    const sideFile = (part) =>
      part.src === "clip" ? path.resolve(ctx.root, part.path) : path.join(ctx.finalsDir, `${part.shot}.webm`);
    files = [sideFile(picture.left), sideFile(picture.right)];
    for (const f of files) if (!existsSync(f)) throw new Error(`beat ${beat.id}: missing ${path.relative(ctx.root, f)}`);
    sourceDurations = [await probe(ctx.ffmpeg, files[0]), await probe(ctx.ffmpeg, files[1])];
    file = files[0];
  } else if (picture.src === "clip") {
    file = path.resolve(ctx.root, picture.path);
    if (!existsSync(file)) throw new Error(`beat ${beat.id}: missing clip ${picture.path} (rendered outside the repo; see video/README.md)`);
    sourceDuration = await probe(ctx.ffmpeg, file);
  }
  const overlays = [];
  for (const overlay of beat.overlays ?? []) {
    const title = titles.get(overlay.title);
    if (!title || title.drop) continue;
    if (!existsSync(title.file)) throw new Error(`missing ${title.file}; run the titles step`);
    overlays.push({ file: title.file, at: overlay.at });
  }
  return { picture, env: { file, files, sourceDuration, sourceDurations, cropBox, overlays } };
}

/** Voice, effects and music, in the order mixGraph numbers its inputs. */
/** A beat's `muffle` windows (beat time) as absolute seconds. */
function muffleWindows(spec, timeline) {
  const out = [];
  spec.beats.forEach((beat, i) => {
    for (const w of beat.muffle ?? []) {
      const start = timeline.beats[i].start + w.at;
      out.push({ start, end: start + w.dur });
    }
  });
  return out;
}

async function mixPlan(ctx, timeline) {
  const { table, doc } = loadClaims(ctx);
  const lines = resolveLines(ctx.spec, table, doc).filter((line) => !line.drop);
  const vo = [];
  for (const line of lines) {
    const file = path.join(ctx.outDir, "vo", `${line.id}.wav`);
    if (!existsSync(file)) throw new Error(`missing ${file}; run the vo step`);
    vo.push({ start: line.beatStart + line.at, file, fx: voiceFor(ctx.spec, line.lang, line.speaker).fx ?? null });
  }
  const sfx = [];
  for (const row of timeline.beats) {
    const beat = ctx.spec.beats.find((item) => item.id === row.id);
    for (const effect of beat.sfx ?? []) {
      const file = path.join(ctx.outDir, "sfx", `${effect.name}.wav`);
      if (!existsSync(file)) throw new Error(`missing ${file}; run the sfx step`);
      sfx.push({ start: row.start + effect.at, gainDb: effect.gain_db ?? 0, file, bed: effect.name === "hum" });
    }
  }
  const music = [];
  for (const entry of ctx.spec.music ?? []) {
    const asset = ctx.assets.find((item) => item.id === entry.asset);
    const file = path.join(ctx.outDir, "assets", assetFileName(asset));
    if (!existsSync(file)) throw new Error(`missing ${file}; run the assets step`);
    music.push({
      at: entry.at,
      from: entry.from,
      until: entry.until,
      gainDb: entry.gain_db,
      fadeIn: entry.fade_in,
      fadeOut: entry.fade_out,
      duckDb: entry.duck_db,
      file,
    });
  }
  const files = [...vo.map((c) => c.file), ...sfx.map((c) => c.file), ...music.map((c) => c.file)];
  return {
    files,
    graph: mixGraph({ videoDuration: timeline.duration, voiceFx: ctx.spec.voice?.fx, vo, sfx, music, muffle: muffleWindows(ctx.spec, timeline) }),
  };
}

function reportWarnings(ctx, timeline, lines, titles, modePath) {
  const warnings = [...ctx.warnings];
  for (const title of titles.values()) if (title.drop && title.warning) warnings.push(title.warning);
  for (const line of lines) if (line.drop && line.warning) warnings.push(line.warning);
  for (const beat of ctx.spec.beats) {
    if (beat.picture?.src === "title" && titles.get(beat.picture.id)?.drop) {
      warnings.push(`beat ${beat.id}: title "${beat.picture.id}" was dropped; the picture is black`);
    }
  }
  for (const row of timeline.beats) {
    if (row.tail > row.dur + 1e-6) {
      warnings.push(`beat ${row.id} (${row.dur}s) is shorter than its ${row.out} transition (${row.tail}s)`);
    }
  }
  const timed = [];
  for (const line of lines) {
    if (line.drop) continue;
    const wav = path.join(ctx.outDir, "vo", `${line.id}.wav`);
    if (!existsSync(wav)) continue;
    timed.push({
      id: line.id,
      beat: line.beat,
      beatStart: line.beatStart,
      beatDur: line.beatDur,
      at: line.at,
      duration: wavSeconds(wav),
    });
  }
  // Measured lengths replace the spec check's estimates ("may not fit") for the lines that have audio.
  if (timed.length) {
    const measured = new Set(timed.map((t) => `vo "${t.id}"`));
    for (let i = warnings.length - 1; i >= 0; i--) {
      const w = warnings[i];
      if (w.includes("may not fit") && [...measured].some((id) => w.startsWith(id))) warnings.splice(i, 1);
    }
  }
  warnings.push(...voRoomWarnings(timed));
  if (existsSync(modePath) && readFileSync(modePath, "utf8").trim() === "silent") {
    warnings.push(
      "voice-over skipped (--no-vo): silent stand-ins of the planned lengths; set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to synthesize",
    );
  }
  return [...new Set(warnings)];
}

function resolveUsedTitles(spec, table) {
  const ids = new Set();
  for (const beat of spec.beats) {
    if (beat.picture?.src === "title") ids.add(beat.picture.id);
    for (const overlay of beat.overlays ?? []) ids.add(overlay.title);
  }
  const map = new Map();
  for (const id of ids) {
    const source = spec.titles[id];
    const resolved = resolveTitle({ ...source, id }, table);
    const alpha = !!source.alpha;
    map.set(id, {
      ...resolved,
      id,
      source,
      alpha,
      file: null,
      render: {
        template: source.template,
        dur: source.dur,
        alpha,
        params: resolved.params ?? {},
      },
    });
  }
  return map;
}

function titlePath(ctx, title) {
  const file = path.join(ctx.outDir, "titles", `${title.id}${title.alpha ? ".mov" : ".mp4"}`);
  title.file = file;
  return file;
}

function resolveLines(spec, table, doc) {
  const timeline = timelineOf(spec.beats);
  const lines = [];
  for (const row of timeline.beats) {
    const beat = spec.beats.find((item) => item.id === row.id);
    for (const line of beat.vo ?? []) {
      const resolved = resolveVo(line, table, doc);
      lines.push({
        ...line,
        ...resolved,
        beat: beat.id,
        beatStart: row.start,
        beatDur: beat.dur,
        lang: line.lang ?? line.line?.language,
      });
    }
  }
  return lines;
}

/** Titles keep their output path on the object once the work directory is known. */
function titlesWithFiles(ctx, table) {
  const titles = resolveUsedTitles(ctx.spec, table);
  for (const title of titles.values()) titlePath(ctx, title);
  return titles;
}

function loadClaims(ctx) {
  const file = path.join(ctx.finalsDir, "claims.json");
  if (!existsSync(file)) return { table: {}, doc: null };
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const table = doc.claims && typeof doc.claims === "object" ? doc.claims : claimTable(doc.sources ?? []);
  return { table, doc };
}

function titleUses(spec, id) {
  const uses = [];
  for (const beat of spec.beats) {
    if (beat.picture?.src === "title" && beat.picture.id === id) uses.push(`picture on ${beat.id}`);
    for (const overlay of beat.overlays ?? []) {
      if (overlay.title === id) uses.push(`overlay on ${beat.id} at ${overlay.at.toFixed(3)}`);
    }
  }
  return uses.join(", ") || "unused";
}

/** Decode the film to tiny frames and count its flashes (lib/flashes.mjs). */
async function filmFlashes(ctx, file) {
  const { spawnSync } = await import("node:child_process");
  const { measureFlashes } = await import("./lib/flashes.mjs");
  const width = 32;
  const height = 18;
  const fps = ctx.spec.output.fps;
  const res = spawnSync(
    ctx.ffmpeg,
    ["-v", "error", "-i", file, "-vf", `fps=${fps},scale=${width}:${height}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`could not decode ${file} for the flash check`);
  return measureFlashes(res.stdout, { width, height, fps });
}

async function probe(ffmpeg, file) {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const { stderr } = await runFfmpeg(ffmpeg, ["-hide_banner", "-i", file], { allowFail: true });
  const duration = parseDuration(stderr);
  if (duration == null) throw new Error(`could not read the duration of ${file}`);
  return duration;
}

function manifestCrop(manifest, shot, name) {
  const entry = manifest?.shots?.find((item) => item.id === shot);
  const box = entry?.crop?.[name];
  if (!box || !(box.w > 0) || !(box.h > 0)) {
    throw new Error(`manifest.json has no "${name}" crop for ${shot}; run the capture step`);
  }
  return box;
}

async function withBrowser(ctx, fn) {
  const { chromium } = await import("playwright");
  // WebGL on the GPU: headless Chromium otherwise falls back to SwiftShader (the CPU). On macOS
  // that means ANGLE on Metal.
  const browser = await chromium.launch({
    headless: !ctx.headed,
    args: [
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function loadModule(specifier, name) {
  try {
    const mod = await import(specifier);
    if (typeof mod[name] !== "function") throw new Error(`${specifier} does not export ${name}`);
    return mod;
  } catch (err) {
    throw new Error(`${name} needs ${specifier} (${err.message})`);
  }
}

function fallbackShot(ctx) {
  const shot = (ctx.shots.shots ?? []).find((item) => item.status === "ready" || item.status === "stand-in");
  if (!shot) throw new Error("claims.json is missing and shots.json has no shot to capture");
  return shot.id;
}

function selectSteps(step) {
  if (!step) return STEPS;
  const asked = step.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = asked.filter((name) => !STEPS.includes(name));
  if (unknown.length) throw new Error(`unknown step ${unknown.join(", ")} (want ${STEPS.join(", ")})`);
  return STEPS.filter((name) => asked.includes(name));
}

function printTimeline(spec) {
  const timeline = timelineOf(spec.beats);
  console.log(`timeline ${timeline.duration.toFixed(3)} s`);
  for (const beat of timeline.beats) {
    const out = beat.out === "cut" ? "cut" : `${beat.out} ${beat.tail.toFixed(3)}`;
    console.log(
      `  ${beat.start.toFixed(3)}  ${String(beat.dur.toFixed(3)).padEnd(7)} ${beat.id.padEnd(16)} ${beat.picture.padEnd(28)} ${out}`,
    );
  }
}

function fresh(file, hash, force) {
  return !force && isCached(file, hash);
}

function fileStamp(file) {
  if (!file || !existsSync(file)) return "missing";
  const stat = statSync(file);
  return `${stat.size}:${stat.mtimeMs}`;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.message}`);
  }
}

function readJsonIf(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function flattenText(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenText);
  return [];
}

function clock(seconds) {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const secs = (whole - minutes * 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${secs}`;
}

function roundTo(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// Last, so every module-level constant (STEP above) is initialised before main runs.
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
