# Through Their Eyes

> See what they saw. An AI studio that explains key football moments through the player's own
> perception — the scans before the ball arrived, what was visible, what he believed — and proves
> every on-screen number before it airs.

Entry for the Microsoft × Premier League "Inside the Game" Developer Hackathon.
Status: **deployed on Azure (M3)** — the sim, analytics, explain layer (moments, lenses, verified
claims), the agent crew and the web replay run end to end, live; see [docs/SPEC.md](docs/SPEC.md) §8–9.

## For judges: try it in 3 minutes
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
3. **A live breakdown, in Chinese, for the analyst.** [Analyst · 中文](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=zh):
   the match streams from the API at 25 Hz; once the moment is detected, the agent crew's
   breakdown plays (Microsoft Foundry, cached after the first request). Click a caption to open
   its claims and the evidence frame; **Sound on** speaks it with Azure AI Speech.
4. **Your own "What if…?"** [A question, prefilled](https://ttesite1ff906.z14.web.core.windows.net/?ask=What+if+he+had+kept+the+ball+and+dribbled+forward%3F):
   press **Ask**. The API maps the question to one of his options, forces it, re-simulates the
   moment and answers with verified lines; the forced run plays as a gold ghost. Free questions
   are rate-limited per client.
5. **The verifier blocking a number.** Live breakdowns give it little to block: the narration
   agents pick verified claim ids and never write a digit. Where a model writes free text, it
   blocks: 58 of 66 free-text first-draft lines failed the Verifier, for example "off by 1.2
   metres" where the claim holds 0.5 ([narration ablation](eval/reports/narration_ablation.md#free-text-failures-verbatim)),
   and 88 of 88 false perturbations were refuted ([corruption](eval/reports/corruption.md)).
   Every live verdict and the check it ran is in the [audit log](https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/matches/blind_side_run-3/audit?limit=5).
   Not in the app yet: a control to try a wrong number yourself.
6. **Take an agent down, bring it back.** [Analyst · English](https://ttesite1ff906.z14.web.core.windows.net/?persona=analyst&lang=en):
   in the Breakdown panel's **Producer** desk, press **Take down** on the Telestrator and run the
   crew. It fails as in an outage: the call and one retry raise, it airs its template plan, and
   the breakdown still plays. **Bring back** resumes the Agent Framework workflow from its
   checkpoint and re-runs only the Telestrator; its plan replaces the template. The trace id is
   the run's operation_Id in Application Insights. Each run counts against the rate limit.
7. **The evidence.** The [evidence](#evidence) and [Microsoft technology](#microsoft-technologies-where-they-are-used)
   tables below; [docs/RUBRIC_MAP.md](docs/RUBRIC_MAP.md) maps each judging criterion to files,
   tests, reports and pull requests, and marks what is missing.

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
| Scans detected from head yaw alone, nuisance head motion on (held-out F1) | 0.993 | [scan_detector](eval/reports/scan_detector.md) |
| Blind-side alerts vs the sim's beliefs (fresh seeds) | precision ≥ 0.8, recall ≥ 0.7 met | [blind_side](eval/reports/blind_side.md) |
| False claims refuted by the verifier | 100% of perturbations | [corruption](eval/reports/corruption.md) |
| Sim statistics vs published values | table with citations | [realism](eval/reports/realism.md) |
| Free-text vs anchored narration, same moment and seeds: first-draft lines the verifier rejects; groundedness (1–5) | 88% vs 0%; 4.90 vs 5.00 | [narration_ablation](eval/reports/narration_ablation.md) |
| One live breakdown (4 scripts, every step from the model) | 6–12 s; cached 0.15 s | SPEC §8 |

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

The one exception is in the demo video only: a labelled segment of under 10 s that draws our
ground graphics on real amateur futsal footage, to show that the overlays carry over to a real
camera. Everything off the pitch, every face and the kit logos are blurred. The footage is never
committed and the app never loads it. Source: savinkins, "Битва корпораций 2019-20. Атлант – Нова
Пошта. Мини-футбол. Финал. 06.10.2019", Wikimedia Commons, CC BY 3.0; modified (graphics
overlaid, background blurred). Method and limits: [demo/realfeed/README.md](demo/realfeed/README.md).

## Layout
```
sim/        synthetic match engine
analytics/  kernels: time-to-intercept, pitch control, pressing, vision, xT, scan detector
explain/    moments, lenses, counterfactuals, claims + verifier
agents/     Agent Framework workflow on Microsoft Foundry, MCP server
api/        FastAPI service
web/        React + three.js front end (React Three Fiber)
eval/       eval suites and reports
infra/      Azure setup and deployment
docs/       specification and references
demo/       hero demo page; demo/realfeed: the real-footage overlay segment (video only)
```

## Development
Requires [uv](https://docs.astral.sh/uv/) (Python 3.11 is installed by uv).

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
"What if…?" answers. Without Microsoft Foundry configured, every agent step runs on its
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

## Microsoft technologies, where they are used
| Technology | Where | Evidence |
|---|---|---|
| Microsoft Foundry (gpt-4.1-mini, structured outputs) | every agent step, [agents/llm.py](agents/llm.py) | `/health` reports `model: foundry`; spans `chat gpt-4.1-mini` in Application Insights |
| Microsoft Agent Framework | the crew as a workflow graph: Director → Analyst → (Telestrator ∥ narration ⇄ Verifier) → Voice, [agents/workflow.py](agents/workflow.py) | typed edges, fan-out/fan-in, rewrite loop; tests in [tests/test_agents.py](tests/test_agents.py) |
| MCP (our own server) | the Analyst's tools: moments, vision, pitch control, xT, counterfactual re-simulation, what-if, [agents/mcp_server.py](agents/mcp_server.py); used by `python -m agents.run --mcp`, not yet by the deployed API | tests: `test_the_analyst_gets_the_mcp_tools_over_stdio`, `test_mcp_server_exposes_the_analyst_tools` in [tests/test_agents.py](tests/test_agents.py) |
| Azure AI Speech | narration audio (SSML, two voices), [api/tts.py](api/tts.py) | `POST /api/tts` |
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
