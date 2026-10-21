# Hero lens — `cutback_scan`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H7`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 38/40 (95%) | ≥ 60% |
| Intervention changes the outcome | 38/40 (95%) | ≥ 60% |
| … factual action kept the ball | 40/40 | — |
| … the ball is lost after the intervention | 0/40 | — |
| Selected lens: scan · space · pressure | 38 · 2 · 0 | — |
| Median margin of `scan` over the next lens (xT) | 0.2003 | — |
| Mean realised ΔxT (factual − intervention) | +0.2329 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.2880 | +0.0814 | +0.0073 | `pass:H8` | kept | `carry` | kept | +0.227 |
| 101 | scan | +0.2870 | +0.0771 | -0.0232 | `pass:H8` | kept | `carry` | kept | +0.222 |
| 102 | scan | +0.2866 | +0.0831 | -0.0318 | `pass:H8` | kept | `carry` | kept | +0.234 |
| 103 | scan | +0.2873 | +0.0875 | -0.0028 | `pass:H8` | kept | `carry` | kept | +0.229 |
| 104 | scan | +0.2862 | +0.0917 | +0.0398 | `pass:H8` | kept | `carry` | kept | +0.230 |
| 105 | scan | +0.2445 | +0.0813 | -0.0368 | `pass:H8` | kept | `shot` | shot | +0.298 |
| 106 | scan | +0.2876 | +0.0780 | -0.0136 | `pass:H8` | kept | `carry` | kept | +0.235 |
| 107 | scan | +0.2854 | +0.0841 | +0.0138 | `pass:H8` | kept | `carry` | kept | +0.231 |
| 108 | scan | +0.2826 | +0.0838 | -0.0268 | `pass:H8` | kept | `carry` | kept | +0.229 |
| 109 | scan | +0.2823 | +0.0814 | +0.0016 | `pass:H8` | kept | `carry` | kept | +0.226 |
| 110 | scan | +0.2833 | +0.0888 | -0.0400 | `pass:H8` | kept | `carry` | kept | +0.219 |
| 111 | space | +0.0000 | -0.2797 | +0.0166 | `carry` | kept | `carry` | kept | +0.000 |
| 112 | scan | +0.2442 | +0.0861 | -0.0070 | `pass:H8` | kept | `shot` | shot | +0.303 |
| 113 | space | +0.0000 | -0.2842 | +0.0192 | `carry` | kept | `carry` | kept | +0.000 |
| 114 | scan | +0.2851 | +0.0827 | +0.0385 | `pass:H8` | kept | `carry` | kept | +0.231 |
| 115 | scan | +0.2838 | +0.0847 | -0.0078 | `pass:H8` | kept | `carry` | kept | +0.234 |
| 116 | scan | +0.2817 | +0.0871 | +0.0237 | `pass:H8` | kept | `carry` | kept | +0.232 |
| 117 | scan | +0.2878 | +0.0804 | -0.0204 | `pass:H8` | kept | `carry` | kept | +0.228 |
| 118 | scan | +0.2849 | +0.0914 | +0.0500 | `pass:H8` | kept | `carry` | kept | +0.227 |
| 119 | scan | +0.2855 | +0.0834 | -0.0145 | `pass:H8` | kept | `carry` | kept | +0.222 |
| 120 | scan | +0.2859 | +0.0814 | -0.0162 | `pass:H8` | kept | `carry` | kept | +0.231 |
| 121 | scan | +0.2843 | +0.0747 | +0.0245 | `pass:H8` | kept | `carry` | kept | +0.230 |
| 122 | scan | +0.2459 | +0.0726 | -0.0122 | `pass:H8` | kept | `shot` | shot | +0.301 |
| 123 | scan | +0.2832 | +0.0761 | -0.0040 | `pass:H8` | kept | `carry` | kept | +0.231 |
| 124 | scan | +0.2781 | +0.0828 | -0.0132 | `pass:H8` | kept | `carry` | kept | +0.229 |
| 125 | scan | +0.2459 | +0.0793 | -0.0017 | `pass:H8` | kept | `shot` | shot | +0.306 |
| 126 | scan | +0.2450 | +0.0804 | +0.0025 | `pass:H8` | kept | `shot` | shot | +0.305 |
| 127 | scan | +0.2836 | +0.0795 | +0.0413 | `pass:H8` | kept | `carry` | kept | +0.232 |
| 128 | scan | +0.2434 | +0.0859 | -0.0226 | `pass:H8` | kept | `shot` | shot | +0.300 |
| 129 | scan | +0.2835 | +0.0842 | +0.0190 | `pass:H8` | kept | `carry` | kept | +0.233 |
| 130 | scan | +0.2444 | +0.0852 | -0.0196 | `pass:H8` | kept | `shot` | shot | +0.305 |
| 131 | scan | +0.2821 | +0.0809 | -0.0128 | `pass:H8` | kept | `carry` | kept | +0.230 |
| 132 | scan | +0.2853 | +0.0829 | +0.0367 | `pass:H8` | kept | `carry` | kept | +0.227 |
| 133 | scan | +0.2810 | +0.0818 | -0.0187 | `pass:H8` | kept | `carry` | kept | +0.233 |
| 134 | scan | +0.2845 | +0.0866 | -0.0158 | `pass:H8` | kept | `carry` | kept | +0.231 |
| 135 | scan | +0.2876 | +0.0759 | +0.0002 | `pass:H8` | kept | `carry` | kept | +0.233 |
| 136 | scan | +0.2860 | +0.0752 | +0.0292 | `pass:H8` | kept | `carry` | kept | +0.233 |
| 137 | scan | +0.2441 | +0.0898 | -0.0469 | `pass:H8` | kept | `shot` | shot | +0.302 |
| 138 | scan | +0.2884 | +0.0839 | +0.0282 | `pass:H8` | kept | `carry` | kept | +0.234 |
| 139 | scan | +0.2850 | +0.0811 | +0.0429 | `pass:H8` | kept | `carry` | kept | +0.232 |
