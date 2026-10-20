# web/ — the breakdown player (SPEC 7)

Replays a hero moment in two views — a 3D view filmed in first person through the player's eyes
or from a broadcast camera, and a tactical board from above — and plays a `TelestrationPlan`
(SPEC 6) over them. Everything is synthetic: the
match comes from `sim/`, the clubs and players are fictional.

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
npm test             # plan validation, executor, comfort-mode yaw
npm run typecheck
npm run build        # -> web/dist (static files for the Azure Storage static website)
npm run format       # prettier
npm run licenses     # fails on any dependency outside MIT / BSD / Apache-2.0 (and ISC, 0BSD)
```

## URL parameters

Deep links for the README's tour for judges, and for testing and filming
(`src/deeplink.ts`, tests in `src/deeplink.test.tsx`). Parameters combine, e.g.
`?run=counterfactual&at=decision&view=tactical`.

| Parameter  | Values                                          | Effect                                                                                                     |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `persona`  | `casual`, `analyst`, `player_fan`, `coach`      | the audience the breakdown is asked for (live service only; offline the bundled breakdown is the only one) |
| `lang`     | `en`, `zh`                                      | the breakdown's language (live service only) and the What if box's answer language                         |
| `run`      | `factual`, `counterfactual`                     | with the look / without it                                                                                 |
| `view`     | `pov`, `tactical`, `split`                      | which view gets the space; a breakdown resets it to `split` when it starts                                 |
| `at`       | a frame (25 Hz, from 0), `key-scan`, `decision` | open paused at that frame; `key-scan` is where the app opens by default, inside the key scan               |
| `ask`      | a question                                      | prefill the What if box's free question and scroll to it; it is sent only when the viewer presses Ask      |
| `autoplay` | `0`                                             | start neither the live stream nor the breakdown on load                                                    |
| `offline`  | `1`                                             | ignore the live service and play the bundled data                                                          |
| `plan`     | `invalid`                                       | load a deliberately broken plan to show the template fallback (bundled breakdown)                          |
| `rigged`   | `0`                                             | start with the tokens instead of the animated players                                                      |
| `camera`   | `broadcast`                                     | start on the broadcast camera, focused (for filming); a breakdown still cuts to first person               |

A link that points at a spot (`at`, `run` or `ask`) opens paused: no live stream and no
breakdown on load. Without them, the app watches live and then plays the breakdown, in the
linked `persona` and `lang` if given. Values the app does not know are ignored and listed in
the console.

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
    **Sound on** sends each caption's SSML to `POST /api/tts` (Azure AI Speech) and plays the WAV as
    the line comes up; clips are kept per cue. While the voice is off, a screen reader hears each
    caption from a polite live region.

The API's CORS allows only the static website's origin, so for `npm run dev` against the deployed
service let Vite forward the API paths (dev server only):

```bash
TTE_API_PROXY=https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io \
  VITE_API_URL=http://localhost:5173 npm run dev
```

## Data

The files in `public/data/` are written by

```bash
uv run python -m sim.export --scenario blind_side_run --seed 3 \
  --out web/public/data/hero_seed3.json \
  --payload-fixture web/public/data/fixture_payload_seed3.json \
  --what-if web/public/data/whatif_seed3.json
```

- `hero_seed3.json`: the replay (schema version 5, with blind-side alerts and the scan detector's
  output: integer mm, 1e-4 rad and 1e-4 rad/s, origin at the centre spot, home attacks +x).
  `src/data/hero.ts` converts it once into typed arrays in metres and radians.
- `fixture_payload_seed3.json`: a **fixture** render payload (SPEC 5.3) for the same moment,
  marked `"fixture": true`. Its claim values are computed from the replay by
  `sim.export.render_payload_fixture`, following `explain.builders` (claim ids, value slots,
  evidence) and `explain.render` (seek frame = earliest evidence event), but no verifier has
  checked them. The UI labels it "Fixture · not checked by the verifier". With the live service
  the verified payload from `POST /api/breakdowns` replaces it; the fixture stays as the offline
  fallback.

- `whatif_seed3.json`: every option of the hero's decision forced and re-simulated
  (`sim.export.export_what_ifs`): the suggested question in en and zh, the verified answer from
  `agents.whatif.answer_question` (a real SPEC 5.3 payload, not a fixture), and the forced run from
  the decision on (players and ball, mm) for the ghost path. The suggested questions use it online
  and offline; free questions go to the api's live what-if, which uses its forced runs for the
  ghost.

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
  plan/       TelestrationPlan schema (zod), validation + template fallback, executor
  narration/  render payload schema (zod), checks against the moment, kind labels
  telemetry/  perception telemetry for the POV player: curves, detector marks, readouts
  views/      PovView (first person and broadcast) and TacticalView (React Three Fiber), their
              toolbars and HUD, the broadcast camera and the stadium
  ui/         transport + timeline, caption + evidence card + narration list, panels, console
  session.ts  one Session per moment: data + stores + plan runner + live feed + voice + controls
  deeplink.ts URL parameters: parsed once, applied to the session before the first render
  testing.tsx test stand-ins: routed fetch, scripted WebSocket, API responses, server rendering
```

- **One store, many readers.** `store/playback.ts` holds what is on screen now. Views only read
  it. Two things write it: user controls (`session.ts`) and the plan executor (`plan/runner.ts`).
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
- **Broadcast camera** (SPEC 7: high side angle, follows the ball, smoothed). The **Broadcast**
  switch in the 3D view's toolbar, or a plan's `camera` step with mode `broadcast`, films the same
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
- **Stadium** (`views/Stadium.tsx`), generated, around both 3D cameras: a two-tier bowl under a
  roof, about 15,000 instanced spectators in one draw call, four floodlight masts with a glow
  sprite, boards with our own words only ("Through Their Eyes", "Synthetic match", "All players
  fictional"), a night-sky gradient, and four faint floodlight shadows per player. It is dark and
  hazed on purpose; glow and shadows are faked (sprites and decals, no bloom pass or shadow maps)
  and the 3D view uses ACES tone mapping.
- **Tactical board.** An orthographic camera straight down. Layers are drawn in a fixed order
  with depth testing off, like a 2D canvas, so GLSL overlays such as pitch control can be added
  as further layers. The vision cone is already a fragment shader of the sim's FOV model
  (angular term and distance decay of `analytics/vision.py`; occlusion not yet).
- **Verified narration you can open** (SPEC 7). Captions come from the render payload; a plan's
  voice steps name its line ids. Click a caption (or any line in the Narration panel) and the
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
  the tokens); **Animated players** in the toolbar switches back to the tokens. They are an
  animated footballer converted from Gameplay Football (`src/players/`,
  `public/models/README.md`, SPEC 7): gait blended by sim speed with the playback rate
  matched so the feet do not slide, the pass clip on pass events, the neck (then the trunk)
  turned so the head points along `head_yaw`, kits in the fictional clubs' colours.
- **Perception telemetry** (SPEC 4.7, 7). Under the timeline, curves for the player in the
  first-person view ("Whose eyes"), with a cursor on the playhead: head angle to the ball with
  his scans from the sim (the key scan highlighted; without the look, a dashed box where it
  was), head angular speed with the scan detector at work (its threshold, candidate onsets, the
  onsets its excursion gate rejected, and the scans it accepted), players in his sight, and, for
  the hero only, belief error on the runner (his ghost to the true position; "n/a" for anyone
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

Transitive exceptions, reviewed by hand: `lightningcss` (Vite's CSS minifier) is MPL-2.0, used
unmodified at build time only (allowed by CLAUDE.md); `webgl-constants` (via drei → detect-gpu)
has no licence field in its package.json, its LICENSE file is MIT.

Fonts (Barlow, Saira Condensed, IBM Plex Mono) are loaded from Google Fonts at runtime, as in
`demo/`; they are under the SIL Open Font License and are not bundled.
