# Demo video script (≤ 2:00)

The submission video is a fast trailer with one story line, "GET YOUR VISION" (Bowen's
restructure, 2026-10-22): the lesson, the evidence, the product, the business case. An academy
player watches only the ball, calls for it and is shoulder-charged off it from his blind side; his
coach's mantra runs through the film as voice and hard title cards ("You watched the ball. You
missed the game." · "Before the ball arrives, know what's around you. Get your vision." · "Scan
early. Decide early."). The coach's tablet shows the app's board with the blind side lit, and the
film cuts into the app: the look, frozen scan by scan in the app's step-through, with and without
it; the same vision under pressure and at a corner in one montage; the crew, the verifier, the
drill and the personas; who would pay; and the player's callback goal before "GET YOUR VISION."
It runs under two minutes and is rendered end to end by code from
[video/trailer.json](../video/trailer.json):

```bash
cd video && npm ci && npx playwright install chromium   # once
npm run trailer                                          # → out/video/trailer.mp4
```

How the edit is built (steps, options, caches) is in [video/README.md](../video/README.md),
"Trailer edit". This page is the treatment: what is on screen, what is said, and why.

**Current app reference (not extra video beats).** A plain visit opens a landing page with three
doors: **The look**, **Your turn** and **For studios**. The header's brand returns to the landing
page, and one **⋯ Settings** menu holds the moment picker, commentary audience and language,
follow controls, sound, view options and full tour. The look tells the moment's story; Your turn
contains **Make his call**, **See through his eyes** and **Train your scanning**. For studios
presents **A · AI Tactical Broadcast**, **B · AI Personalised Commentary**, **C · AI Automated
Highlights** and **D · AI Stadium Experience**, then **Value**, led by the league's revenue
levers. Their canonical links are `?step=broadcast`, `commentary`, `highlights`, `stadium` and
`value`. The Tactics lab has **Pro** and **Plain** explanations, tactical terms open glossary
definitions, chapter content uses reduced-motion-aware scroll reveal, and the scan story links to
the coach's `pro_scan` example at `?play=steps&match=pro_scan-116`. The existing deep-link captures
below still open their intended features; the new landing page does not change the cut's timings.

- **Numbers.** A number in the voice, the captions or our title cards comes only through a
  `{claim.value}` slot filled from the verified claims read off the live page
  (`out/video/claims.json`, the capture kit's harvest). Without the claim, the card or line uses
  its fallback, which has no number, or is dropped; the report (`out/video/trailer_report.md`)
  lists every number and the claim it came from. The cut shows two, from the current build's
  claims (live after #161, 2026-10-22): the length of the pass that found the runner
  (`pass_to_runner.dist`, 39 m since #200, which measures it as the live chip does; 38 m before)
  and the look's value (`cf_value.dxt`, 0.16 xT since the keeper spot, 0.17 before, at the precision
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
low-pass and flood back when he acts. The coach speaks with his own voice (`speakers.coach`). His tablet shows the app's tactical
board in the run without the look, H9 on his blind side with the app's blind-side alert lit
(capture `22-board-blind`), corner-pinned frame by frame (`pins`, `video/pin.py`) so that its
last frame is the board full frame: the cut is exact.

The times below are a snapshot of the spec at the last cut and move at the next re-cut;
`video/trailer.json` is the source.

| Time | Len | Beat | Picture | Voice-over |
|---|---:|---|---|---|
| 0:00.00 | 1.633 | s0-eyes · HIS EYES | story (Blender, dramatisation) | Kid: Give it to me! |
| 0:01.63 | 1.1 | s1a-ots · name card YOU ARE No. 14 | story (Blender, dramatisation) |  |
| 0:02.73 | 0.966 | s1c-steal | story (Blender, dramatisation) |  |
| 0:03.70 | 0.867 | s1d-fall | story (Blender, dramatisation) | Coach: You watched the ball. You missed the game. |
| 0:04.57 | 2.5 | card-watched · YOU WATCHED THE BALL. / YOU MISSED THE GAME. | card |  |
| 0:07.07 | 1.2 | s2-ots | story (Blender, dramatisation) | Coach: Before the ball arrives, know what's around you. |
| 0:08.27 | 1.6 | s2-push · WHAT HE SAW. / WHAT HE BELIEVED. | story (Blender, dramatisation) |  |
| 0:09.87 | 1.2 | board | app |  |
| 0:11.07 | 1.1 | card-vision · GET YOUR VISION. | card | Coach: Get your vision. |
| 0:12.17 | 3 | a1-pov · SEE WHAT THEY SAW. | in-engine | Replays show where the ball went… never what the player saw. |
| 0:15.17 | 1.35 | bl01a · name card H8 | Blender | Meet H8. |
| 0:16.52 | 3.1 | bl01b · name card H9 | Blender | He gets a single look. Nobody's watching H9. |
| 0:19.62 | 0.3 | bl01c | Blender |  |
| 0:19.92 | 0.45 | rw1 | Blender | Here's what he saw. |
| 0:20.37 | 0.3 | bl02a | Blender |  |
| 0:20.67 | 3.6 | bl02b | Blender |  |
| 0:24.27 | 2.6 | pov-look | in-engine | A look over his shoulder, and he finds the runner. |
| 0:26.87 | 1.8 | st-scan · SCAN · DETECT | app |  |
| 0:28.67 | 1.9 | st-decision · DECISION · EXECUTE | app | And he knows where his man is. |
| 0:30.57 | 3.4 | toggle · WITHOUT THAT LOOK… | app | Take that look away, and re-run the match. |
| 0:33.97 | 0.2 | board-rewind | app |  |
| 0:34.17 | 1.15 | rw2 | Blender |  |
| 0:35.32 | 2.6 | bl03 · HE PLAYS IT BACK TO H4. | Blender |  |
| 0:37.92 | 2.4 | st-nolook · WITHOUT THE LOOK / NO SCAN. NO PICTURE. NO TIME. | app |  |
| 0:40.32 | 2.3 | card-scan · SCAN EARLY. / DECIDE EARLY. | card | Coach: Scan early, decide early. |
| 0:42.62 | 1.4 | same · THE SAME VISION (UNDER PRESSURE · AT A CORNER) | card |  |
| 0:44.02 | 1.3 | press-a | in-engine (Blender candidate in the edit cut) |  |
| 0:45.32 | 1.8 | press-b | in-engine (Blender candidate in the edit cut) | Under a high press… |
| 0:47.12 | 3 | press-cf · IF HE KEPT THE BALL · THE PRESS WINS IT. | in-engine (Blender candidate in the edit cut) | make him keep the ball, and the press wins it. |
| 0:50.12 | 1.2 | press-app | app |  |
| 0:51.32 | 1.5 | corner-a | app (Blender candidate in the edit cut) | At a corner, it's the marker who has to look. |
| 0:52.82 | 0.9 | corner-look | app (Blender candidate in the edit cut) |  |
| 0:53.72 | 1.35 | corner-app | app |  |
| 0:55.07 | 3.4 | stream | app | A whole match, live, with every key moment a tap away. |
| 0:58.47 | 2.25 | eyes-drag · TAKE HIS EYES | app | Take his eyes yourself. |
| 1:00.72 | 1.5 | eyes-pov | app | Look the other way… he plays it safe. |
| 1:02.22 | 1.5 | eyes-result | app |  |
| 1:03.72 | 3 | yc-decide | app | Your call. You only know what he knew. |
| 1:06.72 | 3.6 | yc-truth | app | He saw the run. Would you? |
| 1:10.32 | 1.4 | crew | card | Behind every replay, a crew of agents. |
| 1:11.72 | 1.6 | crew-trace | app |  |
| 1:13.32 | 2.2 | workflow · the crew workflow as Agent Framework's WorkflowViz draws it (docs/crew_workflow-dark.svg, PR #211) | diagram |  |
| 1:15.52 | 3.6 | verified · EVERY LINE CHECKED BEFORE IT AIRS | app | Every line is checked against the simulation before it airs. |
| 1:19.12 | 4 | wrong · {verifier_offline.kept} OF {verifier_offline.total} BROKEN LINES / KEPT OFF THE AIR | app | Try a wrong number… and it never airs. |
| 1:23.12 | 0.9 | redcard (take the Telestrator down) | app | Take an agent down… |
| 1:24.02 | 1.6 | down · TELESTRATOR DOWN / THE BREAKDOWN STILL AIRS, VERIFIED. | app |  |
| 1:25.62 | 0.7 | bringback | app | bring it back, and it picks up where it left off. |
| 1:26.32 | 2.1 | back · OFFLINE TEST / ONLY THAT STEP RE-RUNS / FAULT-FREE IN {drill_back.back} OF {drill_back.total} DRILLS | app |  |
| 1:28.42 | 2.8 | personas · CASUAL FAN | ANALYST | app split | The same moment, for every fan, in every language. |
| 1:31.22 | 1.3 | zh · 中文 | app |  |
| 1:32.52 | 2.5 | spec | app | Built on Microsoft Foundry and Agent Framework. |
| 1:35.02 | 2 | business · FOR BROADCASTERS · CLUBS · FAN APPS | card |  |
| 1:37.02 | 1 | s4a-pov | story (Blender, dramatisation) |  |
| 1:38.02 | 2.033 | s4b-check | story (Blender, dramatisation) |  |
| 1:40.05 | 1.8 | s4c-drive | story (Blender, dramatisation) |  |
| 1:41.85 | 1 | s4d-strike | story (Blender, dramatisation) |  |
| 1:42.85 | 1.5 | s4e-net | story (Blender, dramatisation) |  |
| 1:44.35 | 1 | s4f-celebrate | story (Blender, dramatisation) |  |
| 1:45.35 | 2 | tagline · GET YOUR VISION. | app | Coach: Get your vision. |
| 1:47.35 | 6.5 | end · ALL DATA SYNTHETIC · FICTIONAL CLUBS AND PLAYERS / MUSIC: ORIGINAL SCORE COMPOSED FOR THIS PROJECT / FONTS: ANTON, BEBAS NEUE — SIL OPEN FONT LICENSE / VOICE: AZURE AI SPEECH | card | Through Their Eyes. Try the replay. |

The film's length is `trailer.json`'s; `npm run trailer` reports it. The score session composes to the cue sheet generated from this spec.

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
- **A single look.** J. Ferriday makes one scan before the ball arrives (the key scan, frames
  50–70; verified: "J. Ferriday scanned once in the 2 seconds before receiving."). His name card
  says so without a number word: "A SINGLE LOOK. THAT'S ALL HE GETS."
- **"He saw 4. He missed 1." is not a claim** the service verifies, so the freeze shows a verified
  one: his picture of N. Varnhall was off by `{err}` m when he passed.
- **Without the look he does not lose the ball** here: he plays it safe to K. Annersley (verified:
  "Without that look, J. Ferriday would have passed to K. Annersley."). Losing the ball is told by
  the pressure chapter, where the re-simulated carry is tackled, and by the staged story, which is
  labelled a dramatisation.
- **The story is staged, not simulated**, so it carries "DRAMATISATION · RENDERED IN BLENDER";
  the jokes and the second person ("YOU ARE No. 14.") stay on fictional players.
- **One key scan, so one label.** The step-through labels only scans the sim has: J. Ferriday's
  single look gets "SCAN · DETECT", then "DECISION · EXECUTE"; no second scan is invented. The run
  without the look shows the app's own "No look here" step under "WITHOUT THE LOOK / NO SCAN. NO
  PICTURE. NO TIME."
- **The tablet's blind spot is N. Varnhall.** The press counterfactual (the in-engine twin of the
  charge) has no blind-side alert on K. Annersley: he had seen the presser (scans at frames 34 and
  57). The only blind-side alert on a POV player is the hero's: N. Varnhall unseen by J. Ferriday
  from frame 42 to the decision in the run without the look, so the tablet shows that board.
- **No two-pane split.** The app's "split" focus is now his eyes with the board inset, so with and
  without the look use the app's own With / Without switch on the board, then the step-through.
- **The Verifier's offline result is read, not typed.** The card's figures (NUMBERS MA8) fill from
  `report_facts`: a pattern matched against
  [eval/reports/crew_evidence.md](../eval/reports/crew_evidence.md); without a match the card
  says "EVERY BROKEN LINE KEPT OFF THE AIR". In prose: Of <!--num:MA8.total-->2,837<!--/num--> deliberately broken lines, the Verifier kept every one off the air; without it, <!--num:MA8.aired-->2,823<!--/num--> would have aired, <!--num:MA8.false-->888<!--/num--> of them stating something false.
- **Who would pay** comes from SUBMISSION.md's business model (broadcasters, clubs, the league's
  fan apps), with no prices.
- **Chapter numbers are Roman and shirt numbers are names** ("CH. II", "No. 14"): the cards may
  hold no digit or number word that is not a verified claim. The one exception is the shirt
  number on a fictional player's name card ("No. 14"): a name, not a statistic.

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
