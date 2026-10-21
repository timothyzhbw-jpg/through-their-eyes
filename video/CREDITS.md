# Credits — demo video (SPEC 10)

Everything in the video is our own synthetic match, rendered by our web app (and, for three
shots, in Blender from the same simulation data), our own title cards and our own synthesized
sound effects, plus the CC0 music and the OFL fonts below. No real
footage, players, clubs, leagues, broadcasters, logos or brand fonts. The edit
(`npm run trailer`, see [README.md](README.md)) downloads each external file from the link
below and checks its SHA-256 (`assets.json`) before using it.

## Music

| Track | Author | Licence | Link | Used |
|---|---|---|---|---|
| Unsolicited trailer music (loop edit) | Emma_MA | CC0 1.0 | https://opengameart.org/content/unsolicited-trailer-music | yes (default) |
| Generic trailer music | Emma_MA | CC0 1.0 | https://opengameart.org/content/generic-trailer-music | candidate |
| Digital Acid (glitch hop) | Xenocity (Deva) | CC0 1.0 | https://opengameart.org/content/xenocity-digital-acid-glitch-hop | candidate |
| Skill Test (album After Dark) | HoliznaCC0 | CC0 1.0 | https://freemusicarchive.org/music/holiznacc0/after-dark/skill-test/ | candidate |
| Pantheon (album PHONK - AURA FARMING) | HoliznaCC0 | CC0 1.0 | https://freemusicarchive.org/music/holiznacc0/phonk-aura-farming/pantheon/ | candidate |
| Shortcuts | Zane Little Music | CC0 1.0 | https://opengameart.org/content/shortcuts | candidate |
| Sirens in Darkness | cynicmusic (The Cynic Project) | CC0 1.0 | https://opengameart.org/content/sirens-in-darkness | candidate (story opening) |

CC0 needs no attribution; the end card credits the track anyway. Licences checked on each
page on 2026-10-21: the OpenGameArt pages list "CC0" under License(s); the Free Music Archive
track pages carry the CC0 1.0 Universal mark (creativecommons.org/publicdomain/zero/1.0/) and
their albums state "The songs in this album are licensed under: CC0 1.0 Universal".

## Sound effects

All synthesized by [`lib/sfx.mjs`](lib/sfx.mjs) in this repository (MIT): heartbeat, stadium
hum, whoosh, riser, boom, stamp, slam, whistle, tick, rewind, glitch, shutter, sting, ball
touch. No recorded samples.

## Fonts

| Font | Licence | Files |
|---|---|---|
| Anton | SIL Open Font License 1.1 | [titles/fonts/Anton-Regular.ttf](titles/fonts/Anton-Regular.ttf), [licence](titles/fonts/Anton-OFL.txt) |
| Bebas Neue | SIL Open Font License 1.1 | [titles/fonts/BebasNeue-Regular.ttf](titles/fonts/BebasNeue-Regular.ttf), [licence](titles/fonts/BebasNeue-OFL.txt) |

Both from https://github.com/google/fonts (`ofl/anton`, `ofl/bebasneue`). The app's own screens
use Newsreader, Geist, Geist Mono, IBM Plex Mono and Saira Condensed (all SIL OFL, from Google
Fonts), as the web app loads them.

## Voice

Narration: Azure AI Speech neural voices (`en-US-GuyNeural`, the app's play-by-play voice, in a
lower register; the Chinese line is the app's own verified narration in `zh-CN-YunjianNeural`), synthesized through the project's own
speech setup (`video/tts.py` → `api/tts.py`).

## Footage

No real footage. Every frame is the synthetic match: the live site recorded by `capture.mjs`,
its cinematic mode (`?cine=1`) driven frame by frame, and three shots rendered in Blender.

Shots bl01–bl03 were rendered in Blender 5.2 (EEVEE) from our own simulation data (`sim.export`,
blind_side_run seed 3, factual and counterfactual runs). Players are the Gameplay Football model
(Unlicense, Bastiaan Konings Schuiling), placed and turned by the sim's positions and body/head
yaw and animated with CMU motion capture (Bowen approved it on 2026-10-21, as in the app, #118);
the stadium is procedural; no other third-party assets.

Motion capture, as its terms ask, word for word (also on the end card): "The data used in this
project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF
EIA-0196217."  The Blender scripts are kept outside the
repository; only rendered frames are used. In the film these shots carry the label "RENDERED IN
BLENDER FROM OUR SIMULATION DATA"; the cinematic-mode shots carry "IN-ENGINE · RENDERED FROM OUR
SIMULATION DATA".
