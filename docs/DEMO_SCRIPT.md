# Live demo in three minutes (judging window, 2026-10-27 to 2026-11-10)

For the teammate on call when a judge or an organiser asks to see the project live: a
three-minute click path through the live site, what to say at each step, and what to do when
something is limited or down. Every link opens the live site at that spot. The parameters are in
[web/README.md](../web/README.md#url-parameters).

- **Site:** https://ttesite1ff906.z14.web.core.windows.net (no login)
- **API health:** https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/health
- **Numbers:** say only a number that is on the screen or in [NUMBERS](NUMBERS.md). Each number
  below names its row there; `TODO(freeze)` marks one that changes at the sim freeze.

## Ten minutes before

1. Open `/health`. Expect `"status":"ok"`, `"model":"foundry"`, `"speech":true` and
   `"analyst_mcp":true`. A first request after a restart can take about a minute while the
   replica warms up, so open it early.
2. Open the links below in tabs, in order, in desktop Chrome at 1440 px wide or more. The links
   to a spot (`at`, `run`, `tamper`, `play`) open paused. The two breakdown links start the live
   stream as soon as they open, so open those right before their step.
3. Check the cached breakdowns the path plays. On the Analyst · 中文 and Analyst · English links,
   open **Behind the replay** → **Producer · failure drill** and read each step's row: every
   model step should say **Model**. A cached run with a step on **Template** (on 2026-10-22 the
   cached analyst/zh run had its Analyst on Template after a model error) still plays and is
   still verified, but tell the team so they re-run that key, and demo the other language.
4. Turn the sound on, and share the browser tab, not the whole screen.
5. Keep one fallback tab ready: [the hero, offline](https://ttesite1ff906.z14.web.core.windows.net/?offline=1&view=pov&at=key-scan&intro=0).
   It plays the data bundled with the site and needs no API.

## The three minutes

| Time | Open | Do | Say |
|---|---|---|---|
| 0:00–0:25 | [His eyes at the key scan](https://ttesite1ff906.z14.web.core.windows.net/?view=pov&at=key-scan&intro=0) | Press **Play**. Playback slows through the look (the KEY SCAN tag). | "A synthetic match, every player fictional. This is J. Ferriday, the midfielder, through his own eyes. Just before the ball reaches him he looks over his right shoulder, and that look is the only time he sees N. Varnhall making the run." |
| 0:25–0:55 | [Without the look, at his decision](https://ttesite1ff906.z14.web.core.windows.net/?run=counterfactual&at=decision&view=tactical) | Show the board, then click **With the look** and back. | "We take that one look away and re-simulate the moment. Everything else is the same; only what he saw differs. Now he doesn't know where Varnhall is, so he plays it back to K. Annersley. Over 40 held-out seeds, 33 decide differently without the look." (NUMBERS H1; TODO(freeze)) |
| 0:55–1:35 | [Analyst · 中文](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=zh&intro=0) | Press **Sound on**. Let it stream to the moment; the breakdown starts by itself. Click a caption to open its claims and evidence frame. Read the provenance chip aloud. | "Once the moment is detected, a crew of agents on Microsoft Foundry explains it: a Director, an Analyst with our MCP tools, a Telestrator for the replay plan, two commentary voices, then a Verifier in code. Here it's for an analyst, in Chinese, voiced by Azure AI Speech. Every caption opens the claim behind it. The chip says who wrote this: [read it, e.g. 'Cached: a crew run from …']." |
| 1:35–2:00 | [Try a wrong number](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&tamper=cf_value) | Press **Check**: **Refuted**. Then **Check the true value**: supported. | "The narration agents can only pick verified claims; they never write a digit. Here you can type a wrong number yourself. The real Verifier checks it against the match data, and that line would not air." |
| 2:00–2:40 | [Analyst · English](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=en&intro=0), **Behind the replay** → **Producer · failure drill** | **Take down** the Telestrator, press **Run with Telestrator down**. When it airs, press **Bring back**, then **Crew trace**. | "Take an agent down, as in an outage. Its step retries once, then airs its template, and the breakdown still plays. Bring back resumes the Agent Framework workflow from its checkpoint and re-runs only that step and what reads it. The crew trace shows each agent's lane: its input and output, its tool calls, the Verifier's verdicts." |
| 2:40–3:00 | [The whole match](https://ttesite1ff906.z14.web.core.windows.net/?match=match-1&camera=broadcast&at=751) | Press **Play** for a few seconds on the broadcast camera. | "And it all runs inside a whole stitched match: 19 possessions, four hero moments, a camera director, and a recap at full time with a timecoded cue sheet a graphics engine can take. Synthetic data only, on Azure, live until November 10." (NUMBERS M1) |

The step-by-step version of the same path is in the app: the
[full tour](https://ttesite1ff906.z14.web.core.windows.net/?tour=1), or one of its steps such as
the [failure drill](https://ttesite1ff906.z14.web.core.windows.net/?tour=producer).

### If there is a fourth minute

- [Your call](https://ttesite1ff906.z14.web.core.windows.net/?play=yourcall): the judge decides
  with only what he knew, then sees what he did and why.
- [Take his eyes](https://ttesite1ff906.z14.web.core.windows.net/?play=eyes): drag his look
  elsewhere and watch his decision change.
- [A "What if…?" of your own](https://ttesite1ff906.z14.web.core.windows.net/?ask=What+if+he+had+kept+the+ball+and+dribbled+forward%3F):
  press **Ask**. The question maps to one of his options, the sim forces it and re-simulates,
  and the answer is verified lines with a gold ghost path. It is a model call (see the limits
  below).
- [The match recap](https://ttesite1ff906.z14.web.core.windows.net/?match=match-1&play=recap):
  **Play the recap reel**, then **Overlay cues (JSON)**.

## When something is limited or down

The service never hides where an answer came from. Say what the chip or badge says, and never
present a cached or template answer as a fresh model run.

| What happens | What you see | What to say or do |
|---|---|---|
| Today's model budget is used up (40 model runs a UTC day, 100 in the judging window; resets 00:00 UTC, which is 19:00 CDT, or 18:00 CST from November 1) | The chip reads **Cached: a crew run from \<time\> UTC**, or **Offline template: no model call (today's model budget is used up)**, with a **Daily cap reached** badge | "The crew wrote this at \<time\>; the daily cap protects a student budget. Every line on screen is still checked by the Verifier." The prewarmed breakdowns (every hero × audience × language) stay cached, so the main path is unaffected. |
| Too many new model runs from your address (3 per 10 minutes; 8 per 10 minutes in the judging window) | **Rate-limited** badge with the same chips | Same as above. Cached breakdowns do not count; the path above makes two new model runs (the drill and its bring-back), inside the limit. |
| The failure drill while limited | a **Recorded run · \<time\>** badge and the note "Recorded run from …", or "ran without the model: the steps it ran aired their templates" | "This is the same drill as it ran at \<time\>: a recording, because new model runs are limited right now." The ops checklist runs each drill once after the last deploy so that recordings exist ([OPERATIONS](OPERATIONS.md#the-judging-windows-cost)). |
| **Bring back** answers 404 | an error under the drill | The API restarted or redeployed since the drill ran (drills live on the replica's disk). Press **Take down** and run it again. |
| Foundry throttles or is down | the breakdown still airs; the chip says **Offline template**, and the Producer desk and Crew trace show **Template** steps | "Each agent retried once and fell back to its template; the crew still aired, and the Verifier checked every line." This is the failure policy working. |
| Speech quota or throttling | captions play without voice | Say the line yourself, or keep going: the captions carry it. |
| The API is down or the address is over its data budget (HTTP 429) | the app plays its bundled hero with an **Offline data** badge; `match-1` will not load | Switch to the offline tab above. The hero, the run without the look, Your call, Take his eyes and the bundled breakdown all play offline; the live stream, new breakdowns, What if and the whole match need the API. |
| A slow first breakdown | a spinner on the breakdown | The breakdown was not in the cache, so the crew is running: the first uncached request after a deploy took 24–26 s on 2026-10-20 (NUMBERS D1). Talk over it. Running `infra.prewarm` after every deploy keeps the tour's breakdowns cached. |

## What not to say

- **"The verifier checks every number on screen."** It checks every line the crew says or
  captions. Panels read straight from the simulation (scan counts, live stats, the score) are
  labelled as not claims.
- **"The crew writes better commentary than one model."** We measured it, and it doesn't: both
  aired no wrong facts. The crew buys recovery, steps that fit the timeout, per-author rewrites,
  parallel audiences and a per-agent trace (SUBMISSION, "Why a crew, not one agent").
- **A number from memory, or one this page does not cite.** Read it off the screen or
  [NUMBERS](NUMBERS.md).
- **Anything about real players, clubs or matches.** Everything is synthetic, fictional and
  generated by our simulator; no real data was used, not even for calibration.

## Questions judges ask, and short answers

- **Is any of this real data?** No. The rules require synthetic data. Our simulator generates
  the match at 25 Hz with head direction, and its perception parameters come from published
  papers ([realism](../eval/reports/realism.md)).
- **Is the counterfactual real or guessed?** Re-simulated. Random draws are keyed per player and
  purpose, so the two runs differ only through the removed look; forcing the action he actually
  chose reproduces the original run exactly (a test).
- **How would this work on real tracking?** The detectors read only head yaw and positions, the
  inputs that limb tracking or broadcast pose models give; the belief and the counterfactual need
  a simulator of the moment, which is what ours is. Nothing has been run on real tracking.
- **What does it cost to run?** About a cent per model breakdown; the judging window's worst
  case is in [OPERATIONS](OPERATIONS.md#the-judging-windows-cost).
- **Why several agents?** See "What not to say" above, and [RUBRIC_MAP §5](RUBRIC_MAP.md).
- **Will a rerun give the same numbers?** On the same platform, byte for byte. Across operating
  systems the last bits of `exp` and `atan2` differ, so open-play statistics move in their last
  digits and the hero stories stay the same; our reports are generated on Linux, as the live
  service runs (SPEC 3.7).
