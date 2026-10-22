# Shot hero — `far_post_finish`

Seeds 1000–1199 (200). Counterfactual: drop the key scan of `H9` and re-simulate from its start with keyed randomness. Default keeper reach speed: 3 m/s.

P_goal re-scores each run's chosen placement with `placed_shot_value` on `true_decision_context`: the true positions, velocities and ball at that run's decision frame, belief age zero, and the opponents' keeper (A1). The last incoming pass determines the near side exactly as in the engine. A pass or carry has zero immediate shot probability and is labelled `no shot`.

| Metric | Value | Target |
|---|---|---|
| Placement changed without the key scan | 198/200 (99%) | ≥ 60% |
| Median ΔP_goal on truth (factual − counterfactual) | +0.520 | ≥ 0.300 |
| Design rule: A1 unseen from frame 1 until the key scan (factual) and until the decision (counterfactual) | 198/200 (99%) | ≥ 90% |
| Shot outcome label changed (e.g. wide -> saved), reported | 162/200 (81%) | reported |
| Goal status changed (goal with the look vs without), reported | 127/200 (64%); lost without the look: 104; gained without it: 23 | reported |
| Placement changed, v_dive = 2.5 m/s (uncited, swept) | 198/200 (99%) | ≥ 60% |
| Placement changed, v_dive = 4.0 m/s (uncited, swept) | 198/200 (99%) | ≥ 60% |

Design visibility uses `player_visibility` < 0.5 on every frame in each stated interval, including the counterfactual decision frame; frame zero is excluded because everyone starts known. The sweep re-runs both decisions and restores the default keeper afterwards.

| Seed | Factual action | P_goal on truth | Factual outcome | Counterfactual action | P_goal on truth | Counterfactual outcome | Placement changed | ΔP_goal | Design rule | Goal status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | `shot:far` | 0.790 | wide | `shot:near` | 0.256 | saved | yes | +0.534 | yes | no goal → no goal |
| 1001 | `shot:far` | 0.776 | wide | `shot:far` | 0.776 | wide | no | +0.000 | no | no goal → no goal |
| 1002 | `shot:far` | 0.796 | goal | `shot:near` | 0.288 | saved | yes | +0.508 | yes | goal → no goal |
| 1003 | `shot:far` | 0.796 | goal | `shot:near` | 0.255 | saved | yes | +0.542 | yes | goal → no goal |
| 1004 | `shot:far` | 0.783 | goal | `shot:near` | 0.269 | wide | yes | +0.514 | yes | goal → no goal |
| 1005 | `shot:far` | 0.789 | goal | `shot:near` | 0.253 | saved | yes | +0.536 | yes | goal → no goal |
| 1006 | `shot:far` | 0.785 | goal | `shot:near` | 0.262 | wide | yes | +0.523 | yes | goal → no goal |
| 1007 | `shot:far` | 0.792 | goal | `shot:near` | 0.265 | goal | yes | +0.527 | yes | goal → goal |
| 1008 | `shot:far` | 0.798 | goal | `shot:near` | 0.265 | wide | yes | +0.533 | yes | goal → no goal |
| 1009 | `shot:far` | 0.783 | goal | `shot:near` | 0.279 | saved | yes | +0.504 | yes | goal → no goal |
| 1010 | `shot:far` | 0.784 | wide | `shot:near` | 0.255 | goal | yes | +0.529 | yes | no goal → goal |
| 1011 | `shot:far` | 0.777 | goal | `shot:near` | 0.281 | wide | yes | +0.496 | yes | goal → no goal |
| 1012 | `shot:far` | 0.803 | goal | `shot:near` | 0.280 | goal | yes | +0.522 | yes | goal → goal |
| 1013 | `shot:far` | 0.780 | wide | `shot:near` | 0.264 | saved | yes | +0.516 | yes | no goal → no goal |
| 1014 | `shot:far` | 0.788 | goal | `shot:near` | 0.249 | wide | yes | +0.539 | yes | goal → no goal |
| 1015 | `shot:far` | 0.737 | goal | `shot:near` | 0.253 | saved | yes | +0.484 | yes | goal → no goal |
| 1016 | `shot:far` | 0.800 | wide | `shot:near` | 0.259 | saved | yes | +0.541 | yes | no goal → no goal |
| 1017 | `shot:far` | 0.787 | goal | `shot:near` | 0.253 | goal | yes | +0.534 | yes | goal → goal |
| 1018 | `shot:far` | 0.786 | wide | `shot:near` | 0.260 | goal | yes | +0.526 | yes | no goal → goal |
| 1019 | `shot:far` | 0.785 | goal | `shot:near` | 0.286 | saved | yes | +0.499 | yes | goal → no goal |
| 1020 | `shot:far` | 0.801 | wide | `shot:near` | 0.270 | goal | yes | +0.531 | yes | no goal → goal |
| 1021 | `shot:far` | 0.802 | goal | `shot:near` | 0.289 | saved | yes | +0.512 | yes | goal → no goal |
| 1022 | `shot:far` | 0.798 | wide | `shot:near` | 0.261 | saved | yes | +0.537 | yes | no goal → no goal |
| 1023 | `shot:far` | 0.790 | goal | `shot:near` | 0.254 | saved | yes | +0.536 | yes | goal → no goal |
| 1024 | `shot:far` | 0.791 | goal | `shot:near` | 0.274 | saved | yes | +0.517 | yes | goal → no goal |
| 1025 | `shot:far` | 0.778 | goal | `shot:near` | 0.250 | wide | yes | +0.527 | yes | goal → no goal |
| 1026 | `shot:far` | 0.784 | wide | `shot:near` | 0.251 | saved | yes | +0.533 | yes | no goal → no goal |
| 1027 | `shot:far` | 0.791 | goal | `shot:near` | 0.266 | saved | yes | +0.524 | yes | goal → no goal |
| 1028 | `shot:far` | 0.781 | goal | `shot:near` | 0.268 | wide | yes | +0.514 | yes | goal → no goal |
| 1029 | `shot:far` | 0.775 | wide | `shot:near` | 0.263 | saved | yes | +0.512 | yes | no goal → no goal |
| 1030 | `shot:far` | 0.777 | goal | `shot:near` | 0.264 | wide | yes | +0.514 | yes | goal → no goal |
| 1031 | `shot:far` | 0.783 | goal | `shot:near` | 0.251 | saved | yes | +0.532 | yes | goal → no goal |
| 1032 | `shot:far` | 0.792 | goal | `shot:near` | 0.261 | saved | yes | +0.531 | yes | goal → no goal |
| 1033 | `shot:far` | 0.771 | goal | `shot:near` | 0.270 | wide | yes | +0.500 | yes | goal → no goal |
| 1034 | `shot:far` | 0.782 | goal | `shot:near` | 0.252 | saved | yes | +0.530 | yes | goal → no goal |
| 1035 | `shot:far` | 0.764 | wide | `shot:near` | 0.266 | goal | yes | +0.498 | yes | no goal → goal |
| 1036 | `shot:far` | 0.787 | goal | `shot:near` | 0.263 | wide | yes | +0.524 | yes | goal → no goal |
| 1037 | `shot:far` | 0.789 | goal | `shot:near` | 0.254 | saved | yes | +0.535 | yes | goal → no goal |
| 1038 | `shot:far` | 0.786 | goal | `shot:near` | 0.287 | saved | yes | +0.500 | yes | goal → no goal |
| 1039 | `shot:far` | 0.781 | goal | `shot:near` | 0.260 | goal | yes | +0.521 | yes | goal → goal |
| 1040 | `shot:far` | 0.785 | goal | `shot:near` | 0.253 | saved | yes | +0.532 | yes | goal → no goal |
| 1041 | `shot:far` | 0.789 | goal | `shot:near` | 0.256 | saved | yes | +0.533 | yes | goal → no goal |
| 1042 | `shot:far` | 0.790 | wide | `shot:near` | 0.269 | saved | yes | +0.522 | yes | no goal → no goal |
| 1043 | `shot:far` | 0.791 | wide | `shot:near` | 0.261 | goal | yes | +0.530 | yes | no goal → goal |
| 1044 | `shot:far` | 0.799 | wide | `shot:near` | 0.263 | saved | yes | +0.536 | yes | no goal → no goal |
| 1045 | `shot:far` | 0.795 | goal | `shot:near` | 0.277 | goal | yes | +0.518 | yes | goal → goal |
| 1046 | `shot:far` | 0.793 | goal | `shot:near` | 0.254 | wide | yes | +0.539 | yes | goal → no goal |
| 1047 | `shot:far` | 0.789 | goal | `shot:near` | 0.258 | goal | yes | +0.532 | yes | goal → goal |
| 1048 | `shot:far` | 0.784 | goal | `shot:near` | 0.264 | saved | yes | +0.521 | yes | goal → no goal |
| 1049 | `shot:far` | 0.778 | goal | `shot:near` | 0.258 | saved | yes | +0.519 | yes | goal → no goal |
| 1050 | `shot:far` | 0.772 | goal | `shot:near` | 0.261 | saved | yes | +0.511 | yes | goal → no goal |
| 1051 | `shot:far` | 0.780 | wide | `shot:near` | 0.260 | saved | yes | +0.520 | yes | no goal → no goal |
| 1052 | `shot:far` | 0.777 | goal | `shot:near` | 0.265 | wide | yes | +0.512 | yes | goal → no goal |
| 1053 | `shot:far` | 0.789 | goal | `shot:near` | 0.253 | goal | yes | +0.536 | yes | goal → goal |
| 1054 | `shot:far` | 0.765 | goal | `shot:near` | 0.251 | goal | yes | +0.514 | yes | goal → goal |
| 1055 | `shot:far` | 0.779 | goal | `shot:near` | 0.253 | saved | yes | +0.527 | yes | goal → no goal |
| 1056 | `shot:far` | 0.767 | wide | `shot:near` | 0.250 | goal | yes | +0.516 | yes | no goal → goal |
| 1057 | `shot:far` | 0.784 | wide | `shot:near` | 0.276 | saved | yes | +0.509 | yes | no goal → no goal |
| 1058 | `shot:far` | 0.793 | goal | `shot:near` | 0.288 | saved | yes | +0.504 | yes | goal → no goal |
| 1059 | `shot:far` | 0.792 | goal | `shot:near` | 0.275 | saved | yes | +0.517 | yes | goal → no goal |
| 1060 | `shot:far` | 0.772 | wide | `shot:near` | 0.249 | goal | yes | +0.523 | yes | no goal → goal |
| 1061 | `shot:far` | 0.790 | goal | `shot:near` | 0.269 | goal | yes | +0.521 | yes | goal → goal |
| 1062 | `shot:far` | 0.788 | goal | `shot:near` | 0.275 | saved | yes | +0.513 | yes | goal → no goal |
| 1063 | `shot:far` | 0.794 | wide | `shot:near` | 0.267 | saved | yes | +0.527 | yes | no goal → no goal |
| 1064 | `shot:far` | 0.792 | goal | `shot:near` | 0.290 | wide | yes | +0.502 | yes | goal → no goal |
| 1065 | `shot:far` | 0.811 | wide | `shot:near` | 0.266 | saved | yes | +0.545 | yes | no goal → no goal |
| 1066 | `shot:far` | 0.797 | wide | `shot:near` | 0.264 | goal | yes | +0.533 | yes | no goal → goal |
| 1067 | `shot:far` | 0.785 | goal | `shot:near` | 0.251 | wide | yes | +0.534 | yes | goal → no goal |
| 1068 | `shot:far` | 0.772 | goal | `shot:near` | 0.266 | goal | yes | +0.506 | yes | goal → goal |
| 1069 | `shot:far` | 0.775 | goal | `shot:near` | 0.252 | saved | yes | +0.523 | yes | goal → no goal |
| 1070 | `shot:far` | 0.791 | wide | `shot:near` | 0.259 | saved | yes | +0.532 | yes | no goal → no goal |
| 1071 | `shot:far` | 0.766 | goal | `shot:near` | 0.265 | wide | yes | +0.500 | yes | goal → no goal |
| 1072 | `shot:far` | 0.800 | goal | `shot:near` | 0.280 | saved | yes | +0.520 | yes | goal → no goal |
| 1073 | `shot:far` | 0.792 | goal | `shot:far` | 0.792 | goal | no | +0.000 | no | goal → goal |
| 1074 | `shot:far` | 0.792 | goal | `shot:near` | 0.285 | saved | yes | +0.507 | yes | goal → no goal |
| 1075 | `shot:far` | 0.798 | goal | `shot:near` | 0.263 | goal | yes | +0.534 | yes | goal → goal |
| 1076 | `shot:far` | 0.766 | goal | `shot:near` | 0.256 | wide | yes | +0.510 | yes | goal → no goal |
| 1077 | `shot:far` | 0.777 | goal | `shot:near` | 0.265 | saved | yes | +0.511 | yes | goal → no goal |
| 1078 | `shot:far` | 0.771 | wide | `shot:near` | 0.251 | saved | yes | +0.521 | yes | no goal → no goal |
| 1079 | `shot:far` | 0.785 | saved | `shot:near` | 0.267 | wide | yes | +0.518 | yes | no goal → no goal |
| 1080 | `shot:far` | 0.770 | saved | `shot:near` | 0.254 | wide | yes | +0.516 | yes | no goal → no goal |
| 1081 | `shot:far` | 0.757 | wide | `shot:near` | 0.258 | saved | yes | +0.499 | yes | no goal → no goal |
| 1082 | `shot:far` | 0.778 | goal | `shot:near` | 0.276 | goal | yes | +0.503 | yes | goal → goal |
| 1083 | `shot:far` | 0.794 | goal | `shot:near` | 0.271 | wide | yes | +0.523 | yes | goal → no goal |
| 1084 | `shot:far` | 0.797 | goal | `shot:near` | 0.255 | saved | yes | +0.541 | yes | goal → no goal |
| 1085 | `shot:far` | 0.770 | goal | `shot:near` | 0.264 | wide | yes | +0.506 | yes | goal → no goal |
| 1086 | `shot:far` | 0.774 | goal | `shot:near` | 0.274 | saved | yes | +0.500 | yes | goal → no goal |
| 1087 | `shot:far` | 0.784 | wide | `shot:near` | 0.252 | saved | yes | +0.533 | yes | no goal → no goal |
| 1088 | `shot:far` | 0.786 | wide | `shot:near` | 0.260 | saved | yes | +0.527 | yes | no goal → no goal |
| 1089 | `shot:far` | 0.794 | goal | `shot:near` | 0.281 | saved | yes | +0.513 | yes | goal → no goal |
| 1090 | `shot:far` | 0.777 | goal | `shot:near` | 0.261 | saved | yes | +0.516 | yes | goal → no goal |
| 1091 | `shot:far` | 0.788 | wide | `shot:near` | 0.293 | goal | yes | +0.495 | yes | no goal → goal |
| 1092 | `shot:far` | 0.792 | goal | `shot:near` | 0.290 | wide | yes | +0.502 | yes | goal → no goal |
| 1093 | `shot:far` | 0.799 | goal | `shot:near` | 0.264 | goal | yes | +0.535 | yes | goal → goal |
| 1094 | `shot:far` | 0.782 | wide | `shot:near` | 0.286 | saved | yes | +0.497 | yes | no goal → no goal |
| 1095 | `shot:far` | 0.783 | wide | `shot:near` | 0.252 | saved | yes | +0.531 | yes | no goal → no goal |
| 1096 | `shot:far` | 0.798 | wide | `shot:near` | 0.260 | goal | yes | +0.538 | yes | no goal → goal |
| 1097 | `shot:far` | 0.763 | saved | `shot:near` | 0.250 | wide | yes | +0.513 | yes | no goal → no goal |
| 1098 | `shot:far` | 0.791 | wide | `shot:near` | 0.269 | saved | yes | +0.521 | yes | no goal → no goal |
| 1099 | `shot:far` | 0.780 | goal | `shot:near` | 0.276 | goal | yes | +0.504 | yes | goal → goal |
| 1100 | `shot:far` | 0.810 | wide | `shot:near` | 0.264 | goal | yes | +0.546 | yes | no goal → goal |
| 1101 | `shot:far` | 0.768 | goal | `shot:near` | 0.269 | goal | yes | +0.500 | yes | goal → goal |
| 1102 | `shot:far` | 0.778 | goal | `shot:near` | 0.260 | goal | yes | +0.518 | yes | goal → goal |
| 1103 | `shot:far` | 0.771 | goal | `shot:near` | 0.262 | saved | yes | +0.509 | yes | goal → no goal |
| 1104 | `shot:far` | 0.778 | wide | `shot:near` | 0.273 | saved | yes | +0.505 | yes | no goal → no goal |
| 1105 | `shot:far` | 0.795 | goal | `shot:near` | 0.289 | wide | yes | +0.505 | yes | goal → no goal |
| 1106 | `shot:far` | 0.788 | goal | `shot:near` | 0.280 | saved | yes | +0.508 | yes | goal → no goal |
| 1107 | `shot:far` | 0.792 | goal | `shot:near` | 0.283 | wide | yes | +0.508 | yes | goal → no goal |
| 1108 | `shot:far` | 0.790 | goal | `shot:near` | 0.266 | saved | yes | +0.525 | yes | goal → no goal |
| 1109 | `shot:far` | 0.794 | goal | `shot:near` | 0.290 | saved | yes | +0.504 | yes | goal → no goal |
| 1110 | `shot:far` | 0.764 | goal | `shot:near` | 0.274 | saved | yes | +0.490 | yes | goal → no goal |
| 1111 | `shot:far` | 0.790 | wide | `shot:near` | 0.255 | saved | yes | +0.535 | yes | no goal → no goal |
| 1112 | `shot:far` | 0.779 | goal | `shot:near` | 0.250 | saved | yes | +0.529 | yes | goal → no goal |
| 1113 | `shot:far` | 0.808 | goal | `shot:near` | 0.261 | saved | yes | +0.546 | yes | goal → no goal |
| 1114 | `shot:far` | 0.776 | goal | `shot:near` | 0.252 | saved | yes | +0.524 | yes | goal → no goal |
| 1115 | `shot:far` | 0.783 | goal | `shot:near` | 0.254 | goal | yes | +0.529 | yes | goal → goal |
| 1116 | `shot:far` | 0.784 | wide | `shot:near` | 0.250 | goal | yes | +0.534 | yes | no goal → goal |
| 1117 | `shot:far` | 0.781 | goal | `shot:near` | 0.272 | saved | yes | +0.509 | yes | goal → no goal |
| 1118 | `shot:far` | 0.789 | goal | `shot:near` | 0.264 | goal | yes | +0.526 | yes | goal → goal |
| 1119 | `shot:far` | 0.787 | goal | `shot:near` | 0.285 | goal | yes | +0.502 | yes | goal → goal |
| 1120 | `shot:far` | 0.793 | wide | `shot:near` | 0.254 | goal | yes | +0.540 | yes | no goal → goal |
| 1121 | `shot:far` | 0.785 | goal | `shot:near` | 0.283 | wide | yes | +0.502 | yes | goal → no goal |
| 1122 | `shot:far` | 0.774 | goal | `shot:near` | 0.259 | saved | yes | +0.515 | yes | goal → no goal |
| 1123 | `shot:far` | 0.787 | goal | `shot:near` | 0.253 | goal | yes | +0.534 | yes | goal → goal |
| 1124 | `shot:far` | 0.782 | goal | `shot:near` | 0.277 | wide | yes | +0.505 | yes | goal → no goal |
| 1125 | `shot:far` | 0.788 | wide | `shot:near` | 0.271 | saved | yes | +0.517 | yes | no goal → no goal |
| 1126 | `shot:far` | 0.768 | goal | `shot:near` | 0.257 | saved | yes | +0.511 | yes | goal → no goal |
| 1127 | `shot:far` | 0.805 | goal | `shot:near` | 0.262 | goal | yes | +0.544 | yes | goal → goal |
| 1128 | `shot:far` | 0.782 | wide | `shot:near` | 0.259 | goal | yes | +0.523 | yes | no goal → goal |
| 1129 | `shot:far` | 0.785 | goal | `shot:near` | 0.261 | saved | yes | +0.523 | yes | goal → no goal |
| 1130 | `shot:far` | 0.772 | goal | `shot:near` | 0.265 | goal | yes | +0.507 | yes | goal → goal |
| 1131 | `shot:far` | 0.776 | goal | `shot:near` | 0.285 | goal | yes | +0.492 | yes | goal → goal |
| 1132 | `shot:far` | 0.793 | wide | `shot:near` | 0.263 | saved | yes | +0.531 | yes | no goal → no goal |
| 1133 | `shot:far` | 0.784 | wide | `shot:near` | 0.256 | saved | yes | +0.528 | yes | no goal → no goal |
| 1134 | `shot:far` | 0.783 | goal | `shot:near` | 0.254 | saved | yes | +0.529 | yes | goal → no goal |
| 1135 | `shot:far` | 0.795 | goal | `shot:near` | 0.272 | saved | yes | +0.523 | yes | goal → no goal |
| 1136 | `shot:far` | 0.785 | goal | `shot:near` | 0.258 | goal | yes | +0.528 | yes | goal → goal |
| 1137 | `shot:far` | 0.780 | goal | `shot:near` | 0.257 | wide | yes | +0.523 | yes | goal → no goal |
| 1138 | `shot:far` | 0.781 | goal | `shot:near` | 0.255 | goal | yes | +0.525 | yes | goal → goal |
| 1139 | `shot:far` | 0.789 | goal | `shot:near` | 0.273 | saved | yes | +0.517 | yes | goal → no goal |
| 1140 | `shot:far` | 0.807 | wide | `shot:near` | 0.262 | goal | yes | +0.546 | yes | no goal → goal |
| 1141 | `shot:far` | 0.787 | wide | `shot:near` | 0.288 | saved | yes | +0.499 | yes | no goal → no goal |
| 1142 | `shot:far` | 0.784 | goal | `shot:near` | 0.278 | saved | yes | +0.507 | yes | goal → no goal |
| 1143 | `shot:far` | 0.787 | goal | `shot:near` | 0.273 | saved | yes | +0.514 | yes | goal → no goal |
| 1144 | `shot:far` | 0.780 | wide | `shot:near` | 0.257 | goal | yes | +0.523 | yes | no goal → goal |
| 1145 | `shot:far` | 0.791 | goal | `shot:near` | 0.278 | wide | yes | +0.513 | yes | goal → no goal |
| 1146 | `shot:far` | 0.787 | goal | `shot:near` | 0.267 | goal | yes | +0.520 | yes | goal → goal |
| 1147 | `shot:far` | 0.788 | goal | `shot:near` | 0.259 | saved | yes | +0.529 | yes | goal → no goal |
| 1148 | `shot:far` | 0.780 | goal | `shot:near` | 0.282 | wide | yes | +0.498 | yes | goal → no goal |
| 1149 | `shot:far` | 0.793 | goal | `shot:near` | 0.276 | saved | yes | +0.517 | yes | goal → no goal |
| 1150 | `shot:far` | 0.795 | goal | `shot:near` | 0.262 | wide | yes | +0.533 | yes | goal → no goal |
| 1151 | `shot:far` | 0.784 | wide | `shot:near` | 0.274 | goal | yes | +0.510 | yes | no goal → goal |
| 1152 | `shot:far` | 0.786 | goal | `shot:near` | 0.256 | wide | yes | +0.530 | yes | goal → no goal |
| 1153 | `shot:far` | 0.784 | goal | `shot:near` | 0.262 | saved | yes | +0.523 | yes | goal → no goal |
| 1154 | `shot:far` | 0.773 | goal | `shot:near` | 0.252 | saved | yes | +0.521 | yes | goal → no goal |
| 1155 | `shot:far` | 0.785 | goal | `shot:near` | 0.271 | saved | yes | +0.514 | yes | goal → no goal |
| 1156 | `shot:far` | 0.789 | wide | `shot:near` | 0.264 | goal | yes | +0.526 | yes | no goal → goal |
| 1157 | `shot:far` | 0.773 | goal | `shot:near` | 0.268 | saved | yes | +0.505 | yes | goal → no goal |
| 1158 | `shot:far` | 0.767 | goal | `shot:near` | 0.263 | goal | yes | +0.504 | yes | goal → goal |
| 1159 | `shot:far` | 0.797 | wide | `shot:near` | 0.277 | saved | yes | +0.520 | yes | no goal → no goal |
| 1160 | `shot:far` | 0.773 | goal | `shot:near` | 0.260 | goal | yes | +0.513 | yes | goal → goal |
| 1161 | `shot:far` | 0.791 | goal | `shot:near` | 0.274 | wide | yes | +0.517 | yes | goal → no goal |
| 1162 | `shot:far` | 0.805 | goal | `shot:near` | 0.279 | goal | yes | +0.526 | yes | goal → goal |
| 1163 | `shot:far` | 0.775 | goal | `shot:near` | 0.261 | saved | yes | +0.514 | yes | goal → no goal |
| 1164 | `shot:far` | 0.773 | goal | `shot:near` | 0.263 | saved | yes | +0.510 | yes | goal → no goal |
| 1165 | `shot:far` | 0.790 | wide | `shot:near` | 0.276 | goal | yes | +0.514 | yes | no goal → goal |
| 1166 | `shot:far` | 0.792 | goal | `shot:near` | 0.284 | saved | yes | +0.507 | yes | goal → no goal |
| 1167 | `shot:far` | 0.779 | wide | `shot:near` | 0.252 | saved | yes | +0.527 | yes | no goal → no goal |
| 1168 | `shot:far` | 0.770 | goal | `shot:near` | 0.252 | goal | yes | +0.518 | yes | goal → goal |
| 1169 | `shot:far` | 0.785 | wide | `shot:near` | 0.257 | goal | yes | +0.528 | yes | no goal → goal |
| 1170 | `shot:far` | 0.777 | wide | `shot:near` | 0.252 | goal | yes | +0.525 | yes | no goal → goal |
| 1171 | `shot:far` | 0.775 | goal | `shot:near` | 0.260 | saved | yes | +0.515 | yes | goal → no goal |
| 1172 | `shot:far` | 0.789 | goal | `shot:near` | 0.270 | goal | yes | +0.519 | yes | goal → goal |
| 1173 | `shot:far` | 0.759 | wide | `shot:near` | 0.259 | saved | yes | +0.500 | yes | no goal → no goal |
| 1174 | `shot:far` | 0.774 | goal | `shot:near` | 0.280 | wide | yes | +0.494 | yes | goal → no goal |
| 1175 | `shot:far` | 0.780 | goal | `shot:near` | 0.262 | goal | yes | +0.518 | yes | goal → goal |
| 1176 | `shot:far` | 0.796 | goal | `shot:near` | 0.271 | saved | yes | +0.525 | yes | goal → no goal |
| 1177 | `shot:far` | 0.804 | goal | `shot:near` | 0.269 | saved | yes | +0.534 | yes | goal → no goal |
| 1178 | `shot:far` | 0.787 | goal | `shot:near` | 0.288 | goal | yes | +0.499 | yes | goal → goal |
| 1179 | `shot:far` | 0.781 | goal | `shot:near` | 0.249 | saved | yes | +0.532 | yes | goal → no goal |
| 1180 | `shot:far` | 0.795 | goal | `shot:near` | 0.261 | saved | yes | +0.534 | yes | goal → no goal |
| 1181 | `shot:far` | 0.777 | goal | `shot:near` | 0.251 | saved | yes | +0.526 | yes | goal → no goal |
| 1182 | `shot:far` | 0.800 | goal | `shot:near` | 0.273 | saved | yes | +0.527 | yes | goal → no goal |
| 1183 | `shot:far` | 0.785 | goal | `shot:near` | 0.251 | saved | yes | +0.534 | yes | goal → no goal |
| 1184 | `shot:far` | 0.791 | wide | `shot:near` | 0.258 | goal | yes | +0.533 | yes | no goal → goal |
| 1185 | `shot:far` | 0.786 | goal | `shot:near` | 0.258 | goal | yes | +0.528 | yes | goal → goal |
| 1186 | `shot:far` | 0.777 | goal | `shot:near` | 0.253 | saved | yes | +0.524 | yes | goal → no goal |
| 1187 | `shot:far` | 0.804 | goal | `shot:near` | 0.269 | wide | yes | +0.535 | yes | goal → no goal |
| 1188 | `shot:far` | 0.779 | goal | `shot:near` | 0.260 | saved | yes | +0.518 | yes | goal → no goal |
| 1189 | `shot:far` | 0.777 | goal | `shot:near` | 0.274 | wide | yes | +0.504 | yes | goal → no goal |
| 1190 | `shot:far` | 0.802 | goal | `shot:near` | 0.258 | saved | yes | +0.544 | yes | goal → no goal |
| 1191 | `shot:far` | 0.782 | goal | `shot:near` | 0.297 | goal | yes | +0.485 | yes | goal → goal |
| 1192 | `shot:far` | 0.773 | wide | `shot:near` | 0.272 | goal | yes | +0.502 | yes | no goal → goal |
| 1193 | `shot:far` | 0.778 | goal | `shot:near` | 0.260 | wide | yes | +0.518 | yes | goal → no goal |
| 1194 | `shot:far` | 0.799 | goal | `shot:near` | 0.291 | wide | yes | +0.507 | yes | goal → no goal |
| 1195 | `shot:far` | 0.772 | wide | `shot:near` | 0.265 | saved | yes | +0.506 | yes | no goal → no goal |
| 1196 | `shot:far` | 0.792 | wide | `shot:near` | 0.276 | saved | yes | +0.516 | yes | no goal → no goal |
| 1197 | `shot:far` | 0.783 | wide | `shot:near` | 0.280 | saved | yes | +0.503 | yes | no goal → no goal |
| 1198 | `shot:far` | 0.776 | goal | `shot:near` | 0.256 | goal | yes | +0.521 | yes | goal → goal |
| 1199 | `shot:far` | 0.775 | goal | `shot:near` | 0.256 | saved | yes | +0.518 | yes | goal → no goal |
