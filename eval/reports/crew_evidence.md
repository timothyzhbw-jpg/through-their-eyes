# Why a crew — what the multi-agent architecture buys (SPEC 6)

Offline: no model call. A scripted model (`ScriptedModel` in eval/crew_evidence.py) answers every agent with the choices its deterministic template makes, through Microsoft Agent Framework, the role's structured-output schema and the crew's own code, as a model's reply would; the single agent is eval/single_agent.py, given the same replies in one call. Sample: the 7 hero moments the site serves (`blind_side_run-3`, `corner_blind_side-0`, `press_escape-0`, `far_post_finish-11`, `press_escape-1`, `corner_blind_side-2`, `blind_side_run-11`), each for every persona × language (5 × 2 = 10 scripts per breakdown). Platform: Linux aarch64, Python 3.11.17; the committed report is generated in python:3.11-slim, as the live API computes. Everything is deterministic except the wall times of section 4.

## Headline

- **Fault tolerance.** With any one of the four agents down, 280/280 scripts still aired in 28 drills (7 moments × 4 agents), every plan valid, and the crew kept 3 of its 4 roles on the model; the single agent, whose one call does all four jobs, kept 0 of 4 in each of its 28 drills. With all four down, 70/70 scripts aired on templates. Of 2556 numbers aired across 4728 lines (every fault-free run and drill, both structures), 0 were not a verified slot's value.
- **Recovery.** Bringing an agent back from its checkpoint runs again only the steps that read its output, and gave the fault-free breakdown in 70/70 drills. The Telestrator comes back with 1 model request and narration with 20 (two per script); the Analyst and the Director re-run everything after them (22 and 23 requests for 10 scripts). At Foundry's median latencies (4 scripts), the Telestrator is back in 3.7 s, narration in 3.9 s, the Analyst in 8.0 s and the Director in 9.1 s; the single agent's only way back is its whole call, 9.5 s with crew_vs_single's 30 s timeout (under the deployed 8 s step timeout it times out again and never comes back).
- **Verification by construction.** No field a model writes in its own words accepts a number (24/24 injected numbers rejected), and a narration line can only be a verified claim id or a connective. Of 2837 perturbed lines (11 kinds: a number or a player written by the model, an unbacked term, a broken placeholder, an unknown or forbidden claim, a claim tampered with after verification), 2837 were kept off the air with the Verifier (14 by tidy, 2823 by the Verifier); without it 2823 aired, every one breaking a Verifier rule: 888 false (a wrong number or player, a refuted claim), 704 unverified, 704 garbled, 527 true but written by the model. On the cached Foundry drafts (gpt-4.1-mini, 2026-10-21), today's Verifier rejects 0 of 234 anchored lines; of the free-text drafts, 30 of 32 lines would air with a violation without it (12 wrong ids and numbers from the crew and 3 wrong ids and numbers from the single), 0 with it.
- **Auditability.** 394/394 (100%) aired lines trace to verified claims with an audit record, the voice call that chose them, the Verifier round that passed them and their voice cue; 42/42 (100%) step records hold their times, messages, writes, reads and model calls. The Analyst picked the claims of 288 lines and the voices 64 more from the other verified claims. Gap found: the trace keeps 4,000 characters of a tool result, so for 52 of 352 claim lines the stored `list_claims` result no longer names the claim.
- **Parallelism, not speed.** The Telestrator and narration overlapped for 3.3 s, and every audience's voices run at once: narration took 3.5 s for 10 scripts and 3.4 s for 1, while model requests grew 5 → 23. One call at a time, the same breakdown takes 21.7 s instead of 8.6 s. But the crew is not faster than one agent: 8.6 s vs 9.2 s here (the single agent given 30 s, as in crew_vs_single), and on Foundry crew_vs_single measured 13.8 vs 14.4 s. What the short steps buy is the deployed 8 s step timeout: the single agent's median call is longer, so under it the call times out twice and the breakdown airs on templates after 16.3 s (0 of 4 roles from the model).
- **What it does not buy.** On Foundry the crew wrote no better than one agent (same wrong facts, 0, and groundedness, 5.00), at about six times the requests and twice the cost; with free text its separate voices wrote more wrong facts, not fewer (section 5).

## 1. Fault tolerance

Each agent taken down in turn, then all four, on every moment, through the Producer desk's failure drill (`run_crew(down=...)`, checkpointed in memory): a downed agent's calls raise as in an outage, it retries once and runs on its template, and a workflow request waits for it. Then every waiting step is brought back in the graph's order (`run_crew(bring_back=...)`) until none waits. *Scripts aired*: scripts with at least one aired line, of those asked. *Roles from the model*: of Director, Analyst, Telestrator and narration, those whose part came from the model. *Numbers aired · unverified*: each cited claim verified again against the event store and its sentence rendered; a number in an aired line must be one of its claims' numbers. *The fault-free breakdown*: the request, findings, plan and every script's lines equal a run with nothing down.

| agent down | structure | drills | scripts aired | plans valid | roles from the model, of 4 | waiting | numbers aired · unverified | bring-back: model requests | bring-back: steps run again | after it: the fault-free breakdown |
|---|---|---:|---:|---:|---:|---|---:|---:|---|---:|
| director | crew | 7 | 70/70 | 7/7 | 3.0 | director | 213 · 0 | 23 | director → analyst → telestrator → narration → verifier → voice | 7/7 |
| director | single | 7 | 70/70 | 7/7 | 0.0 | director | 213 · 0 | 1 | director → analyst → telestrator → narration → verifier → voice | 7/7 |
| analyst | crew | 7 | 70/70 | 7/7 | 3.0 | analyst | 213 · 0 | 22 | analyst → telestrator → narration → verifier → voice | 7/7 |
| analyst | single | 7 | 70/70 | 7/7 | 0.0 | director | 213 · 0 | 1 | director → analyst → telestrator → narration → verifier → voice | 7/7 |
| telestrator | crew | 7 | 70/70 | 7/7 | 3.0 | telestrator | 213 · 0 | 1 | telestrator → voice | 7/7 |
| telestrator | single | 7 | 70/70 | 7/7 | 0.0 | director | 213 · 0 | 1 | director → analyst → telestrator → narration → verifier → voice | 7/7 |
| narration | crew | 7 | 70/70 | 7/7 | 3.0 | narration | 213 · 0 | 20 | narration → verifier → voice | 7/7 |
| narration | single | 7 | 70/70 | 7/7 | 0.0 | director | 213 · 0 | 1 | director → analyst → telestrator → narration → verifier → voice | 7/7 |
| all four | crew | 7 | 70/70 | 7/7 | 0.0 | director, analyst, telestrator, narration | 213 · 0 | 23 | 4 bring-backs: director, analyst, telestrator, narration | 7/7 |
| all four | single | 7 | 70/70 | 7/7 | 0.0 | director | 213 · 0 | 1 | director → analyst → telestrator → narration → verifier → voice | 7/7 |

Fault-free, a breakdown of 10 scripts makes 23 model requests in the crew (Director, Analyst, Telestrator, two voices per script) and 1 in the single agent. The single agent's one call is made by its first step, so a drill always leaves that step (`director`) waiting, whichever role was taken down.

Every drill's crew trace records the drill: 35/35 crew drills have a `down`, a `fallback` and a `waiting` event for every agent taken down, 70/70 drills saved checkpoints (6 per run), and 91/91 bring-backs have a `back` event naming the checkpoint they resumed from.

### What a viewer gets through the API

The API in-process (`api.main.create_app`) with the scripted model, a per-client limit of 2 per 10 minutes and a daily cap of 4 model runs, for one moment (`blind_side_run-3`), one persona and language per request as the web app asks; then, on a fresh day, the model service down (every call fails). *Provenance* is what the web shows (`live`: the crew ran for this request; `cached`; `template`: no model call, and why).

| request | viewer | HTTP | provenance | reason | roles from the model, of 4 | waiting | lines aired | unverified numbers |
|---|---|---:|---|---|---:|---|---:|---:|
| first view | a | 200 | `live` | – | 4 | none | 5 | 0 |
| same view, another viewer | b | 200 | `cached` | – | 4 | none | 5 | 0 |
| drill: telestrator down | a | 200 | `live` | – | 3 | telestrator | 5 | 0 |
| bring the telestrator back | b | 200 | `live` | – | 4 | none | 5 | 0 |
| new view, viewer over its limit | a | 200 | `template` | rate_limited | 0 | none | 7 | 0 |
| new view, another viewer | c | 200 | `live` | – | 4 | none | 4 | 0 |
| new view, daily cap reached | d | 200 | `template` | capped | 0 | none | 5 | 0 |
| cached view, daily cap reached | d | 200 | `cached` | – | 4 | none | 5 | 0 |
| model outage, new view | e | 200 | `live` | – | 0 | none | 5 | 0 |
| model outage, same view again | f | 200 | `cached` | – | 0 | none | 5 | 0 |

Every request was answered with a verified breakdown. **Finding:** in a model outage the crew airs on templates, but the API stores that run under the model's cache key and labels it `live`, then `cached`; only the per-step sources (the Producer desk, the crew trace) show that no agent reached the model. `infra.prewarm` reports such views as degraded and `--regenerate-degraded` runs them again.

### Time to recover

Each model call takes its role's median Foundry latency (section 4), for the API's default audiences (casual, analyst × en, zh). *Drill airs*: the run with the agent down; *bring-back*: until the revised breakdown is out.

| structure | step timeout | agent down | drill airs in | bring-back | its model requests | roles from the model after it | a fault-free breakdown from scratch |
|---|---:|---|---:|---:|---:|---:|---:|
| crew | 8 s | director | 7.1 s | 9.1 s | 11 | 4 | 8.6 s |
| crew | 8 s | analyst | 5.1 s | 8.0 s | 10 | 4 | 8.6 s |
| crew | 8 s | telestrator | 8.7 s | 3.7 s | 1 | 4 | 8.6 s |
| crew | 8 s | narration | 8.7 s | 3.9 s | 8 | 4 | 8.6 s |
| single | 30 s | any (one call) | 0.1 s | 9.5 s | 1 | 4 | 9.2 s |

The single agent is timed with crew_vs_single's 30 s timeout: its median call (a tool round and its reply) is longer than the deployed 8 s step timeout, so under that timeout it would never come back.

## 2. Verification by construction

### What a model can write

Every field of a model's reply that is not an enum, given text with a number (“in the 89th minute”, “with a 0.25 gain”, “after two scans”, “twice”, “第89分钟”, “扫视了两次”): the reason and the angle reject it (`no_numbers`, the Verifier's own number detector); a narration line is a claim id or a connective from enums, so any other text is rejected.

| field | numbers tried | rejected |
|---|---:|---:|
| `director.reason` | 6 | 6 |
| `analyst.angle` | 6 | 6 |
| `narration.claim` | 6 | 6 |
| `narration.connective` | 6 | 6 |

Every number that reached the air: 2556 numbers in 4728 aired lines, 0 not a verified slot's value; the Directors' reasons and Analysts' angles in those breakdowns hold 0 numbers.

### Perturbed lines, with the Verifier and without it

Every aired line of the crew's fault-free runs, perturbed as a model writing its own words, a bug or a tampered claim store could make it, then through the shipped gates (tidy, then the Verifier step's line check, `agents.workflow.Verifier._check`) and through tidy alone, as crew_vs_single's single agent without a Verifier airs it (its arm A). *A Verifier rule*: what its line check rejects. *What those lines say*, by construction: false (a wrong number or player, or a claim its evidence refutes), unverified (a statement no claim backs), garbled (raw placeholder braces), or true but written by the model. With anchored outputs a model cannot write any of these: the text is composed by code from verified templates. They are what the Verifier is for when that construction is broken: free-text lines, a prompt or code regression, a claim store changed after verification.

| perturbation | what changes | a model can write it under the anchored schema | lines | kept off by tidy | kept off by the Verifier | without a Verifier: aired · breaking a Verifier rule | what those lines say | with the Verifier: aired |
|---|---|---|---:|---:|---:|---:|---|---:|
| `number_right` | a slot's number written by the model itself, the right value | no (enum) | 191 | 0 | 191 | 191 · 191 | true, model-written | 0 |
| `number_wrong` | a slot's number written by the model, one off | no (enum) | 184 | 0 | 184 | 184 · 184 | false | 0 |
| `extra_number` | a number no claim holds added to the line | no (enum) | 352 | 0 | 352 | 352 · 352 | unverified | 0 |
| `player_named` | a player written by name instead of by his slot, the right player | no (enum) | 336 | 0 | 336 | 336 · 336 | true, model-written | 0 |
| `player_swapped` | a player written by name, the wrong player | no (enum) | 336 | 0 | 336 | 336 · 336 | false | 0 |
| `unbacked_term` | a lexicon term (unmarked, blind side, …) no cited claim backs | no (enum) | 352 | 0 | 352 | 352 · 352 | unverified | 0 |
| `broken_placeholder` | a placeholder naming no slot of its claim | no (enum) | 352 | 0 | 352 | 352 · 352 | garbled | 0 |
| `unknown_claim` | a line citing a claim id that does not exist | no (enum) | 352 | 0 | 352 | 352 · 352 | garbled | 0 |
| `forbidden_claim` | a claim the persona must not hear (xT, probabilities for casual) | no (not in the persona's enum) | 14 | 14 | 0 | 0 · 0 | – | 0 |
| `claim_tampered` | the cited claim's number changed after verification, not re-verified | not a model's output | 184 | 0 | 184 | 184 · 184 | false | 0 |
| `claim_refuted` | the cited claim's number changed and re-verified: now refuted | not a model's output | 184 | 0 | 184 | 184 · 184 | false | 0 |
| **all** | | | **2837** | 14 | 2823 | **2823 · 2823** | | **0** |

The same lines unperturbed: 394/394 (100%) air through both pipelines with no violation, so the Verifier raised no false alarm.

| persona | language | perturbed lines | kept off with the Verifier | aired without it | unperturbed lines passed (both pipelines) |
|---|---|---:|---:|---:|---:|
| casual | en | 201 | 201 | 194 | 36/36 |
| casual | zh | 201 | 201 | 194 | 36/36 |
| analyst | en | 432 | 432 | 432 | 54/54 |
| analyst | zh | 432 | 432 | 432 | 54/54 |
| player_fan | en | 218 | 218 | 218 | 36/36 |
| player_fan | zh | 218 | 218 | 218 | 36/36 |
| coach | en | 284 | 284 | 284 | 31/31 |
| coach | zh | 284 | 284 | 284 | 31/31 |
| audio_description | en | 287 | 287 | 287 | 40/40 |
| audio_description | zh | 280 | 280 | 280 | 40/40 |

### Foundry drafts, checked again by today's code

The first drafts of crew_vs_single's fault-free runs (gpt-4.1-mini on Microsoft Foundry, 2026-10-21; eval/fixtures/crew_vs_single_cache.json, 14 runs): anchored drafts composed again from the claim ids and connectives the model chose; free-text drafts as the model wrote them. Then today's tidy, the Verifier's line check, its persona-rule check (a script breaking it goes back to both voices) and the repair after the last rewrite (no rewrite is run here: no model call). The drafts predate the persona rules (agents/persona_rules.py), so the scripts breaking them and the lines repair adds reflect rules added since, not the model.

| lines | structure | persona | language | scripts | lines drafted | dropped by tidy: forbidden · repeats | the Verifier's line check rejects | scripts breaking the persona's rules | repair adds · cuts | without a Verifier: aired · with a violation · wrong ids and numbers | with it: aired · failing |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| anchored | crew | casual | en | 6 | 23 | 6 · 0 | 0 | 3 | 3 · 0 | 17 · 0 · 0 | 20 · 0 |
| anchored | crew | casual | zh | 6 | 25 | 5 · 0 | 0 | 3 | 3 · 0 | 20 · 0 · 0 | 23 · 0 |
| anchored | crew | analyst | en | 6 | 46 | 0 · 0 | 0 | 3 | 3 · 0 | 46 · 0 · 0 | 49 · 0 |
| anchored | crew | analyst | zh | 6 | 47 | 0 · 0 | 0 | 3 | 4 · 0 | 47 · 0 · 0 | 51 · 0 |
| anchored | single | casual | en | 6 | 18 | 3 · 0 | 0 | 5 | 5 · 0 | 15 · 0 · 0 | 20 · 0 |
| anchored | single | casual | zh | 6 | 18 | 3 · 0 | 0 | 5 | 5 · 0 | 15 · 0 · 0 | 20 · 0 |
| anchored | single | analyst | en | 6 | 37 | 0 · 0 | 0 | 4 | 6 · 0 | 37 · 0 · 0 | 43 · 0 |
| anchored | single | analyst | zh | 6 | 37 | 0 · 0 | 0 | 4 | 6 · 0 | 37 · 0 · 0 | 43 · 0 |
| free text | crew | casual | en | 1 | 2 | 1 · 0 | 1 (number ×2, entity ×2, lexicon ×1) | 1 | 1 · 0 | 1 · 1 · 0 | 1 · 0 |
| free text | crew | casual | zh | 1 | 3 | 1 · 0 | 2 (number ×3, entity ×3) | 1 | 1 · 0 | 2 · 2 · 0 | 1 · 0 |
| free text | crew | analyst | en | 1 | 6 | 0 · 0 | 6 (number ×19, entity ×10, lexicon ×2) | 1 | 3 · 0 | 6 · 6 · 7 | 3 · 0 |
| free text | crew | analyst | zh | 1 | 7 | 0 · 0 | 7 (number ×17, entity ×11) | 1 | 3 · 0 | 7 · 7 · 5 | 3 · 0 |
| free text | single | casual | en | 1 | 4 | 1 · 0 | 3 (number ×5, entity ×5) | 1 | 1 · 0 | 3 · 3 · 0 | 1 · 0 |
| free text | single | casual | zh | 1 | 4 | 1 · 0 | 2 (number ×4, entity ×4) | 1 | 1 · 0 | 3 · 2 · 0 | 2 · 0 |
| free text | single | analyst | en | 1 | 5 | 0 · 0 | 4 (number ×8, entity ×7, banned ×1) | 0 | 2 · 0 | 5 · 4 · 1 | 3 · 0 |
| free text | single | analyst | zh | 1 | 5 | 0 · 0 | 5 (number ×9, entity ×7) | 0 | 3 · 0 | 5 · 5 · 2 | 3 · 0 |

Numbers the model wrote in its own words in those runs' replies: 0 in the anchored runs, 21 in the free-text runs (counted by crew_vs_single in the reason, angle and line text of every reply).

## 3. Auditability

The crew with the Analyst on our MCP server (`use_mcp`, stdio, as the deployed API runs it; the scripted Analyst calls `get_moment` and `list_claims`, then answers), every moment, every persona × language. Each aired line is traced through the crew trace (agents/crewtrace.py) and the breakdown it is stored with.

| link | aired lines with it |
|---|---:|
| every cited claim supported, unchanged since its verdict, with an audit record of it | 394/394 (100%) |
| the call of the voice that wrote it (speaker, persona, language) on the narration step | 394/394 (100%) |
| passed by the last Verifier round | 394/394 (100%) |
| a voice cue | 394/394 (100%) |
| **all of the above** | **394/394 (100%)** |
| claim lines whose claims a stored MCP tool result names | 300/352 (85%) |
| claim lines whose claim the trace cut from the stored result (4,000 characters) | 52/352 (15%) |

Who chose what aired: the Analyst's findings hold the claims of 288 lines; the voices picked 64 more from the other verified claims their prompts offer; 42 are connectives. The Analyst's tool calls: `get_moment` ×7, `list_claims` ×7.

Step records: 42/42 (100%) have their start and end, the message they handled and those they sent, the shared state they wrote (`request`, `findings`, `plan`, `drafts`, `verdicts` or `scripts`, `voice`), and for the four agents the evidence they read and their model calls. Missing: none. Span ids are empty offline (no telemetry exporter); deployed, each step's span is in Application Insights.

The single agent's breakdowns traced the same way: 0/394 (0%) of its aired lines have a call of their own voice on the trace. Its one call writes all four parts, recorded on its first step; which part of the reply a line came from is not a separate record, and a part that fails takes the others with it (section 1).

## 4. Parallelism and latency

Every model call takes its role's median request latency on Foundry, from crew_vs_single's fault-free anchored runs (gpt-4.1-mini, 2026-10-21): analyst 1.86 s (n = 6), analyst (tool round) 1.70 s (n = 6), color 1.40 s (n = 24), director 1.64 s (n = 6), pbp 1.84 s (n = 24), solo 6.72 s (n = 6), solo (tool round) 2.24 s (n = 5), telestrator 3.36 s (n = 6). The Analyst's call is its tool round and its answer (at high priority it has the MCP tools), and so is the single agent's. Times are wall time of the real workflow with these latencies; they include the crew's own code and vary a little from run to run. One moment (`blind_side_run-3`). The crew runs with the deployed 8 s step timeout; one call at a time and the single agent get crew_vs_single's 30 s, since a queued or a long call would otherwise time out, except in the last single-agent row, which shows what that timeout does to it.

| run | step timeout | scripts | model requests | most calls at once | roles from the model, of 4 | Telestrator lane | narration lane | lanes overlapped | breakdown |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| crew, as deployed | 8 s | 4 | 11 | 5 | 4 | 3.4 s | 3.3 s | 3.3 s | 8.6 s |
| crew, one model call at a time | 30 s | 4 | 11 | 1 | 4 | 3.4 s | 16.4 s | 3.4 s | 21.7 s |
| single agent | 30 s | 4 | 1 | 1 | 4 | – | – | – | 9.2 s |
| single agent | 8 s | 4 | 2 | 1 | 0 | – | – | – | 16.3 s |
| crew, as deployed | 8 s | 1 | 5 | 2 | 4 | 3.4 s | 3.4 s | 3.4 s | 8.7 s |
| crew, as deployed | 8 s | 2 | 7 | 3 | 4 | 3.5 s | 3.3 s | 3.3 s | 8.8 s |
| crew, as deployed | 8 s | 4 | 11 | 5 | 4 | 3.4 s | 3.4 s | 3.4 s | 8.8 s |
| crew, as deployed | 8 s | 6 | 15 | 7 | 4 | 3.4 s | 3.5 s | 3.4 s | 8.9 s |
| crew, as deployed | 8 s | 8 | 19 | 9 | 4 | 3.4 s | 3.3 s | 3.3 s | 8.7 s |
| crew, as deployed | 8 s | 10 | 23 | 11 | 4 | 3.5 s | 3.5 s | 3.5 s | 8.9 s |

The critical path is Director → Analyst → the slower of the two lanes (the Telestrator, or narration: the play-by-play, then the co-commentator who replies to it) → Verifier → Voice. Adding audiences adds two requests each, not time; one call at a time adds every call's latency. The single agent's one call is about as long as the crew's critical path, so the crew is not faster: its steps are short (each under the deployed 8 s step timeout; the single call is not, as its row with that timeout shows and crew_vs_single measured), which is what the per-step timeout and the failure policy rely on.

## 5. What this does not show

eval/reports/crew_vs_single.md (Foundry, six moments, four audiences) found:

- Narration quality: “wrong facts aired 0 vs 0, groundedness 5.00 vs 5.00” and “headline claims spoken 81% vs 92%” (line 10), “It does not show that the crew writes better.” (line 247).
- Verification, not collaboration, keeps wrong facts off the air: “Wrong facts aired: 0 · 0 · 0 · 0 (A · B · C · D)”, “lines the Verifier rejects: 0 of 110 without it in the single agent, 0 of 141 in the crew” (line 9); with free text, “wrong facts 3 (single) and 12 (crew)”, “The crew's separate voices did not write fewer wrong facts than the single agent, so none of it is due to collaboration” (line 13).
- Cost and speed: “1.8 vs 12.0 model requests and $0.0046 vs $0.0090 per breakdown”, “Seconds to air 14.4 vs 13.8, no measurable difference” (line 10).
- Recovery is not always cheaper: for the Analyst, “bringing it back took 11.0 model requests” (line 11), more than re-running the single agent; here 22 for 10 scripts.
- Short steps fit the deployed timeout: “0 of 66 crew agent runs would have timed out, and 6 of 6 of the single agent's” (line 10).
- A real failure the crew isolated: the Analyst's `angle` “carried a number in both of its attempts, which the schema's `no_numbers` check rejects” (line 164): the crew lost that role only, the single agent all four.

So the crew's case rests on isolation, recovery, a separate gate and a trace per role, measured above, not on better lines. The scripted model also means sections 1–4 test the architecture's guarantees, not a model's failure modes: a real model fails in other ways (a slow reply, a reply its schema rejects), which crew_vs_single sampled on Foundry. The Verifier rejected no anchored line there or here; its value shows when the construction around it is broken.

## Method

- **Scripted model.** `agents.testing.ToolCallingFakeChatClient` routed by each agent's `ROLE:` line: the Director answers the priority rule on the lens delta (`fallbacks.priority_for`) with a reason with no number; the Analyst the template findings (at most 6 supporting claims, as its schema allows); the Telestrator the template plan; each voice its template lines for the persona and language its prompt names, as anchored lines (a claim id and/or a connective). The single agent answers all of that in one reply (eval/single_agent.py, with the shipped Verifier). Every reply goes through Agent Framework's structured output parsing and the crew's code.
- **Faults.** `run_crew(down=...)`: the downed agent's chat client is `agents.llm.Outage`. A model outage (`ScriptedModel(outage=True)`) makes every call raise instead.
- **Gates.** With the Verifier: `agents.workflow.tidy`, then `agents.workflow.Verifier._check` (persona, render check: numbers, entities, placeholders, lexicon, banned words, unsupported and stale claims). Without: tidy, then the line as it would air, placeholders filled where they resolve (`eval.narration_ablation.preview`), judged by the same rules.
- **Cached drafts.** `--extract-cache` rebuilds the fixture from crew_vs_single's run records (`out/crew_vs_single/runs/`).

## Limitations

- The scripted model always answers, and always validly, so the fault-free runs have no rewrites; Verifier rewrites on real model output are in crew_vs_single and eval/narration_ablation.py.
- The cached drafts are from before the persona rules and before later sim changes on main; a claim today's evidence no longer supports would be counted as such (none was).
- The perturbation suite is ours; it covers the error classes the Verifier's rules name, not every way a sentence can be wrong (grammar, a true number in the wrong role).
- Latencies are medians from one day's runs; the single agent's call grows with the number of scripts it writes, so it is timed for the default four only.
