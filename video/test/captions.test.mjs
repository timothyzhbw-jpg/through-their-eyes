// Burned-in captions: timing and the overlay graph.
import assert from "node:assert/strict";
import { test } from "node:test";
import { burnArgs, captionTimeline } from "../lib/captions.mjs";

test("a caption lasts its line plus a tail, at least the minimum, and stops before the next", () => {
  const cues = captionTimeline(
    [
      { id: "a", start: 1, duration: 0.4, text: "Short." },
      { id: "b", start: 3, duration: 2.5, text: "Longer line." },
      { id: "c", start: 5, duration: 1, text: "Next." },
    ],
    { tail: 0.25, min: 1, gap: 0.05, total: 5.6 },
  );
  assert.deepEqual(
    cues.map((c) => [c.id, c.start, c.dur]),
    [
      ["a", 1, 1],
      ["b", 3, 1.95],
      ["c", 5, 0.6],
    ],
  );
});

test("a caption squeezed under 0.3 s is left out", () => {
  const cues = captionTimeline([
    { id: "a", start: 1, duration: 2, text: "One." },
    { id: "b", start: 1.2, duration: 2, text: "Two." },
  ]);
  assert.deepEqual(cues.map((c) => c.id), ["b"]);
});

test("the burn graph lays each caption at its start and keeps the film's fps", () => {
  const args = burnArgs("joined.mp4", [{ file: "a.mov", start: 1.5 }, { file: "b.mov", start: 4 }], "out.mp4", { fps: 30 });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /\[1:v\]setpts=PTS\+1\.5\/TB/);
  assert.match(graph, /\[v0\]\[c1\]overlay=0:0:eof_action=pass/);
  assert.match(graph, /\[v1\]fps=30,format=yuv420p\[vout\]/);
  assert.equal(args.at(-1), "out.mp4");
});
