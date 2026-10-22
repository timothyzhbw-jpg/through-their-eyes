# Numbers: where each one comes from, and the refresh at the freeze

Every number that the judge-facing pages quote (README, [SUBMISSION](SUBMISSION.md),
[RUBRIC_MAP](RUBRIC_MAP.md), [EVALS](EVALS.md), [DATASET](DATASET.md),
[VIDEO_SCRIPT](VIDEO_SCRIPT.md), DEMO_SCRIPT and the Innovation Studio page)
is listed below with the report or command that produces it and every place that quotes it.

**Rule.** A number in the docs cites the report or command it comes from, and that report or
command was run on the canonical platform, Linux in `python:3.11-slim`, where CI and the live API
run (SPEC 3.7). The simulator is byte-identical only within one OS: macOS and glibc differ in the
last bit of `exp`, `atan2` and the like. A hero count rarely moves. An open-play statistic does,
in its last digits. Numbers measured on the deployed service (latency, the live trace) are dated
instead.

**State.** The values below were read on 2026-10-22 from `main` at `39aaf27` and from #172's head
`757d444` (the keeper spot, the xT refit, and every report regenerated in `python:3.11-slim` by
`scripts/regen_linux.sh`). The **Freeze** column stays `TODO(freeze)` until the sim freeze
(2026-10-24 evening CT) and the cloud runs (2026-10-25).

## At the freeze, step by step

1. On the frozen `main`, regenerate in `python:3.11-slim`: `scripts/regen_linux.sh exports evals`
   (and `xt` first if the xT grid is refitted; `season` and `dataset` for those rows). The
   heavy evals (season, five seasons, archetypes, hero gates on 1000–1199) run in the cloud as
   in the shared notes' `freeze-heavy-evals.md`. The cloud is Linux too, so their bytes are
   canonical.
2. For each row: run its **Read** command, write the value into **Freeze**, then replace the old
   value at each place in **Quoted in**. `grep -rn '<old value>' README.md docs/` finds them. Keep
   the wording; if a count crosses a threshold (a target missed, a "most" that is no longer most),
   rewrite the sentence instead of the digits.
3. The app's own numbers (rows C) come from the exports and from the live API's claims after the
   last deploy. The trailer and the Innovation Studio page take theirs from the same claims.
4. Dated rows (D): measure after the last deploy, then re-run `uv run python -m infra.prewarm`.
5. Commit as `docs: numbers at the sim freeze (SPEC 11)`, with this file's Freeze column filled.

`TODO(freeze)` marks a value pending the freeze; `TODO(multi-agent-evidence)` a value the
multi-agent evidence session is measuring. Neither is a number yet, and neither goes on a judge
page.

## H. Hero moments (held-out seeds)

All from `scripts/regen_linux.sh evals`; the single command is in the **Source** column.

| Id | Number | Source | Read | main | #172 | Freeze | Quoted in |
|---|---|---|---|---|---|---|---|
| H1 | Scan hero: decision changed without the key scan | [hero_flip_blind_side_run](../eval/reports/hero_flip_blind_side_run.md) ← `uv run python -m eval.hero_flip --seeds 100-139` | `grep -m1 'Decision changed without' eval/reports/hero_flip_blind_side_run.md` | 33/40 (82%) | 33/40 | TODO(freeze) | README "Judge it in 3 minutes" 2, "The full tour" 2, Evidence; SUBMISSION item 4, Evidence, [^flip]; RUBRIC_MAP §1 determinism; EVALS; DEMO_SCRIPT beat 2; Innovation Studio page |
| H2 | Scan hero: `scan` lens selected | [hero_lens_blind_side_run](../eval/reports/hero_lens_blind_side_run.md) ← `uv run python -m eval.hero_lens --scenario blind_side_run` | `grep -m1 'lens selected' eval/reports/hero_lens_blind_side_run.md` | 34/40 (85%) | 34/40 | TODO(freeze) | README Evidence; SUBMISSION Evidence, [^lens]; EVALS |
| H3 | Pressure hero: `pressure` lens selected (fresh 200–239) | [hero_lens_press_escape](../eval/reports/hero_lens_press_escape.md) ← `uv run python -m eval.hero_lens --scenario press_escape` | `grep -m1 'lens selected' eval/reports/hero_lens_press_escape.md` | 40/40 | 40/40 | TODO(freeze) | README Evidence; SUBMISSION Evidence, [^press]; EVALS |
| H4 | Pressure hero: ball lost after the forced carry | same | `grep -m1 'ball is lost after' eval/reports/hero_lens_press_escape.md` | 40/40 | 40/40 | TODO(freeze) | README "The full tour" 7, Evidence; SUBMISSION hero list, Evidence, [^press]; DEMO_SCRIPT; Innovation Studio page |
| H5 | Pressure hero: possession outcome changed | same | `grep -m1 'changes the outcome' eval/reports/hero_lens_press_escape.md` | 32/40 (80%) | 32/40 | TODO(freeze) | README Evidence; SUBMISSION Evidence, [^press] |
| H6 | Pressure hero on 100–139: lens · outcome changed | [hero_lens_press_escape_100-139](../eval/reports/hero_lens_press_escape_100-139.md) ← `… --scenario press_escape --seeds 100-139` | `grep -m2 -e 'lens selected' -e 'changes the outcome' eval/reports/hero_lens_press_escape_100-139.md` | 40/40 · 30/40 | 40/40 · 30/40 | TODO(freeze) | README Evidence ("22/40 → 30/40": 22 is the historical before, keep it); EVALS |
| H7 | Set-piece hero: runner unmarked without the look, marked with it · median separation with / without | [hero_marking_corner_blind_side](../eval/reports/hero_marking_corner_blind_side.md) ← `uv run python -m eval.hero_marking` | `grep -m2 -e 'receives unmarked' -e 'Median separation' eval/reports/hero_marking_corner_blind_side.md` | 37/40 · 3.3 m / 8.5 m | same | TODO(freeze) | README Evidence; SUBMISSION hero list, Evidence, [^marking]; EVALS |
| H8 | Shot hero: placement changed · median ΔP_goal | [hero_shot_far_post_finish](../eval/reports/hero_shot_far_post_finish.md) ← `uv run python -m eval.hero_shot` | `grep -m2 -e 'Placement changed without' -e 'Median ΔP_goal' eval/reports/hero_shot_far_post_finish.md` | 38/40 · +0.524 | 38/40 · +0.524 | TODO(freeze) | not quoted yet (EVALS should list it) |
| H9 | Save hero: P_save gap ≥ 0.4 · first sight ≥ 0.25 s later (target ≥ 90%: **not met**) | [hero_save_screened_shot](../eval/reports/hero_save_screened_shot.md) ← `uv run python -m eval.hero_save` | `grep -m2 -e 'P_save(step)' -e 'first sight ≥ 0.25' eval/reports/hero_save_screened_shot.md` | 28/40 · 35/40 | same | TODO(freeze) | not quoted (not in the deployed match) |

## A. Analytics and the Verifier

| Id | Number | Source | Read | main | #172 | Freeze | Quoted in |
|---|---|---|---|---|---|---|---|
| A1 | Scan detector, held-out F1, nuisance on | [scan_detector](../eval/reports/scan_detector.md) ← `uv run python -m eval.scan_detector` | `grep -m1 'Held-out F1, nuisance on' eval/reports/scan_detector.md` | 0.991 | 0.991 | TODO(freeze) | README Evidence; SUBMISSION Evidence, [^detector]; RUBRIC_MAP §1; EVALS |
| A2 | Scan detector on keypoints, 20 mm per axis (F1) | [keypoint_ingest](../eval/reports/keypoint_ingest.md) ← `uv run python -m eval.keypoint_ingest` | `grep -m1 '20 mm (stress)' eval/reports/keypoint_ingest.md` (last column) | 0.962 | 0.962 | TODO(freeze) | README "Path to production" |
| A3 | Blind-side alerts, fresh held-out precision · recall | [blind_side](../eval/reports/blind_side.md) ← `uv run python -m eval.blind_side` | `grep -m2 -e 'Fresh held-out precision' -e 'Fresh held-out recall' eval/reports/blind_side.md` | 0.915 · 0.943 | 0.914 · 0.946 | TODO(freeze) | SUBMISSION Evidence, [^blind]; RUBRIC_MAP §1; EVALS (README says "≥ 0.8, ≥ 0.7 met") |
| A4 | Pitch-control shader vs numpy, max abs diff (target < 0.02) | [pitchControl.gpu.test.ts](../web/src/pitchControl/pitchControl.gpu.test.ts) ← `uv run python -m eval.pitch_control_parity`, then `cd web && npm test` in CI | the CI log of `npm test`: `max \|GLSL - numpy\|` per frame | about 5e-5 | TODO(freeze) | TODO(freeze) | SUBMISSION Evidence, [^parity]; RUBRIC_MAP §1 |
| A5 | Verifier on perturbed claims: false perturbations refuted · generated claims supported · verdicts logged | [corruption](../eval/reports/corruption.md) ← `uv run python -m eval.corruption` | `grep -e 'Generated claims verified' -e 'refuted by the verifier' -e 'Verdicts written' eval/reports/corruption.md` | 90/90 · 468/468 · 568/568 | same | TODO(freeze) | README "What only we do", "The full tour" 5, Evidence; SUBMISSION Evidence, [^corruption]; RUBRIC_MAP §2, §3; EVALS; DEMO_SCRIPT |
| A6 | Laws audit: unpunished breaches · runs | [laws](../eval/reports/laws.md) ← `uv run python -m eval.laws` | `grep -m2 -e 'unpunished breaches' -e 'line-ups' eval/reports/laws.md` | 0 · 2,916 | 0 · 3,096 | TODO(freeze) | EVALS; RUBRIC_MAP §1 (after the rubric PR) |

## R. Realism (`possession_play` held-out seeds 100–199)

| Id | Number | Source | Read | main | #172 | Freeze | Quoted in |
|---|---|---|---|---|---|---|---|
| R1 | Scans in the 10 s before receiving (published 3.0 ± 2.1) | [realism](../eval/reports/realism.md) ← `uv run python -m eval.realism` | `grep -m1 'Scans in the 10 s before receiving' eval/reports/realism.md` | 2.79 | 2.77 | TODO(freeze) | README "What only we do"; SUBMISSION [^realism] |
| R2 | Peak head speed in a scan, °/s (published 404.2 ± 50.7) | same | `grep -m1 'Peak head angular speed' eval/reports/realism.md` | 404 ± 51 | 404 ± 51 | TODO(freeze) | SUBMISSION "Scans", [^realism] |
| R3 | Scan statistics inside · outside · no reference | same | `sed -n 5p eval/reports/realism.md` | 11 · 5 · 10 | 11 · 5 · 10 | TODO(freeze) | README "Validated, and not"; SUBMISSION Evidence, Limitations, [^realism]; RUBRIC_MAP §1; EVALS |
| R4 | Pressure effect on scanning, Cohen's d 10+ m vs 0–1 m (published 0.57) and its 90% interval | same | `grep -m1 'at the reception † [^:]' eval/reports/realism.md` | 0.18 (−0.02 to 0.38) | 0.15 (−0.06 to 0.36) | TODO(freeze) | README Limitations; SUBMISSION Limitations |
| R5 | Team shape inside · outside · no reference | same, section "Team shape" | `grep -A2 '^## Team shape' eval/reports/realism.md` | 8 · 6 · 23 | 8 · 6 · 23 | TODO(freeze) | EVALS |
| R6 | `scan_omega` fitted | [scan_calibration](../eval/reports/scan_calibration.md) ← `uv run python -m eval.scan_calibration` | `grep -m1 scan_omega eval/reports/scan_calibration.md` | 404.2 ± 50.7 | same | TODO(freeze) | EVALS |

## M. Matches

`sim.match` is not in `regen_linux.sh`; run it in the same image:

```bash
docker run --rm -v "$PWD":/src:ro python:3.11-slim bash -c \
  'pip -q install uv && cp -r /src /w && cd /w && uv sync -q --locked && uv run python -m sim.match --seed 1 && uv run python -m sim.match --seed 2'
```

| Id | Number | Source | Read | main | #172 | Freeze | Quoted in |
|---|---|---|---|---|---|---|---|
| M1 | match-1: possessions, length, score | `uv run python -m sim.match --seed 1` | its last line | 19, 808.3 s (13½ min), 1–0 | 19, 808.3 s, 1–0 (Mac run of both; #150 made match structure platform-independent) | TODO(freeze) | README "The full tour" 7, "API service"; SUBMISSION "The live heroes…", [^match] (still says "on a Mac": say Linux); DEMO_SCRIPT |
| M2 | match-1 hero starts: scan, pressure, shot, corner | same | the rows of `blind_side_run`, `press_escape`, `far_post_finish`, `corner_blind_side` | 30.0 · 306.7 · 477.6 · 587.3 s (0:30 · 5:07 · 7:58 · 9:47) | same | TODO(freeze) | README "API service"; the deep link `?match=match-1&camera=broadcast&at=751` (frame = 30.04 s × 25) in README "The full tour" 7 and DEMO_SCRIPT |
| M3 | match-2: possessions, length, score | `uv run python -m sim.match --seed 2` | its last line | 17, 743.8 s (12½ min), 0–0 | TODO(freeze) | TODO(freeze) | README "API service" |
| M4 | Possession changes per 90 min by tackle · out of play (20 matches) | [match_stats](../eval/reports/match_stats.md) ← `uv run python -m eval.match_stats` | `grep -m2 -e 'by tackle per 90' -e 'out of play per 90' eval/reports/match_stats.md` | 0 · 0 | 0 · 0 | TODO(freeze) | README Limitations; SUBMISSION Limitations, [^matchstats] |
| M5 | Tactics card "build from the back": completed short passes under pressure (and without) | `uv run python -m explain.tactics --match 1`; web fixture by `scripts/regen_linux.sh exports` | its "build from the back" sentence | 25 of 34, 74% (86% without) | 30 of 38, 79% (86%) | TODO(freeze) | SUBMISSION "Roadmap"; [TACTICS](TACTICS.md) |
| M6 | Tactics card "set pieces": the corner's xT, time, rank among open-play passages | same | its "set pieces" sentence | 0.29 xT in 4.4 s, more than any of the 18 | 0.20 xT in 4.4 s, more than 17 of the 18 | TODO(freeze) | SUBMISSION "Roadmap"; [TACTICS](TACTICS.md) |
| M7 | Dataset at a glance: frames, events, receptions; minutes per match | `scripts/regen_linux.sh dataset` (builds the 10 matches, keeps `data/sample`) | the archive's manifest | built on macOS; 201,961 frames | Linux; 201,949 frames | TODO(freeze) | DATASET "At a glance"; DATASET Limitations "About 12.5 min of play per match": should read 13.5 (13:26–13:29 per match, its own table) |

## C. The app's own verified numbers (hero `blind_side_run`, seed 3)

Exports by `scripts/regen_linux.sh exports`. The live site reads the same claims from the API,
which runs on Linux. The trailer reads them off the live page (`out/video/claims.json`).

| Id | Claim | Read | main | #172 | Freeze | Quoted in |
|---|---|---|---|---|---|---|
| C1 | `cf_value.dxt`: what the look was worth, in xT | `cf_value` in `web/public/data/fixture_payload_seed3.json` | 0.17 | 0.16 | TODO(freeze) | VIDEO_SCRIPT "Numbers"; the trailer's card (#182); Innovation Studio page; DEMO_SCRIPT (read off the screen) |
| C2 | `pass_success`: he thought · it was | same, `pass_success` | 0.67 · 0.85 | 0.65 · 0.83 | TODO(freeze) | the app's "he thought / it was"; DEMO_SCRIPT (read off the screen) |
| C3 | `cf_belief_error.err`: his picture of the runner without the look, m | same, `cf_belief_error` | 12.3 | 12.3 | TODO(freeze) | README "The full tour" 2 ("12 m off") |
| C4 | xT where the pass arrives, with · without the look | the third English line of `web/public/data/without_look_seed3.json` | 0.172 · 0.002 | 0.157 · 0.002 | TODO(freeze) | the app's "Without the look" panel |
| C5 | `pass_to_runner.dist`, m | the live API's claims (`out/video/claims.json`) | 38 | TODO(freeze) | TODO(freeze) | VIDEO_SCRIPT "Numbers"; the trailer |

## D. Measured on the deployed service, or on the repository (dated)

| Id | Number | How to measure | Last measured | Freeze | Quoted in |
|---|---|---|---|---|---|
| D1 | One uncached model breakdown, warm replica · first request after a deploy · from the cache | right after the last deploy, before `infra.prewarm`: `curl -s -o /dev/null -w '%{time_total}\n' -X POST <API>/api/breakdowns -H 'content-type: application/json' -d '{"match": "blind_side_run-3", "personas": ["coach"], "languages": ["en"]}'` (first = cold); again with another persona (warm); the first again (cached). Each uncached call counts against the daily cap | 12.9 s · 23.8–25.9 s · 0.15 s (SPEC §8, 2026-10-20, revision 0000017) | TODO(freeze) | README Evidence; SUBMISSION [^latency]; RUBRIC_MAP §4 |
| D2 | The live trace: total, MCP start, crew; spans | the Kusto query in RUBRIC_MAP "The live trace", on the first model breakdown after the last deploy | 15.5 s · 5.1 s · 9.9 s (2026-10-20, before #123's Director budget, #126 names, #127 persona claims) | TODO(freeze) | RUBRIC_MAP "The live trace"; SUBMISSION "Observed live", [^trace] |
| D3 | Tests in CI on the submitted commit: pytest · vitest · smoke pages | `gh run view <run id> --log \| grep -E -e 'passed in [0-9.]+s' -e 'Tests +[0-9]+ passed' -e 'pages passed'` | 1216 · 595 · 15 of 15 (run 39583678095, `44c0bb5`, 2026-10-21) | TODO(freeze) | RUBRIC_MAP header; SUBMISSION Evidence, [^tests] |
| D4 | Pull requests checked for Copilot, Azure MCP Server, Fabric | `gh pr list --state all --limit 500 --json number,title,body \| jq length`; `git log --all -i --grep copilot` | 30 PRs (2026-10-20) | TODO(freeze) | RUBRIC_MAP "Development tools"; SUBMISSION [^devtools] |
| D5 | Expected Azure cost to 2026-11-10 | SPEC §8 budget; Cost Management for `rg-through-their-eyes` | ≈ $15 | TODO(freeze) | RUBRIC_MAP §3 |
| D6 | The trailer: length, timeline | `cd video && npm run trailer` report (`out/video/trailer_report.md`) | 1:57, 117.30 s (v13) | TODO(freeze) (v14, #182) | VIDEO_SCRIPT; Innovation Studio page |
| D7 | Narration ablation: free-text lines naming what no claim holds · anchored · groundedness | [narration_ablation](../eval/reports/narration_ablation.md), Foundry; not re-run at the freeze: its model calls are cached by moment, and it measures the model, not the sim's last bits | 34 of 66 · 0 of 111 · 4.90 vs 5.00 (2026-10-20, ids, before #126) | keep, dated | README "The full tour" 5, Evidence; SUBMISSION "The problem", "Why anchor", Evidence, [^ablation]; RUBRIC_MAP §2; EVALS |

## MA. The crew against one agent (Best Multi-Agent System)

From [crew_vs_single](../eval/reports/crew_vs_single.md) (2026-10-21, Foundry `gpt-4.1-mini`,
six moments × four audiences) and the multi-agent evidence session, whose numbers are pending.

| Id | Number | Source | Value | Freeze | Quoted in |
|---|---|---|---|---|---|
| MA1 | One agent down (Analyst or Telestrator): valid verified breakdown aired · roles still from the model, crew vs single | crew_vs_single "Failure drill" | 3 of 3 both · 3 of 4 vs 0 of 4 | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew"; README Evidence |
| MA2 | Bring the Telestrator back: model requests · tokens, crew vs single | same | 1.0 · ~2.1k vs 1.7 · ~11.7k | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew" |
| MA2b | Bring the Analyst back: model requests · tokens, crew vs single | same | 11.0 · ~21.6k vs 1.7 · ~11.7k | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew", [^crew] |
| MA3 | Agent runs slower than the deployed 8 s step timeout, crew vs single | crew_vs_single, four arms | 0 of 66 vs 6 of 6 | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew" |
| MA4 | Model plans that validate, crew vs single | same | 6/6 vs 5/6 | TODO(freeze) | RUBRIC_MAP §5 |
| MA5 | Wrong facts aired · groundedness, crew vs single (no difference) | same | 0 vs 0 · 5.00 vs 5.00 | TODO(freeze) | SUBMISSION Limitations, [^crew]; RUBRIC_MAP §5 |
| MA6 | Cost per breakdown, crew vs single | same | $0.0090 vs $0.0046 | TODO(freeze) | SUBMISSION [^crew]; RUBRIC_MAP §5 |
| MA7 | Recovery under an outage of the model service | TODO(multi-agent-evidence) | TODO(multi-agent-evidence) | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew"; DEMO_SCRIPT |
| MA8 | Per-step Verifier: lines sent back and rewritten or dropped | TODO(multi-agent-evidence) | TODO(multi-agent-evidence) | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew" |
| MA9 | Personas in parallel: seconds to air for N audiences vs one | TODO(multi-agent-evidence) | TODO(multi-agent-evidence) | TODO(freeze) | RUBRIC_MAP §5; SUBMISSION "Why a crew" |
| MA10 | Crew trace: steps a viewer can audit per breakdown | TODO(multi-agent-evidence) | TODO(multi-agent-evidence) | TODO(freeze) | RUBRIC_MAP §5 |
| MA11 | Headline claims spoken, crew vs single (paired difference and interval) | crew_vs_single, four arms | 92% vs 81% (+0.11, −0.00 to +0.24) | TODO(freeze) | RUBRIC_MAP §5 |

## X. Pictures and text that hold numbers or names

| Id | What | Refresh | Where |
|---|---|---|---|
| X1 | `docs/hero-key-scan.jpg`: the README's first picture still shows the pre-#126 caption "H8 checked his shoulder…" | after the last deploy, capture `?view=pov&at=key-scan&intro=0` at 1920×1080 (headless Chrome, `web/scripts/gpu.mjs`); rewrite its alt text and caption with the names (J. Ferriday, N. Varnhall) | README top |
| X2 | `docs/screenshots/` | the same pass, for any screenshot a judge page links | README, RUBRIC_MAP |
| X3 | The Innovation Studio page | from `out/innovation-studio-page.md` (not in the repository), with the values of H1, H4, C1 and D6 | the project page |
