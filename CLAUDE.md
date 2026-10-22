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
2. **Synthetic data only.** No real match data or footage in the app or the repo, and none in the
   demo. Fictional clubs and players. No Premier League or club
   logos, real player names, broadcaster branding, or copyrighted music — in code, assets, or video.
   - The real-footage exception (approved 2026-10-19) was cut by Bowen on 2026-10-20: no real data or footage anywhere, including the demo video.
3. **English** for everything in the repo (code, comments, docs, commits, UI). Only localized
   narration may be non-English.
4. **Microsoft stack, meaningfully used:** Microsoft Foundry (models), Microsoft Agent Framework
   (multi-agent), MCP (our tool server), Azure AI Speech (TTS), Azure Container Apps (API) + an
   Azure Storage static website (web), Azure Cosmos DB (store), Application Insights (traces),
   GitHub Actions (CI and deploy). Don't add Azure services just to tick boxes.
   - Bowen decided on 2026-10-20 to host the web app as a Storage static website instead of Static
     Web Apps. Static Web Apps only runs in West US 2, Central US, East US 2, West Europe and East
     Asia, and the Azure for Students policy allows none of them; creating one was refused.
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
- `infra/deploy.sh provision | api | web | github` — hosting (SPEC 8): create the Azure resources,
  build and roll out the API image, upload web/, set the deploy workflow's repo variables. Same
  subscription guard as M0. After that, `.github/workflows/deploy.yml` redeploys on every green
  CI run on main.
- `uv run python -m infra.prewarm --api <API URL> [--tts]` — fill the deployed breakdown cache
  (SPEC 2, 8): every hero moment × persona × language, then each stitched match's recap ×
  persona × language (SPEC 6), new ones paced to the per-client limit,
  at most `--max-new` (20) of the 40/day cap; `--tts` also speaks every voice cue once (audio is
  cached on the replica's disk only). Run after the last deploy and after any later one: the
  cache key holds the card, prompt and pipeline versions. `--dry-run` sends GET requests only
- `uv run --env-file .env python -m infra.smoke` — M0 smoke test: Foundry model via Agent
  Framework (structured output) + Azure Speech TTS (`en`, `zh`)
- `uv run --env-file .env python -m infra.voices` — check the narration voices and their speaking
  styles against the Azure Speech voices list for `AZURE_SPEECH_REGION`
- `uv run python -m eval.hero_gates --run --jobs 4` — large-sample check (SPEC 3.6): every hero's
  held-out gate re-run unchanged on fresh seeds 1000–1199 (only the missing reports, under `nice`),
  then the summary with 95% Wilson intervals, `eval/reports/hero_gates_1000-1199.md`. Without
  `--run` it only rewrites the summary from the committed reports
- `uv run python -m eval.hero_flip --seeds 100-139` — hero-moment eval (SPEC 3.6): does dropping
  the key scan change the decision? Writes `eval/reports/hero_flip_<scenario>.md`
- `uv run python -m eval.hero_lens --scenario press_escape` — hero lens eval (SPEC 3.6, 5.2):
  does lens selection pick the lens the scenario is built for, and does its intervention
  (`Scenario.intervention`) change the outcome? Design seeds are 0–99. By default it runs the
  held-out seeds, 100–139, or 200–239 for `press_escape` (100–139 were seen while fixing the
  decision model) and for `far_post_finish` (its gate's seeds), and writes `eval/reports/hero_lens_<scenario>.md`. With other `--seeds` it
  writes `hero_lens_<scenario>_<first>-<last>.md` instead (`--out` for another path). With
  `--scenario corner_blind_side` it reads the marker's look (`marker_scan`, no decision on the
  ball): the scan lens's Δ, whether its scan is the key scan, and `eval.hero_marking`'s gate
- `uv run python -m eval.hero_marking` — set-piece hero eval (SPEC 3.6, `corner_blind_side`):
  without the marker's key scan, is the runner unmarked when the cutback arrives, and with it is
  the marker there? Held-out seeds 100–139 (design 0–39), about 15 s; writes
  `eval/reports/hero_marking_corner_blind_side.md`
- `uv run python -m eval.hero_shot` — shot hero eval (SPEC 3.3, 3.6, `far_post_finish`): without
  the striker's key scan, does his placement change, and by how much does his scoring chance on
  the truth drop? Includes the v_dive sweep. Held-out seeds 200–239 (design 0–39), about a minute;
  writes `eval/reports/hero_shot_far_post_finish.md`
- `uv run python -m eval.hero_save` — save hero eval (SPEC 3.3, 3.6, `screened_shot`): without
  the keeper's key step, does his save probability drop by ≥ 0.4, and is that mostly from seeing
  the ball later? Includes the v_dive sweep. Held-out seeds 300–339 (design 0–39), about 15 s;
  writes `eval/reports/hero_save_screened_shot.md`
- `uv run python -m sim.match --seed 1` — summarise the stitched match (SPEC 3.1);
  `uv run python -m sim.export --match 1 --out out/match_seed1.json` writes its export
- `uv run python -m sim.dataset --matches 10 --out out/dataset/` — the downloadable dataset
  (SPEC 3.1, docs/DATASET.md): stitched matches on seeds 5001–, as events, tracking, metadata
  and per-reception perception, plus a deterministic tar.gz in out/, about 80 s on all cores;
  `--sample data/sample` rewrites the committed one-possession sample (a test fails when it is
  stale on the platform that made it). `uv run python examples/dataset_quickstart.py --data
  out/dataset` reads it back
- `uv run python -m eval.blind_side` — blind-side alert eval (SPEC 4.4) against the sim's
  beliefs, about 2 min; writes `eval/reports/blind_side.md`
- `uv run python -m eval.season` — the pipeline offline on a season of 380 stitched matches (SPEC 3, 5, 6):
  moments, breakdowns, the Verifier, interventions, determinism and the realism rows at season
  scale, on all cores (15–30 min); writes `eval/reports/season.md` (`--from-cache` re-renders).
  `--season-seed 2027 --seasons 5` runs five independent seasons and writes them side by side,
  pooled with 95% intervals, to `eval/reports/seasons_2027-2031.md`
- `uv run python -m analytics.live_stats --match 1` — live match stats (SPEC 4.6): per player
  distance, top speed, sprints, passes with accuracy and difficulty, from tracking and events
  only; `--scenario blind_side_run --seed 3 --web-fixture web/src/stats/fixture_seed3.json`
  rewrites the viewer's parity fixture (a test fails when it is stale). The API serves them at
  `GET /api/matches/<id>/stats` and as `stat` messages on the live stream
- `uv run python -m eval.pass_difficulty` — does pass difficulty separate failed from completed
  passes (SPEC 4.6)? `possession_play` seeds 300–399, about 1 min; writes
  `eval/reports/pass_difficulty.md`
- `uv run python -m eval.realism` — realism table (SPEC 3.8): sim scan rates, head turns,
  speeds and pass speeds on `possession_play` seeds 100–199 against values printed in the papers
  of `docs/REFERENCES.md`, about 40 s; writes `eval/reports/realism.md`
- `uv run python -m eval.match_stats` — match statistics (SPEC 3.1, 9): passes, possession
  changes, team possessions and shots per stitched match and per 90 min of play, on held-out
  match seeds 100–119, about 30 s on all cores; writes `eval/reports/match_stats.md`
- `uv run --group eval --env-file .env python -m eval.narration_ablation --seeds 3,100-103`
  — narration ablation (SPEC 6): free-text vs anchored lines on Foundry, scored by the
  Verifier and azure-ai-evaluation groundedness; about 30 model calls per seed, cached in
  `out/narration_ablation/`. Writes `eval/reports/narration_ablation.md`
- `uv run --group eval --env-file .env python -m eval.crew_vs_single` — crew vs single agent
  (SPEC 6, Best Multi-Agent System): one Foundry call doing the four agents' jobs
  (`eval/single_agent.py`) vs the crew, each with and without the Verifier, on six hero moments,
  plus the failure drill and a free-text sensitivity. Every model request is cached in
  `out/crew_vs_single/` (about 200 calls the first time, none after; `--cached-only` re-scores).
  Writes `eval/reports/crew_vs_single.md`
- `uv run python -m eval.scan_calibration` — fits the scan dwell and the role scan rates
  (SPEC 3.4) on tuning seeds 0–99 against printed values, about 3 min on all cores; writes
  `eval/reports/scan_calibration.md`. After a change to head motion or scan scheduling: re-run
  it, copy the values into `sim/config.py`, then re-run every scan eval and `sim.export`
- `uv run python -m eval.scan_detector` — scan-detector threshold sweep (SPEC 4.7), a few
  minutes; writes `eval/reports/scan_detector.md`
- `uv run python -m eval.keypoint_ingest` — the scan detector on limb tracking (SPEC 4.7):
  held-out F1 from keypoint-derived head yaw (`sim/keypoints.py` → `analytics/keypoints.py`) vs
  the sim's tracked head yaw, about 20 s; writes `eval/reports/keypoint_ingest.md`
- `uv run python -m eval.look_grid --scenario blind_side_run` (or `press_escape`) — Take his
  eyes (SPEC 3.7, 7): which looks change the hero's decision on the demo seed and on held-out
  seeds, about a minute each; writes `eval/reports/look_grid_<scenario>.md`.
  `uv run python -m sim.export --scenario blind_side_run --seed 3 --looks
  web/public/data/look_seed3.json` (and `press_escape` seed 0) rewrites the grid the web ships;
  `uv run python -m agents.look --seed 3 --frame 50 --offset -150` prints one look's verified lines
- `uv run python -m eval.pitch_control_parity` — the numpy half of the pitch-control shader
  parity test (SPEC 4): 10 hero-moment snapshots and the kernel on the 1 m grid, into
  `web/src/pitchControl/snapshots.json`. Re-run after a change to the pitch-control kernel or
  the hero moment
- `cd web && npm test` — includes the GPU parity test in headless Chrome (`TTE_CHROME=<path>` if
  it is not found); `npm run build && npm run fps` — fps with the pitch-control overlay and the
  skeleton view off and on (`-- --headed` on a laptop's GPU)
- `cd web && npm run smoke` — end-to-end smoke test of every page (SPEC 7, 8; CI job `smoke`),
  including axe-core's WCAG 2.2 A/AA rules
- `cd web && npm run a11y -- --url <site>` — accessibility audit (docs/ACCESSIBILITY.md): axe-core
  on every screen (menus, Your call, evidence, a match's breakdown) at 1440×900 and 375×812; on a
  deployed site it asks only for the casual and analyst breakdowns in English. Writes `out/a11y/`.
  `npm run contrast -- --url <site>`: the contrast of the text over the 3D views, by pixels (axe
  cannot judge it), on 72 renders
- `uv run python -m eval.xt_fit` — fits the 16 × 12 xT grid (SPEC 4.5) on `open_play` tuning
  seeds 0–1999, about 30 min on 4 cores; writes `analytics/xt_grid.json`, `eval/reports/xt_fit.md`
  and the sanity plot `eval/reports/xt_fit.svg`. `tests/test_xt.py` fails when the sim no longer
  behaves as it did for the fit: re-run it, then regenerate the exports (web/README.md)
- `uv run python -m agents.run --seed 3 --offline` — the agent crew on the hero moment (SPEC 6);
  without `--offline` it uses Microsoft Foundry when `FOUNDRY_*` is set; `--mcp` gives the
  Analyst our MCP tool server. Writes `out/breakdown_<scenario>_seed<seed>.json`
- `uv run python -m agents.mcp_server --seed 3` — the MCP tool server (stdio); `--match 1` or
  `--recap <evidence file>` serves the end-of-match recap's tools instead
- `uv run python -m agents.recap --seed 1 --offline` — the end-of-match recap of stitched match 1
  (SPEC 6): the crew on the whole match, written to `out/recap_match1.json`; without
  `--offline` it uses Foundry, `--mcp` gives the Analyst the recap's MCP tools, `--down
  narration` takes steps down (no model calls for them)
- `uv run --env-file .env python -m agents.whatif --seed 3 "What if he had played it back to the
  centre-back?"` — answer a what-if question by re-simulating with `force_action` (SPEC 3.7, 6);
  Foundry maps the question when `FOUNDRY_*` is set, `--offline` uses the rule parser only
- `uv run uvicorn api.main:app --reload` — the API service (SPEC 2): `/ws/matches/<id>/live`,
  `/api/matches/<id>/moments`, `POST /api/breakdowns` (cached; `fail` runs the failure drill),
  `POST /api/breakdowns/<key>/bring-back` (SPEC 6), `POST /api/whatif`, `POST /api/tts`,
  `POST /api/recaps` and `GET /api/recaps/<key>/cues` (the end-of-match recap, SPEC 6),
  `GET /api/breakdowns/<key>/trace` and `GET /api/recaps/<key>/trace` (the crew trace, SPEC 6)
- `uv run python -m agents.crewtrace` — rewrite the web's Crew trace fixture
  (`web/src/crewtrace/fixture.json`, SPEC 6): a drill with a scripted model, MCP tool calls, a
  Verifier rewrite and a bring-back; `tests/test_crew_trace.py` checks it against the schema
- `docker build -t tte-api . && docker run --rm -p 8000:8000 tte-api` — the API image (SPEC 8):
  main dependencies only, non-root, `GET /health`
- `cd video && npm ci && npx playwright install chromium` once, then `npm run capture` — demo
  video capture kit (SPEC 10): records every shot of `video/shots.json` from the live site into
  `out/video/` (WebM clips, stills, contact sheet, voice-over with numbers read off verified claims)
- `cd video && npm run trailer` — the < 2:00 demo video as a trailer edit (SPEC 10): records the app
  shots (`capture.mjs`), films the cold open in cinematic mode (`?cine=1`), renders the titles, the
  Azure voice-over and the synthesized sound, cuts with ffmpeg into `out/video/trailer.mp4` plus a
  contact sheet and a report. `-- --check` validates `video/trailer.json` (CI); `-- --base-url
  http://localhost:5173` films a local build; from a worktree `uv run --env-file <.env> node
  video/trailer.mjs`
- `python3 docs/architecture.py` — regenerate the architecture diagram (SPEC 2, 10):
  `docs/architecture.svg` and `-dark.svg`, standard library only. `--png --chrome <path to
  chrome-headless-shell>` also writes the 1920×1080 video frame `docs/architecture.png` (full
  Chrome's `--headless` crops it). `tests/test_architecture.py` fails when any of them is stale
  or the diagram drifts from the code
- Not yet: `uv run python -m eval.run_all`

## Decisions already made (don't relitigate without a reason)
- The hero lens is **perception** (scans / vision / belief). `space` (pitch control, xT) and
  `pressure` lenses also exist; each moment uses the lens with the largest counterfactual impact.
- Players: animated footballers (Gameplay Football models, SPEC §7) in POV and broadcast, stylised
  tokens on the tactical board; Bowen chose them by eye on 2026-10-20. Tokens stay the fallback.
  Cameras: broadcast, tactical, POV, player-lock.
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
