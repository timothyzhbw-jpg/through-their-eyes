# Through Their Eyes

[![ci](https://github.com/timothyzhbw-jpg/through-their-eyes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/timothyzhbw-jpg/through-their-eyes/actions/workflows/ci.yml?query=branch%3Amain)
[![deploy](https://github.com/timothyzhbw-jpg/through-their-eyes/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/timothyzhbw-jpg/through-their-eyes/actions/workflows/deploy.yml?query=branch%3Amain)
[![tests: Python, web and end to end in CI](https://img.shields.io/badge/tests-Python%20%C2%B7%20web%20%C2%B7%20end%20to%20end-2b7a3d)](.github/workflows/ci.yml)
[![data: synthetic only](https://img.shields.io/badge/data-synthetic%20only-555)](#synthetic-data-only)
[![license: MIT](https://img.shields.io/badge/license-MIT-555)](LICENSE)

> **See what they saw.** An AI studio that explains key football moments through the player's own
> perception — the scans before the ball arrived, what was visible, what he believed — and proves
> every on-screen number before it airs.

### [▶ Try the live app](https://ttesite1ff906.z14.web.core.windows.net) · free, no login, a synthetic match with fictional players

[![The live app in first person, through the eyes of H8, the midfielder, during his look over the shoulder. The KEY SCAN tag is lit; the runner H9, marked in gold by the goal on the right, is in his sight; the caption reads "What did he see? H8 checked his shoulder before the ball reached him." with a verified tick.](docs/hero-key-scan.jpg)](https://ttesite1ff906.z14.web.core.windows.net/?view=pov&at=key-scan&intro=0)

<sub>The live app through the eyes of H8, the midfielder, as he looks over his shoulder, away from
the ball. The runner H9 (the gold 9, by the goal on the right) is in his sight during this look
and at no other time before his pass. The caption is a verified claim (✓).</sub>

## Judge it in 3 minutes
1. **See what he saw.** [First person at the key scan](https://ttesite1ff906.z14.web.core.windows.net/?view=pov&at=key-scan&intro=0):
   press **Play**. Playback slows through the look (the KEY SCAN tag), and the runner H9 comes
   into view.
2. **Take the look away.** [Without the look](https://ttesite1ff906.z14.web.core.windows.net/?run=counterfactual&at=decision&view=tactical):
   the same moment re-simulated with that one scan removed. He no longer knows where H9 is, and
   plays it back to H4; **With the look** switches back to the pass to H9. Without the look, 39 of
   40 held-out seeds decide differently ([hero_flip](eval/reports/hero_flip_blind_side_run.md)).
3. **Hear the crew explain it, then try to fool the checker.** [Analyst · 中文](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=zh&intro=0):
   the match streams in, and once the moment is detected the agent crew's breakdown plays
   (Microsoft Foundry; **Sound on** for Azure AI Speech). Click a caption to open its claims and
   the evidence frame. Then [try a wrong number](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&tamper=cf_value)
   and press **Check**: the verifier refutes it, and the line would not air.

[The full tour](#the-full-tour) adds your own "What if…?", taking an agent down mid-breakdown,
and a whole stitched match.

## What only we do
First-person replays and vision cones already exist ([related work](#related-work)); they show
what a camera, or a cone, could see. We model what the player *knew*. Each simulated player
turns his head on a schedule calibrated to published scan rates (2.95 scans in the 10 s before
receiving, against 3.0 ± 2.1 in Jordet et al. 2020: [realism](eval/reports/realism.md)), sees
only what falls in his field of view, and decides on his *belief*: everyone where he last saw
them, carried forward. Other tools show the passing lanes that existed; we show the ones he knew
existed. And because the match is simulated, a moment can be played again with one look removed:
the run is the same up to that scan and differs only through what he no longer saw
([test](tests/test_export.py#L37)), so what he would have done without it is re-simulated, not
guessed. Under all of it runs the backbone a broadcast needs: a crew of agents writes the
breakdown for each audience and language, and code checks every number before it airs (90 of 90
false claims refuted: [corruption](eval/reports/corruption.md)).

## About
Entry for the Microsoft × Premier League "Inside the Game" Developer Hackathon.
Status: **deployed on Azure (M3)** — the sim, analytics, explain layer (moments, lenses, verified
claims), the agent crew and the web replay run end to end, live; see [docs/SPEC.md](docs/SPEC.md) §8–9.

**How this differs from FIFA AI Pro.** FIFA AI Pro, the assistant Lenovo built with FIFA for the
2026 World Cup teams, answers *what happened*, from statistics, before and after a match, and
labels its answers "validated". We answer *what he saw and what he believed*, while the synthetic
match streams live. Every number in the captions and narration is a verified claim that a viewer
can open and challenge with **Try a wrong number**, and every "What if…?" is re-simulated in the
sim, not estimated. Lenovo's figures for its Referee View, an AI-stabilised referee body camera,
show that fans want first person; it shows what a camera captured, we show what the player
perceived. Sources: [docs/REFERENCES.md](docs/REFERENCES.md#related-products-judges-may-know-fifa-ai-pro-and-referee-view-world-cup-2026).

<a name="for-judges-try-it-in-3-minutes"></a>

## The full tour
A simulated match with fictional players; no login. Each link opens the live site on Azure (the
players take a few seconds to load). URL parameters: [web/README.md](web/README.md#url-parameters).

1. **What he saw.** [First person at the key scan](https://ttesite1ff906.z14.web.core.windows.net/?view=pov&at=key-scan):
   H8, the midfielder, looks over his shoulder, away from the ball, just before he receives it
   (the KEY SCAN badge). That look is the only time before his pass that the runner H9 is in
   his sight. Press **Play**: playback slows through the look.
2. **With and without that look.** [Without the look, at his decision](https://ttesite1ff906.z14.web.core.windows.net/?run=counterfactual&at=decision&view=tactical):
   the same moment re-simulated with that one scan removed. His picture of H9 is now 12 m off,
   and his pass options point backwards; he plays it back to H4. Click **With the look**: one
   thick line to H9. Over 40 held-out seeds, 39 decide differently without the look
   ([hero_flip](eval/reports/hero_flip_blind_side_run.md)).
3. **A live breakdown, in Chinese, for the analyst.** [Analyst · 中文](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=zh&intro=0):
   the match streams from the API at 25 Hz; once the moment is detected, the agent crew's
   breakdown plays (Microsoft Foundry, cached after the first request). Click a caption to open
   its claims and the evidence frame; **Sound on** speaks it with Azure AI Speech.
4. **Your own "What if…?"** [A question, prefilled](https://ttesite1ff906.z14.web.core.windows.net/?ask=What+if+he+had+kept+the+ball+and+dribbled+forward%3F):
   press **Ask**. The API maps the question to one of his options, forces it, re-simulates the
   moment and answers with verified lines; the forced run plays as a gold ghost. Free questions
   are rate-limited per client.
5. **The verifier blocking a number.** [Try a wrong number](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&tamper=cf_value):
   the evidence card opens on "That look was worth … in expected threat." with a wrong value
   filled in. Press **Check**: the API runs the real verifier on that claim with your number,
   against the match data, and answers "Refuted — this line would not air" with its reason;
   **Check the true value** is supported. Any claim with a number can be tried this way; nothing
   you try is written to the audit log. Live breakdowns never hand it a wrong number, because the
   narration agents pick verified claim ids and never write a digit. Where a model writes free
   text, it blocks: 58 of 66 free-text first-draft lines failed the Verifier, for example "off by
   1.2 metres" where the claim holds 0.5
   ([narration ablation](eval/reports/narration_ablation.md#free-text-failures-verbatim)), and 90
   of 90 false perturbations were refuted ([corruption](eval/reports/corruption.md)). Every
   verdict behind what the service airs is in the [audit log](https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/matches/blind_side_run-3/audit?limit=5).
6. **Take an agent down, bring it back.** [Analyst · English](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=en&intro=0):
   in the **Producer · failure drill** desk under **Behind the replay**, press **Take down** on
   the Telestrator and run the crew. It fails as in an outage: the call and one retry raise, it
   airs its template plan, and the breakdown still plays. **Bring back** resumes the Agent
   Framework workflow from its checkpoint and re-runs the Telestrator and the step after it; its
   plan replaces the template. The trace id is the run's operation_Id in Application Insights.
   Each run counts against the rate limit; a drill lasts until the API's next restart or deploy.
7. **A whole match, both heroes, a camera director.** [The stitched match on the broadcast camera](https://ttesite1ff906.z14.web.core.windows.net/?match=match-1&camera=broadcast&at=751):
   18 possessions on one clock of about 11½ minutes, opened where the scan hero's possession
   starts. Press **Play**. The chip above the views is the camera director: it suggests a camera and says
   why, one tap switches, and **Auto director** cuts by itself. In **Moments**, the pressure hero
   has a **Breakdown** too: a centre-back under a high press, and the counterfactual forces him
   to keep the ball (**If he carried it**). He loses it in 40 of 40 fresh seeds
   ([pressure](eval/reports/hero_lens_press_escape.md)). **View options** → **Skeleton** on the
   broadcast camera or the board draws each player's torso and head direction, the way
   limb-tracking data is shown.

8. **The match recap, at full time.** [Match recap](https://ttesite1ff906.z14.web.core.windows.net/?match=match-1&play=recap):
   the crew recaps the whole stitched match, as it does when the live stream reaches full time.
   The Director picks the key moments by counterfactual impact, the Analyst reads the match
   stats through our MCP tools, the Telestrator cuts the reel, and every sentence and number on
   the card is verified. **Play the recap reel** plays the moments in order with the camera
   director, and **Overlay cues (JSON)** is the timed, machine-readable cue sheet a broadcast
   graphics engine would render.

Then the [evidence](#evidence) and [Microsoft technology](#microsoft-technologies-where-they-are-used)
tables below; [docs/RUBRIC_MAP.md](docs/RUBRIC_MAP.md) maps each judging criterion to files,
tests, reports and pull requests, and marks what is missing. A third hero, a corner where a
defender marks the striker where he believes him to be, is in the simulator and its eval, not
yet in the app.

## Try it
- **Web app:** https://ttesite1ff906.z14.web.core.windows.net — the hero moment in first person and
  on the tactical board, with and without the look, pass options, blind-side alerts, "What if…?".
- **API:** https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/health
  - live replay: `wss://…/ws/matches/blind_side_run-3/live` (25 Hz frames, events, moments);
  - a verified breakdown (cached after the first request):
    ```bash
    curl -X POST https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/breakdowns \
      -H 'content-type: application/json' \
      -d '{"match": "blind_side_run-3", "personas": ["analyst"], "languages": ["en"]}'
    ```
  - the end-of-match recap of the stitched match, and its overlay cue sheet
    (`GET /api/recaps/<key>/cues?persona=analyst&language=en`, with the `key` it answers):
    ```bash
    curl -X POST https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/recaps \
      -H 'content-type: application/json' \
      -d '{"match": "match-1", "personas": ["analyst"], "languages": ["en"]}'
    ```
  - a wrong number, checked by the verifier (not audited; no model call):
    ```bash
    curl -X POST https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/verify \
      -H 'content-type: application/json' \
      -d '{"match": "blind_side_run-3", "claim": "cf_value", "slot": "dxt", "value": 0.2}'
    ```
  No login. Model-backed regenerations are rate-limited per client and capped per day; past that
  the service serves the cache or the deterministic template.
- **Failure drill** (tour step 6) over the API; each call counts against the rate limit:
  ```bash
  curl -X POST https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/breakdowns \
    -H 'content-type: application/json' \
    -d '{"match": "blind_side_run-3", "personas": ["analyst"], "languages": ["en"], "fail": ["telestrator"]}'
  curl -X POST https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/breakdowns/<key>/bring-back \
    -H 'content-type: application/json' -d '{"step": "telestrator"}'
  ```

## Evidence
| Claim | Number | Report |
|---|---|---|
| Without one look, the hero decides differently | 39/40 seeds | [hero_flip](eval/reports/hero_flip_blind_side_run.md) |
| Lens selection picks the lens each hero scenario is built for (held-out seeds): scan hero (100–139); pressure hero (fresh 200–239) | 40/40; 38/40 | [scan](eval/reports/hero_lens_blind_side_run.md), [pressure](eval/reports/hero_lens_press_escape.md) |
| Forcing the pressure hero to keep the ball loses it; the possession outcome changes (target ≥ 60%), fresh seeds 200–239 | 40/40 lost; 32/40 changed | [pressure](eval/reports/hero_lens_press_escape.md) |
| … the same on seeds 100–139, before → after the decision model saw a presser's run-in (these seeds were used to find the cause) | 22/40 → 30/40 changed | [seeds 100–139](eval/reports/hero_lens_press_escape_100-139.md) |
| Set-piece hero (a corner; in the sim and its eval, not yet in the app): without the marker's look the runner is unmarked at the cutback, with it the marker is within 5 m (held-out seeds 100–139), against a gate revised during design (the plan's checks, in the same report, are not met) | 37/40 | [hero_marking](eval/reports/hero_marking_corner_blind_side.md) |
| Scans detected from head yaw alone, nuisance head motion on (held-out F1) | 0.993 | [scan_detector](eval/reports/scan_detector.md) |
| Blind-side alerts vs the sim's beliefs (fresh seeds) | precision ≥ 0.8, recall ≥ 0.7 met | [blind_side](eval/reports/blind_side.md) |
| False claims refuted by the verifier | 100% of perturbations | [corruption](eval/reports/corruption.md) |
| Sim statistics vs published values | table with citations | [realism](eval/reports/realism.md) |
| Free-text vs anchored narration, same moment and seeds: first-draft lines the verifier rejects; groundedness (1–5) | 88% vs 0%; 4.90 vs 5.00 | [narration_ablation](eval/reports/narration_ablation.md) |
| One live breakdown (4 scripts, every step from the model) | 6–12 s; cached 0.15 s | SPEC §8 |
| Audio description for blind and low-vision viewers: where he got the ball, which way he looked, whom he saw, each a verified claim; calm, slower SSML at any tier; in the web app sound on, large-print captions, narration and playback controls named and focusable | 6/6 template lines verified, 0 dropped (seed 3, en + zh) | [test_agents](tests/test_agents.py), [access.test](web/src/ui/access.test.tsx) |

## Related work
- **First-person replay is not new.** ReSpo.Vision builds 3D tracking from single-camera
  broadcast video, and its digital twin replays real moments from a player's first-person
  perspective, for example through a striker's eyes
  ([tech.eu, 2025-06-10](https://tech.eu/2025/06/10/respovision-raises-eur42m-to-redefine-the-sports-viewing-experience/);
  [respo.vision](https://respo.vision/)).
- **Vision from head orientation is not new either.** Bekkers (2026), *Wide Open Gazes*
  ([arXiv:2602.18519](https://arxiv.org/abs/2602.18519)), turns head and shoulder angles into
  probabilistic field-of-view and occlusion maps, on 32 games of ReSpo.Vision broadcast tracking
  from the 2024 Copa América (§2.2). Our field-of-view model follows it.
- **What we add** is the step after vision: what the player *believed* (each player where he was
  last seen, extrapolated), decisions taken on that belief, and the counterfactual: the moment
  re-simulated with one scan removed, so the replay can show what he would have done without
  that look. POV is how we show it, not the contribution. All of it runs on synthetic data; we
  have not tested it on real tracking.
- Other entries and papers we read: [docs/REFERENCES.md](docs/REFERENCES.md).

## Synthetic data only
Every match, club and player in this project is fictional and generated by our own simulator
(`sim/`). No real match data, footage, logos or player names are used in the app or the repo — not
even for calibration; model parameters come from published research
([docs/REFERENCES.md](docs/REFERENCES.md)).

## Layout
Each package's README covers what it does, its modules and data flow, the invariants it keeps
and how to run its tests.

| Path | What | Docs |
|---|---|---|
| `sim/` | synthetic match engine: movement, ball, perception, decisions, scenarios | [sim/README.md](sim/README.md) |
| `analytics/` | kernels: time-to-intercept, pitch control, pressing, vision, xT, scan detector, blind-side alerts | [analytics/README.md](analytics/README.md) |
| `explain/` | moments, lenses, counterfactuals, claims + verifier | [explain/README.md](explain/README.md) |
| `agents/` | Agent Framework workflow on Microsoft Foundry, MCP server | [agents/README.md](agents/README.md) |
| `api/` | FastAPI service | [api/README.md](api/README.md) |
| `web/` | React + three.js front end (React Three Fiber) | [web/README.md](web/README.md) |
| `eval/` | eval suites and reports | [eval/README.md](eval/README.md), [docs/EVALS.md](docs/EVALS.md) |
| `infra/` | Azure setup and deployment | [infra/README.md](infra/README.md) |
| `video/` | capture kit for the demo video | [video/README.md](video/README.md) |
| `tests/` | the Python test suite | [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md#the-checks-ci-runs) |
| `docs/` | specification, references, evals, rubric map, contributing | [docs/SPEC.md](docs/SPEC.md) |
| `demo/` | hero demo page, rigged-player converter | — |

## Development
Requires [uv](https://docs.astral.sh/uv/) (Python 3.11 is installed by uv). Setup with uv and
npm, the checks CI runs, the pull-request flow and the eval-before-merge rule for `sim/`,
`analytics/` and `explain/` are in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

```bash
uv sync
uv run pytest
uv run ruff check .
```

### API service
```bash
uv run uvicorn api.main:app --reload
```
Live replay over WebSocket at `/ws/matches/blind_side_run-3/live`, moments, cached breakdowns and
"What if…?" answers. `match-1` is a stitched match (`sim/match.py`, SPEC 3.1): 18 possessions,
about 11½ minutes on one clock — 15 open-play passages and three heroes: the scan hero at 0:30, the
pressure hero (`press_escape`) at 4:33 and the short corner (`corner_blind_side`) at 8:21 — with
moments detected in every possession; breakdowns and what-ifs take the hero moment's id. `match-2`
plays the same heroes on other seeds, in another order (17 possessions, about 11¾ minutes). Without Microsoft Foundry configured, every agent step runs on its
deterministic template.

The container image for Azure Container Apps (main dependencies only, runs as a non-root user):
```bash
docker build -t tte-api .
docker run --rm -p 8000:8000 tte-api   # GET http://localhost:8000/health
```

### Azure smoke test (M0)
Needs the Azure CLI (`az login`) and an Azure for Students (or personal pay-as-you-go)
subscription; the script refuses Microsoft-internal and Enterprise Agreement subscriptions.

```bash
AZURE_SUBSCRIPTION_ID=<subscription id> infra/m0_provision.sh
uv run --env-file .env python -m infra.smoke
```

`m0_provision.sh` creates a resource group with a Microsoft Foundry account, project and one model
deployment, plus an Azure AI Speech resource, then writes the settings to `.env` (git-ignored).
Every variable is documented in [.env.example](.env.example).

## Architecture
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.svg">
  <img src="docs/architecture.svg" alt="Architecture. The brief's pipeline Ingest, Interpret, Explain, Render, Personalize runs over sim/, analytics/, explain/, agents/ + api/ and web/. The agent crew is one Microsoft Agent Framework workflow: Director, then Analyst (with our MCP tool server), then Telestrator and narration in parallel, narration and the deterministic Verifier in a rewrite loop, and Voice joining both lanes. It runs on Microsoft Foundry, Azure AI Speech, Azure Container Apps, an Azure Storage static website, Azure Cosmos DB, Application Insights and GitHub Actions.">
</picture>

Model steps run on Microsoft Foundry and fall back to a deterministic template; the Verifier is
code. The Analyst calls our MCP tool server: in the deployed API as a subprocess for every
uncached model breakdown (`TTE_ANALYST_MCP`, on by default), and from the command line with
`agents.run --mcp`. The
diagram is generated by [docs/architecture.py](docs/architecture.py), and
[tests/test_architecture.py](tests/test_architecture.py) fails when it drifts from the code.

## Microsoft technologies, where they are used
| Technology | Where | Evidence |
|---|---|---|
| Microsoft Foundry (gpt-4.1-mini, structured outputs) | every agent step, [agents/llm.py](agents/llm.py) | `/health` reports `model: foundry`; spans `chat gpt-4.1-mini` in Application Insights |
| Microsoft Agent Framework | the crew as a workflow graph: Director → Analyst → (Telestrator ∥ narration ⇄ Verifier) → Voice, [agents/workflow.py](agents/workflow.py) | typed edges, fan-out/fan-in, rewrite loop; tests in [tests/test_agents.py](tests/test_agents.py) |
| MCP (our own server) | the Analyst's tools: moments, vision, pitch control, xT, counterfactual re-simulation, what-if, [agents/mcp_server.py](agents/mcp_server.py); a subprocess of the deployed API for every uncached model breakdown (`TTE_ANALYST_MCP`, on by default) | `/health` reports `analyst_mcp: true`; spans `execute_tool get_moment` → `tools/call get_moment` under `analyst` in Application Insights ([live trace](docs/RUBRIC_MAP.md#the-live-trace)); each breakdown's `analyst` step lists the tools it called |
| Azure AI Speech | narration audio (SSML, two voices), [api/tts.py](api/tts.py) | `POST /api/tts` with a voice cue key |
| Azure Container Apps | the API, [Dockerfile](Dockerfile) | live URL above |
| Azure Storage static website | the web app (Static Web Apps has no region the student subscription allows) | live URL above |
| Azure Cosmos DB (serverless) | breakdown cache and the claims audit log, [api/store.py](api/store.py), [explain/audit.py](explain/audit.py) | `GET /api/matches/blind_side_run-3/audit` |
| Microsoft Foundry evaluation (azure-ai-evaluation) | `GroundednessEvaluator` on our deployment scores free-text vs anchored narration against the claims, [eval/narration_ablation.py](eval/narration_ablation.py) | [the ablation report](eval/reports/narration_ablation.md) |
| Application Insights | OpenTelemetry spans per agent step, [agents/telemetry.py](agents/telemetry.py) | one trace per breakdown with each step's source (model or template) and timing |
| GitHub Actions | CI, and deploy on green main with OIDC (no stored Azure secret), [.github/workflows](.github/workflows) | workflow runs |

Built with Claude Code.

### Deploy
[infra/deploy.sh](infra/deploy.sh) creates the hosting resources (`provision`), rolls out the API
(`api`), uploads the web app (`web`) and sets the deploy workflow's variables (`github`). It only
accepts an explicitly named Azure for Students, pay-as-you-go or free-trial subscription.

## License
MIT — see [LICENSE](LICENSE).
