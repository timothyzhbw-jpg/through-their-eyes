# Web load time and smoothness (SPEC 7, 8)

`cd web && npm run build && npm run loadperf` (live site) and `npm run loadperf -- --serve <dir>`
(a build served as Storage serves it, on the site's own origin inside Chrome, so the API, the live
stream and the fonts behave as live). Each load is a fresh headless Chrome with an empty cache, on
an Apple M4 Pro (Metal). "Players" is the first frame after the rigged players' model has loaded
whose WebGL draw calls jump by 20 or more (the 22 players; the tokens are hidden until then).
"Fast 3G" is DevTools' preset (1.44 Mbps down, 562.5 ms round trip) with a 4× CPU slowdown.
Measured 2026-10-21. All data synthetic.

**Before:** the site sent everything uncompressed (`Cache-Control: public, max-age=300` on every
file). **After:** gzipped batches, hashed assets cached for a year, `index.html` last with
`no-cache` (`infra/upload_web.sh`, `web/scripts/stage.mjs`); "Loading the match…" in the HTML;
the API's connection opened while the scripts download (`preconnect`); the players' model fetched
with the scripts; the telemetry panel idle while off screen or in a hidden tab, its curves built
once per run and player.

## Fast 3G, 4× CPU (median of 3 cold loads)

| page | device | | first paint s | first draw s | players s | bytes KB | offline |
|---|---|---|---:|---:|---:|---:|---|
| `/` | laptop 1440 × 900 | live site, before | 10.78 | 15.40 | 17.83 | 2454 | 0/3 |
| | | local, before | 10.65 | 15.32 | 17.71 | 2453 | 0/3 |
| | | **local, after** | **1.60** | **7.91** | **8.08** | **780** | 0/3 |
| `/` | phone 375 × 812 | live site, before | 10.86 | 15.31 | 17.76 | 2442 | 0/3 |
| | | local, before | 10.68 | 15.19 | 17.62 | 2441 | 0/3 |
| | | **local, after** | **1.67** | **8.24** | **8.47** | **1041** | 0/3 |
| `/?match=match-1` | laptop | live site, before | 10.78 | 31.93 | 34.00 | 2719 | 3/3 |
| | | **local, after** | **1.58** | **23.08** | **23.27** | **1044** | 3/3 |
| `/?match=match-1` | phone | live site, before | 10.89 | 32.17 | 34.22 | 2707 | 3/3 |
| | | **local, after** | **1.60** | **22.96** | **23.08** | **1032** | 3/3 |

The local "before" (the same bytes as the live site: the build of `main` at 44c0bb5 has the live
site's file hashes) reproduces the live site within 1%, so the local "after" stands for the site
once deployed. On 3G, `match-1` still falls back to the bundled hero ("offline"): the API's match
export is 4 MB gzipped, more than the 15 s the app waits for it. That is the API's payload, not the
site's; see "Not done".

Re-checked after merging `main` at ad33a09 (judge tour, cine mode, accessibility, QA sweep), before
and after alternating, median of 3: phone on Fast 3G, players at 18.80 s → **8.49 s** (2499 →
784 KB); laptop on broadband, 2.08 s → **1.37 s** (2512 → 1069 KB).

## Broadband (median of 3, interleaved)

Local builds with 100 ms per round trip and 20 Mbps, roughly what this Mac gets from the site (a
live cold load here: players at 1.60 s on the laptop, 1.61 s on the phone).

| page | device | first paint s | first draw s | players s | bytes KB |
|---|---|---:|---:|---:|---:|
| `/` | laptop | 1.02 → **0.34** | 1.97 → **1.22** | 2.14 → **1.33** | 2453 → **1053** |
| `/` | phone | 0.98 → **0.39** | 1.72 → **1.23** | 2.03 → **1.31** | 2441 → **1041** |
| `/?match=match-1` | laptop | 0.99 → **0.41** | 3.73 → **3.29** | 3.90 → **3.39** | 7363 → **5963** |
| `/?match=match-1` | phone | 0.99 → **0.38** | 3.70 → **3.18** | 4.00 → **3.26** | 7351 → **5951** |

## Bytes on the wire, `/` on the laptop (KB)

| | JS | CSS | JSON | players' model | fonts (Google) | total |
|---|---:|---:|---:|---:|---:|---:|
| before | 1548 | 77 | 393 | 77 | 358 | 2453 |
| after | 433 | 17 | 219 | 24 | 358 | 1053 |

JSON after: the API's hero export (already gzipped by the API, 118 KB) and the bundled what-ifs
and fixture, now gzipped (269 → 93 KB).

## Main thread

The machine was shared with other sessions' video encodes, renders and evals (load average 40 to
214 on 14 cores), so CPU-bound numbers were taken with before and after runs alternating.

| | before | after |
|---|---:|---:|
| Blocking time until the players, phone, Fast 3G, 4× CPU (median of 6) | 1055 ms | 559 ms |
| Long tasks until the players, same (median of 6) | 1480 ms | 809 ms |
| Blocking time until the players, laptop, no throttling (median of 6) | 131 ms | 108 ms |
| Main thread busy while the hero plays at 1×, 4× CPU, telemetry off screen (median of 4) | 952 ms/s, 58.4 fps | 824 ms/s, 60.2 fps |
| Same, telemetry on screen (median of 4) | 982 ms/s, 56.3 fps | 901 ms/s, 59.7 fps |

The telemetry panel was the costliest React work per frame: it rebuilt every curve's SVG path on
every frame, about 30 ms/s at 4× CPU, while off screen as much as on it. A CPU profile of the rest:
the first-person scene's draw (about 140 ms/s at 4×) and the rigged players' bones (50 to 70 ms/s)
are the views themselves. A hidden tab already does almost nothing: the clock and both canvases run
on `requestAnimationFrame`, which the browser stops; only the live stream's messages re-rendered
the telemetry panel, which now holds still. The board hidden by "His eyes" alone draws nothing
(profiled: no time in its frame callbacks).

`npm run fps` (1920 × 1080, 2 runs, M4 Pro): 60 fps capped before and after; median frame 16.7 ms
and p95 16.7 to 16.8 ms in every row, both builds. Two rows after read 50.4 and 53.8 fps with the
same median and p95: single stalls under the machine's load. Pitch-control shader alone: 0.11 to
0.33 ms per draw at the board's size, 0.57 to 0.63 ms at full HD (the shader is unchanged). The
GPU parity tests pass (10 snapshots, max abs diff below 0.02).

## No visual change

Screenshots of the hero moment (offline and live data) and `match-1` at frame 750, laptop and
phone, before and after: the telemetry panels are identical pixel for pixel; the live screen
differs in 0.006% to 0.21% of pixels, all in the crowd's flicker and the board's pulsing rings,
as much as two runs of the same build differ (0.007% to 0.27%). Phone: no horizontal scroll
(`scrollWidth − innerWidth = 0` on every page). `npm run smoke`: 15 of 15 pages pass.

## Headers

| files | before | after |
|---|---|---|
| `assets/*` (hashed) | raw, `public, max-age=300` | gzip, `public, max-age=31536000, immutable` |
| `data/*.json`, `models/*.glb` | raw, `public, max-age=300` | gzip, `public, max-age=300` |
| `index.html` (also the 404 page) | `public, max-age=300` | `no-cache`, uploaded last |

No Azure setting changes: Content-Encoding and Cache-Control are blob properties set at upload.

## Not done, by measurement

- **Code-splitting** the recap, the stats panel and Your call: the first screen's JS shrank by
  7.6 KB gzipped (0.04 s on Fast 3G); Your call's module stays in the first load because its
  header button imports it. Each split view would cost a round trip when opened (0.6 s on 3G), and
  `App.tsx` is changed by ten open pull requests.
- **meshopt or Draco** for the players' model: it is 78 KB with no textures; gzip makes it 24 KB.
  A decoder would cost about what it saves. The app has no image textures (kits, numbers and the
  stadium are drawn at run time).
- **Fonts** (358 KB from Google Fonts, cached a year there): narrowing the axes risks the type's
  look; they are not on the path to the first draw.
- **`match-1` on slow networks:** its export is 4 MB gzipped (11.6 MB of JSON), about 22 s on
  Fast 3G, past the app's 15 s export timeout. Shrinking it is API work.
