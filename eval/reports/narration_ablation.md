# Narration ablation — free text vs anchored lines (SPEC 6)

Model: `gpt-4.1-mini` on Microsoft Foundry, for narration and as the groundedness judge. Evaluator: `azure-ai-evaluation` 1.18.9 `GroundednessEvaluator`. Date: 2026-10-20.
Seeds: 3, 100, 101, 102, 103 (5) of `blind_side_run`, the hero moment (`m:decision_after_scan:H8:0075` on the first). Audiences: casual, analyst × en, zh.
Model calls: 150 (70 free-text narration, 40 anchored narration, 40 groundedness).

- **Free text:** 58 of 66 (88%) first-draft lines failed the Verifier, with 47 made-up ids or numbers; 18 of 20 scripts needed a rewrite. 60 lines aired (15 in the model's own words, 4 with broken count words, 2 restating another), 6 dropped; groundedness 4.90.
- **Anchored:** 0 of 111 (0%) first-draft lines failed the Verifier, with 0 made-up ids or numbers; 0 of 20 scripts needed a rewrite. 111 lines aired (0 in the model's own words, 0 with broken count words, 0 restating another), 0 dropped; groundedness 5.00.

## Result

| | free text | anchored |
|---|---:|---:|
| scripts (seed × audience) | 20 | 20 |
| model calls (narration, rewrites, retries) | 70 | 40 |
| lines drafted | 120 | 111 |
| … restating an earlier line (dropped by tidy) | 54 | 0 |
| lines failing the Verifier on the first draft | 58 of 66 (88%) | 0 of 111 (0%) |
| violations on the first draft | 131 | 0 |
| ids and numbers made up (no cited claim holds them) | 47 | 0 |
| scripts rewritten · rewrite rounds | 18 · 24 | 0 · 0 |
| lines aired | 60 | 111 |
| … restating an earlier aired line | 2 | 0 |
| … in the model's own words (not a claim's sentence) | 15 | 0 |
| … with a count word that does not agree (“once times”, 1次次) | 4 | 0 |
| lines dropped | 6 | 0 |
| headline claims spoken | 46 of 60 (77%) | 58 of 60 (97%) |
| groundedness, mean (min) | 4.90 (4) | 5.00 (5) |
| scripts scored below 5 | 2 | 0 |
| scripts where a voice fell back to its template | 0 | 0 |

### Free text, per audience

| persona · language | scripts | failing first draft | number | entity | placeholder | banned | lexicon | unsupported / stale | unbacked line | made up | rewrite rounds | aired | aired repeats | dropped | groundedness |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| casual · en | 5 | 11 of 11 (100%) | 0 | 19 | 0 | 0 | 0 | 0 | 0 | 8 | 7 | 10 | 0 | 1 | 4.80 |
| casual · zh | 5 | 12 of 12 (100%) | 0 | 18 | 0 | 0 | 0 | 0 | 0 | 6 | 5 | 12 | 2 | 0 | 4.80 |
| analyst · en | 5 | 23 of 23 (100%) | 19 | 48 | 0 | 0 | 0 | 0 | 0 | 26 | 9 | 18 | 0 | 5 | 5.00 |
| analyst · zh | 5 | 12 of 20 (60%) | 9 | 18 | 0 | 0 | 0 | 0 | 0 | 7 | 3 | 20 | 0 | 0 | 5.00 |
| all | 20 | 58 of 66 (88%) | 28 | 103 | 0 | 0 | 0 | 0 | 0 | 47 | 24 | 60 | 2 | 6 | 4.90 |

### Anchored, per audience

| persona · language | scripts | failing first draft | number | entity | placeholder | banned | lexicon | unsupported / stale | unbacked line | made up | rewrite rounds | aired | aired repeats | dropped | groundedness |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| casual · en | 5 | 0 of 16 (0%) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 16 | 0 | 0 | 5.00 |
| casual · zh | 5 | 0 of 20 (0%) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 20 | 0 | 0 | 5.00 |
| analyst · en | 5 | 0 of 35 (0%) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 35 | 0 | 0 | 5.00 |
| analyst · zh | 5 | 0 of 40 (0%) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 5.00 |
| all | 20 | 0 of 111 (0%) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 111 | 0 | 0 | 5.00 |

## Free-text failures, verbatim

Quoted with every placeholder that resolves filled in: what would have aired with no Verifier. `Code` is the line as the voice wrote it.

**Made up: ids and numbers no cited claim holds** (34 lines)

- seed 3 · casual/en · pbp: “Without that look, H8 would have passed to H7.” — made up: H7. The claim says: “Without that look, H8 would have passed to H4.”
- seed 3 · casual/zh · pbp: “如果没有那一眼，H8会把球传给A5。” — made up: A5. The claim says: “如果没有那一眼，H8会把球传给H4。”
- seed 3 · analyst/en · pbp: “H8 checked his shoulder before the ball reached him, scanning 3 times in the 2 seconds prior to reception.” — made up: 3. The claim says: “H8 checked his shoulder before the ball reached him.” “H8 scanned once in the 2 seconds before receiving.”
- seed 3 · analyst/en · color: “H8's multiple scans before receiving the ball allowed him to integrate spatial and temporal information despite some misestimation in A5's position.” — made up: A5. The claim says: “H8 scanned once in the 2 seconds before receiving.” “When he played the pass, H8's picture of H9 was off by 0.5 metres.”
- seed 3 · analyst/en · pbp: “When he played the pass, H8's picture of A5 was off by 1.2 metres; A5's run was on H8's blind side.” — made up: A5, 1.2, A5. The claim says: “When he played the pass, H8's picture of H9 was off by 0.5 metres.” “H9's run was on H8's blind side.”
- seed 3 · analyst/en · pbp: “While the ball travelled to H8, A5 opened up 2.5 metres on his marker and was unmarked when H8 released the ball.” — made up: 2.5. The claim says: “While the ball travelled to H8, H9 opened up 6.7 metres on A5.” “H9 was unmarked when H8 released the ball.”

**Literal braces: a placeholder that does not render:** none in this run; the first run (M0) had `{window_s|second}`.

**Broken grammar** (6 lines)

- seed 3 · analyst/zh, aired: “接球前2秒内，H8扫视了1次次。”
- seed 100 · analyst/en, aired: “The run was on the player's blind side and opened a 6.6 metres-metre gap on the marker during ball transit.”
- seed 102 · analyst/en, aired: “He scanned once times in the 2 seconds before reception.”
- seed 103 · analyst/en, aired: “H8 scanned 1 times in the 2 before receiving.”
- seed 3 · analyst/zh, first draft, rejected: “接球前2秒内，H8扫视了1次次。”

**Aired in the model's own words (passed the Verifier)** (15 lines)

- seed 3 · analyst/en (groundedness 5): “H8's picture of H9 was off by 0.5 metres when he played the pass.”
- seed 3 · analyst/zh (groundedness 5): “接球前2秒内，H8扫视了1次次。”
- seed 101 · casual/en (groundedness 4): “The player checked his shoulder before the ball reached him, noticing a teammate moving without a marker on his blind side.”
- seed 102 · casual/zh (groundedness 4): “球到之前，有球员先回头看了一眼。”
- seed 3 · analyst/en (groundedness 5): “Without that look, H8 would have passed to H4 instead; that look was worth 0.11 in expected threat.”
- seed 100 · analyst/en (groundedness 5): “The run was on the player's blind side and opened a 6.6 metres-metre gap on the marker during ball transit.”
- seed 101 · analyst/en (groundedness 5): “While the ball travelled to H8, the runner opened up 7.6 metres on his marker and remained unmarked.”
- seed 101 · analyst/en (groundedness 5): “Without that look, H8 would have passed safely to H4; that glance was worth 0.09 in expected threat.”

**Restating a claim an earlier line stated (dropped by tidy)** (54 lines)

- seed 3 · casual/en · color: `H8 glanced back and saw H9 making a run on his blind side, which changed what he thought was possible.`
- seed 3 · casual/zh · color: `没有那一眼，H8会传给A5，那样比较保守。`
- seed 3 · analyst/en · color: `A5's unmarked status when H8 released the ball indicates the scanning partially informed the pass choice.`
- seed 3 · analyst/zh · color: `球到之前，{player}回头看了一眼，确认了身后无盲区威胁。`

**Aired twice: a rewrite restating a line that already airs** (2 lines)

- seed 3 · casual/zh: “球到之前，H8先回头看了一眼。” / “球到之前，H8先回头看了一眼。” / “如果没有那一眼，H8会把球传给H4。”
- seed 102 · casual/zh: “球到之前，有球员先回头看了一眼。” / “球到之前，H8先回头看了一眼。” / “如果没有那一眼，他会把球传给另一个队友。”

**Aired, but scored below 5 for groundedness** (2 scripts)

- seed 101 · casual/en, groundedness 4: “H8 checked his shoulder before the ball reached him.” / “The player checked his shoulder before the ball reached him, noticing a teammate moving without a marker on his blind side.” / “Without that look, H8 would have passed to H4.”
  - judge: The response repeats the first and last sentences from the context verbatim, which are fully accurate and grounded. The middle sentence in the response adds an interpretation that the player noticed a teammate moving without a marker on his blind side. This detail is not explicitly stated in the context, which only …
- seed 102 · casual/zh, groundedness 4: “球到之前，有球员先回头看了一眼。” / “球到之前，H8先回头看了一眼。” / “如果没有那一眼，他会把球传给另一个队友。”
  - judge: The response repeats the key information from the context that before the ball arrived, H8 looked back. It also adds that if H8 had not looked back, he would have passed the ball to another teammate, which aligns with the context stating H8 would have passed to H4. The response is accurate but slightly less specific …

## Method

- **Free text** is the narration the crew had before anchored lines (git `d975277^`), kept as an
  eval-only mode in `eval/free_text.py`: each voice writes its own sentences with slot
  placeholders and lists the claims each line states (`NarrationDraft`). The model sees each
  claim's template and slot names, not the values. **Anchored** is what ships: each line is a
  supported claim id and/or an allowed connective, enums in the JSON schema, and a claim speaks
  its verified template.
- Same moment, seeds, audiences and findings for both: only the two narration voices call the
  model; the Director, Analyst and Telestrator use their templates. After narration both run the
  shipped crew unchanged: tidy (drops lines restating a claim, gives bare placeholders their
  template's form), the Verifier, at most two rewrites by the voice that wrote the line, then
  drops. Tidy came with the anchoring commit, so free text here is better off than in the first
  run, which had no tidy.
- Narration calls get 30 s and one retry (the crew uses 8 s), so slow replies are scored rather
  than replaced by templates; "a voice fell back" counts scripts where a template took over.
- **Verifier violations** are counted on the first draft after tidy, per kind; a line can have
  several. The Verifier stops at the first failing stage (an unsupported claim hides the
  placeholder and caption checks; a bad placeholder hides the caption checks). A player id
  written outside a slot (`H8`) counts once, as an entity: the Verifier also rejects its digit as
  a number, and in zh its entity check misses an id next to a Chinese character (`\b` treats CJK
  as word characters), so ids are matched here with ASCII-only boundaries.
- **Made up** counts the ids and numbers a line writes outside its slots that no slot of its
  cited claims holds (numbers within 5%). An id or number that exists in the claims but stands in
  the wrong role is not counted, so this is a lower bound on wrong facts.
- **Aired lines** are scored after the rewrites: whether a line restates claims an earlier aired
  line already stated (or repeats its words), whether it is the model's own words rather than a
  claim's sentence, a connective, or a connective followed by a claim's sentence, and whether a
  count word disagrees with its value or unit (a pattern match: neither the Verifier nor the
  judge checks grammar).
- **Groundedness** is `azure-ai-evaluation`'s `GroundednessEvaluator` (1–5, pass at 3) on each
  aired script: the response is its lines, the context the rendered sentences of the claims they
  cite. Judged by the same Foundry deployment, keyless (`az login`).

## What this shows, and what it does not

- It shows how much the Verifier has to catch when the model writes its own sentences, what airs
  once it has, and whether that is grounded in the claims. Anchored lines are verified templates,
  so their groundedness is close to 5 by construction: the ceiling free text is compared against,
  not evidence on its own.
- The Verifier does not judge meaning. A free-text line that passes it can still say something
  its claims do not; groundedness and the own-words count are the checks for that, and the judge
  reads whole scripts, so one ungrounded line in a long script can still score 4 or 5.
- It compares the two narration designs as built, prompt and schema together. Besides the enum
  schema, the anchored prompt lists the remaining claims and tells the co-commentator not to
  repeat the play-by-play's claims; the pre-anchoring prompt did neither, which shows in the
  restated-line count.
- One moment type, one model, a handful of seeds: the counts are evidence for this crew on this
  moment, not a general rate. The judge is the same model that wrote the free text, so it may be
  lenient with its own phrasing.
- It does not measure how the lines sound. Anchored scripts repeat template wording; free text
  can be livelier when it is right.
- Rewrites are not tidied again, in either mode: a rewritten line can restate a claim another
  line already airs; "restating an earlier aired line" counts it.
