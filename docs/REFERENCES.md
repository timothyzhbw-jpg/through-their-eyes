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

## Papers and how we use them

### Perception and scanning
- **Bekkers (2026). *Wide Open Gazes: Quantifying Visual Exploratory Behavior in Soccer with Pose
  Enhanced Positional Data.*** arXiv:2602.18519 — https://arxiv.org/abs/2602.18519
  → Our vision layer: probabilistic field of view (120° base, Gaussian decay, speed-dependent) +
  occlusion; observed-space metrics combined with pitch control.
- **Jordet et al. (2020). *Scanning, contextual factors, and association with performance in
  English Premier League footballers.*** Frontiers in Psychology —
  https://nih.brage.unit.no/nih-xmlui/handle/11250/2734590
  → Scan-rate calibration by role and pressure. The effect on pass completion is small but
  positive: don't overclaim causality outside the sim.
- **Jordet et al. (2013), MIT Sloan Sports Analytics Conference** — visual exploratory frequency
  of EPL midfielders/forwards; > 0.5 scans/s is very high.
  Summaries: https://mojo.sport/coachs-corner/what-is-scanning ,
  https://www.skysports.com/football/news/11096/11119387/what-gave-xavi-hernandez-and-andrea-pirlo-an-edge-on-the-rest-the-secret-to-his-vision
- ***Visual Perception in Elite Football*** (NIH doctoral thesis) —
  https://nih.brage.unit.no/nih-xmlui/handle/11250/2828246
  → > 90% of scans last ≤ 0.66 s and very few include a fixation → peripheral-vision model.
- ***Correspondence between motion sensor kinematics and notational analysis of scanning in
  field-based football gameplay*** — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13441872/
  → The 125°/s angular-velocity threshold over-counts scans → threshold sweep in the scan detector.
- **Arbués-Sangüesa et al. (CVPRW 2020; J. Sports Sciences 2021)** — body orientation → pass
  feasibility. https://arxiv.org/abs/2004.07209 , https://repositori.upf.edu/handle/10230/57891
  → Receiver orientation in the decision model; production path for orientation from video.

### Space and value
- **Spearman (2018). *Beyond Expected Goals.*** MIT Sloan — pitch control, time to intercept.
- **Shaw, Friends of Tracking (LaurieOnTracking)** — simplified TTI and default parameters
  (reaction 0.7 s, v_max 5 m/s, σ 0.45 s). Reference only; no license found → reimplemented.
  https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking
- **Bekkers. *Pressing Intensity: An Intuitive Measure for Pressing in Soccer.*** arXiv:2501.04712 —
  https://arxiv.org/abs/2501.04712
- **Singh (2019). *Expected Threat (xT)*** (blog) — implemented in socceraction.
- **Choi (2026). *Training-Free Off-Screen Player Imputation for Broadcast-Based Spatial Football
  Analytics.*** arXiv:2607.11548 — https://arxiv.org/abs/2607.11548
  → Production-path caveat: a broadcast camera shows only 10–16 players at a time.

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
| pytest, ruff | MIT | **use** (dev only) |
| three.js, @react-three/fiber, @react-three/drei | MIT | **use** |
| socceraction | MIT | **not used** — xT is our own value iteration (~100 lines); socceraction is no longer developed (1.5.3 supports Python < 3.13) |
| kloppy | BSD-3 | optional: kloppy-compatible export of synthetic data |
| floodlight | MIT | optional: extra analyst metrics |
| unravelsports | MPL | optional, unmodified only; Python 3.11 only |
| Python-RVO2 | Apache-2.0 | optional collision avoidance; only tested on old Python versions |
| google-research/football | Apache-2.0 | not used (C++ engine build risk in the time budget) |
| PitchAura | GPL-3.0 | **do not use** (copyleft) — ideas only |
| LaurieOnTracking | no license found | **do not copy** — reimplement from papers |
| SoccerMaster | weights Apache-2.0; code repo has no LICENSE file; bundles YOLOv8 (AGPL) | **not in submission** |
