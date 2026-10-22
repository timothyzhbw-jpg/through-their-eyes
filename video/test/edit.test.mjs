// The edit as ffmpeg argument lists. Substrings, not whole graphs: the graph may grow.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  beatCommand,
  beatGraph,
  contactSheetHtml,
  duckFilter,
  joinFilter,
  loudnormFilter,
  measureArgs,
  mixGraph,
  muxArgs,
  timelineOf,
} from "../lib/edit.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mini = JSON.parse(readFileSync(path.join(REPO, "video/test/fixtures/mini.json"), "utf8"));

const size = { fps: 30, width: 1920, height: 1080 };

function beat(over) {
  return { id: "b", dur: 2, picture: { src: "black" }, out: { type: "cut" }, ...over };
}

test("cut then fade: the incoming beat starts at the sum of the earlier lengths", () => {
  const beats = [
    { id: "a", dur: 3, picture: { src: "black" }, out: { type: "cut" } },
    { id: "b", dur: 4, picture: { src: "black" }, out: { type: "fade", dur: 0.5 } },
    { id: "c", dur: 2, picture: { src: "black" }, out: { type: "cut" } },
  ];
  const timeline = timelineOf(beats);
  assert.deepEqual(timeline.beats.map((row) => row.start), [0, 3, 7]);
  assert.deepEqual(timeline.beats.map((row) => row.length), [3, 4.5, 2]);
  assert.equal(timeline.duration, 9);
  assert.equal(timeline.joins[0].op, "concat");
  assert.equal(timeline.joins[1].offset, 7);
  assert.equal(timeline.joins[1].xfade, "fade");
  const joined = joinFilter(beats);
  assert.match(joined.filter, /concat=n=2:v=1:a=0/);
  assert.match(joined.filter, /xfade=transition=fade:duration=0\.5:offset=7/);
  assert.equal(joined.duration, 9);
});

test("the mini spec's transitions overlap on the nominal starts", () => {
  const timeline = timelineOf(mini.beats);
  assert.deepEqual(timeline.beats.map((row) => row.start), [0, 2, 4, 6, 8, 10]);
  assert.equal(timeline.duration, 12);
  assert.deepEqual(
    timeline.joins.map((join) => join.offset),
    [2, 4, 6, 8, 10],
  );
  const joined = joinFilter(mini.beats);
  assert.match(joined.filter, /xfade=transition=fade:duration=0\.25:offset=2/);
  assert.match(joined.filter, /xfade=transition=fadewhite:duration=0\.2:offset=4/);
  assert.match(joined.filter, /xfade=transition=fadeblack:duration=0\.25:offset=6/);
  assert.match(joined.filter, /xfade=transition=smoothleft:duration=0\.3:offset=8/);
  assert.match(joined.filter, /xfade=transition=pixelize:duration=0\.25:offset=10/);
});

test("each picture kind contributes its filters", () => {
  const black = beatGraph(beat({}));
  assert.match(black.filter, /color=c=black:s=1920x1080:r=30/);
  assert.equal(black.inputs.length, 0);

  const cine = beatGraph(
    beat({ dur: 3, picture: { src: "cine", id: "intro", in: 0 } }),
    { ...size, file: "cine/intro.mp4", sourceDuration: 1 },
  );
  assert.match(cine.filter, /trim=start=0:duration=1/);
  assert.match(cine.filter, /tpad=stop_mode=clone:stop_duration=3,trim=duration=3,/);

  const capture = beatGraph(
    beat({
      picture: { src: "capture", shot: "03-breakdown", in: 2, crop: [100, 50, 640, 360], speed: 2 },
    }),
    { ...size, file: "03-breakdown.webm", sourceDuration: 20 },
  );
  assert.match(capture.filter, /trim=start=2/);
  assert.match(capture.filter, /setpts=\(PTS-STARTPTS\)\/2/);
  assert.match(capture.filter, /crop=640:360:100:50/);
  assert.match(capture.filter, /scale=1920:1080:force_original_aspect_ratio=increase/);

  const pushed = beatGraph(
    beat({ picture: { src: "capture", shot: "03-breakdown", in: 0, push: [1, 1.06] } }),
    { ...size, file: "03-breakdown.webm", sourceDuration: 20 },
  );
  assert.match(pushed.filter, /scale=3840:2160:force_original_aspect_ratio=increase/);
  assert.match(pushed.filter, /eval=frame/);
  assert.match(pushed.filter, /1\+\(1\.06-1\)\*min\(1,t\/2\)/);

  const title = beatGraph(beat({ picture: { src: "title", id: "card" } }), { ...size, file: "titles/card.mp4" });
  assert.match(title.filter, /trim=duration=2/);
  assert.match(title.filter, /scale=1920:1080:force_original_aspect_ratio=increase/);

  const image = beatGraph(
    beat({ picture: { src: "image", path: "docs/architecture.png", push: [1, 1.04] } }),
    { ...size, file: "docs/architecture.png" },
  );
  assert.deepEqual(image.inputs[0].slice(0, 4), ["-loop", "1", "-framerate", "30"]);
  assert.match(image.filter, /eval=frame/);
});

test("freeze holds the frame and punches in for four frames", () => {
  const graph = beatGraph(
    beat({
      dur: 2,
      picture: { src: "cine", id: "intro", in: 0 },
      freeze: { at: 1.2, punch: 1.04 },
      out: { type: "dip", dur: 0.25 },
    }),
    { ...size, file: "cine/intro.mp4", sourceDuration: 8 },
  );
  assert.match(graph.filter, /trim=start=0:duration=1\.2/);
  assert.match(graph.filter, /trim=start=0:duration=1\.2,.*tpad=stop_mode=clone:stop_duration=2\.25,trim=duration=2\.25,/);
  assert.match(graph.filter, /sin\(PI\*min\(1,max\(0,\(n-36\)\/4\)\)\)/);
  assert.equal(graph.duration, 2.25);
});

test("grades, effects, letterbox and overlays are present", () => {
  const grades = {
    night: "eq=contrast=1.15:brightness=-0.06:saturation=0.85",
    cool: "colorbalance=bs=0.08:bm=0.03:rs=-0.04",
    warm: "colorbalance=rs=0.1:gs=0.03:bs=-0.08",
    bleach: "eq=saturation=0.35:contrast=1.25",
    mono: "hue=s=0",
    danger: "eq=contrast=1.2:saturation=1.15,colorbalance=rs=0.18",
  };
  for (const [name, fragment] of Object.entries(grades)) {
    assert.match(beatGraph(beat({ grade: name })).filter, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const fx = {
    grain: "noise=alls=8:allf=t+u",
    vignette: "vignette=PI/5",
    chroma: "rgbashift=rh=4:bh=-4",
    rewind: "rgbashift=rh=8:bh=-8",
    shake: "sin(n*0.7)",
    "flash-in": "fade=t=in:st=0:d=0.133:c=white",
  };
  for (const [name, fragment] of Object.entries(fx)) {
    const filter = beatGraph(beat({ fx: [name] })).filter;
    assert.ok(filter.includes(fragment), `${name}: ${filter}`);
  }
  const rewind = beatGraph(beat({ fx: ["rewind"] })).filter;
  assert.match(rewind, /boxblur=8:1/);
  assert.match(rewind, /drawgrid=width=iw:height=6/);
  const shake = beatGraph(beat({ fx: ["shake"] })).filter;
  assert.match(shake, /scale=1997:1123/);

  const boxed = beatGraph(beat({ letterbox: 2.39 })).filter;
  assert.match(boxed, /drawbox=x=0:y=0:w=iw:h=138:color=black:t=fill/);

  const over = beatGraph(beat({}), {
    ...size,
    overlays: [{ file: "titles/lower.mov", at: 0.4 }],
  });
  assert.match(over.filter, /setpts=PTS\+0\.4\/TB/);
  assert.match(over.filter, /overlay=0:0:eof_action=pass:format=auto/);
  assert.deepEqual(over.inputs[0], ["-i", "titles/lower.mov"]);
});

test("a beat intermediate is silent H.264 at the spec's frame size", () => {
  const command = beatCommand(beat({}), size, "beats/b.mp4");
  const args = command.args.join(" ");
  assert.match(args, /-crf 12/);
  assert.match(args, /-preset medium/);
  assert.match(args, /-pix_fmt yuv420p/);
  assert.match(args, /-an /);
  assert.equal(command.args.at(-1), "beats/b.mp4");
});

test("voice, effects and music land on their delays, and the music ducks", () => {
  const graph = mixGraph({
    videoDuration: 10,
    voiceFx: "trailer",
    vo: [{ start: 3.3 }],
    sfx: [{ start: 1.5, gainDb: -6 }],
    music: [{ at: 2, from: 12, until: 8, gainDb: -3, fadeIn: 0.05, fadeOut: 1, duckDb: -9 }],
  });
  const filter = graph.filter;
  assert.match(filter, /adelay=3300\|3300/);
  assert.match(filter, /adelay=1500\|1500/);
  assert.match(filter, /volume=-6dB/);
  assert.match(filter, /volume=-3dB/);
  assert.match(filter, /atrim=start=12/);
  assert.match(filter, /adelay=2000\|2000/);
  assert.match(filter, /sidechaincompress/);
  assert.match(filter, /attack=20/);
  assert.match(filter, /release=350/);
  assert.match(filter, /amix=inputs=3:normalize=0/);
  assert.match(filter, /alimiter=limit=0\.891251/);
  assert.match(filter, /asetrate=46080/);
  assert.match(filter, /highpass=f=70/);
  assert.equal(graph.inputs, 3);
  assert.match(duckFilter(-9), /ratio=2\.000/);
});

test("loudnorm is two passes and the mux is the delivery encode", () => {
  assert.equal(
    loudnormFilter({ lufs: -14, true_peak: -1.5 }),
    "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
  );
  const second = loudnormFilter(
    { lufs: -14, true_peak: -1.5 },
    { input_i: "-20.1", input_lra: "8.0", input_tp: "-2.0", input_thresh: "-30.0", target_offset: "0.5" },
  );
  assert.match(second, /measured_I=-20\.1/);
  assert.match(second, /linear=true/);
  assert.match(second, /aresample=192000,alimiter=limit=0\.7943.*,aresample=48000$/); // oversampled, half a dB under -1.5 dBTP
  const mux = muxArgs("joined.mp4", "mix.wav", "out/video/trailer.mp4", size).join(" ");
  assert.match(mux, /-profile:v high/);
  assert.match(mux, /-crf 18/);
  assert.match(mux, /-preset slow/);
  assert.match(mux, /-movflags \+faststart/);
  assert.match(mux, /-b:a 320k/);
  assert.match(mux, /-ar 48000/);
  assert.match(mux, /-s 1920x1080/);
  assert.deepEqual(measureArgs("out/video/trailer.mp4").slice(2, 6), [
    "out/video/trailer.mp4",
    "-af",
    "ebur128=peak=true",
    "-f",
  ]);
});

test("the contact sheet is four columns and labels each tile", () => {
  const html = contactSheetHtml(
    [
      { id: "b01-open", start: "0:00.00", picture: "black", image: "b01-open.jpg", vo: "Before <the> ball" },
      { id: "b02-cine", start: "0:02.00", picture: "cine:intro", image: "b02-cine.jpg" },
    ],
    { title: "Trailer" },
  );
  assert.match(html, /grid-template-columns: repeat\(4, 1fr\)/);
  assert.match(html, /<b>b01-open<\/b> <span>0:00\.00<\/span>/);
  assert.match(html, /<img src="b02-cine\.jpg">/);
  assert.match(html, /Before &lt;the&gt; ball/);
  assert.doesNotMatch(html, /drawtext/);
});

test("every ffmpeg run is capped to a few threads", async () => {
  const { limitThreads } = await import("../lib/ffmpeg.mjs");
  const capped = limitThreads(["-y", "-i", "in.mp4", "-c:v", "libx264", "out.mp4"]);
  assert.deepEqual(capped.slice(0, 2), ["-filter_complex_threads", "4"]);
  assert.deepEqual(capped.slice(-3), ["-threads", "4", "out.mp4"]);
  const kept = ["-i", "a", "-threads", "2", "b"];
  assert.equal(limitThreads(kept), kept);
  const probe = ["-hide_banner", "-i", "clip.mp4"];
  assert.equal(limitThreads(probe), probe);
});

test("a clip plays from its in-point, reversed on request, padded to the frame as rendered", () => {
  const clip = beatGraph(
    beat({
      dur: 1.2,
      picture: { src: "clip", path: "out/video/blender/bl01_look.mp4", in: 2.5, reverse: true, fit: "pad" },
      fx: ["glue"],
    }),
    { ...size, file: "out/video/blender/bl01_look.mp4", sourceDuration: 4.23 },
  ).filter;
  assert.match(clip, /trim=start=2\.5:duration=1\.2/);
  assert.match(clip, /setpts=PTS-STARTPTS,reverse/);
  assert.match(clip, /scale=1920:-2,pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black/);
  assert.doesNotMatch(clip, /force_original_aspect_ratio=increase/); // never cropped to cover
  assert.match(clip, /vignette=angle=PI\/7,colorlevels=romin=0\.020/);
});
