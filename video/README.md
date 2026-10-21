# video/ — capture kit for the demo video (SPEC 10)

Records clean, repeatable raw footage of the public app for the < 2:00 submission video. The
storyboard is SPEC §10; the shot list is data in [`shots.json`](shots.json); the recorder is
[`capture.mjs`](capture.mjs) (Playwright). Output goes to `out/video/`, which git ignores.

## Run it

Node 22 or later. Once:

```bash
cd video
npm ci
npx playwright install chromium   # Chromium, plus the ffmpeg that Playwright uses to encode
```

Then each time:

```bash
npm run capture                     # every shot from the live site (14 min on 4 cores, no GPU)
npm run capture -- --only 04        # one shot (ids or prefixes, comma-separated)
npm run capture -- --headed         # visible browser on the GPU: smoother footage (see below)
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

Other actions: `click` (`role` + `name`, or `selector`; `within` scopes it), `select` (`label`,
`value`), `fill` (`label`, `text`; typed key by key so it shows), `scroll` (`to` a selector, or
`y` in pixels), `hold` (`s`). The URLs use only the app's own parameters: `?autoplay=0` (start
nothing on load, so each shot starts from a known state), `?offline=1`, `?plan=invalid`,
`?rigged=0`; there are no other deep links on main.

Frames come from the browser's screencast, each with the time it was drawn. After the shot they
are written at a constant 60 fps (each output frame shows the latest frame drawn by then), so
encoding never slows the capture. **Captured fps** in the manifest and on the contact sheet is how
many distinct frames the browser drew per second. Below 30 the motion looks choppy: run with
`--headed` on a laptop with a GPU and close heavy apps. Without a GPU (software WebGL) expect
about 12.

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

## Rights

- **Synthetic only.** Everything this kit records is the app: a simulated match, fictional clubs
  and players. Add no Premier League or club logos, real player names or broadcaster branding in
  the edit either (titles, lower thirds, end card).
- **Fonts** on screen are Barlow, Saira Condensed and IBM Plex Mono (SIL Open Font License).
- **Music.** None by default. If you add a track, use a CC0 one and list it here before upload:

  | Track | Author | Source | Licence | Checked on |
  |---|---|---|---|---|
  | (none) | | | | |

## Dependency

| Package | Licence | Why |
|---|---|---|
| playwright 1.63.0 (dev) | Apache-2.0 | drives Chromium; its screencast gives the frames with their draw times |

`npx playwright install chromium` also downloads Playwright's ffmpeg build (LGPL-2.1), which
`capture.mjs` runs as a separate program to write the WebM files. Nothing of it is in the repo or
the app; `--ffmpeg` points at another ffmpeg instead.
