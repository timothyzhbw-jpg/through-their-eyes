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

`public/data/hero_seed3.json` is the output of

```bash
uv run python -m sim.export --scenario blind_side_run --seed 3 --out web/public/data/hero_seed3.json
```

(schema version 2: integer mm and 1e-4 rad, origin at the centre spot, home attacks +x). Regenerate
it whenever `sim/` changes; `tests/test_export.py` fails if the committed file falls behind the
schema. `src/data/hero.ts` converts it once into flat typed arrays in metres and radians.

## How it fits together

```
src/
  data/       load the export, sample any player at a fractional frame, eased head yaw
  store/      the playback store: mode, frame, speed, toggles, POV player, focus, caption
  plan/       TelestrationPlan schema (zod), validation + template fallback, executor
  views/      PovView and TacticalView (React Three Fiber), their toolbars and HUD
  ui/         transport + timeline, story and decision panels, breakdown console
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
  the hero's reception. One step beyond the SPEC sketch: `play` (play on to a time), needed to
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
