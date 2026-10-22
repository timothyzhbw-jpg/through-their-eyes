# Title cards

Full-frame title cards and lower-thirds for the trailer (SPEC 10). Each template is a
fixed 1920×1080 HTML page. The edit engine seeks it to an exact time and screenshots
that frame; nothing on the page follows the wall clock.

Preview every template, scaled, with a time scrubber:

```bash
open video/titles/index.html
```

The scrubber calls `seek` on all of them. Before the first scrub they play through once
on the document clock; after a scrub they stay parked on that time. **Replay** reloads
them. The sample params in the gallery are `samples.json` (also embedded in
`index.html`, so the page works from a `file://` URL). Placeholder numbers in that file
(`0.0`, a few timings) are samples only. Default on-screen copy has no digits: a number
arrives through a param.

## How a frame is chosen

`titles.js` exposes `window.__title`:

- `setup(params)` builds the DOM, then waits for `document.fonts.ready` (Anton and Bebas
  Neue, loaded from `./fonts/`). `ready` becomes true after that.
- `seek(t)` pauses every animation from `document.getAnimations()` and sets
  `currentTime` to `t * 1000` milliseconds.

Motion is CSS animations and Web Animations with explicit delays and durations.
Entrances use `fill: both`, so a seek during the delay shows the start pose. Exits
use `forwards` only, so the hold is not restyled by the exit. The check's ring burst
uses `forwards` too, and stays invisible until it fires. There is no `setTimeout`,
`requestAnimationFrame`, `Date` or randomness. The same `t` is the same pixels.
Easing for settles is `cubic-bezier(0.16, 1, 0.3, 1)`.

Grammar shared by the pages: a slam (scale 1.25 to 1 in 140 ms, one-frame overshoot,
motion blur), a hard wipe whose edge is 12° off vertical, a thin gold underline that
sweeps (no white flash: nothing flashes the screen, for photosensitivity), and a red/cyan text-shadow that closes over
150 ms. Exits, where a template has them, are `cut`, `fade`, `wipe` and `slam-out`.

Colours, from the app: night `#080e0b`, chalk `#efede5`, floodlight gold `#f6d566`,
dusk `#95a7ba`, flare `#ef774b`. Card red `#e8332a` is used only by the red card.
Headlines are Anton, uppercase. Kickers, labels and small caps are Bebas Neue.

Alpha templates leave `html` and `body` transparent. Opaque templates paint their own
background. The engine passes `title.alpha` separately; it must match the table below
or the encode will flatten a transparent plate (or try to keep alpha in a jpeg).

## Templates

Params are plain text. A missing timing falls back as noted. Colours are names:
`chalk`, `gold`, `dusk`, `flare`.

| Template | Plate | What it is | Params |
|---|---|---|---|
| `slam.html` | alpha | One to three headlines slamming in, optional kicker, gold underline, then an exit | `lines` `[{text, color?, size?}]` (size is px, default 150), `kicker?`, `stagger` (seconds, default 0.35), `align` `center` \| `left` \| `lower-left`, `hold?`, `out?` (default `fade`), `backdrop?` (soft dark gradient behind the type) |
| `card.html` | opaque | The same stack on black, with a slow floodlight sweep. For "SEE WHAT THEY SAW." and "Every touch starts with a look." | slam's params, plus `sub?` (Bebas line under the underline) |
| `freeze.html` | alpha | POV stat: a big value, a label, a gold bracket that snaps shut | `items` `[{label, value, unit?, color?}]` (one or two), `title?` |
| `verified.html` | alpha | Up to four lines, the number in gold, then a check stamp on each number (scale 2 to 1, rotate −10° to −4°, a ring burst) | `kicker`, `items` `[{before, value, after}]`, `stagger` (default 0.45), `note` (one plain line under them, no number) |
| `refuted.html` | alpha | A wrong value in flare, a flare cross slamming over it, a strike-through, then a stamp | `before`, `value`, `after`, `stamp`, `kicker?` |
| `lineup.html` | opaque | The crew as six tall angled cards, left to right. Gold edge light as each one lands. `highlight` pushes that card forward | `header`, `cards` `[{name, job, glyph}]`, `highlight?` (a name), `stagger?` (default 0.18). `glyph`: `director`, `analyst`, `telestrator`, `narrator`, `verifier`, `voice` |
| `redcard.html` | alpha | A red card rises from the bottom right and shakes, then the line slams in | `title`, `sub` |
| `subboard.html` | alpha | A substitution board. Dot-matrix Bebas (a radial-gradient mask) for an OFF name in flare and an ON name in gold | `off`, `on`, `caption` |
| `tag.html` | alpha | A small lower-left tag: a gold bar wipes in, the words slam onto it | `text`, `sub?`. Both use `"Bebas Neue", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`, so CJK in either field renders with the first of those faces the machine has |
| `spec.html` | opaque | Architecture as a spec sheet: grid, hairlines, a scan light per row. One column up to ten rows, two beyond | `header`, `rows` `[{label, value, note?}]` (up to ten), `footer?`, `backdrop` (over a picture: dark on the left where the rows are) |
| `end.html` | opaque | The name, a gold underline sweep, the tagline, the URL in Bebas, then credit lines | `name`, `tagline`, `url`, `lines` (strings), `legal`, `cta` and `qr` (an https address, drawn as a QR code bottom right by qrcode-generator) |
| `countdown.html` | alpha | "Your call." A ring drains over `secs` seconds with a gold pulse. No digits are drawn | `label`, `sub`, `secs` |
| `caption.html` | alpha | A burned-in voice-over caption: Bebas in a dark box low in the frame, numbers in gold, a short rise in and a fade out at `dur`. The trailer fills these itself, one per line | `text`, `dur`, `side` `center` \| `right` (right while a title holds the lower left) |
| `label.html` | alpha | A small steady corner note under the top letterbox bar, e.g. "IN-ENGINE · RENDERED FROM OUR SIMULATION DATA" | `text` |

### When things land

Times are seconds from `setup`, before the engine's `seek`.

- **slam / card.** Line `i` starts at `(kicker ? 0.22 : 0) + i * stagger` and slams for 0.14 s. The underline starts 0.1 s after the last line. `sub` starts 0.22 s after the last line. The exit starts at `lastLineStart + 0.16 + hold`. If `hold` is omitted it defaults to 60, so a normal shot holds the settled card and the exit stays past the end of the clip. Pass `hold` when the card should clear itself.
- **freeze.** Bracket corners lock by about 0.3 s. Values slam from 0.12 s.
- **verified.** Lines from 0.2 s, `stagger` apart, then the note. Stamps start once the lines are in (`0.2 + n * stagger + 0.12`), then every 0.32 s.
- **refuted.** Line 0.16 s, cross 0.5 s, strike 0.7 s, stamp 0.92 s.
- **lineup.** Header at 0. Cards from 0.16 s, `stagger` apart (default 0.18), each sliding for 0.42 s.
- **redcard.** The card lands and shakes inside 0.64 s. Title at 0.7 s, sub at 0.9 s.
- **subboard.** OFF flips at 0.12 s, the arrow at 0.4 s, ON at 0.52 s, the caption at 0.86 s.
- **tag.** Bar from 0. Text at 0.16 s, sub at 0.3 s.
- **spec.** Header at 0. Rows from 0.28 s, 0.08 s apart. Footer just after the last row.
- **end.** Name at 0, underline at 0.16 s, tagline at 0.42 s, URL and the QR block at 0.62 s, credits from 0.95 s every 0.16 s.
- **countdown.** The label slams at 0. The ring goes from full to empty across exactly `secs` seconds. Give the shot at least that long.

## Renderer

`video/lib/titles.mjs` opens `file://…/video/titles/<template>.html` in a new context
(viewport from the caller, device scale 1), calls `setup`, waits until `ready`, and
records `title.dur` seconds. `video/lib/cine.mjs` does the same for a page that exposes
`window.__cine` (`load` then `render`). `video/lib/frames.mjs` is the pipe: jpeg into
H.264 (`-crf 12 -preset medium -pix_fmt yuv420p`) or a transparent png into ProRes 4444
(`-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le`). It writes each frame to
ffmpeg's stdin and waits on backpressure. A failed ffmpeg rejects with its last 40
stderr lines.

## Fonts

Anton (Anton Project Authors, 2020) and Bebas Neue (Dharma Type, 2010). Both are SIL
Open Font License 1.1. The faces are `fonts/Anton-Regular.ttf` and
`fonts/BebasNeue-Regular.ttf`; the licence texts are the `*-OFL.txt` files beside them.
No font is fetched from the network.

CJK in `tag` uses whatever the machine has of PingFang SC, Noto Sans CJK SC or Microsoft
YaHei. Those are not in the repo. A machine with none of them falls back to a generic
sans, so a CJK tag is only identical across machines that share one of those faces.
