# Save hero — `screened_shot`

Seeds 1000–1199 (200). Factual run: `H1` makes the key step. Counterfactual: drop that step and re-simulate from its start. The third run keeps the step but forces first sight (`SightAt`) to the frame the no-step run first saw the ball. Default keeper reach speed: 3 m/s.

P_save is the shot event's `p_save`. delta_sight is P(step) minus P(step, late sight). delta_position is P(step, late sight) minus P(no step). A missing `p_save` (the shot was blocked before the save model ran) fails the gates that need it. Delay is the time from the strike to first sight.

| Metric | Value | Target |
|---|---|---|
| Without the step, first sight ≥ 0.25 s later | 191/200 (96%) | ≥ 90% |
| P_save(step) − P_save(no step) ≥ 0.4 | 156/200 (78%) | ≥ 60% |
| delta_sight > delta_position | 169/200 (84%) | ≥ 80% |
| Realised save to goal when the step is removed | 83/200 (42%) | reported |
| P_save gap ≥ 0.4, v_dive = 2.5 m/s | 155/200 (78%) | ≥ 60% |
| P_save gap ≥ 0.4, v_dive = 4 m/s | 156/200 (78%) | ≥ 60% |
| Shots blocked before the save model (no `p_save`) | 9/200 | reported |
| … first sight ≥ 0.25 s later, shots not blocked | 191/191 | reported |
| … delta_sight > delta_position, shots not blocked and not both 0 | 169/184 | reported |
| … P_save gap ≥ 0.4, shots on target with the step (saved or goal) | 121/121 | reported |
| … P_save gap ≥ 0.4, shots wide with the step | 16/156 of the gate's passes | reported |

The rows marked … are reported only. A blocked shot fails every gate that needs `p_save`. A wide shot still has a `p_save`: the save model at the point where it crosses the goal line, outside the posts. So it counts in the hard gate as the keeper's reach, even though no save was needed. delta_sight and delta_position are both 0 when the shot is beyond the keeper's reach with or without the step; that tie fails the decomposition.

The sweep re-simulates the step and the dropped step only, then restores the default keeper. It does not re-run the late-sight decomposition.

| Seed | Delay step (s) | Delay no step (s) | P_save step | P_save no step | P_save step+late | Δsight | Δposition | Outcome step | Outcome no step | Outcome late | ≥0.25 s later | Gap ≥ 0.4 | Sight > position | Save→goal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1001 | 0.000 | 0.560 | 0.700 | 0.000 | 0.061 | 0.639 | 0.061 | saved | goal | goal | yes | yes | yes | yes |
| 1002 | 0.000 | 0.600 | 0.700 | 0.000 | 0.114 | 0.586 | 0.114 | saved | goal | goal | yes | yes | yes | yes |
| 1003 | 0.000 | 0.520 | 0.085 | 0.000 | 0.000 | 0.085 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1004 | 0.000 | 0.560 | 0.700 | 0.037 | 0.399 | 0.301 | 0.362 | saved | goal | saved | yes | yes | no | yes |
| 1005 | 0.000 | 0.560 | 0.490 | 0.000 | 0.000 | 0.490 | 0.000 | post | post | post | yes | yes | yes | no |
| 1006 | 0.000 | 0.600 | 0.700 | 0.000 | 0.115 | 0.585 | 0.115 | goal | goal | goal | yes | yes | yes | no |
| 1007 | 0.000 | 0.560 | 0.500 | 0.000 | 0.000 | 0.500 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1008 | 0.000 | 0.600 | 0.700 | 0.000 | 0.136 | 0.564 | 0.136 | saved | goal | goal | yes | yes | yes | yes |
| 1009 | 0.000 | 0.480 | 0.700 | 0.000 | 0.120 | 0.580 | 0.120 | goal | goal | goal | yes | yes | yes | no |
| 1010 | 0.000 | 0.640 | 0.700 | 0.097 | 0.449 | 0.251 | 0.352 | goal | goal | goal | yes | yes | no | no |
| 1011 | 0.000 | 0.600 | 0.700 | 0.075 | 0.415 | 0.285 | 0.341 | saved | goal | saved | yes | yes | no | yes |
| 1012 | 0.000 | 0.560 | 0.700 | 0.000 | 0.081 | 0.619 | 0.081 | saved | goal | saved | yes | yes | yes | yes |
| 1013 | 0.000 | 0.560 | 0.700 | 0.000 | 0.042 | 0.658 | 0.042 | saved | goal | goal | yes | yes | yes | yes |
| 1014 | 0.000 | 0.560 | 0.700 | 0.000 | 0.299 | 0.401 | 0.299 | saved | goal | saved | yes | yes | yes | yes |
| 1015 | 0.000 | 0.640 | 0.700 | 0.000 | 0.334 | 0.366 | 0.334 | saved | goal | saved | yes | yes | yes | yes |
| 1016 | 0.000 | 0.600 | 0.700 | 0.000 | 0.203 | 0.497 | 0.203 | goal | goal | goal | yes | yes | yes | no |
| 1017 | 0.000 | 0.520 | 0.700 | 0.000 | 0.093 | 0.607 | 0.093 | saved | goal | goal | yes | yes | yes | yes |
| 1018 | 0.000 | 0.440 | 0.369 | 0.000 | 0.000 | 0.369 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1019 | 0.000 | 0.520 | 0.098 | 0.000 | 0.000 | 0.098 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1020 | 0.000 | 0.560 | 0.700 | 0.038 | 0.381 | 0.319 | 0.344 | saved | goal | goal | yes | yes | no | yes |
| 1021 | 0.000 | 0.480 | 0.203 | 0.000 | 0.000 | 0.203 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1022 | 0.000 | 0.480 | 0.599 | 0.000 | 0.000 | 0.599 | 0.000 | post | post | post | yes | yes | yes | no |
| 1023 | 0.000 | 0.520 | 0.700 | 0.000 | 0.333 | 0.367 | 0.333 | goal | goal | goal | yes | yes | yes | no |
| 1024 | 0.000 | 0.600 | 0.700 | 0.000 | 0.360 | 0.340 | 0.360 | saved | goal | saved | yes | yes | no | yes |
| 1025 | 0.000 | 0.440 | 0.357 | 0.000 | 0.000 | 0.357 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1026 | 0.000 | 0.560 | 0.700 | 0.027 | 0.360 | 0.340 | 0.334 | saved | goal | saved | yes | yes | yes | yes |
| 1027 | 0.000 | 0.560 | 0.700 | 0.000 | 0.040 | 0.660 | 0.040 | saved | goal | goal | yes | yes | yes | yes |
| 1028 | 0.000 | 0.480 | 0.700 | 0.000 | 0.099 | 0.601 | 0.099 | saved | goal | goal | yes | yes | yes | yes |
| 1029 | 0.000 | 0.480 | 0.674 | 0.000 | 0.000 | 0.674 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1030 | 0.000 | 0.520 | 0.700 | 0.000 | 0.006 | 0.694 | 0.006 | saved | goal | goal | yes | yes | yes | yes |
| 1031 | 0.000 | 0.600 | 0.700 | 0.000 | 0.116 | 0.584 | 0.116 | goal | goal | goal | yes | yes | yes | no |
| 1032 | 0.000 | 0.520 | 0.700 | 0.000 | 0.121 | 0.579 | 0.121 | saved | goal | goal | yes | yes | yes | yes |
| 1033 | 0.000 | 0.560 | 0.423 | 0.000 | 0.000 | 0.423 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1034 | 0.000 | 0.560 | 0.661 | 0.000 | 0.000 | 0.661 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1035 | 0.000 | 0.480 | 0.420 | 0.000 | 0.000 | 0.420 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1036 | 0.000 | 0.440 | 0.437 | 0.000 | 0.000 | 0.437 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1037 | 0.000 | 0.560 | 0.700 | 0.000 | 0.000 | 0.700 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1038 | 0.000 | 0.520 | 0.341 | 0.000 | 0.000 | 0.341 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1039 | 0.000 | 0.520 | 0.700 | 0.000 | 0.186 | 0.514 | 0.186 | saved | goal | goal | yes | yes | yes | yes |
| 1040 | 0.000 | 0.520 | 0.681 | 0.000 | 0.000 | 0.681 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1041 | 0.000 | 0.520 | 0.599 | 0.000 | 0.000 | 0.599 | 0.000 | post | post | post | yes | yes | yes | no |
| 1042 | 0.000 | 0.480 | 0.536 | 0.000 | 0.000 | 0.536 | 0.000 | post | post | post | yes | yes | yes | no |
| 1043 | 0.000 | 0.560 | 0.700 | 0.000 | 0.139 | 0.561 | 0.139 | goal | goal | goal | yes | yes | yes | no |
| 1044 | 0.000 | 0.400 | 0.123 | 0.000 | 0.000 | 0.123 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1045 | 0.000 | 0.480 | 0.361 | 0.000 | 0.000 | 0.361 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1046 | 0.000 | 0.520 | 0.700 | 0.000 | 0.258 | 0.442 | 0.258 | saved | goal | saved | yes | yes | yes | yes |
| 1047 | 0.000 | 0.480 | 0.421 | 0.000 | 0.000 | 0.421 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1048 | 0.000 | 0.560 | 0.590 | 0.000 | 0.000 | 0.590 | 0.000 | post | post | post | yes | yes | yes | no |
| 1049 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1050 | 0.000 | 0.520 | 0.700 | 0.000 | 0.166 | 0.534 | 0.166 | saved | goal | goal | yes | yes | yes | yes |
| 1051 | 0.000 | 0.640 | 0.700 | 0.156 | 0.500 | 0.200 | 0.345 | goal | goal | goal | yes | yes | no | no |
| 1052 | 0.000 | 0.560 | 0.700 | 0.000 | 0.095 | 0.605 | 0.095 | saved | goal | goal | yes | yes | yes | yes |
| 1053 | 0.000 | 0.480 | 0.316 | 0.000 | 0.000 | 0.316 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1054 | 0.000 | 0.560 | 0.698 | 0.000 | 0.000 | 0.698 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1055 | 0.000 | 0.640 | 0.700 | 0.000 | 0.330 | 0.370 | 0.330 | goal | goal | goal | yes | yes | yes | no |
| 1056 | 0.000 | 0.520 | 0.673 | 0.000 | 0.000 | 0.673 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1057 | 0.000 | 0.520 | 0.700 | 0.000 | 0.068 | 0.632 | 0.068 | saved | goal | goal | yes | yes | yes | yes |
| 1058 | 0.000 | 0.440 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1059 | 0.000 | 0.520 | 0.400 | 0.000 | 0.000 | 0.400 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1060 | 0.000 | 0.520 | 0.213 | 0.000 | 0.000 | 0.213 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1061 | 0.000 | 0.440 | 0.263 | 0.000 | 0.000 | 0.263 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1062 | 0.000 | 0.480 | 0.296 | 0.000 | 0.000 | 0.296 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1063 | 0.000 | 0.560 | 0.700 | 0.000 | 0.000 | 0.700 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1064 | 0.000 | 0.640 | 0.700 | 0.053 | 0.382 | 0.318 | 0.329 | saved | saved | saved | yes | yes | no | no |
| 1065 | 0.000 | 0.520 | 0.696 | 0.000 | 0.000 | 0.696 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1066 | 0.000 | 0.560 | 0.406 | 0.000 | 0.000 | 0.406 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1067 | 0.000 | 0.520 | 0.700 | 0.000 | 0.182 | 0.518 | 0.182 | goal | goal | goal | yes | yes | yes | no |
| 1068 | 0.000 | 0.560 | 0.689 | 0.000 | 0.000 | 0.689 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1069 | 0.000 | 0.560 | 0.551 | 0.000 | 0.000 | 0.551 | 0.000 | post | post | post | yes | yes | yes | no |
| 1070 | 0.000 | 0.600 | 0.700 | 0.000 | 0.131 | 0.569 | 0.131 | saved | goal | goal | yes | yes | yes | yes |
| 1071 | 0.000 | 0.520 | 0.346 | 0.000 | 0.000 | 0.346 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1072 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1073 | 0.000 | 0.400 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1074 | 0.000 | 0.480 | 0.648 | 0.000 | 0.000 | 0.648 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1075 | 0.000 | 0.520 | 0.700 | 0.000 | 0.195 | 0.505 | 0.195 | goal | goal | goal | yes | yes | yes | no |
| 1076 | 0.000 | 0.560 | 0.523 | 0.000 | 0.000 | 0.523 | 0.000 | post | post | post | yes | yes | yes | no |
| 1077 | 0.000 | 0.520 | 0.647 | 0.000 | 0.000 | 0.647 | 0.000 | saved | post | post | yes | yes | yes | no |
| 1078 | 0.000 | 0.560 | 0.700 | 0.000 | 0.000 | 0.700 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1079 | 0.000 | 0.560 | 0.217 | 0.000 | 0.000 | 0.217 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1080 | 0.000 | 0.600 | 0.700 | 0.000 | 0.090 | 0.610 | 0.090 | saved | goal | goal | yes | yes | yes | yes |
| 1081 | 0.000 | 0.480 | 0.182 | 0.000 | 0.000 | 0.182 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1082 | 0.000 | 0.440 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1083 | 0.000 | 0.600 | 0.578 | 0.000 | 0.000 | 0.578 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1084 | 0.000 | 0.600 | 0.664 | 0.000 | 0.000 | 0.664 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1085 | 0.000 | 0.480 | 0.510 | 0.000 | 0.000 | 0.510 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1086 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1087 | 0.000 | 0.520 | 0.596 | 0.000 | 0.000 | 0.596 | 0.000 | post | post | post | yes | yes | yes | no |
| 1088 | 0.000 | 0.640 | 0.700 | 0.095 | 0.431 | 0.269 | 0.335 | goal | goal | goal | yes | yes | no | no |
| 1089 | 0.000 | 0.480 | 0.524 | 0.000 | 0.000 | 0.524 | 0.000 | post | post | post | yes | yes | yes | no |
| 1090 | 0.000 | 0.480 | 0.700 | 0.000 | 0.124 | 0.576 | 0.124 | saved | goal | goal | yes | yes | yes | yes |
| 1091 | 0.000 | 0.480 | 0.610 | 0.000 | 0.000 | 0.610 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1092 | 0.000 | 0.520 | 0.360 | 0.000 | 0.000 | 0.360 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1093 | 0.000 | 0.640 | 0.700 | 0.000 | 0.274 | 0.426 | 0.274 | saved | goal | saved | yes | yes | yes | yes |
| 1094 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1095 | 0.000 | 0.520 | 0.700 | 0.000 | 0.075 | 0.625 | 0.075 | goal | goal | goal | yes | yes | yes | no |
| 1096 | 0.000 | 0.440 | 0.559 | 0.000 | 0.000 | 0.559 | 0.000 | post | post | post | yes | yes | yes | no |
| 1097 | 0.000 | 0.480 | 0.700 | 0.000 | 0.020 | 0.680 | 0.020 | saved | goal | goal | yes | yes | yes | yes |
| 1098 | 0.000 | 0.560 | 0.700 | 0.000 | 0.060 | 0.640 | 0.060 | saved | goal | goal | yes | yes | yes | yes |
| 1099 | 0.000 | 0.560 | 0.623 | 0.000 | 0.000 | 0.623 | 0.000 | post | post | post | yes | yes | yes | no |
| 1100 | 0.000 | 0.680 | 0.700 | 0.049 | 0.414 | 0.286 | 0.365 | saved | goal | saved | yes | yes | no | yes |
| 1101 | 0.000 | 0.400 | 0.043 | 0.000 | 0.000 | 0.043 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1102 | 0.000 | 0.520 | 0.274 | 0.000 | 0.000 | 0.274 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1103 | 0.000 | 0.560 | 0.563 | 0.000 | 0.000 | 0.563 | 0.000 | post | post | post | yes | yes | yes | no |
| 1104 | 0.000 | 0.560 | 0.700 | 0.000 | 0.167 | 0.533 | 0.167 | saved | goal | goal | yes | yes | yes | yes |
| 1105 | 0.000 | 0.480 | 0.700 | 0.000 | 0.155 | 0.545 | 0.155 | saved | goal | saved | yes | yes | yes | yes |
| 1106 | 0.000 | 0.600 | 0.700 | 0.000 | 0.072 | 0.628 | 0.072 | saved | goal | goal | yes | yes | yes | yes |
| 1107 | 0.000 | 0.560 | 0.700 | 0.000 | 0.213 | 0.487 | 0.213 | saved | goal | saved | yes | yes | yes | yes |
| 1108 | 0.000 | 0.440 | 0.265 | 0.000 | 0.000 | 0.265 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1109 | 0.000 | 0.520 | 0.700 | 0.000 | 0.206 | 0.494 | 0.206 | saved | goal | goal | yes | yes | yes | yes |
| 1110 | 0.000 | 0.520 | 0.700 | 0.000 | 0.310 | 0.390 | 0.310 | saved | goal | saved | yes | yes | yes | yes |
| 1111 | 0.000 | 0.560 | 0.700 | 0.069 | 0.422 | 0.278 | 0.353 | saved | goal | goal | yes | yes | no | yes |
| 1112 | 0.000 | 0.640 | 0.700 | 0.015 | 0.371 | 0.329 | 0.356 | saved | goal | saved | yes | yes | no | yes |
| 1113 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1114 | 0.000 | 0.520 | 0.700 | 0.000 | 0.186 | 0.514 | 0.186 | saved | goal | goal | yes | yes | yes | yes |
| 1115 | 0.000 | 0.560 | 0.700 | 0.000 | 0.257 | 0.443 | 0.257 | saved | goal | goal | yes | yes | yes | yes |
| 1116 | 0.000 | 0.520 | 0.558 | 0.000 | 0.000 | 0.558 | 0.000 | post | post | post | yes | yes | yes | no |
| 1117 | 0.000 | 0.560 | 0.637 | 0.000 | 0.000 | 0.637 | 0.000 | post | post | post | yes | yes | yes | no |
| 1118 | 0.000 | 0.560 | 0.700 | 0.000 | 0.062 | 0.638 | 0.062 | saved | goal | goal | yes | yes | yes | yes |
| 1119 | 0.000 | 0.520 | 0.513 | 0.000 | 0.000 | 0.513 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1120 | 0.000 | 0.560 | 0.700 | 0.082 | 0.425 | 0.275 | 0.344 | goal | goal | goal | yes | yes | no | no |
| 1121 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1122 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1123 | 0.000 | 0.520 | 0.468 | 0.000 | 0.000 | 0.468 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1124 | 0.000 | 0.520 | 0.700 | 0.000 | 0.128 | 0.572 | 0.128 | saved | goal | goal | yes | yes | yes | yes |
| 1125 | 0.000 | 0.600 | 0.700 | 0.000 | 0.298 | 0.402 | 0.298 | saved | goal | saved | yes | yes | yes | yes |
| 1126 | 0.000 | 0.560 | 0.700 | 0.000 | 0.321 | 0.379 | 0.321 | saved | goal | goal | yes | yes | yes | yes |
| 1127 | 0.000 | 0.520 | 0.438 | 0.000 | 0.000 | 0.438 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1128 | 0.000 | 0.600 | 0.700 | 0.000 | 0.216 | 0.484 | 0.216 | goal | goal | goal | yes | yes | yes | no |
| 1129 | 0.000 | 0.560 | 0.650 | 0.000 | 0.000 | 0.650 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1130 | 0.000 | 0.560 | 0.700 | 0.000 | 0.084 | 0.616 | 0.084 | saved | goal | goal | yes | yes | yes | yes |
| 1131 | 0.000 | 0.560 | 0.700 | 0.000 | 0.280 | 0.420 | 0.280 | goal | goal | goal | yes | yes | yes | no |
| 1132 | 0.000 | 0.480 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1133 | 0.000 | 0.560 | 0.302 | 0.000 | 0.000 | 0.302 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1134 | 0.000 | 0.400 | 0.109 | 0.000 | 0.000 | 0.109 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1135 | 0.000 | 0.480 | 0.643 | 0.000 | 0.000 | 0.643 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1136 | 0.000 | 0.560 | 0.462 | 0.000 | 0.000 | 0.462 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1137 | 0.000 | 0.480 | 0.700 | 0.000 | 0.093 | 0.607 | 0.093 | saved | goal | saved | yes | yes | yes | yes |
| 1138 | 0.000 | 0.520 | 0.700 | 0.000 | 0.326 | 0.374 | 0.326 | saved | goal | goal | yes | yes | yes | yes |
| 1139 | 0.000 | 0.480 | 0.651 | 0.000 | 0.000 | 0.651 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1140 | 0.000 | 0.600 | 0.700 | 0.000 | 0.128 | 0.572 | 0.128 | saved | goal | goal | yes | yes | yes | yes |
| 1141 | 0.000 | 0.560 | 0.700 | 0.000 | 0.018 | 0.682 | 0.018 | saved | goal | goal | yes | yes | yes | yes |
| 1142 | 0.000 | 0.560 | 0.700 | 0.000 | 0.076 | 0.624 | 0.076 | goal | goal | goal | yes | yes | yes | no |
| 1143 | 0.000 | 0.600 | 0.700 | 0.000 | 0.193 | 0.507 | 0.193 | saved | goal | goal | yes | yes | yes | yes |
| 1144 | 0.000 | 0.520 | 0.700 | 0.000 | 0.287 | 0.413 | 0.287 | saved | goal | goal | yes | yes | yes | yes |
| 1145 | 0.000 | 0.480 | 0.700 | 0.000 | 0.149 | 0.551 | 0.149 | saved | goal | goal | yes | yes | yes | yes |
| 1146 | 0.000 | 0.640 | 0.700 | 0.022 | 0.356 | 0.344 | 0.334 | goal | goal | goal | yes | yes | yes | no |
| 1147 | 0.000 | 0.400 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1148 | 0.000 | 0.600 | 0.700 | 0.109 | 0.457 | 0.243 | 0.348 | saved | goal | saved | yes | yes | no | yes |
| 1149 | 0.000 | 0.520 | 0.700 | 0.000 | 0.180 | 0.520 | 0.180 | saved | goal | goal | yes | yes | yes | yes |
| 1150 | 0.000 | 0.520 | 0.478 | 0.000 | 0.000 | 0.478 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1151 | 0.000 | 0.600 | 0.612 | 0.000 | 0.000 | 0.612 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1152 | 0.000 | 0.480 | 0.318 | 0.000 | 0.000 | 0.318 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1153 | 0.000 | 0.480 | 0.380 | 0.000 | 0.000 | 0.380 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1154 | 0.000 | 0.520 | 0.233 | 0.000 | 0.000 | 0.233 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1155 | 0.000 | 0.520 | 0.538 | 0.000 | 0.000 | 0.538 | 0.000 | post | post | post | yes | yes | yes | no |
| 1156 | 0.000 | 0.520 | 0.700 | 0.000 | 0.077 | 0.623 | 0.077 | saved | goal | goal | yes | yes | yes | yes |
| 1157 | 0.000 | 0.520 | 0.700 | 0.000 | 0.040 | 0.660 | 0.040 | saved | goal | goal | yes | yes | yes | yes |
| 1158 | 0.000 | 0.520 | 0.700 | 0.000 | 0.057 | 0.643 | 0.057 | saved | goal | goal | yes | yes | yes | yes |
| 1159 | 0.000 | 0.400 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1160 | 0.000 | 0.520 | 0.145 | 0.000 | 0.000 | 0.145 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1161 | 0.000 | 0.520 | 0.700 | 0.000 | 0.007 | 0.693 | 0.007 | goal | goal | goal | yes | yes | yes | no |
| 1162 | 0.000 | 0.520 | 0.238 | 0.000 | 0.000 | 0.238 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1163 | 0.000 | 0.600 | 0.700 | 0.000 | 0.056 | 0.644 | 0.056 | saved | goal | goal | yes | yes | yes | yes |
| 1164 | 0.000 | 0.640 | 0.700 | 0.000 | 0.260 | 0.440 | 0.260 | goal | goal | goal | yes | yes | yes | no |
| 1165 | 0.000 | 0.600 | 0.700 | 0.061 | 0.390 | 0.310 | 0.328 | goal | goal | goal | yes | yes | no | no |
| 1166 | 0.000 | 0.520 | 0.700 | 0.000 | 0.126 | 0.574 | 0.126 | saved | goal | saved | yes | yes | yes | yes |
| 1167 | 0.000 | 0.560 | 0.700 | 0.000 | 0.154 | 0.546 | 0.154 | goal | goal | goal | yes | yes | yes | no |
| 1168 | 0.000 | 0.480 | 0.700 | 0.000 | 0.000 | 0.700 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1169 | 0.000 | 0.560 | 0.700 | 0.000 | 0.000 | 0.700 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1170 | 0.000 | 0.520 | 0.258 | 0.000 | 0.000 | 0.258 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1171 | 0.000 | 0.520 | 0.700 | 0.000 | 0.196 | 0.504 | 0.196 | goal | goal | goal | yes | yes | yes | no |
| 1172 | 0.000 | 0.600 | 0.700 | 0.000 | 0.036 | 0.664 | 0.036 | saved | goal | goal | yes | yes | yes | yes |
| 1173 | 0.000 | 0.440 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 1174 | 0.000 | 0.520 | 0.497 | 0.000 | 0.000 | 0.497 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1175 | 0.000 | 0.640 | 0.700 | 0.000 | 0.305 | 0.395 | 0.305 | saved | goal | saved | yes | yes | yes | yes |
| 1176 | 0.000 | 0.520 | 0.700 | 0.000 | 0.020 | 0.680 | 0.020 | saved | goal | goal | yes | yes | yes | yes |
| 1177 | 0.000 | 0.600 | 0.700 | 0.000 | 0.128 | 0.572 | 0.128 | goal | goal | goal | yes | yes | yes | no |
| 1178 | 0.000 | 0.480 | 0.572 | 0.000 | 0.000 | 0.572 | 0.000 | post | post | post | yes | yes | yes | no |
| 1179 | 0.000 | 0.560 | 0.700 | 0.000 | 0.238 | 0.462 | 0.238 | goal | goal | goal | yes | yes | yes | no |
| 1180 | 0.000 | 0.520 | 0.695 | 0.000 | 0.000 | 0.695 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 1181 | 0.000 | 0.560 | 0.700 | 0.000 | 0.148 | 0.552 | 0.148 | goal | goal | goal | yes | yes | yes | no |
| 1182 | 0.000 | 0.520 | 0.610 | 0.000 | 0.000 | 0.610 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 1183 | 0.000 | 0.480 | 0.700 | 0.000 | 0.063 | 0.637 | 0.063 | saved | goal | goal | yes | yes | yes | yes |
| 1184 | 0.000 | 0.520 | 0.700 | 0.025 | 0.364 | 0.336 | 0.338 | saved | goal | goal | yes | yes | no | yes |
| 1185 | 0.000 | 0.520 | 0.433 | 0.000 | 0.000 | 0.433 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 1186 | 0.000 | 0.480 | 0.700 | 0.000 | 0.002 | 0.698 | 0.002 | saved | goal | goal | yes | yes | yes | yes |
| 1187 | 0.000 | 0.480 | 0.700 | 0.000 | 0.019 | 0.681 | 0.019 | goal | goal | goal | yes | yes | yes | no |
| 1188 | 0.000 | 0.560 | 0.637 | 0.000 | 0.000 | 0.637 | 0.000 | saved | post | post | yes | yes | yes | no |
| 1189 | 0.000 | 0.600 | 0.583 | 0.000 | 0.000 | 0.583 | 0.000 | post | post | post | yes | yes | yes | no |
| 1190 | 0.000 | 0.600 | 0.700 | 0.000 | 0.279 | 0.421 | 0.279 | saved | goal | goal | yes | yes | yes | yes |
| 1191 | 0.000 | 0.600 | 0.700 | 0.000 | 0.027 | 0.673 | 0.027 | saved | goal | goal | yes | yes | yes | yes |
| 1192 | 0.000 | 0.480 | 0.253 | 0.000 | 0.000 | 0.253 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 1193 | 0.000 | 0.600 | 0.598 | 0.000 | 0.000 | 0.598 | 0.000 | post | post | post | yes | yes | yes | no |
| 1194 | 0.000 | 0.480 | 0.700 | 0.000 | 0.103 | 0.597 | 0.103 | saved | goal | goal | yes | yes | yes | yes |
| 1195 | 0.000 | 0.480 | 0.502 | 0.000 | 0.000 | 0.502 | 0.000 | post | post | post | yes | yes | yes | no |
| 1196 | 0.000 | 0.560 | 0.700 | 0.000 | 0.315 | 0.385 | 0.315 | saved | goal | goal | yes | yes | yes | yes |
| 1197 | 0.000 | 0.560 | 0.700 | 0.024 | 0.359 | 0.341 | 0.335 | saved | goal | goal | yes | yes | yes | yes |
| 1198 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 1199 | 0.000 | 0.520 | 0.700 | 0.000 | 0.066 | 0.634 | 0.066 | saved | goal | goal | yes | yes | yes | yes |
