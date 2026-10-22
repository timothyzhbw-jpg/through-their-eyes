# References and dependency decisions

## Hackathon
- Official rules: https://aka.ms/insidethegame/rules, which redirects to
  https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md.
  **Checked 2026-10-19:** matches the participant-hosted mirror the plan was built from
  (https://github.com/faizalkhan24/Microsoft-Premier-League-Hackathon-Official-Rules/blob/main/OFFICIAL%20RULES.md);
  the rules file last changed 2026-09-28. Amendments are posted on the hackathon website (§11.5).
  Facts that shape the plan:
  - registration closes 2026-10-20 12:00 PT; submissions close 2026-10-27 23:59 PT; judging until
    2026-11-10, and the project must stay testable free of charge until then;
  - teams of up to 4; the repo must be public and the project newly created after 2026-09-29;
  - video < 2 min on YouTube / Vimeo / Facebook Video / Youku, showing the project running; no
    third-party trademarks or unlicensed music; all materials in English;
  - "Projects must use synthetic, football-realistic data"; the organisers provide no data and no
    Azure credit;
  - the "hero technologies" (Foundry, Agent Framework, Azure MCP, GitHub Copilot Agent Mode,
    Fabric, …) are judging guidance; none is named as mandatory;
  - the multi-agent prize is called "Best Multi-Agent System" in §4.2 and "Best Multi-Agent
    Orchestration" in §8 of the rules.
- Learning resources: `RESOURCE PLAYLISTS.md` in the same repo.
- Registration / landing: https://events.microsoft.com/flow/microsoft/plmshackathon/registration/page/landing

### Related hackathon work (NBA × AWS "Broadcast Code 12H", 2026-10-10/11)
Checked 2026-10-19; the winners list and the official brief were not reachable. Ideas only — no
code is copied (CLAUDE.md rule 1).
- **AgentDunker** (silver): 3D tactical sketches of screens and runs, freeze at the shot with xFG,
  commentary in a pro style with an in-house voice model.
  https://www.xiaohongshu.com/explore/6ad1e6e7000000000a027f1b
- **GameBuddy** (silver, MIT): one evidence store; a small RL-trained model returns evidence ids
  only; numbers copied from source records and checked programmatically (subject, metric, unit,
  period, source); a 23.8 s play expanded to 55 s with freeze / rewind / slow motion; two-voice
  commentary; shareable MP4. https://github.com/imhaojie/BroadcastCode-2026
- **NBA_AWS_Broadcast12** (entry, MIT): seeded synthetic trajectories, labelled as such; key plays
  scored on five dimensions; four-layer SVG tactics board; commentary tiers calm / excited /
  clutch; overlay on/off comparison as the highlight.
  https://github.com/CodeGanHaoZ/NBA_AWS_Broadcast12
→ What we took: belief-vs-truth probability at the action freeze (§5.1), two voices and delivery
  tiers (§6), the With / Without toggle as the video highlight (§10), clip export as a stretch (§7).
  None of them models perception or counterfactuals (§0).

### Competing entries (Inside the Game, public repos, checked 2026-10-19)
14 public entry repos were created after 2026-09-29; four were read. Ideas only, no code copied.
- **Matchday Companion** — https://github.com/ogu83/inside-the-game-hackathon — deployed on ACA,
  video done; interruptible AI co-commentator (push to talk); a fact-checker evaluated with Foundry
  groundedness; English and Turkish; a table of proof numbers at the top of the README.
- **Shield** — https://github.com/digitaladaption/shield — "What he sees": every passing lane from
  a selected player (open / contested / blocked), drawn on the true state, with no vision or
  belief; a "without him" counterfactual estimated from other plays, not re-simulated.
- **Tactical Intelligence Live** — https://github.com/Harvare1/tactical-intelligence-live — event
  stream with rolling-window rules; no tracking data.
- **StudioLens** — https://github.com/Josephjbassey/inside-the-game — narrative, tactics and
  recaps; Azure Translator for languages.

### Related products judges may know: FIFA AI Pro and Referee View (World Cup 2026)
Checked 2026-10-21. Our build environment could not open these pages (the proxy refused them), so
the facts below come from search-engine excerpts of the releases and of press coverage; re-read a
release before quoting a detail from it. Every figure is company-reported. Related work only:
FIFA, Lenovo and Referee View are named in this file, the README and docs/SUBMISSION.md, never in
the app, the video, docs/VIDEO_SCRIPT.md, assets or code (CLAUDE.md rule 2, read
conservatively), and no logos anywhere.
- **FIFA AI Pro** (announced as "Football AI Pro" at Lenovo Tech World @ CES, January 2026): a
  generative-AI knowledge assistant that Lenovo built with FIFA for the national teams' analysts
  and coaches. Staff ask questions in natural language over official match data and footage,
  described in FIFA's Football Language (FIFA's standard vocabulary for football data). Lenovo
  reports that it orchestrates several agents over more than 2,000 metrics. Answers come as
  text, graphs, video clips and 3D recreations with player avatars. It is for pre- and
  post-match analysis and is not used during live play. FIFA calls its output "validated
  insights" and Lenovo "data-validated"; in the excerpts we read, neither says how a figure is
  checked. Lenovo reports that all 48 teams at the 2026 World Cup used it, in 16 languages, with
  thousands of queries from over 300 individual users.
- **Referee View**: the referee's body camera as a first-person broadcast feed, its footage
  smoothed in real time by Lenovo's AI stabilisation. Lenovo reports that the feed's footage of
  the tournament's opening goal generated over 20 billion impressions.
- Sources (press releases, except the last):
  - FIFA, "FIFA and Lenovo unveil multiple AI-powered innovations ahead of FIFA World Cup 2026"
    (January 2026) —
    https://inside.fifa.com/media-releases/lenovo-tech-world-ai-powered-innovations-world-cup-2026
  - Lenovo, "Leveling the Playing Field: Football AI Pro Powers Intelligence Across the Game"
    (agents, 2,000+ metrics, outputs) —
    https://news.lenovo.com/pressroom/press-releases/football-ai-pro-powers-intelligence-across-the-game/
  - Lenovo, "All 48 Teams Use FIFA AI Pro at FIFA World Cup 2026" —
    https://news.lenovo.com/pressroom/press-releases/all-48-teams-use-fifa-ai-pro-world-cup-2026/
  - Lenovo, "FIFA World Cup Fans Embrace Referee View as Lenovo AI Brings Viewers Closer to the
    Pitch" —
    https://news.lenovo.com/pressroom/press-releases/referee-view-as-lenovo-ai-brings-viewers-closer-to-the-pitch/
  - Lenovo, "Lenovo Successfully Delivers Technology at Biggest Ever FIFA World Cup 2026" (16
    languages, over 300 users, 20 billion impressions) —
    https://news.lenovo.com/pressroom/press-releases/lenovo-successfully-delivers-technology-at-biggest-ever-fifa-world-cup-2026/
  - Computer Weekly, "Lenovo taps AI and digital twins to power World Cup 2026" (news,
    2026-01-07) —
    https://www.computerweekly.com/news/366636909/Lenovo-taps-AI-and-digital-twins-to-power-World-Cup-2026
→ How we differ (README, docs/SUBMISSION.md). Each point was checked against main on 2026-10-21:
  - FIFA AI Pro answers *what happened*, from statistics, before and after a match, behind a
    "validated" label. We answer *what he saw and what he believed*, on the live stream:
    `api/live.py` streams the synthetic match at 25 Hz with every player's head yaw and the
    blind-side alerts and announces each moment as its window closes; the web app then plays
    the moment's breakdown.
  - Every number in the captions and narration is a verified claim: the narration agents pick
    claim ids and never write a digit. A viewer can open each claim's evidence card and, on any
    claim with a number, **Try a wrong number**: `TamperControl` (`web/src/ui/Narration.tsx`)
    sends the value to `POST /api/verify`, and `api/tamper.py` runs the real verifier on it.
  - What-ifs are re-simulated, not estimated: `agents/whatif.py` maps the question to one of the
    options the player evaluated, and `force_action_counterfactual` (`sim/counterfactual.py`)
    re-runs the moment with that option forced. The scan hero's counterfactual re-runs it
    without the key scan (`drop_scan_counterfactual`).
  - Referee View's reach, by Lenovo's figures, shows that fans want first person. It shows what
    a camera captured; we show what the player perceived: his vision cone, where he believed the
    others were, and the decision he took on that belief.
  - What it has that we don't: real data, at a real tournament, used by real teams. Ours runs on
    synthetic matches only (README, "Related work").

### Real-world precedents for the impact pitch (check each detail before quoting it)
- **ReSpo.Vision: first-person replay already exists commercially.** Checked 2026-10-20. Its
  computer vision extracts 3D tracking, with body keypoints, from single-camera video such as a
  standard TV broadcast; its digital twin lets fans relive key moments from a player's
  first-person perspective, the company's example being a goal through a striker's eyes —
  https://tech.eu/2025/06/10/respovision-raises-eur42m-to-redefine-the-sports-viewing-experience/
  (funding news, 2025-06-10; the technical claims are the company's own), https://respo.vision/
  (single video feed reconstructed in 2D and 3D; player positions, body keypoints and ball up to
  25 times per second). Bekkers (2026, below) uses its head, shoulder and hip angles.
  → We do not claim POV as new. Our contribution is the perception model behind it (what he saw,
  what he believed, and the decision taken on that belief) and the counterfactual re-simulated
  without one scan. README "Related work".
- Beyond Sports (Sony): tracking turned into live animated broadcasts —
  https://www.beyondsports.nl/news/zappsport-live-wk-voetbal-animated-broadcasts-and-highlights-for-fifa-world-cup-2026
- Premier League semi-automated offside (Genius Sports) tracks skeletal points per player —
  https://www.sportico.com/business/tech/2024/premier-leagues-new-offside-tech-genius-sports-1234793387/
  Head *orientation* needs more than one head point; confirm before claiming it feeds §4.7.
- LaLiga × Microsoft "Beyond Stats": a Microsoft-stack precedent for live football analytics.
- Amazon Prime Vision live alerts for NFL —
  https://www.aboutamazon.com/news/entertainment/thursday-night-football-amazon-prime-video-ai-features

## The Laws of the Game (SPEC 3.9)
- The International Football Association Board (IFAB), *Laws of the Game 2026/27*,
  https://www.theifab.com/laws/latest/ (the edition the site serves as "latest"; changes listed at
  https://www.theifab.com/law-changes/latest/). **Read law by law on 2026-10-22:** Laws 1, 2, 3,
  8, 9, 10, 11, 12, 13, 15, 16 and 17, the laws the sim can express.
- How we use it: `sim/laws.py` restates each rule in our own words and cites it by law and
  section ("Law 11.2"); `sim/referee.py` enforces it in the frame loop; `eval/laws.py` audits every
  run against it. No text, diagram or figure of the Laws is in the repo. The Laws are © IFAB.
- Section map we cite (2026/27): 1.2 markings, 1.3–1.4 dimensions, 1.5 goal area, 1.6 penalty
  area, mark and arc, 1.7 corner area, 1.10 goals; 2.1 the ball's size and weight; 3.1 number of
  players; 8.1 kick-off; 9.1–9.2 out of and in play; 10.1 goal; 11.1 offside position, 11.2
  offence, 11.3 no offence, 11.4 sanctions and players off the field; 12.1 direct free kick
  (tackles, handling), 12.2 indirect free kick (the keeper's back-pass and throw-in offences),
  12.3 corner kick (the keeper holding the ball over eight seconds);
  13.2 free-kick procedure, 13.3 sanctions; 15.1, 16.1 and 17.1 the throw-in, goal kick and
  corner procedures.
- Not expressed, and why: offside's "clearly attempting to play a close ball" and "an obvious
  action" need a judgement the sim has no data for; the free-kick wall (13.2) needs a free kick the
  sim never plays; the dropped ball (8.2), the eight-second keeper rule (12.3) and the
  crossbar need situations the sim never creates (no match officials, keepers hold the ball for
  under a second, every ball is on the ground).

## Papers and how we use them

### Perception and scanning
- **Bekkers (2026). *Wide Open Gazes: Quantifying Visual Exploratory Behavior in Soccer with Pose
  Enhanced Positional Data.*** arXiv:2602.18519 — https://arxiv.org/abs/2602.18519
  → Our vision layer: probabilistic field of view (120° base, Gaussian decay, speed-dependent) +
  occlusion; observed-space metrics combined with pitch control.
  Data (§2.2, checked 2026-10-20): 32 games of 2024 Copa América broadcast tracking from
  ReSpo.Vision at 25 fps, with head, shoulder and hip rotation per player, synchronised with Opta
  events. Code: https://github.com/USSoccerFederation/ssac26_visual_exploratory_behavior (not
  used; we reimplement from the paper). It models vision, not belief or decisions; those, and the
  re-simulated counterfactual, are ours.
- **Jordet et al. (2020). *Scanning, contextual factors, and association with performance in
  English Premier League footballers.*** Frontiers in Psychology 11:553813 —
  https://nih.brage.unit.no/nih-xmlui/handle/11250/2734590 (full text:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC7573254/)
  → Scan-rate calibration by role and pressure. The effect on pass completion is small but
  positive: don't overclaim causality outside the sim. Printed values used by the realism report
  (`eval/reports/realism.md`): 3.0 ± 2.1 scans and 0.44 ± 0.30 scans/s in the 10 s before
  receiving; role and pressure effect sizes with 95% CIs (Figures 2 and 3). Figure 2 plots the
  role means without printing them.
- **Jordet et al. (2013), MIT Sloan Sports Analytics Conference** — visual exploratory frequency
  of EPL midfielders/forwards; > 0.5 scans/s is very high.
  Summaries: https://mojo.sport/coachs-corner/what-is-scanning ,
  https://www.skysports.com/football/news/11096/11119387/what-gave-xavi-hernandez-and-andrea-pirlo-an-edge-on-the-rest-the-secret-to-his-vision
  Paper: https://www.sloansportsconference.com/research-papers/the-hidden-foundation-of-field-vision-in-english-premier-league-epl-soccer-players
  — prints 0.27 (SD 0.22) and 0.33 (SD 0.25) searches/s for players without and with a major
  award; "> 0.5 is very high" is the summaries' wording, not the paper's.
- ***Visual Perception in Elite Football*** (NIH doctoral thesis, Aksum 2021) —
  https://nih.brage.unit.no/nih-xmlui/handle/11250/2828246
  → > 90% of scans last ≤ 0.66 s and very few include a fixation → peripheral-vision model.
  The duration figures come from **Aksum et al. (2021). *Scanning activity of elite football
  players in 11 vs. 11 match play.*** PLoS ONE 16(8):e0244118 (by the thesis author; not checked
  against the thesis's paper list, whose repository was unreachable on 2026-10-19) —
  https://pmc.ncbi.nlm.nih.gov/articles/PMC8378692/ : 869 scans, mean 0.3965 s (SD 0.2842),
  90.3% ≤ 0.66 s, timed by the ball leaving the eye-tracker's ≥ 82° scene camera.
- **Kokubu et al. (2026). *Correspondence between motion sensor kinematics and notational analysis
  of scanning in field-based football gameplay.*** Frontiers in Psychology 17:1785026 —
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13441872/
  → The 125°/s angular-velocity threshold over-counts scans → threshold sweep in the scan detector.
  Peak head yaw rate of detected scans: 404.2 ± 50.7°/s (Results 3.1).
- Movement and ball speeds: the papers in this section print no measured sprint speed,
  acceleration or pass speed. Spearman (2018) sets v = 5 m/s and a = 7 m/s² in its
  time-to-intercept model as model parameters, not measurements. Measured values are now in
  "Sim parameters" below (2026-10-21): Bradley 2024, Nevado Garrosa et al. 2025, Oliva-Lozano et
  al. 2020, Herold et al. 2022 and Pfaff et al. 2022. The realism report has not been updated
  and still marks these rows "no published reference".
- **Arbués-Sangüesa et al. (CVPRW 2020; J. Sports Sciences 2021)** — body orientation → pass
  feasibility. https://arxiv.org/abs/2004.07209 , https://repositori.upf.edu/handle/10230/57891
  → Receiver orientation in the decision model; production path for orientation from video.

### Shots and goalkeepers (hero expansion pack, Module A; `sim/shots.py`)
All read on 2026-10-20. Each entry says what we use: a fitted constant, a *tunable* choice inside a
printed range, or a shape only. It also says how far the source was read.
- **Bransen, Janssen & Davis (2025). *Stop Guessing: Optimizing Goalkeeper Policies for Soccer
  Penalty Kicks.*** arXiv:2505.24629 (a preprint, not peer-reviewed) —
  https://arxiv.org/abs/2505.24629
  → **Fitted constants of the save model.** Eq. 2 and Appendix C, fitted by Brier score on real
  penalties with the keeper in the correct corner:
  - dive range 2.8 m on the kick (late dive) and 3.1 m going early;
  - uncertainty band µ = 0.7 m;
  - save rate within reach ρ = 0.7.
  Using a model fitted on penalties for low open-play shots is our assumption (SPEC 3.3).
  *Read:* full text.
- **Dicks, Button & Davids (2010).** Attention, Perception & Psychophysics 72:706–720, and
  **Zheng, de Reus & van der Kamp (2021).** Human Movement Science 76:102763.
  → **Secondary only.** The 500–600 ms penalty flight time behind t_pen = 0.55 s is cited by
  Bransen et al. *Read:* neither primary.
- **Kellis & Katis (2007). *Biomechanical characteristics and determinants of instep soccer
  kick.*** Journal of Sports Science and Medicine 6(2):154–165.
  → **A tunable choice inside a printed range.** Shot speed U(24, 30) m/s lies within the
  18–35 m/s of maximal instep kicks. *Read:* abstract and key points.
- **Hunter, Angilletta, Pavlic, Lichtwark & Wilson (2018). *Modeling the two-dimensional
  accuracy of soccer kicks.*** Journal of Biomechanics 72:159–166, doi:10.1016/j.jbiomech.2018.03.003.
  → **Shape only.** Error variance grows as a power function of ball speed. The aim error of 2.5°
  is ours (*tunable*); no number comes from the paper. *Read:* abstract.
- **Ibrahim, Kingma, de Boode, Faber & van Dieën (2019).** Frontiers in Sports and Active
  Living 1:15 (full text) and Journal of Sports Sciences 37(3):313–321 (abstract).
  → **No value used.** A full dive takes about 1.0 s from signal to ball contact, a sanity check
  only. The J Sports Sci abstract gives the legs' contributions to horizontal centre-of-mass
  velocity (2.7 and 1.2 m/s), not a take-off speed.
- **Kerwin & Bray (2006). *Measuring and modelling the goalkeeper's diving envelope in a penalty
  kick.*** The Engineering of Sport 6, vol. 1, 321–326.
  → **Context only.** 500–700 ms from boot to goal line. *Read:* catalogue abstract.
- **Uncited, so swept or marked *tunable*.**
  - v_dive (reach gained per extra second): no primary number found (the papers above, and a
    literature check with another model), so every keeper gate is re-run at 2.5 and 4.0 m/s.
  - The dive's tracking limits (4 m/s, 15 m/s²).
  - The 0.2 s render delay before a dive.
  - The bisector rule with the keeper 1.5 m off his line.

### Space and value
- **Spearman (2018). *Beyond Expected Goals.*** MIT Sloan — pitch control, time to intercept.
- **Shaw, Friends of Tracking (LaurieOnTracking)** — simplified TTI and default parameters
  (reaction 0.7 s, v_max 5 m/s, σ 0.45 s). Reference only; no license found → reimplemented.
  https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking
- **Fernández, Bornn, Cervone (2021). *A framework for the fine-grained evaluation of the
  instantaneous expected value of soccer possessions.*** Machine Learning —
  https://arxiv.org/abs/2011.09426
  → What "EPV" means: several sub-models trained on real tracking data. Our pass value surface is
  a simpler xT-based value (§7), named so to avoid the comparison.
- **Bekkers. *Pressing Intensity: An Intuitive Measure for Pressing in Soccer.*** arXiv:2501.04712 —
  https://arxiv.org/abs/2501.04712
- **Singh (2019). *Expected Threat (xT)*** (blog) — implemented in socceraction.

### Live match stats (SPEC 4.6)
- **Gualtieri, Rampinini, Dello Iacono & Beato (2023). *High-speed running and sprinting in
  professional adult soccer: current thresholds definition, match demands and training
  strategies. A systematic review.*** Frontiers in Sports and Active Living 5:1116293 —
  https://doi.org/10.3389/fspor.2023.1116293 (full text read, 2026-10-21).
  → Our thresholds: across the 30 studies, the most common entry speeds for male professionals are
  19.8 km/h for high-speed running and 25.2 km/h for sprinting (§ "Defining 'absolute'
  thresholds"); it finds no consensus and lists entry speeds from 14.4 to 21.1 and 19.8 to
  30 km/h. It gives no minimum sprint duration; our 0.4 s is our own choice.
  Its match-demand table lists Altmann et al. (2021) at 495 m of sprinting. Altmann's own Table 1
  prints 0.27 km of sprinting and 495 accelerations, so do not take match demands from that table.
- **Spearman, Basye, Dick, Hotovy & Pop (2017). *Physics-Based Modeling of Pass Probabilities in
  Soccer.*** MIT Sloan Sports Analytics Conference (11th) —
  https://www.researchgate.net/publication/315166647_Physics-Based_Modeling_of_Pass_Probabilities_in_Soccer
  (the PDF was not reachable; read through a secondary summary,
  https://thexgfootballclub.substack.com/p/the-perfect-pass-formula-can-physics , 2026-10-21).
  → The lane term of our pass difficulty: per player, the ball's flight time to a point against
  his time to intercept, with logistic temporal uncertainty (σ = 0.45 s, the value fitted there
  and the pitch-control default). We do not use its control term or its fitted pass model; ours
  is not fitted to anything.
- Bekkers' pressing intensity (above) gives the pressure on the passer and the receiver.
- **Choi (2026). *Training-Free Off-Screen Player Imputation for Broadcast-Based Spatial Football
  Analytics.*** arXiv:2607.11548 — https://arxiv.org/abs/2607.11548
  → Production-path caveat: a broadcast camera shows only 10–16 players at a time.

### Sim parameters ([SIM_PARAMETERS.md](SIM_PARAMETERS.md), 2026-10-21)
Published aggregate values for team shape, movement, passing, pressing and scanning, each read in
the source. The dossier gives every value with its table or page, its population and the sim's
current number, and lists the full citations. The sources added there, by area:
- **Team shape:**
  - Errekagorri et al. 2024, *PLoS ONE* 19:e0299242: LaLiga width, length and line height per
    match.
  - Castellano, Álvarez-Pastor & Blanco-Villaseñor 2013, *Rev Psicol Deporte* 22(2):437–446:
    shape in vs out of possession.
  - Castellano & Álvarez 2013, *RICYDE* 9(32):126–136: line height = 6.3 m + 0.46 × the ball's
    distance to goal.
  - Gonçalves et al. 2019, *PLoS ONE* 14:e0221368, and Fradua et al. 2013, *J Sports Sci*
    31(6):573–581: both teams' length and width.
  - Olthof, Frencken & Lemmink 2019, *J Strength Cond Res* 33(1):167–173: centroid coupling,
    youth.
  - Rico-González et al. 2022, *Biol Sport* 39(1): a review of reference values.
  - Forcher et al. 2022, *PLoS ONE* 17:e0265501: formation counts.
  - Forcher et al. 2023, *J Sports Sci Med* 22(4):707–725: rest defence.
  - Amichay et al. 2025, *Sci Rep* 15:35217: inter-line distances, citing Forcher et al. 2024.
  - Memmert et al. 2019, *PLoS ONE* 14:e0210191; Moura et al. 2012, *Sports Biomech* 11:85–96;
    Duarte et al. 2013, *Hum Mov Sci* 32:555–566; Shaw & Glickman 2019 (Barça Sports Analytics
    Summit); Bialkowski et al. 2014 (MIT Sloan).
- **Movement:**
  - Bradley et al. 2010, *J Strength Cond Res* 24(9):2343–2351: distance and time by speed zone
    and position.
  - Bradley 2024, *Biol Sport* 41(1):261–270: peak speed by role, World Cup 2022.
  - Altmann et al. 2021, *PLoS ONE* 16:e0256695: Bundesliga distance by position.
  - Nevado Garrosa et al. 2025, *Biol Sport* 42(4):125–133: acceleration against current speed.
  - Oliva-Lozano et al. 2020, *PLoS ONE* 15:e0236959: peak acceleration and deceleration, sprints.
  - Sonderegger et al. 2016, *PLoS ONE* 11:e0166534; Harper et al. 2019, *Sports Med*
    49:1923–1947; Morgans et al. 2025, *Biol Sport* 42:81–87; Baptista et al. 2018, *PLoS ONE*
    13:e0198115; Chmura et al. 2017, *J Hum Kinet* 56:187–195; Bloomfield et al. 2007, *J Sports
    Sci Med* 6:63–70; Barnes et al. 2014, *Int J Sports Med* 35:1095–1100; Di Salvo et al. 2008,
    *J Sports Med Phys Fitness* 48:443–446.
- **Ball, passing and possession:**
  - Link & Hoernig 2017, *PLoS ONE* 12:e0179953: ball in play, time on the ball.
  - Schwarz et al. 2025, *Eur J Sport Sci* 25:e12256: passes and length mix.
  - Anzer & Bauer 2022, *Data Min Knowl Disc* 36:295–317: completion.
  - Zhao & Liu 2022, *Front Psychol* 13:907336; Siegle & Lames 2012, *J Sports Sci* 30:619–624:
    stoppages.
  - Yamamoto et al. 2023, Chacoma et al. 2020, Pfaff et al. 2022 and Carstens et al. 2026, all
    arXiv preprints: possession durations, pass speed, passes per team.
  - Herold et al. 2022, *Front Sports Act Living* 4:1019990; González-Rodenas et al. 2020, *PLoS
    ONE* 15:e0226978; Yi et al. 2019, *Front Psychol* 10:2738; Lago-Peñas & Lago-Ballesteros
    2011, *J Sports Sci Med* 10:465–471; Castellano, Casamichana & Lago 2012, *J Hum Kinet*
    31:139–147; Taha & Orlov 2025, *PLoS ONE* 20:e0314630; Carling 2010, *J Sports Sci*
    28:319–326.
- **Pressing and transitions:**
  - Andrienko et al. 2017, *Data Min Knowl Disc* 31:1793–1839: pressure zone, 9 m in front and
    3 m behind.
  - Bauer & Anzer 2021, *Data Min Knowl Disc* 35:2009–2049: counterpressing.
  - Hobbs et al. 2018 (MIT Sloan): counter-attacks.
  - Almeida, Ferreira & Volossovitch 2014, *J Hum Kinet* 41:203–214: where the ball is won.
  - Campos et al. 2025, *Front Psychol* 16:1697146; Stafylidis et al. 2024, *J Funct Morphol
    Kinesiol* 9:107; Barthelemy et al. 2024, *J Hum Kinet* 94:203–214: PPDA.
  - Vogelbein, Nopp & Hökelmann 2014, *J Sports Sci* 32:1076–1083 (abstract only).
- **Perception:**
  - McGuckian et al. 2018, *Front Psychol* 9:2520: head turns before receiving.
  - Abächerli et al. 2026, *Front Sports Act Living* 8:1853406: scanning on the ball, youth women.
  - Aksum et al. 2020, *Front Psychol* 11:562995: fixation durations.
  - Phatak & Gruber 2019, *Sports* 7:139: scanning against pass completion.
→ The sim gaps these values show are listed in SIM_PARAMETERS.md §6. The sim changes go through
  the session that owns `sim/`, one writer at a time.

### Counterfactuals and tactics
- **Wang et al. (2024). *TacticAI: an AI assistant for football tactics.*** Nature Communications —
  https://deepmind.google/blog/tacticai-ai-assistant-for-football-tactics/
  → Precedent for counterfactual tactics developed with a Premier League club.
- **Le et al. (2017). *Data-Driven Ghosting using Deep Imitation Learning.*** MIT Sloan — ghost
  visualisation precedent.
- **Rao et al. (2026). *GenTac: Generative Modeling and Forecasting of Soccer Tactics.***
  arXiv:2604.11786 — code, data and weights not released yet (as of 2026-10-19).

### Counterfactual sampling
- **Oberst & Sontag (2019). *Counterfactual Off-Policy Evaluation with Gumbel-Max Structural
  Causal Models.*** ICML 2019 — https://arxiv.org/abs/1905.05824
  → Decisions are sampled with Gumbel-max over keyed per-option noise, so factual and
  counterfactual decisions share noise (SPEC 3.5).

### Video understanding (production path)
- **Yang et al. (2026). *SoccerMaster: A Vision Foundation Model for Soccer Understanding.*** CVPR
  2026 Oral — https://haolinyang-hlyang.github.io/SoccerMaster/
- **Rao et al.** UniSoccer (CVPR 2025), SoccerAgent (ACM MM 2025), MatchTime (EMNLP 2024).

- **NFL "step and turn"** — arXiv:2603.17866 (as reported, not yet read): compares actual movement
  with simulated alternatives; related work for counterfactual movement.

### Faithful generation
- **Wiseman, Shieber, Rush (2017). *Challenges in Data-to-Document Generation*** (RotoWire), EMNLP
  — https://arxiv.org/abs/1707.08052
  → Extractive "relation generation" precision → our claim-precision metric.

## Dependency decisions

| Package | License | Decision |
|---|---|---|
| microsoft/agent-framework | MIT | **use** (multi-agent workflow, MCP tools); GA, weekly releases (1.22.0 on 2026-10-15) → pin the exact version |
| Azure / Foundry SDKs | Microsoft | **use** |
| numpy | BSD-3 | **use** (sim and analytics kernels) |
| pydantic | MIT | **use** (schemas that cross process boundaries) |
| azure-cosmos | MIT | **use** (Cosmos DB store for the result cache and the claims audit, SPEC §8) |
| opentelemetry-api | Apache-2.0 | **use** (tracing spans for the agent crew, SPEC §8); `opentelemetry-sdk` (Apache-2.0) comes with azure-monitor-opentelemetry and backs the in-memory exporter in tests |
| azure-monitor-opentelemetry | MIT | **use** (exports the spans to Application Insights, SPEC §8); pulls OpenTelemetry instrumentations (Apache-2.0) and asgiref, oauthlib, psutil (BSD-3), wrapt (BSD-2), msrest (MIT), requests-oauthlib (ISC) |
| azure-ai-evaluation | MIT | **use, `eval/narration_ablation.py` only** (own dependency group `eval`): `GroundednessEvaluator` scores free-text vs anchored narration against the claims, judged by our Foundry deployment (SPEC §6). Pulls pandas, jinja2, markupsafe, joblib, cloudpickle (BSD-3), nltk, tzdata (Apache-2.0), python-dateutil (Apache-2.0/BSD), pytz, ruamel.yaml, six (MIT), tqdm (MPL-2.0 and MIT, unmodified), defusedxml (PSF-2.0, like typing-extensions already in the main dependencies) |
| pytest, ruff | MIT | **use** (dev only) |
| pyarrow | Apache-2.0 | **use, `sim/dataset.py` only** (own dependency group `dataset`, a default group so tests have it; not in the API image): writes the downloadable dataset's Parquet files ([DATASET.md](DATASET.md)) |
| three.js, @react-three/fiber, @react-three/drei | MIT | **use** |
| socceraction | MIT | **not used** — xT is our own value iteration (~100 lines); socceraction is no longer developed (1.5.3 supports Python < 3.13) |
| kloppy | BSD-3 | optional: kloppy-compatible export of synthetic data |
| floodlight | MIT | optional: extra analyst metrics |
| unravelsports | MPL | optional, unmodified only; Python 3.11 only |
| Python-RVO2 | Apache-2.0 | optional collision avoidance; only tested on old Python versions |
| google-research/football | Apache-2.0; `third_party/gfootball_engine` (Gameplay Football, Bastiaan Konings Schuiling) is under the Unlicense, with no separate notice on its assets (checked 2026-10-19) | engine not used (C++ build risk). *Stretch trial (SPEC §7):* player models, skeleton, kit template and animations from `gfootball_engine/data/media`; not the ad-board or stadium textures; credit the original author anyway |
| PitchAura | GPL-3.0 | **do not use** (copyleft) — ideas only |
| LaurieOnTracking | no license found | **do not copy** — reimplement from papers |
| SoccerMaster | weights Apache-2.0; code repo has no LICENSE file; bundles YOLOv8 (AGPL) | **not in submission** |
