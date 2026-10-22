# Set-piece hero — `corner_blind_side`

Seeds 1000–1199 (200). Counterfactual: drop the key scan of the marker `H5` and re-simulate from the frame it starts (keyed randomness). The moment is the cutback to `A9`; distances are taken as it arrives.

| Metric | Value | Target (SPEC 3.6) |
|---|---|---|
| Without the look `A9` receives unmarked (nearest opponent > 5 m), and with it `H5` is within 5 m or wins the ball | 193/200 (96%) | ≥ 60% |
| Without the look, `H5`'s belief error about `A9` 0.5 s after the cutback is played ≥ 3 m | 188/200 (94%) | ≥ 90% |
| Design rule: `A9` unseen by `H5` from the dart to the look (factual) or to the cutback (without the look), and seen by `H5` during the key scan (factual; visibility ≥ 0.5 on at least one frame) | 200/200 (100%) | ≥ 90% |
| Median separation as the ball arrives: with the look / without | 3.1 m / 8.2 m | — |
| With the look: `A9` under heavy pressure (pressing ≥ 0.7) · `H5` wins the ball | 121/200 · 0/200 | — |
| Blind-side alert `H5` → `A9`: on before the ball arrives, without the look · on before the look and cleared during it, with the look | 199/200 · 0/200 | reported |

## Deviations from the design plan (docs/drafts/hero_expansion.md, section 5.4)

The plan's checks were changed while the routine was built on design seeds 0–39, before the held-out run on seeds 100–139 (the plan's own "As built" note, section 5). Bowen decided on 2026-10-20 to keep the gate above and to report the plan's checks here, beside it, on the same seeds 1000–1199 (not the held-out seeds).

| Plan (section 5.4) | As built (table above) | Plan's check on these seeds | Plan's target |
|---|---|---|---|
| Hard gate: dropping the look raises the separation as the ball arrives from ≤ 1.5 m to ≥ 3 m (`A9` receives), ≥ 60% | `A9` unmarked (> 5 m) without the look, `H5` within 5 m or winning the ball with it, ≥ 60% | 1/200 (0%) | not met |
| Belief error ≥ 3 m at the cutback, ≥ 90% | the same, 0.5 s after the cutback is played | 152/200 (76%) | not met |
| Blind-side alert `H5` → `A9` on before the look and cleared during it, ≥ 90% | reported only | 0/200 (0%) | not met |
| With marking on belief off, `possession_play` marking stays byte-identical | no flag: only this scenario calls `marking_target_on_belief`; the other scenarios' committed exports and eval reports are unchanged (`tests/test_committed_exports.py`) | — | — |
| Design seeds 0–99, held out 100–139 | design seeds 0–39, held out 100–139 | — | — |

- **Separation.** With the look `H5` closes to 3.1 m (median), not 1.5 m, so the plan's gate holds on 1/200 seeds (plan target ≥ 60%: not met); without it `A9` is 8.2 m away. The gate uses the lexicon's `unmarked` (SPEC 5.3) instead.
- **Alert.** The alert (SPEC 4.4, from tracking) can come on only once the runner has been out of sight for 1.2 s, and then needs, on one frame, the runner at 4 m/s or more, 3 m or more from where `H5` expects him, within 35 m, and `H5` watching him (one of the 4 defenders nearest the ball). The look comes 0.16–0.28 s after `A9` starts his dart, when he has been out of sight for 1.48–2.12 s: a window of 0.28–0.92 s in which the alert could come on. In that window his top speed is 1.4–2.7 m/s. Conditions that hold on no frame of the window: speed on 200/200 seeds, distance moved on 174/200, `H5` watching on 138/200, range on 0/200. All of them hold together on a frame in 0/200.

| Seed | With the look: outcome | sep. (m) | nearest (m) | pressing | Without: outcome | sep. (m) | nearest (m) | pressing | belief error (m) | at the cutback (m) | gate | plan's gate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | complete → A9 | 4.1 | 4.1 | 0.87 | complete → A9 | 9.5 | 9.5 | 0.06 | 4.2 | 2.9 | yes | no |
| 1001 | complete → A9 | 2.7 | 2.7 | 0.74 | complete → A9 | 9.0 | 9.0 | 0.23 | 5.5 | 3.9 | yes | no |
| 1002 | complete → A9 | 4.4 | 4.4 | 0.57 | complete → A9 | 9.0 | 9.0 | 0.04 | 3.9 | 2.8 | yes | no |
| 1003 | complete → A9 | 3.5 | 3.5 | 0.90 | complete → A9 | 8.0 | 8.0 | 0.10 | 3.7 | 3.0 | yes | no |
| 1004 | complete → A9 | 2.3 | 2.3 | 0.52 | complete → A9 | 8.2 | 8.2 | 0.38 | 5.3 | 3.9 | yes | no |
| 1005 | complete → A9 | 4.5 | 4.5 | 0.41 | complete → A9 | 9.0 | 9.0 | 0.02 | 3.7 | 3.1 | yes | no |
| 1006 | complete → A9 | 4.3 | 4.3 | 0.55 | complete → A9 | 9.5 | 9.5 | 0.06 | 4.9 | 3.4 | yes | no |
| 1007 | complete → A9 | 3.2 | 3.2 | 0.92 | complete → A9 | 8.0 | 8.0 | 0.14 | 3.9 | 3.0 | yes | no |
| 1008 | complete → A9 | 3.4 | 3.4 | 0.81 | complete → A9 | 6.7 | 6.7 | 0.16 | 2.2 | 1.6 | yes | no |
| 1009 | complete → A9 | 3.7 | 3.7 | 0.85 | complete → A9 | 8.6 | 6.0 | 0.32 | 4.9 | 3.6 | yes | no |
| 1010 | complete → A9 | 3.4 | 3.4 | 0.82 | complete → A9 | 9.4 | 9.4 | 0.17 | 5.4 | 3.8 | yes | no |
| 1011 | complete → A9 | 2.4 | 2.4 | 0.92 | complete → A9 | 7.4 | 6.2 | 0.38 | 4.6 | 3.5 | yes | no |
| 1012 | complete → A9 | 3.5 | 3.5 | 0.91 | complete → A9 | 7.4 | 7.4 | 0.12 | 3.1 | 2.4 | yes | no |
| 1013 | complete → A9 | 3.4 | 3.4 | 0.72 | complete → A9 | 8.6 | 8.6 | 0.25 | 4.9 | 3.6 | yes | no |
| 1014 | complete → A9 | 4.2 | 4.2 | 0.55 | complete → A9 | 7.9 | 7.9 | 0.07 | 3.5 | 3.0 | yes | no |
| 1015 | complete → A9 | 2.1 | 2.1 | 0.87 | complete → A9 | 7.3 | 7.3 | 0.50 | 4.2 | 3.3 | yes | no |
| 1016 | complete → A9 | 5.6 | 5.6 | 0.25 | complete → A9 | 10.6 | 10.6 | 0.02 | 5.3 | 3.9 | no | no |
| 1017 | complete → A9 | 3.3 | 3.3 | 0.77 | complete → A9 | 8.8 | 8.8 | 0.12 | 4.7 | 3.7 | yes | no |
| 1018 | complete → A9 | 5.0 | 5.0 | 0.52 | complete → A9 | 9.8 | 9.8 | 0.07 | 5.3 | 3.8 | yes | no |
| 1019 | complete → A9 | 2.8 | 2.8 | 0.58 | complete → A9 | 7.9 | 3.3 | 0.38 | 4.5 | 3.6 | no | no |
| 1020 | complete → A9 | 4.1 | 4.1 | 0.29 | complete → A9 | 8.9 | 8.9 | 0.06 | 4.9 | 3.8 | yes | no |
| 1021 | complete → A9 | 3.0 | 3.0 | 0.96 | complete → A9 | 7.8 | 7.8 | 0.15 | 3.6 | 2.6 | yes | no |
| 1022 | complete → A9 | 2.7 | 2.7 | 0.83 | complete → A9 | 8.5 | 8.5 | 0.38 | 5.7 | 4.0 | yes | no |
| 1023 | complete → A9 | 3.1 | 3.1 | 0.94 | complete → A9 | 8.5 | 8.5 | 0.10 | 3.7 | 2.6 | yes | no |
| 1024 | complete → A9 | 3.2 | 3.2 | 0.84 | complete → A9 | 8.6 | 8.6 | 0.28 | 5.3 | 3.9 | yes | no |
| 1025 | complete → A9 | 2.4 | 2.4 | 0.80 | complete → A9 | 8.4 | 8.4 | 0.33 | 5.2 | 3.7 | yes | no |
| 1026 | complete → A9 | 3.8 | 3.8 | 0.90 | complete → A9 | 8.7 | 8.7 | 0.05 | 3.5 | 2.7 | yes | no |
| 1027 | complete → A9 | 4.5 | 4.5 | 0.36 | complete → A9 | 9.5 | 9.5 | 0.04 | 5.0 | 3.8 | yes | no |
| 1028 | complete → A9 | 2.2 | 2.2 | 0.96 | complete → A9 | 6.3 | 6.3 | 0.49 | 2.6 | 1.6 | yes | no |
| 1029 | complete → A9 | 1.7 | 1.7 | 0.89 | complete → A9 | 6.3 | 6.3 | 0.68 | 3.6 | 2.7 | yes | no |
| 1030 | complete → A9 | 3.3 | 3.3 | 0.78 | complete → A9 | 9.0 | 9.0 | 0.16 | 4.8 | 3.4 | yes | no |
| 1031 | complete → A9 | 4.6 | 4.6 | 0.49 | complete → A9 | 9.6 | 9.6 | 0.02 | 4.7 | 3.6 | yes | no |
| 1032 | complete → A9 | 2.8 | 2.8 | 0.90 | complete → A9 | 6.2 | 6.2 | 0.42 | 3.0 | 2.2 | yes | no |
| 1033 | complete → A9 | 2.4 | 2.4 | 0.60 | complete → A9 | 8.1 | 8.1 | 0.43 | 5.2 | 3.8 | yes | no |
| 1034 | complete → A9 | 3.7 | 3.7 | 0.76 | complete → A9 | 9.8 | 9.8 | 0.08 | 5.5 | 4.1 | yes | no |
| 1035 | complete → A9 | 2.8 | 2.8 | 0.71 | complete → A9 | 8.5 | 8.5 | 0.28 | 4.8 | 3.5 | yes | no |
| 1036 | complete → A9 | 2.4 | 2.4 | 0.94 | complete → A9 | 6.4 | 6.4 | 0.45 | 2.8 | 2.0 | yes | no |
| 1037 | complete → A9 | 5.0 | 5.0 | 0.21 | complete → A9 | 10.1 | 10.1 | 0.01 | 4.6 | 3.5 | no | no |
| 1038 | complete → A9 | 2.6 | 2.6 | 0.93 | complete → A9 | 6.4 | 6.4 | 0.33 | 2.5 | 1.9 | yes | no |
| 1039 | complete → A9 | 2.9 | 2.9 | 0.93 | complete → A9 | 7.8 | 7.8 | 0.20 | 3.9 | 2.9 | yes | no |
| 1040 | complete → A9 | 2.2 | 2.2 | 0.88 | complete → A9 | 7.6 | 7.6 | 0.39 | 4.4 | 3.3 | yes | no |
| 1041 | complete → A9 | 4.7 | 4.7 | 0.44 | complete → A9 | 10.1 | 10.1 | 0.03 | 5.1 | 3.6 | yes | no |
| 1042 | complete → A9 | 3.1 | 3.1 | 0.87 | complete → A9 | 7.3 | 7.3 | 0.26 | 4.0 | 3.1 | yes | no |
| 1043 | complete → A9 | 3.3 | 3.3 | 0.81 | complete → A9 | 8.1 | 8.1 | 0.14 | 4.1 | 3.1 | yes | no |
| 1044 | complete → A9 | 3.6 | 3.6 | 0.69 | complete → A9 | 8.5 | 8.5 | 0.11 | 4.6 | 3.6 | yes | no |
| 1045 | complete → A9 | 2.9 | 2.9 | 0.92 | complete → A9 | 8.0 | 8.0 | 0.24 | 4.2 | 3.0 | yes | no |
| 1046 | complete → A9 | 3.7 | 3.7 | 0.84 | complete → A9 | 9.7 | 9.7 | 0.10 | 5.2 | 3.6 | yes | no |
| 1047 | complete → A9 | 4.0 | 4.0 | 0.84 | complete → A9 | 9.2 | 9.2 | 0.13 | 5.0 | 3.9 | yes | no |
| 1048 | complete → A9 | 2.2 | 2.2 | 0.84 | complete → A9 | 7.7 | 7.7 | 0.50 | 4.9 | 3.7 | yes | no |
| 1049 | complete → A9 | 1.6 | 1.6 | 0.84 | complete → A9 | 6.9 | 6.9 | 0.66 | 4.0 | 3.0 | yes | no |
| 1050 | complete → A9 | 2.5 | 2.5 | 0.56 | complete → A9 | 7.8 | 7.8 | 0.53 | 4.9 | 3.5 | yes | no |
| 1051 | complete → A9 | 3.0 | 3.0 | 0.63 | complete → A9 | 9.1 | 9.1 | 0.18 | 5.7 | 4.2 | yes | no |
| 1052 | complete → A9 | 3.8 | 3.8 | 0.88 | complete → A9 | 8.4 | 8.4 | 0.27 | 4.8 | 3.5 | yes | no |
| 1053 | complete → A9 | 4.4 | 4.4 | 0.41 | complete → A9 | 9.8 | 9.8 | 0.03 | 4.8 | 3.5 | yes | no |
| 1054 | complete → A9 | 2.4 | 2.4 | 0.94 | complete → A9 | 6.9 | 6.9 | 0.30 | 2.9 | 2.2 | yes | no |
| 1055 | complete → A9 | 4.6 | 4.6 | 0.58 | complete → A9 | 9.6 | 9.6 | 0.08 | 5.3 | 4.1 | yes | no |
| 1056 | complete → A9 | 2.6 | 2.6 | 0.47 | complete → A9 | 7.9 | 7.9 | 0.47 | 5.1 | 3.9 | yes | no |
| 1057 | complete → A9 | 3.5 | 3.5 | 0.69 | complete → A9 | 9.4 | 7.2 | 0.14 | 5.2 | 3.5 | yes | no |
| 1058 | complete → A9 | 1.5 | 1.5 | 0.80 | complete → A9 | 6.9 | 6.9 | 0.69 | 4.9 | 3.5 | yes | no |
| 1059 | complete → A9 | 4.2 | 4.2 | 0.70 | complete → A9 | 9.5 | 9.5 | 0.10 | 5.4 | 3.8 | yes | no |
| 1060 | complete → A9 | 3.4 | 3.4 | 0.51 | complete → A9 | 8.6 | 8.6 | 0.10 | 4.6 | 3.7 | yes | no |
| 1061 | complete → A9 | 1.6 | 1.6 | 0.83 | complete → A9 | 6.5 | 6.5 | 0.70 | 3.9 | 3.0 | yes | no |
| 1062 | complete → A9 | 1.7 | 1.7 | 0.49 | complete → A9 | 7.3 | 5.7 | 0.66 | 5.1 | 3.8 | yes | no |
| 1063 | complete → A9 | 2.4 | 2.4 | 0.90 | complete → A9 | 7.7 | 7.7 | 0.41 | 4.5 | 3.3 | yes | no |
| 1064 | complete → A9 | 2.8 | 2.8 | 0.91 | complete → A9 | 6.7 | 6.7 | 0.30 | 2.4 | 1.7 | yes | no |
| 1065 | complete → A9 | 3.3 | 3.3 | 0.92 | complete → A9 | 7.5 | 7.5 | 0.20 | 4.0 | 3.2 | yes | no |
| 1066 | complete → A9 | 4.6 | 4.6 | 0.27 | complete → A9 | 9.6 | 9.6 | 0.02 | 4.7 | 3.4 | yes | no |
| 1067 | complete → A9 | 3.6 | 3.6 | 0.74 | complete → A9 | 8.4 | 8.4 | 0.09 | 4.5 | 3.6 | yes | no |
| 1068 | complete → A9 | 2.2 | 2.2 | 0.91 | complete → A9 | 6.0 | 6.0 | 0.61 | 3.3 | 2.7 | yes | no |
| 1069 | complete → A9 | 2.3 | 2.3 | 0.90 | complete → A9 | 8.1 | 8.1 | 0.25 | 4.3 | 3.0 | yes | no |
| 1070 | complete → A9 | 3.1 | 3.1 | 0.93 | complete → A9 | 8.5 | 8.5 | 0.15 | 4.2 | 3.1 | yes | no |
| 1071 | complete → A9 | 2.3 | 2.3 | 0.61 | complete → A9 | 7.6 | 7.6 | 0.58 | 5.1 | 3.7 | yes | no |
| 1072 | complete → A9 | 3.0 | 3.0 | 0.93 | complete → A9 | 8.0 | 8.0 | 0.13 | 3.8 | 2.9 | yes | no |
| 1073 | complete → A9 | 2.1 | 2.1 | 0.91 | complete → A9 | 6.5 | 6.5 | 0.51 | 3.3 | 2.6 | yes | no |
| 1074 | complete → A9 | 3.7 | 3.7 | 0.87 | complete → A9 | 8.3 | 8.2 | 0.24 | 4.5 | 3.5 | yes | no |
| 1075 | complete → A9 | 3.5 | 3.5 | 0.92 | complete → A9 | 7.4 | 7.4 | 0.19 | 3.6 | 2.9 | yes | no |
| 1076 | complete → A9 | 3.1 | 3.1 | 0.53 | complete → A9 | 8.5 | 8.5 | 0.21 | 4.9 | 3.5 | yes | no |
| 1077 | complete → A9 | 2.6 | 2.6 | 0.71 | complete → A9 | 8.1 | 8.1 | 0.28 | 4.5 | 3.1 | yes | no |
| 1078 | complete → A9 | 4.2 | 4.2 | 0.48 | complete → A9 | 8.9 | 8.9 | 0.12 | 4.9 | 3.9 | yes | no |
| 1079 | complete → A9 | 2.8 | 2.8 | 0.66 | complete → A9 | 8.1 | 8.1 | 0.36 | 5.0 | 3.9 | yes | no |
| 1080 | complete → A9 | 2.5 | 2.5 | 0.58 | complete → A9 | 8.0 | 5.2 | 0.44 | 4.8 | 3.5 | yes | no |
| 1081 | complete → A9 | 3.4 | 3.4 | 0.81 | complete → A9 | 8.1 | 4.8 | 0.43 | 4.8 | 3.6 | no | no |
| 1082 | complete → A9 | 2.8 | 2.8 | 0.89 | complete → A9 | 6.4 | 6.4 | 0.34 | 2.9 | 2.2 | yes | no |
| 1083 | complete → A9 | 2.8 | 2.8 | 0.89 | complete → A9 | 6.0 | 6.0 | 0.43 | 2.6 | 1.9 | yes | no |
| 1084 | complete → A9 | 3.1 | 3.1 | 0.93 | complete → A9 | 9.1 | 9.1 | 0.10 | 4.7 | 3.5 | yes | no |
| 1085 | complete → A9 | 3.9 | 3.9 | 0.66 | complete → A9 | 8.7 | 8.7 | 0.16 | 4.8 | 3.5 | yes | no |
| 1086 | complete → A9 | 1.4 | 1.4 | 0.86 | complete → A9 | 6.2 | 6.1 | 0.74 | 3.8 | 2.8 | yes | yes |
| 1087 | complete → A9 | 4.1 | 4.1 | 0.61 | complete → A9 | 9.5 | 9.5 | 0.10 | 5.5 | 4.1 | yes | no |
| 1088 | complete → A9 | 3.0 | 3.0 | 0.86 | complete → A9 | 8.2 | 8.2 | 0.17 | 4.3 | 3.2 | yes | no |
| 1089 | complete → A9 | 2.6 | 2.6 | 0.82 | complete → A9 | 7.5 | 7.5 | 0.30 | 4.4 | 3.2 | yes | no |
| 1090 | complete → A9 | 3.4 | 3.4 | 0.22 | complete → A9 | 8.8 | 8.8 | 0.11 | 5.2 | 4.0 | yes | no |
| 1091 | complete → A9 | 1.7 | 1.7 | 0.82 | complete → A9 | 6.9 | 6.9 | 0.58 | 4.5 | 3.4 | yes | no |
| 1092 | complete → A9 | 2.6 | 2.6 | 0.81 | complete → A9 | 8.2 | 5.8 | 0.42 | 5.0 | 3.7 | yes | no |
| 1093 | complete → A9 | 3.4 | 3.4 | 0.92 | complete → A9 | 8.2 | 8.2 | 0.11 | 3.9 | 3.0 | yes | no |
| 1094 | complete → A9 | 2.3 | 2.3 | 0.74 | complete → A9 | 7.7 | 7.7 | 0.53 | 4.6 | 3.2 | yes | no |
| 1095 | complete → A9 | 4.3 | 4.3 | 0.53 | complete → A9 | 9.6 | 9.6 | 0.04 | 4.8 | 3.7 | yes | no |
| 1096 | complete → A9 | 3.4 | 3.4 | 0.71 | complete → A9 | 9.4 | 9.4 | 0.07 | 4.9 | 3.6 | yes | no |
| 1097 | complete → A9 | 3.7 | 3.7 | 0.44 | complete → A9 | 8.2 | 8.2 | 0.17 | 4.4 | 3.3 | yes | no |
| 1098 | complete → A9 | 4.0 | 4.0 | 0.60 | complete → A9 | 9.5 | 9.5 | 0.07 | 5.2 | 3.8 | yes | no |
| 1099 | complete → A9 | 2.4 | 2.4 | 0.77 | complete → A9 | 7.4 | 5.9 | 0.42 | 4.2 | 3.5 | yes | no |
| 1100 | complete → A9 | 2.8 | 2.8 | 0.92 | complete → A9 | 7.7 | 7.7 | 0.14 | 3.5 | 2.4 | yes | no |
| 1101 | complete → A9 | 3.0 | 3.0 | 0.67 | complete → A9 | 8.9 | 8.9 | 0.29 | 5.3 | 3.7 | yes | no |
| 1102 | complete → A9 | 2.5 | 2.5 | 0.89 | complete → A9 | 8.1 | 8.1 | 0.27 | 4.4 | 3.2 | yes | no |
| 1103 | complete → A9 | 2.3 | 2.3 | 0.44 | complete → A9 | 8.1 | 6.2 | 0.50 | 5.2 | 3.8 | yes | no |
| 1104 | complete → A9 | 2.8 | 2.8 | 0.92 | complete → A9 | 7.8 | 6.2 | 0.31 | 4.2 | 3.3 | yes | no |
| 1105 | complete → A9 | 2.3 | 2.3 | 0.78 | complete → A9 | 7.4 | 6.5 | 0.47 | 4.6 | 3.6 | yes | no |
| 1106 | complete → A9 | 3.6 | 3.6 | 0.54 | complete → A9 | 8.7 | 6.0 | 0.15 | 4.9 | 3.9 | yes | no |
| 1107 | complete → A9 | 3.6 | 3.6 | 0.54 | complete → A9 | 7.9 | 7.9 | 0.22 | 3.8 | 3.0 | yes | no |
| 1108 | complete → A9 | 4.7 | 4.7 | 0.16 | complete → A9 | 9.4 | 9.4 | 0.03 | 4.8 | 3.8 | yes | no |
| 1109 | complete → A9 | 2.6 | 2.6 | 0.92 | complete → A9 | 6.8 | 6.8 | 0.40 | 2.9 | 2.0 | yes | no |
| 1110 | complete → A9 | 3.6 | 3.6 | 0.89 | complete → A9 | 7.1 | 7.1 | 0.42 | 3.5 | 2.7 | yes | no |
| 1111 | complete → A9 | 3.7 | 3.7 | 0.66 | complete → A9 | 7.9 | 7.9 | 0.14 | 4.1 | 3.3 | yes | no |
| 1112 | complete → A9 | 3.7 | 3.7 | 0.75 | complete → A9 | 9.1 | 9.1 | 0.09 | 5.0 | 3.7 | yes | no |
| 1113 | complete → A9 | 2.8 | 2.8 | 0.94 | complete → A9 | 8.6 | 8.6 | 0.14 | 4.3 | 3.2 | yes | no |
| 1114 | complete → A9 | 2.5 | 2.5 | 0.90 | complete → A9 | 7.1 | 7.1 | 0.32 | 3.5 | 3.0 | yes | no |
| 1115 | complete → A9 | 3.1 | 3.1 | 0.93 | complete → A9 | 8.0 | 8.0 | 0.17 | 3.7 | 2.9 | yes | no |
| 1116 | complete → A9 | 4.4 | 4.4 | 0.30 | complete → A9 | 8.5 | 8.5 | 0.06 | 4.4 | 3.6 | yes | no |
| 1117 | complete → A9 | 2.5 | 2.5 | 0.48 | complete → A9 | 7.7 | 7.7 | 0.45 | 4.8 | 3.6 | yes | no |
| 1118 | complete → A9 | 2.9 | 2.9 | 0.77 | complete → A9 | 8.5 | 8.5 | 0.20 | 4.9 | 3.7 | yes | no |
| 1119 | complete → A9 | 2.8 | 2.8 | 0.94 | complete → A9 | 7.1 | 7.1 | 0.25 | 3.0 | 2.6 | yes | no |
| 1120 | complete → A9 | 3.8 | 3.8 | 0.80 | complete → A9 | 8.8 | 8.8 | 0.07 | 4.2 | 3.1 | yes | no |
| 1121 | complete → A9 | 3.6 | 3.6 | 0.20 | complete → A9 | 8.6 | 8.6 | 0.13 | 4.9 | 3.7 | yes | no |
| 1122 | complete → A9 | 3.2 | 3.2 | 0.52 | complete → A9 | 8.4 | 8.4 | 0.21 | 4.8 | 3.6 | yes | no |
| 1123 | complete → A9 | 4.0 | 4.0 | 0.41 | complete → A9 | 9.7 | 9.7 | 0.04 | 5.1 | 3.6 | yes | no |
| 1124 | complete → A9 | 2.4 | 2.4 | 0.77 | complete → A9 | 7.8 | 7.8 | 0.44 | 4.8 | 3.5 | yes | no |
| 1125 | complete → A9 | 3.9 | 3.9 | 0.79 | complete → A9 | 9.0 | 9.0 | 0.14 | 5.2 | 4.0 | yes | no |
| 1126 | complete → A9 | 3.4 | 3.4 | 0.64 | complete → A9 | 8.5 | 8.5 | 0.33 | 4.9 | 3.6 | yes | no |
| 1127 | complete → A9 | 4.0 | 4.0 | 0.48 | complete → A9 | 9.5 | 9.5 | 0.06 | 5.4 | 4.2 | yes | no |
| 1128 | complete → A9 | 2.9 | 2.9 | 0.89 | complete → A9 | 8.8 | 8.8 | 0.18 | 4.7 | 3.3 | yes | no |
| 1129 | complete → A9 | 2.7 | 2.7 | 0.89 | complete → A9 | 8.3 | 7.2 | 0.28 | 4.2 | 3.0 | yes | no |
| 1130 | complete → A9 | 2.1 | 2.1 | 0.22 | complete → A9 | 7.3 | 7.3 | 0.59 | 4.9 | 3.7 | yes | no |
| 1131 | complete → A9 | 1.5 | 1.5 | 0.02 | complete → A9 | 5.7 | 5.7 | 0.73 | 2.6 | 1.7 | yes | no |
| 1132 | complete → A9 | 4.1 | 4.1 | 0.44 | complete → A9 | 9.7 | 9.3 | 0.03 | 4.8 | 3.5 | yes | no |
| 1133 | complete → A9 | 4.2 | 4.2 | 0.72 | complete → A9 | 9.2 | 9.2 | 0.10 | 4.8 | 3.5 | yes | no |
| 1134 | complete → A9 | 3.9 | 3.9 | 0.56 | complete → A9 | 9.4 | 9.4 | 0.08 | 4.9 | 3.6 | yes | no |
| 1135 | complete → A9 | 2.3 | 2.3 | 0.90 | complete → A9 | 7.7 | 7.7 | 0.34 | 4.4 | 3.1 | yes | no |
| 1136 | complete → A9 | 3.3 | 3.3 | 0.91 | complete → A9 | 7.4 | 7.4 | 0.16 | 3.3 | 2.7 | yes | no |
| 1137 | complete → A9 | 2.3 | 2.3 | 0.90 | complete → A9 | 7.4 | 7.4 | 0.39 | 4.2 | 3.3 | yes | no |
| 1138 | complete → A9 | 2.9 | 2.9 | 0.94 | complete → A9 | 7.9 | 7.9 | 0.14 | 3.7 | 2.8 | yes | no |
| 1139 | complete → A9 | 2.8 | 2.8 | 0.90 | complete → A9 | 6.6 | 6.6 | 0.31 | 2.5 | 1.9 | yes | no |
| 1140 | complete → A9 | 3.1 | 3.1 | 0.87 | complete → A9 | 6.3 | 6.3 | 0.36 | 3.3 | 2.4 | yes | no |
| 1141 | complete → A9 | 2.4 | 2.4 | 0.66 | complete → A9 | 7.8 | 7.8 | 0.56 | 5.0 | 3.5 | yes | no |
| 1142 | complete → A9 | 4.5 | 4.5 | 0.28 | complete → A9 | 8.9 | 8.9 | 0.05 | 4.6 | 3.6 | yes | no |
| 1143 | complete → A9 | 3.3 | 3.3 | 0.83 | complete → A9 | 7.5 | 7.5 | 0.19 | 3.4 | 2.8 | yes | no |
| 1144 | complete → A9 | 3.5 | 3.5 | 0.67 | complete → A9 | 8.8 | 8.8 | 0.15 | 5.1 | 3.7 | yes | no |
| 1145 | complete → A9 | 3.9 | 3.9 | 0.64 | complete → A9 | 9.1 | 9.1 | 0.07 | 4.6 | 3.4 | yes | no |
| 1146 | complete → A9 | 2.7 | 2.7 | 0.96 | complete → A9 | 6.6 | 6.6 | 0.36 | 3.1 | 2.4 | yes | no |
| 1147 | complete → A9 | 3.4 | 3.4 | 0.73 | complete → A9 | 9.1 | 9.1 | 0.13 | 5.1 | 4.0 | yes | no |
| 1148 | complete → A9 | 2.1 | 2.1 | 0.80 | complete → A9 | 7.9 | 6.8 | 0.37 | 4.7 | 3.6 | yes | no |
| 1149 | complete → A9 | 3.1 | 3.1 | 0.91 | complete → A9 | 8.2 | 8.2 | 0.17 | 4.4 | 3.4 | yes | no |
| 1150 | complete → A9 | 3.2 | 3.2 | 0.86 | complete → A9 | 7.6 | 7.6 | 0.11 | 2.9 | 2.1 | yes | no |
| 1151 | complete → A9 | 2.8 | 2.8 | 0.83 | complete → A9 | 8.2 | 5.3 | 0.34 | 5.3 | 3.7 | yes | no |
| 1152 | complete → A9 | 4.6 | 4.6 | 0.35 | complete → A9 | 8.9 | 8.9 | 0.04 | 4.2 | 3.5 | yes | no |
| 1153 | complete → A9 | 3.7 | 3.7 | 0.64 | complete → A9 | 7.7 | 7.7 | 0.11 | 3.5 | 2.9 | yes | no |
| 1154 | complete → A9 | 4.2 | 4.2 | 0.13 | complete → A9 | 8.5 | 8.5 | 0.09 | 4.8 | 3.8 | yes | no |
| 1155 | complete → A9 | 3.2 | 3.2 | 0.66 | complete → A9 | 8.3 | 5.4 | 0.27 | 4.8 | 3.7 | yes | no |
| 1156 | complete → A9 | 4.6 | 4.6 | 0.42 | complete → A9 | 9.1 | 9.1 | 0.06 | 4.3 | 3.2 | yes | no |
| 1157 | complete → A9 | 2.2 | 2.2 | 0.83 | complete → A9 | 6.9 | 6.2 | 0.61 | 3.8 | 2.7 | yes | no |
| 1158 | complete → A9 | 1.7 | 1.7 | 0.74 | complete → A9 | 7.0 | 7.0 | 0.65 | 4.5 | 3.5 | yes | no |
| 1159 | complete → A9 | 3.0 | 3.0 | 0.91 | complete → A9 | 7.0 | 7.0 | 0.27 | 3.4 | 2.7 | yes | no |
| 1160 | complete → A9 | 1.7 | 1.7 | 0.82 | complete → A9 | 6.6 | 6.6 | 0.66 | 4.2 | 3.1 | yes | no |
| 1161 | complete → A9 | 2.7 | 2.7 | 0.90 | complete → A9 | 8.1 | 7.8 | 0.22 | 4.3 | 3.3 | yes | no |
| 1162 | complete → A9 | 4.3 | 4.3 | 0.56 | complete → A9 | 8.9 | 8.9 | 0.03 | 3.6 | 3.0 | yes | no |
| 1163 | complete → A9 | 2.5 | 2.5 | 0.90 | complete → A9 | 7.5 | 7.5 | 0.47 | 4.3 | 3.2 | yes | no |
| 1164 | complete → A9 | 3.7 | 3.7 | 0.50 | complete → A9 | 8.6 | 8.6 | 0.11 | 4.7 | 3.7 | yes | no |
| 1165 | complete → A9 | 2.3 | 2.3 | 0.53 | complete → A9 | 7.9 | 7.9 | 0.42 | 4.7 | 3.5 | yes | no |
| 1166 | complete → A9 | 1.8 | 1.8 | 0.84 | complete → A9 | 6.7 | 6.7 | 0.79 | 4.9 | 3.3 | yes | no |
| 1167 | complete → A9 | 4.0 | 4.0 | 0.43 | complete → A9 | 8.7 | 8.7 | 0.04 | 4.0 | 3.0 | yes | no |
| 1168 | complete → A9 | 3.2 | 3.2 | 0.60 | complete → A9 | 8.6 | 8.6 | 0.21 | 4.8 | 3.6 | yes | no |
| 1169 | complete → A9 | 3.6 | 3.6 | 0.90 | complete → A9 | 9.1 | 9.1 | 0.18 | 4.7 | 3.2 | yes | no |
| 1170 | complete → A9 | 3.7 | 3.7 | 0.76 | complete → A9 | 9.0 | 9.0 | 0.22 | 5.2 | 3.6 | yes | no |
| 1171 | complete → A9 | 3.8 | 3.8 | 0.49 | complete → A9 | 8.8 | 8.8 | 0.09 | 4.5 | 3.5 | yes | no |
| 1172 | complete → A9 | 3.8 | 3.8 | 0.66 | complete → A9 | 8.6 | 8.3 | 0.26 | 5.4 | 4.0 | yes | no |
| 1173 | complete → A9 | 3.6 | 3.6 | 0.48 | complete → A9 | 8.5 | 8.5 | 0.16 | 4.7 | 3.3 | yes | no |
| 1174 | complete → A9 | 2.6 | 2.6 | 0.85 | complete → A9 | 8.0 | 3.0 | 0.31 | 4.9 | 3.6 | no | no |
| 1175 | complete → A9 | 2.7 | 2.7 | 0.56 | complete → A9 | 7.5 | 7.5 | 0.36 | 4.6 | 3.5 | yes | no |
| 1176 | complete → A9 | 3.5 | 3.5 | 0.81 | complete → A9 | 8.6 | 8.6 | 0.13 | 4.6 | 3.3 | yes | no |
| 1177 | complete → A9 | 3.1 | 3.1 | 0.93 | complete → A9 | 8.4 | 8.4 | 0.16 | 4.4 | 3.1 | yes | no |
| 1178 | complete → A9 | 3.2 | 3.2 | 0.88 | complete → A9 | 8.2 | 8.2 | 0.21 | 5.3 | 3.7 | yes | no |
| 1179 | complete → A9 | 2.2 | 2.2 | 0.82 | complete → A9 | 8.3 | 8.3 | 0.40 | 5.2 | 3.5 | yes | no |
| 1180 | complete → A9 | 2.2 | 2.2 | 0.73 | complete → A9 | 7.9 | 7.9 | 0.58 | 5.6 | 4.0 | yes | no |
| 1181 | complete → A9 | 3.2 | 3.2 | 0.80 | complete → A9 | 9.5 | 9.5 | 0.13 | 4.9 | 3.4 | yes | no |
| 1182 | complete → A9 | 3.8 | 3.8 | 0.87 | complete → A9 | 8.6 | 8.6 | 0.08 | 4.1 | 3.1 | yes | no |
| 1183 | complete → A9 | 4.9 | 4.9 | 0.31 | complete → A9 | 9.8 | 9.0 | 0.03 | 5.0 | 3.8 | yes | no |
| 1184 | complete → A9 | 3.7 | 3.7 | 0.81 | complete → A9 | 9.4 | 9.4 | 0.06 | 4.8 | 3.6 | yes | no |
| 1185 | complete → A9 | 3.1 | 3.1 | 0.36 | complete → A9 | 7.9 | 7.9 | 0.26 | 4.6 | 3.7 | yes | no |
| 1186 | complete → A9 | 3.7 | 3.7 | 0.84 | complete → A9 | 9.5 | 9.5 | 0.19 | 5.6 | 4.2 | yes | no |
| 1187 | complete → A9 | 4.3 | 4.3 | 0.51 | complete → A9 | 8.1 | 8.1 | 0.07 | 3.6 | 3.0 | yes | no |
| 1188 | complete → A9 | 3.9 | 3.9 | 0.44 | complete → A9 | 8.5 | 8.5 | 0.09 | 4.5 | 3.6 | yes | no |
| 1189 | complete → A9 | 2.4 | 2.4 | 0.57 | complete → A9 | 8.2 | 8.2 | 0.40 | 5.1 | 3.6 | yes | no |
| 1190 | complete → A9 | 5.1 | 5.1 | 0.03 | complete → A9 | 10.2 | 10.2 | 0.01 | 5.3 | 3.9 | no | no |
| 1191 | complete → A9 | 2.1 | 2.1 | 0.86 | complete → A9 | 7.2 | 7.2 | 0.51 | 4.1 | 3.0 | yes | no |
| 1192 | complete → A9 | 1.6 | 1.6 | 0.80 | complete → A9 | 6.8 | 6.8 | 0.66 | 4.3 | 3.2 | yes | no |
| 1193 | complete → A9 | 3.4 | 3.4 | 0.95 | complete → A9 | 8.0 | 7.1 | 0.23 | 3.9 | 3.0 | yes | no |
| 1194 | complete → A9 | 1.9 | 1.9 | 0.86 | complete → A9 | 6.7 | 6.7 | 0.65 | 4.4 | 3.2 | yes | no |
| 1195 | complete → A9 | 2.2 | 2.2 | 0.87 | complete → A9 | 7.6 | 5.4 | 0.52 | 4.3 | 3.1 | yes | no |
| 1196 | complete → A9 | 3.5 | 3.5 | 0.54 | complete → A9 | 9.1 | 9.1 | 0.08 | 5.0 | 3.7 | yes | no |
| 1197 | complete → A9 | 2.0 | 2.0 | 0.87 | complete → A9 | 7.2 | 4.8 | 0.52 | 4.3 | 3.2 | no | no |
| 1198 | complete → A9 | 2.9 | 2.9 | 0.60 | complete → A9 | 8.6 | 5.6 | 0.27 | 5.1 | 3.7 | yes | no |
| 1199 | complete → A9 | 2.1 | 2.1 | 0.89 | complete → A9 | 7.0 | 7.0 | 0.50 | 3.4 | 2.7 | yes | no |
