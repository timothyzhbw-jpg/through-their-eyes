# video/ — the demo video (SPEC 10)

The < 2:00 submission video is a game-trailer edit made entirely by code, from two specs:
[`trailer.json`](trailer.json) (the edit: beats, titles, voice-over, music, sound) and
[`shots.json`](shots.json) (the app shots the edit cuts in). One command renders the film:

```bash
cd video && npm ci && npx playwright install chromium    # once
npm run trailer                                           # out/video/trailer.mp4
```

It records the app shots from the live site with [`capture.mjs`](capture.mjs), films the cold
open in the web app's cinematic mode (`?cine=1`, [`web/src/cine/`](../web/src/cine/)), renders
the title cards ([`titles/`](titles/README.md)), synthesizes the voice-over with Azure AI Speech
and the sound effects in code, and cuts it all with ffmpeg ("Trailer edit" below). Credits and
licences: [`CREDITS.md`](CREDITS.md). Output goes to `out/video/`, which git ignores.

The rest of this file is the capture kit first, then the edit.

## Run it

Node 22 or later. Once:

```bash
cd video
npm ci
npx playwright install chromium   # Chromium, plus the ffmpeg that Playwright uses to encode
```

Then each time:

```bash
npm run capture                     # every shot from the live site (a few minutes on a GPU)
npm run capture -- --only 04        # one shot (ids or prefixes, comma-separated)
npm run capture -- --headed         # visible browser
npm run capture -- --list           # the planned timeline, without a browser
```

| Option | Default | |
|---|---|---|
| `--only <ids>` | all | shot ids or prefixes, comma-separated |
| `--base-url <url>` | the site in `shots.json` | record another deployment, e.g. a local stack; paths and queries stay |
| `--out <dir>` | `out/video` | output directory |
| `--fps <n>` | 60 | frame rate of the WebM files, 30–60 |
| `--quality <n>` | 90 | JPEG quality of the captured frames |
| `--headed` | off | show the browser |
| `--software-gl` | off | draw WebGL with SwiftShader (the CPU) instead of the GPU |
| `--chromium <path>` | Playwright's | another Chromium build |
| `--ffmpeg <path>` | Playwright's | another ffmpeg |
| `--no-harvest` | off | don't read the verified claims; the voice-over uses its fallbacks |

### What you get in `out/video/`

| File | Content |
|---|---|
| `NN-name.webm` | one clip per shot: 1920×1080, constant 60 fps, VP8, no audio |
| `stills/NN-name.jpg` | the frame marked `"still": true` in the shot, else the last one; `_FAILED.jpg` is the page when a shot failed |
| `contact_sheet.jpg`, `.html` | one tile per shot: still, status, length, captured fps, badges, warnings, voice-over |
| `voiceover.md` | the voice-over per shot, numbers filled in from the page, and each clip's cue times |
| `claims.json` | the claims read off the page: every narration line opened, its evidence card read |
| `manifest.json` | per shot: URL, length, captured fps, action times, badges, crop boxes |

The run exits non-zero when a shot fails; the other shots are still written.

## How a shot is recorded

Each shot gets a fresh browser context (1920×1080, device scale 1) and loads its URL. Its
`setup` runs off camera (load, ask for the breakdown, seek); then recording starts and its
`actions` play out. `hold` is screen time after an action. Every wait is on the app's own DOM or
on network idle, never a sleep:

| `wait` | Holds until |
|---|---|
| `assets` | the match is loaded, both views have a canvas, network idle, fonts ready, the player model fetched |
| `live` | the header says "streaming from the API" |
| `moment` | the stream has detected the hero moment (Moments panel) |
| `breakdown` | the breakdown for `persona` / `language` is on screen; fails if the app says the service gave none |
| `breakdown-running`, `breakdown-done` | the Breakdown panel's button reads Stop / Replay breakdown |
| `caption`, `caption-with-evidence` | a caption is over the first-person view (one with claims behind it) |
| `evidence` | the evidence card is open |
| `whatif-answer` | a what-if answer or refusal is shown (with `question`: the answer to that question) |
| `selector` | any element by CSS selector (`selector`), visible, or gone with `state: "detached"` |

Other actions: `click` (`role` + `name`, or `selector`; `within` scopes it), `select` (`label`,
`value`), `fill` (`label`, `text`; typed key by key so it shows), `scroll` (`to` a selector, or
`y` in pixels), `hold` (`s`), `drag` (the mouse from the centre of `from` to the centre of `to`,
each a `click`-style target, over `duration_s`; with `around` a selector, on an arc round that
element, `radius_scale` < 1 keeping inside the targets' ring — Take his eyes' dial). The URLs use
the app's own parameters: `?autoplay=0` (start nothing on load, so each shot starts from a known
state), `?offline=1`, `?plan=invalid`, `?rigged=0`, and the deep links of `web/src/deeplink.ts`
(`persona`, `lang`, `tamper`, `match`, `camera`, `play`, `at`). The claim harvest reads each value
by its machine name (the evidence card's `dt` title, e.g. `dxt`), which is what a slot names.

Frames come from the browser's screencast, each with the time it was drawn. After the shot they
are written at a constant 60 fps (each output frame shows the latest frame drawn by then), so
encoding never slows the capture. **Captured fps** in the manifest and on the contact sheet is how
many distinct frames the browser drew per second. WebGL runs on the GPU (ANGLE on Metal on
macOS): headless Chromium otherwise falls back to SwiftShader, its CPU rasteriser, at about a
dozen fps. A page that does not move (a panel of text) draws few frames by design; below 30 on a
moving 3D view, close heavy apps.

### Shot status

| Status | Meaning |
|---|---|
| `ready` | recorded |
| `stand-in` | the beat needs a feature that is not on main; something close is recorded instead (`pending` says what) |
| `pending feature` | not recorded until the feature exists |
| `external` | not from the app (the architecture slide) |

On 2026-10-20: `02-live-stream` is a stand-in (no broadcast camera yet), `09-verifier` is pending
(no view shows the verifier blocking a line), `11-architecture` is external.

### Things to check on the contact sheet

- **Badges.** Cached / Generated, Model / Template, Rate-limited, Daily cap reached. The API
  allows 3 new breakdowns per address every 10 minutes by default (`TTE_RATE_LIMIT`), so a first run can get the template
  for a persona nobody asked for yet. Re-run that shot later (`--only 05`): the model's answer is
  then cached.
- **Offline data** in a warning means the site did not reach its API and played its bundled
  files: that footage has no verified narration; don't use it.

## Editing notes

- `manifest.json` → `crop` gives the first-person view, the tactical board and the stage in
  pixels, for cropping in the editor (`crop` in the shot names the one meant).
- `voiceover.md` lists each clip's cue times (when each action started), so waits for a new
  breakdown or a what-if answer are easy to cut.

## Voice-over: swap in your own

The clips are picture only. `voiceover.md` is the script, shot by shot, with its planned times.

1. Record your voice to the script (any recorder; WAV, 48 kHz), one take per shot or one long take.
2. Lay it over the clips in the editor, using the cue times to line it up.
3. To change the words, edit `vo` (and `vo_fallback`) in `shots.json` and re-run, or edit the
   script by hand under the rule below.

**Numbers.** The voice-over may only say numbers the app itself shows as verified claims. In
`shots.json` a number is never typed: it is a slot such as `{belief_error.err}` (claim id and
value name, as in `claims.json`), filled from the evidence cards of the page at capture time,
only from claims marked supported in a breakdown that is not a fixture. When the page does not
show that claim, the sentence falls back to `vo_fallback`, which has no number. `uv run pytest
tests/test_video_shots.py` fails on a digit or a number word anywhere else in the voice-over
(player ids such as H9 are allowed). Eval numbers on the closing slide come from
`eval/reports/`, each with its file named on the slide.

The app's own two voices (Azure AI Speech, **Sound on**) are not recorded: the screencast has no
audio track.

## Checks

```bash
uv run pytest tests/test_video_shots.py   # repo root
node video/capture.mjs --list             # the planned timeline, no browser
```

[`tests/test_video_shots.py`](../tests/test_video_shots.py) fails when the shot list does not
parse or runs past two minutes, when a URL leaves the project's own site (the web app URL in the
root README), when an action is not in `capture.mjs`'s vocabulary, or when the voice-over has a
number outside a claim slot. CI runs both: the test in the `python` job, `--list` in the `web`
job. Together they keep the footage to the app's own synthetic match and the voice-over to its
verified numbers.

## Rights

- **Synthetic only.** Everything this kit records is the app: a simulated match, fictional clubs
  and players. Add no Premier League or club logos, real player names or broadcaster branding in
  the edit either (titles, lower thirds, end card).
- **Music, sound, fonts and voice** are listed in [`CREDITS.md`](CREDITS.md): CC0 music only,
  sound effects synthesized here, OFL fonts. `npm run trailer -- --check` (and CI) rejects an
  asset that is not CC0 or public domain, or not in `CREDITS.md`.

## Dependency

| Package | Licence | Why |
|---|---|---|
| playwright 1.63.0 (dev) | Apache-2.0 | drives Chromium; its screencast gives the frames with their draw times |

`npx playwright install chromium` also downloads Playwright's ffmpeg build (LGPL-2.1), which
`capture.mjs` runs as a separate program to write the WebM files. Nothing of it is in the repo or
the app; `--ffmpeg` points at another ffmpeg instead.

## Trailer edit

`trailer.mjs` turns [`trailer.json`](trailer.json) into the < 2:00 film. From `video/`:

```bash
npm run trailer                         # every step
npm run trailer -- --check              # validate and print the timeline; no browser, network or ffmpeg
npm run trailer -- --list               # the timeline only
npm run trailer -- --step edit --only b03-capture
```

From the repo root the same command is `node video/trailer.mjs`. `--spec <path>` points at another
spec (the default is `video/trailer.json`). [`test/fixtures/mini.json`](test/fixtures/mini.json) is
a small valid spec: six beats, so that every picture kind and every transition can appear.

**The treatment** (`trailer.json`, 1:51; the beat-by-beat table is in
[docs/VIDEO_SCRIPT.md](../docs/VIDEO_SCRIPT.md)): the problem over two Blender shots of the
hero's one look and the pass it finds; "See what they saw"; the replay in his eyes, a freeze on a verified number, the
With / Without toggle and the run without the look; Take his eyes and Your call; the pressure
hero; the agent crew as a line-up, every line checked, a wrong number refuted, the failure drill
as a red card and its bring-back as a substitution; one moment per audience and in Chinese, the
live match, the recap and who it is for; the stack; the end card. Every shot from cinematic mode
carries the corner label "IN-ENGINE · RENDERED FROM OUR SIMULATION DATA", every Blender shot
"RENDERED IN BLENDER FROM OUR SIMULATION DATA".

**Cinematic mode.** The `cine` step opens `<site>/?cine=1…` and drives `window.__cine` frame by
frame, so the site it films must have that mode deployed. Before that, or to try a shot, run the
web app locally and pass `--base-url http://localhost:5173` (shots on `match=` need the API too).

**Environment.** The voice-over needs `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`. From a
checkout with `.env` at its root nothing else is needed; from a worktree without one, run
`uv run --env-file <path to .env> node video/trailer.mjs`. ffmpeg must be the full build with
libx264 (`brew install ffmpeg`); the edit uses no `drawtext`, so builds without freetype work.

Each step skips its work when the output is already there and a hash of its inputs, stored beside
it as `<file>.hash`, has not changed. `--force` ignores the hashes.

| Step | Does | Output |
|---|---|---|
| `assets` | download each entry of `assets.json` and check its sha256 | `<out>/assets/<id>.<ext>` |
| `capture` | record the capture shots the beats use, via `capture.mjs`, unless the WebM is already in `out/video/` | the capture kit's own files in `out/video/` |
| `cine` | render each cine shot in one Chromium | `<out>/cine/<id>.mp4` |
| `pin` | corner-pin a cine shot (`source.cine`) or a capture of the app (`source.capture`) onto a screen in a rendered clip (`pins`: the coach's tablet), with `video/pin.py` (numpy): per frame the screen's corners and matte, mapped so the last frame equals that picture full frame | `<out>/pins/<id>.mp4` |
| `titles` | fill slots, then render each title card | `<out>/titles/<id>.mov` (alpha) or `.mp4` |
| `vo` | build SSML and synthesize the lines whose SSML changed | `<out>/vo/<id>.wav` and `.ssml` |
| `sfx` | synthesize each effect the beats name | `<out>/sfx/<name>.wav` |
| `edit` | one silent intermediate per beat, then join, burn in the captions, mix, normalise and mux | `<out>/beats/<id>.mp4`, `<out>/captions/<id>.mov`, `<out>/captions.json`, `<out>/mix.wav`, and `out/video/trailer.mp4` |
| `sheet` | one frame from the middle of each beat, four columns | `out/video/trailer_contact.jpg` |
| `report` | the timeline, the spoken and shown lines, fallbacks, warnings, loudness; fails on a film of `output.fail_at_s` or more, or on more than three flashes in any second or any saturated-red flash (WCAG 2.3.1, `lib/flashes.mjs`, measured on the encoded film) | `out/video/trailer_report.md` |

`<out>` is `--out`, default `out/video/trailer/` at the repo root. The finished film, the contact
sheet and the report always land in `out/video/`, next to the capture kit. `--step a,b` runs only
those steps, in the order above. `--only <ids>` (ids or prefixes, comma-separated) re-renders
those beats' intermediates and reuses the others; the join and the mix still run. `--base-url`
is passed to cine and to the capture kit. `--headed` shows the browser. `--ffmpeg <path>` is the
full ffmpeg on PATH (libx264), not Playwright's build. `--no-vo` writes silent stand-ins of the
planned lengths and records a warning in the report, instead of calling Azure.

**Captions.** Every voice-over line is burned in as a caption (the `caption` title card) after
the join, word for word as spoken with its slots filled, numbers in gold; a line in a language of
`captions.skip_languages` (default `["zh"]`, where the app shows its own caption) is not. A
caption shows from its line's start until the audio ends plus `tail` (0.25 s), at least `min`
(1 s), and never into the next one. It sits centred low in the frame, inside the 2.39:1 bar, and
moves to the right while a title holds the lower left (a lower-left slam, a tag, the spec sheet).
`captions.enabled: false` leaves them out.

**Machine load.** Every ffmpeg the edit runs is capped at `TTE_FFMPEG_THREADS` threads (default
4), so a render can share the machine; run it under `nice -n 10` to keep it out of the way.

**After a deploy, and when the Blender finals land.**

```bash
node video/tools/moments.mjs --write        # the hero moments' live times; re-aims shot 16-corner
cd video && node capture.mjs --only 03,04,05,06,07,09,10,12,13,14,16 && cd ..
node video/tools/blender_fit.mjs            # which approved finals are in, and their lengths
node video/tools/blender_fit.mjs --apply --fit
python3 video/tools/cuesheet.py "$(git rev-parse --short HEAD)" > /tmp/cue-sheet.md
```

`blender_map.json` says how each Blender beat is filled (clip, in-point, freeze, name cards,
corner label). A clip is used only once its file name is in the map's `approved` list: the
rejected renders share the finals' names. After `--fit` changes lengths, check that both
tellings are equal and under `output.max_s`, re-time the score (copy `video/score/cues/` to a
new sheet, set its `trailer_ref` to the commit, `uv run video/score/score.py --cues ...`), copy
its `hybrid/score.wav` to `video/score/out/`, and run the trailer.

**Cover still.** `node video/tools/cover.mjs` writes `out/cover_16x9_v3.png` (1920×1080) from
the live site: one cine frame through H8's eyes as the ball reaches him, aimed up so the crowd
fills the freeze card "THAT LOOK WAS WORTH {cf_value.dxt} / EXPECTED THREAT" and the players sit
below it, H9 ringed on the right third. Only H9 keeps his shirt-number label (the frame is
rendered with and without labels, and his gold one is copied across). The number comes from
`out/video/claims.json` (run the capture kit first); without the claim the tool stops.
`--frame`, `--aim`, `--lift` and `--fov` move the shot.

**Naming.** `naming: "ids"` (default) says and shows players as H8, H9; `"names"` (or
`--naming names`) uses the fictional names the app shows once its players are named
(`sim/roster.py`). `named.vo` holds the lines that change (a string, or `{ text, at }`), each
voiced under its own id (`vo30` → `vo30n`) so both namings stay synthesized; `named.titles`
overrides the titles' params key by key. Shot 12's button takes either label.

Chapter I without Blender: its beats default to in-engine cine shots of seed 3 (`ie-look`,
`ie-reveal`, `ie-without`), the same beats and lengths, so the score fits either; approved
Blender finals replace them through `blender_map.json`.

A preview from candidates before approval: `--preview --dir <folder of candidates> --write
out/video/trailer_preview.json` leaves `trailer.json` alone, takes the clips from that folder and
burns "PREVIEW · BLENDER SHOTS PENDING APPROVAL" in the top-left corner (`watermark`); render it
with `node video/trailer.mjs --spec out/video/trailer_preview.json`. `--drop a.mp4,b.mp4` sends
the sections of dropped shots back to the in-engine telling. For the final, add the approved
names to `approved` and run `--apply --fit --final`. A pin can take its source from a later
frame (`source_time`), light the screen (`ev`, stops in linear light, ramped back to 0 over the
last `ev_ramp_frames` so the cut to the full-frame shot is seamless) and map against another
clip's last frame (`ref_corners`, so two shots of one screen show the same picture).

**Report numbers.** `report_facts` reads a number the live page cannot show (an offline eval's
result) off a committed report: `{ id: { file, pattern, values } }`, the pattern's groups named by
`values`, filled as `{id.value}` slots like claims (four-digit integers get thousands separators);
no match leaves the slot unfilled, so the title takes its fallback. The report lists each one with
the line it came from.

**Numbers.** A voice-over line and a title param may not contain a digit or a number word
(`zero` through `twelve`, the tens, `hundred`, `thousand`, `once`, `twice`, `half`, `dozen`,
`percent`). A number arrives only as a `{claim.value}` slot, filled from `out/video/claims.json`
when that claim is usable. Anything missing uses the line's or the title's fallback, which has
no slot; with no fallback the line or the card is dropped and the report says so. Player ids
such as `H8` and `A10` are names. `[pause 400]` is the one markup whose digits are allowed, and
it becomes a break in the SSML.

**Voice-over.** Synthesis runs `video/tts.py` (Azure AI Speech). The key and region are
`AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`, already named in `.env.example`. When `.env` is
present the command is `uv run --env-file .env python video/tts.py <jobs.json>` from the repo
root; otherwise `--env-file` is left off. `--check` does not call Azure.

The spec is version 1: `output` (fps, size, LUFS, true peak), `site`, `voice` / `voices`,
`music` (asset ids from `assets.json`), `cine`, `pins`, `speakers`, `titles`, `beats` and `captions`. A beat's picture is
`black`, `cine`, `capture`, `title`, `image` or `clip`. A `clip` is a video rendered outside the
repo, such as the Blender shots in `out/video/blender/` (git-ignored; the edit stops with a
message naming the file when one is missing, `--check` does not look for it); it takes `in`,
`speed`, `reverse` and `fit: "pad"` (keep a 2.39:1 render as it is, inside the bars, instead of
cropping it to fill the frame). `fx: ["glue"]` is the shared finish of every 3D shot; `"lift"` brightens
the app's screens (mid-grey up about 0.4 EV, black and white pinned). Its `out` is `cut`, `fade`, `flash`, `dip`,
`whip` or `glitch`. The validator names the beat when something does not resolve
(`beats[3] (b04-pov): unknown cine id "pov2"`). The planned film must be under two minutes (and under `output.max_s`, 116 s, for a margin), the
report step fails when the encoded film measures `output.fail_at_s` (117 s) or more, and
the last beat cuts so the length stays the sum of the beat lengths.
