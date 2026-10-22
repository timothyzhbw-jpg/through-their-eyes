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
player's own perception: the looks over his shoulder before the ball arrived, who was in sight,
and what he believed. It re-simulates the moment without the look that made the play, and
checks every number in its captions and narration before it airs.

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

## What it does

The brief's pipeline, end to end, on a synthetic match:

| Stage | What happens | Code |
|---|---|---|
| **Ingest** | Our physics-based simulator generates a match: 22 fictional players at 25 Hz, with body and head direction.[^spec31] The API streams it over WebSocket at real speed, as the events happen. | `sim/`, `api/` |
| **Interpret** | Analytics kernels read the tracking: time to intercept, pitch control, pressing, field of view, expected threat (xT), a scan detector that reads head direction only, and blind-side alerts. | `analytics/` |
| **Explain** | The system detects moments and gives each one the lens with the biggest counterfactual impact (perception, pressure or space). It re-simulates the moment with one change and turns the results into claims, which a deterministic Verifier checks. | `explain/` |
| **Render** | A first-person view through the player's eyes, a broadcast camera with a camera director, and a tactical board with pass options ("he thought / it was"). Overlays show his vision cone, where he believed the others were, pitch control (a GPU shader), blind-side alerts, and the counterfactual's ghost paths. | `web/` |
| **Personalize** | An agent crew on Microsoft Foundry writes the breakdown for five audiences (casual, analyst, player fan, coach, audio description) in English or Chinese. Azure AI Speech voices it with two commentators. Every audience gets the same verified facts. | `agents/`, `api/` |

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
   runner. Over 40 held-out seeds, 39 decide differently without the look.[^flip]
5. **Verified numbers.** Every number in the captions, the narration and the evidence cards is
   a claim computed from the match and checked by code before it airs. Viewers can open any
   caption's evidence, or try a wrong number and watch the Verifier refute it.[^verify] Other
   numbers on screen (the lineup card's scans, sprint tags, the score bug, the telemetry) are
   read straight from the simulation; they are not claims, and the Verifier does not check them.

**Three hero moments.**
- **Scan hero:** a midfielder's one look over his shoulder shows him the runner. Live in the app.
- **Pressure hero:** a centre-back under a high press. Re-simulated with him forced to keep the
  ball, he loses it in 40 of 40 fresh seeds.[^press] Live in the app.
- **Set-piece hero:** at a corner, a defender marks the striker where he *believes* the striker
  is. In 37 of 40 held-out seeds, the striker is unmarked at the cutback without the defender's
  look, and marked with it.[^marking] That headline uses a gate revised during design; the
  original plan's checks, reported in the same file, are not met. Live in the app, as the
  stitched match's third hero.

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
  the workflow's edges. The Telestrator and narration run in parallel.
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

## Evidence

| Claim | Result | Source |
|---|---|---|
| Without the key look, the scan hero decides differently | 33 of 40 held-out seeds | [^flip] |
| Lens selection picks the lens each hero is built for | scan hero 40/40; pressure hero 40/40 on fresh seeds | [^lens], [^press] |
| Forced to keep the ball, the pressure hero loses it; the possession outcome changes | 40/40 lost; 32/40 changed | [^press] |
| Set-piece hero: unmarked without the look, marked within 5 m with it | 37/40 (gate revised during design; the plan's checks, in the same report, are not met); median gap 8.5 m without vs 3.3 m with | [^marking] |
| Scans detected from head direction alone, with sensor noise, aborted turns and drift on (held-out F1) | 0.991 | [^detector] |
| Blind-side alerts against the players' simulated beliefs (fresh seeds) | precision 0.915, recall 0.943 | [^blind] |
| Perturbed claims refuted by the Verifier (a number off by one unit or by 20%, a swapped player, a wrong order) | 90 of 90 | [^corruption] |
| First-draft narration lines naming a player or number that no claim holds: free text vs anchored | 34 of 66 vs 0 of 111; groundedness of the aired scripts 4.90 vs 5.00 (Foundry evaluator) | [^ablation] |
| Simulator statistics against published values | 10 inside the published range, 6 outside, 10 with no published value | [^realism] |
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
- TODO(Bowen): add the video URL.

## Team

TODO(Bowen): team members and how each name should appear. Confirm that every member's
registration went through (SPEC §11, "registered by 2026-10-20 12:00 PT").
TODO(Bowen): on the Innovation Studio form, select the categories: Grand Prize and Best
Multi-Agent System (SPEC §0).

## Limitations

- **Synthetic data only.** Nothing has been run on real tracking data, which the rules don't
  allow anyway. The scan detector's and blind-side alerts' scores are scores on our simulator.
  The alerts share the simulator's model of what a player expects, so their score is an upper
  bound for real tracking.[^blind]
- **Causal only inside the simulator.** A counterfactual is a re-simulation, so every
  counterfactual outcome depends on our models of movement, perception and decisions. On real
  data we could only claim association.
- **Realism is partial.** Of the 16 simulator statistics we can check against a published
  value, 6 fall outside the published range. All six compare scan rates between roles or
  pressure levels. One has the opposite sign: published players scan less when an opponent is
  tight on them (d = +0.57), our simulated players slightly more (d = −0.12).[^realism]
- **No tackles yet.** The ball changes hands by interceptions and balls out of play only: 0
  tackles per 90 minutes over 20 stitched matches. Tackles are switched on in the pressure
  hero's scenario alone.[^matchstats]
- **xT is our own grid, not fitted to real football.** A gain such as "That look was worth … in
  expected threat" is a value inside the simulation.
- **The stitched match has one goal, from its shot hero:** open play has no shots
  (`possession_play` scripts its passes), so the scoreline is the heroes' doing.[^match]
- **Not yet measured:** no single-agent baseline (the narration ablation is the closest
  comparison), no viewer study, and no frame-rate run on a laptop's integrated GPU.
- **Tactics: two cards, not a knowledge base.** The analyst's stats panel and the recap answer
  "why build from the back?" and "why focus on set pieces?" from the match's own data, each with
  one verified sentence. The rest of a tactics table (high press, counter-attack, wide overloads,
  central penetration, low block, counter-press) needs tackles, crosses and open play that
  shoots; see the roadmap below.
- **A failure drill lives on one replica's disk.** A restart or redeploy drops it, and
  **Bring back** then answers 404.


## Roadmap: a tactics knowledge base

Teammates who play proposed a tactics knowledge base: each tactic, its mechanism, the data that
shows it and a sentence for a fan. We built the two rows our simulator truly supports.

- **Why build from the back?** Under pressure, Home completed 25 of 34 short passes out from the
  back in match-1 (74%, against 86% without). The pressure hero's recorded options show his
  safest pass was back to the keeper.
- **Why focus on set pieces?** The one corner reached 0.29 xT in 4.4 seconds, more than any of
  the 18 open-play passages. No shot followed: the stitched match cuts the corner before one
  could.

Every number is measured from tracking and events, and each card's sentence is verified before
it airs. The other six rows (high press, counter-attack, wide overloads, central penetration, low
block, counter-press) need events the simulator does not produce yet. [docs/TACTICS.md](TACTICS.md)
lists, for each, what it would need: tackles and duels everywhere, crosses and headers, and open
play that attacks the goal.

---

[^realism]: [eval/reports/realism.md](../eval/reports/realism.md): scans in the 10 s before
    receiving, sim 2.79 vs published 3.0 ± 2.1 (Jordet et al. 2020); peak head speed 404 ± 51°/s
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
[^spec31]: [docs/SPEC.md](SPEC.md) §3.1: 25 Hz frames, per-player body and head yaw.
[^flip]: [eval/reports/hero_flip_blind_side_run.md](../eval/reports/hero_flip_blind_side_run.md):
    seeds 100–139, decision changed without the key scan in 33/40.
[^verify]: [tests/test_api.py](../tests/test_api.py)
    `test_a_wrong_number_is_refuted_and_its_line_would_not_air` and
    `test_the_verified_number_is_supported_and_its_line_airs`.
[^press]: [eval/reports/hero_lens_press_escape.md](../eval/reports/hero_lens_press_escape.md):
    fresh seeds 200–239, pressure lens 40/40, ball lost after the forced carry 40/40, outcome
    changed 32/40.
[^lens]: [eval/reports/hero_lens_blind_side_run.md](../eval/reports/hero_lens_blind_side_run.md):
    seeds 100–139, scan lens selected 34/40.
[^marking]: [eval/reports/hero_marking_corner_blind_side.md](../eval/reports/hero_marking_corner_blind_side.md):
    seeds 100–139, 37/40; median separation 3.3 m with the look, 8.5 m without.
[^match]: [docs/SPEC.md](SPEC.md) §3.1; `uv run python -m sim.match --seed 1` prints 19
    possessions and "808.3 s, 1-0" on a Mac (2026-10-22 CT, with the referee and the team shape). Where open play goes out
    differs by platform (SPEC 3.7), so the live match's details can differ.
[^spec6]: [docs/SPEC.md](SPEC.md) §6, failure policy; `DEFAULT_TIMEOUT_S = 8.0` and `RETRIES = 1`
    in [agents/llm.py](../agents/llm.py).
[^trace]: [docs/RUBRIC_MAP.md](RUBRIC_MAP.md#the-live-trace): 2026-10-20 21:34:51 UTC, revision
    `tte-api--0000017`, 15467 ms in the `breakdown` span, 5093 ms `mcp`, 9898 ms `workflow.run`.
[^latency]: [docs/SPEC.md](SPEC.md) §8, "Deployed 2026-10-20": the same request from the
    cache took 0.15 s; "Live on Container Apps": 12.9 s uncached on a warm replica, 25.9 s for
    the first request after a new revision.
[^detector]: [eval/reports/scan_detector.md](../eval/reports/scan_detector.md): held-out F1 0.991
    with nuisance head motion on.
[^blind]: [eval/reports/blind_side.md](../eval/reports/blind_side.md): fresh held-out precision
    0.915, recall 0.943, and the upper-bound note.
[^corruption]: [eval/reports/corruption.md](../eval/reports/corruption.md): 90/90 false
    perturbations refuted; 468/468 generated claims supported.
[^parity]: [docs/RUBRIC_MAP.md](RUBRIC_MAP.md) §1;
    [web/src/pitchControl/pitchControl.gpu.test.ts](../web/src/pitchControl/pitchControl.gpu.test.ts),
    10 hero-moment snapshots in headless Chrome.
[^determinism]: [tests/test_sim_m1.py](../tests/test_sim_m1.py)
    `test_same_seed_twice_in_the_same_environment_is_byte_identical`.
[^tests]: CI run 39583678095 on main at 44c0bb5, 2026-10-21: pytest "1216 passed in 612.99s",
    vitest "Tests 595 passed", smoke "15 of 15 pages passed".
[^matchstats]: [eval/reports/match_stats.md](../eval/reports/match_stats.md): possession changes
    by tackle per 90 min 0 (n = 20 matches); "Tackles are on in press_escape only".
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
