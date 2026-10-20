# Real-footage overlay demo (`demo/realfeed`)

A separate, clearly labelled segment of under 10 s for the demo video (the one exception to the
synthetic-data rule, approved by Bowen on 2026-10-19; conditions in `docs/SPEC.md` §7). It shows
the same kind of broadcast graphics as the main product (pitch control, pass options, distance rings), computed by our own pipeline and
drawn onto **real amateur futsal footage** instead of our synthetic matches. It shows that the
graphics are not tied to the simulator.

The main product uses synthetic data only. This demo is decoupled from it: nothing in `sim/`,
`analytics/`, `explain/`, `agents/`, `api/` or `web/` depends on it. Removing it means deleting
`demo/realfeed/`, `tests/test_realfeed.py` and the `realfeed` dependency group in `pyproject.toml`.
No footage or rendered video is committed; both live in `out/realfeed/` (git-ignored). Only the
camera calibration (pixel ↔ pitch correspondences of the markings) is committed. Nothing here is
used to train, tune or calibrate anything in the app.

## Source and attribution

savinkins, "Битва корпораций 2019-20. Атлант – Нова Пошта. Мини-футбол. Финал. 06.10.2019",
Wikimedia Commons, CC BY 3.0; modified (graphics overlaid, background blurred).
<https://commons.wikimedia.org/wiki/File:Битва_Корпораций_-_2019-10-06_-_Нова_Пошта._-_Мини-футбол._Финал..webm>

The clip is 15:46.0–15:56.0 of the original. The full attribution above goes in this README, the
repo README and the video description. On screen, for the whole segment: "Real footage, overlay
demo only; the app uses synthetic data" and "savinkins, Wikimedia Commons, CC BY 3.0; blurred and
overlaid by us".

The footage also carries **estimated numbers**, by Bowen's decision on 2026-10-19 (SPEC §7 still
says graphics only until he confirms the change there). Every number in the app is a verified
claim about the synthetic match; these are not, so each reads "~x" and the panel that carries the
pitch-control share says "Estimated from video, not verified". The numbers:
- the pitch-control share of each team over the pitch in view (top left);
- the chance that each pass option beats every defender (TTI model), next to the receiver;
- the distance from the ball carrier to the nearest opponent, along a dashed line;
- the speed of up to three running players, as tags at their feet;
- at the shot, the distance to the goal centre along a dashed shot line.

The clip freezes for 1.8 s on the shot (his foot meets the ball, 15:54.1), marked by a pause
sign. A "SHOT" panel then sums up the distance to goal, the nearest defender and the best pass
option.

## Run

Needs the `ffmpeg` command line tool (decode VP9, encode H.264) and the default `uv sync`, which
includes the `realfeed` dependency group. The app's container must not carry OpenCV: build it with
`uv sync --locked --no-default-groups` (main dependencies only; `uv export --no-default-groups`
lists no OpenCV), and a test keeps OpenCV out of the main dependencies.
Before the segment goes into the video, Bowen reviews the export frame by frame (kit logos, boards,
the crest), as SPEC §7 requires; the automated checks below do not replace that.

```bash
uv run python -m demo.realfeed.download            # 650 MB original, SHA-256 checked
uv run python -m demo.realfeed.build_calibration   # optional: rewrites calibration.json
uv run python -m demo.realfeed.pipeline            # camera track, detections, tracks, report
uv run python -m demo.realfeed.render              # out/realfeed/realfeed_overlay.mp4
```

The render writes `realfeed_overlay.mp4` (1920 × 1080, H.264, 50 fps, 9.98 s including the 1.8 s
freeze on the shot), `realfeed_keyframe.png` (the freeze) and
`report.json` (all numbers below) to `out/realfeed/`. `--preview 60,400` renders stills only.
`uv run python -m demo.realfeed.check` then checks every exported frame against its source:
off-pitch legibility, every board and crest, the label and attribution (and the faces when
`BLUR_FACES` is on). Source | export crops of each board and crest go to `out/realfeed/legibility/`.

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
   everything outside it is blurred (downsampled ×10, slightly desaturated and darkened), like a
   shallow depth of field. This covers the banners, the club crest, sponsor boards, spectators and
   buildings in one pass while the ground still reads as a football pitch. Three things stay
   sharp:
   - the players standing on the pitch, who rise above the far touchline in the image (their
     foreground silhouettes, feathered by 4 px);
   - the goal frame: a camera recovered from the homography places the goal volume in the frame,
     and inside it only long straight white runs are kept (posts, crossbar, the frame of the net,
     found with a Hough transform), so the crest painted on the wall behind the net stays blurred;
   - faces, which are not blurred. Bowen decided this on 2026-10-19; CLAUDE.md rule 2 and SPEC
     §7 still ask for blurred faces until he confirms the change there. `render.BLUR_FACES`
     turns a soft face blur back on, and `check.py` then verifies it.

   The red kit carries a company logo on the chest and white numbers on the back. Their white is
   warm, the same hue as skin, so position decides: every light pixel in the chest box of a
   red-kit player (rows 15–50 % of the height, the middle 70 %) is inpainted from the shirt
   around it, and so is any light blob mostly bordered by red shirt (for players the detector
   missed). The ball and white socks are bordered by turf, so they are left alone.

## Measured (from `out/realfeed/report.json`)

| | |
|---|---|
| Calibration | 137 points, RMS reprojection error **2.1 px**. Fitted pitch **≈ 40.3 × 19.7 m**, centre-circle radius **3.00 m** with the radius left free (the futsal standard is 3 m, an independent check of the scale). Approximate. |
| Tracking drift, synthetic | under 1 px over 150 frames of known pan + zoom + keystone with moving distractors (`tests/test_realfeed.py`) |
| Tracking drift, real clip | estimated against the painted lines every second: 1.7–3.2 px for the first 7 s; 3.8–6.9 px during the final zoom (8–10 s), about 5 cm on the ground at the end |
| Players | about 80 % of visible players detected on spot-checked frames (28 of 34). Misses are mostly two players overlapping in the image and the goalkeeper diving. False positives are rare: a substitute standing on the far line, a goalpost in the final zoom. |
| Off-pitch legibility (`check.py`) | Share of the source's detail that survives off the pitch, measured as the export regressed on the source in every frame. Single-pixel detail: at most **0.05 %** (threshold 5 %). Letter-stroke scale, band-pass 1.5–4.5 px: at most **0.37 %** (threshold 10 %). H.264 noise is not correlated with the source, so it does not count. |
| Boards and crests (`check.py`) | Letter-stroke detail kept inside each region tracked from the first frame, maximum over all frames (threshold 10 %): the three VETEK sponsor boards 0.4–1.1 %, the "ФК «МЕТАЛЛИСТ»" board 1.0 %, the V-logo board 1.0 %, the crests on the fence 1.1 % and 4.8 %, the crests on the dugout walls 3.0 % and 2.0 % (the number tags sometimes pass over a region) |
| Kit | Red kit: the chest logo and white back numbers are erased in the frames checked by eye (120, 250, 380, 430, 470, 495; Bowen's frame-by-frame review covers the rest). The small dark print under the back number is a few pixels wide and illegible. Sky-blue bibs and black shorts: numbers only, plus a maker's mark under 10 px. The orange goalkeeper's shirt is plain. |
| Label and attribution | visible in **499 of 499** exported frames |
| Graphics on non-turf pixels | **0** pixels in every frame |

## Limits

- **No head orientation** can be read from this footage, so this segment shows no scans, vision
  cones or belief: only space and passing graphics. The perception features stay synthetic.
- **The numbers are estimates.** Positions carry the calibration and tracking errors above
  (roughly 0.3–1 m), so distances read to a tenth of a metre are about ±0.5 m. Speeds come from
  0.5 s of smoothing; they are shown only near real detections, with a plausible acceleration,
  between 13 and 28 km/h (off below 10 km/h), and are about ±2 km/h. The pass and pitch-control
  percentages are model outputs (TTI, pitch control) on those positions. Pitch control counts
  only the players in view.
- **The ball is not detected.** The moments of the first touch (15:54.0) and the shot (15:54.1)
  are read off the footage by eye. The carrier is then picked by rule (the blue player nearest
  the centre spot at the first touch), so no player position is committed. The shot line points
  at the goal centre, not along the ball's path.
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

`opencv-python-headless` (4.x) is Apache-2.0. Its wheel bundles unmodified, dynamically linked LGPL
FFmpeg libraries, which we do not use for I/O. It is pinned below 5 because the segment was rendered
and checked with 4.14, and 5.x changes text rendering. Decoding and H.264 encoding go through the
`ffmpeg` command-line tool, run as a separate program. The footage is CC BY 3.0 (above).
