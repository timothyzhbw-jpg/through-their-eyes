# Rubric map

Each judging criterion (20% each, [SPEC §0](SPEC.md#0-pitch-and-judging-alignment)) and each
point of the Best Multi-Agent System category, with the evidence for it: files, tests, eval
reports, pull requests, and a live trace. **Missing** marks what is not there; **Partial** marks
evidence that covers less than the claim.

State on 2026-10-20: `main` at `6136323` plus the judges' deep links (this file's PR).
`uv run pytest`: 464 passed. `npm test` in `web/`: 137 passed. Live site:
https://ttesite1ff906.z14.web.core.windows.net. Pull requests are in
`timothyzhbw-jpg/through-their-eyes`; work committed straight to `main` is cited by commit.

## 1. Technological implementation

| Claim | Evidence | Status |
|---|---|---|
| Physics-based synthetic tracking at 25 Hz, with head and body yaw | [sim/engine.py](../sim/engine.py), [sim/movement.py](../sim/movement.py), [sim/ball.py](../sim/ball.py); [tests/test_sim_m1.py](../tests/test_sim_m1.py) `test_players_respect_role_speed_and_acceleration_limits`, `test_ball_energy_never_increases_between_contacts`; commit `96abf36` | ✅ |
| Perception calibrated to published values | [sim/perception.py](../sim/perception.py); [scan_calibration](../eval/reports/scan_calibration.md) fits head speed, scan dwell, pressure and role scan rates to Kokubu et al. 2026, Aksum et al. 2021 and Jordet et al. 2020; PRs #20, #23, #29 | ✅ |
| Sim statistics checked against the papers | [realism](../eval/reports/realism.md): 10 inside the published range, 6 outside (all six are effect sizes between roles or pressure bins), 10 with no published reference; PR #14 | Partial: 6 outside |
| Determinism and counterfactual re-simulation | keyed randomness [sim/rng.py](../sim/rng.py); [tests/test_sim_m1.py](../tests/test_sim_m1.py) `test_same_seed_twice_in_the_same_environment_is_byte_identical`, `test_an_override_on_one_player_leaves_every_draw_of_other_players_unchanged`; [tests/test_whatif.py](../tests/test_whatif.py) `test_forcing_the_action_actually_chosen_reproduces_the_factual_run`; [hero_flip](../eval/reports/hero_flip_blind_side_run.md): 39/40 held-out seeds decide differently without the key scan | ✅ |
| Analytics kernels | [analytics/](../analytics/): time to intercept, pitch control, pressing (PRs #1, #4), vision after Bekkers 2026, scan detector (held-out F1 0.993, [scan_detector](../eval/reports/scan_detector.md), PR #3), blind-side alerts (fresh held-out precision 0.920, recall 0.984, [blind_side](../eval/reports/blind_side.md), PRs #10, #13), xT (our own) | Partial: the fitted xT grid's sanity plot is open (SPEC §4) |
| numpy ↔ GLSL parity-tested kernels (SPEC §0) | Pitch control: the tactical board's per-pixel shader ([web/src/pitchControl/](../web/src/pitchControl/)) against [analytics/pitch_control.py](../analytics/pitch_control.py) in headless Chrome on CI, max abs diff about 5e-5 on 10 hero-moment snapshots (SPEC §4 asks < 0.02), [pitchControl.gpu.test.ts](../web/src/pitchControl/pitchControl.gpu.test.ts). The vision cone is a fragment shader of the sim's field-of-view model ([web/src/views/TacticalView.tsx](../web/src/views/TacticalView.tsx)), without occlusion | Partial: the vision cone has no parity test |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml): ruff, pytest, shell syntax; web licences, typecheck, prettier, vitest, build. [deploy.yml](../.github/workflows/deploy.yml) redeploys on green `main` with OIDC, no stored Azure secret | Partial: the eval reports are generated locally and committed, not rerun in CI |
| Microsoft stack, each piece used | README [table](../README.md#microsoft-technologies-where-they-are-used): Foundry, Agent Framework, MCP, Azure AI Speech, Container Apps, Storage static website, Cosmos DB, Foundry evaluation, Application Insights, GitHub Actions | Partial: our MCP server is used by `python -m agents.run --mcp` and in tests, not by the deployed API |

## 2. Agentic design and innovation

| Claim | Evidence | Status |
|---|---|---|
| A production crew as an Agent Framework workflow | [agents/workflow.py](../agents/workflow.py): Director → Analyst → (Telestrator ∥ narration) → Verifier ⇄ narration → Voice, built with `WorkflowBuilder` (fan-out, fan-in, rewrite loop); commit `2fa870a`, parallel lanes PR #11 | ✅ |
| Models choose, code states the facts | [agents/schemas.py](../agents/schemas.py): the Analyst and the narrators answer with structured outputs whose claim ids are an enum of verified claims, so a model cannot add a number; [tests/test_agents.py](../tests/test_agents.py) `test_a_model_cannot_add_its_own_words_or_unknown_claims`, `test_model_free_text_with_a_number_is_rejected` | ✅ |
| Deterministic verification of every claim | [explain/verifier.py](../explain/verifier.py), [explain/claims.py](../explain/claims.py) (PR #6); [corruption](../eval/reports/corruption.md): 88/88 false perturbations refuted, 0 unsupported claims rendered | ✅ |
| Anchoring beats free text | [narration_ablation](../eval/reports/narration_ablation.md) (PR #25): 58 of 66 (88%) free-text first-draft lines fail the Verifier, 47 with made-up ids or numbers; anchored 0 of 111; groundedness 4.90 vs 5.00 (Foundry `GroundednessEvaluator`) | ✅ |
| Moments chosen by counterfactual impact, perception first | [explain/moments.py](../explain/moments.py), [explain/lenses.py](../explain/lenses.py) (PR #1); the hero lens is perception | ✅ |
| Tools over MCP | [agents/mcp_server.py](../agents/mcp_server.py); [tests/test_agents.py](../tests/test_agents.py) `test_the_analyst_gets_the_mcp_tools_over_stdio`, `test_mcp_server_exposes_the_analyst_tools` | Partial: CLI only; the live trace below has no tool spans |

## 3. Real-world impact

| Claim | Evidence | Status |
|---|---|---|
| Perception analytics from tracking alone | the scan detector and blind-side alerts read only head yaw and positions, the inputs pose tracking provides ([analytics/scan_detector.py](../analytics/scan_detector.py), [analytics/blind_side.py](../analytics/blind_side.py)); ReSpo.Vision's broadcast tracking carries head, shoulder and hip angles (Bekkers 2026, [REFERENCES](REFERENCES.md#perception-and-scanning)) | **Missing:** never run on real tracking (synthetic data only, by the rules) |
| Machine-readable, timecoded overlay cues | `TelestrationPlan`: [agents/schemas.py](../agents/schemas.py), [web/src/plan/schema.ts](../web/src/plan/schema.ts); validated on both sides, [tests/test_agents.py](../tests/test_agents.py) `test_plan_validation_matches_the_web_rules`; invalid plans fall back to the template (`?offline=1&plan=invalid`) | ✅ |
| An audit log of every verified claim | [explain/audit.py](../explain/audit.py), Cosmos DB `claims_audit` (PR #21); live: [`/api/matches/blind_side_run-3/audit`](https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io/api/matches/blind_side_run-3/audit?limit=5); corruption eval: 468/468 verdicts logged | ✅ |
| Overlays on a real camera | [demo/realfeed/](../demo/realfeed/) (PR #15): ground graphics on CC BY futsal footage, video only, calibration committed, no frames | Partial: per-frame checks and Bowen's frame review are open (SPEC §7) |
| Runs within a student budget and survives quota loss | cache by content hash, per-client rate limit, daily model cap (PR #19), Cosmos cache (PR #21); [tests/test_api.py](../tests/test_api.py) `test_past_the_daily_cap_breakdowns_serve_the_cache_or_the_template`; ≈ $15 expected to 2026-11-10 (SPEC §8) | ✅ |
| Viewers understand the play better | — | **Missing:** the optional viewer pilot (SPEC §9) has not run |

## 4. UX and presentation

| Claim | Evidence | Status |
|---|---|---|
| First-person replay and a tactical board | [web/](../web/) (PR #5), head and body yaw on every player (PR #7), animated players (PRs #26, #27), comfort mode | ✅ |
| Overlays | pass options with "he thought / it was" (PR #8), blind-side alerts (PR #12), What if… ghost paths (PR #9), pitch control on the tactical board (toggle, off by default) | ✅ |
| Live, with persona and language switching | live WebSocket replay, breakdowns per persona (casual, analyst, player fan, coach) × language (en, zh), Azure AI Speech (PR #24); the first request per persona and language runs the crew (6–12 s), later ones come from the cache | ✅ |
| Every caption opens its evidence | [web/src/ui/Narration.tsx](../web/src/ui/Narration.tsx): claims with kind, verdict, values and evidence events; seeks the replay | ✅ |
| Three-minute tour with deep links | README ["For judges"](../README.md#for-judges-try-it-in-3-minutes), [web/src/deeplink.ts](../web/src/deeplink.ts), [web/README.md](../web/README.md#url-parameters) | ✅ after this PR deploys |
| Broadcast camera | — | **Missing** on `main` (in progress) |
| A control to try a wrong number against the verifier | — | **Missing:** shown only in the eval reports and the audit log |
| 60 fps on an integrated GPU with the pitch-control shader on | `cd web && npm run build && npm run fps -- --headed` measures it; so far run on SwiftShader only (no GPU), see SPEC §7 | **Missing:** no laptop GPU measured yet |
| The 2-minute video | storyboard in [SPEC §10](SPEC.md#10-demo-video-storyboard--200) | **Missing:** not made yet |

## 5. Category adherence: Best Multi-Agent System

| Point | Evidence | Status |
|---|---|---|
| Distinct roles | Director (whether and why to explain the moment), Analyst (lens and headline claims), Telestrator (the `TelestrationPlan`), narration (two voices, play-by-play and colour, per persona and language), Verifier and Voice. Prompts: [agents/prompts.py](../agents/prompts.py) | ✅; Verifier and Voice are deterministic code by design, not models |
| Shared state | `MomentContext` ([agents/context.py](../agents/context.py)): the run, the counterfactual, moment cards, claims, verdicts and the audit sink, read by every step; `Crew` ([agents/workflow.py](../agents/workflow.py)) holds the step trace and spans | ✅ |
| Handoffs | typed messages on the workflow's edges (`Briefing`, `Planned`, `Drafts`, `Rewrite`, `Approved` in [agents/workflow.py](../agents/workflow.py)); [tests/test_agents.py](../tests/test_agents.py) `test_telestrator_and_narration_run_concurrently`; [tests/test_telemetry.py](../tests/test_telemetry.py) `test_the_parallel_lanes_overlap_and_stay_children_of_the_breakdown` | ✅ |
| Failure recovery | [tests/test_agents.py](../tests/test_agents.py) `test_a_failing_or_slow_agent_falls_back_to_its_template`, `test_an_invalid_agent_plan_is_replaced_by_the_template`, `test_a_line_the_verifier_rejects_is_rewritten_or_dropped`; [tests/test_telemetry.py](../tests/test_telemetry.py) `test_a_telestrator_timeout_is_a_template_span_with_the_error_class`; the API serves the cache or the template when rate-limited or capped; the web app plays bundled data when the API is down ([web/src/api/client.test.tsx](../web/src/api/client.test.tsx)) | Partial: no visible fault-injection demo on `main` yet, and no transaction-view screenshot in the repo (SPEC §8 asks for one) |
| End-to-end output a single agent can't produce as well | one `BreakdownResult` = a validated plan + verified scripts per persona and language + timed SSML cues, played by the web app | Partial: no single-agent baseline was measured; the closest is the narration ablation above (one model writing free text vs the crew's anchored lines) |

### The live trace

One model-backed breakdown (analyst, zh) on the deployed API, from Application Insights,
2026-10-20 18:20:46 UTC, 7.7 s inside the `breakdown` span. Spans with their attributes
(`tte.source`: `llm` = the model answered, `code` = deterministic step); HTTP and framework
plumbing spans trimmed.

```
POST /api/breakdowns                                   8139 ms
├─ ContainerProxy.read_item (Cosmos cache miss)         331 ms
├─ breakdown  personas=analyst languages=zh model=gpt-4.1-mini rewrites=0 dropped=0   7693 ms
│  ├─ workflow.run                                     7689 ms
│  │  ├─ executor.process director                     3020 ms
│  │  ├─ executor.process analyst                      1576 ms
│  │  ├─ executor.process telestrator                  3084 ms   ┐ fan-out, concurrent
│  │  ├─ executor.process narration                    2742 ms   ┘
│  │  ├─ executor.process verifier                        4 ms
│  │  └─ executor.process voice                           1 ms
│  ├─ director     source=llm attempts=1               3020 ms → invoke_agent → chat gpt-4.1-mini
│  ├─ analyst      source=llm attempts=1               1575 ms → invoke_agent → chat gpt-4.1-mini
│  ├─ telestrator  source=llm attempts=1               3084 ms → invoke_agent → chat gpt-4.1-mini
│  ├─ narration    speaker=pbp   source=llm lines=4    1498 ms → invoke_agent → chat gpt-4.1-mini
│  ├─ narration    speaker=color source=llm lines=4    1234 ms → invoke_agent → chat gpt-4.1-mini
│  ├─ verifier     round=0 source=code failed=0           3 ms
│  └─ voice        source=code lines=8                    0 ms
└─ ContainerProxy.upsert_item (Cosmos cache write)      111 ms
```

Query (Application Insights `tte-appi-1ff906`, Logs):

```kusto
let op = toscalar(union dependencies, requests
    | where name == 'breakdown' | top 1 by timestamp desc | project operation_Id);
union dependencies, requests
| where operation_Id == op
| project timestamp, name, id, operation_ParentId, duration, customDimensions
| order by timestamp asc
```

## Development tools

Built with Claude Code. GitHub Copilot, the Azure MCP Server and Microsoft Fabric were not used:
no commit, file or pull request mentions them (git history and all 30 pull requests checked on
2026-10-20), so no Copilot usage file is included.
