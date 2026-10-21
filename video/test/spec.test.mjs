// trailer.json validation. The mini fixture must pass; each broken kind must name itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spokenIssues, validateTrailer } from "../lib/spec.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shots = JSON.parse(readFileSync(path.join(REPO, "video/shots.json"), "utf8"));
const mini = JSON.parse(readFileSync(path.join(REPO, "video/test/fixtures/mini.json"), "utf8"));
const real = JSON.parse(readFileSync(path.join(REPO, "video/trailer.json"), "utf8"));

function check(spec, assets = []) {
  return validateTrailer(spec, {
    root: REPO,
    shotIds: new Set(shots.shots.map((shot) => shot.id)),
    assets,
    harvest: shots.harvest ?? [],
  });
}

function clone(spec = mini) {
  return structuredClone(spec);
}

test("the mini fixture and the real trailer spec are valid", () => {
  const miniResult = check(mini);
  assert.deepEqual(miniResult.errors, [], miniResult.errors.join("\n"));
  assert.deepEqual(miniResult.warnings, [], miniResult.warnings.join("\n"));
  const realResult = check(real, JSON.parse(readFileSync(path.join(REPO, "video/assets.json"), "utf8")));
  assert.deepEqual(realResult.errors, [], realResult.errors.join("\n"));
});

test("unknown cine id names the beat", () => {
  const spec = clone();
  spec.beats[3].id = "b04-pov";
  spec.beats[3].picture = { src: "cine", id: "pov2", in: 0 };
  const { errors } = check(spec);
  assert.ok(errors.includes('beats[3] (b04-pov): unknown cine id "pov2"'), errors.join("\n"));
});

test("a transition must be shorter than both beats it joins", () => {
  const spec = clone();
  spec.beats[0].out.dur = 3;
  const { errors } = check(spec);
  assert.ok(
    errors.includes(
      "beats[0] (b01-open): transition 3s is not shorter than both beats it joins (2s and 2s)",
    ),
    errors.join("\n"),
  );
});

test("the film must stay under two minutes", () => {
  const spec = clone();
  for (const beat of spec.beats) beat.dur = 20;
  const { errors } = check(spec);
  assert.ok(errors.includes("total duration 120s is not under 120s"), errors.join("\n"));
});

test("the last beat cuts", () => {
  const spec = clone();
  spec.beats[5].out = { type: "fade", dur: 0.2 };
  const { errors } = check(spec);
  assert.ok(
    errors.includes("beats[5] (b06-end): the last beat must cut, so the film stays the sum of the beat lengths"),
    errors.join("\n"),
  );
});

test("ids are unique and sorted", () => {
  const dup = clone();
  dup.beats[1].id = "b01-open";
  assert.ok(check(dup).errors.some((error) => error.includes('duplicate id "b01-open"')));
  const order = clone();
  order.beats[5].id = "b00-end";
  assert.ok(check(order).errors.some((error) => error.includes("ids are not sorted")));
});

test("digits and number words are rejected outside slots", () => {
  const digit = clone();
  digit.beats[0].vo[0].text = "Off by 3 {belief_error.err}.";
  assert.ok(check(digit).errors.some((error) => error.includes("a digit outside a slot")));
  const word = clone();
  word.beats[0].vo[0].text = "Off by one {belief_error.err}.";
  assert.ok(check(word).errors.some((error) => error.includes("a number word")));
  const slot = clone();
  slot.beats[0].vo[0].text = "Off by {belief-error.err}.";
  assert.ok(check(slot).errors.some((error) => error.includes("malformed slot")));
  const titled = clone();
  titled.titles.lower.params.text = "Off by twenty";
  assert.ok(check(titled).errors.some((error) => error.includes("a number word") && error.includes("titles.lower")));
});

test("player ids and pause markup are allowed in a voice-over line", () => {
  const spec = clone();
  spec.beats[0].vo[0].text = "H8 saw A10 off by {belief_error.err} [pause 400].";
  const { errors } = check(spec);
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("a fallback may not contain a slot", () => {
  const spec = clone();
  spec.beats[0].vo[0].fallback = "Off by {belief_error.err}.";
  assert.ok(check(spec).errors.some((error) => error.includes('vo "vo01" fallback contains a slot')));
  const title = clone();
  title.titles.lower.fallback.text = "Off by {belief_error.err}";
  assert.ok(check(title).errors.some((error) => error.includes("titles.lower: fallback contains a slot")));
});

test("music assets, shots, crops and image paths must resolve", () => {
  const music = clone();
  music.music = [
    { asset: "nope", at: 0, from: 0, until: 1, gain_db: 0, fade_in: 0, fade_out: 0, duck_db: 0 },
  ];
  assert.ok(check(music).errors.some((error) => error.includes('unknown asset "nope"')));
  const shot = clone();
  shot.beats[2].picture.shot = "missing-shot";
  assert.ok(check(shot).errors.some((error) => error.includes('unknown capture shot "missing-shot"')));
  const crop = clone();
  crop.beats[2].picture.crop = "wide";
  assert.ok(check(crop).errors.some((error) => error.includes('unknown crop "wide"')));
  const image = clone();
  image.beats[4].picture.path = "../secrets.png";
  assert.ok(check(image).errors.some((error) => error.includes("must stay inside the repo")));
  const sfx = clone();
  sfx.beats[0].sfx[0].name = "explosion";
  assert.ok(check(sfx).errors.some((error) => error.includes('unknown sfx "explosion"')));
});

test("an overlay that runs past the beat is a warning", () => {
  const spec = clone();
  spec.titles.lower.dur = 3;
  const { errors, warnings } = check(spec);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => warning.includes('overlay "lower" ends at') && warning.includes("after the beat")));
});

test("a planned voice-over that runs into the next line is a warning", () => {
  const spec = clone();
  spec.beats[0].vo[0].text = "He kept the story he told himself about the moment he saw.";
  spec.beats[0].vo[0].fallback = "He kept the story he told himself about the moment he saw.";
  spec.beats[1].vo = [{ id: "vo99", at: 0.1, text: "Then this." }];
  const { errors, warnings } = check(spec);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => warning.includes('vo "vo01"') && warning.includes("may not fit")));
});

test("spokenIssues treats number words as whole words", () => {
  const words = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "once",
    "twice", "half", "dozen", "percent",
  ];
  for (const word of words) {
    assert.ok(spokenIssues(`Say ${word} now`, { allowPause: false }).includes("a number word"), word);
    assert.ok(spokenIssues(`Say ${word.toUpperCase()} now`, { allowPause: false }).includes("a number word"), word);
  }
  assert.deepEqual(spokenIssues("An honest glance.", { allowPause: false }), []);
  assert.deepEqual(spokenIssues("H8 and A10.", { allowPause: true }), []);
  assert.ok(spokenIssues("H100 left.", { allowPause: true }).includes("a digit outside a slot"));
  assert.deepEqual(spokenIssues("Wait [pause 400] now.", { allowPause: true }), []);
  assert.ok(spokenIssues("Wait [pause 400] now.", { allowPause: false }).includes("a digit outside a slot"));
  assert.deepEqual(spokenIssues("Off by {belief_error.err}.", { allowPause: true }), []);
  assert.ok(spokenIssues("Off by {Belief.err}.", { allowPause: true }).some((issue) => issue.includes("malformed slot")));
});

test("a clip must stay inside the repo and may be absent at --check", () => {
  const spec = clone();
  spec.beats[3].picture = { src: "clip", path: "out/video/blender/not-rendered-yet.mp4", fit: "pad", reverse: true };
  assert.deepEqual(check(spec).errors, []);
  spec.beats[3].picture = { src: "clip", path: "../outside.mp4", fit: "zoom" };
  const { errors } = check(spec);
  assert.ok(errors.some((e) => e.includes('clip path "../outside.mp4" must stay inside the repo')), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("fit must be one of cover, pad")), errors.join("\n"));
});

test("a shirt number is a name, like a player id", () => {
  assert.deepEqual(spokenIssues("YOU ARE No. 14.", { allowPause: false }), []);
  assert.deepEqual(spokenIssues("H9 · THE RUNNER", { allowPause: false }), []);
  assert.deepEqual(spokenIssues("YOU ARE 14.", { allowPause: false }), ["a digit outside a slot"]);
});
