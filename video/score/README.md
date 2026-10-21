# Original score for the demo video (SPEC 10)

The trailer's music, composed for this project in code, so there is no licensing question:
our own composition, our own synthesised drums and synths, and orchestral colour from an MIT
SoundFont rendered offline. No samples from existing songs, no AI music generators.

Two variants share one form and one cue sheet:

- **grime**: 140 BPM half-time, synthesised drums, sine/square/reese basses, an eskibeat square
  lead playing the look motif, supersaw stabs layered with the SoundFont's orchestra hit and
  brass.
- **hybrid**: the same cues scored for a caper orchestra (pizzicato ostinato, horns, trombones,
  trumpets, timpani, choir) over synthesised taiko and kit.

## Composed to picture

The cue sheet (`cues/<cut>.json`) names musical events by the trailer's beat ids
(`video/trailer.json`), so a re-timed cut only needs a re-render:

- **sections** (`cold`, `drop`, `look`, `pressure`, `corner`, `close`) each start a fresh bar on
  their first frame, so a chapter card always lands on a downbeat. The part-bar a section does
  not fill becomes a pickup roll with one 16th of air before the next downbeat.
- **events**: `hit` (big or small), `card` (a stab on a freeze-frame or name card; `dusk` for
  the without-the-look world), `stamp`, `drop`, `riser`, `button`, `rewind`, and `scan`, the
  perception device: inside a scan the band is heard through a wall (800 Hz low-pass, −10 dB),
  with a breath and a tick, then a reverse swell and a slam back on the action.
- **windows** with a mood: `gap` and `stop` (silence; `stop` tape-stops into it), `without`
  (sparse and dark), `decide` (only the clock), `build`, `strip` (an agent down: the band loses
  its lead, and on its return it picks up the riff where it left off) and `hold` (the end card).

A reference is a number of seconds, `"<beat>"`, `"<beat>:+0.3"`, `"<beat>:-0.43"` or
`"<beat>:end"`. Cues within one frame (1/30 s) of a 16th note snap to it; `"snap": false` keeps the
picture's time. At 140 BPM a 16th is 0.1071 s, and the edit's 0.75 s unit is exactly seven
16ths, so cuts made on that unit from a section's start land on the grid.

## Run it

Once: `brew install fluid-synth`, then fetch the SoundFont (`assets.json`; MIT, Debian's
`fluid-soundfont` source package) and check its hash:

```bash
mkdir -p out/score/assets/fluid && curl -L -o out/score/assets/fluid/fluid-soundfont_3.1.orig.tar.gz https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont_3.1.orig.tar.gz
```

```bash
tar -xzf out/score/assets/fluid/fluid-soundfont_3.1.orig.tar.gz -C out/score/assets/fluid fluid-soundfont-3.1/FluidR3_GM.sf2 fluid-soundfont-3.1/COPYING
```

Then render both variants (about 30 s each; the script checks the SoundFont's SHA-256):

```bash
uv run video/score/score.py --cues video/score/cues/v8.json --out out/score/v8
```

`--check` only resolves the cue sheet and prints it. The trailer spec comes from the cue sheet's
`trailer_ref` (a git object) unless `--trailer <path>` is given. The script's dependencies
(numpy, scipy, pretty_midi) are declared inline, so `uv run` builds its own environment and the
project's lock file is untouched.

Output, per variant in `out/score/<variant>/`:

- `score.wav`: the master, 48 kHz / 24-bit, −14 LUFS, true peak ≤ −1 dBTP;
- `stems/{drums,bass,music,fx}.wav`: the mix before the master bus, sharing one gain so they
  add up to it (peaks at −1 dBFS); the music stem holds the melodic parts and pads, `fx` the
  impacts, risers, swells and breaths;
- `report.json`; and `out/score/report.md` for both variants.

The perception device, the rewinds and the silences are already in every stem. The voice-over
is not: the edit ducks the music under it (`duck_db` in `trailer.json`).

## Checks

Every render reads its own WAVs back and checks (`check.py`, in the report):

- integrated loudness −14 ± 0.5 LUFS and true peak ≤ −1.0 dBTP;
- every hit, card, stamp, drop, button and scan release is an accent on its frame: the score's
  onset strength (spectral flux) within -4..+12 ms of the cue is at least the 75th percentile
  of the onsets within a second around it. A counterexample run with the card and stamp stabs
  removed fails it on 10 of 38 cues (every off-grid one), so it measures the stabs, not the
  groove;
- inside each scan the band's top end (> 1 kHz) is at least 12 dB down, and it comes back at
  least 12 dB on the action;
- the gap and the cut-out are silent (below −60 dBFS), and the button's tail is gone before
  the film ends.

The same inputs give byte-identical WAVs (keyed randomness, no dither; the report carries the
SHA-256).

## Preview on a cut

`preview.mjs` lays a score under a rendered cut, mixing the cut's voice-over and effects with
the edit's own `mixGraph` (the trailer voice chain, the music side-chained under the voice),
normalises to −14 LUFS and writes a 720p MP4:

```bash
node video/score/preview.mjs --spec <trailer.json> --picture <cut.mp4> --vo <vo dir> --sfx <sfx dir> --score out/score/grime/score.wav --gain 4 --out out/score/preview/grime.mp4
```

## Files

| File | What |
|---|---|
| `score.py` | the command: compose, render the SoundFont parts, mix, master, check, report |
| `timeline.py` | the cut (beat starts from `trailer.json`), the cue sheet, the 16th-note grid |
| `arrange.py` | harmony, the motifs, bass rhythms, the step loop both variants use |
| `grime.py`, `hybrid.py` | the two arrangements |
| `synth.py` | our instruments: drums, basses, leads, stabs, drones, risers, impacts |
| `sf.py` | MIDI parts (pretty_midi) rendered by FluidSynth from the SoundFont |
| `dsp.py` | filters, dynamics, reverb, BS.1770 loudness, true peak, WAV I/O |
| `check.py`, `analyze.py` | the acceptance checks and the band and section measurements |
| `preview.mjs` | the score under a rendered cut, as a 720p MP4 |
| `cues/v7.json` | the cue sheet for cut v7 |
| `cues/v8.json` | the cue sheet for the academy cut v8 (the story beats are placeholders until the Blender clips land) |
| `report_v7.md`, `report_v8.md` | the checks and measurements of both variants on each cut |

Licences are in [`../CREDITS.md`](../CREDITS.md).
