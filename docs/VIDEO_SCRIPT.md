# Demo video script (≤ 2:00)

The submission video is a fast, cheeky trailer told around a staged first-person story: an
academy player who never checks his shoulder loses the ball, his coach shows him the replay on a
tablet, and the tablet match-cuts into the real app. The app then runs as three chapters (the
look, under pressure, the corner), the product is shown wider, and the story's callback closes
it. It runs **1:57** and is rendered end to end by code from
[video/trailer.json](../video/trailer.json):

```bash
cd video && npm ci && npx playwright install chromium   # once
npm run trailer                                          # → out/video/trailer.mp4
```

How the edit is built (steps, options, caches) is in [video/README.md](../video/README.md),
"Trailer edit". This page is the treatment: what is on screen, what is said, and why.

- **Numbers.** A number in the voice, the captions or our title cards comes only through a
  `{claim.value}` slot filled from the verified claims read off the live page
  (`out/video/claims.json`, the capture kit's harvest). Without the claim, the card or line uses
  its fallback, which has no number, or is dropped; the report (`out/video/trailer_report.md`)
  lists every number and the claim it came from. The cut shows two, from the current build's
  claims (live after #161, 2026-10-22): the length of the pass that found the runner
  (`pass_to_runner.dist`, 38 m) and the look's value (`cf_value.dxt`, 0.16 xT since the keeper
  spot, 0.17 before, at the precision
  the claim states). The app's
  own panels in the footage (scan counts, live stats, the score) show what the app shows; the app
  labels them as not claims, so the cut never says the verifier checks every number on screen,
  only every line the crew says.
- **Rights.** Synthetic match, fictional clubs and players, no real footage anywhere. Original
  title design (no league, club or game-publisher look); CC0 music, sound effects synthesized in
  the repo, OFL fonts: [video/CREDITS.md](../video/CREDITS.md).
- **Captions.** Many judges watch muted, so every English voice-over line is burned in as a
  caption, word for word as spoken, numbers in gold: the same slot fills the caption and the
  voice, so they cannot disagree. They sit centred in the bottom letterbox bar, and on the right
  while a title holds the lower left. The Chinese line shows the app's own caption instead.
- **Audio.** Voice: Azure AI Speech, `en-US-GuyNeural` (the app's play-by-play voice, PR #83; Bowen
  kept it as the narrator), in a
  lower register for the trailer (slowed 5%, pitched down 12%, then another 4% and compressed), whispering
  on the two hook lines; the one Chinese line is the app's
  own verified narration in the app's play-by-play voice, `zh-CN-YunjianNeural` with the
  sports-commentary style. Music enters on the "See what they saw" hit and is ducked under the
  voice; the whole mix is normalised to −14 LUFS with the true peak held under −1.5 dBTP.

## Timeline

The story shots are staged in Blender and labelled "DRAMATISATION · RENDERED IN BLENDER" (in rework:
every Blender beat is a placeholder card of the same length until approved finals land; `story: "app"`
swaps in an in-engine telling of the story, the same length); the hero shots from the simulation carry "RENDERED IN BLENDER FROM OUR
SIMULATION DATA" and the cinematic-mode shots "IN-ENGINE · RENDERED FROM OUR SIMULATION DATA".
No frame is blurred and nothing flashes: hard cuts or a plain fade only (the report step fails the
render on more than three flashes in any second or any red flash, WCAG 2.3.1, measured on the
encoded film); the rewind is colour split,
noise and scanlines; the cine shots render without motion blur or peripheral blur. Freeze-frame
name cards hold a sharp frame under a one-stop scrim; ramps drop frames, slow motion comes only
from rendered frames. While a player scans, music and crowd drop about 10 dB under an 800 Hz
low-pass and flood back when he acts. The coach speaks with his own voice (`speakers.coach`). His tablet shows the app's first-person
replay, corner-pinned frame by frame (`pins`, `video/pin.py`) so that its last frame is the
first frame of that replay full frame: the match-cut is exact.

| Time | Len | Beat | Picture | Voice-over |
|---|---:|---|---|---|
| 0:00.00 | 2.87 | s1a-receive · name card YOU | story (Blender, dramatisation) |  |
| 0:02.87 | 0.6 | s1c-tackle | story (Blender, dramatisation) |  |
| 0:03.47 | 1.8 | s1d-fall | story (Blender, dramatisation) |  |
| 0:05.27 | 1.0 | s1e-ground | story (Blender, dramatisation) |  |
| 0:06.27 | 6.0 | s2-coach | story (Blender, dramatisation) | Coach: See this? Coach: You know why you lost the ball? |
| 0:12.27 | 3.0 | a1-pov | in-engine | Replays show where the ball went… never what the player saw. |
| 0:15.27 | 0.75 | ch1 | chapter card |  |
| 0:16.02 | 1.35 | bl01a · name card H8 | Blender | Meet H8. |
| 0:17.37 | 4.05 | bl01b · name card H9 | Blender | He gets a single look. Nobody's watching H9. |
| 0:21.42 | 0.3 | bl01c | Blender |  |
| 0:21.72 | 0.45 | rw1 | Blender | Here's what he saw. |
| 0:22.17 | 0.3 | bl02a | Blender |  |
| 0:22.47 | 3.6 | bl02b | Blender |  |
| 0:26.07 | 3.0 | pov-look | in-engine | A look over his shoulder, and he finds the runner. |
| 0:29.07 | 3.75 | pov-pass | in-engine | And he knows where his man is. |
| 0:32.82 | 3.6 | toggle | app | Take that look away, and re-run the match. |
| 0:36.42 | 0.2 | board-rewind | app |  |
| 0:36.62 | 1.15 | rw2 | Blender |  |
| 0:37.77 | 2.6 | bl03 | Blender |  |
| 0:40.37 | 1.5 | split | Blender split |  |
| 0:41.87 | 2.25 | eyes-drag | app | Or take his eyes yourself. |
| 0:44.12 | 1.5 | eyes-pov | app | Look the other way… he plays it safe. |
| 0:45.62 | 1.5 | eyes-result | app |  |
| 0:47.12 | 3.0 | yc-decide | app | Your call. You only know what he knew. |
| 0:50.12 | 3.0 | yc-truth | app | He saw the run. Would you? |
| 0:53.12 | 0.75 | ch2 | chapter card |  |
| 0:53.87 | 2.1 | press-a · name card A11 | in-engine |  |
| 0:55.97 | 1.8 | press-b | in-engine | Under a high press… |
| 0:57.77 | 3.0 | press-cf | in-engine | make him keep the ball, and the press wins it. |
| 1:00.77 | 0.75 | ch3 | chapter card |  |
| 1:01.52 | 1.5 | corner-a | app | At a corner, it's the marker who has to look. |
| 1:03.02 | 3.0 | corner-b | app |  |
| 1:06.02 | 6.75 | crew | card | Behind every replay, a crew of agents. Director, Analyst, Telestrator, Narrator, Verifier, Voice. |
| 1:12.77 | 4.5 | verified | app | Every line is checked against the simulation before it airs. |
| 1:17.27 | 3.75 | wrong | app | Try a wrong number… and it never airs. |
| 1:21.02 | 3.0 | redcard | app | Take an agent down… |
| 1:24.02 | 4.5 | bringback | app | bring it back, and it picks up where it left off. |
| 1:28.52 | 1.5 | casual | app | The same moment, for every fan, in every language. |
| 1:30.02 | 1.5 | analyst | app |  |
| 1:31.52 | 4.5 | zh | app | (the app's own zh line) |
| 1:36.02 | 4.5 | impact | app | Timecoded cues for broadcasters, every player's numbers for coaches. |
| 1:40.52 | 1.0 | s4a-pov | story (Blender, dramatisation) |  |
| 1:41.52 | 2.03 | s4b-check | story (Blender, dramatisation) |  |
| 1:43.55 | 1.8 | s4c-escape | story (Blender, dramatisation) |  |
| 1:45.35 | 1.2 | s4d-run | story (Blender, dramatisation) |  |
| 1:46.55 | 5.5 | spec | card | Built on Microsoft Foundry and Agent Framework, with our own MCP tools and Azure AI Speech. |
| 1:52.05 | 5.25 | end | card | Through Their Eyes. [pause 500] See what they saw. |

Total 117.30 s. The score session composes to the cue sheet generated from this spec.

## The 3D shots

**In-engine**, filmed frame by frame through `window.__cine` (`web/src/cine/`), from the bundled
hero moment (blind_side_run, seed 3) and, for the pressure hero, the service's `press_escape-0`:

| Shot | Run, frames | Camera | Look |
|---|---|---|---|
| `pov-look`, `pov-pass` | factual 50 → 76 | his eyes (95° horizontal field of view) | head-whip motion blur, peripheral softening, shirt numbers |
| `press-low`, `press-cf` | press_escape factual 48 → 70, counterfactual 62 → 84 (the tackle at 81) | over H4's shoulder at the presser; low side on the tackle | depth of field, rings |

**In Blender** (5.2, EEVEE), rendered by the blender-shots session from `sim.export` of the
same moment; the scripts live outside the repository, the clips in `out/video/blender/`
(git-ignored), 1920×804 at 30 fps, padded into the frame as rendered, never cropped:

| Clip | Run, frames | Camera |
|---|---|---|
| `bl01_look` | factual 43 → 70 | low push-in on H8; his head turns over his right shoulder; focus racks to H9 at frame 61, with the app's gold ring |
| `bl02_reveal` | factual 62 → 141 | crane from behind H8 as the pass goes into H9's run |
| `bl03_without` | counterfactual, from `bl01`'s camera, dusk | he never turns and plays it back |

`bl01` also plays reversed at 2.5× as the rewind into `bl03`. Every 3D shot gets the same finish
in the edit (`fx: "glue"`: a light vignette, blacks lifted to about (5, 8, 6), fine grain) so the
two renderers sit together.

## Choices made against the brief

The cut follows the data where a requested beat does not hold:
- **A single look.** H8 makes one scan before the ball arrives (the key scan, frames 50–70;
  verified: "H8 checked his shoulder before the ball reached him"). His name card says so
  without a number word: "A SINGLE LOOK. THAT'S ALL HE GETS."
- **"He saw 4. He missed 1." is not a claim** the service verifies, so the freeze shows a verified
  one: his picture of H9 was off by `{err}` m when he passed.
- **Without the look he does not lose the ball** here: he plays it safe to H4 (verified: "Without
  that look, H8 would have passed to H4"). Losing the ball is told by the pressure chapter, where
  the re-simulated carry is tackled, and by the staged story, which is labelled a dramatisation.
- **The story is staged, not simulated**, so it carries "DRAMATISATION · RENDERED IN BLENDER";
  the jokes and the second person ("YOU ARE No. 14.") stay on fictional players.
- **Chapter numbers are Roman and shirt numbers are names** ("CH. II", "No. 14"): the cards may
  hold no digit or number word that is not a verified claim.

## Music

The original score composed for this project in code (`video/score/`, MIT), hybrid variant
(orchestral and percussion), Bowen's pick on 2026-10-21. It is rendered to this cut's cue sheet
(beat ids plus offsets) and plays from 0:00 as a local asset, ducked under the voice. It already
carries the hits, the tape rewinds, the scan ducks and the clocks, so the edit's own sound effects
on those moments are gone; the ball touches, the drill's ticks, the shutter and the stamps stay.
The CC0 candidates remain listed in `video/assets.json` and `video/CREDITS.md`.

## Open

- TODO(Bowen): the music (candidates above) and the story player's placeholder name.
- TODO(Bowen): the public repository URL on the end card once the repo is public (by 10/26):
  add a line to `titles.end.params.lines`.
- The app shots are filmed from the live site after #161 (the offside fix), with the service's
  cached model narration. Its narration no longer says how far off his picture of H9 was, so
  the cards that showed it (`belief_error.err`) now show the pass that found him instead; no
  claim is carried over from another build.
