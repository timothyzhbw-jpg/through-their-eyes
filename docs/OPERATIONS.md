# Operations: limits, costs and fallbacks of the public demo

The demo must stay up and free to test until 2026-11-10 (CLAUDE.md rule 6). This is the audit of
the API (`api/`) for misuse and surprise costs, on 2026-10-21, against live revision
`tte-api--0000044` and the code of this branch. Azure settings were read, not changed.

The subscription is Azure for Students with a spending limit: when the $100 credit is gone, the
subscription is disabled and the API **and** the web app stop. So every cost the public can
trigger must be bounded, and a bound that refuses requests for the rest of a UTC day is better
than one that spends the credit.

## Findings, by severity

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | P1 | **Egress was unbounded.** Match-1's export is 4.0 MB gzipped, 11.6 MB raw; its live stream is 13.5 MB, and played at 1000x it arrived in 2 s. Nothing limited either per client or per day. Azure bills internet egress past 100 GB a month ($0.087/GB), so one script looping on either could spend the credit in hours. | Fixed: `api/egress.py`. Every response body and live message is charged to the client (bucket of 500 MB, refilled per hour) and to the UTC day across clients (10 GB). Past either: 429, or 4429 for a new stream. `/health` is exempt. Worst case, the cap every day to 11/10: 10 GB over the free 100 GB in October, ≈ $1. |
| 2 | P2 | **The live stream took up to 1000x.** Four such streams each pulled the whole match in seconds and pushed the frame lag of 50 1x viewers from p95 3 ms to 43–294 ms (max 1.7 s) on 0.5 vCPU. | Fixed: speed clamped to 0.1–8 (the web app offers at most 4x): p95 3 ms with the four streams. |
| 3 | P2 | **Every what-if question spent a unit of the 40/day cap and a model call**, even when its answer was cached; on a miss the question was mapped twice (two model calls for one unit). | Fixed: the model's mapping is kept by the normalised question (case, spacing, closing `?!.`) in the answers store, so it survives a restart; the answer reuses that mapping. A failed mapping is not kept. |
| 4 | P2 | **Crew runs with a model were not bounded across clients.** Each starts an MCP server subprocess (87 MB measured); the replica idles at 250–340 MB of 1 GiB, so about eight uncached breakdowns at once could OOM it (three clients at their per-client limit start nine). A restart also refills the in-memory daily caps and drops every drill. | Fixed: `TTE_CREW_CONCURRENCY` (2) runs with a model at once; others wait. Runs without a model are not held back. |
| 5 | P2 | **A limited drill or bring-back was a dead end** (red team): 429 with nothing to show. A judge's tour (what-if, drill, bring-back, recap) needs 4 model runs against a per-client limit of 3 per 10 min, and judges behind one NAT share it. | Fixed: every drill and bring-back is recorded on the replica's disk (`api/recorded.py`). Limited, the recording of the same drill in the same state is replayed, labelled "Recorded run · <time> UTC" in the web app; with none, the crew runs without the model, flagged. 429 only past the offline drills' cap (200 a day) too. |
| 6 | P2 | **Judging-time limits** (red team): 3 per 10 min and 40 a day are tight for judges. | Fixed: `TTE_JUDGING_WINDOW` (2026-10-27 to 2026-11-10, UTC days) switches to 8 per 10 min and 100 a day on its days, with no redeploy. Cost below. |
| 7 | P2 | **Model errors reach the public trace** (`trace[].error`) as the SDK wrote them; a message could carry an endpoint URL, a file path, a tenant or client id, or a configured secret. | Fixed: `agents.llm.describe` replaces secret settings' values, URLs, absolute paths and GUIDs. |
| 8 | P3 | Match and moment ids in bodies had no length limit (echoed in a 404). | Fixed: 100 characters, else 422. |
| 9 | P3 | The daily caps (model 40, speech 200, drills 200, egress) are counted in memory: every restart or redeploy starts the day again. | Open. Bounded by the deploy freeze (10/26) and finding 4; the token alert proposed below watches it. |
| 10 | P3 | A model breakdown whose steps fell back to templates (Foundry outage or 429) is cached under the model key and served until regenerated; `regenerate: true` during an outage can replace a clean one. | Fixed (2026-10-22): such a run is cached as degraded and run again while the model is available, at most once per key per `TTE_DEGRADED_RETRY_S` (600 s), within the per-client limit and the daily cap; a retry that comes back worse never replaces it. After an outage, to re-run them all at once: `uv run python -m infra.prewarm --api <API URL> --refresh-degraded`. |
| 11 | P3 | 50 viewers at 1x use about 80% of 0.5 vCPU, so `TTE_LIVE_MAX_TOTAL` (64) is about the CPU's capacity, and the first computation of a breakdown or what-if holds the event loop: a burst of 40 new ones delayed frames by 1–2 s. | Open. Fine for judging traffic (cached keys cost nothing). For more, 1 vCPU / 2 GiB (+$0.39–1.30 a day). |
| 12 | P3 | Per-client limits key on the address; an IPv6 client could rotate inside its /64. Request floods are not rate-limited in the app (Container Apps has no WAF). | Open. The day-wide caps bound the cost; a flood can only degrade the demo. |
| 13 | P3 | The web app's Storage static website has no limit of its own (2 MB per page load). | Open. Covered by the egress alert proposed below. |

Checked and fine: per-client limits use the last `X-Forwarded-For` hop (the ingress's), so
spoofed first hops share the real address's limits; breakdowns, recaps, what-ifs, drills and
bring-backs all take the per-client limit (3 per 10 min) and the daily model cap (40), and past
either serve the cached model result or the offline template, flagged `rate_limited`/`capped`
(drills: 429); TTS speaks only cue keys the crew wrote (raw SSML: 400), 60 per 10 min per
client, 200 syntheses a day, 4 Azure calls at once, one synthesis per key; bodies are capped at
16 KiB, lists at 8, questions at 300 characters, enums checked; live control messages are at
most 256 characters (uvicorn refuses frames over 4 KiB), 4 streams per client, 64 in all,
20 min each; a 500 says only "internal error"; responses carry nosniff, DENY, no-referrer, HSTS
and, off HTML, `default-src 'none'`; live CORS answers only the site's origin (an unknown
origin gets no `access-control-allow-origin`); `/health` shows no setting values. Cosmos DB
writes are bounded: model results by the cap, offline results and voice cues by the finite key
space (moment × persona and language subsets), what-if answers by action × language × persona,
question mappings by the cap; drills and tamper checks write nothing.

## Limits in force

| What | Per client | Across clients | Past it |
|---|---|---|---|
| Model regenerations (breakdown, recap, what-if mapping, drill, bring-back) | 3 / 10 min; 8 in the judging window | 40 / UTC day, 100 in the judging window; 2 crew runs at once | cached model result, else template, flagged; drills: the recorded run, else an offline run |
| Speech syntheses | 60 requests / 10 min | 200 / UTC day; 4 at once | 429; captions play |
| Bytes sent (every body and live message) | 500 MB, refilled per hour | 10 GB / UTC day | 429; new stream 4429 |
| Live streams | 4 open | 64 open; 20 min each; at most 8x | 4429 / 4408 |
| Tamper checks | 20 / min | — | 429 |
| Offline drills (offline mode, or a limited drill with no recording) | (the per-client limit) | 200 / UTC day | the recorded run, else 429 |

All are environment variables (`.env.example`); the defaults are what the deployment runs.

## Load test (local, never the live service)

`infra/loadtest.py` against the API image under `docker run --cpus 0.5 --memory 1g`, offline
(no Foundry, Speech, Cosmos or Application Insights): 50 viewers on match-1's live stream at 1x
(19,645 frames), each with its own `X-Forwarded-For`, then a burst of 20 breakdowns (new persona
and language combinations) and 20 what-ifs. arm64 on an M4 Pro, one container at a time, on a
quiet host (load average 7–9) on 10/21 at 16:50 CDT. "Before" is main at 44c0bb5, "after" this
branch at 2f605a6.

| Run | Frame lag of the 1x viewers | Requests | Memory peak | CPU |
|---|---|---|---|---|
| Before, 50 viewers + burst | p95 3 ms; during the burst p95 981 ms, max 1.1 s | 20 breakdowns all 200, p95 2.3 s; 20 what-ifs all 200, p95 1.1 s; a small GET p95 30 ms | 336 MiB | 41% of a core |
| After, the same | p95 13 ms; during the burst p95 1.15 s, max 1.2 s | all 200, p95 2.4 s / 1.3 s; small GET p95 10 ms | 331 MiB | 40% |
| Before, 50 viewers + 4 asking 1000x | p95 43 ms, max 1.1 s; the 4 pulled 78,580 frames (the whole match each) | — | 337 MiB | 40% |
| After, the same (played at 8x) | p95 3 ms, max 0.9 s; the 4 got 47,577 frames (8x) | — | 332 MiB | 42% |

No viewer was refused or dropped and every request was answered. The 1 s maximum before any
burst is the 50 connections opening at once. Busy-host runs earlier that day (load 100–195,
before and after back to back) agreed: the guards cost nothing measurable.

The container holds 50 viewers plus the burst: memory peaks at about 340 MiB of 1 GiB (idle
253 MiB; warm start 59–83 s). The constraint is CPU: 50 viewers take about 80% of the 0.5 vCPU,
and first-time computations stall frames for about a second (finding 11). With a model, each
uncached breakdown adds an MCP subprocess (87 MB), two at a time (finding 4).

## When a quota runs out

- **Daily model cap (40; 100 in the judging window).** Breakdowns and recaps serve the cached
  model result, else the offline template, flagged `capped`; what-ifs map with the rules (a
  question asked before keeps the model's mapping); drills replay their recording, else run
  without the model. Prewarmed keys
  (`infra.prewarm`) are unaffected. Resets at 00:00 UTC (19:00 CDT; 18:00 CST from November 1)
  or on a restart.
- **Foundry throttles (429) or is down.** Each agent step retries once, then falls back to its
  template: the breakdown is served, its trace shows `template` steps (finding 10). The what-if
  mapper falls back to the rules. No request fails.
- **Speech F0 quota (500K characters a month) or its throttling.** A synthesis fails: 502,
  the cap unit is returned, captions continue without voice; audio already on the replica's disk
  still plays. F0 cannot bill.
- **Egress budget.** Past a client's bucket or the day's 10 GB: 429 (`/health` still answers).
  The web app then plays its bundled hero and says why; match-1 needs the API until the bucket
  refills or the next UTC day.
- **Cosmos DB throttles or fails.** A failed read is a miss, a failed write keeps the value in
  memory (logged); results are still served.
- **The credit runs out.** The subscription is disabled: API and web app both stop until it is
  re-enabled. This is what the budget alert and the proposals below are for.

## The judging window's cost

A model run (a "unit") costs about $0.012: a breakdown is about 12 requests and 22K tokens (28K
with the Analyst's MCP tools), at $0.40 / $1.60 per million input / output tokens; a what-if
mapping is one short call, far less. At the judging cap of 100 a day that is about $1.20 a day,
$18 for the 15 days. Worst case to 11/10, every cap reached every day: Container Apps fully
active $27, Foundry $21 (40 a day to 10/26, then 100), ACR $4, egress ≈ $1, our own runs and the
spend so far ≈ $15: about $68 of the $100 credit. If a unit cost $0.03 (recaps are larger), the
Foundry share would be $52 and the total near the credit, so the token alert below matters. A
judge's whole tour is 4 units, about $0.05.

The window needs no Azure change: its defaults are in the code. To change it during judging
(a new revision; in-memory counts restart):

```bash
az containerapp update -g rg-through-their-eyes -n tte-api --set-env-vars \
  TTE_JUDGING_RATE_LIMIT=8/600 TTE_JUDGING_DAILY_MODEL_CAP=100 \
  TTE_JUDGING_WINDOW=2026-10-27/2026-11-10
```

After the final deploy, run each single-agent drill once and bring it back (from the Producer
desk) so that recordings exist before the first judge is limited; they live on the replica's
disk until the next deploy.

## Proposed Azure settings (not applied; Bowen decides)

Already in place: min = max replicas 1 (read on 10/21; keep max at 1, since the limits are per
process), the `tte-40` budget ($40 a month; alerts at 50%/80% actual and 100% forecast), Speech
F0, and the Log Analytics cap of 0.1 GB a day.

Foundry capacity stays at 200 (gpt-4.1-mini, the API's model): billing is per token, and a lower
value would turn a burst of uncached breakdowns into 429s and degraded template runs (finding 10).
The token alert below watches it instead.

1. **Alerts on egress and tokens**, emailed to you. Today's peaks: API 342 MB and site 329 MB in
   6 h; 2.05M tokens on 10/20 (development included). A metric alert costs about $0.10 a month.

   ```bash
   EMAIL=you@example.com   # where the alerts go
   az monitor action-group create -g rg-through-their-eyes -n tte-owner --short-name tteowner \
     --action email owner "$EMAIL"
   az monitor metrics alert create -g rg-through-their-eyes -n tte-api-egress \
     --scopes "$(az containerapp show -g rg-through-their-eyes -n tte-api --query id -o tsv)" \
     --condition "total TxBytes > 5000000000" --window-size 6h --evaluation-frequency 1h \
     --action tte-owner --description "API sent over 5 GB in 6 h"
   az monitor metrics alert create -g rg-through-their-eyes -n tte-site-egress \
     --scopes "$(az storage account show -g rg-through-their-eyes -n ttesite1ff906 --query id -o tsv)" \
     --condition "total Egress > 5000000000" --window-size 6h --evaluation-frequency 1h \
     --action tte-owner --description "Static site sent over 5 GB in 6 h"
   az monitor metrics alert create -g rg-through-their-eyes -n tte-foundry-tokens \
     --scopes "$(az cognitiveservices account show -g rg-through-their-eyes -n tte-ai-1ff906 --query id -o tsv)" \
     --condition "total TokenTransaction > 5000000" --window-size 24h --evaluation-frequency 1h \
     --action tte-owner --description "Foundry used over 5M tokens in 24 h"
   ```

2. **If a flood degrades the demo**, lower the per-client budgets without a rebuild (a new
   revision, so the in-memory counts restart), e.g.
   `az containerapp update -g rg-through-their-eyes -n tte-api --set-env-vars TTE_EGRESS_PER_CLIENT=200/3600 TTE_DAILY_EGRESS_GB=5`.
