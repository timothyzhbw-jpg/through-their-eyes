# Realism — sim vs published values (SPEC 3.8)

`uv run python -m eval.realism`. `possession_play` seeds 100–199 (100), 45 s of passing play each (a run ends early if the ball goes out). Synthetic data only: every published value below is a number printed in a paper cited in docs/REFERENCES.md; no dataset was used.

**10 inside, 6 outside, 0 inconclusive, 10 with no published reference.**

Outside the published range:

- Cohen's d of scan frequency, central midfielders vs forwards †: sim d = 0.77 (n = 479 vs 68); published d = 0.54.
- Cohen's d of scan frequency, central midfielders vs side defenders †: sim d = 0.43 (n = 479 vs 189); published d = 0.56.
- Cohen's d of scan frequency, central midfielders vs wingers †: sim d = 0.51 (n = 479 vs 39); published d = 0.33.
- Cohen's d of scan frequency, central defenders vs side defenders †: sim d = 0.20 (n = 289 vs 189); published d = 0.37.
- Cohen's d of scan frequency, side defenders vs forwards †: sim d = 0.33 (n = 189 vs 68); published d = 0.20.
- Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception †: sim d = −0.06 (n = 497 vs 93); published d = 0.57 (lower under tight pressure).

| Metric | Sim (pooled) | Sim, 90% over seeds | Published | Range checked | Source | Inside |
|---|---|---|---|---|---|---|
| Scans in the 10 s before receiving † | 2.95 ± 1.63 (n = 1064) | 2.86 to 3.05 | 3.0 ± 2.1 | 0.90 to 5.10 (mean ± SD) | Jordet et al. (2020), Results › General | ✅ inside |
| Scan frequency before receiving (scans/s) | 0.41 ± 0.19 (n = 1064) | 0.40 to 0.42 | 0.44 ± 0.30 | 0.14 to 0.74 (mean ± SD) | Jordet et al. (2020), Results › General | ✅ inside |
| Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s) | 0.42 ± 0.18 (n = 417) | 0.40 to 0.43 | 0.27 ± 0.22 (no major award); 0.33 ± 0.25 (award) | 0.05 to 0.58 (both groups' mean ± SD) | Jordet et al. (2013), Results, p. 3 | ✅ inside |
| Scan frequency, central midfielders (scans/s) | 0.45 ± 0.19 (n = 479) | 0.43 to 0.47 | no published reference | — | — | — |
| Scan frequency, central defenders (scans/s) | 0.41 ± 0.17 (n = 289) | 0.39 to 0.42 | no published reference | — | — | — |
| Scan frequency, wingers (scans/s) | 0.35 ± 0.17 (n = 39) | 0.31 to 0.40 | no published reference | — | — | — |
| Scan frequency, side defenders (scans/s) | 0.37 ± 0.19 (n = 189) | 0.34 to 0.39 | no published reference | — | — | — |
| Scan frequency, forwards (scans/s) | 0.31 ± 0.16 (n = 68) | 0.28 to 0.34 | no published reference | — | — | — |
| Positional order of scan frequency † | central midfielders 0.45 > central defenders 0.41 > side defenders 0.37 > wingers 0.35 > forwards 0.31 | order holds in 88% of resamples | central midfielders highest, forwards lowest | the same order at both ends | Jordet et al. (2020), Results › Positional Role | ✅ inside |
| Cohen's d of scan frequency, central midfielders vs forwards † | d = 0.77 (n = 479 vs 68) | 0.57 to 0.98 | d = 0.54 | 0.48 to 0.60 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs side defenders † | d = 0.43 (n = 479 vs 189) | 0.27 to 0.60 | d = 0.56 | 0.51 to 0.61 (95% CI) | Jordet et al. (2020), Results › Positional Role; Figure 2 | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs wingers † | d = 0.51 (n = 479 vs 39) | 0.23 to 0.79 | d = 0.33 | 0.27 to 0.39 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs central defenders † | d = 0.24 (n = 479 vs 289) | 0.12 to 0.37 | d = 0.29 | 0.24 to 0.34 (95% CI) | Jordet et al. (2020), Figure 2 | ✅ inside |
| Cohen's d of scan frequency, central defenders vs forwards † | d = 0.57 (n = 289 vs 68) | 0.35 to 0.80 | d = 0.51 | 0.43 to 0.59 (95% CI) | Jordet et al. (2020), Figure 2 | ✅ inside |
| Cohen's d of scan frequency, central defenders vs side defenders † | d = 0.20 (n = 289 vs 189) | 0.05 to 0.36 | d = 0.37 | 0.31 to 0.43 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, wingers vs forwards † | d = 0.28 (n = 39 vs 68) | −0.09 to 0.64 | d = 0.36 | 0.27 to 0.45 (95% CI) | Jordet et al. (2020), Figure 2 | ✅ inside |
| Cohen's d of scan frequency, side defenders vs forwards † | d = 0.33 (n = 189 vs 68) | 0.11 to 0.55 | d = 0.20 | 0.12 to 0.28 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception † | d = −0.06 (n = 497 vs 93) | −0.22 to 0.09 | d = 0.57 (lower under tight pressure) | 0.49 to 0.65 (95% CI) | Jordet et al. (2020), Results › Opponent Pressure; Figure 3 | ❌ outside |
| Scan duration, ball out of the 82° scene-camera frame (s) † | 0.44 ± 0.28 (n = 15246) | 0.44 to 0.45 | 0.40 ± 0.28 (39.65 cs, SD 28.42 cs) | 0.11 to 0.68 (mean ± SD) | Aksum et al. (2021), Results › Scanning duration | ✅ inside |
| Scans with the ball out of frame for ≤ 0.66 s (%) † | 89.6% (n = 15246) | 89.2 to 90.1% | 90.3% (n = 869) | 88.3 to 92.3% (95% CI of the printed share) | Aksum et al. (2021), Results › Scanning duration; Fig 3 | ✅ inside |
| Peak head angular speed during a scan (°/s) † | 404 ± 51 (n = 33723) | 404 to 405 | 404.2 ± 50.7 | 354 to 455 (mean ± SD) | Kokubu et al. (2026), Results 3.1 | ✅ inside |
| Peak speed per outfield player per run (m/s) | 6.42 ± 1.50 (n = 2000) | 6.36 to 6.48 | no published reference | — | — | — |
| Peak acceleration per outfield player per run (m/s²) | 3.50 ± 0.00 (n = 2000) | 3.50 to 3.50 | no published reference | — | — | — |
| Peak deceleration per outfield player per run (m/s²) | 5.00 ± 0.00 (n = 2000) | 5.00 to 5.00 | no published reference | — | — | — |
| Pass launch speed (m/s) | 12.93 ± 3.93 (n = 1535) | 12.78 to 13.11 | no published reference | — | — | — |
| Pass average ball speed, kick to end of the pass (m/s) | 10.76 ± 3.17 (n = 1490) | 10.64 to 10.89 | no published reference | — | — | — |

## How to read it

- **Sim (pooled)**: all observations of all seeds pooled; mean ± SD of the observations and their number. **Sim, 90% over seeds**: the 5th–95th percentile of the pooled value over 1000 bootstrap resamples of the seeds (whole runs resampled), i.e. how much it depends on which matches were simulated.
- **Range checked**: the paper's printed 95% CI when it prints one; else the printed mean ± 1 SD — the spread of single situations, so *inside* means the sim's average is a typical real value, not that the means agree; else, for a printed share, its binomial 95% CI computed from the printed n. **Inside** compares the pooled value; a group with fewer than 10 observations is inconclusive.
- **†**: the sim's scan parameters (sim/config.py) were fitted to this printed value on `possession_play` tuning seeds 0–99 (SPEC 3.4). The seeds here are held out, so *inside* shows that the fit carries over to new matches, not independent agreement.
- Rows marked *no published reference* have no printed value in any cited paper; they show the sim's distribution only. Nothing was filled in from memory or from datasets.
- The populations differ from the sim's 22 synthetic players: one EPL club's 27 players (Jordet 2020), 118 EPL forwards and midfielders (Jordet 2013), four elite midfielders (Aksum 2021), twelve university players in a 6 v 6 game (Kokubu 2026).

## Notes per row

- **Scans in the 10 s before receiving †** — Sim `scan` events of the receiver with onset in the window; partial head turns are not scans. The window starts at the latest of 10 s before the reception, the moment the team won the ball, and the run start (the paper cuts it at turnovers and set plays). Mean window 7.3 s; 43% of receptions have the full 10 s. SPEC 3.8 asks for the mean within ±25% of the SPEC 3.4 target of ≈ 3 (2.25–3.75): met.
- **Scan frequency before receiving (scans/s)** — Scans divided by the window length, per reception, then averaged as the paper does. It sits far below the configured rates (sim/config.py ROLES), which hold while the head is free and no opponent is within 10 m: a scan in progress, its refractory time and partial head turns block new scans, and nearer opponents slow them.
- **Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s)** — The 2013 sample: forwards and midfielders receiving a pass from a teammate closer to their own goal (along the attack direction, at the kick). The range spans both groups' mean ± SD. The paper's highest per-player means (0.62, two players) have no spread and are not checked.
- **Scan frequency, central midfielders (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: DM 1.19, CM 1.19, AM 1.19 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, central defenders (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: CB 0.74 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, wingers (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: W 0.74 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, side defenders (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: FB 0.56 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, forwards (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: ST 0.66 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Positional order of scan frequency †** — Only the two ends of the order are printed in the text; the bars of Figure 2 are not read off. Central midfielders pool the sim's DM, CM and AM; by sim role: CB 0.41, FB 0.37, DM 0.45, CM 0.45, AM 0.44, W 0.35, ST 0.31.
- **Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception †** — The paper's bins are whole metres, so 0–1 m is read as < 1.5 m and 10+ m as ≥ 9.5 m. The sim slows scanning as the closest opponent nears (sim/config.py, pressure_scan_factor, set from this d in closed form), and possession_play marks, so a receiver at 0–1 m has usually been marked: an opponent within 3 m for a median 60% of his window (0% at 10+ m), 3.5 m away on average against 16.5 m. The bins also differ by role: 70 of the 93 receptions at 0–1 m are central midfielders, who scan most, against 61 of the 497 at 10+ m, where 430 are central or side defenders. With the pressure term off (factor 1) the same receptions give d = −0.47: that is the role mix. The pressure term moves d by +0.41, less than the paper's whole d. The closed-form factor assumed the bins differ only in pressure, and that a change in the configured rate shows in full in the measured one; scan dead time compresses it (eval/scan_calibration.py).
- **Scan duration, ball out of the 82° scene-camera frame (s) †** — Midfielders' scans off the ball, timed from the first 25 Hz frame with the ball more than 41° from the true head direction to the first frame back (the paper: from the first video frame without the ball to the first with it; micro scans that keep the ball in frame are excluded there as here). Vertical framing is ignored. Printed but not checked (no spread): median 0.34 s, most common 0.26 s, longest 3.28 s; sim median 0.40 s, longest 3.20 s. The median is set by the turn itself (70–150° out and back at about 404°/s); the dwell was fitted to the share and SD.
- **Scans with the ball out of frame for ≤ 0.66 s (%) †** — Same scans and timing as the row above. The range is the binomial 95% CI of the printed 90.3% with n = 869, computed here (normal approximation); the paper prints no interval.
- **Peak head angular speed during a scan (°/s) †** — Outfield scans; frame-to-frame yaw change of the true head at 25 Hz (the paper: yaw rate from a head-worn IMU at 200 Hz, scans detected at 250°/s). Each sim scan draws its peak speed from 404.2 ± 50.7°/s (sim/config.py scan_omega, this printed value), so inside is by construction. The paper does not say whether its SD is over scans or players.
- **Peak speed per outfield player per run (m/s)** — Highest 9.50 m/s; 38% of player-runs pass the SPEC 4.6 sprint threshold (7.0 m/s). Spearman (2018, §3.1.1) sets v = 5 m/s in its time-to-intercept model as an 'average sustainable speed': a model parameter, not a measured top speed, so it is not used here.
- **Peak acceleration per outfield player per run (m/s²)** — Rate of speed increase over one frame; the sim caps it at a_max. Spearman (2018, §3.1.1) sets a = 7 m/s² in its time-to-intercept model, a model parameter: not used.
- **Peak deceleration per outfield player per run (m/s²)** — Rate of speed decrease over one frame; the sim caps it at d_max.
- **Pass launch speed (m/s)** — Ground passes only (SPEC 3.3, M1). No cited paper prints pass or ball speeds; the average ball speed in Shaw's tutorial code is not a paper and is not used.
- **Pass average ball speed, kick to end of the pass (m/s)** — Straight-line distance over flight time, for passes that were received, intercepted or went out.

## Sources

- **Jordet et al. (2020)** — Scanning, contextual factors, and association with performance in English Premier League footballers: an investigation across a season. Frontiers in Psychology 11:553813. 27 players of one EPL club, 21 home games, 9,574 ball possessions, scans counted from close-up video. https://pmc.ncbi.nlm.nih.gov/articles/PMC7573254/
- **Jordet et al. (2013)** — Jordet, Bloomfield, Heijmerikx. The hidden foundation of field vision in English Premier League (EPL) soccer players. MIT Sloan Sports Analytics Conference. 118 players (63 forwards, 55 midfielders), 1,279 situations, from broadcast player-cam video. https://www.sloansportsconference.com/research-papers/the-hidden-foundation-of-field-vision-in-english-premier-league-epl-soccer-players
- **Aksum et al. (2021)** — Scanning activity of elite football players in 11 vs. 11 match play: an eye-tracking analysis on the duration and visual information of scanning. PLoS ONE 16(8):e0244118; by the author of the NIH thesis Visual Perception in Elite Football and the source of its '> 90% of scans last ≤ 0.66 s'. 4 elite midfielders, 869 scans, Tobii Pro Glasses 2. https://pmc.ncbi.nlm.nih.gov/articles/PMC8378692/
- **Kokubu et al. (2026)** — Correspondence between motion sensor kinematics and notational analysis of scanning in field-based football gameplay. Frontiers in Psychology 17:1785026. 12 university players, a 7-min 6 v 6 game, head-worn IMU at 200 Hz. https://pmc.ncbi.nlm.nih.gov/articles/PMC13441872/

Checked and not used: Bekkers (2026, *Wide Open Gazes*) prints its field-of-view model and model scores, no scan rates or head kinematics; Bekkers (*Pressing Intensity*) and Fernández, Bornn, Cervone (2021) print model parameters, no measured speeds; Spearman (2018) prints time-to-intercept parameters (v = 5 m/s, a = 7 m/s²), which are model choices; the summaries of Jordet et al. (2013) quoted in REFERENCES.md ("> 0.5 scans/s is very high") are not the paper, which prints the values used above.
