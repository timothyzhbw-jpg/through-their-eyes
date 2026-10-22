# Sim parameters from published research

A dossier of published values the synthetic match engine (`sim/`, SPEC 3) can be set to or
checked against: team shape, movement, ball and passing, pressing and transitions, and
perception. Hard constraint 2 forbids real match data, even for calibration. Aggregate values
printed in papers are allowed, and every number here is one.

**How the values were collected (2026-10-21).**
- Every value was read in the source named in its row, at the table, page or section given.
- `abstract-only` marks a value seen only in the abstract.
- A value plotted in a figure but not printed is left out. So is anything from blogs, club or
  vendor material, or raw tracking datasets.
- A value that a review or a later paper reports from an earlier study is cited as "in <review>,
  citing <original>".
- Units are as printed, with SI in brackets where the sim needs it. Unless a row says otherwise, a
  value is the mean (± SD) of adult men in official professional matches.
- Rows on youth, women, small-sided games or arranged 11 v 11 games are flagged *youth*,
  *women*, *SSG* or *arranged 11 v 11*.
- The research tables with short quotes for each value are kept outside the repo.

**The Sim column** says where the sim uses the value, or *not modelled*. Its own measurements
were taken on main at 771827e (2026-10-21) on `possession_play` and `open_play`, held-out seeds
100–119, 45 s each. Shape is over outfield players, sampled at 5 Hz while a player had the
ball; running is over every frame. A number that names a report comes from that report, and
those from `eval/reports/match_stats.md` are as of e8af2fe. The measuring scripts only read the
sim and are not committed.

**Per 90 minutes.** Papers count per 90 min of the match clock, which includes stoppages. The sim's
reports count per 90 min of ball in play (`eval/match_stats.py`: a stitched match has no
stoppages). Convert with the ball-in-play share (§3) before comparing totals.

Contents: [1 Team shape](#1-team-shape) · [2 Movement](#2-movement) ·
[3 Ball, passing and possession](#3-ball-passing-and-possession) ·
[4 Pressing and transitions](#4-pressing-and-transitions) · [5 Perception](#5-perception) ·
[6 Largest gaps](#6-largest-gaps-between-the-sim-and-the-literature) ·
[7 Not found](#7-looked-for-and-not-found) · [Sources](#sources)

## 1. Team shape

Unless a row says otherwise, goalkeepers are excluded. Length is the distance from the deepest to
the most advanced outfield player along the pitch; width is the same across it. "Both teams"
means the 20 outfield players together.

| Parameter | Published value | Population | Source, location | Sim |
|---|---|---|---|---|
| One team, per match, both phases | width 43.4 m, length 36.9 m; deepest outfield player 37.3 m from his own goal line; keeper 25.0 m from his nearest teammate. Match-to-match SD within a team 2.1, 1.7, 3.0 and 1.7 m | LaLiga 2011–19, 5,518 team-matches, optical tracking (Mediacoach) | Errekagorri 2024, Tables 1 and 4 (model intercepts; they equal the mean of the four table-position groups) | width 46.8–48.6, length 40.7–43.3 m; deepest outfield player 22.5–23.7 m from goal in possession and 27.7–28.6 m out of it; keeper 19.5–20.0 m from his nearest teammate. Formation anchors: `sim/scenarios/possession_play.py` `HOME`, `AWAY` |
| Differences and trends in the same data | top six vs the mean of all groups: width +0.8, length +0.6, height +1.1 m. Length fell 1.2–2.7 m from 2011–12 to 2018–19 | as above | Errekagorri 2024, Table 4 and Results | One style for both teams |
| One team, in vs out of possession | width 41.0 ± 10.0 and 41.8 ± 10.0 in possession, 36.5 ± 7.0 and 37.0 ± 7.0 out of it; length 36.4 ± 6.8 and 36.2 ± 6.7 in, 33.1 ± 8.0 and 34.5 ± 7.1 out; width × length 1,506 and 1,516 in, 1,215 and 1,285 m² out (one team and its opponents) | LaLiga 2005–06, 6 matches, Amisco, one sample per touch (n = 6,793) | Castellano, Álvarez-Pastor & Blanco-Villaseñor 2013, Table 1 | Length and width do not change with possession (≈ 41 and 47 m in both); the convex hull out of possession is 83–90% of the hull in possession |
| Distance between the two teams' last lines | 38.7 ± 5.4 m; deepest outfield player to own goal 31.2 and 36.2 m in possession, 31.0 and 35.3 m out of it | as above | Castellano, Álvarez-Pastor & Blanco-Villaseñor 2013, Results p. 440 | Not measured |
| Inter-line distances, defending team | defence to midfield 10.22 ± 3.76 m, midfield to attack 13.30 ± 4.22 m | Bundesliga 2020/21, 153 matches, tracking with events | Amichay 2025, Discussion, citing Forcher et al. 2024 (not read) | Anchors: home lines about 14 and 11 m apart, away about 13 and 10 m |
| Defensive-line height vs the ball, out of possession | deepest defender to his own goal = 6.30 m + 0.46 × the ball's distance to that goal (r = 0.859); ball to the defensive line = −6.3 m + 0.54 × the same distance (r = 0.891). Pooled: line 33.0 ± 12.8 m from goal, 25.1 ± 14.5 m behind the ball; width 36.8 ± 7.0, length 33.8 ± 7.6 m. Width and length hardly follow the ball (r = 0.215, 0.214) | same data | Castellano & Álvarez 2013, Tabla 1, Tabla 2, pp. 130–132 | Every anchor moves by `formation_shift` = (0.2, 0.25) of the ball's displacement (`sim/engine.py` `formation_spots`); team-centroid x on ball x has slope 0.22 |
| Both teams together | game length 36.70–38.74 m (SD 4.4–5.3), game width 42.13–47.75 m (SD 5.8–6.0) by opponent and team in possession. Convex hull of the team in possession 864–1,059 m² | EPL, 12 matches of one top-five team, TRACAB, open-play possessions ≥ 8 s | Gonçalves 2019, Tables 1–2 | game length 53.6–54.0 m, game width 50.4–51.2 m; hull in possession 1,457–1,559 m² |
| Both teams together, by ball zone | zones 1 → 6 from the goal of the team in possession: game length 42.3, 39.0, 35.0, 34.5, 39.0, 46.0 m; game width 41.3, 45.4, 47.0, 45.9, 43.3, 40.8 m. Defending keeper to nearest teammate 29.9 → 8.9 m; attacking keeper 12.5 → 33.1 m. Per match: length 36.9–39.0, width 43.1–46.7 m | LaLiga 2002–03, 4 matches, Amisco, sampled every 5 s | Fradua 2013, Tables 2–3 | Not measured by zone |
| Distance between the teams' centroids | along the pitch 7 ± 2 m (first half), 6 ± 4 m (second); across 0 ± 2 and 1 ± 4 m | one UEFA Championship match | Rico-González 2022, Table 3, citing Frencken et al. 2012 | 15.8–16.4 m along, 1.4–1.6 m across |
| Shape and coupling, youth | length 34.8 ± 1.6, width 41.6 ± 2.7 m, length-per-width 0.9 ± 0.1; stretch index 10.1 ± 0.4 (x), 11.1 ± 0.8 m (y); convex hull 1,035 ± 104 m²; centroids 5.4 ± 0.4 m apart along the pitch; the two centroids move in phase 88.5 ± 9.8% (x) and 84.5 ± 9.7% (y) of the time (3-s running correlation > 0.5) | *youth*: Dutch U17 and U19, 5 official matches, all teams 1-4-3-3, radio tracking | Olthof 2019, Table 1 | length-per-width 0.86–0.91; stretch index 11.8 (x), 12.0 m (y) |
| Convex hull, attacking vs defending | team medians 905–1,408 m² attacking, 774–1,158 m² defending; smaller when defending in every team | Brazilian Série A, 8 matches, video tracking | Moura 2012 (abstract-only) | 1,457–1,559 in possession, 1,289–1,308 m² out |
| Stretch index, defending vs attacking | about 9–10 m defending, 12–13 m attacking (read off plots by the review) | 5 first-division teams, 10 matches | Rico-González 2022, Table 3, citing Bartlett et al. 2012 | 11.8–12.0 m in both phases (not split) |
| Rest defence when the ball is lost in the attacking third | deepest defender 43.6 ± 10.0 m from own goal; 3.7 ± 0.8 defenders against 2.0 ± 0.9 attackers within 10 m ahead of him; that group is 7.4 ± 1.9 m long, 28.2 ± 7.4 m wide; 70.1% of its players are centre backs; nearest defender 5.1 ± 2.2 m from each attacker | Bundesliga 2020/21, 153 matches, 2,951 situations, TRACAB | Forcher 2023, Results | Not modelled |
| Distance from attackers to their nearest defender | 8.3 m (SD 0.8–1.3), in a 3-5-2 and a 4-2-3-1 against a flat 4-4-2 | *arranged 11 v 11*, 62 higher-amateur men | Memmert 2019, Table 1 | `possession_play` marks at 1–2 m (tight) or 3–6 m (loose) goal-side |
| Starting formations | 533 team-games: 4-3-3 109, 4-2-3-1 106, 3-4-3 78, 3-5-2 69, 4-4-2 diamond 63, 4-2-2-2 46, 4-5-1 46, flat 4-4-2 16 (back three 28%) | Bundesliga 2018/19 | Forcher 2022, Table 1 | 4-3-3 against 4-2-3-1 in every passage |
| Shapes in and out of possession | 20 formation templates over a season; back-five shapes almost only out of possession, three-at-the-back and two-defender shapes almost only in possession. Example: a 4-1-4-1 out of possession whose wide midfielders join the front three and whose full backs step level with the holding midfielder in possession; its hull in possession is twice its hull out of possession | one season, 180 matches, 25 Hz tracking | Shaw & Glickman 2019, §§2.1–2.2 | One anchor set per team for both phases |
| Home and away | team centroid 1.79 m behind halfway at home, 4.90 m behind away; formations unchanged | one top league season, 20 teams, Prozone | Bialkowski 2014, Fig. 2(a), §4 | Not modelled |
| Whole-team synchrony | cluster-phase order 0.89 ± 0.12 along the pitch vs 0.73 ± 0.16 across it | professional match | Duarte 2013 (abstract-only) | Not measured |

## 2. Movement

| Parameter | Published value | Population | Source, location | Sim |
|---|---|---|---|---|
| Speed zones | standing < 0.7, walking 0.7–7.1, jogging 7.2–14.3, running 14.4–19.7, high-speed running (HSR) 19.8–25.1, sprinting ≥ 25.2 km/h | Prozone, European top league | Bradley 2010, p. 2344 | `analytics/stats.py`: HSR > 5.5 m/s, sprint > 7.0 m/s held ≥ 0.4 s |
| Other zone sets in use | World Cup 2022 (TRACAB): high intensity ≥ 20, sprint ≥ 25 km/h. Bundesliga (DFL): 17–23.99 and ≥ 24 km/h. GPS studies: mostly ≥ 24 km/h | — | Bradley 2024, Methods; Altmann 2021, Methods | Sprint counts depend on the zone set, so match the definition before comparing |
| Total distance per match, outfield | 10,841 ± 950 m | 110 players, European top league and internationals, Prozone | Bradley 2010, p. 2345 | Not directly comparable: a per-match distance is 1.0–1.6× that per 90 min of play, depending on how much is run during stoppages (ball in play, §3) |
| Total distance by position | wide mid 11,491 ± 996; central mid 11,411 ± 486; full back 10,763 ± 627; forward 10,504 ± 1,090; centre back 10,057 ± 582 m | as above | Bradley 2010, p. 2348 | Per 90 min of play (`possession_play`): ST 12.8, W 12.5, CM 11.0, FB 10.7, CB 8.9 km. The sim's forwards run most (real: fourth of five), and its centre backs are below even the 1.0× conversion |
| Total distance by position, Bundesliga 2019/20 | CB 10.21 ± 0.64; FB 10.75 ± 0.56; CM 11.66 ± 0.92; WM 11.07 ± 0.73; FW 10.86 ± 0.80 km | 1,964 full-match observations, TRACAB | Altmann 2021, Table 1 | as above |
| Goalkeeper distance | 5,611 ± 613 m; walking 73% of the time | EPL, 62 keepers, 109 matches, Prozone | Di Salvo 2008 (abstract-only) | 8.6–10.8 km per 90 min of play against 5.6–9.0 km on the 1.0–1.6× conversion: `open_play` is too high, `possession_play` at the top |
| Time per speed zone | standing 5.2%, walking 59.4%, jogging 26.4%, running 6.4%, HSR 2.0%, sprinting 0.6% | Bradley 2010 sample | Bradley 2010, p. 2345 and Table 1 | Not measured |
| Activity bouts per match | standing 167, walking 855, jogging 973, running 388, HSR 135, sprinting 36 (≈ 2,550 in all, one change about every 2 s) | as above | Bradley 2010, Table 1 (the total is our sum) | Not measured |
| Distance ≥ 19.8 km/h by position | wide mid 1,273 ± 257; full back 1,046 ± 196; forward 996 ± 268; central mid 941 ± 235; centre back 638 ± 154 m | as above | Bradley 2010, p. 2348 | Per 90 min of play (`possession_play`): W 2,662, ST 1,692, FB 1,426, CM 847, CB 327 m |
| Sprinting distance ≥ 24 km/h by position | CB 0.19 ± 0.08; FB 0.36 ± 0.14; CM 0.24 ± 0.13; WM 0.42 ± 0.14; FW 0.34 ± 0.13 km | Bundesliga 2019/20, TRACAB | Altmann 2021, Table 1 | Per 90 min of play at > 25.2 km/h: CB 126, CM 169, FB 534, W 1,075 m |
| Sprints per match (> 25.1 km/h) | 57 ± 20 in 2012–13 (31 ± 14 in 2006–07); mean sprint 5.9 ± 0.8 m | EPL, 14,700 observations, Prozone | Barnes 2014 (abstract-only) | Not measured |
| Sprints per match (> 25.2 km/h), World Cup 2014 | 33.3 ± 10.6 | 905 full-match observations | Chmura 2017, Table 2 | Not measured |
| Length of high-intensity runs | Most runs ≥ 19.8 km/h, and most sprints ≥ 25.2 km/h, are 1–10 m. Counts fall steadily with length out to 50 m (per-position counts in 5-m bins) | Norwegian top-division club, 23 home matches, radio tracking | Baptista 2018, Tables 2–3 | Not measured. Sprints that are all 20–40 m would look wrong |
| Recovery between runs ≥ 19.8 km/h | 70 ± 25 s; centre backs 98 ± 21, wide mids 52 ± 15 s | Bradley 2010 sample | Bradley 2010, pp. 2346, 2348 | Not measured |
| Peak match speed by role | centre backs, DMs, CMs 30.2–30.8 km/h [8.4–8.6 m/s]; wide defenders, AMs, wide mids, wide forwards, centre forwards 32.1–32.3 km/h [8.9–9.0 m/s]; tournament top ten 35.3–35.7 km/h [9.8–9.9 m/s] | World Cup 2022, TRACAB 25 Hz | Bradley 2024, Results and Abstract | `sim/config.py` `ROLES` v_max: CB 8.0, DM 8.3, CM 8.5, AM 8.7, FB 9.0, ST 9.3, W 9.5 m/s. Measured peak per 45-s run 6.35 ± 1.50 m/s (`eval/reports/realism.md`) |
| Peak match speed by position, between matches | CB 30.6 ± 1.4; FB 30.7 ± 1.6; CM 28.5 ± 1.7; WM 32.0 ± 1.6; FW 29.9 ± 2.0 km/h | one LaLiga 2 team, 13 matches, 10 Hz GPS | Oliva-Lozano 2020, Table 3 | One v_max per role; no per-player spread |
| Maximal acceleration vs current speed, matches | mean player a = 6.577 − 0.241·v; envelope a = 7.630 − 0.242·v (a in m/s², v in km/h) [≈ 6.6 − 0.87·v with v in m/s] | LaLiga 2020–23, 1,140 matches, 363 players, 25 Hz optical | Nevado Garrosa 2025, Table 2 (per-position lines too) | `A_MAX` = 3.5 m/s² at every speed |
| Start speed of hard accelerations | 88–91% of accelerations > 3 m/s² start below 7 km/h | as above | Nevado Garrosa 2025, Results | Not measured |
| Maximal acceleration vs initial speed, sprint test | 5.99 − 0.23·v (r = −0.98); 6.01 ± 0.55 m/s² from standing, 2.29 ± 0.34 from 16.7 km/h | *youth*: 72 U18 players, Swiss top league, radio tracking | Sonderegger 2016, Table 1, Eq. 2 | Agrees with the match line above |
| Per-match peak acceleration and deceleration | acceleration 4.4–4.7, deceleration −5.7 to −6.3 m/s² (position means) | one LaLiga 2 team, 10 Hz GPS | Oliva-Lozano 2020, Table 2 | `A_MAX` 3.5, `D_MAX` 5.0 m/s². Every player-run peaks at the caps (realism.md) |
| Hard accelerations vs decelerations | beyond ±3 m/s²: accelerations 26.5–34.9, decelerations 50.9–64.5 per match. The meta-analysis has more decelerations than accelerations in soccer (> 2.5 m/s²: SMD −1.74) | as above; meta-analysis of GPS studies | Oliva-Lozano 2020, Table 2; Harper 2019, Abstract | Not measured |
| Accelerations and decelerations per minute (> 3 m/s², ≥ 0.5 s) | accelerations 0.81–0.97, decelerations 0.86–1.17 per min by position | one EPL team, 2020–22, 18 Hz GPS | Morgans 2025, Table 1 | Not measured |
| Turns | Turns > 90°: centre backs 32.7 ± 10.1, full backs 41.0 ± 12.1, wide mids 42.9 ± 12.3 per match. Video coding counts 726 ± 203 turns of any angle | Norwegian club, radio tracking; EPL, video | Baptista 2018, Results; Bloomfield 2007, Abstract | `body_turn_rate` 6 rad/s; not measured |
| Fatigue | high-intensity distance in the last 15 min 18% below the first 15 min (391 ± 117 vs 478 ± 141 m) | Bradley 2010 sample | Bradley 2010, p. 2346 | Not modelled (10–15 min matches) |

## 3. Ball, passing and possession

| Parameter | Published value | Population | Source, location | Sim |
|---|---|---|---|---|
| Ball in play | net 56:04 ± 5:12 of 93:32 ± 1:36 min gross (60%). EPL 2019/20: 56.24 ± 5.19 of 97.24 ± 2.08 min (57.7%) | Bundesliga, 60 matches, TRACAB; EPL, 50 matches, video | Link & Hoernig 2017, Table 3; Zhao & Liu 2022, Table 3 | The stitched clock is ball in play only. Events: multiply a per-match count by 90 / 56 ≈ 1.6 to get it per 90 min of play. Distances: 1.0–1.6×, since players also move during stoppages and no paper splits the two |
| Stoppages | 108 per match: throw-ins 40, free kicks 33, goal kicks 17, corners 10, substitutions 4, kick-offs 3. Play runs 32.1 s on average between stoppages of 18.7 s | German top division, 16 matches of one team | Siegle & Lames 2012 (abstract-only) | Restarts in match-1 (`sim/match.py`, SPEC 3.1): 2 kick-offs, a few throw-ins, 1 corner, the rest cuts. `possession_play` puts the ball out about once per 285 s of play |
| Time lost per stoppage type, EPL | throw-ins 8.74 ± 2.46, goal kicks 5.96 ± 1.93, fouls 5.11 ± 2.13, corners 4.80 ± 1.80 min per match | EPL 2019/20, 50 matches | Zhao & Liu 2022, Table 3 | Not modelled (cuts skip dead time) |
| Passes per match, both teams | Bundesliga 867.7 ± 117.7; 2. Bundesliga 795.9 ± 81.8; LaLiga 943.4 ± 104.2 [≈ 1,390–1,510 per 90 min of ball in play] | 2021–23, 1,132 matches, FBref | Schwarz 2025, Table 3 | 1,853 per 90 min of play (`eval/reports/match_stats.md`): 22–33% too many. `possession_play` holds the ball 0.6–1.6 s, then passes |
| Passes per team per match | top third of the table 541.1, middle 469.6, bottom 451.4 | men's EPL, LaLiga, Bundesliga, Serie A, MLS 2020–25, 9,504 matches, StatsBomb | Carstens 2026 (preprint), Suppl. Table S5 | as above |
| Pass completion | 85.2% of 840,386 passes (throw-ins excluded); 77.8–81.8% per match by league (FBref); ground passes 91.2–92.3% | Bundesliga 2017–20, TRACAB with events; as above | Anzer & Bauer 2022, §2; Schwarz 2025, Table 3; Carstens 2026, Suppl. Table S5 | 79.7% (match_stats.md): inside. All sim passes are on the ground |
| Pass length mix | short < 13.7 m: Bundesliga 379.8 ± 67.1, LaLiga 377.4 ± 70.8 per match; long > 27.4 m: 159.3 ± 23.4 and 159.1 ± 22.4 [≈ 40–44% short, 17–18% long] | as Schwarz 2025 | Schwarz 2025, Tables 1 and 3 (shares are our arithmetic) | Shorter than 13.7 m: 9–15%; longer than 27.4 m: 31–33%; mean length 23.4 m. Too few short passes, too many long ones (`PASS_RANGE` 8–35 m) |
| Long balls (≥ 25 yd ≈ 22.9 m) per outfield player | 3.04–3.64 of 39–46 passes per player per match | UEFA Champions League 2009–18, players of the big-five leagues, Opta | Yi 2019, Table 2 | Not measured per player |
| Shape of the pass-length distribution | a peak at the match mean and a second hump near 3× the mean (long passes, goal kicks, crosses) | big-five leagues 2017/18, 1,826 games, Wyscout events | Chacoma 2020 (preprint), §III.A | Not measured |
| Pass speed | initial speed 16.20 m/s, deceleration 7.93 m/s² (passes ≥ 0.8 s, cleaned) | Allsvenskan 2021, one club's games, 25 Hz tracking | Pfaff 2022 (preprint), §3.1.1 | Launch 12.94 ± 3.93 m/s (realism.md). Rolling 0.6 m/s² plus air drag, about 2.8 m/s² in all at 13 m/s (`sim/ball.py`) |
| Average pass speed, kick to reception | 10.96–12.40 m/s (SD 3.5–4.5) | *arranged 11 v 11*, US second-division players, timed from video | Herold 2022, Table 1 | 10.78 ± 3.16 m/s (realism.md), just below the team means |
| Team possession: duration and passes | mean 7.24 s; 1.91 passes per possession (touch-based, any change of team ends it); duration inverse Gaussian with µ = 8.10 s, λ = 5.76 s for possessions ≥ 1 s; players per possession a mixture of two geometric laws (q 0.34 and 0.77, weights 0.52 and 0.48) | J1 League 2020–21, 95 matches, 25 Hz tracking with events | Yamamoto 2023 (preprint), §§V–VII | 11.1 ± 10.5 s and 3.81 ± 3.43 passes per team possession (match_stats.md) |
| Possessions of two or more events | mean 13.72 s; 3.1 passes each; about 0.19 ± 0.03 passes per second of possession | big-five leagues 2017/18, Wyscout events | Chacoma 2020 (preprint), §§II.A, III.A | as above; the definition must match before comparing |
| Open-play possession duration | 0–10 s 50.7%, 11–20 s 26.1%, 21–30 s 13.3%, ≥ 31 s 9.7% (n = 1,971) | EPL 2017/18, 20 matches, video coding | González-Rodenas 2020, Table 2 | Not measured as a distribution |
| Attack types | fast 36.0%, combinative 29.6%, direct 24.1%, counter-attack 9.5% of open-play possessions | as above | González-Rodenas 2020, Results | Not modelled |
| Time on the ball | each spell of individual control 1.2 ± 1.0 s (keeper 2.1, centre forward 0.9 s); one team or the other controls the ball for 17:49 of the 56 net minutes | Bundesliga, 60 matches, TRACAB | Link & Hoernig 2017, Tables 3–4 | `possession_play` holds 0.6–1.6 s (`HOLD_S`); `first_touch_s` 0.2 s before a decision |
| Carrying | 4.2 ± 0.7 m and 2.0 ± 0.2 touches per possession; received at 10.3 ± 0.9 km/h [2.9 m/s]; 191 ± 38 m with the ball per match | one Ligue 1 team, 30 matches | Carling 2010 (abstract-only) | Carries of 5 m in 1 s in the decision model (SPEC 3.5) |
| Shots | 10.7–14.7 per team per match by result or venue (LaLiga 2008/09; World Cups 2002–10); 25.6 ± 5.8 per Bundesliga match (both teams) | LaLiga, 380 matches; World Cups, 177 matches; Bundesliga 2021/22 | Lago-Peñas & Lago-Ballesteros 2011, Table 3; Castellano 2012, Table 2; Schwarz 2025, Table 2 | One shot per match, the scripted shot hero's; none in open play (match_stats.md) |
| Shots per possession | 2,878 shots from 22,661 possessions of more than one event (12.7%); 8.5% of EPL open-play possessions create a scoring chance | World Cups 2018 and 2022, StatsBomb; EPL 2017/18 | Taha & Orlov 2025, Results (share is our arithmetic); González-Rodenas 2020, Results | as above |

## 4. Pressing and transitions

| Parameter | Published value | Population | Source, location | Sim |
|---|---|---|---|---|
| Pressure zone around the ball carrier | 9 m in front of him (towards his threat direction), 3 m behind; pressure (1 − d/L)^q with q = 1.75, summed over pressers. Set with football experts | Bundesliga 2015/16, four games of one club, 25 Hz | Andrienko 2017, §3.1–3.2 | `analytics/pressing.py` uses a time-to-intercept model instead (T = 1.5 s, σ = 0.45, after Bekkers). `possession_play` presses to 3 m (`PRESS_DISTANCE`) at 6 m/s (`press_speed`) |
| Where the most-pressing defender stands 1 s before a regain | up to about 9 m in front of the ball and 2.5 m behind; densest within about 3 m in front | as above, 31,827 positions | Andrienko 2017, §3.2, Fig. 2 | Not measured |
| Mean pressure on the ball | whole game 20.6–34.7%; the second before a regain 47.2–59.0% (8 team-games) | as above | Andrienko 2017, Table 3 | Not measured |
| Counterpressing share | 3,196 of the 11,108 home-team defensive turnovers that met the inclusion criteria were labelled counterpressing (28.77%). These are a subset of the more than 20,000 transition situations labelled by hand in 97 matches. Teams 21.8–40.1%; the trained model finds 27.24% of home teams' included defensive transitions over 4,118 matches | Bundesliga and 2. Bundesliga, tracking and events | Bauer & Anzer 2021, Abstract, §2.2.1, §3.2.4 | Not modelled as a behaviour |
| Counterpressing per team per match | about 20–30, out of 90–200 transition situations [≈ 290–640 transitions per 90 min of ball in play, both teams] | as above | Bauer & Anzer 2021, §3.1.1 | 367 possession changes per 90 min of play, both teams (`eval/reports/match_stats.md`): inside |
| Success of a counterpress (ball back within 5 s) | 36.2% with a numerical superiority within 10 m of the ball, 30.2% without | 109,852 counterpressing situations | Bauer & Anzer 2021, §3.2.3 | Not measured |
| Length of a defensive transition | 9.34 s on average (counterpressing 9.89 s) | 97 matches | Bauer & Anzer 2021, §2.2.1 | Not measured |
| Shot within 20 s of the loss | after a successful counterpress 6.27% for and 1.76% against; after a failed one 1.83% for and 6.7% against | 4,118 matches | Bauer & Anzer 2021, Table 4 | No shots in open play yet (match_stats.md) |
| Distance rule for "under pressure" | one defender within 5 yards [4.6 m] of the carrier in the first possession after a turnover would call 72.41% of turnovers counterpressing. Distance alone over-counts | as above | Bauer & Anzer 2021, §2.3.1, §3.1.1 | `eval/realism.py` reads pressure as the closest opponent's distance (Jordet 2020 bins) |
| Counter-attacks | 9.8% of transitions (teams 3.4–14.9%); 35.1% of them reach a shot vs 10.6% of other transitions; first shot after 12.9 s vs 28.3 s; mean xG 0.124 vs 0.080 | EPL 2016/17, STATS tracking | Hobbs 2018, §3.2, Tables 1–2 | The counter-attack template of SPEC 3.6 is not built |
| Where the ball is won | by pitch quarter from own goal: 48.2%, 32.8%, 16.2%, 2.8% of 5,457 recoveries. By type: interceptions 36.9%, set plays 24.6%, turnovers won 20.4%, tackles 15.6%, keeper saves 2.5% | UEFA Champions League 2011/12 knockouts, 28 matches, notational | Almeida 2014, Table 2 (shares are our arithmetic) | 349 of 367 possession changes per 90 min of play are interceptions and none are tackles: `possession_play` has no tackles |
| PPDA (opponent passes per defensive action in the final 60% of the pitch) | 11.24 ± 5.09 per team-match; Greek league 8.26–9.94 by result; one Ligue 2 team 6.2–6.8 | top-5 European leagues 2023/24 (Wyscout); Greek Super League 2020/21; Ligue 2 (Opta) | Campos 2025, Table 5; Stafylidis 2024, Table 1; Barthelemy 2024, Table 2 | Not measured. Provider definitions differ |
| Defensive reaction time (loss to regain) | the top teams regain about 1 s faster in every match status (absolute times not in the abstract) | Bundesliga 2010/11, 306 games | Vogelbein 2014 (abstract-only) | Not measured |

## 5. Perception

Values already used by the sim and `eval/realism.py` (Jordet et al. 2013 and 2020, Aksum et al.
2021, Kokubu et al. 2026 peak speed) are in `docs/REFERENCES.md`, "Perception and scanning", and
are not repeated here.

| Parameter | Published value | Population | Source, location | Sim |
|---|---|---|---|---|
| Scan count by head-yaw-rate threshold (out and back within 1 s) | per player per 7-min game: 81.9 ± 31.3 at 125°/s, 52.5 ± 25.3 at 200, 38.9 ± 22.7 at 250, 27.5 ± 18.2 at 300, against 42.8 ± 18.9 counted on video | *SSG*: 12 university players, 6 v 6, head IMU at 200 Hz | Kokubu 2026, Results 3.1 | `scan_omega_min` 250°/s; `analytics/scan_detector.py` sweep (SPEC 4.7) |
| Best threshold | 250°/s: bias −3.83 scans, concordance 0.932, recall 0.719, precision 0.790, F1 0.753. At 125°/s: bias +39.17, concordance 0.393 | as above | Kokubu 2026, Results 3.1–3.2 | `eval/reports/scan_detector.md` |
| Head turns before receiving (every turn above 125°/s) | 0.95 ± 0.21 turns/s in the last 10 s, rising to 1.44 ± 0.53 in the last 1 s. Head excursion 35.3 ± 10.3 rising to 56.1 ± 27.3°/s | semi-elite: 32 Australian players, arranged 11 v 11, IMU at 250 Hz | McGuckian 2018, Table 2 | Not comparable with scans (a different definition): run the detector at 125°/s to compare |
| Scanning before and during possession | before receiving 0.27 ± 0.22 scans/s (window 7.16 ± 3.32 s); on the ball 0.61 ± 0.45 scans/s over 1.62 ± 0.95 s | *youth, women*: Swiss U19, 2 official matches | Abächerli 2026, Results | `first_touch_s` 0.2 s to the decision; on-ball scans not measured |
| Fixation duration in 11 v 11 | 242 ± 195 ms (2,832 fixations, 120–2,400 ms) | 5 central midfielders, Norwegian top league, *arranged 11 v 11*, eye tracking | Aksum 2020, Results | Lower bound for the dwell needed to register a player |
| Scanning and the next action | Scan rate explains 3.0% of pass completion between players (R², p = 0.033). No association between head-turn frequency and a successful pass. Turning more than usual makes a pass to the far side 2–3× more likely | Euro 2016, 35 central midfielders; semi-elite | Phatak 2019, Table 1; McGuckian 2018, Results | Scans change beliefs and so the chosen option (SPEC 3.5); consistent: the effect is on which option, not on raw completion |
| On-ball scanning and pass success | odds ratio 1.09 (1.03–1.15) per +0.1 scans/s on the ball; before receiving 1.07 (0.99–1.16) | *youth, women* | Abächerli 2026, Table 3 | Not measured |
| Field of view | 120° binocular field around the head; about 92% of gaze shifts follow the head's direction (model assumptions, citing Henson 1993 and Fang 2015) | model paper | Bekkers 2026, §3.1 | `analytics/vision.py`: 120° cone, Gaussian edge |
| Body orientation and passing | a ±30° cone around the passer's body orientation for feasible passes (a model parameter) | model paper | Arbués-Sangüesa 2020, §3 | Receiver orientation not yet in the decision model (SPEC 3.5) |

## 6. Largest gaps between the sim and the literature

Ordered by how much they show on screen. None is fixed here; the sim changes go through the
session that owns `sim/`.

1. **The two teams stand apart.** Both teams' outfield players span 54 m along the pitch in the
   sim against 37–39 m (EPL, LaLiga). The sim's team centroids are 16 m apart against 5–7 m.
   Real teams overlap: the attackers stand among the defenders.
2. **The back lines sit too deep, and they hardly follow the ball.**
   - The sim's deepest outfield player is 22.5–28.6 m from his own goal; the LaLiga match mean is
     37.3 m.
   - The published defensive line moves 0.46 m per metre of ball movement. The sim's anchors move
     0.2.
   - The keepers are about 20 m from their nearest teammate; published is 25 m.
3. **Shape does not depend on possession.** LaLiga teams are about 5 m narrower and 2–3 m
   shorter out of possession. The sim keeps about 47 × 41 m in both phases.
4. **Passes are too long and too many.**
   - 9–15% of the sim's passes are shorter than 13.7 m; published is 40–44%.
   - 31–33% are longer than 27.4 m; published is 17–18%.
   - There are 22–33% more passes per 90 min of ball in play than in the Bundesliga or LaLiga.
5. **Movement limits are flat.**
   - The sim allows 3.5 m/s² of acceleration at any speed. In matches it falls with speed, from
     about 6.6 m/s² at a standstill.
   - Braking is capped at 5 m/s². Match peaks reach 6 m/s², and hard decelerations are about
     twice as frequent as hard accelerations.
   - Distance by role is off. The sim's forwards cover the most ground; real forwards rank
     fourth of five. Its centre backs run 8.9 km per 90 min of play, below the published 10.1 km
     per match even before converting it (real centre backs trail central midfielders by about
     1.4 km; the sim's by 2.1 km).
   - Keepers run 8.6–10.8 km per 90 min of play. The published 5.6 km per match is 5.6–9.0 km
     per 90 min of play, depending on how much is run during stoppages.
6. **No tackles and no open-play shots.**
   - In UEFA Champions League knockouts, 15.6% of recoveries are tackles and 36.9% interceptions.
     In the sim, 95% of possession changes are interceptions and none are tackles.
   - Teams shoot about 11–15 times per match. The stitched match has one shot, the scripted shot
     hero's, and none in open play.
7. **Ball deceleration (check before acting).** One preprint (Pfaff 2022, one Swedish club) fits
   7.9 m/s² of deceleration to cleaned passes. The sim's rolling resistance plus drag gives about
   2.8 m/s² at 13 m/s. The sim's average pass speed, 10.8 m/s, sits just below the team means
   of the only other source (11.0–12.4 m/s, SD 3.5–4.5). So this gap needs a second source
   before anything changes.

## 7. Looked for and not found

Each was searched for and is not filled in from memory. "Closed" means no open full text could
be read; the abstracts carry no usable number.
- **Lateral shift of the block toward the ball side**, such as a team-centroid-y slope on ball y,
  or a ball-side offset: no printed value. The sim's 0.25 (`formation_shift`) is a style knob.
- **Thresholds for high, mid and low blocks**: none in a peer-reviewed source. Use the
  line-height regression in §1 instead.
- **Low et al. 2020 review** (Sports Med 50:343–385), **Low et al. 2021 and 2022** (arranged
  11 v 11 by pressing strategy and formation), **Bauer, Anzer & Shaw 2023** (formations by
  phase), **Forcher et al. 2024** (compactness): closed or behind bot checks.
- **Pressing details**: time from a ball loss to the first pressure, number of pressing players,
  and approach speed. Forcher et al. 2022 and 2024 are closed. Bauer & Anzer 2021 print no
  distribution of these.
- **Vogelbein et al. 2014**: absolute regain times are closed; the abstract gives only the ~1 s
  difference.
- **Passes**: completion by pass length; forward, sideways and backward shares; the share of long
  balls by pitch zone; Prozone's short, medium and long thresholds (Barnes et al. 2014 does not
  state them).
- **Ball speed in m/s** from Wallace & Norton 2014 (closed; the abstract gives +15% over
  1966–2010).
- **Distance split between ball in play and stoppages.** Without it, a per-match distance
  converts only to a range of 1.0–1.6× per 90 min of play (§3). Compare role order and zone
  shares first.
- **Di Salvo et al. 2007 and 2010** per-position distances and sprint-length categories; the share
  of maximal sprint speed reached in adult elite matches (Djaoui et al. 2017): closed.
- **Scan rates by position in official adult matches**: Jordet et al. 2020 plot them without
  printing them. Pokolm et al. 2022 and Aksum et al. 2021 (J Sports Sci) are closed.
  McGuckian et al. 2020's abstract gives directions only.
- **A measured human field of view in football**: only model assumptions (120°).

## Sources

Read on 2026-10-21. "Abstract only" marks a source whose full text could not be read; a
preprint is marked as such.

**Team shape**
- Amichay G, Silva H, Brito J, Marcelino R (2025). Characterizing the spatial structures of
  competing football teams. *Sci Rep* 15:35217. doi:10.1038/s41598-025-97765-y. Used only for
  the Forcher et al. 2024 values it prints.
- Bialkowski A, Lucey P, Carr P, Yue Y, Matthews I (2014). "Win at home and draw away":
  automatic formation analysis highlighting the differences in home and away team behaviors.
  MIT Sloan Sports Analytics Conference.
  https://la.disneyresearch.com/wp-content/uploads/Project_HomeAwayTeamBehaviors_MIT2014_paper.pdf
- Castellano J, Álvarez D (2013). Uso defensivo del espacio de interacción en fútbol. *RICYDE*
  9(32):126–136. doi:10.5232/ricyde2013.03203. In Spanish.
- Castellano J, Álvarez-Pastor D, Blanco-Villaseñor Á (2013). Análisis del espacio de
  interacción en fútbol. *Revista de Psicología del Deporte* 22(2):437–446.
  https://ddd.uab.cat/pub/revpsidep/revpsidep_a2013v22n2/revpsidep_a2013v22n2p437.pdf. In
  Spanish; same data as the paper above.
- Duarte R, Araújo D, Correia V, Davids K, Marques P, Richardson MJ (2013). Competing together:
  assessing the dynamics of team–team and player–team synchrony in professional association
  football. *Hum Mov Sci* 32(4):555–566. doi:10.1016/j.humov.2013.01.011. Abstract only.
- Errekagorri I, Fernandez-Navarro J, López-Del Campo R, Resta R, Castellano J (2024). An
  eight-season analysis of the teams' performance in the Spanish LaLiga according to the final
  league ranking. *PLoS ONE* 19(2):e0299242. doi:10.1371/journal.pone.0299242
- Forcher L, Forcher L, Jekauc D, Woll A, Gross T, Altmann S (2022). Center backs work hardest
  when playing in a back three: the influence of tactical formation on physical and technical
  match performance in professional soccer. *PLoS ONE* 17(3):e0265501.
  doi:10.1371/journal.pone.0265501
- Forcher L, et al. (2023). The success factors of rest defense in soccer – a mixed-methods
  approach of expert interviews, tracking data, and machine learning. *J Sports Sci Med*
  22(4):707–725. doi:10.52082/jssm.2023.707
- Fradua L, Zubillaga A, Caro Ó, Fernández-García ÁI, Ruiz-Ruiz C, Tenga A (2013). Designing
  small-sided games for training tactical aspects in soccer: extrapolating pitch sizes from
  full-size professional matches. *J Sports Sci* 31(6):573–581.
  doi:10.1080/02640414.2012.746722. The authors' final version, in the NIH Brage repository.
- Gonçalves B, Coutinho D, Exel J, Travassos B, Lago C, Sampaio J (2019). Extracting
  spatial-temporal features that describe a team match demands when considering the effects of
  the quality of opposition in elite football. *PLoS ONE* 14(8):e0221368.
  doi:10.1371/journal.pone.0221368
- Memmert D, Raabe D, Schwab S, Rein R (2019). A tactical comparison of the 4-2-3-1 and 3-5-2
  formation in soccer: a theory-oriented, experimental approach based on positional data in an
  11 vs. 11 game set-up. *PLoS ONE* 14(1):e0210191. doi:10.1371/journal.pone.0210191
- Moura FA, Martins LEB, Anido RO, Barros RML, Cunha SA (2012). Quantitative analysis of
  Brazilian football players' organisation on the pitch. *Sports Biomech* 11(1):85–96.
  doi:10.1080/14763141.2011.637123. Abstract only.
- Olthof SBH, Frencken WGP, Lemmink KAPM (2019). When something is at stake: differences in
  soccer performance in 11 vs. 11 during official matches and training games. *J Strength Cond
  Res* 33(1):167–173. doi:10.1519/JSC.0000000000002936. Table 1 is an image, read as such.
- Rico-González M, Pino-Ortega J, Castellano J, Oliva-Lozano JM, Los Arcos A (2022). Reference
  values for collective tactical behaviours based on positional data in professional football
  matches: a systematic review. *Biol Sport* 39(1):110. doi:10.5114/biolsport.2021.102921.
  Used for the closed studies it tabulates (Frencken et al. 2012; Bartlett et al. 2012).
- Shaw L, Glickman M (2019). Dynamic analysis of team strategy in professional football. Barça
  Sports Analytics Summit.

**Movement**
- Altmann S, Forcher L, Ruf L, Beavan A, Groß T, Lussi P, Woll A, Härtel S (2021).
  Match-related physical performance in professional soccer: position or player specific?
  *PLoS ONE* 16(9):e0256695. doi:10.1371/journal.pone.0256695
- Baptista I, Johansen D, Seabra A, Pettersen SA (2018). Position specific player load during
  match-play in a professional football club. *PLoS ONE* 13(5):e0198115.
  doi:10.1371/journal.pone.0198115
- Barnes C, Archer DT, Hogg B, Bush M, Bradley PS (2014). The evolution of physical and technical
  performance parameters in the English Premier League. *Int J Sports Med* 35(13):1095–1100.
  doi:10.1055/s-0034-1375695. The running values come from the abstract only.
- Bloomfield J, Polman R, O'Donoghue P (2007). Physical demands of different positions in FA
  Premier League soccer. *J Sports Sci Med* 6(1):63–70.
- Bradley PS (2024). 'Setting the Benchmark' Part 1: the contextualised physical demands of
  positional roles in the FIFA World Cup Qatar 2022. *Biol Sport* 41(1):261–270.
  doi:10.5114/biolsport.2024.131090
- Bradley PS, Di Mascio M, Peart D, Olsen P, Sheldon B (2010). High-intensity activity profiles
  of elite soccer players at different performance levels. *J Strength Cond Res*
  24(9):2343–2351. doi:10.1519/JSC.0b013e3181aeb1b3
- Chmura P, Andrzejewski M, Konefał M, Mroczek D, Rokita A, Chmura J (2017). Analysis of motor
  activities of professional soccer players during the 2014 World Cup in Brazil. *J Hum Kinet*
  56:187–195. doi:10.1515/hukin-2017-0036
- Di Salvo V, Benito PJ, Calderón FJ, Di Salvo M, Pigozzi F (2008). Activity profile of elite
  goalkeepers during football match-play. *J Sports Med Phys Fitness* 48(4):443–446. Abstract
  only.
- Harper DJ, Carling C, Kiely J (2019). High-intensity acceleration and deceleration demands in
  elite team sports competitive match play: a systematic review and meta-analysis of
  observational studies. *Sports Med* 49:1923–1947. doi:10.1007/s40279-019-01170-1
- Morgans R, Ju W, Radnor J, Zmijewski P, Ryan B, Haslam C, King M, Kavanagh R, Oliveira R
  (2025). The positional demands of explosive actions in elite soccer: comparison of English
  Premier League and French Ligue 1. *Biol Sport* 42:81–87. doi:10.5114/biolsport.2025.139083
- Nevado Garrosa F, Mallo Saiz J, Quintero-Illera J, Rubio-López J, López-Del Campo R,
  Jiménez-Rubio S (2025). Acceleration-speed profiles in LaLiga: the influence of initial
  running speed and differences between positional roles in elite football players. *Biol
  Sport* 42(4):125–133. doi:10.5114/biolsport.2025.150035
- Oliva-Lozano JM, Fortes V, Krustrup P, Muyor JM (2020). Acceleration and sprint profiles of
  professional male football players in relation to playing position. *PLoS ONE*
  15(8):e0236959. doi:10.1371/journal.pone.0236959
- Sonderegger K, Tschopp M, Taube W (2016). The challenge of evaluating the intensity of short
  actions in soccer: a new methodological approach using percentage acceleration. *PLoS ONE*
  11(11):e0166534. doi:10.1371/journal.pone.0166534

**Ball, passing and possession**
- Anzer G, Bauer P (2022). Expected passes: determining the difficulty of a pass in football
  (soccer) using spatio-temporal data. *Data Min Knowl Disc* 36:295–317.
  doi:10.1007/s10618-021-00810-3
- Carling C (2010). Analysis of physical activity profiles when running with the ball in a
  professional soccer team. *J Sports Sci* 28(3):319–326. doi:10.1080/02640410903473851.
  Abstract only.
- Carstens R, et al. (2026). Harder, shorter, sharper, forward: a comparison of women's and
  men's elite football gameplay (2020–2025). arXiv:2506.22119. Preprint.
- Castellano J, Casamichana D, Lago C (2012). The use of match statistics that discriminate
  between successful and unsuccessful soccer teams. *J Hum Kinet* 31:139–147.
  doi:10.2478/v10078-012-0015-7
- Chacoma A, Perotti JI, Almeira N, Billoni OV (2020). Modeling ball possession dynamics in the
  game of football. arXiv:2005.04020. Preprint; it analyses a public Wyscout event dataset.
  Only the values it prints are used here.
- González-Rodenas J, Aranda-Malaves R, Tudela-Desantes A, Nieto F, Usó F, Aranda R (2020).
  Playing tactics, contextual variables and offensive effectiveness in English Premier League
  soccer matches: a multilevel analysis. *PLoS ONE* 15(2):e0226978.
  doi:10.1371/journal.pone.0226978
- Herold M, Kempe M, Ruf L, Guevara L, Meyer T (2022). Shortcomings of applying data science to
  improve professional football performance: takeaways from a pilot intervention study. *Front
  Sports Act Living* 4:1019990. doi:10.3389/fspor.2022.1019990
- Lago-Peñas C, Lago-Ballesteros J (2011). Game location and team quality effects on performance
  profiles in professional soccer. *J Sports Sci Med* 10:465–471.
- Link D, Hoernig M (2017). Individual ball possession in soccer. *PLoS ONE* 12(7):e0179953.
  doi:10.1371/journal.pone.0179953
- Pfaff C, Hunter E, Hong H, Forestell D, Fialkov A, Drassinower Z, Chan T (2022). Controlling
  ball progression in soccer. arXiv:2210.16474. Preprint.
- Schwarz E, Duffield R, Novak AR, Compton DA, Meyer T (2025). Associations between match-play
  characteristics and environmental temperatures in 4 professional football leagues. *Eur J
  Sport Sci* 25(3):e12256. doi:10.1002/ejsc.12256
- Siegle M, Lames M (2012). Game interruptions in elite soccer. *J Sports Sci* 30(7):619–624.
  doi:10.1080/02640414.2012.667877. Abstract only.
- Taha T, Orlov I (2025). More direct attacks increase likelihood of goals in 2018- and
  2022-Men's World Cup Soccer Finals. *PLoS ONE* 20(3):e0314630.
  doi:10.1371/journal.pone.0314630
- Yamamoto K, Uezu S, Kagawa K, Yamazaki Y, Narizuka T (2023). Theory and data analysis of
  player and team ball possession time in football. arXiv:2308.05460. Preprint.
- Yi Q, Groom R, Dai C, Liu H, Gómez Ruano MÁ (2019). Differences in technical performance of
  players from 'the big five' European football leagues in the UEFA Champions League. *Front
  Psychol* 10:2738. doi:10.3389/fpsyg.2019.02738
- Zhao Y, Liu T (2022). Factors that influence actual playing time: evidence from the Chinese
  Super League and English Premier League. *Front Psychol* 13:907336.
  doi:10.3389/fpsyg.2022.907336

**Pressing and transitions**
- Almeida CH, Ferreira AP, Volossovitch A (2014). Effects of match location, match status and
  quality of opposition on regaining possession in UEFA Champions League. *J Hum Kinet*
  41:203–214. doi:10.2478/hukin-2014-0048
- Andrienko G, Andrienko N, Budziak G, Dykes J, Fuchs G, von Landesberger T, Weber H (2017).
  Visual analysis of pressure in football. *Data Min Knowl Disc* 31(6):1793–1839.
  doi:10.1007/s10618-017-0513-2. The accepted manuscript was read:
  https://openaccess.city.ac.uk/id/eprint/17464/
- Barthelemy B, Ravé G, Govindasamy K, Ali A, Del Coso J, Demeaux J, Bideau B, Zouhal H (2024).
  Impact of technical-tactical and physical performance on the match outcome in professional
  soccer: a case study. *J Hum Kinet* 94:203–214. doi:10.5114/jhk/185933
- Bauer P, Anzer G (2021). Data-driven detection of counterpressing in professional football.
  *Data Min Knowl Disc* 35:2009–2049. doi:10.1007/s10618-021-00763-7
- Campos J, Gonçalves B, Travassos B, Mateus N, Lengua RB, Figueira B, Olthof S, Coutinho D
  (2025). Missing pieces, new patterns: the impact of association football international
  call-ups on team offensive and defensive performance indicators. *Front Psychol* 16:1697146.
  doi:10.3389/fpsyg.2025.1697146
- Hobbs J, Power P, Sha L, Ruiz H, Lucey P (2018). Quantifying the value of transitions in soccer
  via spatiotemporal trajectory clustering. MIT Sloan Sports Analytics Conference.
- Stafylidis A, Mandroukas A, Michailidis Y, Vardakis L, Metaxas I, Kyranoudis AE, Metaxas TI
  (2024). Key performance indicators predictive of success in soccer: a comprehensive analysis
  of the Greek Soccer League. *J Funct Morphol Kinesiol* 9(2):107. doi:10.3390/jfmk9020107
- Vogelbein M, Nopp S, Hökelmann A (2014). Defensive transition in soccer – are prompt
  possession regains a measure of success? *J Sports Sci* 32(11):1076–1083.
  doi:10.1080/02640414.2013.879671. Abstract only.

**Perception** (sources already in `docs/REFERENCES.md` are not repeated: Jordet et al. 2013 and
2020, Aksum et al. 2021, Kokubu et al. 2026, Bekkers 2026, Arbués-Sangüesa et al. 2020)
- Abächerli L, Fuchslocher J, Romann M, Hintermann M (2026). Scan frequency and timing in
  relation to performance in elite youth female football players during 11v11 match play. *Front
  Sports Act Living* 8:1853406. doi:10.3389/fspor.2026.1853406
- Aksum KM, Magnaguagno L, Bjørndal CT, Jordet G (2020). What do football players look at? An
  eye-tracking analysis of the visual fixations of players in 11 v 11 elite football match play.
  *Front Psychol* 11:562995. doi:10.3389/fpsyg.2020.562995
- McGuckian TB, Cole MH, Jordet G, Chalkley D, Pepping G-J (2018). Don't turn blind! The
  relationship between exploration before ball possession and on-ball performance in
  association football. *Front Psychol* 9:2520. doi:10.3389/fpsyg.2018.02520
- Phatak A, Gruber M (2019). Keep your head up—correlation between visual exploration frequency,
  passing percentage and turnover rate in elite football midfielders. *Sports* 7(6):139.
  doi:10.3390/sports7060139
