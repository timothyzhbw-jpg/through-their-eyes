# Hero lens — `blind_side_run`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H8`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 40/40 (100%) | ≥ 60% |
| Intervention changes the outcome | 39/40 (98%) | ≥ 60% |
| … factual action kept the ball | 40/40 | — |
| … the ball is lost after the intervention | 1/40 | — |
| Selected lens: scan · space · pressure | 40 · 0 · 0 | — |
| Median margin of `scan` over the next lens (xT) | 0.0028 | — |
| Mean realised ΔxT (factual − intervention) | +0.0826 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.0707 | +0.0684 | +0.0004 | `pass:H9` | kept | `pass:H7` | kept | +0.076 |
| 101 | scan | +0.0883 | +0.0857 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.086 |
| 102 | scan | +0.0926 | +0.0898 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.078 |
| 103 | scan | +0.0780 | +0.0757 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.071 |
| 104 | scan | +0.1003 | +0.0976 | +0.0000 | `pass:H9` | kept | `carry` | kept | +0.085 |
| 105 | scan | +0.0883 | +0.0859 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.072 |
| 106 | scan | +0.0995 | +0.0974 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.096 |
| 107 | scan | +0.0741 | +0.0717 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.079 |
| 108 | scan | +0.0861 | +0.0843 | +0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.077 |
| 109 | scan | +0.0960 | +0.0928 | +0.0001 | `pass:H9` | kept | `pass:H4` | kept | +0.081 |
| 110 | scan | +0.0916 | +0.0882 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.075 |
| 111 | scan | +0.0729 | +0.0693 | +0.0001 | `pass:H9` | kept | `pass:H1` | kept | +0.069 |
| 112 | scan | +0.0945 | +0.0920 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.105 |
| 113 | scan | +0.0647 | +0.0634 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.065 |
| 114 | scan | +0.0808 | +0.0778 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.064 |
| 115 | scan | +0.0951 | +0.0921 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.089 |
| 116 | scan | +0.0762 | +0.0737 | +0.0002 | `pass:H9` | kept | `pass:H1` | kept | +0.090 |
| 117 | scan | +0.0906 | +0.0883 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.084 |
| 118 | scan | +0.0760 | +0.0727 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.070 |
| 119 | scan | +0.1419 | +0.0990 | +0.0000 | `pass:H9` | kept | `pass:H9` | lost | +0.135 |
| 120 | scan | +0.1049 | +0.1025 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.089 |
| 121 | scan | +0.0881 | +0.0856 | +0.0001 | `pass:H9` | kept | `pass:H2` | kept | +0.082 |
| 122 | scan | +0.1013 | +0.0994 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.096 |
| 123 | scan | +0.0900 | +0.0870 | +0.0001 | `pass:H9` | kept | `pass:H4` | kept | +0.085 |
| 124 | scan | +0.1009 | +0.0980 | +0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.099 |
| 125 | scan | +0.0700 | +0.0674 | +0.0000 | `pass:H9` | kept | `carry` | kept | +0.082 |
| 126 | scan | +0.0982 | +0.0951 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.088 |
| 127 | scan | +0.1002 | +0.0975 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.090 |
| 128 | scan | +0.0775 | +0.0754 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.084 |
| 129 | scan | +0.0797 | +0.0758 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.068 |
| 130 | scan | +0.0708 | +0.0671 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.067 |
| 131 | scan | +0.0720 | +0.0685 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.070 |
| 132 | scan | +0.0719 | +0.0701 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.074 |
| 133 | scan | +0.0861 | +0.0831 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.087 |
| 134 | scan | +0.0698 | +0.0666 | +0.0000 | `pass:H9` | kept | `carry` | kept | +0.082 |
| 135 | scan | +0.1170 | +0.0842 | +0.0001 | `pass:H9` | kept | `carry` | kept | +0.091 |
| 136 | scan | +0.0946 | +0.0911 | +0.0000 | `pass:H9` | kept | `pass:H5` | kept | +0.093 |
| 137 | scan | +0.0908 | +0.0873 | +0.0000 | `pass:H9` | kept | `pass:H3` | kept | +0.077 |
| 138 | scan | +0.1153 | +0.0794 | +0.0001 | `pass:H9` | kept | `carry` | kept | +0.078 |
| 139 | scan | +0.0800 | +0.0772 | +0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.078 |
