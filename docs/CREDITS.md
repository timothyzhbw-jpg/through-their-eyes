# Credits

Assets used by the app, where they come from and under which licence. Papers, code repositories
and the licence decisions about them are in [REFERENCES.md](REFERENCES.md).

## Players and their motion (web app, SPEC 7)

| Asset | Source | Licence or terms |
|---|---|---|
| The rigged footballer, its skeleton and its idle, walk, sprint and pass clips (`web/public/models/grf_player.glb`) | Gameplay Football by Bastiaan Konings Schuiling, as shipped in Google Research Football; converted by [demo/grf/convert.py](../demo/grf/convert.py) | Unlicense |
| The kick (`pass_short`) and the shoulder checks (`shoulder_check_l` / `_r`) in `web/public/models/anims_extra.glb` | CMU Graphics Lab Motion Capture Database, trials 10_02 and 139_04, from the official site only, retargeted onto the skeleton above | Free for all uses, included in the product, never resold as data |
| The walk (`walk`) in `web/public/models/anims_walk.glb` | Quaternius' Universal Animation Library 1, free "Standard" pack, `Walk_Loop`, retargeted onto the skeleton above | CC0 1.0 (no credit asked; given anyway). Reported to be Xsens motion capture (Digital Production, 2025-03-21; Quaternius does not say) |

Acknowledgement, as the CMU database asks: *The data used in this project was obtained from
mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.* It is motion
capture of lab subjects, not match data or footage. Which part of each trial is used, and how,
is in [web/public/models/README.md](../web/public/models/README.md).

## Sound (web app, SPEC 7)

The sound design of the hero moment (crowd bed, scan whoosh, the "without the look" sting) uses
no recordings. Every sound is synthesized at run time with the Web Audio API by our own code in
[web/src/sound/engine.ts](../web/src/sound/engine.ts), under the repository's MIT licence:

| Sound | How it is made |
|---|---|
| Crowd bed | Pink noise (Paul Kellet's filter over `Math.random` white noise) through two band-pass filters, with two slow oscillators on the level; low-passed during the key-moment beat |
| Scan whoosh | The same noise through a band-pass sweeping 320 Hz → 2.4 kHz → 600 Hz, with a stereo pan in the direction of the head turn |
| Sting | A sine falling from 96 Hz to 44 Hz, a low-passed A-minor triangle-wave chord, and high-passed noise |

No sample libraries, no third-party audio files, no music. The demo video's sound is credited
separately with the video.

The method, not code, comes from public descriptions: Paul Kellet's "economy" pink-noise filter
(posted to the music-dsp mailing list, 1999) is a three-pole formula reimplemented here.
