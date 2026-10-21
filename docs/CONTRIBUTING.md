# Contributing

How to set the project up, what CI checks, and how a change gets merged and deployed. The
specification is [SPEC.md](SPEC.md); each package has a README with its modules, data flow,
invariants and tests.

| Package | What it is | README |
|---|---|---|
| `sim/` | synthetic match engine: movement, ball, perception, decisions, scenarios | [sim/README.md](../sim/README.md) |
| `analytics/` | numpy kernels: TTI, pitch control, pressing, vision, xT, scan detector, blind side | [analytics/README.md](../analytics/README.md) |
| `explain/` | moments, lenses, claims, the Verifier, verified rendering | [explain/README.md](../explain/README.md) |
| `agents/` | the Agent Framework crew, Foundry client, MCP server, what-ifs | [agents/README.md](../agents/README.md) |
| `api/` | FastAPI service: live stream, breakdowns, what-if, verify, TTS | [api/README.md](../api/README.md) |
| `web/` | Vite + React + three.js viewer | [web/README.md](../web/README.md) |
| `eval/` | eval suites and committed reports | [eval/README.md](../eval/README.md) |
| `infra/` | Azure provisioning, deploy, smoke test, cache pre-warm | [infra/README.md](../infra/README.md) |
| `video/` | capture kit for the demo video | [video/README.md](../video/README.md) |

## Setup

Python 3.11 through [uv](https://docs.astral.sh/uv/) (uv installs the interpreter), Node 24 for
`web/` and `video/`.

```bash
uv sync                          # main + dev dependencies (pytest, ruff)
uv sync --group eval             # only for eval/narration_ablation.py (azure-ai-evaluation)
cd web && npm ci                 # web app
cd video && npm ci && npx playwright install chromium   # only for recording the video
```

- **Everything runs offline by default.** Without `FOUNDRY_PROJECT_ENDPOINT` and `FOUNDRY_MODEL`
  every agent step uses its deterministic template; without Speech, `/api/tts` answers 503;
  without `TTE_COSMOS_ENDPOINT` the cache is JSON files under `out/cache`. No Azure account is
  needed to develop or to run the tests.
- **Environment.** Every variable is documented in [`.env.example`](../.env.example), and
  `tests/test_env_example.py` fails on an undocumented one. `.env` is git-ignored and holds no
  value that belongs in the repo. Set `APPLICATIONINSIGHTS_CONNECTION_STRING=` (empty) for local
  runs: anything that imports `api.main` otherwise sends spans to the production Application
  Insights.
- **GPU tests** (`npm test` in `web/`) need Chrome; set `TTE_CHROME=<path>` if it is not found.
- **Azure** is only needed to provision, deploy or call the model: [infra/README.md](../infra/README.md).

## The checks CI runs

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), on every pull request and on `main`:

| Job | Steps |
|---|---|
| `python` | `uv sync --locked`; `ruff check .`; `ruff format --check .`; `bash -n infra/*.sh`; `pytest -q` |
| `web` | `npm ci`; `npm run licenses`; `typecheck`; `format:check` (prettier, which also checks `web/README.md`); `npm test` (vitest, with the GPU parity test on SwiftShader); `build`; `node ../video/capture.mjs --list` |
| `smoke` | `npm run smoke`: the built app against a local offline API, every page in headless Chromium; any console error, uncaught exception or missing main view fails it |

The same locally:

```bash
uv sync --locked
uv run ruff check . && uv run ruff format --check .
bash -n infra/*.sh
uv run pytest -q
cd web && npm ci && npm run licenses && npm run typecheck && npm run format:check \
  && npm test && npm run build && node ../video/capture.mjs --list && npm run smoke
```

When you report a result, capture the real exit code (`cmd > log 2>&1; echo rc=$?`); a pipe
through `tail` reports the exit code of `tail`.

After CI passes on `main`, [`deploy.yml`](../.github/workflows/deploy.yml) rolls the API out to
Azure Container Apps and the web app to the Storage static website, with OIDC and no stored
secret.

## Eval before merge

CI runs the unit tests, not the evals: the reports in `eval/reports/` are generated locally and
committed. So a pull request that touches `sim/`, `analytics/` or `explain/` (or `agents/` code an
eval uses) runs them before it merges:

1. Run every offline eval, with `APPLICATIONINSIGHTS_CONNECTION_STRING=`:

   ```bash
   uv run python -m eval.hero_flip --seeds 100-139
   uv run python -m eval.hero_lens --scenario blind_side_run
   uv run python -m eval.hero_lens --scenario press_escape
   uv run python -m eval.hero_marking
   uv run python -m eval.hero_shot
   uv run python -m eval.blind_side
   uv run python -m eval.realism
   uv run python -m eval.scan_detector
   uv run python -m eval.keypoint_ingest
   uv run python -m eval.corruption
   uv run python -m eval.scan_calibration
   uv run python -m eval.pitch_control_parity
   ```

2. Regenerate the committed exports: the `sim.export` commands in
   [web/README.md](../web/README.md#data), then `uv run python -m demo.build --seed 3`.
3. `git status --porcelain`. Either nothing under `eval/reports/`, `web/public/data/`, `demo/` or
   `web/src/pitchControl/snapshots.json` changed, or every change is intended and the PR
   description says why, with the before and after numbers.

Byte identity holds on the platform that generated the files (macOS on Apple silicon); SPEC 3.7
promises no cross-platform identity, so CI checks the exports structurally. A change that moves a
report's numbers also updates every place that quotes them (README, SPEC, [EVALS.md](EVALS.md)).
Tuning happens on design or tuning seeds only; held-out seeds are run once the design is fixed
([eval/README.md](../eval/README.md#rules)).

## Pull requests

- **Small, imperative commits that name the SPEC section**, for example
  `analytics: add TTI kernel (SPEC 4.1)`. Branch from `main` and open the PR against it.
- **Acceptance checks first.** A new behaviour comes with its check (a test, or an eval target in
  the SPEC) written before the implementation. "Done" needs evidence in the PR: the test or eval
  output. An outcome is supported, a counterexample or inconclusive, and inconclusive is not done.
- **One merge desk.** Authors do not merge or deploy their own PRs. One desk does, for every PR:
  - it integrates the PR on a scratch branch from the latest `main`, together with every open PR
    it could touch, because a PR that is green on its own branch is not green on `main`;
  - it runs the checks above, and the evals for `sim/`, `analytics/` or `explain/`;
  - it merges, waits for the deploy workflow, then checks the live site: `/health`, the hero, the
    stitched match (`?match=match-1`) with a breakdown, the README's tour links, and a clean
    browser console.
- **Interfaces that broke before**, worth checking in review:
  - anything the stitched match draws reads `useView()`, not `useSession()` (web);
  - `validate_plan` returns `PlanError` objects (agents);
  - failure drills never write to Cosmos DB (api);
  - a new persona needs an entry in every per-persona table: each template sequence in
    `agents/fallbacks.py`, the prompts in `agents/prompts.py`, `Persona` in
    `agents/schemas.py`, and `PERSONAS` and the labels in `web/src/`;
  - the pre-match lineup card makes the page inert until dismissed, so scripts that drive the
    app add `intro=0` (or link to a spot).
- **Feature freeze is 2026-10-26** (SPEC §9); after it only fixes and docs.

## Rules that are not negotiable

These come from the hackathon's rules ([CLAUDE.md](../CLAUDE.md)):

- **Synthetic data only.** No real match data or footage, no real players, clubs, league or
  broadcaster names or logos, no copyrighted music, anywhere in the repo, the app or the video.
- **English** in code, comments, docs, commits and UI; only localized narration is not.
- **Licences.** Dependencies are MIT, BSD or Apache-2.0 (MPL only as an unmodified dependency);
  no GPL or AGPL. Never copy code from a repository without a licence: reimplement from the paper.
  Justify every new dependency in one line where it is declared (`pyproject.toml` comments, the
  table in [web/README.md](../web/README.md#dependencies)). `npm run licenses` checks the web
  tree in CI.
- **LLMs never write digits.** Numbers reach a viewer only through slots of verified claims
  ([explain/README.md](../explain/README.md#invariants)).
- **Randomness is keyed** per `(seed, purpose, frame, entity)`, never one shared stream, and the
  same seed gives byte-identical sim output ([sim/README.md](../sim/README.md#invariants)).
- **Secrets only from the environment**, each documented in `.env.example`.
- **SI units, radians inside, degrees only in the UI**; pitch 105 × 68 m, origin at the centre
  spot, 25 Hz.
