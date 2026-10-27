# Through Their Eyes: submission page (draft)

Draft text for the Innovation Studio project page (SPEC §11), for Bowen to edit and approve.
Each number has a footnote naming the committed report, test or check it comes from. Drop the
footnotes when pasting into the page, or keep them as links. Open questions are marked
`TODO(Bowen)`.

<!-- State: main at febaa08 plus this PR (2026-10-21, US Central).
Before submitting: re-run `uv run pytest` and `uv run python -m sim.match --seed 1` on the
commit you submit and update [^tests] and [^match]. -->

---

## Through Their Eyes

**See what they saw.** An AI match studio that explains key football moments through the
player's own perception: where he looked before the ball arrived, who was in sight, and what he
believed. It replays the moment through his eyes, then re-simulates it without the one look that
made the play: over 40 held-out seeds, <!--num:H1.k-->33<!--/num--> decide differently.[^flip] Every line the
crew says or captions is checked by code before it airs: in an offline stress test. Of <!--num:V1.total-->2,837<!--/num--> deliberately broken lines, the Verifier kept every one off the air; without it, <!--num:V1.aired-->2,823<!--/num--> would have aired, <!--num:V1.false-->888<!--/num--> of them stating something false.[^crew-evidence] Around it: the whole match streams live at
1×, with its moments in **⋯ Settings → Moment**, the match recap, the Tactics lab, five audiences,
and English and Chinese.

## The problem

- **A replay shows where the ball went, not what the player knew.** Good players look around
  before they receive: about 3 scans in the 10 s before the ball arrives, in the published
  research.[^realism] A broadcast can't show what those looks showed him, what he missed, or
  how they changed his decision.
- **AI commentary makes up numbers.** We let a model narrate the same moment in its own words.
  About half of its first-draft lines (34 of 66) named a player or a number that no fact
  backs. One said "H8's picture of A5 was off by 1.2 metres", where the data says H9 and
  0.5 metres.[^ablation]

## Why it matters

- **The league's broadcast money is now as much overseas as at home.** Its broadcast revenue
  exports were £1.8bn in 2024/25,[^ey] about the £1.7bn a season of its UK deals (£6.7bn over
  2025/26–2028/29).[^uk-rights] The same report estimates that 1.9bn people follow the league,
  with its matches broadcast in 189 countries.[^ey] A replay explained once has to work for
  very different viewers.
- **Rights holders already serve one game to several audiences.** Amazon debuts new AI features
  on Prime Vision, an alternate stream it calls a laboratory for features that may reach the
  main feed; its Defensive Alerts already has.[^prime] The Premier League's partnership with
  Microsoft plans questions and answers in fans' native languages.[^pl-microsoft]
- **What we bring to that.** Through Their Eyes explains one moment for five audiences, in
  English or Chinese, and hands its overlays to a graphics engine as timecoded, machine-readable
  cues. AI output on air needs an audit trail: code checks every number our crew says or
  captions before it airs, and every verdict is logged. It does not judge what a recap leaves
  out, and it runs on synthetic matches only, so it shows the workflow, not accuracy on real
  matches.

## Business model

Hypotheses, not sales: no customer has seen it. The costs are our own measurements at demo scale,
at Azure list prices of 2026-10-22.[^azure-prices]

- **Who would pay.** Broadcasters' studios and alternate streams (a per-match or per-season
  licence for the explainers and their timecoded cues), clubs' analysis departments (per-seat
  review of scanning and decisions on their own tracking), and the league's fan apps (explainers
  in many languages, as its Microsoft partnership plans[^pl-microsoft]). No betting use.
- **Cost to serve.** One moment in four scripts: about $0.01 of Foundry `gpt-4.1-mini` (12
  requests, 22K tokens)[^crew] and about $0.03 of speech if every line is voiced ($0.0012 a
  line).[^tts] Hosting at demo scale: $17–46 a month, idle to busy.[^hosting] A re-watch costs
  no model call: breakdowns are cached by content and served in 0.15 s.[^latency] The cache's
  share of views: TODO(freeze).
- **What a licence must cover (hypothesis).** Twenty moments in five audiences and two languages
  cost about $0.50 of model calls and $1.40 of speech, so a per-match price is set by hosting, the
  tracking feed and editorial review, not by the model. We set no price and quote no market size
  beyond the sources above.
- **Still needed.** Tracking with head orientation from a rights holder (on synthetic keypoints
  the scan detector keeps F1 <!--num:A2-->0.962<!--/num--> at 20 mm of noise[^keypoints]), the rights to that data, a
  simulator calibrated on it, and human editorial review: the Verifier catches invented numbers,
  not omissions.

## Who uses it

- **Broadcasters.** A "through his eyes" studio segment: the replay of a moment from the player's
  side, with every number checked before it airs and the overlays handed over as timecoded cues.
- **Coaches and academies.** The academy drill asks the trainee where to look before the ball
  arrives, then shows what that look would have caught. Jordet et al. (2020) link scanning before
  receiving to a small gain in pass completion in Premier League players; that is an association
  in match data, and we have not tested whether the drill changes anyone's scanning.
- **Blind and low-vision fans.** The audio description audience we ship: where he got the ball,
  which way he looked and whom he saw, as verified lines in calm, slower speech.

The offers, costs and what is still missing are in [Business model](#business-model).

## What it does

The brief's pipeline, end to end, on a synthetic match:

| Stage | What happens | Code |
|---|---|---|
| **Ingest** | Our physics-based simulator generates a match: 22 fictional players at 25 Hz, with body and head direction.[^spec31] The API streams it over WebSocket at real speed, as the events happen. | `sim/`, `api/` |
| **Interpret** | Analytics kernels read the tracking: time to intercept, pitch control, pressing, field of view, expected threat (xT), a scan detector that reads head direction only, and blind-side alerts. | `analytics/` |
| **Explain** | The system detects moments and gives each one the lens with the biggest counterfactual impact (the player's perception, pressure or space). It re-simulates the moment with one change and turns the results into claims, which a deterministic Verifier checks. | `explain/` |
| **Render** | A first-person view through the player's eyes, a broadcast camera with a camera director, and a tactical board with pass options ("he thought / it was"). Overlays show his vision cone, where he believed the others were, pitch control (a GPU shader), blind-side alerts, and the counterfactual's ghost paths. | `web/` |
| **Personalize** | An agent crew on Microsoft Foundry writes the breakdown for five audiences (casual, analyst, player fan, coach, audio description) in English or Chinese. Azure AI Speech voices it with two commentators. Each audience gets its own broadcast from the same verified claims: what is said, the camera and overlays, and the voice. Across the four served hero moments, the mean overlap of the claims two audiences hear fell from <!--num:P1.before-->0.34<!--/num--> to <!--num:P1.after-->0.16<!--/num-->, and <!--num:P2.after-->40<!--/num--> of 40 scripts keep their audience's spec (<!--num:P2.before-->8<!--/num--> of 40 before).[^personas] | `agents/`, `api/` |

### From the moment to the matchday

A plain visit opens a **landing page** (`?door=home`) with the promise, **Watch the look (60 s)**,
direct links into every feature and the evidence. The brand returns to it. Three doors sit beside
one **⋯ Settings** menu throughout: **The look**, **Your turn** and **For studios**. Settings holds
the moment picker, commentary audience and language, club and player to follow, sound, view options
and the full tour.

- **The look** (`?door=look`). The live picture and the moment's story: his scan, the same seconds
  re-simulated without it, the two compared from above, the scan step-through, commentary,
  evidence and what-ifs. **With two more looks** is the opposite experiment: add one look to his
  left and one to his right, and his decision changes in <!--num:H10.k-->0<!--/num--> of
  <!--num:H10.n-->40<!--/num--> held-out seeds, the expected result: more looks are not the right look.
- **Your turn** (`?door=turn`). Three cards open **Make his call**, **See through his eyes** and
  **Train your scanning**: decide with only what he knew, choose when and where he looks, or check
  your shoulder before the ball arrives.
- **A · AI Tactical Broadcast** (`?step=broadcast`). A broadcast's questions open the Tactics lab
  card or scan story that answers them. The lab measures five tactics on the synthetic match, with
  **Pro** and **Plain** explanations, a definition and source on every parameter row, and moment
  links. Tactical terms throughout the app open plain-language glossary definitions; analysts get
  extra detail where available.
- **B · AI Personalised Commentary** (`?step=commentary`). The audience and language are chosen in
  Settings, with one player followed under Follow. Below are the AI crew, its evidence, failure
  drill and trace.
- **C · AI Automated Highlights** (`?step=highlights`). The moment as a package built offline from
  the verified breakdown: a highlight reel, shot list, captions, posts per platform and landscape
  and vertical cards for the league's channels. A sentence with a number no supported claim
  carries is dropped.
- **D · AI Stadium Experience** (`?step=stadium`). The main video board, tunnel LED and ribbon
  ring for the moment, with a link to the Stadium Screen Studio's virtual 3D preview. Sponsors are
  fictional.
- **Value** (`?step=value`). The league's revenue levers come first: broadcast differentiation,
  sponsor inventory, international and app engagement, social reach and lower production cost.
  Then come the measured model cost and demo KPIs. Audience, engagement and sponsor figures are
  simulated by a seeded model and badged as such; match facts are never simulated this way.
- **The coach's example.** The scan story links to `pro_scan` at
  `?play=steps&match=pro_scan-116`: look left, drop back, look right, receive on the half-turn and
  play forward. Its frozen steps explain what each look added and which options opened or closed.

Chapter cards and headings use scroll reveal; deep-link jumps keep the text visible, and reduced
motion shows everything immediately.

## The signature feature: through the player's eyes

1. **Scans.** The simulator moves each player's head. A scan is a quick look away from the ball
   and back. Its speed, length and rate come from published values, for example a peak head
   speed of 404 ± 51°/s (published: 404.2 ± 50.7).[^realism]
2. **Vision.** A probabilistic field of view decides who is in sight on every frame. It follows
   Bekkers (2026), *Wide Open Gazes*.
3. **Belief.** Each player keeps a mental map: every other player where he last saw him, carried
   forward. He decides on that map, never on the true positions.
4. **Counterfactual.** We re-simulate the moment with that one look removed. Random draws are
   tied to each player and purpose, not to one shared sequence. So the two runs differ only
   because of the change. Without the look, the midfielder plays it back; with it, he finds the
   runner. Over 40 held-out seeds, <!--num:H1.k-->33<!--/num--> decide differently without the look.[^flip]
5. **Verified numbers.** Every number in the captions, the narration and the evidence cards is
   a claim computed from the match and checked by code before it airs. Viewers can open any
   caption's evidence, or try a wrong number and watch the Verifier refute it.[^verify] Other
   numbers on screen (the lineup card's scans, sprint tags, the score bug, the telemetry) are
   read straight from the simulation; they are not claims, and the Verifier does not check them.

**Four hero moments.**
- **Scan hero:** a midfielder's one look over his shoulder shows him the runner. Live in the app.
- **Pressure hero:** a centre-back under a high press. Re-simulated with him forced to keep the
  ball, he loses it in <!--num:H4-->40 of 40<!--/num--> fresh seeds.[^press] Live in the app.
- **Shot hero:** a striker's look at the goal updates his picture of the keeper and changes where
  he places the shot. Live in the app as the stitched match's third hero; he scores.
- **Set-piece hero:** at a corner, a defender marks the striker where he *believes* the striker
  is. In <!--num:H7-->37 of 40<!--/num--> held-out seeds, the striker is unmarked at the cutback without the defender's
  look, and marked with it.[^marking] That headline uses a gate revised during design; the
  original plan's checks, reported in the same file, are not met. Live in the app, as the
  stitched match's fourth hero.

The live heroes play inside a stitched match: 19 possessions on one clock, about 13½ minutes.
The shot hero scores (1–0), and the set-piece hero's corner comes at 1–0.[^match]

## The multi-agent design

One Microsoft Agent Framework workflow builds each breakdown. Models choose; code states the
facts.

```
Director → Analyst (+ our MCP tools) → ┬─ Telestrator ──────────────┬→ Voice
                                       └─ Narration ⇄ Verifier ─────┘
```

| Agent | Its job | Runs on |
|---|---|---|
| **Director** | Sets the breakdown's priority from how much the moment changed the outcome, with a one-line reason in words | Foundry model |
| **Analyst** | Picks the lens and the headline facts. It inspects the moment with tools from our own MCP server: the moment, claims, vision, pitch control, xT, pressing, counterfactual re-simulation, what-if. It answers with claim ids from a fixed list of verified claims. | Foundry model + MCP |
| **Telestrator** | Writes the timed replay plan: camera cuts, freezes, first-person segments, scan markers, ghost paths. The plan is checked with the web app's own rules; an invalid plan is replaced by a template. | Foundry model |
| **Narration** (two voices) | Play-by-play and colour commentary per audience and language. Each line is a verified claim id or an allowed connective ("Watch this."). Both are fixed lists in the output schema, so the model can't write a number. | Foundry model |
| **Verifier** | Checks every line against the match data. A refuted line goes back to its author for a rewrite, at most twice, then it is dropped. | Code |
| **Voice** | Waits for both the plan and the approved lines, puts the lines on the plan's clock, and writes SSML for Azure AI Speech. | Code |

- **Shared state and handoffs.** Every step reads one shared moment context: the run, the
  counterfactual, the claims, the verdicts and the audit log. Steps pass typed messages along
  the workflow's edges. The Telestrator and narration run in parallel, and narration drafts
  every audience and language at once.
- **Failure recovery.** Each model step has a timeout, one retry, then its deterministic
  template, so a breakdown always airs.[^spec6] The live app makes this visible as a
  **failure drill**: in the Producer desk, take the Telestrator down and run the crew. It fails
  as in an outage and its template plan airs. **Bring back** resumes the workflow from its
  checkpoint and re-runs only the Telestrator and the step after it. A breakdown interrupted
  mid-run resumes from its last checkpoint, also after the API process restarts; the checkpoints
  are on the replica's disk, so a redeploy starts without them.
- **Observed live.** In one traced breakdown on Azure the whole breakdown took 15.5 s: 5.1 s to
  start our MCP server, then 9.9 s for the crew, with the Analyst making two MCP tool
  calls.[^trace] A cached breakdown is served in 0.15 s.[^latency]
- **Why anchor the narration.** On the same moments, about half of the free-text first-draft
  lines (34 of 66) named a player or a number that no claim holds; the Verifier stopped every one.
  Anchored narration, where the model picks claim ids, had 0 of 111.[^ablation]

### Why a crew, not one agent

We measured it. One Foundry agent doing the four model roles in one call, with the same tools,
schemas and checks, against the crew, on six moments for four audiences each.[^crew]

- **Not better lines.** Both aired no wrong fact and scored the same groundedness. The Verifier
  and the anchored schema keep the facts right, whichever structure writes the lines. The crew
  costs about twice as much per breakdown.
- **Recovery that keeps the rest.** With one agent down, the crew still aired three of its four
  model roles; the single agent lost all four, because its one call is every role. Bringing the
  Telestrator back cost the crew one model request; the single agent had to redo everything.
  Bringing the Analyst back costs the crew more than the single agent's redo, because every
  later step reads the Analyst and runs again. When the model service itself fails, every
  request is still answered with a verified breakdown, on templates.[^crew-evidence]
- **Steps that fit the deployed timeout.** No crew step took longer than the API's 8 s step
  timeout; every single-agent call did, so deployed it would have aired its templates.
- **Checked inside the workflow, rewritten by its author.** A line the Verifier rejects goes
  back to the voice that wrote it, told why; the plan and the other lines stand. Of <!--num:V1.total-->2,837<!--/num--> deliberately broken lines, the Verifier kept every one off the air; without it, <!--num:V1.aired-->2,823<!--/num--> would have aired, <!--num:V1.false-->888<!--/num--> of them stating something false.[^crew-evidence]
- **Audiences in parallel.** Each audience and language is its own narration call, run at once:
  ten scripts take about as long as one (about 3.5 s), though the whole crew is not faster than
  one agent.[^crew-evidence]
- **Auditable per agent.** Every breakdown carries its crew trace: each step's input and output,
  the state it read and wrote, the Analyst's tool calls, the verdicts, and whether each part came
  from the model or a template. **Crew trace** in the app shows it as a timeline. Every aired line
  in our offline run traced back this way (394 of 394).[^crew-evidence]

## Evidence

| Claim | Result | Source |
|---|---|---|
| Without the key look, the scan hero decides differently | <!--num:H1-->33 of 40<!--/num--> held-out seeds | [^flip] |
| Lens selection picks the lens each hero is built for | scan hero <!--num:H2-->34/40<!--/num-->; pressure hero <!--num:H3-->40/40<!--/num--> on fresh seeds | [^lens], [^press] |
| Forced to keep the ball, the pressure hero loses it; the possession outcome changes | <!--num:H4-->40/40<!--/num--> lost; <!--num:H5-->32/40<!--/num--> changed | [^press] |
| Set-piece hero: unmarked without the look, marked within 5 m with it | <!--num:H7-->37/40<!--/num--> (gate revised during design; the plan's checks, in the same report, are not met); median gap 8.5 m without vs 3.3 m with | [^marking] |
| Scans detected from head direction alone, with sensor noise, aborted turns and drift on (held-out F1) | 0.991 | [^detector] |
| Blind-side alerts against the players' simulated beliefs (fresh seeds) | precision 0.914, recall 0.946 | [^blind] |
| Perturbed claims refuted by the Verifier (a number off by one unit or by 20%, a swapped player, a wrong order); true claims it wrongly rejected | <!--num:A5-->90 of 90<!--/num-->; <!--num:A5b.rejected-->0<!--/num--> of <!--num:A5b.n-->468<!--/num--> | [^corruption] |
| First-draft narration lines naming a player or number that no claim holds: free text vs anchored | 34 of 66 vs 0 of 111; groundedness of the aired scripts 4.90 vs 5.00 (Foundry evaluator) | [^ablation] |
| Simulator statistics against published values | <!--num:R3.inside-->11<!--/num--> inside the published range, <!--num:R3.outside-->5<!--/num--> outside, <!--num:R3.none-->10<!--/num--> with no published value | [^realism] |
| GPU pitch-control shader against the numpy reference | max difference about 5e-5 (target < 0.02) | [^parity] |
| Same seed, same output (same platform) | byte-identical | [^determinism] |
| Test suites in CI on `main` | Python 1216 passed; web 595 passed; end-to-end smoke 15 of 15 pages | [^tests] |

## Microsoft technologies, where they are used

Each row was checked against the code on `main`. We list only what the running system or our
development used (SPEC §11).

| Technology | Where | Evidence |
|---|---|---|
| **Microsoft Foundry** (`gpt-4.1-mini`, structured outputs) | Every model step of the crew, and mapping a viewer's "What if…?" question to an option. Keyless, with a managed identity. [`agents/llm.py`](../agents/llm.py) (`FoundryChatClient`), [`api/main.py`](../api/main.py) | `/health` reports `model: foundry`; `chat gpt-4.1-mini` spans in Application Insights |
| **Microsoft Agent Framework** | The crew as one workflow: typed executors, fan-out, the rewrite loop, requests for downed agents, checkpoints. [`agents/workflow.py`](../agents/workflow.py), [`api/store.py`](../api/store.py) | [`tests/test_agents.py`](../tests/test_agents.py), [`tests/test_crew_recovery.py`](../tests/test_crew_recovery.py) |
| **MCP** (our own tool server) | The Analyst's tools. The deployed API starts it for every uncached model breakdown. [`agents/mcp_server.py`](../agents/mcp_server.py) | `/health` reports `analyst_mcp: true`; `tools/call` spans under the Analyst ([live trace](RUBRIC_MAP.md#the-live-trace)) |
| **Microsoft Foundry evaluation** (`azure-ai-evaluation`) | `GroundednessEvaluator` scores free-text vs anchored narration. [`eval/narration_ablation.py`](../eval/narration_ablation.py) | [narration ablation report](../eval/reports/narration_ablation.md) |
| **Azure AI Speech** | Neural voices from SSML, two per language. [`api/tts.py`](../api/tts.py), [`agents/delivery.py`](../agents/delivery.py) | `POST /api/tts`; **Sound on** in the app |
| **Azure Container Apps** (image in Azure Container Registry) | The API. [`Dockerfile`](../Dockerfile), [`infra/deploy.sh`](../infra/deploy.sh) | live API URL below |
| **Azure Storage static website** | The web app. [`infra/deploy.sh`](../infra/deploy.sh) | live site URL below |
| **Azure Cosmos DB** (serverless) | Breakdown cache and the claims audit log. [`api/store.py`](../api/store.py), [`explain/audit.py`](../explain/audit.py) | [`/api/matches/blind_side_run-3/audit`](https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/matches/blind_side_run-3/audit?limit=5) |
| **Application Insights** | OpenTelemetry spans for every agent step and MCP tool call. [`agents/telemetry.py`](../agents/telemetry.py) | one trace per breakdown ([live trace](RUBRIC_MAP.md#the-live-trace)) |
| **GitHub Actions** | CI, and a deploy on every green `main`. It logs in to Azure with OIDC, so no Azure secret is stored. [`.github/workflows/`](../.github/workflows) | workflow runs |

Development: built with Claude Code. GitHub Copilot, the Azure MCP Server and Microsoft Fabric
were not used.[^devtools]

## How this relates to FIFA AI Pro

FIFA AI Pro, the assistant Lenovo built with FIFA for the 2026 World Cup teams, answers analysts'
questions about matches from official data (Lenovo reports more than 2,000 metrics), before and
after a match.[^fifa-ai-pro] Through Their Eyes works on a different question: what the player
saw and what he believed, while the synthetic match streams live. Every number in its captions
and narration is a verified claim that viewers can open and challenge with **Try a wrong
number**, and every "What if…?" is re-simulated in the simulator.[^how-we-differ] Lenovo's
Referee View camera brings fans a first-person view of what a camera captured; we show what the
player perceived.

[^fifa-ai-pro]: [docs/REFERENCES.md](REFERENCES.md#related-products-judges-may-know-fifa-ai-pro-and-referee-view-world-cup-2026):
    the FIFA and Lenovo press releases; every FIFA and Lenovo figure is company-reported.
[^how-we-differ]: [api/live.py](../api/live.py): the 25 Hz stream and the moments it announces;
    [web/src/tamper/tamper.ts](../web/src/tamper/tamper.ts) and [api/tamper.py](../api/tamper.py):
    **Try a wrong number** (`POST /api/verify`); `force_action_counterfactual` in
    [sim/counterfactual.py](../sim/counterfactual.py), run for each what-if through
    [agents/whatif.py](../agents/whatif.py).

## Synthetic data only

Every match, club and player is fictional, generated by our own simulator. No real match
data, footage, logos or player names are in the app or the video, and the repository holds no
real footage or tracking data. No model parameter is fitted to real data: they come from
published research.

## Try it

No login, free, live until 2026-11-10.
- **Web app:** https://ttesite1ff906.z14.web.core.windows.net
- **API:** https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/health
- **A 3-minute tour with deep links:** the README's
  ["Judge it in 3 minutes"](../README.md#judge-it-in-3-minutes), then
  ["The full tour"](../README.md#the-full-tour). Together they cover the first-person
  view at the key look, with and without the look, a live breakdown in Chinese, your own
  "What if…?", trying a wrong number, the failure drill, and the whole stitched match with both
  live heroes and the camera director.
- Model-backed breakdowns are rate-limited per visitor and capped per day. Past that, the
  service serves the cache or the deterministic template, so the demo keeps working.
- **Code:** https://github.com/timothyzhbw-jpg/through-their-eyes (public, MIT).
- **Video:** https://youtu.be/1Z14E_X2JXA (1:27, public on YouTube, captions burned in).

## Team

Four people, each owning one area and reviewing the others' work.

| Member | Role |
|---|---|
| Jiaan Hu | **Product manager.** Product direction, target users, MVP scope and feature priorities; the project's narrative and demo priorities; the business value (AI tactical broadcast, personalised commentary, automated highlights). |
| Bowen Zhang | **Website development and visual production.** Builds and maintains the app and its website to the agreed requirements; creates the cinematic sequences that show the concept. |
| Yiting Shen | **Synthetic data and source review.** Prepares the synthetic match data used by the prototype and the demo; checks the provenance of assets and reference material; keeps demo material clearly apart from real match data. |
| Jiangyan Yang | **Website feature planning, commentary refinement, football domain review and user testing.** Plans page-level features with the product manager; refines the explanatory commentary so that it states the player's decisions and the tactics plainly; reviews the football and tests the app with users. |

Shared by all four: reviewing the integrated prototype and the demo flow before submission, and
checking that every claim in the demo is supported by the prototype and its synthetic data. Ideas
about wider broadcast, streaming and social-media monetisation are exploratory unless the
submitted product demonstrates them.

## Limitations

- **Synthetic data only.** Nothing has been run on real tracking data, which the rules don't
  allow anyway. The scan detector's and blind-side alerts' scores are scores on our simulator.
  The alerts share the simulator's model of what a player expects, so their score is an upper
  bound for real tracking.[^blind]
- **Audience and sponsor figures are simulated.** Automated highlights and Value show impressions,
  engagement and sponsor slots from a seeded model, labelled "Demo data: simulated audience, not
  real results". No audience exists yet, and the sponsors are fictional.
- **Causal only inside the simulator.** A counterfactual is a re-simulation, so every
  counterfactual outcome depends on our models of movement, perception and decisions. On real
  data we could only claim association.
- **Realism is partial.** Of the 16 simulator statistics we can check against a published
  value, <!--num:R3.outside-->5<!--/num--> fall outside the published range. All five compare scan rates between roles or
  pressure levels. Published players scan less when an opponent is tight on them (d = +0.57);
  ours do too, but much less so (d = <!--num:R4.d-->0.15<!--/num-->).[^realism]
- **No tackles yet.** In the stitched matches the ball changes hands by interceptions only: 0
  tackles and 0 balls out of play that change possession per 90 minutes over 20 stitched
  matches. Tackles are switched on in the pressure hero's scenario alone.[^matchstats]
- **xT is our own grid, not fitted to real football.** A gain such as "That look was worth … in
  expected threat" is a value inside the simulation.
- **The stitched match has one goal, from its shot hero:** open play has no shots
  (`possession_play` scripts its passes), so the scoreline is the heroes' doing.[^match]
- **The crew does not write better lines than one agent.** Against a single agent doing all four
  model roles in one call, on the same moments, tools and schemas, the crew aired no fewer wrong
  facts (none in either) and scored the same groundedness; what it buys is recovery and
  auditability, at about twice the cost per breakdown.[^crew]
- **Not yet measured:** no viewer study, and no frame-rate run on a laptop's integrated GPU.
- **Tactics: a measured lab, not a knowledge base.** For studios' Tactics lab measures five
  tactics, with Pro and Plain explanations, definitions, sources and honest limits. Separately,
  the analyst's stats panel and recap answer "why build from the back?" and "why focus on set
  pieces?" with one verified sentence each. The lab does not supply a general tactics knowledge
  base; richer evidence still needs tackles, crosses and open play that shoots (see the roadmap).
- **A failure drill lives on one replica's disk.** A restart or redeploy drops it, and
  **Bring back** then answers 404.
- **Team shapes are looser than a Premier League side's.** The hero moments are built to stage
  one perception problem, and their defending side is not always a compact back line: in the
  scan hero the back line is spread when the runner gets in behind it. The open-play team shape
  is fitted to published positional data (SPEC 3.2), but a scripted scenario overrides it where
  the moment needs a gap.

## Roadmap: a tactics knowledge base

Teammates who play proposed a tactics knowledge base: each tactic, its mechanism, the data that
shows it and a sentence for a fan. The current app has the five-tactic measured Tactics lab plus
these two verified narrative cards; a general knowledge base remains future work.

- **Why build from the back?** Under pressure, Home completed 30 of 38 short passes out from the
  back in match-1 (79%, against 86% without). The pressure hero's recorded options show his
  safest pass was back to the keeper.
- **Why focus on set pieces?** The one corner reached 0.20 xT in 4.4 seconds, more than 17 of
  the 18 open-play passages. No shot followed: the stitched match cuts the corner before one
  could.

Every number is measured from tracking and events, and each card's sentence is verified before
it airs. The other six rows (high press, counter-attack, wide overloads, central penetration, low
block, counter-press) need events the simulator does not produce yet. [docs/TACTICS.md](TACTICS.md)
lists, for each, what it would need: tackles and duels everywhere, crosses and headers, and open
play that attacks the goal.

---

[^realism]: [eval/reports/realism.md](../eval/reports/realism.md): scans in the 10 s before
    receiving, sim 2.77 vs published 3.0 ± 2.1 (Jordet et al. 2020); peak head speed 404 ± 51°/s
    vs 404.2 ± 50.7 (Kokubu et al. 2026); "11 inside, 5 outside, 0 inconclusive, 10 with no
    published reference".
[^ablation]: [eval/reports/narration_ablation.md](../eval/reports/narration_ablation.md): free
    text, 120 lines drafted, 54 dropped as repeats, 66 first-draft lines left; 34 of them with an
    id or number no cited claim holds ("Made up", 34 lines; 47 ids and numbers), found by the
    Verifier. Counting every kind of Verifier failure, formats included, 58 of 66 (88%) failed.
    Anchored: 0 of 111.
    Groundedness (1–5) of the scripts that aired after the rewrites: 4.90 vs 5.00. The
    "1.2 metres" line is quoted from its section "Free-text failures, verbatim" (seed 3,
    analyst/en).
[^azure-prices]: Azure Retail Prices API (https://prices.azure.com/api/retail/prices), region
    `northcentralus`, queried 2026-10-22: `gpt-4.1-mini` global $0.40 / $0.10 / $1.60 per 1M
    input / cached input / output tokens; Azure AI Speech S1 neural text to speech $15 per 1M
    characters; Container Apps consumption $0.000024 per active vCPU-second, $0.000003 per idle
    vCPU-second and per GiB-second; Container Registry Basic $0.1666 a day. The same prices on
    the pricing pages:
    [Azure OpenAI](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/),
    [Speech](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/),
    [Container Apps](https://azure.microsoft.com/pricing/details/container-apps/).
[^tts]: [docs/SPEC.md](SPEC.md) §8: a narration line bills about 80 characters (the SSML markup
    counts, a Chinese character twice); [crew_vs_single](../eval/reports/crew_vs_single.md): 23.5
    lines per four-script breakdown. 80 × $15 per 1M characters = $0.0012. The demo runs on the
    free F0 tier (500K characters a month).
[^hosting]: One API replica of 0.5 vCPU and 1 GiB, always on, for 30 days: $11.66 idle, $38.88
    active the whole time, before the monthly free grant; Container Registry Basic $5.00; Cosmos
    DB serverless, the static site and egress under $2 together at our traffic
    ([docs/SPEC.md](SPEC.md) §8 cost table, [docs/OPERATIONS.md](OPERATIONS.md)).
[^keypoints]: [eval/reports/keypoint_ingest.md](../eval/reports/keypoint_ingest.md), the 20 mm
    stress row.
[^spec31]: [docs/SPEC.md](SPEC.md) §3.1: 25 Hz frames, per-player body and head yaw.
[^flip]: [eval/reports/hero_flip_blind_side_run.md](../eval/reports/hero_flip_blind_side_run.md):
    seeds 100–139, decision changed without the key scan in <!--num:H1-->33/40<!--/num-->.
[^verify]: [tests/test_api.py](../tests/test_api.py)
    `test_a_wrong_number_is_refuted_and_its_line_would_not_air` and
    `test_the_verified_number_is_supported_and_its_line_airs`.
[^press]: [eval/reports/hero_lens_press_escape.md](../eval/reports/hero_lens_press_escape.md):
    fresh seeds 200–239, pressure lens <!--num:H3-->40/40<!--/num-->, ball lost after the forced carry <!--num:H4-->40/40<!--/num-->, outcome
    changed <!--num:H5-->32/40<!--/num-->.
[^lens]: [eval/reports/hero_lens_blind_side_run.md](../eval/reports/hero_lens_blind_side_run.md):
    seeds 100–139, scan lens selected <!--num:H2-->34/40<!--/num-->.
[^marking]: [eval/reports/hero_marking_corner_blind_side.md](../eval/reports/hero_marking_corner_blind_side.md):
    seeds 100–139, <!--num:H7-->37/40<!--/num-->; median separation 3.3 m with the look, 8.5 m without.
[^match]: [docs/SPEC.md](SPEC.md) §3.1; `uv run python -m sim.match --seed 1` prints 19
    possessions and "808.3 s, 1-0" on a Mac (2026-10-22 CT, with the referee and the team shape). Where open play goes out
    differs by platform (SPEC 3.7), so the live match's details can differ.
[^crew-evidence]: [eval/reports/crew_evidence.md](../eval/reports/crew_evidence.md) (PR #195):
    offline, a scripted model answering through the real Agent Framework workflow, schemas and
    Verifier, on the 7 hero moments the site serves × 5 audiences × 2 languages, generated in
    `python:3.11-slim`; times simulated at Foundry's median latency per role.
[^personas]: [eval/reports/persona_distinctness.md](../eval/reports/persona_distinctness.md)
    (PR #205), `uv run python -m eval.persona_distinctness`: the crew offline on its templates,
    4 served hero moments × 5 audiences × `en`, `zh` = 40 scripts; claim overlap is the mean
    pairwise Jaccard of the claim ids two audiences' scripts cite.
[^spec6]: [docs/SPEC.md](SPEC.md) §6, failure policy; `DEFAULT_TIMEOUT_S = 8.0` and `RETRIES = 1`
    in [agents/llm.py](../agents/llm.py).
[^trace]: [docs/RUBRIC_MAP.md](RUBRIC_MAP.md#the-live-trace): 2026-10-20 21:34:51 UTC, revision
    `tte-api--0000017`, 15467 ms in the `breakdown` span, 5093 ms `mcp`, 9898 ms `workflow.run`.
[^latency]: [docs/SPEC.md](SPEC.md) §8, "Deployed 2026-10-20": the same request from the
    cache took 0.15 s; "Live on Container Apps": 12.9 s uncached on a warm replica, 25.9 s for
    the first request after a new revision.
[^detector]: [eval/reports/scan_detector.md](../eval/reports/scan_detector.md): held-out F1 <!--num:A1-->0.991<!--/num-->
    with nuisance head motion on.
[^blind]: [eval/reports/blind_side.md](../eval/reports/blind_side.md): fresh held-out precision
    0.914, recall 0.946, and the upper-bound note.
[^corruption]: [eval/reports/corruption.md](../eval/reports/corruption.md): <!--num:A5-->90/90<!--/num--> false
    perturbations refuted; <!--num:A5b-->468/468<!--/num--> generated claims supported, so <!--num:A5b.rejected-->0<!--/num--> wrongly rejected.
[^parity]: [docs/RUBRIC_MAP.md](RUBRIC_MAP.md) §1;
    [web/src/pitchControl/pitchControl.gpu.test.ts](../web/src/pitchControl/pitchControl.gpu.test.ts),
    10 hero-moment snapshots in headless Chrome.
[^determinism]: [tests/test_sim_m1.py](../tests/test_sim_m1.py)
    `test_same_seed_twice_in_the_same_environment_is_byte_identical`.
[^tests]: CI run 39583678095 on main at 44c0bb5, 2026-10-21: pytest "1216 passed in 612.99s",
    vitest "Tests 595 passed", smoke "15 of 15 pages passed".
[^matchstats]: [eval/reports/match_stats.md](../eval/reports/match_stats.md): possession changes
    by tackle per 90 min 0 and out of play 0 (n = 20 matches); "Tackles are on in press_escape
    only".
[^crew]: [eval/reports/crew_vs_single.md](../eval/reports/crew_vs_single.md), 2026-10-21, six
    moments × four audiences on Foundry `gpt-4.1-mini` (single vs crew): wrong facts aired 0 vs
    0, groundedness 5.00 vs 5.00; with the Analyst or the Telestrator down, model roles kept 0 of
    4 vs 3 of 4; bringing back the Telestrator 1.7 vs 1.0 model requests, the Analyst 1.7 vs
    11.0; agent runs over 8 s 6 of 6 vs 0 of 66; $0.0046 vs $0.0090 per breakdown.
[^ey]: EY for the Premier League, *Economic and Social Impact Report*, July 2026
    ([PDF](https://resources.premierleague.pulselive.com/premierleague/document/2026/07/31/8ee78e99-a3e3-4b81-ab38-cf76eae8dd94/Premier-League-Economic-and-Social-Impact-Report-2026.pdf)):
    "broadcast revenue exports totalling £1.8b in 2024/25"; "1.9b people follow the Premier
    League worldwide"; broadcast content "reaches 189 countries".
[^uk-rights]: Premier League, 4 Dec 2023 ([article](https://www.premierleague.com/en/news/3807882)):
    UK agreements worth "a total of £6.7billion in revenue across the four-year period" from
    2025/26; £6.7bn over four seasons is about £1.7bn a season.
[^prime]: Amazon, Thursday Night Football on Prime Video, 2025 season
    ([article](https://www.aboutamazon.com/news/entertainment/thursday-night-football-amazon-prime-video-ai-features)):
    "Prime Vision serves as a laboratory and incubator for new features that may eventually
    advance to the main feed"; Defensive Alerts returns in the main feed.
[^pl-microsoft]: Microsoft, 1 Jul 2025
    ([announcement](https://news.microsoft.com/source/2025/07/01/premier-league-and-microsoft-announce-five-year-strategic-partnership-to-personalize-the-fan-experience-with-ai-for-1-8-billion-people/)):
    "open-text questions and answers in fans' native languages through text and audio
    translation".
[^devtools]: [docs/RUBRIC_MAP.md](RUBRIC_MAP.md#development-tools): git history and all pull
    requests checked on 2026-10-20.
