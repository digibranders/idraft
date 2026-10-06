# 27. Cost Model and Provider Cost Metering

Status: Draft for architecture freeze
Last updated: 2026-09-30
Price basis: DataForSEO, DigitalOcean, Cloudflare R2 and LLM vendor prices verified 2026-09-29 (`research/01`, `02`, `04`, `08`). All figures USD, excluding tax.
Related: [ADR-022](adr/ADR-022-python-backend-simplified-platform.md), [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md) section 6, [07-dataforseo-ai-integration.md](07-dataforseo-ai-integration.md) section 7, [23-backup-disaster-recovery.md](23-backup-disaster-recovery.md) section 14, [28-data-growth-scaling.md](28-data-growth-scaling.md)

## 1. Unit prices used

| Item | Price | Status |
|---|---|---|
| DataForSEO Google organic SERP, standard queue | $0.0006 per page of 10 results | Verified; linear per page per current FAQ (S-01 confirms on our account) |
| Priority queue / Live | $0.0012 / $0.002 per page | Verified |
| Async AI Overview surcharge | +$0.0006 per standard task when an async AIO is fetched (additive reading); refunded otherwise | Verified text; additive vs whole-task multiplier unresolved until S-01 |
| ChatGPT scraper, Gemini scraper, AI Mode | $0.0012 standard, $0.0024 priority, $0.004 live, per task | Verified |
| Labs `keyword_overview` | $0.012 per call + $0.00012 per keyword (up to 700 per call) | Verified |
| Labs list endpoints (ideas, related, ranked keywords, intersection) | $0.012 per task + $0.00012 per returned item | Verified |
| Google Autocomplete (SERP) | $0.0006 per standard task | Verified |
| AI Keyword Data | $0.01 per task + $0.0001 per keyword | Verified |
| LLM Responses (official APIs via DataForSEO) | $0.0006 (live) + vendor cost | Verified |
| Official APIs direct (per 1,000 grounded prompts, 300 in / 800 out tokens, 1 search) | OpenAI cheapest search-capable model about $10.43 to $11.23; ChatGPT-closest model about $35.50 to $75.50; Perplexity Agent API `sonar` about $4.58 to $4.83 | Verified prices, computed totals (`research/04-official-llm-apis.md`) |
| DigitalOcean Basic droplet 2 vCPU / 4 GB / 80 GB | $24 per month, 4 TB transfer | Verified |
| 4 vCPU / 8 GB / 160 GB | $48 | Verified |
| DigitalOcean weekly droplet backups | 20% of the droplet price: $4.80 on the $24 droplet, $9.60 on the $48 droplet | Verified |
| DO Volumes | $0.10 per GiB-month | Verified |
| R2 Standard storage | $0.015 per GB-month; free 10 GB-month, 1M Class A, 10M Class B per month; egress free | Verified |
| Monitoring (Sentry, Healthchecks.io, Better Stack free tiers) | $0 within free limits | Verified limits in doc 25 |

Calendar conventions: a month is 30 days for daily schedules and 4.33 weeks for weekly schedules.

## 2. Fixed infrastructure

| Item | V1 monthly | Notes |
|---|---|---|
| Droplet 2 vCPU / 4 GB (Caddy, web, api, worker, PostgreSQL, Redis) | $24.00 | One host serves the Next.js app and the API ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)) |
| DigitalOcean weekly droplet backups | $4.80 | 20% of the droplet price; the second backup copy ([23](23-backup-disaster-recovery.md) section 1) |
| R2 raw payloads + nightly dumps | about $1.00 | Free tier covers the first 10 GB-month; about $1.45 to $6.20 by month 12 depending on volume ([23](23-backup-disaster-recovery.md) section 14.4); see section 7 |
| Error tracking, heartbeats, uptime (Sentry, Healthchecks.io, Better Stack) | $0.00 | Free tiers ([25](25-observability.md) section 12) |
| Transactional email (verification, invites, password reset) | $0.00 | Free tiers of common providers cover V1 volume (under 3,000 emails/month); pick in Phase 1 |
| Domain and DNS | excluded | Existing |
| **Total fixed** | **about $30** | Scenario totals in section 8 carry storage in their own column |

## 3. SEO rank tracking costs

### 3.1 Per tracked keyword per month (desktop, standard queue)

| Depth profile ([06](06-dataforseo-seo-integration.md) section 2.2) | Pages per month | SERP cost | + AIO surcharge, additive (20% of checks async) | + AIO surcharge, multiplier reading (20% async) |
|---|---|---|---|---|
| `weekly` (top 100 weekly) | 43.3 | $0.0260 | $0.0265 | $0.0312 |
| `light` (top 10 daily, top 100 weekly) | 69.0 | $0.0414 | $0.0450 | $0.0497 |
| **`standard` (top 20 daily, top 100 weekly), default** | 94.7 | **$0.0568** | **$0.0604** | **$0.0682** |
| `deep` (top 50 daily, top 100 weekly) | 171.7 | $0.1030 | $0.1066 | $0.1236 |
| `full` (top 100 daily) | 300.0 | $0.1800 | $0.1836 | $0.2160 |

The 20% async-AIO share is a placeholder until spike S-03 measures it. Mobile tracking doubles the cost for keywords tracked on both devices.

### 3.2 Scenarios requested in the brief (desktop, standard queue, SERP cost only)

| Keywords | Weekly (top 100) | Daily, `standard` profile (recommended) | Daily, top 100 every day |
|---|---|---|---|
| 1,000 | $26.00 | $56.80 | $180.00 |
| 5,000 | $130.00 | $284.00 | $900.00 |
| 10,000 | $260.00 | $568.00 | $1,800.00 |

Add up to about 20% for the async AIO surcharge in the worst reading, and double for desktop plus mobile.

### 3.3 Per SERP observation

| Depth | Standard | Priority | Live |
|---|---|---|---|
| 10 | $0.0006 | $0.0012 | $0.002 |
| 20 | $0.0012 | $0.0024 | $0.004 |
| 100 | $0.0060 | $0.0120 | $0.020 |

| Volume | Depth 10 | Depth 20 | Depth 100 |
|---|---|---|---|
| 100,000 SERP observations per month | $60 | $120 | $600 |
| 1,000,000 SERP observations per month | $600 | $1,200 | $6,000 |

## 4. AI prompt tracking costs

### 4.1 Per prompt per month (standard queue)

| Design | Tasks per prompt per week | Cost per prompt per month |
|---|---|---|
| 3 engines (ChatGPT, Gemini, AI Mode), 1 replicate | 3 | $0.0156 |
| 3 engines, 3 replicates on ChatGPT and Gemini, 1 on AI Mode | 7 | $0.0364 |
| **V1 default** (1,000 prompts: priority subset of 100 at 3 replicates on ChatGPT and Gemini) | 3.4 average | **$0.0177** |
| 4 engines incl. ChatGPT forced-search variant as an extra series, 1 replicate | 4 | $0.0208 |

AI Overview is keyword-level and comes with rank tracking; it is not charged per prompt.

### 4.2 Scenarios requested in the brief

| Prompts per week | 3 engines, 1 replicate | 3 engines, 3/3/1 replicates | Live mode, 3 engines, 1 replicate |
|---|---|---|---|
| 100 | $1.56 | $3.64 | $5.20 |
| 500 | $7.79 | $18.19 | $25.98 |
| 1,000 | $15.59 | $36.37 | $51.96 |
| 5,000 | $77.94 | $181.86 | $259.80 |
| 10,000 | $155.88 | $363.72 | $519.60 |

### 4.3 Per AI observation

| Volume | Standard | Priority | Live |
|---|---|---|---|
| One observation | $0.0012 | $0.0024 | $0.004 |
| 100,000 per month | $120 | $240 | $400 |
| 1,000,000 per month | $1,200 | $2,400 | $4,000 |

Official API benchmarks via LLM Responses cost roughly 5x to 50x per observation with cheap search-capable models and several hundred times with flagship models (documented examples $0.007 to $0.55 per call; vendor token and search fees dominate; S-16 measures our pinned models), which is why they are a small optional sample.

## 5. Keyword research and discovery

| Activity | Assumption | Monthly cost |
|---|---|---|
| Metrics refresh (Labs `keyword_overview`) | 10,000 keywords, monthly | $1.38 |
| New keyword metrics | 1,000 new keywords per month | about $0.14 |
| Discovery per project | 5 seed expansions x 1,000 items, 5 competitor `ranked_keywords` x 1,000 items, 200 autocomplete calls | about $1.44 |
| AI demand estimates | 10,000 keywords monthly | $1.10 |
| **Typical total for a 5,000-keyword, 5-project workspace** | | **about $10** |

## 6. Optional official API validation

| Design | Calls per month | Estimated monthly cost |
|---|---|---|
| 100 core prompts weekly, OpenAI cheapest search-capable model | 433 | about $5 |
| 100 core prompts weekly, OpenAI ChatGPT-closest model | 433 | about $15 to $33 |
| 100 core prompts weekly, Perplexity Agent API | 433 | about $2 |
| Extraction LLM adjudication ([13](13-ai-extraction-engine.md) stage 11) | about 130 batched calls | under $5 (capped by budget, default $10 per project) |

## 7. Storage and bandwidth

| Item | 1,000 kw daily + 1,000 prompts/week | 5,000 kw daily + 1,000 prompts/week | 10,000 kw daily (top 100 every day) + 10,000 prompts/week |
|---|---|---|---|
| R2 raw SERP per month (depth 20: 20 KB, depth 100: 60 KB compressed, assumption until S-02) | 0.8 GB | 3.9 GB | 18 GB |
| R2 raw AI per month (8 KB compressed per observation) | 0.12 GB | 0.12 GB | 2.4 GB |
| R2 steady state (SERP raw 400 days, AI raw kept) | about 12 GB after 13 months | about 52 GB | about 265 GB after 13 months, growing with AI |
| R2 storage cost at steady state | about $0.02 | about $0.63 | about $3.75 |
| R2 Class A operations | under the 1M free tier | under the free tier | about 0.5M per month: free |
| Backups in R2 (compressed nightly dumps, 30 kept) | under 10 GB | 20 to 40 GB: $0.15 to $0.45 | move to pgBackRest; about $1 to $2 |
| DO bandwidth | well under 4 TB included | same | same |
| Database growth | covered by droplet disk | covered through about year 2 | needs a Volume or DB droplet in year 1 (doc 28) |

Storage and bandwidth are negligible compared with collection costs at every scale we model.

## 8. Combined monthly scenarios

| Scenario | Fixed infra | SEO collection | AI collection | Research | Optional API validation | Storage | **Total** |
|---|---|---|---|---|---|---|---|
| **A. V1 target:** 1,000 prompts/week (V1 default design) + 1,000 keywords daily (`standard`) | $28.80 | $56.80 to $68.20 | $17.68 | $3 | $0 to $35 | $1 | **about $108 to $154** |
| **B.** 1,000 prompts/week + 5,000 keywords daily (`standard`) | $28.80 | $284 to $341 | $17.68 | $10 | $0 to $35 | $1 | **about $342 to $434** |
| **C.** 1,000 prompts/week + 5,000 keywords daily at top 100 every day | $28.80 | $900 to $1,080 | $17.68 | $10 | $0 to $35 | $2 | **about $959 to $1,174** |
| **D. Growth:** 5,000 prompts/week (3/3/1 replicates) + 10,000 keywords (`standard`, 20% also mobile) | $57.60 (8 GB droplet with backups) | $682 to $818 | $181.86 | $15 | $35 | $3 | **about $975 to $1,111** |
| **E. Scale:** 10,000 prompts/week (3/3/1) + 30,000 keywords (`standard`) + second droplet for PostgreSQL | $115 to $144 (with backups) | $1,704 to $2,046 | $363.72 | $30 | $50 | $10 | **about $2,273 to $2,644** |

Fixed infra is the droplet plus DigitalOcean weekly backups (section 2); R2 sits in the storage column. Ranges on SEO collection come from the unresolved async AIO billing reading (section 3.1). The largest single lever is depth: moving 5,000 keywords from top 100 daily to the `standard` profile saves about $616 per month (scenario B vs C).

## 9. Unit economics (for pricing)

| Unit | Cost at V1 defaults | Notes |
|---|---|---|
| Cost per tracked SEO keyword per month (desktop, `standard`) | $0.057 to $0.068 | Commercial rank trackers charge about $0.07 to $0.28 per daily-tracked keyword per month (`research/07-commercial-competitors.md`) |
| Cost per tracked keyword per month (weekly top 100) | $0.026 to $0.031 | |
| Cost per AI prompt per month (3 engines, 1 replicate) | $0.0156 | |
| Cost per AI prompt per month (V1 default mix) | $0.0177 | |
| Cost per SERP observation | $0.0006 per 10 results | |
| Cost per AI observation | $0.0012 | Commercial AI trackers charge about $0.007 to $0.08 per response (research/07) |
| Cost per 1,000 SERP observations | $0.60 (depth 10), $1.20 (depth 20), $6.00 (depth 100) | |
| Cost per 1,000 AI observations | $1.20 | |
| Fixed cost per project (V1, 10 projects sharing one droplet) | about $3.00 | About $30 of fixed infrastructure divided evenly; falls with more projects |
| Example project: 1,000 keywords + 250 prompts | about $57 + $4.40 + $3.00 = **about $64 per month** | before margin, support and development costs |

## 10. Cost metering (built from day one)

### 10.1 What is recorded

Every provider call writes `ops.provider_cost_events` ([04-data-model.md](04-data-model.md) section 11.4) with: provider, endpoint, workload (the cost workloads of [04-data-model.md](04-data-model.md) section 11.4.1: the task workloads `seo_rank`, `ai_prompt`, `ai_mode_keyword`, `keyword_metrics`, `discovery`, `ai_benchmark`, `gsc_sync`, `bing_sync`, `ga4_sync`, `cloudflare_sync`, plus `ai_overview`, `extraction_llm`, `keyword_research`, `first_party`), channel (`seo`, `ai`, `research`, `internal`), workspace, project, run, task, subject (keyword or prompt), engine, request count, units, cost, cost source (`provider_reported`, `computed_from_tokens`, `price_book_estimate`), billing period.

- DataForSEO: per-task `cost` from the submit response (provider-reported); daily reconciliation with `appendix/user_data` for refunds and add-ons (doc 06 section 6.1).
- LLM vendors: tokens and search calls from the response, priced with the price book (`computed_from_tokens`), reconciled monthly against vendor invoices.
- Shared-fetch reuse (`served_from_cache`): the first consumer pays; later consumers get a zero-cost event with `cost_source = 'price_book_estimate'` and `units = 0`, so per-project cost stays honest and the saving is measurable.

Hourly `cost_rollup` aggregates into `ops.cost_daily`.

**As built (step 5, keywords).**
- **Price book.** Migration 0011 seeds two rows in `ops.provider_price_book` for DataForSEO, endpoint `dataforseo_labs/google/keyword_overview`: `price_unit = 'request'` at $0.012 and `price_unit = 'item'` at $0.00012, valid from 2026-07-01 (the prices of section 1), with `source_url` and `verified_at` 2026-09-29. A keyword metrics run is estimated from them: one request for each 700 keywords at one location and language, plus one item per keyword. The SERP prices arrive with rank collection. The price book is used for estimates only; actual cost is the provider's reported cost.
- **Cost of a call.** One Labs call answers many tasks. Its reported cost is split evenly over them to the millionth of a dollar, the remainder on the first, and each task gets one `provider_reported` event with `units = 1` and `price_unit = 'item'`. A reported cost above $1.00 for one call is not believed, and the run's estimate is charged instead (doc 06 section 7.2).
- **Budget group.** The `keyword_metrics` and `discovery` task workloads and the `keyword_research` cost workload all count against the `keyword_research` budget group, whose events have channel `research`. A used-up budget turns a keyword metrics run into `budget_blocked` like any other, and the new-keyword step makes no other run for that project for 24 hours.
- **Rollup.** `cost_rollup` runs at minute 7 of every hour and rebuilds `ops.cost_daily` for today and yesterday (UTC) from `ops.provider_cost_events`. `cost_rebuild` runs daily at 01:37 UTC and rebuilds the last 35 days, so a day the hourly job missed is counted. Each run computes whole days and writes them over what is there, so running it twice changes nothing. Rollups take turns (an advisory lock) and write rows in key order. `subjects` is the number of distinct `subject_type:subject_id` of the day. `roll_up_costs(days=N)` is the backfill. Doc 21 section 10 lists the jobs.
- **Workspace-level costs.** Events with no project are not rolled up yet. Doc 04 section 11.4 puts them under the all-zero project; that waits for the first workspace-level writers (`keyword_research` and `first_party` events).
- **Reading.** `GET {W}/costs` groups `ops.cost_daily`, and `meta.cost_sources` is summed from the events of the period. `GET {W}/budgets/status` uses the planner's own spend and committed-estimate queries, so the screen and the planner agree, and it reads spend up to the end of the month. Money in these routes has six decimal places (doc 19 section 3.11.2).
- **SERP prices (rank collection).** Migration 0013 seeds the page prices of `serp/google/organic` (`conditions.queue`: standard $0.0006, priority $0.0012, live $0.002) and the asynchronous AI Overview surcharge ($0.0006 a task, standard queue). A rank run is estimated as the pages of each task's depth (ten results a page) at the run's queue price, plus the surcharge for a queued task; a price with no page row plans nothing rather than a guess of zero. A live check now carries the AI Overview and no surcharge is added; whether DataForSEO bills one for it is for spike S-01 to settle (review log, carried). One cost event is written per task, as the ledger writes today.
- **Reconciliation (rank collection).** `cost_reconcile` compares the provider's spend for a day with our events up to the moment of the last reading, and keeps the difference; it books no adjustment rows. A difference above the larger of $0.10 and 5% of the day's spend is logged as a warning. `balance_check` keeps the balance and its days of runway (doc 21 section 10). The month's live checks per workspace are limited by `max_serp_checks_per_month` (default 200,000); scheduled checks are limited by budgets only.
- **Refresh cadence.** Keyword metrics are fetched monthly (the 20th) and once when a keyword is created. The first two rows of section 5 give the monthly cost of both.

### 10.2 Questions it must answer (queries)

```sql
-- What did Project X cost this month, by workload?
SELECT workload, sum(cost_usd) AS usd, sum(request_count) AS requests
FROM ops.cost_daily
WHERE project_id = $1 AND cost_date >= date_trunc('month', current_date)
GROUP BY workload ORDER BY usd DESC;

-- How much does rank tracking vs AI tracking cost (workspace, month)?
SELECT CASE WHEN workload IN ('seo_rank') THEN 'rank_tracking'
            WHEN workload IN ('ai_prompt','ai_mode_keyword','ai_overview') THEN 'ai_tracking'
            ELSE workload END AS area,
       sum(cost_usd) AS usd
FROM ops.cost_daily
WHERE workspace_id = $1 AND cost_date >= date_trunc('month', current_date)
GROUP BY 1;

-- Which provider and endpoint is most expensive (last 30 days)?
SELECT provider_code, endpoint, sum(cost_usd) AS usd
FROM ops.cost_daily WHERE workspace_id = $1 AND cost_date > current_date - 30
GROUP BY 1, 2 ORDER BY usd DESC LIMIT 10;

-- Average cost per tracked keyword and per prompt (month to date)
SELECT workload, sum(cost_usd) / nullif(max(subjects), 0) AS usd_per_subject
FROM (
  SELECT workload, cost_date, sum(cost_usd) AS cost_usd, sum(subjects) AS subjects
  FROM ops.cost_daily
  WHERE project_id = $1 AND cost_date >= date_trunc('month', current_date)
    AND workload IN ('seo_rank','ai_prompt')
  GROUP BY workload, cost_date
) d GROUP BY workload;
```

(`subjects` counts distinct keywords or prompts charged per day; the per-subject monthly figure divides month-to-date cost by the maximum daily distinct subjects, which approximates the tracked set size. The Costs screen also shows the exact figure from `ops.provider_cost_events` grouped by `subject_id`.)

### 10.3 Budgets and enforcement

| Mechanism | Behavior |
|---|---|
| Pre-flight estimate | Every planned run gets `estimated_cost_usd` from the price book before any task is submitted. The run is judged against month-to-date spend plus what the runs already under way are still expected to spend (their estimate less their cost so far) plus its own estimate, so two runs planned minutes apart cannot both take the same room. Planning in one workspace takes its turn (an advisory lock on the workspace) |
| Dispatch check | Before tasks are sent, the budget is checked again with no estimate: a budget used up since planning holds the project's remaining tasks of that group back. They stay `pending` and go out when there is budget again, or are cancelled 24 hours after the window |
| Soft limit (default 80%) | Notification to admins and billing role; runs continue |
| Hard limit | New runs whose task workload maps to the exhausted budget group (`seo_rank`, `ai_prompt`, `keyword_research`, `ai_benchmark`, `extraction_llm`, `first_party`, or `all`; mapping in doc 04 section 11.4.1) are created with status `budget_blocked` and not submitted; manual runs are refused with a clear error; already-submitted tasks complete |
| Forecast | Month-end projection = month-to-date actual + planned runs for the rest of the month (from schedules and active subjects) |
| Provider account guard | DataForSEO's own account cost limit (error 40203) is also configured as a platform-wide backstop |
| Balance guard | Alert when DataForSEO balance is below 14 days of trailing spend |

## 11. Sensitivities and open cost questions

| Question | Impact | Resolution |
|---|---|---|
| Linear vs 0.75x billing for pages 2 and later | top-100 cost differs by 29% | S-01 on our account |
| Async AIO surcharge: additive or whole-task multiplier | up to +20% on SEO collection | S-01 |
| Share of SERPs with async AIO | scales the surcharge | S-03 |
| Real consumer-surface turnaround on standard queue | affects window sizing, not cost | S-04 |
| Replicate independence | if replicates are near-duplicates, the priority-subset replicates buy little; replace with more prompts at the same cost | S-05 |
| DataForSEO price changes (Labs and Keywords Data rose about 20% on 2026-07-01) | research costs | monthly price-book drift check |
