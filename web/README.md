# web/ — the breakdown player (SPEC 7)

Replays a hero moment in two views — a 3D view filmed in first person through the player's eyes
or from a broadcast camera, and a tactical board from above — and plays a `TelestrationPlan`
(SPEC 6) over them. Everything is synthetic: the
match comes from `sim/`, the clubs and players are fictional.

The look is "Floodlit" (the design canvas Bowen approved on 2026-10-20): a night pitch set like a
magazine. Floodlight `#F6D566` is the one accent (what he saw, the look, verified numbers, the
primary action), Dusk `#95A7BA` is always the other match, Flare `#EF774B` is for errors only;
Newsreader is the voice, Geist the instrument, Geist Mono the labels (tokens at the top of
`src/styles.css`). The first screen is the live screen: the main view fills it (his eyes, the
broadcast camera or the tactical board, from the camera switch in the bar) and the other view
rides along as a picture in picture; the header, the player picker, the moment card, the caption
and the playback bar sit over the picture, and every overlay toggle is behind **View options**.
Below it the moment is told as a story, chapter by chapter: what happened, his look (the
telemetry), what he believed, the re-simulated match, ask the replay, the call, behind the replay
and the moments. In a verified line every number has a dotted Floodlight underline and the line
ends in a check that opens its evidence; the unchecked bundled fixture shows its numbers plain.

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
npm test             # plan validation, executor, comfort-mode yaw; GPU tests need Chrome (below)
npm run typecheck
npm run build        # -> web/dist (static files for the Azure Storage static website)
npm run format       # prettier
npm run licenses     # fails on any dependency outside MIT / BSD / Apache-2.0 (and ISC, 0BSD)
npm run fps          # after a build: fps with pitch control and the skeleton off and on (below)
npm run smoke        # end to end: a local API, the build, every page in headless Chromium (below)
npm run a11y -- --url <site>  # axe-core on every screen, desktop and phone (docs/ACCESSIBILITY.md)
npm run contrast -- --url <site>  # contrast of the text over the 3D views, 72 renders (same doc)
npm run loadperf     # cold-load timings and bytes, laptop and phone, plain and on Fast 3G (below)
```

## URL parameters

Deep links for the README's tour for judges, and for testing and filming
(`src/deeplink.ts`, tests in `src/deeplink.test.tsx`). Parameters combine, e.g.
`?run=counterfactual&at=decision&view=tactical`.

| Parameter  | Values                                                          | Effect                                                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match`    | a match id the live service serves: `match-1`, `press_escape-0` | play that match instead of the bundled `blind_side_run-3` (the header's match picker sets it); a stitched match takes only `view`, a numeric `at`, `camera` and `play` (and `persona`, `lang` with `play=recap`)                                |
| `persona`  | `casual`, `analyst`, `player_fan`, `coach`, `audio_description` | the audience the breakdown is asked for (live service only; offline the bundled breakdown is the only one); `audio_description` also turns the voice on, which the browser may hold back until the first click on the page                      |
| `lang`     | `en`, `zh`                                                      | the breakdown's language (live service only) and the What if box's answer language                                                                                                                                                              |
| `run`      | `factual`, `counterfactual`                                     | with the look / without it                                                                                                                                                                                                                      |
| `view`     | `pov`, `tactical`, `split`                                      | the main view: `pov` the 3D view alone, `split` the 3D view with the board as a picture in picture, `tactical` the board with the 3D view small; a breakdown resets it to `split` when it starts                                                |
| `at`       | a frame (25 Hz, from 0), `key-scan`, `decision`                 | open paused at that frame; `key-scan` is where the app opens by default, inside the key scan                                                                                                                                                    |
| `ask`      | a question                                                      | prefill the What if box's free question and scroll to it; it is sent only when the viewer presses Ask                                                                                                                                           |
| `tamper`   | a claim id, e.g. `cf_value`                                     | open the evidence card on that claim with "Try a wrong number" open; online, the breakdown is asked for at once                                                                                                                                 |
| `play`     | `yourcall`, `recap`                                             | open "Your call" at the decision; with `match`, on its first hero moment that has bundled what-ifs; counts as a spot: opens paused; `recap` (with a stitched `match`): its end-of-match recap for `persona` and `lang`, offered as at full time |
| `play`     | `eyes`                                                          | open "Take his eyes" on his own look; with `match`, on its first hero moment that has a bundled look grid; counts as a spot: opens paused                                                                                                       |
| `autoplay` | `0`                                                             | start neither the live stream nor the breakdown on load                                                                                                                                                                                         |
| `intro`    | `0`                                                             | skip the pre-match lineup card; links to a spot (`at`, `run`, `ask`, `tamper`) also skip it                                                                                                                                                     |
| `offline`  | `1`                                                             | ignore the live service and play the bundled data                                                                                                                                                                                               |
| `plan`     | `invalid`                                                       | load a deliberately broken plan to show the template fallback (bundled breakdown)                                                                                                                                                               |
| `rigged`   | `0`                                                             | start with the tokens instead of the animated players                                                                                                                                                                                           |
| `camera`   | `broadcast`                                                     | start on the broadcast camera, focused (for filming); a breakdown still cuts to first person                                                                                                                                                    |
| `director` | `auto`                                                          | start with the Auto director on: it cuts the cameras by itself (for filming); a breakdown still directs its own cameras                                                                                                                         |
| `cine`     | `1`                                                             | filming the demo video only (`src/cine/`, SPEC 10), never linked: the 3D view full screen with no UI, driven by `window.__cine`                                                                                                                 |

A link that points at a spot (`at`, `run`, `ask`, `tamper` or `play`) opens paused: no live stream, and
no breakdown on load unless `tamper` needs one. If no line of the breakdown carries the linked
claim, the first claim with a number opens instead (`analyst` narrations carry the most).
Without them, the app watches live and then plays the breakdown, in the linked `persona` and
`lang` if given. Values the app does not know are ignored and listed in the console.

## Hosting and load time (SPEC 8)

Azure Storage sends each file exactly as uploaded, with the headers given at upload, and never
compresses on the fly, so `infra/upload_web.sh` (used by `infra/deploy.sh web` and the deploy
workflow) uploads a staged copy of the build (`scripts/stage.mjs`): text files gzipped with
`Content-Encoding: gzip` (1.6 MB of JS becomes 0.47 MB on the wire), every batch with its
`Content-Type` named (`az storage blob upload-batch` guesses one only when no encoding is given),
everything cached for 5 minutes and `index.html` revalidated on every visit. `index.html` goes up
last, and only after every other file has been read back from the site with the right type,
encoding and bytes (`scripts/check-site.mjs`); then the page is loaded in headless Chrome, and the
previous `index.html` comes back if it does not draw. #115 (2026-10-21) had no such check: its
gzipped scripts went up as `application/octet-stream` and the live page stayed on "Loading the
match…" until it was reverted. Hashed files are named `[name].[hash]` since then, so no browser
keeps one of that deploy's year-cached files. gzip rather than Brotli because Storage cannot choose
an encoding per request and every browser and proxy takes gzip.

`index.html` also shows "Loading the match…" before any script runs, opens the API's connection
(`preconnect`, added at build time from `VITE_API_URL`) and fetches the players' model while the
scripts load. The telemetry panel, the costliest below the live screen, stops following the
playhead while it is off screen or the tab is hidden (`src/ui/onScreen.ts`), and builds its curves
once per run and player instead of on every frame.

`npm run loadperf` measures cold loads of the live site (a fresh Chrome per load): first paint,
first WebGL draw, when the rigged players are drawn, main-thread blocking time and bytes by kind,
on a laptop (1440 × 900) and a phone (375 × 812), plain and throttled to DevTools' "Fast 3G" with
a 4× CPU slowdown. `--serve dist-upload` serves a staged build as Storage would, on the site's
own origin (inside Chrome only), so the API, the stream and the fonts behave as live. Results:
[eval/reports/web_load.md](../eval/reports/web_load.md).

## The live service (`VITE_API_URL`)

`VITE_API_URL` is the base URL of the API service (`api/`, SPEC 2), read by Vite **at build
time**, for example
`VITE_API_URL=https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io npm run build`.
The deploy workflow sets it from the repo variable `TTE_API_URL`, and `infra/deploy.sh web` from
`TTE_API_URL` in `.env`.

- **Unset, or the service does not answer** `GET /health` within 3 s (or its match export fails):
  the app plays the bundled files in `public/data/` exactly as before and shows an **Offline data**
  badge in the header (hover for the reason). Suggested what-if questions still work; free
  questions, other personas and languages, and the voice are disabled.
- **The service answers:** the match export comes from `GET /api/matches/<id>/export`, and
  - **Live:** on load the match plays from the WebSocket `/ws/matches/<id>/live` (the Live button in
    the header). Each `frame` is written into the run the views draw; the playhead follows the
    stream and never runs ahead of it. Play / pause, the timeline and the speed send `pause`,
    `resume`, `seek` and `speed`; leaving live (the run without the look, a breakdown, a what-if,
    opening evidence) sends `stop`, and Live reconnects where the stream was. After a seek,
    frames still in flight from the old position are dropped with their events and moments.
    Moments appear in the **Moments** panel as the stream detects them.
  - **Breakdowns:** once the stream detects the hero moment (or when the viewer asks), the app
    posts `POST /api/breakdowns` for the chosen audience (persona) and language. The payload and
    the plan are checked like the bundled ones (`validatePayload`, `resolvePlan`), the voice cues
    become the plan's voice steps, and the narration panel says **Cached** or **Generated**,
    **Model** or **Template**, and **Rate-limited** / **Daily cap reached** when the server says
    so. If the request fails, the bundled fixture is shown with the reason. On autoplay the
    breakdown plays by itself after the live match, like a broadcast replay after a goal.
  - **What if…?:** free questions go to `POST /api/whatif`; a verified answer replays from the
    decision with the forced run as the ghost (from the bundled what-ifs), a refusal is shown as
    such.
  - **Voice:** off by default; choosing the **Audio description** audience turns it on (and makes
    the captions large print), leaving it turns it off again unless the viewer set the sound.
    **Sound on** sends each caption's cue key (`cache_key`) to `POST /api/tts`, which speaks the
    SSML the service's own crew wrote for it (Azure AI Speech), and plays the WAV as the line comes
    up; clips are kept per cue. While the voice is off, a screen reader hears each caption from a
    polite live region.

The API's CORS allows only the static website's origin, so for `npm run dev` against the deployed
service let Vite forward the API paths (dev server only):

```bash
TTE_API_PROXY=https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io \
  VITE_API_URL=http://localhost:5173 npm run dev
```

## The stitched match (`?match=match-1`, SPEC 3.1)

`match-1` is 19 scenario possessions on one clock of about 12½ minutes (`sim/match.py`, SPEC 3.1):
open-play passages and four heroes (the blind-side run at 0:30, escaping the press at 4:54, the
far-post finish at 7:01, which scores, and the short corner at 8:51). `match-2` (`?match=match-2`,
in the match picker) plays three of them on other seeds, in another order: escaping the press at
0:25, the short corner at 3:22, the blind-side run at 7:58. Both exist only on the live service:
offline, the bundled hero moment plays and the badge says why.

- **Live view.** The whole match streams like a hero moment. The score bug shows the score, the
  possession on screen (n of 19, its scenario) and how play restarted (kick-off, throw-in, …, or a
  cut). The timeline is banded by possession, numbered where the numbers fit, hero possessions
  in gold, the four hero moments as gold diamonds (the short corner's is the marker's look);
  ◀ / ▶ jump between possessions; speeds go up to 4×. The match export
  has no beliefs, sight or vision model, so belief ghosts, "in his sight" and the vision cone are
  off until a hero moment is opened.
- **Moments.** Every moment of every possession, in match time, with its lens (`scan lens`,
  `pressure lens`, or `live only`); while live, those the stream has not announced yet are dimmed.
  Any moment replays; the four hero moments have **Breakdown**.
- **Breakdowns.** A hero moment's breakdown plays on its possession's own run: the app loads that
  run's hero export from the service (`/api/matches/<scenario>-<seed>/export`, so `TTE_MATCHES`
  must list it; for `blind_side_run-3` the bundled file stands in) and asks
  `POST /api/breakdowns` (and `/api/whatif`) with the moment's id in match time. The answer's
  plan and payload are in the possession's local frames: the response's `possession` must name
  this moment, possession and `start`, or it is refused. Clocks and evidence times show the match
  clock (local frame + `start`); **Back to the match** puts the match playhead there.
- **A hero without a key scan.** The pressure hero (`press_escape`) has `key_scan: null` and a
  counterfactual that forces an action. The run toggle and the ghost say "What he did" / "If he
  carried it", there is no key-scan jump or scan marker (the template plan watches the 2.4 s up
  to the decision instead), and the counterfactual ghost is the forced carry's ball path.
- **A marker's look.** The set-piece hero (`corner_blind_side`) is a defender with a key scan and
  no decision on the ball, so the export's `decision`, `action`, `possession_value` and
  `delta_xt` are null. `Hero.marker` holds the man he marks, the pass to him and how far the
  marker was from him when it resolved in each run; that frame anchors the moment, as on the
  service's `marker_scan` card. The story tells his look and his man, the counterfactual cards
  compare the two separations, the timeline marks "Ball arrives" instead of a decision, and the
  look's worth is the verified `cf_value` claim when the narration airs it, else the scan lens's
  delta from `/api/matches/<id>/moments` (marked "lens"), else nothing until the breakdown.

## Data

The files in `public/data/` are written by

```bash
uv run python -m sim.export --scenario blind_side_run --seed 3 \
  --out web/public/data/hero_seed3.json \
  --payload-fixture web/public/data/fixture_payload_seed3.json \
  --what-if web/public/data/whatif_seed3.json
uv run python -m sim.export --scenario press_escape --seed 0 --out /tmp/press_escape_seed0.json --what-if web/public/data/whatif_press_escape_seed0.json
uv run python -m sim.export --scenario blind_side_run --seed 3 --without-look web/public/data/without_look_seed3.json
uv run python -m sim.export --scenario far_post_finish --seed 11 --without-look web/public/data/without_look_far_post_finish_seed11.json
uv run python -m sim.export --scenario blind_side_run --seed 3 --looks web/public/data/look_seed3.json
uv run python -m sim.export --scenario press_escape --seed 0 --looks web/public/data/look_press_escape_seed0.json
uv run python -m sim.export --scenario blind_side_run --seed 3 --steps web/public/data/steps_seed3.json
uv run python -m sim.export --scenario press_escape --seed 0 --steps web/public/data/steps_press_escape_seed0.json
```

- `hero_seed3.json`: the replay (schema version 5, with blind-side alerts and the scan detector's
  output: integer mm, 1e-4 rad and 1e-4 rad/s, origin at the centre spot, home attacks +x).
  `src/data/hero.ts` converts it once into typed arrays in metres and radians.
- `fixture_payload_seed3.json`: a **fixture** render payload (SPEC 5.3) for the same moment,
  marked `"fixture": true`. Its claim values are computed from the replay by
  `sim.export.render_payload_fixture`, following `explain.builders` (claim ids, value slots,
  evidence) and `explain.render` (seek frame = earliest evidence event), but no verifier has
  checked them. The UI labels it "Sample data · not checked by the verifier". With the live service
  the verified payload from `POST /api/breakdowns` replaces it; the fixture stays as the offline
  fallback.

- `whatif_seed3.json`: every option of the hero's decision forced and re-simulated
  (`sim.export.export_what_ifs`): the suggested question in en and zh, the verified answer from
  `agents.whatif.answer_question` (a real SPEC 5.3 payload, not a fixture), and the forced run from
  the decision on (players and ball, mm) for the ghost path. The suggested questions use it online
  and offline; free questions go to the api's live what-if, which uses its forced runs for the
  ghost.

- `without_look_seed3.json`, `without_look_far_post_finish_seed11.json`: the run without the look,
  told (`sim.export.export_without_look`, `explain/look_cost.py`; teammates' feedback,
  2026-10-21). Verified lines in en and zh: which look was removed (which shoulder, how long
  before the ball reached him), what losing it cost (played back instead of forward, or the ball
  lost), and where each run's pass reached its receiver with the xT there; plus the 16 × 12 xT
  grid (1e-4) the explainer draws. Not part of the crew's evidence, so breakdown cache keys do
  not move. `src/without/` checks the payloads against the replay and shows them under "Without
  the look", on the timeline, at the edge of his eyes and in the verdict; fetched when the session is made.

- `look_seed3.json`, `look_press_escape_seed0.json`: Take his eyes (`sim.export.export_looks`,
  SPEC 3.7, 7). Every look of the grid (a time × a direction) re-simulated with that look as his
  only one between the pass and his decision: his head, sight and belief over the window (the
  belief sparse against the no-look run), his decision as `hero_seed3.json` has it, its verified
  lines in en and zh, and the run from the decision on for the players on the ball (each distinct
  run once). `src/takeeyes/looks.ts` splices a look into the factual run; fetched when the mode
  first opens.

- `steps_seed3.json`, `steps_press_escape_seed0.json`: His looks, step by step
  (`sim.export.export_steps`, SPEC 7). Per run: each look of the hero before the ball reaches him
  (the dropped one marked missing), its freeze frame, who came into his sight, every player's sim
  velocity there (mm/s), and his decision with the two players it turns on; the verified lines in
  en and zh (`agents/steps.py`). `src/steps/steps.ts` checks the looks against the replay's own
  scan events; fetched when the mode first opens. `tests/test_steps.py` keeps them current.

Regenerate them whenever `sim/`, `analytics/` or `explain/` change;
`tests/test_committed_exports.py` fails when a committed file is stale (byte for byte where the
files are generated, on macOS arm64; structurally elsewhere, as SPEC 3.7 promises no
cross-platform identity).

## How it fits together

```
src/
  api/        the API client (zod-checked responses, timeouts) and VITE_API_URL
  live/       the live stream: WebSocket feed, frame ordering, control messages, live playhead
  breakdown/  the breakdown on screen per persona and language: service or bundled, checked
  voice/      spoken narration from /api/tts, off by default (on for audio description)
  data/       load the export (service or bundled), sample a player at a fractional frame, eased yaw
  store/      the playback store: mode, frame, speed, toggles, POV player, focus, open line
  director/   camera director: rules over stream events, the chip and the Auto director switch
  plan/       TelestrationPlan schema (zod), validation + template fallback, executor
  narration/  render payload schema (zod), checks against the moment, kind labels
  match/      a stitched match: possessions, score, moments; its session (live, opens breakdowns)
  tamper/     "Try a wrong number": a claim re-checked by the service's verifier, POST /api/verify
  telemetry/  perception telemetry for the POV player: curves, detector marks, readouts
  views/      PovView (first person and broadcast) with its motion blur pass, TacticalView (React
              Three Fiber), the HUD, the broadcast camera and the stadium
  pitchControl/ the pitch-control shader and its board layer, GPU parity test and its harness
  skeleton/   the optional skeleton view: torso line, head ray (true or tracked yaw), its key
  alerts/     blind-side alerts from the export, for the board, first person and the HUD
  options/    pass options at the decision: believed and true targets, chance and value
  players/    the rigged Gameplay Football players: rig, gait, look, kits, the mocap extras
  whatif/     "What if…?": the bundled what-ifs, and free questions to POST /api/whatif
  yourcall/   "Your call": decide with what he knew, then the reveal (a pure reducer, its scene)
  cine/       filming mode for the demo video (`?cine=1`, never linked): a full-screen 3D view a
              script drives frame by frame through `window.__cine` (shot spec, cameras, post)
  producer/   the Producer's failure drill: take agents down, bring them back, step sources
  ui/         the live screen (Stage: camera switch, view options, player picker, moment card),
              transport + timeline, caption + evidence card, the story's chapters, console
  session.ts  one Session per moment: data + stores + plan runner + live feed + voice + controls;
              the transport and live controls a match shares; useView() for the shared views
  deeplink.ts URL parameters: parsed once, applied to the session before the first render
  testing.tsx test stand-ins: routed fetch, scripted WebSocket, API responses, server rendering
```

- **One store, many readers.** `store/playback.ts` holds what is on screen now. Views only read
  it. Three things write it: user controls (`session.ts`), the plan executor (`plan/runner.ts`)
  and the camera director (`director/`, the camera only).
  A `requestAnimationFrame` clock calls `runner.tick(dt)` then `advance(dt)` once per screen
  frame; in live mode it moves the playhead towards the last frame the stream sent instead. Any
  transport control stops a running breakdown and hands control back to the viewer.
- **Plans are validated before they play.** `plan/validate.ts` checks shape (zod schema: unknown
  steps, missing or extra fields) and meaning against the moment (ids exist, times are inside the
  clip, POV clips are at most 3 s). An invalid plan never plays: `resolvePlan` swaps in
  `templatePlan(moment)`, built from the moment alone, and keeps the reasons for the console.
  Plan times: `t` is seconds since the plan started; `from` / `to` are match seconds relative to
  the moment's anchor (`MomentCard.anchor_frame`, the decision); `moment` is the card id. One step beyond the SPEC sketch: `play` (play on to a time), needed to
  show the outcome after a freeze.
- **Comfort mode** (SPEC 7: eased POV yaw). Between frames the head yaw follows a monotone cubic
  (as in PCHIP) instead of a straight line, so turns ease in and out but the peak of every look
  is kept — what the player saw stays on screen. Playback also slows while the head turns faster
  than 120°/s on screen; during a plan the plan clock slows with it, so captions stay in sync.
  Plan POV clips always use comfort mode.
- **Motion blur in first person** (the Floodlit design). When the head whips round the picture
  smears sideways, as a camera's would, and it is sharp the instant the head stops: a horizontal
  Gaussian whose sigma is 0.3 × the angle the head sweeps while a 25 Hz, 180° shutter is open,
  in pixels at the image centre (sigma = 0.3 · |ω| · 1/50 s · px per degree), capped at 3% of the
  width, from the measured head yaw rate in match time (`views/motionBlur.ts`). The scene is drawn
  into a half-float target that three.js treats like the canvas, so the blur converges on the
  sharp frame; one pass of 17 taps up to 3 px, two passes beyond (`views/PovMotionBlur.tsx`).
  Under half a pixel, on the broadcast camera and under `prefers-reduced-motion` the scene is
  drawn straight to the canvas. The canvas carries the current sigma in `data-blur-sigma`.
- **Broadcast camera** (SPEC 7: high side angle, follows the ball, smoothed). The **Broadcast**
  button of the camera switch, or a plan's `camera` step with mode `broadcast`, films the same
  scene from a fixed camera 21 m up, 26 m behind the near touchline at the halfway line, which
  pans, tilts and zooms (`views/broadcast.ts`). Critically damped springs follow the ball and
  widen the frame with its speed; while a pass is in flight the aim follows an S-curve from where
  it starts to where it ends, so the receiver comes into frame and the camera arrives at rest; the
  ball always stays inside a 16:9 safe frame. The path is computed once per run in match time, so
  a seek or a plan rewind is a hard cut with no lag and slow motion slows the camera move with it.
  On screen: rings under the hero (white) and the runner (gold), tags for sprints above 7 m/s
  (the live stream's threshold), the POV player's scans and blind-side alerts (all marked `sim`),
  and on the grass the blind-side lines and, at the decision, the pass options. `pov` and
  `broadcast` camera steps pick the 3D view's camera; a `pov` step always films in first person.
- **Camera director** (`director/`). The viewer picks the camera; a chip above the views suggests
  which one to switch to and why, and one tap switches. Deterministic rules over what the live
  stream has sent (its events, moments and blind-side alerts; in a replay, the run's own up to the
  playhead), highest first: a detected hero moment (watch its breakdown); a pass toward a player
  (his eyes, only while the ball is at least 0.5 s away at 1×; raised when he looks over his
  shoulder before it arrives, or has lost sight of someone on his blind side); a reception (his
  eyes, briefly); a defender's blind-side alert (the tactical board); a turnover (broadcast);
  another moment with a lens (replay it: scan lens in the actor's eyes, pressure and space on the
  board). Reasons are templates over player ids with no numbers. A suggestion on screen stays
  until it ends or a higher one comes, and is hidden while the viewer is already on its camera.
  **Auto director** (off by default) cuts by itself: at least 2 s of wall clock per shot, never
  while the player on screen is mid-scan, and never a breakdown or replay. While a breakdown runs
  its plan chooses the cameras and the director stays out. Camera cuts write the playback store
  directly, like the camera switch, so they never stop a breakdown or its autoplay. The chip is
  deliberately not an aria-live region: switching cameras is visual, and announcing every
  suggestion would talk over the captions that audio description relies on; it stays a
  focusable, named button.
- **Stadium** (`views/Stadium.tsx`), generated, around both 3D cameras: a two-tier bowl under a
  roof, about 15,000 instanced spectators in one draw call, four floodlight masts with a glow
  sprite, boards with our own words only ("Through Their Eyes", "Synthetic match", "All players
  fictional"), a night-sky gradient, and four faint floodlight shadows per player. It is dark and
  hazed on purpose; glow and shadows are faked (sprites and decals, no bloom pass or shadow maps)
  and the 3D view uses ACES tone mapping.
- **Tactical board.** An orthographic camera straight down. Layers are drawn in a fixed order
  with depth testing off, like a 2D canvas. The vision cone is a fragment shader of the sim's FOV
  model (angular term and distance decay of `analytics/vision.py`; occlusion not yet).
- **Pitch control** (SPEC 4.2, 7). Toggle "Pitch control", off by default. A fragment shader over
  the whole pitch evaluates the closed-form model of `analytics/pitch_control.py` per pixel, with
  its parameters (σ = 0.45 s, reaction 0.7 s, v_max = 5 m/s): coral where the home team gets
  there first, blue where the away team does, clear where it is contested, and a light line on
  the frontier (control = ½). Each redraw feeds it both teams' positions and velocities as
  uniforms. The export has no velocities, so the board takes the backward difference of the
  positions: the sim steps with semi-implicit Euler, so that is the sim's own velocity up to the
  1 mm rounding, and the board shows what the `get_pitch_control` MCP tool computes.
  - _Parity with numpy_ (SPEC 4): `pitchControl.gpu.test.ts` renders the shader with three.js in
    headless Chrome on 10 fixed snapshots of the hero moment, at the centre of every 1 m cell, and
    compares with the numpy kernel: max abs diff < 0.02 (SPEC) and < 1e-3 (what float32 should
    give; it measures about 5e-5, the reference's rounding to 1e-4). It also checks that swapping
    the teams gives 1 − P and that the colour ramp blends as intended. The snapshots and the numpy
    values are in `src/pitchControl/snapshots.json`, written by
    `uv run python -m eval.pitch_control_parity` (repo root); `tests/test_pitch_control_parity.py`
    checks them against the kernel.
  - _Frame rate:_ `npm run build && npm run fps` plays the hero moment in Chrome through the key
    scan and prints fps with the overlay off and on (with the widest first-person blur of each
    run), then the shader's own cost per draw, and checks that `prefers-reduced-motion` turns the
    blur off; `npm run fps -- --headed` measures on this machine's GPU.
- **Skeleton data** (SPEC 7, optional; first in the SPEC 9 cut order). Toggle "Skeleton" in View
  options, off by default; it draws on the broadcast camera and the tactical board, one state for
  both. Per player it
  draws only sim data: the position, the torso line (shoulders, across `body`), a head ray from
  the head yaw, and a fan from torso to head whose fill grows with the head–torso angle. The ray
  lights up (detector green) while the scan detector marks a scan. The key's switch picks the
  head yaw: true, or as tracked (2° sensor noise, the detector's input), rebuilt from the
  detector's exported angular velocity (`skeleton/skeleton.ts` says how; within 0.38° of the
  sim's tracked yaw on seed 3). A match export has no detector run, so there it is true yaw only
  and the ray lights up during the sim's own scans (sight blue). No limbs: the sim has none.
  `npm run fps` also measures it, over the broadcast camera.
- **Verified narration you can open** (SPEC 7). Captions come from the render payload; a plan's
  voice steps name its line ids. Click a caption (or any line of the call) and the
  evidence card under the views lists each claim with its kind (observed / computed /
  counterfactual), verdict, values and evidence events, and the replay seeks to the claim's
  `seek_frame`. Counterfactual claims are shown in the re-simulated run and always carry the
  label "Counterfactual · inside the sim": they are causal only inside the simulation. The payload
  is checked like a plan (references resolve, evidence events exist, seek frames are in the clip);
  a line with an unsupported claim is withheld.
- **Pass options at the decision** (SPEC 5.1, 7). From two frames before the hero's decision
  until the pass is on its way, the tactical board draws a line from him to the believed target
  of each of his top six options (plus the chosen one and the runner's): width = the chance he
  picked it, colour = its value (one scale for both runs), the chosen one haloed, carry and shot
  as rings. A dashed line goes to where the same option was on the true state. Hover (or tap)
  shows the option with "he thought" and "it was"; at a freeze the chosen pass (with the look)
  or the runner's option (without it) gets a "he thought / it was" tag. Those numbers come from
  the `pass_success` / `cf_pass_success` claims; other options' numbers are marked `sim`
  (from the export, not verified). The layer has a toggle and needs no plan step.
  `options/passOptions.ts` holds the logic and its tests.
- **Blind-side alerts** (SPEC 4.4, 7, live). From tracking only (`analytics/blind_side.py`), an
  observer who has lost sight of a player on the move: on the tactical board a thin line from the
  observer to that player (brighter for the POV player's own alerts) and a pulsing ring on him;
  in first person a ring on him and, for the POV player's alerts, a "BLIND SIDE H9 unseen 2.1 s"
  HUD badge; on the board an "unseen" tag. It clears the moment he is seen (the module may hold
  an alert on for its minimum duration; the viewer does not show that). The numbers are marked
  `sim`: a live deterministic overlay, not a claim. Toggle "Blind side".
- **Body and head yaw on every player.** In first person a token is a capsule body turned to
  `body_yaw` with a head on top turned to `head_yaw` (relative to the body, never clamped); a white
  visor marks the front of the head, so a look over the shoulder is visible on anyone in view. On
  the tactical board a short white tick shows each player's head direction. `views/tokens.ts`
  holds the pose maths; its test checks the rendered world yaw against the export (< 1e-3 rad).
  In the first-person view the animated players are the default (Bowen chose them by eye over
  the tokens); **Animated players** in View options switches back to the tokens. They are an
  animated footballer converted from Gameplay Football (`src/players/`,
  `public/models/README.md`, SPEC 7): gait blended by sim speed with the playback rate
  matched so the feet do not slide, the pass clip on pass events, the neck (then the trunk)
  turned so the head points along `head_yaw`, kits in the fictional clubs' colours. On top, by
  default, retargeted motion capture (`src/players/extra.ts`, `public/models/anims_extra.glb`):
  a real kick at every pass, its ball contact on the pass event and the planted foot still, and
  the trunk joining every scan's look over the shoulder, timed to the head's turn out, hold and
  back. With them, a real walk below 1.7 m/s instead of the engine's jog in miniature
  (`src/players/walk.ts`, `public/models/anims_walk.glb`, Quaternius, CC0), cross-fading into the
  jog and back on one gait phase (`src/players/gait.ts`). The head stays exactly on `head_yaw`.
  `?anims=base` shows the engine's clips only, `?walk=0` the extra clips without the walk;
  reduced motion leaves the shoulder checks out.
- **Perception telemetry** (SPEC 4.7, 7). Under the timeline, curves for the player in the
  first-person view ("Whose eyes"), with a cursor on the playhead: head angle to the ball with
  his scans from the sim (the key scan highlighted; without the look, a dashed box where it
  was), head angular speed with the scan detector at work (its threshold, candidate onsets, the
  onsets its excursion gate rejected, and the scans it accepted), players in his sight, and, for
  the hero only, belief error on the runner (how far his belief is from where the player really is; "n/a" for anyone
  else, as beliefs are recorded for the hero only). As in motorsport telemetry, the other run is
  overlaid dashed on the head-angle and belief rows (with the look cyan, without it gold, as
  elsewhere), both runs on one time axis so the curves coincide until the key scan and split
  there; a key-points row marks the key scan, the ball reaching the hero, and his decision and
  pass, with guides through every row. The speed row and the detector's marks are
  `analytics/scan_detector.py` run by `sim.export` on the tracked head yaw (with sensor noise),
  as `eval/scan_detector.py` runs it; the head-angle row uses the true head yaw the views draw,
  so its readout matches the HUD. Live, the curves and key points stop at the last frame the
  stream sent, a scan appears once it has ended, and there is no overlay (the stream is one run). Every value is marked `sim`: a computed metric, not a verified
  claim. `telemetry/telemetry.ts` holds the logic and its tests.
- Belief ghosts exist for the hero only (the export records his beliefs); "who is in sight" is
  exported for every player, so the POV picker works for all 22.
- **"What if…?"** (SPEC 6, 7). One suggested question per option ("What if he passed to H4?",
  "What if he carried it?"); what he actually did is marked. Picking one replays the moment from
  the decision with the forced run as a gold ghost on the tactical board (its ball path, growing
  with the playhead, and ghosts of the players on the ball) and shows the verified answer lines
  with their counterfactual labels; each line opens its claims and seeks to the evidence, as in
  the narration. Free questions go to the live service (above); offline the text box is
  disabled.

### Frontend choices, briefly (for Python / C++ readers)

- **React** renders the page from state, like a pure function `state -> UI`; components are
  functions that return markup (JSX). `useStore(store, s => s.frame)` subscribes a component to
  one field, so it re-renders only when that field changes.
- **React Three Fiber** writes three.js scenes as React components. Per-frame motion does not go
  through React: each view mutates its meshes in `useFrame`, which runs once per redraw. The
  canvases redraw only when the store changes (`frameloop="demand"`), which saves battery on phones.
- **zod** is the TypeScript counterpart of pydantic: one declaration gives the static type and the
  runtime validator. The Python side can produce the same JSON shape for the Telestrator agent.
- **TypeScript strict mode** is on; `npm run typecheck` is the compile step (Vite itself only
  strips types).

### Invariants and tests

- **Nothing unchecked looks checked.** Captions, the call and what-if answers come from render
  payloads (SPEC 5.3) checked against the moment before use; a line with an unsupported claim is
  withheld, and a counterfactual claim always says it is inside the sim. Numbers that are not
  claims (telemetry, alerts, options other than the ones claims cover) are marked `sim`, and the
  bundled fixture says it was not checked by the verifier.
- **Plans are validated before they play**, by the same rules as `agents/plan.py`; an invalid
  plan becomes the template plan.
- **Shader parity.** The pitch-control shader must match `analytics/pitch_control.py` within 0.02
  on fixed snapshots (`src/pitchControl/pitchControl.gpu.test.ts`, real GLSL in headless
  Chrome). A change to the kernel regenerates `snapshots.json`
  (`uv run python -m eval.pitch_control_parity`) in the same PR.
- **Bundled data is generated, never edited** (`public/data/`, [Data](#data));
  `tests/test_committed_exports.py` fails when it is stale.
- **Views only read the store**, and anything a stitched match draws reads `useView()`;
  `useSession()` is for hero-only panels and throws inside a match.
- Tests sit next to the code (`*.test.ts`, `*.test.tsx`, with `testing.tsx` for fetch, WebSocket
  and API stand-ins). CI's `web` job runs `npm ci`, `licenses`, `typecheck`, `format:check`,
  `test`, `build` and `node ../video/capture.mjs --list`; its `smoke` job runs `npm run smoke`.
  The whole flow: [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md).

## Dependencies

Pinned to exact versions, each at least two weeks old when added except react / react-dom
19.3.1, which shipped the same day as patch releases for every older 19.x line. `npm run licenses`
checks the whole tree in CI.

| Package                                                           | Licence    | Why                                                                    |
| ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| react, react-dom 19.3.1                                           | MIT        | UI library the rest of the stack builds on                             |
| three 0.186.1                                                     | MIT        | WebGL renderer for both views                                          |
| @react-three/fiber 9.8.1                                          | MIT        | three.js scenes as React components, one render loop per canvas        |
| @react-three/drei 10.7.9                                          | MIT        | `Line` (fat, dashed lines with pixel widths) for pass lines and ghosts |
| zod 4.6.5                                                         | MIT        | TelestrationPlan schema: static type + runtime validation in one place |
| vite 8.3.2 (dev)                                                  | MIT        | dev server and production build                                        |
| @vitejs/plugin-react 6.1.1 (dev)                                  | MIT        | JSX transform and fast refresh for Vite                                |
| typescript 7.0.2 (dev)                                            | Apache-2.0 | type checking (`tsc --noEmit`)                                         |
| @types/react, @types/react-dom 19.3.0, @types/three 0.186.0 (dev) | MIT        | type definitions                                                       |
| vitest 5.0.3 (dev)                                                | MIT        | unit tests, reusing the Vite config                                    |
| prettier 3.9.9 (dev)                                              | MIT        | formatting, checked in CI like `ruff format`                           |
| playwright-core 1.63.0 (dev)                                      | Apache-2.0 | drives Chrome for GPU tests, `fps` and `smoke`; no browser download    |
| axe-core 4.14.0 (dev)                                             | MPL-2.0    | WCAG rules for `smoke` and `a11y`, injected unmodified into the page   |

MPL-2.0 is allowed only unmodified (CLAUDE.md): `axe-core` is a dev dependency whose `axe.min.js`
the scripts inject into the page as shipped, and `lightningcss` (Vite's CSS minifier, transitive)
runs unmodified at build time only. Other transitive exceptions, reviewed by hand: `webgl-constants` (via drei → detect-gpu)
has no licence field in its package.json, its LICENSE file is MIT.

Fonts (Barlow, Saira Condensed, IBM Plex Mono) are loaded from Google Fonts at runtime, as in
`demo/`; they are under the SIL Open Font License and are not bundled.

## GPU tests (Chrome)

`npm test` includes `src/pitchControl/pitchControl.gpu.test.ts`, which runs real GLSL in headless
Chrome. `scripts/gpu.mjs` finds a browser: `$TTE_CHROME` (a path), else a Playwright-installed
Chromium under `$PLAYWRIGHT_BROWSERS_PATH`, else the system's Google Chrome (GitHub's Ubuntu
runners have one). Without a GPU, Chrome draws WebGL with SwiftShader, its software rasteriser;
on CI (`CI` set) the tests always use SwiftShader so runs are reproducible, elsewhere they use the
GPU when there is one. The test fails, rather than skips, when no browser is found.

## Smoke test (end to end)

`npm run smoke` (`scripts/smoke.mjs`, SPEC 7, 8) loads the whole app as a visitor gets it, which
the unit tests do not: on 2026-10-20 `?match=match-1` rendered a black page on the live site
("useSession needs a hero moment, not a match") although every unit test passed. It

1. starts the API from the repo root (`uv run uvicorn api.main:app --port 8765`, after `uv sync`)
   offline whatever the shell has set: no model, Speech, Cosmos DB or telemetry, a fresh cache,
   and `TTE_MATCHES=blind_side_run:3,match:1,press_escape:0`; it waits for `/health`;
2. builds web/ with `VITE_API_URL=http://localhost:8765` into a temporary directory and serves
   it with `vite preview`;
3. opens each page in headless Chromium, found as for the GPU tests (below), on SwiftShader on CI:

| Page                                     | Its main view                                                      |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `?autoplay=0`                            | hero `blind_side_run-3`: the Live control, the run switch, 3D view |
| `?match=press_escape-0&autoplay=0`       | the pressure hero, the same                                        |
| `?match=match-1&autoplay=0`              | the score bug, the 3D view, the Moments panel                      |
| `?match=match-1`                         | live; each **Breakdown**, then **Back to the match**               |
| `/`                                      | the lineup card, **Skip**, then the hero                           |
| `?match=match-1`                         | the lineup card, **Start watching**, then the match                |
| `?persona=analyst&tamper=cf_value`       | the evidence card with "Try a wrong number" open                   |
| `?at=decision&view=tactical`             | the tactical board                                                 |
| `/` and `?match=match-1` on an iPhone 17 | the phone width, live; a sideways scroll is noted (below)          |

Every page but the two lineup ones adds `intro=0`. A page passes when its main view shows (with
its WebGL canvas), it logs no console error, throws no uncaught exception and has no serious or
critical violation of axe-core's WCAG 2.2 A/AA rules (`scripts/axe.mjs`; lesser ones are notes);
an uncaught exception fails it at once. The phone is Playwright's iPhone 17 profile (402 px wide, touch,
Safari's user agent), drawn by Chromium: the layout an iPhone gets, not WebKit's rendering. On it
the run notes a page wider than the screen without failing it: on main the live screen's header
is (436 px for the hero, 595 px for match-1 while streaming), and the check becomes a failure once
that layout is fixed. The checks find controls by role and accessible name, as a screen reader
does, so a new layout or style does not break them; a renamed control does, and the test changes
with it. Requests to other hosts (the web fonts) are answered empty, so a run needs no network. A
screenshot of each page, and the API's log, go to `out/smoke/`. About 3 minutes, a quarter of it
the API's warm start.

`-- --api http://localhost:8765` uses an API that is already running, `-- --only match` runs the
pages whose name contains `match`, `-- --headed` shows the window. CI runs it in the `smoke` job,
with playwright-core's own Chromium (`npx playwright-core install --no-shell chromium`, cached
per playwright-core version), and keeps `out/smoke/` as the `web-smoke` artifact.
