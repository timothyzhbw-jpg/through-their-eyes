# Demo video script (≤ 2:00)

The submission video is a football video-game-style launch trailer: a 13-second hook filmed
inside the synthetic match, the product told in the same visual grammar, then the stack and the
end card. It runs **1:51** and is rendered end to end by code from
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
  lists every number and the claim it came from. The cut says two, from the current build's
  claims: how far off his picture of the runner was when he passed (`belief_error.err`, 0.3 m)
  and the look's value (`cf_value.dxt`, 0.13 xT, at the precision the claim states). The app's
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

The arc follows the judges' view of the product: the problem and the insight (0:00), the player's
eyes and the key look (0:13), the counterfactual (0:24), the agent crew and verification (0:57),
every audience and who it is for (1:21), the close (1:39). The in-engine shots (filmed in the web
app's cinematic mode) carry a corner label, "IN-ENGINE · RENDERED FROM OUR SIMULATION DATA", and
the three Blender shots "RENDERED IN BLENDER FROM OUR SIMULATION DATA"; the rest is the app
itself. Every voice-over line is burned in as a caption (the Chinese line keeps the
app's own caption). `video/trailer.json` holds each beat's exact in-points, crops, push-ins, grades,
transitions, overlays and sounds; `out/video/trailer_contact.jpg` shows one frame per beat.

| Time | Len | Beat | Picture | Voice-over |
|---|---:|---|---|---|
| 0:00 | 2.5 | "EVERY TOUCH STARTS WITH A LOOK." | card | — |
| 0:02.5 | 3.9 | The look, in Blender: a low push-in on H8, his head swings over his shoulder, focus racks to H9 with the gold ring | Blender | Replays show where the ball went… never what the player saw. |
| 0:06.4 | 3.5 | The reveal, in Blender: a crane from behind H8 as the pass finds H9's run | Blender | — |
| 0:09.9 | 3.0 | "SEE WHAT THEY SAW." (the music comes in) | card | See what they saw. |
| 0:12.9 | 4.5 | The crew's replay in his eyes, verified captions | app | Through Their Eyes replays the moment through the player's own eyes. |
| 0:17.4 | 3.0 | First person through the look | in-engine | A look over his shoulder, and he finds the runner. |
| 0:20.4 | 3.75 | Freeze at the pass: "HIS PICTURE OF H9 — OFF BY `{err}` M" | in-engine | And he knows where his man is. |
| 0:24.15 | 6.0 | With / Without the look on the board: the pass flips from H9 to H4, H9 goes unseen | app | Take that look away, and re-run the match. Without it, he plays it back. |
| 0:30.15 | 3.75 | Rewind (the look played backwards), then the run without the look in Blender, dusk: "HE PLAYS IT BACK TO H4." | Blender | — |
| 0:33.9 | 6.75 | Take his eyes: the drag on the dial, his eyes with that look, "Your look changes his call" | app | Or take his eyes yourself: choose the look, and the match plays it out. Look the other way… he plays it safe. |
| 0:40.65 | 10.5 | Your call: decide with his picture, the reveal, what he did (the music drops out) | app | Your call. You only know what he knew. Then see what really happened. He saw the run. Would you? |
| 0:51.15 | 6.0 | The pressure hero, inside the sim: "THE PRESS WINS IT." | in-engine | Under a high press… make him keep the ball, and the press wins it. |
| 0:57.15 | 7.5 | The crew as a line-up | card | Behind every replay, a crew of agents. Director, Analyst, Telestrator, Narrator, Verifier, Voice. |
| 1:04.65 | 4.5 | Every line checked: four lines stamped ✓, `{err}` m and `{dxt}` xT | app + card | Every line is checked against the simulation before it airs. |
| 1:09.15 | 4.5 | A wrong number refuted: "WOULD NOT AIR" | app | Try a wrong number… and it never airs. |
| 1:13.65 | 7.5 | The failure drill as a red card, the bring-back as a substitution | app | Take an agent down… bring it back, and it picks up where it left off. |
| 1:21.15 | 6.75 | Casual fan, analyst, 中文 | app | The same moment, for every fan, in every language. (Then the app's own zh line.) |
| 1:27.9 | 4.5 | The stitched match live on the broadcast camera | app | A whole match, live, with a camera director. |
| 1:32.4 | 3.0 | Full time: the crew's recap | app | At the final whistle, the crew writes the recap. |
| 1:35.4 | 3.75 | Who it is for: the live stats | app | Timecoded cues for broadcasters, every player's numbers for coaches. |
| 1:39.15 | 6.0 | The stack as a spec sheet | card | Built on Microsoft Foundry and Agent Framework, with our own MCP tools and Azure AI Speech. |
| 1:45.15 | 6.0 | End card: name, tagline, site, "ALL DATA SYNTHETIC", credits | card | Through Their Eyes. See what they saw. |

Total 1:51. The product section cuts on the music's 80 bpm grid from the title hit; the track's
breakdown falls on Your call.

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

The treatment Bowen approved asked for some beats the data does not support; the cut follows
the data:
- **One look, three angles.** H8 makes one scan before the ball arrives (the key scan, frames
  50–70; the verified line is "H8 checked his shoulder before the ball reached him"). The hook
  shows that one look from two angles and then through his eyes, not three scans.
- **"He saw 4. He missed 1." is not a claim** the service verifies, so the freeze shows a verified
  one instead: his picture of H9 was off by `{err}` m when he passed.
- **Without the look he does not lose the ball** in this moment: he plays it safe to H4 (verified:
  "Without that look, H8 would have passed to H4"). The cut says so; "he loses the ball" is
  told by the pressure hero, where the re-simulated carry is tackled.
- **Your call** is live (#60), so it has its slot; the stitched-match beat is the live broadcast
  shot.
- **In-engine shots past the hook.** The review asked for in-engine shots only in the opening
  8–10 s. The hook is in Blender, from the same simulation data. The first-person shots and the
  pressure hero are in-engine, because they are the app's own POV and broadcast views filmed in
  its cinematic mode; the run without the look is Blender again. Each carries its label. The app itself
  fills 62 s of the 111 s, the in-engine shots 24 s and the title cards 25 s.

## Music

Default: "Unsolicited trailer music (loop edit)" by Emma_MA, CC0 — energetic electronic at 80
bpm. It enters at a phrase boundary of the track (35.59 s) on the "See what they saw" hit, the
product cuts land on its beats, and its breakdown (66.3–72.3 s in the track) falls on Your call.
It fades out under the end card.
Alternatives in [video/assets.json](../video/assets.json) (switch `music[0].asset` in
`trailer.json`; their sections differ, so re-time `from`):
[Generic trailer music](https://opengameart.org/content/generic-trailer-music) (Emma_MA, CC0,
dramatic) and [Digital Acid](https://opengameart.org/content/xenocity-digital-acid-glitch-hop)
(Xenocity, CC0, glitch hop). The default's page:
https://opengameart.org/content/unsolicited-trailer-music

## Open

- TODO(Bowen): the music is the default; the two alternatives are below.
- TODO(Bowen): the public repository URL on the end card once the repo is public (by 10/26):
  add a line to `titles.end.params.lines`.
- The final render films the live site, so it needs the cinematic mode (#90) and Take his eyes
  (#99) deployed. The v5 cut was filmed from a local build of main + #90 + #93 + #99 with a local
  API (`--base-url`), which writes template narration; the live service's model narration replaces
  it in the final render. The drill shot is the live site's, where the other agents read MODEL.
