# Stadium Screen Studio

`?studio=1` opens a page of its own: what a stadium's screens would show through a matchday, in
the way a stadium's screen crew plans the boards. `?studio=1&wall=1` opens it with the flat
Screen wall alone and no 3D stadium (for slow GPUs, or no WebGL).

## Screens (`formats.ts`)

| Screen            | Format | Render target | In the 3D bowl                                       |
| ----------------- | ------ | ------------- | ---------------------------------------------------- |
| Main video board  | 16:9   | 1280 × 720    | on the left end stand's roof, on two legs            |
| Tunnel LED        | 9:32   | 360 × 1280    | beside the players' tunnel, far side, on the ground  |
| Ribbon board      | 40:1   | 2560 × 64     | along the far stand's upper-tier fascia              |
| Concourse A and B | 16:9   | 960 × 540     | under the left end's roof, standing in for concourse |

Each screen has one canvas. The 3D preview shows it as a texture and the Screen wall shows the
canvas element itself. A canvas is drawn only when its content changes, never once per frame, and
its texture is uploaded again only then.

## Content (`content.ts`, `draw.ts`)

- **Tactical replay still**: everyone where they were at the hero's decision, plus his pass.
  Positions and shirt numbers come from `hero_seed3.json`.
- **Stat card**: verified lines, shown whole or left out. The big figure is cut from the first
  line's text. The goal's card fills a sentence template from the scorer's supported claim
  (`side`, `before`).
- **Walk-out**: a player's fictional name, number and club, in his kit's colours
  (`data/roster.ts`, `players/kit.ts`).
- **Sponsor slot**: three invented sponsors with generated wordmarks (a geometric mark and the
  name). Every sponsor screen says "Fictional sponsor".

Sources, all bundled in `public/data` and read offline: `hero_seed3.json`, `steps_seed3.json`,
`without_look_seed3.json` and `without_look_far_post_finish_seed11.json` (the goal of match-1,
SPEC 3.6). The studio calls no API and no model.

## Rules (`rules.ts`)

`assignScreens(event, index)` is a pure function. For each event type (walk-out, key look, press
win, corner, goal, half-time), every screen has a list of content kinds in order of preference,
and the first kind the event can fill wins. The goal's main board and tunnel always show the
scorer, never a sponsor. The ribbon never shows the board.

The timeline's programme has one event of each type. The key look (`blind_side_run` seed 3) and
the goal (`far_post_finish` seed 11) are moments in the bundled files. The press win and the
corner are marked **rehearsal cues**: the bundled files hold no such moment, so their screens show
only sponsors and no match facts.

## Numbers

Every digit on a screen is a supported claim's value or a shirt number from the export.
`draw.test.ts` draws every screen of every event and checks each digit against
`allowedNumbers`.

The sponsor-slot table under the wall counts each sponsor's screen slots from the rules. It is
not a match fact, so it carries the label **"Demo data: simulated audience, not real results"**.
The studio has no audience, reach or sales figures.

## No strobe (WCAG 2.3.1)

A screen whose content changes fades slowly: it dips to 30 % brightness over 0.6 s, swaps its
picture at the bottom of the dip, then comes back up. With `prefers-reduced-motion` it cuts. The
screens change at most once every 1.5 s, however fast the timeline is scrubbed. One dip per
change is under one luminance pair a second; the guideline allows three. There is no blur and
there are no white flashes. A camera preset is a cut, not a flight.
