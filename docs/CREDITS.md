# Credits

Assets used by the app, where they come from and under which licence. Papers, code repositories
and the licence decisions about them are in [REFERENCES.md](REFERENCES.md).

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
