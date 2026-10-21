# Demo video script (≤ 2:00)

The submission video is a football video-game-style launch trailer: a 28-second cold open filmed
inside the synthetic match, the product told in the same visual grammar, then the stack and the
end card. It runs **1:50** and is rendered end to end by code from
[video/trailer.json](../video/trailer.json):

```bash
cd video && npm ci && npx playwright install chromium   # once
npm run trailer                                          # → out/video/trailer.mp4
```

How the edit is built (steps, options, caches) is in [video/README.md](../video/README.md),
"Trailer edit". This page is the treatment: what is on screen, what is said, and why.

- **Numbers.** A number on screen or in the voice comes only through a `{claim.value}` slot filled
  from the verified claims read off the live page (`out/video/claims.json`, the capture kit's
  harvest). Without the claim, the card or line uses its fallback, which has no number, or is
  dropped; the report (`out/video/trailer_report.md`) lists every number and the claim it came
  from. The cut shows two: the runner's distance to the nearest opponent
  (`gap_to_nearest_opponent.gap`) and the look's value (`cf_value.dxt`).
- **Rights.** Synthetic match, fictional clubs and players, no real footage anywhere. Original
  title design (no league, club or game-publisher look); CC0 music, sound effects synthesized in
  the repo, OFL fonts: [video/CREDITS.md](../video/CREDITS.md).
- **Audio.** Voice: Azure AI Speech, `en-US-ChristopherNeural` (deep, slowed 3%, pitched down 4%,
  then lowered another 4% and compressed for a trailer read); the one Chinese line is the app's
  own verified narration in the app's play-by-play voice, `zh-CN-YunjianNeural` with the
  sports-commentary style. Music enters on the "See what they saw" hit and is ducked under the
  voice; the whole mix is normalised to −14 LUFS with the true peak held under −1.5 dBTP.

## Timeline

Times are in the finished film. **Picture**: `cine` = filmed in the web app's cinematic mode
(`?cine=1`); `app` = recorded from the live site by the capture kit (`video/shots.json` id);
`card` = a title card from `video/titles/`.

| Time | Len | Beat | Picture | On screen | Voice-over |
|---|---:|---|---|---|---|
| **Cold open** | | | | | |
| 0:00 | 3.0 | Black | card | "EVERY TOUCH / STARTS WITH A LOOK." Stadium hum, heartbeat, a low hit. | — |
| 0:03 | 2.8 | Establishing crane | cine `establish` | Down from the stands onto H8 as the pass from H4 rolls to him. Floodlights bloom, letterboxed 2.39:1. | Before the ball arrives… |
| 0:05.8 | 2.0 | The look, low | cine `look-low` | Low angle behind H8, a floodlight over his shoulder, slow motion: his head turns. Whoosh. | …the great ones look. |
| 0:07.8 | 1.8 | The look, over the shoulder | cine `look-ots` | From behind him toward the runner H9 (gold ring), H8's head soft in the foreground. | — |
| 0:09.6 | 2.6 | The look, wide | cine `look-wide` | High wide: his vision cone sweeps the pitch as he scans and catches H9. A hit. | — |
| 0:12.2 | 3.0 | His eyes | cine `pov-look` | Snap to first person: the head whip blurs the frame, the periphery softens, H9 comes into sight. | He found the runner. |
| 0:15.2 | 4.5 | Freeze | cine `pov-pass` | At the pass the frame freezes with a punch-in: "H9 · UNMARKED — NEAREST OPPONENT `{gap}` M". | Unmarked. |
| 0:19.7 | 1.8 | Rewind | cine `rewind` | The move runs backwards: "WITHOUT THAT LOOK…". Tape-rewind sound. | Take that look away… |
| 0:21.5 | 4.5 | The run without it | cine `without` | The re-simulated run with no look: he turns and plays it back, the runner left alone. "HE PLAYS IT BACK TO H4." | …and he never sees him. |
| 0:26 | 2.5 | Title | card | "SEE WHAT / THEY SAW." on a hit. | See what they saw. |
| **The product** (cut on the music's 80 bpm beat) | | | | | |
| 0:28.5 | 3.75 | The replay | app `03-breakdown` | The crew's replay on the stage with its verified captions; "THROUGH THEIR EYES — THE AI MATCH STUDIO". | Football, replayed through the player's eyes. |
| 0:32.25 | 5.25 | Every line checked | app `07-evidence` | Over the evidence card: four lines stamped ✓ in turn — he saw H9 in the scan, H9's run was on his blind side, nearest opponent `{gap}` m, that look was worth `{dxt}` xT. | Every line is checked against the simulation before it airs. |
| 0:37.5 | 4.5 | A wrong number | app `09-verifier` | "Try a wrong number": the verifier refutes it; a red ✗ slams "WRONG NUMBER — WOULD NOT AIR". | Try a wrong number… and it never airs. |
| 0:42 | 9.0 | The crew | card | Six cards dealt like a squad line-up: Director, Analyst (asks the MCP tools), Telestrator, Narrator, Verifier, Voice. | Behind every replay, a crew of agents. Director, Analyst, Telestrator, Narrator, Verifier, Voice. |
| 0:51 | 3.75 | Red card | app `10-drill` | The failure drill: the Telestrator row reads TEMPLATE, AgentDown; a red card rises, whistle: "TELESTRATOR DOWN — THE TEMPLATE AIRS. THE REPLAY PLAYS ON." | Take an agent down… |
| 0:54.75 | 4.5 | Substitution | app `10-drill` | Bring back: the row turns back to MODEL from its checkpoint; an LED board flips OFF TEMPLATE → ON TELESTRATOR. | …bring it back, and it picks up where it left off. |
| 0:59.25 | 2.25 | Casual fan | app `03-breakdown` | The replay with the casual captions; tag "CASUAL FAN". | The same moment, for every fan, in every language. |
| 1:01.5 | 2.25 | Analyst | app `05-personas` | The analyst's captions; tag "ANALYST". | — |
| 1:03.75 | 4.5 | 中文 | app `06-language` | The Chinese captions; tag "中文". | The app's own verified zh line, the caption on screen: 出球时，H9离最近的对手有11.0米。 |
| 1:08.25 | 3.75 | What if | app `08-what-if` | A free question typed, the simulator's verified answer. | Ask what if, and the simulation answers. |
| 1:12 | 4.5 | Live | app `02-live-stream` | The stitched match on the broadcast camera, live from the API, with the camera director's chip; "A WHOLE MATCH — LIVE". | A whole match, live, with a camera director. |
| **Your call** (the music drops out) | | | | | |
| 1:16.5 | 4.5 | Decide | app `12-your-call` | His picture only; a draining ring "YOUR CALL — YOU ONLY KNOW WHAT HE KNEW". The pick: the safe ball to H4. Clock ticks. | Your call. You only know what he knew. |
| 1:21 | 4.5 | Reveal | app `12-your-call` | Your call plays out in the sim, then the true picture: H9's run was on his blind side. The music returns. | Then see what really happened. |
| 1:25.5 | 3.75 | What he did | app `12-your-call` | What he did: the pass to H9, and why. | He saw the run. Would you? |
| **Another lens** | | | | | |
| 1:29.25 | 3.0 | Under press | cine `press-low` | The centre-back H4 receives as the presser closes; "ANOTHER MOMENT, ANOTHER LENS — UNDER PRESS". | Under a high press… |
| 1:32.25 | 3.75 | The press wins | cine `press-cf` | Inside the sim, forced to keep the ball: the tackle, frozen — "THE PRESS WINS IT." | …make him keep the ball, and the press wins it. |
| **Close** | | | | | |
| 1:36 | 7.5 | Under the hood | card | The stack as a spec sheet: Microsoft Foundry, Microsoft Agent Framework, our MCP server, Azure AI Speech, Azure Container Apps, Azure Storage static website, Azure Cosmos DB, Application Insights, GitHub Actions. | Built on Microsoft Foundry and Agent Framework, with our own MCP tools and Azure AI Speech. |
| 1:43.5 | 6.5 | End card | card | THROUGH THEIR EYES — SEE WHAT THEY SAW., the site URL, "ALL DATA SYNTHETIC · FICTIONAL CLUBS AND PLAYERS", the music, font and voice credits. Sting. | Through Their Eyes. See what they saw. |

`video/trailer.json` holds each beat's exact in-points, crops, push-ins, grades, transitions,
overlay and sound timings; `out/video/trailer_contact.jpg` shows one frame per beat.

## The cinematic shots

Filmed frame by frame through `window.__cine` (`web/src/cine/`), from the bundled hero moment
(blind_side_run, seed 3) and, for the pressure hero, the service's `press_escape-0`:

| Shot | Run, frames | Camera | Look |
|---|---|---|---|
| `establish` | factual 18 → 44 | crane from the stands to 4.5 m, onto H8 | bloom, depth of field |
| `look-low` | factual 47 → 60 (slow) | low orbit behind H8, looking up past a floodlight | bloom, shallow focus, exposure up |
| `look-ots` | factual 54 → 62 | behind H8 on the line to H9, aimed at H9 | focus on H9 |
| `look-wide` | factual 58 → 71 | high wide behind the play | his vision cone flashing on the scan, rings |
| `pov-look`, `pov-pass` | factual 50 → 76 | his eyes (95° horizontal field of view) | head-whip motion blur, peripheral softening, shirt numbers |
| `rewind` | factual 80 → 50 | side, mid-height | — |
| `without` | counterfactual 50 → 108 | side, panning back to the ball | faint cone, rings |
| `press-low`, `press-cf` | press_escape factual 48 → 70, counterfactual 58 → 86 | over H4's shoulder at the presser; low side on the tackle | depth of field, rings |

## Choices made against the brief

The treatment Bowen approved asked for some beats the data does not support; the cut follows
the data:
- **One look, three angles.** H8 makes one scan before the ball arrives (the key scan, frames
  50–70; the verified line is "H8 checked his shoulder before the ball reached him"). The cold
  open shows that one look from three angles, not three scans.
- **"He saw 4. He missed 1." is not a claim** the service verifies, so the freeze shows a verified
  one instead: H9 unmarked, `{gap}` m from the nearest opponent.
- **Without the look he does not lose the ball** in this moment: he plays it safe to H4 (verified:
  "Without that look, H8 would have passed to H4"). The cold open says so; "he loses the ball" is
  told by the pressure hero, where the re-simulated carry is tackled.
- **Your call** is live (#60), so it has its slot; the stitched-match beat is the live broadcast
  shot.

## Music

Default: "Unsolicited trailer music (loop edit)" by Emma_MA, CC0 — energetic electronic at 80
bpm. It enters at the track's phrase boundary (18.34 s) on the "See what they saw" hit, the
product cuts land on its beats, and its breakdown (66.3–72.3 s in the track) falls on Your call.
Alternatives in [video/assets.json](../video/assets.json) (switch `music[0].asset` in
`trailer.json`; their sections differ, so re-time `from`):
[Generic trailer music](https://opengameart.org/content/generic-trailer-music) (Emma_MA, CC0,
dramatic) and [Digital Acid](https://opengameart.org/content/xenocity-digital-acid-glitch-hop)
(Xenocity, CC0, glitch hop). The default's page:
https://opengameart.org/content/unsolicited-trailer-music

## Open

- TODO(Bowen): the music and the voice are defaults; samples of the voice options were sent with
  the first cut (Christopher, Onyx HD, Guy whispering).
- TODO(Bowen): the public repository URL on the end card once the repo is public (by 10/26):
  add a line to `titles.end.params.lines`.
- The final render films `?cine=1` on the live site, so it needs the cinematic mode deployed
  (#90); until then `npm run trailer -- --base-url http://localhost:5173` films a local build.
