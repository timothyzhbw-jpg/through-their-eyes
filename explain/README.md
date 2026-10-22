# explain/ — moments, lenses, claims and the Verifier (SPEC 5)

Turns a finished sim run into what can be said about it, and checks every word before it airs.
Rule-based detectors find the moments; each moment gets three candidate explanations (lenses),
scored by re-simulation; the facts behind it are written as claims, each with a
machine-checkable predicate; the Verifier evaluates every predicate against the event store; and
the renderer fills captions only from verified values, then checks the final text again.

No model runs here. The agents (`agents/`) choose among the claims this layer verified; they
cannot add one.

## Modules

| Module | What it holds |
|---|---|
| [`moments.py`](moments.py) | `detect_moments`: line-breaking passes, decisions after a scan, decisions under pressure, sprints (live overlay only); cards about the same action merge into one with several tags. `detect_blind_side_passes` runs on its own |
| [`cards.py`](cards.py) | `MomentCard`, the shared state of the crew: ids, window, players, anchor events, metrics, every lens result, the selected lens; `content_hash()` keys the breakdown cache |
| [`lenses.py`](lenses.py) | `explain_moment(s)`: the `scan`, `space` and `pressure` lenses, all in xT of the acting team, and `pick_lens` (largest absolute delta; ties go scan, space, pressure) |
| [`claims.py`](claims.py) | `Claim`: a template, slots bound into a predicate, evidence event ids, and a kind (`observed`, `computed`, `counterfactual`) derived from the predicate |
| [`functions.py`](functions.py) | the predicate functions (`count_events`, `metric_at`, `distance`, `scans_in_window`, `observed_share`, `cf_delta`, …) and `EvalContext` (the run, its counterfactuals and cards) |
| [`builders.py`](builders.py) | `hero_claims`: every fact of a hero moment measured with those same functions and written as a claim, with `en` and `zh` templates |
| [`verifier.py`](verifier.py) | `Verifier.verify`: `supported`, `refuted` or `inconclusive`, with a trace and the claim's fingerprint; every verdict goes to the audit sink |
| [`audit.py`](audit.py) | audit sinks: memory, JSONL file, Cosmos DB container `claims_audit` |
| [`lexicon.py`](lexicon.py) | qualitative terms and the predicate each one needs (`unmarked`, `blind side`, `under heavy pressure`), banned evaluative terms, allowed connectives |
| [`numbers.py`](numbers.py) | `number_tokens`: digits, English number words and Chinese numerals with a measure word |
| [`render.py`](render.py) | `render_line`, `check_caption`, `build_payload`, `check_payload`: verified captions and the render payload a viewer receives |
| [`match.py`](match.py) | `match_moments`: moments of a stitched match, detected per possession and lifted to match time |
| [`tactics.py`](tactics.py) | `tactics_view`: the tactics cards of a run or a stitched match (`analytics.tactics`) and one sentence per card, a claim checked with `tactics_stat` and rendered in `en` and `zh` (SPEC 4.8) |

## Data flow

```
MatchRun (sim) ──► detect_moments ──► MomentCard ──► explain_moments (re-simulates per lens)
                                                         │
EvalContext(run, counterfactuals, cards) ──► hero_claims ──► Verifier ──► supported claims
                                                                │              │
                                                     audit sink ◄┘              ▼
                                agents pick claim ids ──► render_line ──► build_payload
                                                                          ──► check_payload ──► web/
```

- **In:** a `MatchRun` and its counterfactuals (`sim.counterfactual`). A counterfactual a
  predicate names (`cf: <scan id>` or `cf: force:<player>:<frame>:<action>`) and that was not
  supplied is re-simulated on demand from the run's scenario and seed.
- **Out:** `MomentCard`s (JSON), `Claim`s with their `Verdict`s, audit records, and the render
  payload of SPEC 5.3: lines with claim ids; claims with kind, verdict, values, evidence and a
  seek frame.
- `agents/context.py` (`MomentContext.load`) runs this whole chain once per hero moment before
  any model sees it. `sim/export.py` uses its moments, blind-side alerts and option scoring on
  the true state ("it was") for the viewer's files.

## Invariants

- **Only `supported` claims render.** A slot that the predicate never reads makes the claim
  `inconclusive` (its value would air unchecked), and an evidence id that names an event that did
  not happen makes it `refuted`. A function that cannot compute a value raises `Inconclusive`;
  it never guesses.
- **The value that renders is the value that was checked.** `render_line` fills placeholders only
  from claims that are supported and unchanged since they were verified (by fingerprint).
- **LLMs never write digits.** A caption may hold a number only inside a slot span: digits, English
  number words and Chinese numerals with a measure word all count. Player names must come from
  slots too, no `{` or `}` may survive, and a line with no claim must be an allowed connective.
- **Words need predicates.** A lexicon term may appear only on a line whose supported claim backs
  it with the lexicon's own threshold (a claim cannot weaken "unmarked"). Banned evaluative terms
  ("mistake", "should have", 失误, 本该, …) never render, in any persona or language.
- **The kind is derived, never declared on trust**: anything that reads a re-simulation is
  `counterfactual`, shown as causal inside the sim only.
- **Every verdict is audited** with the claim, its evaluated values, the run hash, the
  counterfactuals used and timestamps. Tamper checks (`api/tamper.py`) bypass the sink on
  purpose: the log records what the service aired, not what a viewer tried.
- **Lens selection is deterministic for a seed**, and every lens delta is in the same unit, so
  the scan lens wins exactly when the scan was decisive.

## Run it

```bash
uv run python -m explain.lenses --scenario blind_side_run --seed 3   # the cards and their lenses
uv run python -m eval.corruption                                     # the Verifier under attack
```

## Tests

```bash
uv run pytest tests/test_moments.py tests/test_lenses.py tests/test_claims.py tests/test_verifier.py \
  tests/test_verifier_lexicon.py tests/test_verifier_audit.py tests/test_render.py \
  tests/test_verifier_corruption.py
```

- [`test_render.py`](../tests/test_render.py): numbers not from a slot, lexicon terms, banned
  terms and connectives are rejected; `check_payload` catches tampering after render.
- [`test_verifier_corruption.py`](../tests/test_verifier_corruption.py): false perturbations are
  refuted (the corruption eval, [report](../eval/reports/corruption.md)).
- [`test_claims.py`](../tests/test_claims.py) (kinds), [`test_lenses.py`](../tests/test_lenses.py)
  (determinism, the scan lens on the hero), [`test_moments.py`](../tests/test_moments.py),
  [`test_blind_side_moments.py`](../tests/test_blind_side_moments.py),
  [`test_described_claims.py`](../tests/test_described_claims.py) (the audio-description
  claims), [`test_pass_success.py`](../tests/test_pass_success.py) ("he thought / it was").

## SPEC

[§5](../docs/SPEC.md#5-explain-layer-explain): [5.1 moments](../docs/SPEC.md#51-moment-detection),
[5.2 lenses](../docs/SPEC.md#52-lens-selection-by-counterfactual-impact),
[5.3 claims and the Verifier](../docs/SPEC.md#53-claims-and-verifier),
[acceptance checks](../docs/SPEC.md#acceptance-checks--explain).
