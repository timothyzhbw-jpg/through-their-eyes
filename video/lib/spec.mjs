// Validator for trailer.json (SPEC 10). --check runs this and nothing else: no browser, no
// network, no ffmpeg. Errors name the beat (`beats[3] (b04-pov): …`) so a bad spec is obvious.
// A number may appear in spoken or shown text only inside a {claim.value} slot; the fallback
// has none. Player ids such as H8 and A10 are names, and [pause 400] is the one markup whose
// digits are allowed.

import { existsSync } from "node:fs";
import path from "node:path";
import { SFX_NAMES } from "./sfx.mjs";
import { estimateSpeechSeconds } from "./vo.mjs";

const GRADES = new Set(["none", "night", "cool", "warm", "bleach", "mono", "danger"]);
const FX = new Set(["grain", "vignette", "chroma", "rewind", "shake", "flash-in", "glue", "lift", "warm"]);
const FITS = new Set(["cover", "pad", "contain"]);
const TRANSITIONS = new Set(["cut", "fade", "flash", "dip", "whip", "glitch"]);
const CROPS = new Set(["pov", "tactical", "stage"]);
const NUMBER_WORD =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|once|twice|half|dozen|percent)\b/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * @param {object} spec
 * @param {{ root: string, shotIds: Set<string>, assets: object[], harvest?: Array<{ persona: string, language: string }> }} ctx
 * @returns {{ errors: string[], warnings: string[] }}
 */
/**
 * The beats of one telling of the story: `story` ("blender", the default, or "app", or per section
 * { open: ..., close: ... } by each beat's `section`) keeps the beats
 * tagged with it and every untagged beat. The two tellings of each story section are the same
 * length, so the rest of the cut, and the score, do not move.
 * @param {{ story?: string, beats?: object[] }} spec
 * @param {string} [story] overrides spec.story
 */
export function storyBeats(spec, story) {
  const choice = story ?? spec?.story ?? "blender";
  // A telling for the whole story, or one per section ({ open, close }): if a section's shots
  // fall through, that section alone goes back to the in-engine telling.
  const pick = (beat) => (typeof choice === "string" ? choice : (choice?.[beat.section] ?? "blender"));
  return (spec?.beats ?? []).filter((beat) => beat.story == null || beat.story === pick(beat));
}

/**
 * The trailer under one naming of the players (SPEC 10): `ids` as written (H8, A11), or `names`,
 * the fictional names the app shows once its players are named. `named.vo` swaps a line's text
 * (a string, or { text, at } when the new line needs another start) and gives it its own id (`<id>n`), so both voicings stay synthesized side by side;
 * `named.titles` overrides a title's params (and its fallback), key by key. A title this cut
 * does not have (a Blender name card before its clip is in) is skipped.
 */
export function namedSpec(spec, naming) {
  const choice = naming ?? spec?.naming ?? "ids";
  if (choice !== "names") return spec;
  const named = spec.named ?? {};
  const voice = (line) => {
    const over = named.vo?.[line.id];
    if (over == null) return line;
    return { ...line, ...(typeof over === "string" ? { text: over } : over), id: `${line.id}n` };
  };
  const beats = (spec.beats ?? []).map((beat) => (beat.vo ? { ...beat, vo: beat.vo.map(voice) } : beat));
  const titles = { ...(spec.titles ?? {}) };
  for (const [key, over] of Object.entries(named.titles ?? {})) {
    const title = titles[key];
    if (!title) continue;
    titles[key] = {
      ...title,
      params: { ...title.params, ...(over.params ?? {}) },
      ...(over.fallback ? { fallback: { ...title.fallback, ...over.fallback } } : {}),
    };
  }
  return { ...spec, beats, titles };
}

export function validateTrailer(spec, ctx) {
  const errors = [];
  // `pins`: a cine shot or a capture corner-pinned onto a screen in a rendered clip (video/pin.py).
  for (const [k, pin] of (Array.isArray(spec?.pins) ? spec.pins : []).entries()) {
    const at = `pins[${k}]`;
    if (!pin || typeof pin.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(pin.id)) errors.push(`${at}: id is not a safe file name`);
    for (const key of ["clip", "corners", "matte"]) {
      if (typeof pin?.[key] !== "string" || !pin[key]) errors.push(`${at}: ${key} is required`);
    }
    const src = pin?.source ?? {};
    if (src.capture != null ? !ctx.shotIds?.has(src.capture) : !spec.cine?.[src.cine]) {
      errors.push(`${at}: source must name a cine shot (source.cine) or a capture shot (source.capture)`);
    }
  }
  const warnings = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { errors: ["trailer.json: expected an object"], warnings };
  }
  if (spec.naming != null && !["ids", "names"].includes(spec.naming)) errors.push(`naming must be "ids" or "names"`);
  // `report_facts`: numbers read off a committed eval report (claims.mjs reportFacts).
  for (const [id, fact] of Object.entries(spec.report_facts ?? {})) {
    const at = `report_facts.${id}`;
    if (!/^[a-z_]+$/.test(id)) errors.push(`${at}: id must be lower-case letters and underscores`);
    if (ctx.claimIds?.has(id)) errors.push(`${at}: collides with a claim id and would overwrite the claim`);
    if (typeof fact?.file !== "string" || !repoFile(ctx.root, fact.file)) errors.push(`${at}: file must be a path inside the repo`);
    let groups = -1;
    try {
      groups = new RegExp(`${fact?.pattern}|`).exec("").length - 1;
    } catch {
      errors.push(`${at}: pattern is not a regular expression`);
    }
    const names = Array.isArray(fact?.values) ? fact.values : [];
    if (!names.length || !names.every((n) => /^[a-z_]+$/.test(n))) errors.push(`${at}: values must name each group`);
    else if (groups >= 0 && groups !== names.length) errors.push(`${at}: ${groups} groups in pattern, ${names.length} values`);
  }
  const voIds = new Set((spec.beats ?? []).flatMap((b) => (b.vo ?? []).map((v) => v.id.replace(/n$/, ""))));
  for (const id of Object.keys(spec.named?.vo ?? {})) {
    if (!voIds.has(id)) errors.push(`named.vo.${id}: no voice line has that id`);
  }
  if (spec.version !== 1) errors.push(`version: expected 1, got ${JSON.stringify(spec.version)}`);
  checkOutput(spec.output, errors);
  if (typeof spec.site !== "string" || !spec.site) errors.push("site: expected the web app's URL");
  checkVoice(spec, errors);
  const assetIds = new Map((ctx.assets ?? []).map((a) => [a.id, a]));
  checkMusic(spec.music ?? [], assetIds, errors);
  checkCine(spec.cine ?? {}, errors);
  checkTitles(spec.titles ?? {}, errors);
  checkBeats(spec, ctx, errors, warnings);
  return { errors, warnings };
}

/** @param {object | undefined} output @param {string[]} errors */
function checkOutput(output, errors) {
  if (!output || typeof output !== "object") {
    errors.push("output: expected { fps, width, height, lufs, true_peak }");
    return;
  }
  for (const key of ["fps", "width", "height"]) {
    if (!(output[key] > 0)) errors.push(`output.${key}: expected a positive number`);
  }
  for (const key of ["lufs", "true_peak"]) {
    if (typeof output[key] !== "number" || !Number.isFinite(output[key])) {
      errors.push(`output.${key}: expected a number`);
    }
  }
}

/** @param {object} spec @param {string[]} errors */
function checkVoice(spec, errors) {
  const voice = spec.voice;
  if (!voice || typeof voice.name !== "string" || !voice.name || typeof voice.lang !== "string" || !voice.lang) {
    errors.push("voice: expected { name, lang }");
  }
  if (voice && voice.fx != null && typeof voice.fx !== "string") errors.push("voice.fx: expected a string");
  const voices = spec.voices ?? {};
  if (typeof voices !== "object" || Array.isArray(voices)) {
    errors.push("voices: expected an object");
    return;
  }
  for (const [lang, entry] of Object.entries(voices)) {
    if (!entry || typeof entry.name !== "string" || typeof entry.lang !== "string") {
      errors.push(`voices.${lang}: expected { name, lang }`);
    }
  }
}

/** @param {object[]} music @param {Map<string, { kind?: string }>} assetIds @param {string[]} errors */
function checkMusic(music, assetIds, errors) {
  if (!Array.isArray(music)) {
    errors.push("music: expected a list");
    return;
  }
  music.forEach((entry, i) => {
    const where = `music[${i}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${where}: expected an object`);
      return;
    }
    const asset = assetIds.get(entry.asset);
    if (!asset) errors.push(`${where}: unknown asset "${entry.asset}"`);
    else if (asset.kind && asset.kind !== "music") errors.push(`${where}: asset "${entry.asset}" is not music`);
    if (!(entry.at >= 0)) errors.push(`${where}: at must be >= 0`);
    if (!(entry.from >= 0)) errors.push(`${where}: from must be >= 0`);
    if (!(entry.until > entry.at)) errors.push(`${where}: until must be after at`);
    for (const key of ["fade_in", "fade_out"]) {
      if (!(entry[key] >= 0)) errors.push(`${where}: ${key} must be >= 0`);
    }
    for (const key of ["gain_db", "duck_db"]) {
      if (typeof entry[key] !== "number" || !Number.isFinite(entry[key])) {
        errors.push(`${where}: ${key} must be a number`);
      }
    }
  });
}

/** @param {Record<string, { url?: string, shot?: object }>} cine @param {string[]} errors */
function checkCine(cine, errors) {
  if (typeof cine !== "object" || Array.isArray(cine)) {
    errors.push("cine: expected an object");
    return;
  }
  for (const [id, shot] of Object.entries(cine)) {
    if (!ID.test(id)) errors.push(`cine.${id}: id is not a safe file name`);
    if (!shot || typeof shot.url !== "string" || !shot.url) errors.push(`cine.${id}: url is required`);
    if (!shot || typeof shot.shot !== "object" || shot.shot == null) errors.push(`cine.${id}: shot is required`);
    else if (shot.shot.duration != null && !(shot.shot.duration > 0)) {
      errors.push(`cine.${id}: shot.duration must be positive`);
    }
  }
}

/** @param {Record<string, object>} titles @param {string[]} errors */
function checkTitles(titles, errors) {
  if (typeof titles !== "object" || Array.isArray(titles)) {
    errors.push("titles: expected an object");
    return;
  }
  for (const [id, title] of Object.entries(titles)) {
    const where = `titles.${id}`;
    if (!ID.test(id)) errors.push(`${where}: id is not a safe file name`);
    if (!title || typeof title.template !== "string" || !title.template) errors.push(`${where}: template is required`);
    if (!(title?.dur > 0)) errors.push(`${where}: dur must be positive`);
    if (title?.alpha != null && typeof title.alpha !== "boolean") errors.push(`${where}: alpha must be true or false`);
    if (!title?.params || typeof title.params !== "object" || Array.isArray(title.params)) {
      errors.push(`${where}: params must be an object`);
    } else {
      // `url` and `qr` are the site's address (it may hold digits), not a number claim; `legal`
      // holds credit lines that a licence requires verbatim (a grant number, say), not claims either.
      const { url, qr, legal, ...shown } = title.params;
      if (url != null && typeof url !== "string") errors.push(`${where}: url must be a string`);
      if (qr != null && !(typeof qr === "string" && /^https:\/\/[^\s]+$/.test(qr))) errors.push(`${where}: qr must be an https address`);
      if (legal != null && !(Array.isArray(legal) && legal.every((line) => typeof line === "string"))) {
        errors.push(`${where}: legal must be a list of strings`);
      }
      for (const text of stringsIn(shown)) {
        for (const issue of spokenIssues(text, { allowPause: false })) errors.push(`${where}: ${issue} in params`);
      }
    }
    if (title?.fallback != null) {
      if (typeof title.fallback !== "object" || Array.isArray(title.fallback)) {
        errors.push(`${where}: fallback must be an object`);
      } else {
        for (const text of stringsIn(title.fallback)) {
          if (/\{[^}]*\}/.test(text)) errors.push(`${where}: fallback contains a slot`);
          for (const issue of spokenIssues(text, { allowPause: false })) {
            errors.push(`${where}: ${issue} in fallback`);
          }
        }
      }
    }
  }
}

/**
 * @param {object} spec
 * @param {{ root: string, shotIds: Set<string>, harvest?: Array<{ persona: string, language: string }> }} ctx
 * @param {string[]} errors
 * @param {string[]} warnings
 */
function checkBeats(spec, ctx, errors, warnings) {
  const beats = spec.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    errors.push("beats: expected a non-empty list");
    return;
  }
  const cine = spec.cine ?? {};
  const titles = spec.titles ?? {};
  const seen = new Set();
  const voIds = new Set();
  /** @type {string | undefined} */
  let prevId;
  let total = 0;
  /** @type {Array<{ id: string, beat: string, beatStart: number, beatDur: number, at: number, duration: number }>} */
  const planned = [];
  let cursor = 0;

  beats.forEach((beat, i) => {
    const id = typeof beat?.id === "string" ? beat.id : "?";
    const where = `beats[${i}] (${id})`;
    if (!beat || typeof beat !== "object") {
      errors.push(`${where}: expected an object`);
      return;
    }
    if (!ID.test(id)) errors.push(`${where}: id is not a safe file name`);
    if (seen.has(id)) errors.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
    if (prevId !== undefined && id < prevId) errors.push(`${where}: ids are not sorted`);
    prevId = id;
    if (!(beat.dur > 0)) errors.push(`${where}: duration must be positive`);
    else total += beat.dur;

    checkPicture(beat, i, where, cine, titles, ctx, errors);
    if (beat.grade != null && !GRADES.has(beat.grade)) errors.push(`${where}: unknown grade "${beat.grade}"`);
    if (beat.fx != null) {
      if (!Array.isArray(beat.fx)) errors.push(`${where}: fx must be a list`);
      else for (const name of beat.fx) if (!FX.has(name)) errors.push(`${where}: unknown fx "${name}"`);
    }
    if (beat.letterbox != null && !(beat.letterbox > 0)) errors.push(`${where}: letterbox must be an aspect or null`);
    if (beat.freeze) {
      if (!(beat.freeze.at >= 0) || !(beat.dur > 0) || beat.freeze.at >= beat.dur) {
        errors.push(`${where}: freeze.at must be inside the beat`);
      }
      // No punch is a plain hold: the sharp frame, unscaled (a freeze-frame name card).
      if (beat.freeze.punch != null && !(beat.freeze.punch > 0)) errors.push(`${where}: freeze.punch must be positive`);
    }
    checkOverlays(beat, i, where, titles, warnings, errors);
    checkVo(beat, where, spec, ctx, voIds, cursor, planned, errors, warnings);
    checkSfx(beat, where, errors);
    checkOut(beat, beats[i + 1], i === beats.length - 1, where, errors);
    if (beat.dur > 0) cursor += beat.dur;
  });

  if (total >= 120) errors.push(`total duration ${trim(total)}s is not under 120s`);
  // A margin under the platform's 2:00 (encoding padding, a stray frame): output.max_s caps the plan.
  const cap = spec?.output?.max_s;
  if (typeof cap === "number" && total > cap) errors.push(`total duration ${trim(total)}s is over output.max_s (${cap}s)`);
  warnVoFit(planned, warnings);
}

/**
 * @param {object} beat
 * @param {number} i
 * @param {string} where
 * @param {Record<string, unknown>} cine
 * @param {Record<string, unknown>} titles
 * @param {{ root: string, shotIds: Set<string> }} ctx
 * @param {string[]} errors
 */
function checkPicture(beat, i, where, cine, titles, ctx, errors) {
  const picture = beat.picture;
  if (!picture || typeof picture.src !== "string") {
    errors.push(`${where}: picture.src is required`);
    return;
  }
  if (picture.src === "black") return;
  if (picture.src === "cine") {
    if (!cine[picture.id]) errors.push(`${where}: unknown cine id "${picture.id}"`);
    if (picture.in != null && !(picture.in >= 0)) errors.push(`${where}: in must be >= 0`);
    return;
  }
  if (picture.src === "capture") {
    if (!ctx.shotIds.has(picture.shot)) errors.push(`${where}: unknown capture shot "${picture.shot}"`);
    if (picture.in != null && !(picture.in >= 0)) errors.push(`${where}: in must be >= 0`);
    if (picture.speed != null && !(picture.speed > 0)) errors.push(`${where}: speed must be positive`);
    if (picture.reverse != null && typeof picture.reverse !== "boolean") errors.push(`${where}: reverse must be true or false`);
    checkCrop(picture.crop, where, errors);
    checkPush(picture.push, where, errors);
    if (picture.fit != null && !FITS.has(picture.fit)) errors.push(`${where}: fit must be one of ${[...FITS].join(", ")}`);
    return;
  }
  if (picture.src === "title") {
    if (!titles[picture.id]) errors.push(`${where}: unknown title id "${picture.id}"`);
    return;
  }
  if (picture.src === "clip") {
    // A video rendered outside the repo (out/video/blender/…, git-ignored): its file is checked
    // when the edit runs, so --check passes in CI where it is absent.
    if (!repoFile(ctx.root, picture.path)) errors.push(`${where}: clip path "${picture.path}" must stay inside the repo`);
    if (picture.in != null && !(picture.in >= 0)) errors.push(`${where}: in must be >= 0`);
    if (picture.speed != null && !(picture.speed > 0)) errors.push(`${where}: speed must be positive`);
    if (picture.reverse != null && typeof picture.reverse !== "boolean") errors.push(`${where}: reverse must be true or false`);
    if (picture.fit != null && !FITS.has(picture.fit)) errors.push(`${where}: fit must be one of ${[...FITS].join(", ")}`);
    checkPush(picture.push, where, errors);
    return;
  }
  if (picture.src === "split") {
    // Two sources side by side, each cropped at its native size (no scaling), with a divider.
    for (const side of ["left", "right"]) {
      const part = picture[side];
      if (!part || !["clip", "capture", "cine"].includes(part.src)) {
        errors.push(`${where}: split.${side} must be a clip, a capture or a cine shot`);
        continue;
      }
      if (part.src === "clip" && !repoFile(ctx.root, part.path)) errors.push(`${where}: split.${side} clip path "${part.path}" must stay inside the repo`);
      if (part.src === "cine" && !cine[part.id]) errors.push(`${where}: split.${side}: unknown cine id "${part.id}"`);
      if (part.src === "capture" && !ctx.shotIds.has(part.shot)) errors.push(`${where}: split.${side}: unknown capture shot "${part.shot}"`);
      if (part.in != null && !(part.in >= 0)) errors.push(`${where}: split.${side}.in must be >= 0`);
      if (!Array.isArray(part.crop) || part.crop.length !== 4) errors.push(`${where}: split.${side}.crop must be [x, y, w, h]`);
    }
    return;
  }
  if (picture.src === "image") {
    const abs = repoFile(ctx.root, picture.path);
    if (!abs) errors.push(`${where}: image path "${picture.path}" must stay inside the repo`);
    else if (!existsSync(abs)) errors.push(`${where}: image not found "${picture.path}"`);
    checkPush(picture.push, where, errors);
    return;
  }
  errors.push(`${where}: unknown picture src "${picture.src}"`);
}

/** @param {unknown} crop @param {string} where @param {string[]} errors */
function checkCrop(crop, where, errors) {
  if (crop == null) return;
  if (typeof crop === "string") {
    if (!CROPS.has(crop)) errors.push(`${where}: unknown crop "${crop}"`);
    return;
  }
  if (!Array.isArray(crop) || crop.length !== 4 || crop.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    errors.push(`${where}: crop box must be [x, y, w, h]`);
    return;
  }
  if (!(crop[2] > 0) || !(crop[3] > 0)) errors.push(`${where}: crop box must be [x, y, w, h]`);
}

/** @param {unknown} push @param {string} where @param {string[]} errors */
function checkPush(push, where, errors) {
  if (push == null) return;
  if (!Array.isArray(push) || push.length !== 2 || !(push[0] > 0) || !(push[1] > 0)) {
    errors.push(`${where}: push must be [z0, z1]`);
  }
}

/**
 * @param {object} beat
 * @param {number} i
 * @param {string} where
 * @param {Record<string, { dur?: number }>} titles
 * @param {string[]} warnings
 * @param {string[]} errors
 */
function checkOverlays(beat, i, where, titles, warnings, errors) {
  const overlays = beat.overlays ?? [];
  if (!Array.isArray(overlays)) {
    errors.push(`${where}: overlays must be a list`);
    return;
  }
  for (const overlay of overlays) {
    const title = titles[overlay?.title];
    if (!title) {
      errors.push(`${where}: unknown title id "${overlay?.title}"`);
      continue;
    }
    if (!(overlay.at >= 0)) errors.push(`${where}: overlay "${overlay.title}" at must be >= 0`);
    else if (beat.dur > 0 && overlay.at + title.dur > beat.dur + 1e-6) {
      warnings.push(
        `${where}: overlay "${overlay.title}" ends at ${trim(overlay.at + title.dur)}s, after the beat (${trim(beat.dur)}s)`,
      );
    }
  }
}

/**
 * @param {object} beat
 * @param {string} where
 * @param {object} spec
 * @param {{ harvest?: Array<{ persona: string, language: string }> }} ctx
 * @param {Set<string>} voIds
 * @param {number} beatStart
 * @param {Array<{ id: string, beat: string, beatStart: number, beatDur: number, at: number, duration: number }>} planned
 * @param {string[]} errors
 * @param {string[]} warnings
 */
function checkVo(beat, where, spec, ctx, voIds, beatStart, planned, errors, warnings) {
  const lines = beat.vo ?? [];
  if (!Array.isArray(lines)) {
    errors.push(`${where}: vo must be a list`);
    return;
  }
  for (const line of lines) {
    const id = line?.id ?? "?";
    if (!ID.test(String(id))) errors.push(`${where}: vo id "${id}" is not a safe file name`);
    if (voIds.has(id)) errors.push(`${where}: duplicate vo id "${id}"`);
    voIds.add(id);
    if (line?.caption != null && line.caption !== "top") errors.push(`${where}: vo "${id}" caption must be "top"`);
    if (!(line?.at >= 0)) errors.push(`${where}: vo "${id}" at must be >= 0`);
    else if (beat.dur > 0 && line.at >= beat.dur) {
      warnings.push(`${where}: vo "${id}" starts at ${trim(line.at)}s, outside the beat (${trim(beat.dur)}s)`);
    }
    if (line?.line) {
      const ref = line.line;
      if (typeof ref.persona !== "string" || typeof ref.language !== "string" || !(ref.index >= 0) || !Number.isInteger(ref.index)) {
        errors.push(`${where}: vo "${id}" line must be { persona, language, index }`);
      } else if (ctx.harvest && !ctx.harvest.some((h) => h.persona === ref.persona && h.language === ref.language)) {
        warnings.push(
          `${where}: vo "${id}" uses ${ref.persona}/${ref.language}, which is not in shots.json harvest`,
        );
      }
      const lang = line.lang ?? ref.language;
      if (lang && spec.voice && lang !== spec.voice.lang && !spec.voices?.[lang] && !String(spec.voice.lang).startsWith(lang)) {
        errors.push(`${where}: vo "${id}" has no voice for "${lang}"`);
      }
      continue;
    }
    if (typeof line?.text !== "string") {
      errors.push(`${where}: vo "${id}" needs text or a narration line`);
      continue;
    }
    for (const issue of spokenIssues(line.text, { allowPause: true })) errors.push(`${where}: ${issue} in vo "${id}"`);
    if (line.fallback != null) {
      if (typeof line.fallback !== "string") errors.push(`${where}: vo "${id}" fallback must be a string`);
      else {
        if (/\{[^}]*\}/.test(line.fallback)) errors.push(`${where}: vo "${id}" fallback contains a slot`);
        for (const issue of spokenIssues(line.fallback, { allowPause: true })) {
          errors.push(`${where}: ${issue} in vo "${id}" fallback`);
        }
      }
    }
    const lang = line.lang ?? "en";
    if (spec.voice && !sameLang(spec.voice.lang, lang) && !spec.voices?.[lang]) {
      errors.push(`${where}: vo "${id}" has no voice for "${lang}"`);
    }
    if (line.at >= 0 && beat.dur > 0) {
      const guesses = [estimateSpeechSeconds(line.text)];
      if (typeof line.fallback === "string") guesses.push(estimateSpeechSeconds(line.fallback));
      planned.push({
        id,
        beat: beat.id,
        beatStart,
        beatDur: beat.dur,
        at: line.at,
        duration: Math.max(...guesses),
      });
    }
  }
}

/** @param {object} beat @param {string} where @param {string[]} errors */
function checkSfx(beat, where, errors) {
  const sfx = beat.sfx ?? [];
  if (!Array.isArray(sfx)) {
    errors.push(`${where}: sfx must be a list`);
    return;
  }
  for (const effect of sfx) {
    if (!SFX_NAMES.includes(effect?.name)) errors.push(`${where}: unknown sfx "${effect?.name}"`);
    if (!(effect?.at >= 0)) errors.push(`${where}: sfx "${effect?.name}" at must be >= 0`);
    if (effect?.dur != null && !(effect.dur > 0)) errors.push(`${where}: sfx "${effect?.name}" dur must be positive`);
    if (effect?.gain_db != null && (typeof effect.gain_db !== "number" || !Number.isFinite(effect.gain_db))) {
      errors.push(`${where}: sfx "${effect?.name}" gain_db must be a number`);
    }
  }
}

/**
 * @param {object} beat
 * @param {object | undefined} next
 * @param {boolean} last
 * @param {string} where
 * @param {string[]} errors
 */
function checkOut(beat, next, last, where, errors) {
  const out = beat.out ?? { type: "cut" };
  if (!TRANSITIONS.has(out.type)) {
    errors.push(`${where}: unknown transition "${out.type}"`);
    return;
  }
  if (last && out.type !== "cut") {
    errors.push(`${where}: the last beat must cut, so the film stays the sum of the beat lengths`);
    return;
  }
  if (out.type === "cut") return;
  if (!(out.dur > 0)) {
    errors.push(`${where}: transition duration must be positive`);
    return;
  }
  const left = beat.dur;
  const right = next?.dur;
  if (!(out.dur < left) || !(right > out.dur)) {
    errors.push(
      `${where}: transition ${trim(out.dur)}s is not shorter than both beats it joins (${trim(left)}s and ${trim(right)}s)`,
    );
  }
}

/** @param {Array<{ id: string, beat: string, beatStart: number, beatDur: number, at: number, duration: number }>} planned @param {string[]} warnings */
function warnVoFit(planned, warnings) {
  const ordered = [...planned].sort((a, b) => a.beatStart + a.at - (b.beatStart + b.at));
  for (let i = 0; i < ordered.length - 1; i++) {
    const line = ordered[i];
    const next = ordered[i + 1];
    const gap = next.beatStart + next.at - (line.beatStart + line.at);
    if (line.duration > gap + 0.02) {
      warnings.push(
        `vo "${line.id}" on ${line.beat}: planned ${trim(line.duration)}s may not fit in the ${trim(gap)}s before the next line (${next.id})`,
      );
    }
  }
}

/**
 * Digits and number words outside slots. `allowPause` keeps `[pause 400]`.
 * @param {string} text
 * @param {{ allowPause: boolean }} opts
 * @returns {string[]}
 */
export function spokenIssues(text, { allowPause }) {
  const issues = [];
  for (const group of text.match(/\{[^}]*\}/g) ?? []) {
    if (!/^\{[a-z_]+\.[a-z_]+\}/.test(group)) issues.push(`malformed slot "${group}"`);
  }
  if (/\{/.test(text.replace(/\{[^}]*\}/g, ""))) issues.push("malformed slot");
  let bare = text.replace(/\{[a-z_]+\.[a-z_]+\}/g, "");
  if (allowPause) bare = bare.replace(/\[pause\s+\d+\]/g, "");
  bare = bare.replace(/\b[HA]\d{1,2}\b/g, "");
  bare = bare.replace(/\bNo\.\s?\d{1,2}\b/g, ""); // a shirt number ("No. 14") is a name too
  if (/\d/.test(bare)) issues.push("a digit outside a slot");
  if (NUMBER_WORD.test(bare)) issues.push("a number word");
  return issues;
}

/** @param {unknown} value @param {string[]} [out] */
function stringsIn(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const inner of value) stringsIn(inner, out);
  else if (value && typeof value === "object") for (const inner of Object.values(value)) stringsIn(inner, out);
  return out;
}

/** @param {string} root @param {unknown} rel */
function repoFile(root, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
  const abs = path.resolve(root, rel);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
}

/** @param {string | undefined} voiceLang @param {string} lang */
function sameLang(voiceLang, lang) {
  if (!voiceLang) return false;
  if (voiceLang === lang) return true;
  return lang === "en" && voiceLang.toLowerCase().startsWith("en");
}

/** @param {number | undefined} n */
function trim(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}
