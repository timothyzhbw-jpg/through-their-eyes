# api/ — the service (SPEC 2, 8)

A FastAPI app, deployed on Azure Container Apps, that is the Ingest stage and the backend of the
web app. It replays each synthetic match at wall-clock speed over a WebSocket, serves exports and
moments, runs the agent crew for breakdowns and "What if…?" answers (cached by content hash),
re-checks a viewer's wrong number with the real Verifier, and speaks voice cues with Azure AI
Speech. It is public with no login, so every expensive path is bounded.

## Endpoints

| Route | What it does |
|---|---|
| `GET /health` | status, version, `model` (`foundry` or offline), `speech`, `analyst_mcp` |
| `GET /api/matches`, `GET /api/matches/{id}` | the served matches (`TTE_MATCHES`); one match's players, frames, hero moments, possessions and score |
| `GET /api/matches/{id}/export`, `/moments` | the viewer's export (`sim.export`) and the explained moment cards |
| `GET /api/matches/{id}/tactics` | the tactics cards (build-up under pressure, set pieces) and one verified sentence per card in `en` and `zh` (`explain.tactics`, SPEC 4.8) |
| `GET /api/matches/{id}/audit` | the latest verdicts behind what the service aired |
| `WS /ws/matches/{id}/live` | the live stream: `hello`, then per frame a `frame` with its `event`s and the `moment`s whose window closes, then `end`; the client may `pause`, `resume`, `seek`, `speed` or `stop` |
| `POST /api/breakdowns` | a breakdown for a moment, personas and languages; `fail` runs the failure drill; every answer (and every recap's) carries `provenance`: `live`, `cached` with `ran_at`, or `template` with its reason |
| `POST /api/breakdowns/{key}/bring-back` | resume a drill from its checkpoint with one step back |
| `GET /api/breakdowns/{key}/trace`, `GET /api/recaps/{key}/trace` | the crew trace stored with a breakdown, drill or recap (`recorded: false` for one cached before traces were recorded) |
| `POST /api/whatif` | a question mapped to one option, re-simulated, answered with verified lines |
| `POST /api/verify` | one claim with one numeric slot changed, re-checked by the Verifier (no model, not audited) |
| `POST /api/tts` | WAV for a voice cue key the crew wrote (never SSML from the client) |

The full list of messages and limits is in the docstrings of [`main.py`](main.py) and
[`live.py`](live.py).

## Modules

| Module | What it holds |
|---|---|
| [`main.py`](main.py) | `create_app(settings, ...)`: the routes, the breakdown cache, rate limits and the daily model cap, the failure drill, checkpointed crew runs; `app` for uvicorn |
| [`live.py`](live.py) | `stream`: the live replay, its control messages and its bounds (`Slots` per client and in total, a session length) |
| [`store.py`](store.py) | `MatchStore` (each match simulated and explained once, in a worker thread), `ResultCache` (memory in front of JSON files) or `CosmosResultCache`, `DrillStore`, `RateLimiter`, `DailyCap`, `content_key` |
| [`tamper.py`](tamper.py) | the "Try a wrong number" check: a copy of the claim with the viewer's value, through the real Verifier |
| [`tts.py`](tts.py) | Azure AI Speech: voice cues recorded per breakdown, audio cached by key under `TTE_CACHE_DIR/tts/` |
| [`guard.py`](guard.py) | body cap (16 KiB, 413), security headers, a 500 with no traceback |
| [`recorded.py`](recorded.py) | `Recordings`: every drill and bring-back as it ran, replayed while a viewer is limited |
| [`egress.py`](egress.py) | `Egress`: bytes sent per client and per UTC day (every response body and live message); `EgressLimit`, the 429 once either is spent |
| [`settings.py`](settings.py) | `Settings.from_env()`: every `TTE_*` variable, with its default |

## Data flow

- **Start-up:** `Settings.from_env()` picks the matches (default `blind_side_run:3`, `match:1`,
  `press_escape:0`). With `TTE_WARM` on (the default from the environment) every match is
  loaded before the port opens: the sim runs, moments and lenses are explained, claims are
  verified (`agents.context.MomentContext`), and the export and live overlays are precomputed.
  Matches are regenerated from their seeds, never stored.
- **Live:** frames come from the precomputed export; live play never waits on a model.
- **Breakdowns:** the cache key is `content_key` of the moment card's `content_hash()`, the
  sorted personas and languages, `PROMPT_VERSION`, `PIPELINE_VERSION`, the model deployment,
  whether the Analyst had MCP tools, and the rendered text's fingerprint
  (`explain.render.render_fingerprint`: the claims' templates and the names in those languages),
  so a wording or name fix is never hidden behind a cached text. What-if answers and recaps carry
  the fingerprint too. A hit is served at once; a miss runs `agents.run_crew` (the
  Analyst with our MCP server as a subprocess when `TTE_ANALYST_MCP` is on), or the offline
  templates when no model is configured or the client is limited.
- **Degraded runs:** a model run in which a step fell back to its template (a Foundry error or
  timeout, or a Telestrator plan that aired as the template) is cached marked `degraded` with
  those steps, and every answer lists them. While the model is available it is run again, at most
  once per key per `TTE_DEGRADED_RETRY_S` (600 s), under the per-client limit and the daily cap;
  until then, and while the client is limited or the cap is reached, it is served as it is,
  labelled by its steps' sources. A retry that comes back more degraded does not replace it.
  Recaps follow the same rule. `infra.prewarm --refresh-degraded` re-runs every degraded view.
- **Stores:** JSON files under `TTE_CACHE_DIR` by default; Cosmos DB containers `cache` and
  `claims_audit` when `TTE_COSMOS_ENDPOINT` is set. Workflow checkpoints and drills stay on the
  replica's disk.

## Invariants

- **Live play never waits on an LLM.** The stream, moments and overlays are deterministic and
  computed ahead; breakdowns run on request and are cached.
- **Spend is bounded.** Model-backed regenerations are rate-limited per client (`TTE_RATE_LIMIT`,
  3 per 10 min) and capped per UTC day across clients (`TTE_DAILY_MODEL_CAP`, 40); past either
  the cache or the template is served, flagged `rate_limited` or `capped`. A template served
  while limited never stands in for the model's answer in the cache. A what-if question the
  model mapped is kept by its normalised text: asked again, it costs no model call and no unit.
  At most `TTE_CREW_CONCURRENCY` (2) crew runs with a model at once. On the judging window's
  UTC days (`TTE_JUDGING_WINDOW`, 2026-10-27 to 2026-11-10) the limits are 8 per 10 min and 100
  a day. Speech has its own limits and daily synthesis cap; per-client limits key on the last
  `X-Forwarded-For` hop.
- **Egress is bounded.** Every response body and live message counts against the client's
  bucket (`TTE_EGRESS_PER_CLIENT`, 500 MB per hour) and the day's total (`TTE_DAILY_EGRESS_GB`,
  10); past either, 429 (a new live stream: 4429). The live stream plays at most 8x. Costs and
  what to do when a quota runs out: [docs/OPERATIONS.md](../docs/OPERATIONS.md).
- **Drills never touch Cosmos DB or the shared cache.** A request with `fail` is a fresh run under
  its own key; its record and checkpoints live in one directory on the replica's disk, the 50
  most recent only, and a restart onto a new disk drops them (bring-back then answers 404). A
  drill can be brought back at most 5 times.
- **A limited drill is never a dead end.** Every drill and bring-back is recorded on the replica's
  disk (`recorded.py`, the 200 most recent). Limited, the recording of the same drill in the same
  state is replayed (`recorded.at`), else the crew runs without the model, flagged; 429 only
  past the offline drills' daily cap too.
- **Tamper checks are never audited.** The audit log records what the service decided to air,
  not what a viewer tried; `/api/verify` calls no model and is rate-limited.
- **Speech speaks only the crew's SSML**, by cue key; a client never sends SSML.
- **Every environment variable is documented** in [`.env.example`](../.env.example);
  `tests/test_env_example.py` fails on an undocumented one. Secrets come only from the
  environment.

## Run it

```bash
APPLICATIONINSIGHTS_CONNECTION_STRING= uv run uvicorn api.main:app --reload   # offline unless FOUNDRY_* is set
docker build -t tte-api . && docker run --rm -p 8000:8000 tte-api              # the deployed image
curl -s localhost:8000/health
```

`api.main` configures tracing at import: with `APPLICATIONINSIGHTS_CONNECTION_STRING` set (for
example from a `.env` copied from the deployment), local runs send spans to the production
Application Insights. Set it empty for local work, as above. The image holds only the main
dependencies and `agents`, `analytics`, `api`, `explain`, `sim`, and runs as a non-root user
([Dockerfile](../Dockerfile)).

## Tests

```bash
uv run pytest tests/test_api.py tests/test_api_match.py tests/test_api_drill.py \
  tests/test_api_hardening.py tests/test_api_degraded.py tests/test_cosmos_store.py \
  tests/test_dockerfile.py tests/test_env_example.py
```

- [`test_api.py`](../tests/test_api.py): the live stream and its limits, the cache, the rate
  limit and the daily cap, the MCP switch, what-ifs, the audit log, tamper checks (refuted and
  not audited), TTS (only the crew's cues, caps, concurrency), body caps, security headers.
- [`test_api_hardening.py`](../tests/test_api_hardening.py): the egress budget (exports, live
  streams, the daily total), the 8x speed cap, what-if mappings kept and not re-asked, crew run
  slots, bounded ids, no secret, URL, path or id in the public trace.
- [`test_api_degraded.py`](../tests/test_api_degraded.py): a run with a template step is cached
  as degraded, run again while the model is available (once per interval, never replaced by a
  worse one), served labelled while it is not; recaps alike; drills stay out of the cache.
- [`test_api_drill.py`](../tests/test_api_drill.py): a drill is a fresh run under its own key,
  counts against the limits, stays out of Cosmos DB, is brought back at most five times.
- [`test_cosmos_store.py`](../tests/test_cosmos_store.py): the Cosmos cache and audit sink, the
  file store as the fallback, tamper checks never reach Cosmos.
- [`test_api_match.py`](../tests/test_api_match.py): the stitched match over the API, warm start.
- `cd web && npm run smoke` starts this API offline and opens every page of the built app.

## SPEC

[§2 architecture and data flow](../docs/SPEC.md#2-architecture),
[§6 failure drill](../docs/SPEC.md#6-agents-agents),
[§7 "Try a wrong number"](../docs/SPEC.md#7-render-web),
[§8 platform, limits and deploy](../docs/SPEC.md#8-platform-and-deploy).
