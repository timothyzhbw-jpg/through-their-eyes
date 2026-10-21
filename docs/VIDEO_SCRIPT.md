# Demo video script (≤ 2:00)

Built from the storyboard in [SPEC §10](SPEC.md#10-demo-video-storyboard--200), updated for
what has landed on `main` since: the stitched match, the pressure hero, the corner set-piece
hero (in the simulator and its eval only), the camera director, the optional skeleton view,
**Try a wrong number** and the failure drill. Open questions are marked `TODO(Bowen)`.

- **Length:** the timeline ends at 1:56, inside the rules' "under 2:00" with 4 s spare.
  **Len** is the slot in the edit. The capture kit records each shot for its `target_s` in
  `video/shots.json`; the edit trims the clip to its slot.
- **First cut, due 10/23:** record every shot from the live site.
- **Numbers:** the voice-over speaks a number only through a slot such as `{cf_value.dxt}`
  (claim id and value name). The capture kit fills the slot from the verified claims the page
  shows ([video/README.md](../video/README.md), "Numbers"), so the number spoken is the number
  on screen. Without the claim, the line falls back to the version with no number. The eval
  numbers on the closing slide come from `eval/reports/`, each with its file named on the slide.
- **Rights:** synthetic match, fictional clubs and players. No Premier League or club marks,
  real player names, broadcaster branding or copyrighted music in the edit either (titles,
  lower thirds, end card). No music by default ([video/README.md](../video/README.md), "Rights").
  No real footage anywhere: the app and the video are synthetic end to end.

## Shot list

The site is https://ttesite1ff906.z14.web.core.windows.net; links below start from it. A
`shots.json` id means the capture kit records the shot (`cd video && npm run capture -- --only
<id>`). **New** means [video/shots.json](../video/shots.json) has no entry for it yet: until
one is added (see [Capture-kit follow-ups](#capture-kit-follow-ups)), record that shot by hand
from the link, at 1920 × 1080.

| # | Time | Len | Beat | On screen | Produced by |
|---|---|---:|---|---|---|
| 0 | 0:00–0:04 | 4 s | Before kick-off | The lineup card: both fictional teams, each player's scans in this move, the hero highlighted. | `00-lineup-card` (records 4 s) |
| 1 | 0:04–0:08 | 4 s | Cold open | First person, at half speed: H8 looks over his shoulder, away from the ball; the runner H9 comes into sight; the **KEY SCAN** badge, with motion blur through the head turn. Title lower third: "Through Their Eyes". | `01-cold-open` (records 4 s) |
| 2 | 0:08–0:17 | 9 s | A whole match, live | The stitched match on the broadcast camera, live from the API: score bug ("Possession 2 of 6"), sprint tags. The director's chip, for example "Switch to H8's eyes: he checks over his shoulder before the ball arrives." One tap, and we are in his eyes. | **New.** `/?match=match-1&camera=broadcast&intro=0`: the live stream starts at kick-off and the scan hero's possession starts at 30.0 s, so record about 45 s and keep the cut from about 0:28. The kit's `02-live-stream` (records 10 s) is a stand-in for this beat. |
| 3 | 0:17–0:39 | 22 s | The breakdown | The crew's replay: freeze, rewind, first person through his scans, the key scan lights up the runner, freeze at the pass with "he thought / it was". Captions are the app's verified lines. | `03-breakdown` (records 24 s) |
| 4 | 0:39–0:51 | 12 s | **With / Without the look** (the highlight) | After the breakdown, frozen at the decision on the tactical board: the run switch in the header flips the pass options between the two runs. Without the look, he plays it back to H4; the other run's ghost path plays on. | `04-with-without` (records 10 s; hold the last frame) |
| 5 | 0:51–1:02 | 11 s | One moment, many audiences | The same breakdown for casual → analyst → player fan, then the captions switch to 中文. | `05-personas` + `06-language` (record 12 s + 6 s) |
| 6 | 1:02–1:07 | 5 s | Evidence | Click a caption: the evidence card shows each claim, its kind (observed / computed / counterfactual), its verdict, and the replay seeks to the evidence frame. Verified numbers carry a dotted underline. | `07-evidence` (records 7 s) |
| 7 | 1:07–1:13 | 6 s | What if…? | A suggested question, then a typed one; the forced run plays as a gold ghost with its verified answer. | `08-what-if` (records 8 s) |
| 8 | 1:13–1:22 | 9 s | The pressure hero | Another moment, another lens: the centre-back H4 under a high press. Switch to **If he carried it** and play: the presser wins the ball. | **New.** `/?match=press_escape-0&run=counterfactual&at=decision&view=tactical`, then **Play**. Or, inside the match: `/?match=match-1&intro=0`, **Moments** → the pressure hero → **Breakdown**. |
| 9 | 1:22–1:31 | 9 s | The verifier blocks a wrong number | The evidence card opens on "That look was worth … in expected threat." with a wrong value filled in. **Check** → "Refuted — this line would not air", with its reason; **Check the true value** → supported. | **New.** `/?persona=analyst&tamper=cf_value`. The kit's `09-verifier` is still marked "pending feature"; the control is live. |
| 10 | 1:31–1:45 | 14 s | Take an agent down, bring it back | The Producer desk in the "Behind the replay" chapter: **Take down** on the Telestrator → **Run with Telestrator down**. Its row reads TEMPLATE, "AgentDown · 2 attempts", and the breakdown still plays. **Bring back** → the row reads MODEL, FROM CHECKPOINT: the workflow resumes from its checkpoint, re-runs the Telestrator and the step after it, and the new plan replaces the template. The run's trace id sits under the desk. | **New.** `/?persona=analyst&lang=en&intro=0`, scroll to **Behind the replay** → **Producer · failure drill**. Each run and each **Bring back** counts against the rate limit and the daily model cap; a drill lasts until the API's next restart or deploy. |
| 11 | 1:45–1:56 | 11 s | Architecture and evidence | [docs/architecture.png](architecture.png) (the 1920 × 1080 frame), then the evidence lines below, then the end card. | `11-architecture` (external: a slide; records 10 s) |

**Optional insert, first to cut** (SPEC §9 cut order 0): 2 s of **Skeleton** on the broadcast
camera in shot 2, showing every player's torso and head direction the way limb-tracking data
is shown. If it goes in, take the 2 s from shot 2's live footage.
Link: `/?match=match-1&camera=broadcast&at=751`, **View options** → **Skeleton**, **Play**.
Frame 751 is where the scan hero's possession starts (`sim.match.build_match(1)`).

**Expected threat.** Shot 4's line "That look was worth … in expected threat" and shot 9's
card fill from the verified claim that is deployed when they are recorded. #48 (the fitted xT
grid, approved) changes that value, so record shots 4 and 9 after #48 is deployed.

## Voice-over (English)

247 words over 1:56, about 128 a minute: room for the app's own captions to be read. The lines for
shots 0, 3, 4, 6 and 7 are those of `00-lineup-card`, `03-breakdown`, `04-with-without`,
`07-evidence` and `08-what-if` in `shots.json`, shortened where marked.
In a slot such as `{belief_error.err}`, the value comes from the page at capture time (see
"Numbers" above); the line in brackets is its fallback without the number. Outside the slots
there are no digits or number words, so every line can go into `shots.json` as it is
(`tests/test_video_shots.py` checks that).

| # | Voice-over |
|---|---|
| 0 | Before kick-off: every player, and every look over his shoulder in this move. |
| 1 | What did he see? |
| 2 | Replays show where the ball went. We show what the player saw, in a synthetic match streamed live from Azure. |
| 3 | Our agent crew builds the replay. Back inside his head: the scans before the ball arrived, and the key look that showed him the runner. When he played the pass, his picture of the runner was off by `{belief_error.err}` metres. *[Fallback: drop the last sentence.]* |
| 4 | Now take that look away and re-run the simulation. Without it, he plays it safe and passes back. That look was worth `{cf_value.dxt}` in expected threat. *[Fallback: drop the last sentence.]* |
| 5 | The same verified facts, told for a casual fan, an analyst or a fan of the player. In English or in Chinese. |
| 6 | Every line opens its evidence: the claim, its verdict, and the frame that proves it. *(shortened)* |
| 7 | Ask what if. The simulator forces that choice and replays the moment. *(shortened)* |
| 8 | Under a high press, the lens changes. Make the centre-back keep the ball, and the press wins it. |
| 9 | Before anything airs, a verifier checks every number against the simulation. Type in a wrong number, and the line won't air. |
| 10 | Take an agent down, and its template airs: the breakdown still plays. Bring it back, and the workflow resumes from its checkpoint. Only that agent runs again. |
| 11 | Built on Microsoft Foundry, Agent Framework and our own MCP server, with Azure AI Speech, Container Apps, Cosmos DB and Application Insights. Through Their Eyes: see what they saw. |

The app's own two voices (Azure AI Speech, **Sound on**) are not in the screen capture: the
capture kit records no audio. To use them under shot 3 instead of the narrator, record the tab
audio separately. TODO(Bowen): your voice, or the app's voices under shot 3?

## Closing slide (shot 11)

**Left:** [docs/architecture.png](architecture.png), regenerated with `python3
docs/architecture.py --png --chrome <path to chrome-headless-shell>` if the diagram changed. Its stack follows the README's technology
table: Microsoft Foundry, Agent Framework, our MCP server, Azure AI Speech, Container Apps, the
Storage static website, Cosmos DB, Application Insights and GitHub Actions.

**Right:** the evidence lines, each with its report path in small type, as the capture-kit
rule asks:

| On screen | Report |
|---|---|
| Without the look, he decides differently: **39 / 40** held-out seeds | `eval/reports/hero_flip_blind_side_run.md` |
| Pressure hero forced to keep the ball: **loses it 40 / 40** | `eval/reports/hero_lens_press_escape.md` |
| False claims refuted by the verifier: **90 / 90** | `eval/reports/corruption.md` |
| Narration failing the verifier, free text vs anchored: **88% vs 0%** | `eval/reports/narration_ablation.md` |

The corner hero is not on the slide: its headline uses a gate revised during design, and the
original plan's checks, reported in the same file, are not met. A slide line can't carry that
caveat.

**End card:** "Synthetic match · fictional clubs and players", the live site URL and the
repository URL. TODO(Bowen): the public repository URL, once the repo is public (by 10/26).

## Capture-kit follow-ups

This PR changes no code or capture data. These `video/shots.json` changes are for a
follow-up PR on `video/`:
- `02-live-stream`: no longer a stand-in. Record shot 2 from
  `/?match=match-1&camera=broadcast&intro=0` with the director's chip.
- `09-verifier`: no longer "pending feature". Record shot 9 from
  `/?persona=analyst&tamper=cf_value` (**Check**, then **Check the true value**).
- `10-real-footage` is already gone: #74 cut the real-footage segment.
- New entries for shot 8 (pressure hero), shot 10 (failure drill) and the optional skeleton
  insert. Every new URL without `at`, `run`, `ask` or `tamper` needs `&intro=0`, as the
  existing entries have.
- Rate limit: the API allows 3 new breakdowns per address every 10 minutes by default
  ([video/README.md](../video/README.md)), and a failure drill or a **Bring back** also takes
  one from the daily model cap. Record shot 10 last, and re-run a shot that got the template.

## What changed from SPEC §10

- 0:00–0:04, the lineup card, is in SPEC §10 and the capture kit; it is shot 0 here.
- 0:08–0:20 was "broadcast camera with live overlays". It is now the stitched match on the
  broadcast camera, with the camera director's suggestion.
- 0:55–1:25 gains the pressure hero (shot 8): the same system on a second lens.
- 1:25–1:40 was "the verifier blocks a wrong number and a banned judgement word". No view
  shows a banned word being blocked, so shot 9 shows **Try a wrong number** only. The failure
  drill and its bring-back (shot 10) are added, for the multi-agent category.
- The real-footage segment is cut (#74): no real footage anywhere. Its time goes to the
  failure drill.
- The corner set-piece hero is not in the video: it is in the simulator and its eval only,
  and its headline needs a caveat (see the closing slide).
- The optional skeleton view is an insert, first to cut.
