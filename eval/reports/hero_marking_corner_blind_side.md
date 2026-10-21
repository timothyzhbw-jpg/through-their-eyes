# Set-piece hero — `corner_blind_side`

Seeds 100–139 (40). Counterfactual: drop the key scan of the marker `H5` and re-simulate from the frame it starts (keyed randomness). The moment is the cutback to `A9`; distances are taken as it arrives.

| Metric | Value | Target (SPEC 3.6) |
|---|---|---|
| Without the look `A9` receives unmarked (nearest opponent > 5 m), and with it `H5` is within 5 m or wins the ball | 37/40 (92%) | ≥ 60% |
| Without the look, `H5`'s belief error about `A9` 0.5 s after the cutback is played ≥ 3 m | 37/40 (92%) | ≥ 90% |
| Design rule: `A9` unseen by `H5` from the dart to the look (factual) or to the cutback (without the look), and seen by `H5` during the key scan (factual; visibility ≥ 0.5 on at least one frame) | 40/40 (100%) | ≥ 90% |
| Median separation as the ball arrives: with the look / without | 3.3 m / 8.5 m | — |
| With the look: `A9` under heavy pressure (pressing ≥ 0.7) · `H5` wins the ball | 23/40 · 0/40 | — |
| Blind-side alert `H5` → `A9`: on before the ball arrives, without the look · on before the look and cleared during it, with the look | 40/40 · 0/40 | reported |

## Deviations from the design plan (docs/drafts/hero_expansion.md, section 5.4)

The plan's checks were changed while the routine was built on design seeds 0–39, before the held-out run on seeds 100–139 (the plan's own "As built" note, section 5). Bowen decided on 2026-10-20 to keep the gate above and to report the plan's checks here, beside it, on the same seeds 100–139.

| Plan (section 5.4) | As built (table above) | Plan's check on these seeds | Plan's target |
|---|---|---|---|
| Hard gate: dropping the look raises the separation as the ball arrives from ≤ 1.5 m to ≥ 3 m (`A9` receives), ≥ 60% | `A9` unmarked (> 5 m) without the look, `H5` within 5 m or winning the ball with it, ≥ 60% | 0/40 (0%) | not met |
| Belief error ≥ 3 m at the cutback, ≥ 90% | the same, 0.5 s after the cutback is played | 30/40 (75%) | not met |
| Blind-side alert `H5` → `A9` on before the look and cleared during it, ≥ 90% | reported only | 0/40 (0%) | not met |
| With marking on belief off, `possession_play` marking stays byte-identical | no flag: only this scenario calls `marking_target_on_belief`; the other scenarios' committed exports and eval reports are unchanged (`tests/test_committed_exports.py`) | — | — |
| Design seeds 0–99, held out 100–139 | design seeds 0–39, held out 100–139 | — | — |

- **Separation.** With the look `H5` closes to 3.3 m (median), not 1.5 m, so the plan's gate holds on 0/40 seeds (plan target ≥ 60%: not met); without it `A9` is 8.5 m away. The gate uses the lexicon's `unmarked` (SPEC 5.3) instead.
- **Alert.** The alert (SPEC 4.4, from tracking) can come on only once the runner has been out of sight for 1.2 s, and then needs, on one frame, the runner at 4 m/s or more, 3 m or more from where `H5` expects him, within 35 m, and `H5` watching him (one of the 4 defenders nearest the ball). The look comes 0.16–0.28 s after `A9` starts his dart, when he has been out of sight for 1.40–2.04 s: a window of 0.20–0.84 s in which the alert could come on. In that window his top speed is 1.2–2.7 m/s. Conditions that hold on no frame of the window: speed on 40/40 seeds, distance moved on 34/40, `H5` watching on 27/40, range on 0/40. All of them hold together on a frame in 0/40.

| Seed | With the look: outcome | sep. (m) | nearest (m) | pressing | Without: outcome | sep. (m) | nearest (m) | pressing | belief error (m) | at the cutback (m) | gate | plan's gate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | complete → A9 | 3.1 | 3.1 | 0.73 | complete → A9 | 8.9 | 8.9 | 0.15 | 5.1 | 3.6 | yes | no |
| 101 | complete → A9 | 3.0 | 3.0 | 0.74 | complete → A9 | 8.3 | 5.1 | 0.30 | 4.4 | 3.1 | yes | no |
| 102 | complete → A9 | 4.5 | 4.5 | 0.37 | complete → A9 | 9.5 | 7.8 | 0.05 | 5.2 | 4.2 | yes | no |
| 103 | complete → A9 | 2.5 | 2.5 | 0.40 | complete → A9 | 7.5 | 4.9 | 0.61 | 5.0 | 3.9 | no | no |
| 104 | complete → A9 | 3.2 | 3.2 | 0.76 | complete → A9 | 9.5 | 9.5 | 0.23 | 6.1 | 4.6 | yes | no |
| 105 | complete → A9 | 2.8 | 2.8 | 0.84 | complete → A9 | 8.2 | 8.2 | 0.28 | 4.5 | 3.3 | yes | no |
| 106 | complete → A9 | 4.1 | 4.1 | 0.38 | complete → A9 | 9.5 | 8.6 | 0.04 | 4.6 | 3.5 | yes | no |
| 107 | complete → A9 | 5.3 | 5.3 | 0.12 | complete → A9 | 9.6 | 9.6 | 0.01 | 4.4 | 3.1 | no | no |
| 108 | complete → A9 | 3.1 | 3.1 | 0.87 | complete → A9 | 7.4 | 7.4 | 0.12 | 2.6 | 1.7 | yes | no |
| 109 | complete → A9 | 5.6 | 5.6 | 0.12 | complete → A9 | 9.4 | 9.4 | 0.03 | 4.8 | 3.9 | no | no |
| 110 | complete → A9 | 4.6 | 4.6 | 0.29 | complete → A9 | 9.3 | 9.3 | 0.04 | 5.0 | 3.9 | yes | no |
| 111 | complete → A9 | 2.7 | 2.7 | 0.92 | complete → A9 | 8.5 | 8.5 | 0.22 | 5.0 | 3.8 | yes | no |
| 112 | complete → A9 | 3.3 | 3.3 | 0.76 | complete → A9 | 8.7 | 8.7 | 0.18 | 5.1 | 3.8 | yes | no |
| 113 | complete → A9 | 3.2 | 3.2 | 0.69 | complete → A9 | 8.5 | 8.5 | 0.28 | 5.1 | 3.8 | yes | no |
| 114 | complete → A9 | 4.4 | 4.4 | 0.47 | complete → A9 | 9.4 | 9.4 | 0.05 | 4.5 | 3.2 | yes | no |
| 115 | complete → A9 | 3.9 | 3.9 | 0.76 | complete → A9 | 9.0 | 9.0 | 0.10 | 5.0 | 3.5 | yes | no |
| 116 | complete → A9 | 4.9 | 4.9 | 0.52 | complete → A9 | 9.4 | 9.4 | 0.05 | 4.7 | 3.6 | yes | no |
| 117 | complete → A9 | 3.7 | 3.7 | 0.59 | complete → A9 | 8.9 | 5.1 | 0.12 | 4.7 | 3.5 | yes | no |
| 118 | complete → A9 | 3.3 | 3.3 | 0.79 | complete → A9 | 9.6 | 9.6 | 0.15 | 5.7 | 3.9 | yes | no |
| 119 | complete → A9 | 2.3 | 2.3 | 0.56 | complete → A9 | 8.0 | 5.0 | 0.52 | 5.4 | 3.9 | yes | no |
| 120 | complete → A9 | 3.3 | 3.3 | 0.88 | complete → A9 | 8.0 | 8.0 | 0.11 | 3.8 | 2.9 | yes | no |
| 121 | complete → A9 | 3.3 | 3.3 | 0.93 | complete → A9 | 8.7 | 8.7 | 0.07 | 3.8 | 2.8 | yes | no |
| 122 | complete → A9 | 2.4 | 2.4 | 0.94 | complete → A9 | 7.3 | 7.3 | 0.29 | 3.4 | 2.6 | yes | no |
| 123 | complete → A9 | 4.0 | 4.0 | 0.34 | complete → A9 | 9.9 | 9.9 | 0.03 | 5.2 | 3.7 | yes | no |
| 124 | complete → A9 | 3.7 | 3.7 | 0.68 | complete → A9 | 9.1 | 9.1 | 0.08 | 4.7 | 3.5 | yes | no |
| 125 | complete → A9 | 2.4 | 2.4 | 0.70 | complete → A9 | 8.1 | 6.5 | 0.47 | 5.2 | 3.8 | yes | no |
| 126 | complete → A9 | 3.0 | 3.0 | 0.90 | complete → A9 | 8.2 | 8.2 | 0.17 | 4.8 | 3.5 | yes | no |
| 127 | complete → A9 | 2.4 | 2.4 | 0.54 | complete → A9 | 8.5 | 8.5 | 0.43 | 5.3 | 3.7 | yes | no |
| 128 | complete → A9 | 3.4 | 3.4 | 0.82 | complete → A9 | 9.3 | 9.3 | 0.15 | 5.2 | 3.5 | yes | no |
| 129 | complete → A9 | 2.5 | 2.5 | 0.95 | complete → A9 | 6.7 | 6.7 | 0.37 | 2.8 | 1.9 | yes | no |
| 130 | complete → A9 | 3.0 | 3.0 | 0.95 | complete → A9 | 8.2 | 8.2 | 0.11 | 3.8 | 2.8 | yes | no |
| 131 | complete → A9 | 2.7 | 2.7 | 0.94 | complete → A9 | 6.7 | 6.7 | 0.41 | 3.2 | 2.6 | yes | no |
| 132 | complete → A9 | 2.7 | 2.7 | 0.93 | complete → A9 | 7.6 | 7.6 | 0.18 | 2.8 | 1.9 | yes | no |
| 133 | complete → A9 | 3.8 | 3.8 | 0.69 | complete → A9 | 8.4 | 8.4 | 0.22 | 4.6 | 3.5 | yes | no |
| 134 | complete → A9 | 3.5 | 3.5 | 0.71 | complete → A9 | 8.4 | 5.7 | 0.36 | 4.9 | 3.6 | yes | no |
| 135 | complete → A9 | 4.3 | 4.3 | 0.49 | complete → A9 | 9.4 | 9.4 | 0.05 | 4.8 | 3.5 | yes | no |
| 136 | complete → A9 | 1.8 | 1.8 | 0.92 | complete → A9 | 6.6 | 6.6 | 0.53 | 4.3 | 3.1 | yes | no |
| 137 | complete → A9 | 3.8 | 3.8 | 0.86 | complete → A9 | 7.9 | 7.9 | 0.05 | 3.4 | 2.5 | yes | no |
| 138 | complete → A9 | 3.3 | 3.3 | 0.94 | complete → A9 | 7.3 | 7.3 | 0.20 | 3.4 | 2.7 | yes | no |
| 139 | complete → A9 | 1.6 | 1.6 | 0.76 | complete → A9 | 7.4 | 7.4 | 0.55 | 4.9 | 3.7 | yes | no |
