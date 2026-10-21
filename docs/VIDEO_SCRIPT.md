# Demo video script (≤ 2:00)

Built from the storyboard in [SPEC §10](SPEC.md#10-demo-video-storyboard--200), updated for
what has landed on `main` since: the stitched match, the pressure hero, the corner set-piece
hero (in the simulator and its eval only), the camera director, the optional skeleton view,
**Try a wrong number** and the failure drill. Shots that change with the Floodlit redesign are
marked **after #58 merges**. Open questions are marked `TODO(Bowen)`.

- **Length:** the timeline ends at 1:56, inside the rules' "under 2:00" with 4 s spare.
- **First cut, due 10/23:** record every shot from the live site as it is on `main` today. The
  current UI is fine for it. Re-record the app shots once #58 is merged and deployed.
- **Numbers:** the voice-over speaks a number only through a slot such as `{cf_value.dxt}`
  (claim id and value name). The capture kit fills the slot from the verified claims the page
  shows ([video/README.md](../video/README.md), "Numbers"), so the number spoken is the number
  on screen. Without the claim, the line falls back to the version with no number. The eval
  numbers on the closing slide come from `eval/reports/`, each with its file named on the slide.
- **Rights:** synthetic match, fictional clubs and players. No Premier League or club marks,
  real player names, broadcaster branding or copyrighted music in the edit either (titles,
  lower thirds, end card). No music by default ([video/README.md](../video/README.md), "Rights").

## Shot list

The site is https://ttesite1ff906.z14.web.core.windows.net; links below start from it. A
`shots.json` id means the capture kit records the shot (`cd video && npm run capture -- --only
<id>`). **New** means [video/shots.json](../video/shots.json) has no entry for it yet: until
one is added (see [Capture-kit follow-ups](#capture-kit-follow-ups)), record that shot by hand
from the link, at 1920 × 1080.

| # | Time | Len | Beat | On screen | Produced by | After #58 merges |
|---|---|---:|---|---|---|---|
| 1 | 0:00–0:07 | 7 s | Cold open | First person, at half speed: H8 looks over his shoulder, away from the ball; the runner H9 comes into sight; the **KEY SCAN** badge. Title lower third: "Through Their Eyes". | `01-cold-open` (`/?autoplay=0`, **Key scan**, speed 0.5, **Play**) | Re-record: POV motion blur during the head turn |
| 2 | 0:07–0:16 | 9 s | A whole match, live | The stitched match on the broadcast camera, live from the API: score bug ("Possession 2 of 6"), sprint tags. The director's chip, for example "Switch to H8's eyes: he checks over his shoulder before the ball arrives." One tap, and we are in his eyes. | **New.** `/?match=match-1&camera=broadcast`: the live stream starts at kick-off and the scan hero's possession starts at 30.0 s, so record about 45 s and keep the cut from about 0:28. The kit's `02-live-stream` is a stand-in for this beat. | Re-record: His eyes / Broadcast / Tactical bar, the other view as picture in picture |
| 3 | 0:16–0:38 | 22 s | The breakdown | The crew's replay: freeze, rewind, first person through his scans, the key scan lights up the runner, freeze at the pass with "he thought / it was". Captions are the app's verified lines. | `03-breakdown` | Re-record: **Read the moment**, story chapters |
| 4 | 0:38–0:50 | 12 s | **With / Without the look** (the highlight) | Frozen at the decision on the tactical board: the pass options flip between the two runs. Without the look, he plays it back to H4; the other run's ghost path plays on. | `04-with-without` | Re-record: the run switch is centred in the header |
| 5 | 0:50–1:01 | 11 s | One moment, many audiences | The same breakdown for casual → analyst → player fan, then the captions switch to 中文. | `05-personas` (≈ 7 s) + `06-language` (≈ 4 s) | Re-record: "Watching as …" in the header |
| 6 | 1:01–1:06 | 5 s | Evidence | Click a caption: the evidence card shows each claim, its kind (observed / computed / counterfactual), its verdict, and the replay seeks to the evidence frame. | `07-evidence` | Re-record: verified numbers carry a dotted underline, and the caption ends in a check that opens the evidence |
| 7 | 1:06–1:12 | 6 s | What if…? | A suggested question, then a typed one; the forced run plays as a gold ghost with its verified answer. | `08-what-if` | Re-record |
| 8 | 1:12–1:21 | 9 s | The pressure hero | Another moment, another lens: the centre-back H4 under a high press. Switch to **If he carried it** and play: the presser wins the ball. | **New.** `/?match=press_escape-0&run=counterfactual&at=decision&view=tactical`, then **Play**. Or, inside the match: `/?match=match-1`, **Moments** → the pressure hero → **Breakdown**. | Re-record |
| 9 | 1:21–1:30 | 9 s | The verifier blocks a wrong number | The evidence card opens on "That look was worth … in expected threat." with a wrong value filled in. **Check** → "Refuted — this line would not air", with its reason; **Check the true value** → supported. | **New.** `/?persona=analyst&tamper=cf_value`. The kit's `09-verifier` is still marked "pending feature"; the control has landed since. | Re-record: the card's new claim states |
| 10 | 1:30–1:38 | 8 s | Take an agent down | Producer desk: **Take down** on the Telestrator → **Run with Telestrator down**: its source reads template and the breakdown still plays. **Bring back** → only the Telestrator runs again, and its plan replaces the template. | **New.** `/?persona=analyst&lang=en`, the Breakdown panel's **Producer** desk. Each run counts against the rate limit; a drill lasts until the API's next restart or deploy. | Re-record: the desk moves to the "Behind the replay" chapter |
| 11 | 1:38–1:46 | 8 s | *Optional:* the overlays on a real camera | At most 10 s of the real-footage overlay. Label and attribution stay on screen the whole time. | `10-real-footage` (external: `demo/realfeed`, SPEC §7) | — |
| 12 | 1:46–1:56 | 10 s | Architecture and evidence | [docs/architecture.png](architecture.png) (the 1920 × 1080 frame), then the evidence lines below, then the end card. If shot 11 is cut, this shot starts at 1:38 and runs 18 s. | `11-architecture` (external: a slide) | — |

**Optional insert, first to cut** (SPEC §9 cut order 0): 2 s of **Skeleton** on the broadcast
camera in shot 2, showing every player's torso and head direction the way limb-tracking data
is shown. If it goes in, take the 2 s from shot 2's live footage.
Link: `/?match=match-1&camera=broadcast&at=751`, toggle **Skeleton**, **Play**. Frame 751 is
where the scan hero's possession starts (`sim.match.build_match(1)`).

**TODO(Bowen): the real-footage segment (shot 11).** It is your call, through #18. On `main`,
SPEC §7 and CLAUDE.md rule 2 require blurred faces and graphics only, with no numbers on the
footage. #18, still a draft, leaves faces unblurred and adds estimated numbers. Either update
the rules first, or keep the segment to what `main` allows. No exported segment has passed
`demo/realfeed/check.py` yet, and the frame-by-frame review is still open (SPEC §7). If either
is not done by the edit, cut the segment; shot 12 takes its time.

**TODO(Bowen): #48 (fitted xT).** Shot 4's line "That look was worth … in expected threat" and
shot 9's card show 0.10 today. #48 would make them 0.13 (its table, "Seed 3"). The voice-over
slot fills from whatever is deployed when the shots are recorded. Decide on #48 before
recording shots 4 and 9, or re-record both after it deploys.

## Voice-over (English)

About 260 words over 1:56, roughly 135 words a minute: room for the app's own captions to be
read. The lines for shots 3, 4, 6, 7 and 11 are those in `shots.json`, shortened where marked.
In a slot such as `{belief_error.err}`, the value comes from the page at capture time (see
"Numbers" above); the line in brackets is its fallback without the number. Outside the slots
there are no digits or number words, so every line can go into `shots.json` as it is
(`tests/test_video_shots.py` checks that).

| # | Voice-over |
|---|---|
| 1 | What did he see? … Replays show where the ball went. We show what the player saw. |
| 2 | A synthetic match with fictional clubs, streamed live from Azure. A camera director suggests where to look, and the system flags the moments worth explaining. |
| 3 | Our agent crew builds the replay. Back inside his head: the scans before the ball arrived, and the key look that showed him the runner. When he played the pass, his picture of the runner was off by `{belief_error.err}` metres. *[Fallback: drop the last sentence.]* |
| 4 | Now take that look away and re-run the simulation. Without it, he plays it safe and passes back. That look was worth `{cf_value.dxt}` in expected threat. *[Fallback: drop the last sentence.]* |
| 5 | The same verified facts, told for a casual fan, an analyst or a fan of the player. In English or in Chinese. |
| 6 | Every line opens its evidence: the claim, its verdict, and the frame that proves it. *(shortened)* |
| 7 | Ask what if. The simulator forces that choice and replays the moment. *(shortened)* |
| 8 | Under a high press, the lens changes. Make the centre-back keep the ball, and the press wins it. |
| 9 | Before anything airs, a verifier checks every number against the simulation. Type in a wrong number, and the line won't air. |
| 10 | Take an agent down, and its template airs. Bring it back, and only that step runs again. |
| 11 | *(optional)* The same graphics on a real camera, as a short test. Everything in the app itself is synthetic. |
| 12 | Built on Microsoft Foundry, Agent Framework and our own MCP server, with Azure AI Speech, Container Apps, Cosmos DB and Application Insights. Through Their Eyes: see what they saw. |

The app's own two voices (Azure AI Speech, **Sound on**) are not in the screen capture: the
capture kit records no audio. To use them under shot 3 instead of the narrator, record the tab
audio separately. TODO(Bowen): your voice, or the app's voices under shot 3?

## Closing slide (shot 12)

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
| Corner hero (simulator): unmarked without the marker's look, marked with it: **37 / 40** | `eval/reports/hero_marking_corner_blind_side.md` |
| False claims refuted by the verifier: **90 / 90** | `eval/reports/corruption.md` |
| Narration failing the verifier, free text vs anchored: **88% vs 0%** | `eval/reports/narration_ablation.md` |

**End card:** "Synthetic match · fictional clubs and players", the live site URL and the
repository URL. TODO(Bowen): the public repository URL, once the repo is public (by 10/26).

## Capture-kit follow-ups

This PR changes no code or capture data. `video/shots.json` is out of date with `main`, and
#58 also edits `video/`. So these changes are listed here, to make after #58, rather than made
now:
- `02-live-stream`: no longer a stand-in. The broadcast camera and the director are on `main`.
  Record shot 2 from `/?match=match-1&camera=broadcast` with the director's chip.
- `09-verifier`: no longer "pending feature". Record shot 9 from
  `/?persona=analyst&tamper=cf_value` (**Check**, then **Check the true value**).
- New entries for shot 8 (pressure hero), shot 10 (failure drill) and the optional skeleton
  insert.
- Rate limit: the API allows 3 new breakdowns per address every 10 minutes by default
  ([video/README.md](../video/README.md)). Record shot 10 last, and re-run a shot that got the
  template.

## What changed from SPEC §10

- 0:08–0:20 was "broadcast camera with live overlays". It is now the stitched match on the
  broadcast camera, with the camera director's suggestion. Both have landed.
- 0:55–1:25 gains the pressure hero (shot 8): the same system on a second lens.
- 1:25–1:40 was "the verifier blocks a wrong number and a banned judgement word". No view shows
  a banned word being blocked, so the shot shows **Try a wrong number** only. The failure drill
  (shot 10) is added, for the multi-agent category.
- The corner set-piece hero is on the closing slide only. It is in the simulator and its eval,
  not in the live app.
- The optional skeleton view is an insert, first to cut.
