# Persona distinctness (SPEC 6, "Persona specs")

How different the five audiences' breakdowns of one hero moment are, in what is said and in what is shown. Written by `uv run python -m eval.persona_distinctness`.

- **Moments:** the served hero moments: blind_side_run-3 (a look before a pass), press_escape-0 (a pass under pressure), far_post_finish-11 (a look before a shot) and corner_blind_side-0 (a marker's look). Every persona × `en`, `zh`: 40 scripts.
- **Crew:** offline, every step on its template, so the numbers are reproducible and cost no model call. A model picks among the same claims under the same persona rules (the schema enum, the Verifier's script check and `repair`), so the template scripts are what the rules allow at their tightest; model runs are measured apart when given (`--runs`).
- **Jaccard:** of the claim ids two personas' scripts cite, per moment and language, averaged over the 10 pairs × 8. Gate: mean ≤ 0.3 (why: `MAX_MEAN_JACCARD` in the script). **Length:** words in `en`, characters in `zh`. **Numbers:** numeric slots the cited claims say. **Jargon:** a line saying expected threat, pressing intensity, scan(ned), the space the opponents controlled, a chance or probability, or a belief error (`JARGON`).

## Before and after

| | before (main 7c424f3d + #191) | after (this branch) |
|---|---:|---:|
| mean pairwise claim Jaccard (gate ≤ 0.3) | 0.34 | 0.16 |
| closest pair of personas, mean Jaccard (gate ≤ 0.5) | casual / player fan 0.71 | player fan / audio description 0.30 |
| persona pairs whose first line differs (gate 100%) | 70% | 100% |
| different plans among the 5 personas of a moment, fewest (gate 5) | 1 | 5 |
| scripts within their persona's spec and rules | 8 of 40 | 40 of 40 |
| scripts whose every line verifies again | 40 of 40 | 40 of 40 |
| numbers in text a model wrote | 0 | 0 |

**Gate: passed.**

## before (main 7c424f3d + #191)

| | |
|---|---|
| mean pairwise claim Jaccard | 0.34 |
| persona pairs whose first line differs | 70% |
| scripts within their persona's spec | 8 of 40 |
| scripts whose every line verifies again | 40 of 40 |
| numbers in text a model wrote | 0 |

Per persona (all four moments, both languages):

| persona | lines (min–max, mean) | words en | chars zh | numbers (mean, max) | lines with a number | jargon lines | jargon | out of spec |
|---|---|---:|---:|---|---:|---:|---|---:|
| casual | 4–6, 5.2 | 48 | 73 | 0.8, 2 | 14% | 0% | – | 8 of 8 |
| analyst | 7–9, 7.8 | 91 | 138 | 7.0, 9 | 74% | 42% | belief error, pitch control, pressing, probability, scan, xT | 8 of 8 |
| player fan | 5–6, 5.2 | 53 | 79 | 1.5, 3 | 29% | 5% | belief error | 8 of 8 |
| coach | 4–5, 4.5 | 60 | 90 | 4.5, 6 | 83% | 44% | belief error, pressing, probability, scan, xT | 8 of 8 |
| audio description | 5–6, 5.8 | 65 | 94 | 1.2, 2 | 22% | 0% | – | 0 of 8 |

Mean claim Jaccard per pair:

| | analyst | player fan | coach | audio description |
|---|---:|---:|---:|---:|
| casual | 0.16 | 0.71 | 0.17 | 0.38 |
| analyst |  | 0.27 | 0.56 | 0.23 |
| player fan |  |  | 0.32 | 0.40 |
| coach |  |  |  | 0.18 |

The plan each persona plays (blind_side_run-3):

| persona | camera beats | overlays | on screen in the first 5 s |
|---|---|---|---|
| casual | pov → split | belief ghost, counterfactual ghost, scan marker, vision | zone vision, camera pov, pov ×0.5, scan marker, ghost belief, camera split |
| analyst | pov → split | belief ghost, counterfactual ghost, scan marker, vision | zone vision, camera pov, pov ×0.5, scan marker, ghost belief, camera split |
| player fan | pov → split | belief ghost, counterfactual ghost, scan marker, vision | zone vision, camera pov, pov ×0.5, scan marker, ghost belief, camera split |
| coach | pov → split | belief ghost, counterfactual ghost, scan marker, vision | zone vision, camera pov, pov ×0.5, scan marker, ghost belief, camera split |
| audio description | pov → split | belief ghost, counterfactual ghost, scan marker, vision | zone vision, camera pov, pov ×0.5, scan marker, ghost belief, camera split |

blind_side_run-3, `en`, side by side:

- **casual** (5 lines, 42 words, 0 numbers)
  1. What did he see?
  2. J. Ferriday checked his shoulder before the ball reached him.
  3. N. Varnhall's run was on J. Ferriday's blind side.
  4. Without that look, J. Ferriday would have passed to K. Annersley.
  5. N. Varnhall took the pass from J. Ferriday.
- **analyst** (7 lines, 74 words, 7 numbers)
  1. What did he see?
  2. J. Ferriday scanned once in the 2 seconds before receiving.
  3. In the 1 second before receiving, J. Ferriday saw 61% of the space the opponents controlled.
  4. When he played the pass, J. Ferriday's picture of N. Varnhall was off by 0.3 metres.
  5. J. Ferriday found N. Varnhall with a 38-metre pass.
  6. Without that look, J. Ferriday would have passed to K. Annersley.
  7. That look was worth 0.17 in expected threat.
- **player fan** (5 lines, 49 words, 1 numbers)
  1. What did he see?
  2. J. Ferriday checked his shoulder before the ball reached him.
  3. When he played the pass, J. Ferriday's picture of N. Varnhall was off by 0.3 metres.
  4. Without that look, J. Ferriday would have passed to K. Annersley.
  5. N. Varnhall took the pass from J. Ferriday.
- **coach** (4 lines, 50 words, 4 numbers)
  1. J. Ferriday scanned once in the 2 seconds before receiving.
  2. J. Ferriday had last checked his shoulder 0.8 seconds before the ball arrived.
  3. When he played the pass, J. Ferriday's picture of N. Varnhall was off by 0.3 metres.
  4. Without that look, J. Ferriday would have passed to K. Annersley.
- **audio description** (6 lines, 68 words, 1 numbers)
  1. J. Ferriday received the ball in the opponents' half, right of centre.
  2. N. Varnhall's run was on J. Ferriday's blind side.
  3. Before the ball reached him, J. Ferriday looked over his right shoulder.
  4. When J. Ferriday looked over his shoulder before the ball arrived, he saw N. Varnhall.
  5. J. Ferriday found N. Varnhall with a 38-metre pass.
  6. Without that look, J. Ferriday would have passed to K. Annersley.

Scripts outside their spec:

- m:decision_after_scan:H8:0075 casual en: 5 lines, at most 3 for casual; start with the opener "Watch his head."; 5 lines, spec 2–3
- m:decision_after_scan:H8:0075 casual zh: 5 lines, at most 3 for casual; start with the opener "注意看他回头。"; 5 lines, spec 2–3
- m:decision_after_scan:H8:0075 analyst en: missing the options' chances: what he gave his pass or shot against what it was: cite one of pass_success, cf_pass_success; start with a number: the first line cites a claim that says one
- m:decision_after_scan:H8:0075 analyst zh: missing the options' chances: what he gave his pass or shot against what it was: cite one of pass_success, cf_pass_success; start with a number: the first line cites a claim that says one
- m:decision_after_scan:H8:0075 player fan en: not for player_fan: belief_error, cf_pass, runner_received; missing his decision: cite one of pass_to_runner; 5 lines, at most 4 for player_fan; start with the opener "Lovely from him."; 5 lines, spec 3–4; 1 jargon lines, spec ≤ 0
- m:decision_after_scan:H8:0075 player fan zh: not for player_fan: belief_error, cf_pass, runner_received; missing his decision: cite one of pass_to_runner; 5 lines, at most 4 for player_fan; start with the opener "这一下漂亮！"; 5 lines, spec 3–4; 1 jargon lines, spec ≤ 0
- m:decision_after_scan:H8:0075 coach en: not for coach: belief_error, scans_before_reception; 4 numbers, at most 3 for coach; start with the opener "Coaching point."; end with the cue "Teach it: check your shoulder before the ball arrives."; 2 jargon lines, spec ≤ 1
- m:decision_after_scan:H8:0075 coach zh: not for coach: belief_error, scans_before_reception; 4 numbers, at most 3 for coach; start with the opener "教学要点。"; end with the cue "要教的就是这一点：球到之前，先回头看。"; 3 jargon lines, spec ≤ 1
- m:marker_scan:H5:0121 casual en: not for casual: marker_scan; 2 numbers, at most 1 for casual; 6 lines, at most 3 for casual; start with the opener "Watch his head."; 6 lines, spec 2–3; 65 words, spec ≤ 45
- m:marker_scan:H5:0121 casual zh: not for casual: marker_scan; 2 numbers, at most 1 for casual; 6 lines, at most 3 for casual; start with the opener "注意看他回头。"; 6 lines, spec 2–3; 92 characters, spec ≤ 80
- m:marker_scan:H5:0121 analyst en: 9 lines, at most 7 for analyst; start with a number: the first line cites a claim that says one; 9 lines, spec 5–7
- m:marker_scan:H5:0121 analyst zh: 9 lines, at most 7 for analyst; start with a number: the first line cites a claim that says one; 9 lines, spec 5–7
- m:marker_scan:H5:0121 player fan en: not for player_fan: cf_lost_runner, seen_in_scan; 5 lines, at most 4 for player_fan; start with the opener "Lovely from him."; 5 lines, spec 3–4; 64 words, spec ≤ 60
- m:marker_scan:H5:0121 player fan zh: not for player_fan: cf_lost_runner, seen_in_scan; 5 lines, at most 4 for player_fan; start with the opener "这一下漂亮！"; 5 lines, spec 3–4
- m:marker_scan:H5:0121 coach en: not for coach: cf_value; 5 numbers, at most 3 for coach; start with the opener "Coaching point."; end with the cue "Teach it: find your man before the ball is played."
- m:marker_scan:H5:0121 coach zh: not for coach: cf_value; 5 numbers, at most 3 for coach; start with the opener "教学要点。"; end with the cue "要教的就是这一点：球传出之前，先找到你盯的人。"
- m:decision_after_scan:H9:0198 casual en: not for casual: scan_at_goal; 6 lines, at most 3 for casual; start with the opener "Watch his head."; 6 lines, spec 2–3; 49 words, spec ≤ 45
- m:decision_after_scan:H9:0198 casual zh: not for casual: scan_at_goal; 6 lines, at most 3 for casual; start with the opener "注意看他这一抬头。"; 6 lines, spec 2–3; 84 characters, spec ≤ 80
- m:decision_after_scan:H9:0198 analyst en: 8 lines, at most 7 for analyst; start with a number: the first line cites a claim that says one; 8 lines, spec 5–7
- m:decision_after_scan:H9:0198 analyst zh: 8 lines, at most 7 for analyst; start with a number: the first line cites a claim that says one; 8 lines, spec 5–7
- m:decision_after_scan:H9:0198 player fan en: not for player_fan: cf_shot, keeper_seen_in_scan; 6 lines, at most 4 for player_fan; start with the opener "Lovely from him."; 6 lines, spec 3–4
- m:decision_after_scan:H9:0198 player fan zh: not for player_fan: cf_shot, keeper_seen_in_scan; 6 lines, at most 4 for player_fan; start with the opener "这一下漂亮！"; 6 lines, spec 3–4
- m:decision_after_scan:H9:0198 coach en: not for coach: cf_shot_value, scans_before_reception; 6 numbers, at most 3 for coach; start with the opener "Coaching point."; end with the cue "Teach it: look at the goal before the ball arrives."; 2 jargon lines, spec ≤ 1
- m:decision_after_scan:H9:0198 coach zh: not for coach: cf_shot_value, scans_before_reception; 6 numbers, at most 3 for coach; start with the opener "教学要点。"; end with the cue "要教的就是这一点：球到之前，先抬头看球门。"; 3 jargon lines, spec ≤ 1
- m:pressed_decision:H4:0066 casual en: 4 lines, at most 3 for casual; 4 lines, spec 2–3
- m:pressed_decision:H4:0066 casual zh: 4 lines, at most 3 for casual; 4 lines, spec 2–3
- m:pressed_decision:H4:0066 analyst en: missing the options' chances: what he gave his pass or shot against what it was: cite one of pass_success; start with a number: the first line cites a claim that says one
- m:pressed_decision:H4:0066 analyst zh: missing the options' chances: what he gave his pass or shot against what it was: cite one of pass_success; start with a number: the first line cites a claim that says one
- m:pressed_decision:H4:0066 player fan en: not for player_fan: cf_carry_lost, runner_received; missing his decision: cite one of pass_to_runner; 5 lines, at most 4 for player_fan; start with the opener "Lovely from him."; 5 lines, spec 3–4
- m:pressed_decision:H4:0066 player fan zh: not for player_fan: cf_carry_lost, runner_received; missing his decision: cite one of pass_to_runner; 5 lines, at most 4 for player_fan; start with the opener "这一下漂亮！"; 5 lines, spec 3–4
- m:pressed_decision:H4:0066 coach en: not for coach: cf_value, pressure_at_pass; start with the opener "Coaching point."; end with the cue "Teach it: move the ball before the press arrives."; 2 jargon lines, spec ≤ 1
- m:pressed_decision:H4:0066 coach zh: not for coach: cf_value, pressure_at_pass; start with the opener "教学要点。"; end with the cue "要教的就是这一点：对手逼上来之前，先把球传出去。"; 2 jargon lines, spec ≤ 1

## after (this branch)

| | |
|---|---|
| mean pairwise claim Jaccard | 0.16 |
| persona pairs whose first line differs | 100% |
| scripts within their persona's spec | 40 of 40 |
| scripts whose every line verifies again | 40 of 40 |
| numbers in text a model wrote | 0 |

Per persona (all four moments, both languages):

| persona | lines (min–max, mean) | words en | chars zh | numbers (mean, max) | lines with a number | jargon lines | jargon | out of spec |
|---|---|---:|---:|---|---:|---:|---|---:|
| casual | 3–3, 3.0 | 34 | 55 | 0.0, 0 | 0% | 0% | – | 0 of 8 |
| analyst | 5–6, 5.8 | 81 | 116 | 7.5, 10 | 96% | 70% | belief error, pitch control, pressing, probability, scan, xT | 0 of 8 |
| player fan | 3–4, 3.8 | 32 | 52 | 1.8, 2 | 47% | 0% | – | 0 of 8 |
| coach | 4–4, 4.0 | 52 | 86 | 1.8, 2 | 44% | 0% | – | 0 of 8 |
| audio description | 5–6, 5.8 | 66 | 96 | 1.5, 2 | 26% | 0% | – | 0 of 8 |

Mean claim Jaccard per pair:

| | analyst | player fan | coach | audio description |
|---|---:|---:|---:|---:|
| casual | 0.03 | 0.09 | 0.20 | 0.30 |
| analyst |  | 0.04 | 0.14 | 0.13 |
| player fan |  |  | 0.04 | 0.30 |
| coach |  |  |  | 0.30 |

The plan each persona plays (blind_side_run-3):

| persona | camera beats | overlays | on screen in the first 5 s |
|---|---|---|---|
| casual | pov → broadcast | belief ghost, counterfactual ghost | camera pov, pov ×0.5, ghost belief, camera broadcast |
| analyst | tactical | belief ghost, counterfactual ghost, options, pitch_control, scan marker, vision | zone vision, zone pitch_control, zone options, camera tactical, pov ×0.5, scan marker, ghost belief |
| player fan | pov → player_lock | scan marker, vision | zone vision, camera pov, pov ×0.5, scan marker, camera player_lock |
| coach | split | belief ghost, counterfactual ghost, options, scan marker, vision | zone vision, zone options, camera split, pov ×0.5, scan marker, ghost belief, ghost counterfactual |
| audio description | broadcast |  | camera broadcast |

blind_side_run-3, `en`, side by side:

- **casual** (3 lines, 37 words, 0 numbers)
  1. Watch his head. When J. Ferriday looked over his shoulder before the ball arrived, he saw N. Varnhall.
  2. N. Varnhall took the pass from J. Ferriday.
  3. Without that look, J. Ferriday would have passed to K. Annersley.
- **analyst** (6 lines, 87 words, 10 numbers)
  1. J. Ferriday scanned once in the 2 seconds before receiving.
  2. In the 1 second before receiving, J. Ferriday saw 61% of the space the opponents controlled.
  3. When he played the pass, J. Ferriday's picture of N. Varnhall was off by 0.3 metres.
  4. J. Ferriday thought the pass to N. Varnhall had a 0.67 chance of arriving; it was 0.85.
  5. Without that look, J. Ferriday thought the pass to N. Varnhall had a 0.02 chance of arriving; it was 0.85.
  6. That look was worth 0.17 in expected threat.
- **player fan** (4 lines, 36 words, 2 numbers)
  1. Lovely from him. Before the ball reached him, J. Ferriday looked over his right shoulder.
  2. J. Ferriday found N. Varnhall with a 39-metre pass.
  3. J. Ferriday's pass left his foot at 76.0 km/h.
  4. What a player.
- **coach** (4 lines, 44 words, 1 numbers)
  1. Coaching point. J. Ferriday had last checked his shoulder 0.8 seconds before the ball arrived.
  2. N. Varnhall's run was on J. Ferriday's blind side.
  3. Without that look, J. Ferriday would have passed to K. Annersley.
  4. Teach it: check your shoulder before the ball arrives.
- **audio description** (6 lines, 68 words, 1 numbers)
  1. J. Ferriday received the ball in the opponents' half, right of centre.
  2. N. Varnhall's run was on J. Ferriday's blind side.
  3. Before the ball reached him, J. Ferriday looked over his right shoulder.
  4. When J. Ferriday looked over his shoulder before the ball arrived, he saw N. Varnhall.
  5. J. Ferriday found N. Varnhall with a 39-metre pass.
  6. Without that look, J. Ferriday would have passed to K. Annersley.

## Model sample: gpt-4.1-mini on this branch, 2 moments × 5 personas × en, zh (2026-10-22; ran before the coach palette was narrowed and before the order and cue repairs, scored against today's rules)

| | |
|---|---|
| mean pairwise claim Jaccard | 0.19 |
| persona pairs whose first line differs | 100% |
| scripts within their persona's spec | 14 of 20 |
| scripts whose every line verifies again | 20 of 20 |
| numbers in text a model wrote | 0 |

| persona | lines (min–max, mean) | words en | chars zh | numbers (mean, max) | lines with a number | jargon lines | jargon | out of spec |
|---|---|---:|---:|---|---:|---:|---|---:|
| casual | 3–3, 3.0 | 40 | 65 | 0.0, 0 | 0% | 0% | – | 0 of 4 |
| analyst | 6–7, 6.8 | 93 | 138 | 10.2, 11 | 96% | 85% | belief error, pitch control, pressing, probability, scan, xT | 0 of 4 |
| player fan | 3–4, 3.5 | 36 | 60 | 1.2, 2 | 36% | 0% | – | 0 of 4 |
| coach | 4–5, 4.8 | 56 | 101 | 1.0, 1 | 21% | 0% | – | 4 of 4 |
| audio description | 6–6, 6.0 | 66 | 95 | 0.8, 1 | 12% | 0% | – | 2 of 4 |

| | analyst | player fan | coach | audio description |
|---|---:|---:|---:|---:|
| casual | 0.03 | 0.18 | 0.60 | 0.30 |
| analyst |  | 0.00 | 0.11 | 0.02 |
| player fan |  |  | 0.12 | 0.32 |
| coach |  |  |  | 0.27 |

## Model sample: gpt-4.1-mini before this change (crew_vs_single's cached runs, casual and analyst, 2026-10-21)

| | |
|---|---|
| mean pairwise claim Jaccard | 0.53 |
| persona pairs whose first line differs | 60% |
| scripts within their persona's spec | 0 of 24 |
| scripts whose every line verifies again | 24 of 24 |
| numbers in text a model wrote | 0 |

| persona | lines (min–max, mean) | words en | chars zh | numbers (mean, max) | lines with a number | jargon lines | jargon | out of spec |
|---|---|---:|---:|---|---:|---:|---|---:|
| casual | 3–5, 4.0 | 45 | 66 | 2.1, 4 | 46% | 29% | pressing, probability, xT | 12 of 12 |
| analyst | 6–8, 7.8 | 89 | 124 | 5.2, 7 | 55% | 31% | belief error, pressing, probability, scan, xT | 12 of 12 |

| | analyst | player fan | coach | audio description |
|---|---:|---:|---:|---:|
| casual | 0.53 | – | – | – |
| analyst |  | – | – | – |
| player fan |  |  | – | – |
| coach |  |  |  | – |
