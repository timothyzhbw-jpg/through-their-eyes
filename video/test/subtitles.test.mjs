// YouTube captions (tools/captions.mjs): SRT timing order, line limits, every spoken line once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CHARS, MAX_LINES, buildCues, spokenLines, toSrt, toVtt } from "../tools/captions.mjs";

const spec = {
  beats: [
    {
      id: "a",
      dur: 6,
      vo: [
        { id: "one", at: 0.5, text: "He looked over his shoulder twice, [pause 400] and then he saw the gap behind the line." },
        { id: "two", at: 4, text: "{x.n} passes." , fallback: "A few passes." },
      ],
    },
    { id: "title", dur: 3, vo: [] },
    { id: "b", dur: 5, vo: [{ id: "three", at: 1, text: "Short." }, { id: "gone", at: 2, text: "{x.missing} cut." }] },
  ],
};
const lines = spokenLines(spec, {}, null);
const cues = buildCues(lines, () => 3, 14);

test("a line with no claim and no fallback is not spoken, and so not captioned", () => {
  assert.deepEqual(lines.map((l) => l.id), ["one", "two", "three"]);
  assert.ok(!cues.some((c) => c.id === "gone"));
});

test("cue starts follow the beat timeline", () => {
  const start = (id) => cues.find((c) => c.id === id).start;
  assert.equal(start("one"), 0.5);
  assert.equal(start("two"), 4);
  assert.equal(start("three"), 10); // beat b starts at 9
});

test("cues are in time order, do not overlap, and stay inside the film", () => {
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].end > cues[i].start);
    assert.ok(cues[i].end <= 14);
    if (i) assert.ok(cues[i].start >= cues[i - 1].end);
  }
  const srt = toSrt(cues);
  const times = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)].map((m) => [
    (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4],
    (+m[5] * 3600 + +m[6] * 60 + +m[7]) * 1000 + +m[8],
  ]);
  assert.equal(times.length, cues.length);
  times.forEach(([a, b], i) => {
    assert.ok(b > a);
    if (i) assert.ok(a >= times[i - 1][1]);
  });
  assert.match(srt, /^1\n00:00:00,500 --> /);
  assert.ok(toVtt(cues).startsWith("WEBVTT\n\n00:00:00.500 --> "));
});

test("a cue has at most 2 lines of 42 characters, and no text is lost", () => {
  const long = { id: "long", start: 0, text: "x ".repeat(5) + "the keeper came off his line, and the striker, who had scanned twice already, chipped him; the crowd rose." };
  const out = buildCues([long], () => 8);
  assert.ok(out.length > 1);
  for (const cue of out) {
    assert.ok(cue.lines.length <= MAX_LINES);
    for (const line of cue.lines) assert.ok(line.length <= MAX_CHARS, line);
  }
  assert.equal(out.flatMap((c) => c.lines).join(" ").replace(/\s+/g, " "), long.text);
});

test("every spoken line appears exactly once, in order", () => {
  for (const l of lines) {
    const mine = cues.filter((c) => c.id === l.id);
    assert.ok(mine.length >= 1);
    assert.equal(mine.flatMap((c) => c.lines).join(" ").replace(/\s+/g, " "), l.text);
  }
  assert.equal(new Set(cues.map((c) => c.id)).size, lines.length);
});

test("numbers come from the claim table, as the render fills them", () => {
  const claims = { x: { usable: true, values: { n: "7" }, seen: [] } };
  const filled = spokenLines(spec, claims, null);
  assert.equal(filled.find((l) => l.id === "two").text, "7 passes.");
  assert.equal(lines.find((l) => l.id === "two").text, "A few passes."); // no claim: the fallback
});

test("Chinese lines split at clause marks into 42-character lines", () => {
  const text = "他在球到之前回头看了两次，看见了身后的空当，然后把球传给了跑出来的队友，队友一脚射门得分，全场沸腾。";
  const out = buildCues([{ id: "zh", start: 0, text }], () => 6);
  for (const cue of out) for (const line of cue.lines) assert.ok(line.length <= MAX_CHARS);
  assert.equal(out.flatMap((c) => c.lines).join(""), text);
});
