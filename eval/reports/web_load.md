# Web load time and smoothness (SPEC 7, 8)

`cd web && npm run build && npm run loadperf` (the live site) and `npm run loadperf -- --serve <dir>`
(a build served as Storage serves it, on the site's own origin inside Chrome, so the API, the live
stream and the fonts behave as live). Each load is a fresh headless Chrome with an empty cache, on
an Apple M4 Pro (Metal). "Players" is the first frame after the rigged players' model has loaded
whose WebGL draw calls jump by 20 or more (the 22 players; the tokens are hidden until then).
"Fast 3G" is DevTools' preset (1.44 Mbps down, 562.5 ms per round trip, called "Slow 4G" in newer
Chrome) with a 4× CPU slowdown. "Broadband" adds 100 ms per round trip at 20 Mbps, about what this
Mac gets from the site, to local builds that otherwise have no network. All data synthetic.

**Before:** `main` at 0bc05a8, the bytes the live site served on 2026-10-21 (same file hashes),
everything uncompressed with `Cache-Control: public, max-age=300`. **After:** the same with the
staged upload: gzipped batches, each with its Content-Type named, `index.html` last with
`no-cache` after every other file has been read back from the site (`infra/upload_web.sh`,
`web/scripts/stage.mjs`, `web/scripts/check-site.mjs`); "Loading the match…" in the HTML; the API's
connection opened while the scripts download (`preconnect`); the players' model fetched with the
scripts; the telemetry panel idle while off screen or in a hidden tab, its curves built once per run
and player.

Measured 2026-10-21 at load averages 6 to 20, before and after alternating, median of 3 (5 for the
unthrottled rows). A first pass the same afternoon, at load averages 40 to 214 from other
sessions' renders, gave the same network-bound numbers within 0.5 s.

## Fast 3G, 4× CPU

| page | device | first paint s | first draw s | players s | bytes KB | offline |
|---|---|---:|---:|---:|---:|---|
| `/` | phone 375 × 812 | 11.28 → **1.60** | 15.85 → **8.01** | 18.24 → **8.13** | 2549 → **799** | 0/3 → 0/3 |
| `/` | laptop 1440 × 900 | 11.23 → **1.60** | 15.75 → **8.15** | 18.20 → **8.33** | 2561 → **811** | 0/3 → 0/3 |
| `/?match=match-1` | phone | 11.27 → **1.60** | 32.36 → **23.17** | 34.39 → **23.32** | 2814 → **1062** | 3/3 → 3/3 |
| `/?match=match-1` | laptop | 11.24 → **1.60** | 32.40 → **23.07** | 34.49 → **23.23** | 2826 → **1075** | 3/3 → 3/3 |

The live site measured the same afternoon: `/` on the phone, first paint 11.48 s, players
18.31 s. On 3G `match-1` still falls back to the bundled hero ("offline"): the API's match export
is 4 MB gzipped, more than the 15 s the app waits for it. That is the API's payload, not the site's;
see "Not done".

Re-checked on the final staged upload (types named, `[name].[hash]` files, 5-minute cache), 2
pairs: phone on Fast 3G, players 18.11 → **7.93 s**; laptop on broadband, 2.06 → **1.25 s**.

## Broadband

| page | device | first paint s | first draw s | players s | bytes KB |
|---|---|---:|---:|---:|---:|
| `/` | laptop | 0.98 → **0.32** | 1.73 → **1.21** | 2.02 → **1.31** | 2561 → **1084** |
| `/` | phone | 0.98 → **0.32** | 1.77 → **1.19** | 2.07 → **1.29** | 2549 → **1072** |
| `/?match=match-1` | laptop | 0.99 → **0.34** | 3.72 → **3.15** | 3.82 → **3.24** | 7472 → **5994** |
| `/?match=match-1` | phone | 0.99 → **0.32** | 3.62 → **3.02** | 3.93 → **3.11** | 7460 → **5982** |

With no network at all (local, unthrottled, 5 pairs) both builds draw the players in 0.7 to 0.9 s
(laptop 0.79 → 0.83 s, phone 0.71 → 0.73 s, within one run's spread): there is nothing to save
there, and nothing is lost.

## Bytes on the wire, `/` on the laptop (KB)

| | JS | CSS | JSON | players' model | fonts (Google) | total |
|---|---:|---:|---:|---:|---:|---:|
| before | 1643 | 89 | 393 | 76 | 358 | 2561 |
| after | 462 | 19 | 219 | 24 | 358 | 1084 |

JSON after: the API's hero export (already gzipped by the API, 118 KB) and the bundled what-ifs and
fixture, now gzipped (whatif_seed3.json 269 → 93 KB). On 3G the fonts arrive after the players
(73 to 85 KB of them by then).

## Largest contentful paint

Chrome's LCP entries over 25 s, live site (before), 2 runs each. LCP counts text and images, not
the WebGL views, which are this page's main content.

- `/` unthrottled: the lineup card's text, 1.7 to 1.9 s ("Home v Away" on the laptop,
  `p.lineup-pitch` on the phone).
- `/` on 3G: 16.7 s on the phone (the lineup card, when the app first renders); 24 s on the laptop,
  where the lineup heading is first painted in the fallback font (68,875 px² instead of 81,367) and
  the first narrated caption (76,380 px²) outgrows it later. After #115 the app first renders at
  about 8 s, and the phone's LCP with it: 16.4 → 8.7 s (to the players plus 1.5 s).
- `?intro=0`: always the first caption, 9 to 11 s unthrottled, about 25 s on 3G. The moment card's
  heading is first visible as "Watching the stream." (smaller), and the title that replaces it at
  about 8 s is the same element, which LCP does not record twice. The one frame of the title before
  the stream starts is painted at opacity 0 by its entrance animation: nobody sees it.

Not changed: pinning it earlier would need per-platform font-metric fallbacks for Newsreader or a
smaller caption. `npm run loadperf` now records the entries (`--settle 25` watches long enough).

## Main thread

| | before | after |
|---|---:|---:|
| Main thread busy while the hero plays at 1×, 4× CPU, telemetry off screen (4 pairs) | 739 ms/s | 704 ms/s |
| Same, telemetry on screen (4 pairs) | 788 ms/s | 695 ms/s |
| Blocking time until the players, phone, Fast 3G (3 pairs) | 510 ms | 500 ms |

Both builds keep 60 fps at 4× CPU at this load. The telemetry panel rebuilt every curve's SVG path
on every frame, on screen or not; it now builds them once per run and player and holds still off
screen. The rest of a frame is the views themselves (first-person scene about 140 ms/s and rigged
players' bones 50 to 70 ms/s at 4× in a CPU profile). A hidden tab already does almost nothing: the
clock and both canvases run on `requestAnimationFrame`, which the browser stops; only the live
stream's messages re-rendered the telemetry panel, which now holds still. The board hidden by "His
eyes" alone draws nothing (profiled). Blocking time before the players is the same work either way
(parsing the scripts, the first render, the shaders), now done 10 s sooner.

`npm run fps` (1920 × 1080, 2 runs each): 60 fps capped in every row, median frame 16.7 ms and p95
16.7 to 16.8 ms, before and after. Pitch-control shader alone: 0.09 ms per draw at the board's size
both; 0.52 and 0.59 ms at full HD (the shader is unchanged). The GPU parity tests pass (10
snapshots, max abs diff below 0.02).

## No visual change

Screenshots of the hero moment (offline and live data) and `match-1` at frame 750, laptop and
phone, main at 44c0bb5 with and without #115: the telemetry panels are identical pixel for pixel;
the live screen differs in 0.006% to 0.21% of pixels, all in the crowd's flicker and the board's
pulsing rings, as much as two runs of the same build differ (0.007% to 0.27%). Phone: no
horizontal scroll (`scrollWidth − innerWidth = 0` on every page). `npm run smoke`: 15 of 15 pages.

## Headers

| files | before | after |
|---|---|---|
| `assets/*.js`, `*.css` (hashed) | raw, `public, max-age=300` | gzip, `text/javascript` / `text/css`, `public, max-age=300` |
| `data/*.json`, `models/*.glb` | raw, `public, max-age=300` | gzip, `application/json` / `model/gltf-binary`, `public, max-age=300` |
| `index.html` (also the 404 page) | `public, max-age=300` | `text/html`, `no-cache`, uploaded last |

No Azure setting changes: Content-Type, Content-Encoding and Cache-Control are blob properties set
at upload, and `infra/upload_web.sh` reads every one back from the site before `index.html` goes
up. A year's `immutable` on the hashed files would save a revalidation per file on a repeat visit;
it waits until the check has run clean on a few deploys.

## The first deploy (2026-10-21)

The first version of this change (#115) uploaded the gzipped batches with `--content-encoding gzip`
and no `--content-type`. `az storage blob upload-batch` guesses a type from the extension only when
no encoding is given (`guess_content_type` in azure-cli 2.91's storage module), so every gzipped
file went up as `application/octet-stream`. Browsers refused the module scripts ("Expected a
JavaScript-or-Wasm module script but the server responded with a MIME type of
application/octet-stream"), the page stayed on "Loading the match…", and the PR desk reverted it
(#138). The local measurements above could not see it: `loadperf`'s stand-in server set the type
from the extension. Now:

- every batch names its type, and `tests/test_upload_web.py` stores blobs the way az does (with
  the guess rule) and serves them the way the static website does;
- `index.html` goes up only after every other file reads back from the site with its type,
  encoding, cache and bytes; then the page must draw in headless Chrome or the previous
  `index.html` goes back up. Reproduced locally by dropping the types: the read-back lists every
  file as `application/octet-stream` and refuses, and Chrome shows the same error as the live
  site;
- that deploy cached its files for a year (`immutable`) in any browser that loaded them, so the
  hashed files are named `[name].[hash]` instead of `[name]-[hash]`, and the cache is 5 minutes;
- `loadperf --serve` sends the type each batch names, and az's octet-stream where it names none.

## Not done, by measurement

- **Code-splitting** the recap, the stats panel and Your call: the first screen's JS shrank by
  7.6 KB gzipped (0.04 s on Fast 3G); Your call's module stays in the first load because its
  header button imports it. Each split view would cost a round trip when opened (0.6 s on 3G).
  Cine mode is already a lazy chunk; the judge tour has a button on the first screen.
- **meshopt or Draco** for the players' model: it is 78 KB with no textures; gzip makes it 24 KB.
  A decoder would cost about what it saves.
- **Fonts** (358 KB from Google Fonts, cached a year there): narrowing the axes risks the type's
  look; they are not on the path to the first draw.
- **`match-1` on slow networks:** its export is 4 MB gzipped (11.6 MB of JSON), about 22 s on
  Fast 3G, past the app's 15 s export timeout. Shrinking it is API work.
