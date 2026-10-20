# CLAUDE.md — Through Their Eyes

## What this is
Entry for the **Microsoft × Premier League "Inside the Game" Developer Hackathon**.
Submission deadline **2026-10-27 23:59 PT** (2026-10-28 01:59 CT). Judging runs until 2026-11-10.

An AI match-intelligence studio over **synthetic** football matches. Signature feature: explain key
moments *through the player's eyes* — the scans before the ball arrived, what was visible, what he
believed, and how that drove the decision — as a first-person replay plus tactical overlays,
narrated per fan persona and language, with every on-screen number machine-verified before it airs.

Pipeline required by the brief: **Ingest → Interpret → Explain → Render → Personalize**.
- Full spec and acceptance checks: `docs/SPEC.md`
- Papers, repos, license decisions: `docs/REFERENCES.md`

## Hard constraints (hackathon rules — never violate)
1. **New project only.** Don't copy code from any pre-existing repo of the user. Third-party libraries are fine.
2. **Synthetic data only.** No real match data or footage in the app, repo, or demo. Fictional clubs
   and players. No Premier League or club logos, real player names, broadcaster branding, or
   copyrighted music — in code, assets, or video.
3. **English** for everything in the repo (code, comments, docs, commits, UI). Only localized
   narration may be non-English.
4. **Microsoft stack, meaningfully used:** Microsoft Foundry (models), Microsoft Agent Framework
   (multi-agent), MCP (our tool server), Azure AI Speech (TTS), Azure Container Apps + Static Web
   Apps (hosting), Azure Cosmos DB (store), Application Insights (traces), GitHub Actions (CI).
   Don't add Azure services just to tick boxes.
5. **Licenses:** dependencies must be MIT / BSD / Apache-2.0. No GPL/AGPL (e.g. PitchAura,
   Ultralytics YOLO). MPL only as an unmodified dependency. Never copy code from repos without a
   license (e.g. LaurieOnTracking) — reimplement from the papers.
6. **Demo stays publicly testable** (free; no login, or credentials provided) until 2026-11-10.

## Working with the user
- The user is Bowen. **Talk to him in Chinese**; be direct, conclusion first, technically deep.
  Repo artifacts stay in English.
- Fluent in Python and C++; the frontend is TypeScript — explain frontend choices briefly.
- Prefer mature, low-learning-cost tools. Justify every new dependency in one line.
- Time is the binding constraint. If scope threatens the deadline, propose a cut from the cut order
  in `docs/SPEC.md` §9 — never silently ship less or fake a result.
- When the spec is silent or ambiguous, ask before deciding anything expensive to reverse.

## Definition of done
- Acceptance checks come from `docs/SPEC.md` and are written **before** the implementation
  (tests or scripted checks).
- "Done" needs evidence: paste the test/eval output. Outcomes are supported / counterexample /
  inconclusive — inconclusive is **not** done.
- Same seed ⇒ byte-identical sim output; keep that test green.

## Target layout
```
sim/        synthetic match engine (numpy): movement, ball physics, perception, decisions, scenarios
analytics/  kernels: time-to-intercept, pitch control, pressing, vision, xT, pass metrics, scan detector
explain/    moment detection, lens selection, counterfactual re-sim, claims + verifier
agents/     Agent Framework workflow, persona prompts, Foundry client, MCP server
api/        FastAPI: match stream (WebSocket), moments, breakdowns, TTS
web/        Vite + React + TypeScript + three.js (React Three Fiber), GLSL shaders
eval/       eval suites and reports
infra/      deployment (azd/Bicep or scripts)
docs/       SPEC.md, REFERENCES.md, architecture diagram
```

## Conventions
- Python **3.11** (keeps the optional unravelsports usable; Agent Framework needs ≥ 3.10), managed
  with `uv`; ruff + pytest; type hints; pydantic for schemas that cross process boundaries.
- Randomness is keyed per `(match_seed, entity_id, purpose)` — never one shared sequential stream
  (SPEC §3.7), so counterfactuals differ only through the intervention.
  Decisions are sampled with Gumbel-max over keyed per-option noise (SPEC §3.5).
- SI units. Pitch 105 × 68 m, origin at the centre spot. 25 Hz frames. Angles in radians
  internally, degrees only in the UI.
- Every analytics kernel has a numpy reference + unit tests; GLSL versions must match the
  reference within tolerance (parity tests on fixed snapshots).
- LLM calls return schema-validated JSON. **LLMs never write digits** — numbers are slot-filled
  from verified values.
- Secrets only via environment variables; document every variable in `.env.example`.
- Commits: small, imperative mood, reference the SPEC section
  (e.g. `analytics: add TTI kernel (SPEC 4.1)`).

## Commands
_Fill in as they come to exist._
- `uv sync` — install Python deps (dev group included)
- `uv run pytest` — tests
- `uv run ruff check . && uv run ruff format --check .` — lint (same as CI)
- `AZURE_SUBSCRIPTION_ID=<id> infra/m0_provision.sh` — create the M0 Azure resources (needs
  `az login`; refuses non-personal subscriptions); writes `.env`
- `uv run --env-file .env python -m infra.smoke` — M0 smoke test: Foundry model via Agent
  Framework (structured output) + Azure Speech TTS (`en`, `zh`)
- `uv run python -m eval.hero_flip --seeds 100-139` — hero-moment eval (SPEC 3.6): does dropping
  the key scan change the decision? Writes `eval/reports/hero_flip_<scenario>.md`
- `uv run python -m agents.run --seed 3 --offline` — the agent crew on the hero moment (SPEC 6);
  without `--offline` it uses Microsoft Foundry when `FOUNDRY_*` is set; `--mcp` gives the
  Analyst our MCP tool server. Writes `out/breakdown_<scenario>_seed<seed>.json`
- `uv run python -m agents.mcp_server --seed 3` — the MCP tool server (stdio)
- `uv run python -m agents.whatif --seed 3 "What if he passed to H4?"` — answer a what-if
  question by re-simulating with `force_action` (SPEC 3.7, 6)
- `uv run uvicorn api.main:app --reload` — the API service (SPEC 2): `/ws/matches/<id>/live`,
  `/api/matches/<id>/moments`, `POST /api/breakdowns` (cached), `POST /api/whatif`, `POST /api/tts`
- Not yet: `uv run python -m eval.run_all`

## Decisions already made (don't relitigate without a reason)
- The hero lens is **perception** (scans / vision / belief). `space` (pitch control, xT) and
  `pressure` lenses also exist; each moment uses the lens with the largest counterfactual impact.
- Players are stylised tokens (no limb animation). Cameras: broadcast, tactical, POV, player-lock.
- MVP languages `en` + `zh` (both QA-able by the team); `es` is a stretch goal.
- No Microsoft Fabric (setup cost, uncertain student access). No real datasets, not even for
  calibration — parameters come from published papers.
- Category target: Grand Prize + Best Multi-Agent System.
- **Vertical slice first** (SPEC §9): one hero moment end-to-end and deployed by Oct 22, then widen.
- A match = 15–25 stitched scenario possessions, 10–15 min of play (SPEC §3.1) — not 90 min.
- The sim runs offline; `api/` replays it at 1× as the live ingest stream. Breakdowns are cached by
  content hash so the public demo survives quota or credit running out (SPEC §2).
- xT is our own implementation; socceraction is not used.
- The repo stays private during development and goes public by Oct 26.
