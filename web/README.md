# web/ — the breakdown player (SPEC 7)

Replays a hero moment in two views — first person through the player's eyes, and a tactical board
from above — and plays a `TelestrationPlan` (SPEC 6) over them. Everything is synthetic: the
match comes from `sim/`, the clubs and players are fictional.

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
npm test             # plan validation, executor, comfort-mode yaw
npm run typecheck
npm run build        # -> web/dist (static files for Azure Static Web Apps)
npm run format       # prettier
npm run licenses     # fails on any dependency outside MIT / BSD / Apache-2.0 (and ISC, 0BSD)
```

URL parameters: `?autoplay=0` does not start the breakdown on load; `?plan=invalid` loads a
deliberately broken plan to show the template fallback.

## Data

Both files in `public/data/` are written by

```bash
uv run python -m sim.export --scenario blind_side_run --seed 3 \
  --out web/public/data/hero_seed3.json \
  --payload-fixture web/public/data/fixture_payload_seed3.json
```

- `hero_seed3.json`: the replay (schema version 2: integer mm and 1e-4 rad, origin at the centre
  spot, home attacks +x). `src/data/hero.ts` converts it once into typed arrays in metres and
  radians.
- `fixture_payload_seed3.json`: a **fixture** render payload (SPEC 5.3) for the same moment,
  marked `"fixture": true`. Its claim values are computed from the replay by
  `sim.export.render_payload_fixture`, following `explain.builders` (claim ids, value slots,
  evidence) and `explain.render` (seek frame = earliest evidence event), but no verifier has
  checked them. The UI labels it "Fixture · not checked by the verifier". It goes away once the
  api serves payloads from `explain.render.build_payload`.

Regenerate both whenever `sim/` changes; `tests/test_export.py` fails if a committed file falls
behind the generator.

## How it fits together

```
src/
  data/       load the export, sample any player at a fractional frame, eased head yaw
  store/      the playback store: mode, frame, speed, toggles, POV player, focus, open line
  plan/       TelestrationPlan schema (zod), validation + template fallback, executor
  narration/  render payload schema (zod), checks against the moment, kind labels
  views/      PovView and TacticalView (React Three Fiber), their toolbars and HUD
  ui/         transport + timeline, caption + evidence card + narration list, panels, console
  session.ts  one Session per moment: data + store + plan runner + user controls
```

- **One store, many readers.** `store/playback.ts` holds what is on screen now. Views only read
  it. Two things write it: user controls (`session.ts`) and the plan executor (`plan/runner.ts`).
  A `requestAnimationFrame` clock calls `runner.tick(dt)` then `advance(dt)` once per screen
  frame. Any transport control stops a running breakdown and hands control back to the viewer.
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
- **Body and head yaw on every player.** In first person a token is a capsule body turned to
  `body_yaw` with a head on top turned to `head_yaw` (relative to the body, never clamped); a white
  visor marks the front of the head, so a look over the shoulder is visible on anyone in view. On
  the tactical board a short white tick shows each player's head direction. `views/tokens.ts`
  holds the pose maths; its test checks the rendered world yaw against the export (< 1e-3 rad).
  The skinned humanoid model is a separate, later card; this is its fallback.
- Belief ghosts exist for the hero only (the export records his beliefs); "who is in sight" is
  exported for every player, so the POV picker works for all 22.

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
