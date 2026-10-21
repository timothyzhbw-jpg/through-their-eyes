# Credits — demo video (SPEC 10)

Everything in the video is our own synthetic match rendered by our web app, our own title cards
and our own synthesized sound effects, plus the CC0 music and the OFL fonts below. No real
footage, players, clubs, leagues, broadcasters, logos or brand fonts. The edit
(`npm run trailer`, see [README.md](README.md)) downloads each external file from the link
below and checks its SHA-256 (`assets.json`) before using it.

## Music

| Track | Author | Licence | Link | Used |
|---|---|---|---|---|
| Unsolicited trailer music (loop edit) | Emma_MA | CC0 1.0 | https://opengameart.org/content/unsolicited-trailer-music | yes (default) |
| Generic trailer music | Emma_MA | CC0 1.0 | https://opengameart.org/content/generic-trailer-music | candidate |
| Digital Acid (glitch hop) | Xenocity (Deva) | CC0 1.0 | https://opengameart.org/content/xenocity-digital-acid-glitch-hop | candidate |

CC0 needs no attribution; the end card credits the track anyway. Licences checked on each
page on 2026-10-21.

## Original score

The alternative to the tracks above: a score composed for this project in code
([`score/`](score/README.md)), in two variants (grime, hybrid). End-card credit: "Original score
composed for this project". No samples from existing songs and no AI music generators.

| Part | Source | Licence |
|---|---|---|
| Composition, arrangement, mix and master | [`score/`](score/) in this repository | MIT |
| Drums, basses, synths and effects | synthesised in numpy by [`score/synth.py`](score/synth.py); no recorded samples | MIT |
| Strings, brass, horns, choir, timpani, orchestra hit | Fluid (R3) General MIDI SoundFont by Frank Wen, `FluidR3_GM.sf2` from Debian's `fluid-soundfont` 3.1 source package (https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont_3.1.orig.tar.gz; SHA-256 in [`score/assets.json`](score/assets.json)) | MIT |
| Rendering of the SoundFont parts | FluidSynth 2.6 (Homebrew), run as a tool, not distributed | LGPL-2.1 |
| MIDI files, signal processing | pretty_midi and mido (MIT), numpy and scipy (BSD-3-Clause) | MIT / BSD |

The SoundFont's notice, from the package's `COPYING`: "Copyright (c) 2000-2002, 2008 Frank Wen
<getfrank@gmail.com>", released under the MIT license. Licence checked on 2026-10-21.

## Sound effects

All synthesized by [`lib/sfx.mjs`](lib/sfx.mjs) in this repository (MIT): heartbeat, stadium
hum, whoosh, riser, boom, stamp, slam, whistle, tick, rewind, glitch, shutter, sting. No
recorded samples.

## Fonts

| Font | Licence | Files |
|---|---|---|
| Anton | SIL Open Font License 1.1 | [titles/fonts/Anton-Regular.ttf](titles/fonts/Anton-Regular.ttf), [licence](titles/fonts/Anton-OFL.txt) |
| Bebas Neue | SIL Open Font License 1.1 | [titles/fonts/BebasNeue-Regular.ttf](titles/fonts/BebasNeue-Regular.ttf), [licence](titles/fonts/BebasNeue-OFL.txt) |

Both from https://github.com/google/fonts (`ofl/anton`, `ofl/bebasneue`). The app's own screens
use Newsreader, Geist, Geist Mono, IBM Plex Mono and Saira Condensed (all SIL OFL, from Google
Fonts), as the web app loads them.

## Voice

Narration: Azure AI Speech neural voices (`en-US-ChristopherNeural`; the Chinese line is the
app's own verified narration in `zh-CN-YunjianNeural`), synthesized through the project's own
speech setup (`video/tts.py` → `api/tts.py`).

## Footage

None. Every frame is the synthetic match rendered by our web app: the live site recorded by
`capture.mjs`, and its cinematic mode (`?cine=1`) driven frame by frame.
