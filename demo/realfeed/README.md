# Real-footage overlay demo (`demo/realfeed`)

A separate, clearly labelled ~10 s segment for the demo video: the same kind of broadcast graphics
as the main product (pitch control, pass options, distance rings), computed by our own pipeline and
drawn onto **real amateur futsal footage** instead of our synthetic matches. It shows that the
graphics are not tied to the simulator.

The main product uses synthetic data only. This demo is decoupled from it: nothing in `sim/`,
`analytics/`, `explain/`, `agents/`, `api/` or `web/` depends on it. Removing it means deleting
`demo/realfeed/`, `tests/test_realfeed.py` and the `realfeed` dependency group in `pyproject.toml`.
No footage or rendered video is committed; both live in `out/realfeed/` (git-ignored).

## Source and attribution

savinkins, "Битва корпораций 2019-20. Атлант – Нова Пошта. Мини-футбол. Финал. 06.10.2019",
Wikimedia Commons, CC BY 3.0; modified (graphics overlaid, background blurred).
<https://commons.wikimedia.org/wiki/File:Битва_Корпораций_-_2019-10-06_-_Нова_Пошта._-_Мини-футбол._Финал..webm>

The attribution goes in this README and in the video description, not on screen (the title names
companies). The clip is 15:46.0–15:56.0 of the original. On screen there is only the caption
"Real amateur footage (CC BY 3.0). Graphics computed by our pipeline."

## Run

Needs the `ffmpeg` command line tool (decode VP9, encode H.264) and the default `uv sync`.

```bash
uv run python -m demo.realfeed.download            # 650 MB original, SHA-256 checked
uv run python -m demo.realfeed.build_calibration   # optional: rewrites calibration.json
uv run python -m demo.realfeed.pipeline            # camera track, detections, tracks, report
uv run python -m demo.realfeed.render              # out/realfeed/realfeed_overlay.mp4
```

The render writes `realfeed_overlay.mp4` (1920 × 1080, H.264, 50 fps, 10.7 s including a 1.2 s
freeze), `realfeed_keyframe.png` and `report.json` (all numbers below) to `out/realfeed/`.
`--preview 60,400` renders stills only.

## Method

OpenCV and numpy only. There is no learned detector anywhere (no YOLO, no face detector).

1. **Calibration** (`calibrate.py`, `build_calibration.py`, `calibration.json`). The first frame
   of the clip shows the edge of the centre circle, the whole penalty area, both goalposts and
   both touchlines. Two goalpost bases are clicked by hand. Every other marking is projected
   from a rough start and snapped onto the painted line along its normal: a top-hat on Lab
   "yellowness", with turf required on both sides so that boots and socks are rejected. The far
   touchline has no paint, so it is snapped to the edge where the turf meets the brick walkway.
   Levenberg–Marquardt then fits the image-from-pitch homography together with the pitch length,
   width and centre-circle radius, minimising image-space distances. The scale comes from the
   futsal penalty area (6 m quarter circles) and the 3 m goals.
2. **Camera tracking** (`camera.py`). Pyramidal Lucas–Kanade flow runs on turf and line pixels
   at half resolution. Each frame is registered against a keyframe, with the previous estimate
   as the initial flow, a forward–backward check and a RANSAC homography refined on the
   inliers. The chain only grows when the keyframe is replaced, so per-frame errors do not
   accumulate frame by frame.
3. **Players** (`players.py`, `pipeline.py`). Frames are warped into one stabilised plane (the
   first frame's image plane, a fixed homography away from the top-down view). A rolling
   temporal median gives a clean background plate. The plate is warped back into each frame;
   pixels that differ from it and are not turf-coloured are foreground. Orange is always added
   to the foreground, because a goalkeeper who stands still melts into the median plate.
   Connected components of a plausible player height become players, and blobs wider than one
   person are split at the valleys of their column profile. The lowest blob pixels give the foot
   point, which the homography maps onto the pitch. Teams come from two-cluster k-means on shirt
   hue (red shirts vs sky-blue bibs). A greedy nearest-neighbour tracker with a velocity
   prediction links detections, fragments are stitched across gaps of up to 1.2 s, and positions
   and velocities are smoothed.
4. **Graphics** (`overlay.py`, `render.py`). Pitch control comes from `analytics.pitch_control`,
   pass safety from `analytics.tti` (the lowest probability, along the pass line, that the ball
   beats every defender), rings sit under every tracked player, and 2 m and 4 m rings surround
   the ball carrier. Everything is rasterised in pitch coordinates and warped into the frame,
   then keyed onto turf-coloured pixels, so players, the ball and the painted lines stay on top.
5. **Masking** (`privacy.py`). The pitch outline (plus 0.35 m) is projected into each frame and
   everything outside it is downsampled, blurred and darkened. This covers the banners, the club
   crest, sponsor boards, spectators and buildings in one pass. Players standing on the pitch rise
   above the far touchline in the image, so their foreground silhouettes stay sharp. Their heads
   and the white prints on their shirts (the red kit carries a company logo) are pixelated.

## Measured (from `out/realfeed/report.json`)

| | |
|---|---|
| Calibration | 137 points, RMS reprojection error **2.1 px**. Fitted pitch **≈ 40.3 × 19.7 m**, centre-circle radius **3.00 m** with the radius left free (the futsal standard is 3 m, an independent check of the scale). Approximate. |
| Tracking drift, synthetic | under 1 px over 150 frames of known pan + zoom + keystone with moving distractors (`tests/test_realfeed.py`) |
| Tracking drift, real clip | estimated against the painted lines every second: 1.7–3.2 px for the first 7 s; 3.8–6.9 px during the final zoom (8–10 s), about 5 cm on the ground at the end |
| Players | about 80 % of visible players detected on spot-checked frames (28 of 34). Misses are mostly two players overlapping in the image and the goalkeeper diving. False positives are rare: a substitute standing on the far line, a goalpost in the final zoom. |
| Masking | high-frequency (Laplacian) energy outside the pitch and player silhouettes is at most **1.1 %** of the source's in any frame |
| Graphics on non-turf pixels | **0** pixels in every frame |

## Limits

- **No head orientation** can be read from this footage, so this segment shows no scans, vision
  cones or belief: only space and passing graphics. The perception features stay synthetic.
- **The ball is not detected.** The ball carrier (first touch at 15:54.0) is annotated by hand as
  his foot position in one frame, and the tracker supplies his track.
- **Pitch control only counts players in view.** Players outside the shot are not in the model.
- The goalkeeper's team is set by hand: blue attacks the goal he defends, so he plays for red.
- Pitch size is estimated from the markings. Along the near touchline, positions are
  extrapolated from features further away and may be off by up to about a metre (a touchline
  tick fits at 6.3 m from halfway, where futsal places substitution-zone marks at 5 m or 10 m).
- Re-fitting the camera to the lines every few frames was tried and rejected: on held-out frames
  it was no better than the tracker (the line detector's own noise is 2–4 px). The lines are
  used only to measure drift.
- The homography chain breaks across fast pans (tens of pixels after the pan at 16:10). That is
  why the clip is one continuous shot calibrated on its own first frame.

## Licences

`opencv-python-headless` is Apache-2.0 (its wheel bundles unmodified, dynamically linked LGPL
FFmpeg libraries, which we do not use for I/O). Decoding and H.264 encoding go through the
`ffmpeg` command-line tool, run as a separate program. The footage is CC BY 3.0 (above).
