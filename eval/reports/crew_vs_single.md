# Crew vs single agent — is it the crew or the Verifier? (SPEC 6)

Model: `gpt-4.1-mini` on Microsoft Foundry, for every agent and as the groundedness judge. Evaluator: `azure-ai-evaluation` `GroundednessEvaluator`. Date: 2026-10-21.
Moments: 6 in the four-arm comparison, 3 in the failure drill, 1 with free-text lines (listed below). Audiences: casual, analyst × en, zh, the API's default: four scripts per breakdown.
Model calls: 194 (123 by the agents, 71 by the groundedness judge), and 73 more spent on a pilot and on runs set aside (below). Agent tokens: 297,059 in (74,240 from the prompt cache), 13,584 out: $0.12 at the list price ($0.40 / $0.10 cached / $1.60 per million tokens in, cached and out); the judge's 90,537 in and 10,447 out: $0.05 more.

## Headline

- **Verification, as shipped (A→B, C→D): nothing measurable.** Wrong facts aired: 0 · 0 · 0 · 0 (A · B · C · D); lines the Verifier rejects: 0 of 110 without it in the single agent, 0 of 141 in the crew. Anchored lines are verified sentences, so the Verifier rejected no line and changed nothing that aired in either structure.
- **Collaboration, as shipped (A→C, B→D): resilience, not measurably better lines.** Single vs crew: wrong facts aired 0 vs 0, groundedness 5.00 vs 5.00, plans from the model that validate 5 of 6 vs 6 of 6, headline claims spoken 81% vs 92% (per breakdown; the crew's scripts are longer, since each voice reads the persona's length for itself: 18 vs 24 lines per breakdown). Seconds to air 14.4 vs 13.8, no measurable difference. The crew costs more: 1.8 vs 12.0 model requests and $0.0046 vs $0.0090 per breakdown. Its steps are short: under the deployed 8 s step timeout, 0 of 66 crew agent runs would have timed out, and 6 of 6 of the single agent's. Without any fault, 0 single and 0 crew breakdowns had a role on its template.
- **Analyst down.** single: 3 of 3 aired a valid, verified breakdown with 0 of 4 roles from the model; bringing it back took 1.7 model requests; crew: 3 of 3 aired a valid, verified breakdown with 3 of 4 roles from the model; bringing it back took 11.0 model requests.
- **Telestrator down.** single: 3 of 3 aired a valid, verified breakdown with 0 of 4 roles from the model; bringing it back took 1.7 model requests; crew: 3 of 3 aired a valid, verified breakdown with 3 of 4 roles from the model; bringing it back took 1.0 model requests.
- **Free-text lines (sensitivity, 1 moment).** Without the Verifier the voices' own sentences air: wrong facts 3 (single) and 12 (crew); lines the Verifier rejects 16 of 18 and 18 of 18. With it, 0 and 0 wrong facts and 0 and 0 rejected lines air: that is due to verification. The crew's separate voices did not write fewer wrong facts than the single agent, so none of it is due to collaboration.

## Inputs

| moment | card | selected lens | supported claims | in | why |
|---|---|---|---:|---|---|
| `blind_side_run` seed 3 | `m:decision_after_scan:H8:0075` | scan | 24 of 24 | comparison, drill, free text | served by the deployed site; one of match-1's three hero possessions |
| `press_escape` seed 0 | `m:pressed_decision:H4:0066` | pressure | 14 of 14 | comparison, drill | served by the deployed site; one of match-1's three hero possessions |
| `corner_blind_side` seed 0 | `m:marker_scan:H5:0121` | scan | 13 of 13 | comparison, drill | served by the deployed site; one of match-1's three hero possessions |
| `far_post_finish` seed 0 | `m:decision_after_scan:H9:0196` | scan | 19 of 19 | comparison | the shot hero on main, not deployed |
| `blind_side_run` seed 100 | `m:decision_after_scan:H8:0075` | scan | 24 of 24 | comparison | a held-out seed of the same hero scenario |
| `press_escape` seed 200 | `m:pressed_decision:H4:0067` | pressure | 14 of 14 | comparison | a held-out seed of the same hero scenario |

## The four arms, on the shipped schema (anchored lines)

Means per breakdown with 95% bootstrap intervals over moments; rates pooled over lines or replies with Wilson 95% intervals.

| | A · single agent | B · single + Verifier | C · crew, no Verifier | D · crew (deployed) |
|---|---:|---:|---:|---:|
| breakdowns (moment × 4 audiences) | 6 | 6 | 6 | 6 |
| replies that fit their schema | 6/6 (100%) [61, 100] | 6/6 (100%) [61, 100] | 66/66 (100%) [94, 100] | 66/66 (100%) [94, 100] |
| agent roles from the model, of 4 | 4.00 | 4.00 | 4.00 | 4.00 |
| plans from the model that validate | 5/6 (83%) [44, 97] | 5/6 (83%) [44, 97] | 6/6 (100%) [61, 100] | 6/6 (100%) [61, 100] |
| plan error codes | unknown_scan ×1 | unknown_scan ×1 | none | none |
| lines aired per breakdown | 18.3 [15.7, 21.3] | 18.3 [15.7, 21.3] | 23.5 [23.2, 23.8] | 23.5 [23.2, 23.8] |
| lines per script: casual · analyst | 3.0 [2.5, 3.5] · 6.2 [5.8, 6.7] | 3.0 [2.5, 3.5] · 6.2 [5.8, 6.7] | 4.0 [3.7, 4.3] · 7.8 [7.3, 8.0] | 4.0 [3.7, 4.3] · 7.8 [7.3, 8.0] |
| aired lines the Verifier rejects (a number, id or term outside a verified slot) | 0/110 (0%) [0, 3] | 0/110 (0%) [0, 3] | 0/141 (0%) [0, 3] | 0/141 (0%) [0, 3] |
| **wrong facts aired**: ids and numbers no cited claim holds | 0 | 0 | 0 | 0 |
| claims cited by aired lines: supported · refuted · inconclusive · unknown | 110 · 0 · 0 · 0 | 110 · 0 · 0 · 0 | 141 · 0 · 0 · 0 | 141 · 0 · 0 · 0 |
| digits the model wrote in its own words: in replies · aired | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| lines dropped · rewrite rounds | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| headline claims spoken | 58/72 (81%) [70, 88] | 58/72 (81%) [70, 88] | 66/72 (92%) [83, 96] | 66/72 (92%) [83, 96] |
| lines restating an earlier one (dropped by tidy), per breakdown | 0.0 | 0.0 | 0.3 [0.0, 1.0] | 0.3 [0.0, 1.0] |
| groundedness (1–5), per script | 5.00 (min 5, 24 scripts) | 5.00 (min 5, 24 scripts) | 5.00 (min 5, 24 scripts) | 5.00 (min 5, 24 scripts) |
| seconds to air | 13.9 [11.9, 16.9] | 14.4 [12.3, 17.4] | 13.5 [11.9, 14.8] | 13.8 [12.1, 15.3] |
| model requests per breakdown (agent runs and tool rounds) | 1.8 [1.5, 2.0] | 1.8 [1.5, 2.0] | 12.0 | 12.0 |
| tokens per breakdown, in · out | 13231 [10406, 15419] · 686 [651, 720] | 13231 [10406, 15419] · 686 [651, 720] | 22112 [19790, 24435] · 744 [723, 767] | 22112 [19790, 24435] · 744 [723, 767] |
| cost per breakdown, USD | 0.0046 [0.0042, 0.0051] | 0.0046 [0.0042, 0.0051] | 0.0090 [0.0082, 0.0099] | 0.0090 [0.0082, 0.0099] |
| agent runs (tool rounds included) slower than the deployed 8 s step timeout | 6 of 6 | 6 of 6 | 0 of 66 | 0 of 66 |

## What is due to verification, and what to collaboration

Paired differences per breakdown (the later arm minus the earlier), mean over moments with a 95% bootstrap interval. A and B are one run, and so are C and D.

| per breakdown | verification, single (A→B) | verification, crew (C→D) | collaboration, no Verifier (A→C) | collaboration, with it (B→D) |
|---|---:|---:|---:|---:|
| aired lines the Verifier rejects | 0.00 | 0.00 | 0.00 | 0.00 |
| wrong facts aired (ids and numbers no cited claim holds) | 0.00 | 0.00 | 0.00 | 0.00 |
| lines aired | 0.00 | 0.00 | +5.17 [+2.50, +7.83] | +5.17 [+2.50, +7.83] |
| headline claims spoken (share) | 0.00 | 0.00 | +0.11 [-0.00, +0.24] | +0.11 [-0.00, +0.24] |
| groundedness, mean of the 4 scripts | 0.00 | 0.00 | 0.00 | 0.00 |
| agent roles from the model, of 4 | 0.00 | 0.00 | 0.00 | 0.00 |
| plan from the model and valid (0/1) | 0.00 | 0.00 | +0.17 [0.00, +0.50] | +0.17 [0.00, +0.50] |
| replies that do not fit their schema | 0.00 | 0.00 | 0.00 | 0.00 |
| seconds to air | +0.5 [+0.2, +0.8] | +0.4 [+0.2, +0.6] | -0.4 [-2.6, +1.2] | -0.6 [-2.5, +0.9] |
| model requests | 0.0 | 0.0 | +10.2 [+10.0, +10.5] | +10.2 [+10.0, +10.5] |
| tokens (in + out) | 0 | 0 | +8940 [+6112, +13182] | +8940 [+6112, +13182] |
| cost, USD | 0.0000 | 0.0000 | +0.0044 [+0.0035, +0.0055] | +0.0044 [+0.0035, +0.0055] |

## Failure drill: one agent down, then brought back

| agent down | structure | drills | valid breakdown aired | aired lines failing the Verifier · without it | roles from the model, of 4 (normal run) | lines aired (normal run) | waiting to be brought back | bring-back: model requests · tokens | after bring-back: roles from the model |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| analyst | single | 3 | 3 of 3 | 0 · 0 | 0.0 (4.0) | 25.3 [22.0, 30.0] (20.0 [16.0, 24.0]) | director ×3 | 1.7 [1.0, 2.0] · 11747 [7413, 14412] | 4.0 |
| analyst | crew | 3 | 3 of 3 | 0 · 0 | 3.0 (4.0) | 23.3 [23.0, 24.0] (23.7 [23.0, 24.0]) | analyst ×3 | 11.0 · 21627 [18651, 26286] | 4.0 |
| telestrator | single | 3 | 3 of 3 | 0 · 0 | 0.0 (4.0) | 25.3 [22.0, 30.0] (20.0 [16.0, 24.0]) | director ×3 | 1.7 [1.0, 2.0] · 11747 [7413, 14412] | 4.0 |
| telestrator | crew | 3 | 3 of 3 | 0 · 0 | 3.0 (4.0) | 23.7 [23.0, 24.0] (23.7 [23.0, 24.0]) | telestrator ×3 | 1.0 · 2129 [2048, 2200] | 4.0 |

## Sensitivity: free-text lines

The same four arms when the voices write their own sentences with slot placeholders (eval/free_text.py, the narration before anchoring); the crew's Director, Analyst and Telestrator replies are the anchored run's (the same requests).

| | A · single agent | B · single + Verifier | C · crew, no Verifier | D · crew (deployed) |
|---|---:|---:|---:|---:|
| breakdowns (moment × 4 audiences) | 1 | 1 | 1 | 1 |
| replies that fit their schema | 2/2 (100%) [34, 100] | 3/3 (100%) [44, 100] | 11/11 (100%) [74, 100] | 20/20 (100%) [84, 100] |
| agent roles from the model, of 4 | 4.00 | 4.00 | 4.00 | 4.00 |
| plans from the model that validate | 1/1 (100%) [21, 100] | 1/1 (100%) [21, 100] | 1/1 (100%) [21, 100] | 1/1 (100%) [21, 100] |
| plan error codes | none | none | none | none |
| lines aired per breakdown | 18.0 | 17.0 | 18.0 | 16.0 |
| lines per script: casual · analyst | 4.0 · 5.0 | 3.5 [3.0, 4.0] · 5.0 | 2.5 [2.0, 3.0] · 6.5 [6.0, 7.0] | 1.5 [0.0, 3.0] · 6.5 [6.0, 7.0] |
| aired lines the Verifier rejects (a number, id or term outside a verified slot) | 16/18 (89%) [67, 97] | 0/17 (0%) [0, 18] | 18/18 (100%) [82, 100] | 0/16 (0%) [0, 19] |
| **wrong facts aired**: ids and numbers no cited claim holds | 3 | 0 | 12 | 0 |
| claims cited by aired lines: supported · refuted · inconclusive · unknown | 40 · 0 · 0 · 0 | 20 · 0 · 0 · 0 | 32 · 0 · 0 · 0 | 16 · 0 · 0 · 0 |
| digits the model wrote in its own words: in replies · aired | 3 · 3 | 3 · 0 | 18 · 15 | 18 · 0 |
| lines dropped · rewrite rounds | 0 · 0 | 1 · 8 | 0 · 0 | 2 · 6 |
| headline claims spoken | 10/12 (83%) [55, 95] | 7/12 (58%) [32, 81] | 11/12 (92%) [65, 99] | 6/12 (50%) [25, 75] |
| lines restating an earlier one (dropped by tidy), per breakdown | 6.0 | 6.0 | 6.0 | 6.0 |
| groundedness (1–5), per script | 5.00 (min 5, 4 scripts) | 4.50 [4.00, 5.00] (min 4, 4 scripts) | 3.25 [2.00, 4.50] (min 2, 4 scripts) | 3.00 [2.00, 5.00] (min 2, 3 scripts) |
| seconds to air | 17.0 | 28.3 | – | – |
| model requests per breakdown (agent runs and tool rounds) | 3.0 | 5.0 | 12.0 | 21.0 |
| tokens per breakdown, in · out | 27433 · 1527 | 39906 · 2080 | 20130 · 1266 | 31568 · 2261 |
| cost per breakdown, USD | 0.0098 | 0.0156 | 0.0090 | 0.0136 |
| agent runs (tool rounds included) slower than the deployed 8 s step timeout | 1 of 2 | 1 of 3 | – | – |

| per breakdown | verification, single (A→B) | verification, crew (C→D) | collaboration, no Verifier (A→C) | collaboration, with it (B→D) |
|---|---:|---:|---:|---:|
| aired lines the Verifier rejects | -16.00 | -18.00 | +2.00 | 0.00 |
| wrong facts aired (ids and numbers no cited claim holds) | -3.00 | -12.00 | +9.00 | 0.00 |
| lines aired | -1.00 | -2.00 | 0.00 | -1.00 |
| headline claims spoken (share) | -0.25 | -0.42 | +0.08 | -0.08 |
| groundedness, mean of the 4 scripts | -0.50 | -0.25 | -1.75 | -1.50 |
| agent roles from the model, of 4 | 0.00 | 0.00 | 0.00 | 0.00 |
| plan from the model and valid (0/1) | 0.00 | 0.00 | 0.00 | 0.00 |
| replies that do not fit their schema | 0.00 | 0.00 | 0.00 | 0.00 |
| seconds to air | +11.3 | – | – | – |
| model requests | +2.0 | +9.0 | +9.0 | +16.0 |
| tokens (in + out) | +13026 | +12433 | -7564 | -8157 |
| cost, USD | +0.0059 | +0.0046 | -0.0008 | -0.0020 |

## Per moment

| moment | arm | roles from the model | plan | lines aired | aired with a violation | headline spoken | groundedness | seconds | requests | tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| blind_side_run-100 | A | 4 | agent | 16 | 0 | 8/12 | 5.00 | 12.7 | 2 | 17603 |
| blind_side_run-100 | B | 4 | agent | 16 | 0 | 8/12 | 5.00 | 13.3 | 2 | 17603 |
| blind_side_run-100 | C | 4 | agent | 23 | 0 | 12/12 | 5.00 | 14.6 | 12 | 26754 |
| blind_side_run-100 | D | 4 | agent | 23 | 0 | 12/12 | 5.00 | 15.0 | 12 | 26754 |
| blind_side_run-3 | A | 4 | agent | 24 | 0 | 12/12 | 5.00 | 13.9 | 1 | 7413 |
| blind_side_run-3 | B | 4 | agent | 24 | 0 | 12/12 | 5.00 | 15.0 | 1 | 7413 |
| blind_side_run-3 | C | 4 | agent | 24 | 0 | 12/12 | 5.00 | 14.5 | 12 | 26769 |
| blind_side_run-3 | D | 4 | agent | 24 | 0 | 12/12 | 5.00 | 15.2 | 12 | 26769 |
| corner_blind_side-0 | A | 4 | agent | 20 | 0 | 8/12 | 5.00 | 10.6 | 2 | 13417 |
| corner_blind_side-0 | B | 4 | agent | 20 | 0 | 8/12 | 5.00 | 10.7 | 2 | 13417 |
| corner_blind_side-0 | C | 4 | agent | 23 | 0 | 11/12 | 5.00 | 10.3 | 12 | 19108 |
| corner_blind_side-0 | D | 4 | agent | 23 | 0 | 11/12 | 5.00 | 10.3 | 12 | 19108 |
| far_post_finish-0 | A | 4 | template | 20 | 0 | 12/12 | 5.00 | 20.8 | 2 | 16033 |
| far_post_finish-0 | B | 4 | template | 20 | 0 | 12/12 | 5.00 | 21.0 | 2 | 16033 |
| far_post_finish-0 | C | 4 | agent | 23 | 0 | 11/12 | 5.00 | 15.5 | 12 | 23605 |
| far_post_finish-0 | D | 4 | agent | 23 | 0 | 11/12 | 5.00 | 16.0 | 12 | 23605 |
| press_escape-0 | A | 4 | agent | 16 | 0 | 8/12 | 5.00 | 12.6 | 2 | 14412 |
| press_escape-0 | B | 4 | agent | 16 | 0 | 8/12 | 5.00 | 13.0 | 2 | 14412 |
| press_escape-0 | C | 4 | agent | 24 | 0 | 10/12 | 5.00 | 11.7 | 12 | 20430 |
| press_escape-0 | D | 4 | agent | 24 | 0 | 10/12 | 5.00 | 12.0 | 12 | 20430 |
| press_escape-200 | A | 4 | agent | 14 | 0 | 10/12 | 5.00 | 12.6 | 2 | 14622 |
| press_escape-200 | B | 4 | agent | 14 | 0 | 10/12 | 5.00 | 13.3 | 2 | 14622 |
| press_escape-200 | C | 4 | agent | 24 | 0 | 10/12 | 5.00 | 14.2 | 12 | 20473 |
| press_escape-200 | D | 4 | agent | 24 | 0 | 10/12 | 5.00 | 14.4 | 12 | 20473 |
| blind_side_run-3 (free text) | A | 4 | agent | 18 | 16 | 10/12 | 5.00 | 17.0 | 3 | 28960 |
| blind_side_run-3 (free text) | B | 4 | agent | 17 | 0 | 7/12 | 4.50 | 28.3 | 5 | 41986 |
| blind_side_run-3 (free text) | C | 4 | agent | 18 | 18 | 11/12 | 3.25 | – | 12 | 21396 |
| blind_side_run-3 (free text) | D | 4 | agent | 16 | 0 | 6/12 | 3.00 | – | 21 | 33829 |

## Runs set aside

The first run of `far_post_finish` seed 0 hit a bug in this eval, fixed before the runs reported
above: the request cache answered a retry, which asks exactly what the failed first ask did,
with the first ask's cached tool round instead of a new call. The cache now keys the n-th
identical request of a run apart. Both runs of that moment were set aside (their records are in
`out/crew_vs_single/discarded/`) and run again from scratch. What they showed is kept here,
because it is the failure isolation the crew is for: in both structures the Analyst's `angle`
carried a number in both of its attempts, which the schema's `no_numbers` check rejects.

The first drills hit a second bug: Agent Framework gives every tool result a random id, so a
drill's tool round did not match the normal run's and was asked again, and the drill went on
from a new sample instead of the normal run's. Tool rounds are now keyed by the conversation
they continue; those drills (`out/crew_vs_single/discarded/drills/`) were run again. Their
model calls are counted in the total above.

`far_post_finish` seed 0 was run a third time after main gave the shot hero its own claims (the
look at the goal, the keeper it showed him, the placement) and with them the scan lens; the runs
on its earlier space-lens context are in `out/crew_vs_single/discarded/superseded/`. The other
five moments' contexts and prompts are byte-identical on that main, so their runs stand.

The set-aside runs of that moment, in order (first run, then the space-lens run):

- `far_post_finish-0` crew: roles from the model director, telestrator, narration; on templates analyst; replies rejected: angle: value_error ×2; 13 model calls.
- `far_post_finish-0` single: roles from the model none; on templates director, analyst, telestrator, narration; replies rejected: analyst.angle: value_error ×2; 3 model calls.
- `far_post_finish-0` crew: roles from the model director, telestrator, narration; on templates analyst; replies rejected: angle: value_error ×2; 14 model calls.
- `far_post_finish-0` single: roles from the model director, analyst, telestrator, narration; on templates none; replies rejected: analyst.angle: value_error ×1; 3 model calls.

## Method

- **Same inputs for every arm.** Each moment's `MomentContext` (its run, counterfactual, cards and
  verified claims), the same audiences, the same Foundry deployment, the same MCP tool server
  (`agents/mcp_server.py`, the Analyst's tools in the crew, the single agent's tools here), the
  same structured-output schemas, and the same code after the model.
- **The single agent** (eval/single_agent.py) is one call whose reply holds the crew's four step
  schemas side by side: `DirectorChoice`, the Analyst's enum-constrained choice, `PlanDraft`, and
  per audience and voice the narration draft. Its instructions are the crew's role instructions
  joined, and its prompt holds what the four prompts hold, except what one agent hands the next
  (findings, the play-by-play lines), which it writes itself. It runs inside the crew's workflow
  graph: the first executor makes the call, and the Analyst, Telestrator and narration executors
  take their part of its reply and apply the crew's own checks (claim filtering, plan validation
  and the template plan, compose, tidy). A rewrite round is one more call of the same agent for
  every rejected line, at most two rounds, as the crew's Narrator ⇄ Verifier loop.
- **Without the Verifier** (A, C) the first drafts air as written after tidy, each placeholder
  filled where it resolves and left as written where it does not. They are the drafts the
  Verifier checked in round 0 of B and D, so A and B, and C and D, compare the same samples; A
  and C are timed until the drafts and the plan were both ready.
- **Errors reaching the viewer** are aired lines the Verifier's rules reject (number, entity,
  placeholder, banned, lexicon, unsupported or stale claim, unbacked line), checked as in
  eval/narration_ablation.py; **made up** counts ids and numbers outside slots that no cited
  claim holds. **Digits written** are number tokens (digits, number words, Chinese numerals) in
  the model's own words: `reason`, `angle` and free-text lines, in every reply, valid or not;
  player ids are not numbers.
- **Schema validity** is per reply: the agent's final answer, parsed against the schema it was
  asked for (a tool-call round is not a reply). A timeout or error counts as a reply that does
  not fit.
- **Plan validity** is `agents.plan.validate_plan` on the plan the model wrote; an invalid plan
  is replaced by the template plan in every arm, and its reason codes are listed.
- **Groundedness** is `azure-ai-evaluation`'s `GroundednessEvaluator` (1–5) per aired script: the
  response is its lines, the context the rendered sentences of the claims they cite. Identical
  scripts are judged once.
- **Timeouts.** Every agent run gets 30 s and one retry, in every arm, so a slow
  reply is scored rather than replaced by its template; the deployed crew uses
  8 s per step, and the table counts the agent runs slower than that.
- **The drill** is the Producer desk's (`run_crew(down=...)`): the agent's model calls fail, the
  step retries once and runs on its template, and a workflow request waits for it to be brought
  back from the checkpoint. The single agent has one call, so taking down any of its roles takes
  the call down; bringing it back runs the call again. Requests that a drill makes exactly as the
  normal run made them are answered from the request cache (the same reply), so a drill costs
  only the requests it changes, and its times are not reported.
- **Intervals.** Per-breakdown means and paired differences resample moments (10,000 bootstrap
  draws, seed 0); pooled rates use Wilson intervals, which ignore that lines cluster within
  scripts and moments, so they are too narrow when lines of one script fail together.
- **Cost** is the agents' token usage as Foundry reports it, at the gpt-4.1-mini Global Standard
  list price, each request once; the judge's tokens are counted when the evaluator reports them.

## What this shows, and what it does not

- **What keeps wrong facts off the air is the anchored schema**, a choice either structure can
  make: the model picks verified claims and never writes the sentence. With it the Verifier
  had nothing to reject, in the crew or the single agent. It stays as the backstop for a model
  or prompt that writes its own words: with free-text lines it removed every rejected line and
  every wrong fact before air, in both structures, and that is verification's share.
- **What the crew adds is failure isolation**, not better lines. A failed role (an outage in the
  drill, or a reply the schema rejects, as the Analyst's `angle` with a number in it) costs the
  crew that role's part, while the other agents' work still airs and the role waits to be
  brought back; the single agent has one reply, so any failed part costs every part. Bringing a
  Telestrator back is one small request; bringing the Analyst back re-runs everything that read
  its findings, more than re-running the single agent. Short steps also fit the deployed
  8 s step timeout; the single agent's one long call does not, so it needs a
  longer one and a stuck call is noticed later.
- It does not show that the crew writes better. Wrong facts and groundedness are the same; the
  crew's plans validated a little more often and it spoke more of its headline claims, but on
  six moments neither difference is clear of zero, and its scripts are also longer. With free
  text its separate voices wrote more wrong facts, not fewer. It is not faster, and it makes
  about six times the model requests, 1.7 times the tokens and twice the cost.

## Limitations

- A handful of moments, one sample per arm and moment, one model. The intervals are wide; a
  difference whose interval spans zero is not shown to exist.
- The free-text sensitivity is one moment (four scripts per arm): an illustration, not a rate.
  Its crew run replays the anchored run's Director, Analyst and Telestrator replies, so its
  latency is not reported.
- A reply that Foundry's client rejects while parsing (a field that fails its check) raises
  before its usage is returned: its tokens are not counted, so the cost is a slight
  underestimate, and its numbers are read from the validation error.
- The single agent is our design: the crew's schemas and instructions joined. A different
  single-agent prompt could do better or worse; it gets every input the crew gets, the same
  tools and the same deterministic code, so what differs is the decomposition into agents.
- The moments are the hero moments: the crew breaks down only a scenario hero's moment (its
  claims are built for it), so match-1's other lensed moments have no breakdown to compare. The
  sample is the three hero moments the site serves (match-1's hero possessions), the shot hero
  on main and held-out seeds of two of them. The hero scenarios that reached main after the
  sample was fixed (`cutback_scan`, `keeper_switch`, `screened_shot`) are not in it.
- Anchored lines are the crew's design, and both structures use them here. They leave the
  Verifier little to catch; the free-text sensitivity and eval/narration_ablation.py show what it
  catches when the voices write their own words.
- Latency depends on the deployment's load and the rate limit at the time of the run.
