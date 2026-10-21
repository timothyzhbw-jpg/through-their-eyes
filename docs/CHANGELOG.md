# Changelog

Merged pull requests by area, newest first within each area.

## sim

- #57 (2026-10-21): set-piece hero corner_blind_side with marking on belief (SPEC 3.6) — [#57](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/57)
- #23 (2026-10-20): mark in possession_play so tight pressure at a reception has a history (SPEC 3.4, 3.8) — [#23](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/23)
- #20 (2026-10-20): calibrate head speed, scan dwell, pressure and role scan rates (SPEC 3.4, 3.8) — [#20](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/20)

## analytics

- #4 (2026-10-20): add the paper's heading penalty, target lead and active filter to pressing (SPEC 4.3) — [#4](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/4)

## explain

- #6 (2026-10-20): claims, verifier and verified rendering (SPEC 5.3) — [#6](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/6)
- #1 (2026-10-19): pressing kernel, MomentCard, moment detection and lens selection (SPEC 4.3, 5.1, 5.2) — [#1](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/1)

## agents

- #50 (2026-10-20): keep every span in Application Insights traces (SPEC 8) — [#50](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/50)
- #46 (2026-10-20): keep model text out of public plan errors (SPEC 5.3, 6, 7) — [#46](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/46)
- #43 (2026-10-20): keep model text out of wrapped trace errors (SPEC 5.3, 6) — [#43](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/43)
- #37 (2026-10-20): map role words in what-if questions to the right receiver (SPEC 6) — [#37](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/37)
- #22 (2026-10-20): tracing spans for the agent crew (SPEC 8, Application Insights) — [#22](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/22)
- #11 (2026-10-20): run the Telestrator and narration in parallel (SPEC 2, 6) — [#11](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/11)

## api

- #55 (2026-10-20): load every match before the port opens, so a redeploy never serves a cold match (SPEC 2, 8) — [#55](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/55)
- #45 (2026-10-20): serve the pressure hero by default (SPEC 2, 8) — [#45](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/45)
- #41 (2026-10-20): the deployed Analyst uses our MCP tool server, on by default (SPEC 6, 8) — [#41](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/41)
- #36 (2026-10-20): harden the public API — TTS by cue key, bounded live stream, input bounds, headers (SPEC 2, 6, 8) — [#36](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/36)
- #21 (2026-10-20): Cosmos DB behind the result cache and the audit sink (SPEC 8) — [#21](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/21)
- #19 (2026-10-20): global daily cap on model-backed regenerations (SPEC 8) — [#19](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/19)
- #17 (2026-10-20): container image for the API service (SPEC 8) — [#17](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/17)

## web

- #56 (2026-10-21): camera director hints, one tap to switch, and an auto director (SPEC 7) — [#56](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/56)
- #53 (2026-10-20): optional skeleton data view on the broadcast camera and the board (SPEC 7, 9) — [#53](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/53)
- #51 (2026-10-20): the pitch-control layer reads either session, so a stitched match opens (SPEC 3.1, 7) — [#51](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/51)
- #47 (2026-10-20): pitch-control shader on the tactical board, parity-tested against numpy (SPEC 4, 7) — [#47](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/47)
- #42 (2026-10-20): play the stitched match and open both hero breakdowns (SPEC 2, 3.1, 7) — [#42](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/42)
- #32 (2026-10-20): broadcast camera, stadium and plan camera mode (SPEC 7) — [#32](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/32)
- #27 (2026-10-20): animated players on by default in first person (SPEC 7) — [#27](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/27)
- #24 (2026-10-20): play the deployed API (live stream, breakdowns, what-if, voice) with offline fallback — [#24](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/24)
- #7 (2026-10-20): show body and head yaw on player tokens (SPEC 7) — [#7](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/7)
- #5 (2026-10-20): hero breakdown player in React Three Fiber, with TelestrationPlan executor (SPEC 7) — [#5](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/5)

## eval

- #25 (2026-10-20): narration ablation, free text vs anchored, with Foundry groundedness (SPEC 6) — [#25](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/25)
- #14 (2026-10-20): realism report against published values (SPEC 3.8) — [#14](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/14)

## docs

- #54 (2026-10-20): a live trace with every step span, voice included (SPEC 8) — [#54](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/54)
- #49 (2026-10-20): the deployed Analyst's MCP tool calls in the live trace; MCP rows back to ✅ (SPEC 8) — [#49](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/49)
- #34 (2026-10-20): architecture diagram for the README and the video's closing frame (SPEC 2, 10) — [#34](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/34)
- #28 (2026-10-20): tick acceptance checks with evidence; add status table (SPEC 9) — [#28](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/28)

## infra

- #16 (2026-10-20): provision the model deployment at capacity 200 (SPEC 8) — [#16](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/16)

## tests

- #52 (2026-10-20): Voice joins the lanes, so its executor runs twice (SPEC 6, 8) — [#52](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/52)
- #29 (2026-10-20): scan rate under pressure on 20 held-out seeds; tick the SPEC 3 check — [#29](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/29)

## video

- #44 (2026-10-20): capture kit for the demo video (SPEC 10) — [#44](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/44)

## demo

- #15 (2026-10-20): real-footage overlay segment (SPEC 7) — [#15](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/15)

## Other

- #40 (2026-10-20): Try a wrong number: the verifier refusing a line, live in the evidence card (SPEC 5.3, 7, 10) — [#40](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/40)
- #39 (2026-10-20): Audio description persona for blind and low-vision viewers (SPEC 1, 5.3, 6, 7) — [#39](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/39)
- #38 (2026-10-20): Failure drill: take crew agents down, bring them back from workflow checkpoints (SPEC 6) — [#38](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/38)
- #35 (2026-10-20): Decision model sees a presser's run-in before he reacts (SPEC 3.5, 3.6) — [#35](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/35)
- #33 (2026-10-20): Judges' three-minute tour: deep links, rubric map, related work (SPEC 0, 7, 11) — [#33](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/33)
- #31 (2026-10-20): Widen past one hero: a pressure hero and a stitched match (SPEC 3.1, 3.6, 5.2) — [#31](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/31)
- #30 (2026-10-20): Perception telemetry panel with the scan detector at work (SPEC 4.7, 7) — [#30](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/30)
- #26 (2026-10-20): Rigged players trial in the POV view (SPEC 7, off by default) — [#26](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/26)
- #13 (2026-10-20): Blind-side alerts: turn on the velocity expectation, accept on fresh seeds (SPEC 4.4) — [#13](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/13)
- #12 (2026-10-20): Blind-side alert overlay on the board, in first person and on the live stream (SPEC 4.4, 7) — [#12](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/12)
- #10 (2026-10-20): Blind-side alerts from tracking, eval and moment trigger (SPEC 4.4, 5.1) — [#10](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/10)
- #9 (2026-10-20): What if box: suggested questions, ghost path and verified answers (SPEC 6, 7) — [#9](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/9)
- #8 (2026-10-20): Pass options on the tactical board with he thought / it was (SPEC 5.1, 7) — [#8](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/8)
- #3 (2026-10-20): Scan detector and non-scan head motion (SPEC 3.4, 4.7) — [#3](https://github.com/timothyzhbw-jpg/through-their-eyes/pull/3)
