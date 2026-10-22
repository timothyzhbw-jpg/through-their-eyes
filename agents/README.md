# agents/ — the production crew (SPEC 6)

One Microsoft Agent Framework workflow turns a hero moment into a breakdown: a Director, an
Analyst with our MCP tools, a Telestrator, two narration voices, the Verifier and Voice. Model
steps run on Microsoft Foundry with structured outputs and fall back to deterministic
templates; the Verifier and Voice are code. Models choose among verified facts; they never state
one.

```
Director → Analyst (⇄ MCP tools) ┬→ Telestrator ─────────────────────────────────┐
                                 └→ Narration (Commentator + Co-commentator)      ├→ Voice → BreakdownResult
                                    → Verifier ⇄ Narration (rewrite, at most twice) ┘
```

Typed messages on the edges: `Job` → `Analyze` → `Briefing` → `Planned` (Telestrator) and
`Drafts` (Narration) → `Rewrite` or `Approved` (Verifier) → `BreakdownResult` (Voice, the
workflow's output). [`docs/architecture.svg`](../docs/architecture.svg) draws this graph, and
`tests/test_architecture.py` fails if the drawing and `build_workflow` disagree.

## Modules

| Module | What it holds |
|---|---|
| [`workflow.py`](workflow.py) | the executors, `build_workflow`, `run_crew` / `run_breakdown` / `breakdown`, the failure drill (`down=`, `AgentDown`, `AgentBack`, `bring_back`) and checkpoints |
| [`context.py`](context.py) | `MomentContext.load(scenario, seed)`: the run, the scenario's counterfactual (`cf1`), the explained cards and the **verified** claims, built once per breakdown |
| [`schemas.py`](schemas.py) | the typed handoffs; what a model may return (`DirectorChoice`, `analyst_model`, `PlanDraft`, `anchored_draft_model`); `TelestrationPlan` (mirrors `web/src/plan/schema.ts`); `BreakdownResult` with its `StepTrace`s |
| [`prompts.py`](prompts.py) | instructions per role and persona; `PROMPT_VERSION`, a hash of every instruction |
| [`fallbacks.py`](fallbacks.py) | a deterministic template for every model step, built from verified claims only |
| [`budget.py`](budget.py) | what the Director's priority buys: the Analyst's MCP tools (high only) and the replay slot the Telestrator's plan must fit |
| [`plan.py`](plan.py) | `validate_plan` (the rules of `web/src/plan/validate.ts`, as `PlanError` codes) and `template_plan` (a port of `web/src/plan/template.ts`) |
| [`llm.py`](llm.py) | `ask`: per-step timeout (8 s), one retry, then give up; `client_from_env` (Foundry, keyless) or `None`; `Outage` for a downed agent |
| [`tools.py`](tools.py), [`mcp_server.py`](mcp_server.py) | the Analyst's tools as plain functions, and our MCP server (stdio) that exposes exactly those: `get_moment`, `list_claims`, `get_vision`, `get_pitch_control`, `get_xt`, `get_pressing`, `run_counterfactual`, `list_options`, `what_if` |
| [`delivery.py`](delivery.py) | delivery tier from rules on the card (never a model), SSML per line, voice cue keys |
| [`whatif.py`](whatif.py) | "What if…?": map a question to one evaluated option (model or rule parser), force it, re-simulate, answer with verified counterfactual claims |
| [`telemetry.py`](telemetry.py) | one OpenTelemetry span per breakdown and one per step; ids and counts only, never prompt or narration text |
| [`crewtrace.py`](crewtrace.py) | the crew trace: `CrewTrace` (pydantic) and the `Recorder` the workflow fills as it runs: per step its times, typed input and output, shared state read and written, model and MCP tool calls, the Verifier's rejections and rewrites; the drill's events and checkpoints. `python -m agents.crewtrace` writes the web's fixture |
| [`testing.py`](testing.py) | `FakeChatClient` and `ToolCallingFakeChatClient`: scripted replies routed by the `ROLE:` line, for tests and offline demos |
| [`run.py`](run.py) | the command line |

## Data flow

- **In:** a `MomentContext` (from `explain/` and `sim/`), personas, languages, an optional chat
  client, `use_mcp`, and for a drill the agents to take `down`.
- **Out:** a `BreakdownResult`: the Director's request, the Analyst's findings, a validated
  `TelestrationPlan` (with its source and any plan errors), the delivery tier, per persona and
  language a `ScriptResult` (approved lines, the render payload of SPEC 5.3, dropped lines,
  rewrite rounds, voice cues with SSML), a trace of every step (source `llm`, `template` or
  `code`, attempts, timings) and the trace id. `api/` caches it; `web/` plays it.
- `run_crew` also returns the run's `CrewTrace` (`CrewRun.trace`): the timeline the web's
  "Crew trace" draws, stored by the API with the breakdown. A drill's bring-back continues it.
- With `use_mcp`, the Analyst starts `python -m agents.mcp_server` as a subprocess and calls the
  tools over stdio; the deployed API does this for every uncached model breakdown
  (`TTE_ANALYST_MCP`).

## Invariants

- **LLMs never write digits.** Claim ids are an enum of the supported claims in the Analyst's and
  the narrators' JSON schemas, connectives are an enum too, and each narration line is a claim id,
  a connective, or both: a model cannot add a sentence, a number or a player. Free-text fields
  (a reason, an angle) go through `no_numbers`. The spoken text of a claim is its verified
  template, and the Verifier still checks every line.
- **Claims are verified before any model sees them** (`MomentContext.load`). A model sees each
  claim as its template with slot names, not its filled values; the Director and the Analyst
  also see the lens deltas, to judge the story.
- **Every model step has a template**, so the crew runs end to end with no model. A step that
  times out or fails twice runs on its template and records why; an invalid plan is replaced by
  the template plan, with public reason codes, never a value the model wrote.
- **Rewrites are bounded**: a refuted line goes back to its voice at most twice, then is dropped.
- **A downed agent calls no model.** In a drill (`run_crew(down=...)`) its client raises
  `AgentDown` on every call, so the step takes the normal path: the call, one retry, its
  template. A step that fell back after an error leaves a workflow request pending, which
  `bring_back` answers from the latest checkpoint. The API keeps drills apart from normal
  breakdowns ([api/README.md](../api/README.md)).
- **Cache keys move with the code.** `PROMPT_VERSION` changes with any instruction, and
  `PIPELINE_VERSION` in `workflow.py` must be bumped when code that shapes a breakdown changes
  without a prompt change; both are part of the API's cache key. So is the rendered text's
  fingerprint (`explain.render.render_fingerprint`), which follows the claims' templates and the
  names by itself; bump `RENDER_VERSION` there for a change to slot formatting or to a what-if,
  look or steps template.
- **Telemetry carries no content**: spans hold ids, counts, sources and timings. Keep Agent
  Framework's `ENABLE_SENSITIVE_DATA` off.

## Run it

```bash
uv run python -m agents.run --seed 3 --offline               # templates only, no Azure
uv run --env-file .env python -m agents.run --seed 3 --mcp   # Foundry, Analyst over MCP
uv run python -m agents.mcp_server --seed 3                  # the MCP server alone (stdio)
uv run python -m agents.whatif --seed 3 --offline "What if he had played it back to the centre-back?"
```

Without `FOUNDRY_PROJECT_ENDPOINT` and `FOUNDRY_MODEL` every step runs on its template. Writes
`out/breakdown_<scenario>_seed<seed>.json`.

## Tests

```bash
uv run pytest tests/test_agents.py tests/test_agents_pressure.py tests/test_crew_recovery.py \
  tests/test_telemetry.py tests/test_whatif.py tests/test_architecture.py
```

No test calls a model: `agents/testing.py` scripts the replies, including timeouts, errors and
real MCP tool calls over stdio.

- [`test_agents.py`](../tests/test_agents.py): the workflow end to end, a model cannot add its own
  words or unknown claims, free text with a number is rejected, an invalid plan becomes the
  template, plan validation matches the web rules, the Analyst calls tools over MCP.
- [`test_crew_recovery.py`](../tests/test_crew_recovery.py): take down, bring back, resume after
  an interrupted run, and which steps run again.
- [`test_crew_trace.py`](../tests/test_crew_trace.py): the crew trace: every step with its typed
  input and output, shared state, model and MCP tool calls, the Verifier loop, and the drill's
  down, fallback, waiting, checkpoints and bring-back.
- [`test_telemetry.py`](../tests/test_telemetry.py): one trace per breakdown, a span per step, a
  timeout as a `template` span with its error class.
- [`test_whatif.py`](../tests/test_whatif.py): forcing the chosen action reproduces the run; an
  action that was not an option is refused.

## SPEC

[§6 agents](../docs/SPEC.md#6-agents-agents) (roles, two voices, delivery tiers, failure policy,
the failure drill, MCP tools, "What if…?", the narration ablation),
[§5.3 claims](../docs/SPEC.md#53-claims-and-verifier), [§8 Application Insights](../docs/SPEC.md#8-platform-and-deploy).
