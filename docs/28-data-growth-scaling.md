# 28. Data Growth and Scaling

Status: Draft for architecture freeze
Last updated: 2026-09-30
Related: [04-data-model.md](04-data-model.md) section 12, [22-infrastructure-devops.md](22-infrastructure-devops.md), [23-backup-disaster-recovery.md](23-backup-disaster-recovery.md), [27-cost-model.md](27-cost-model.md), [03-system-architecture.md](03-system-architecture.md) section 10, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)

All sizes below are **estimates** from row layouts in doc 04 and typical payload sizes. Spikes S-02 (SERP payloads), S-04 (AI payloads) and S-09 (synthetic dataset on the target droplet) replace them with measurements in Phase 0. The formulas are kept so the projection can be recomputed.

## 1. Per-unit storage estimates (PostgreSQL, including indexes)

### 1.1 Per SEO check

| Table | Rows per check | Bytes per row (heap) | Index overhead | Bytes per check |
|---|---|---|---|---|
| `seo.serp_snapshots` | 1 | 700 (depth 20) to 1,700 (depth 100): arrays of url ids, domain ids, absolute positions + scalars | 30% | 900 to 2,200 |
| `seo.serp_features` | about 8 | 250 (source URL arrays, small payload; PAA payload up to 1 KB) | 25% | 2,500 |
| `seo.domain_rank_observations` | 1 own + 5 competitors | 200 (title/snippet only when ranked) | 40% | 1,700 |
| AI Overview: `ai.observations` + `ai.citations` + facts + mentions | 40% of checks have an AIO | 1,500 (TOAST-compressed text) + 6 x 150 + 200 + 250 | 30% | 1,500 (averaged over all checks) |
| `seo.rank_events` | about 0.3 | 120 | 30% | 50 |
| **Total per check (average, standard profile)** | | | | **about 7 KB** |

Current-state tables (`tracked_keyword_state`, `serp_current_results`) are fixed-size per keyword (about 3 KB per keyword incl. top-20 current results) and do not grow with time.

### 1.2 Per AI observation (consumer surfaces)

| Component | Bytes |
|---|---|
| `ai.observations` row with `answer_text` and `answer_markdown` (6 KB text each before compression, lz4 TOAST roughly 2x) | 6,500 |
| `ai.citations`: about 10 x 200 | 2,000 |
| `ai.retrieval_results` (ChatGPT only): about 20 x 120 | 2,400 (ChatGPT), 0 others |
| `ai.fanout_queries` (ChatGPT only): about 3 x 90 | 270 |
| `ai.entity_mentions`: about 3 x 250, `ai.observation_facts`: 250 | 1,000 |
| Indexes (about 30%) | 3,000 |
| **Total** | **about 15 KB (ChatGPT), 12 KB (Gemini, AI Mode)** |

Storing both `answer_text` and `answer_markdown` roughly doubles the answer bytes. It is kept in V1 for simplicity and exact offsets. Optimization if needed: store markdown only and regenerate text deterministically (the markdown-to-text function is versioned with the extractor), saving about 3 KB per observation.

### 1.3 First-party rows

| Table | Bytes per row incl. PK index | Volume driver |
|---|---|---|
| `fp.gsc_search_analytics` | about 130 | Rows per day per property: small sites 1,000 to 5,000; large sites capped near 50,000 per search type by the API (verified) |
| `fp.gsc_page_daily` | about 90 | pages with impressions per day |
| GA4, Cloudflare, Bing imports | small | tens to hundreds of rows per day |

A large GSC property at 50,000 rows per day adds about 2.4 GB per year. This is why the default GSC ingestion stores query-level rows only for queries with at least 1 click or 10 impressions in a day, with page totals kept separately (configurable per integration).

## 2. Growth projections (PostgreSQL)

### 2.1 SEO

Checks per month = keywords x checks per month (30 for daily profiles). Rows per check average about 19 across SEO tables (1 snapshot, about 8 features, 6 domain rank rows, AI Overview rows for 40% of checks, events).

| Load | Checks per month | Rows per year (all SEO tables) | Data per month | Data per year |
|---|---|---|---|---|
| 1,000 keywords daily | 30,000 | about 6.8 M | 210 MB | 2.5 GB |
| 5,000 keywords daily | 150,000 | about 34 M | 1.05 GB | 12.6 GB |
| 10,000 keywords daily | 300,000 | about 68 M | 2.1 GB | 25 GB |
| 100,000 rankings daily (for example 25,000 keywords x 4 locale/device variants) | 3,000,000 | about 680 M | 21 GB | 252 GB |

### 2.2 AI

| Load | Observations per month | Data per month | Data per year |
|---|---|---|---|
| 1,000 prompts/week, V1 default design (about 14,700 obs) | 14,700 | 200 MB | 2.4 GB |
| 5,000 prompts/week, 3/3/1 replicates | 151,500 | 2.0 GB | 24 GB |
| 10,000 prompts/week, 3/3/1 replicates | 303,000 | 4.0 GB | 48 GB |
| 100,000 AI observations per month | 100,000 | 1.3 GB | 16 GB |
| 1,000,000 AI observations per month | 1,000,000 | 13 GB | 160 GB |

### 2.3 Combined scenarios on the 80 GB droplet

Scenario letters in this section are this document's own; doc 22 section 10.1 and doc 23 section 14 use different A, B, C definitions (4 engines x 3 replicates, 15 KB per AI payload), so their numbers are not comparable row by row.

Usable disk for PostgreSQL data on the 80 GB droplet: about 40 GB before the critical disk alert, per the disk budget in [22](22-infrastructure-devops.md) section 9.5 (OS and Docker images, WAL, logs, spool, swap file, and free-space reserve for vacuum and index rebuilds).

| Scenario | PG growth per year | Time until 40 GB (from empty) | Action |
|---|---|---|---|
| A. 1,000 keywords daily + 1,000 prompts/week | about 5 GB | about 8 years | none |
| B. 5,000 keywords daily + 1,000 prompts/week | about 15 GB | about 2.7 years | none in year 1; Volume or DB droplet in year 2 |
| C. 10,000 keywords daily + 5,000 prompts/week | about 49 GB | about 10 months | attach a DO Volume (100 GB, $10/month) or move PG to its own droplet in year 1 |
| D. 100,000 rankings daily + 1M AI obs/month | about 410 GB | about 5 weeks | dedicated database host; plan ClickHouse for observation analytics |

The 40 GB column is the storage step (step 2 in section 7). The resize to 8 GB (step 1) fires much earlier, when the database passes 10 GB: within the first year in every scenario above.

## 3. R2 raw payload growth

Assumptions (replace with S-02 and S-04 measurements): zstd level 6 compressed advanced SERP JSON is 20 KB at depth 20 and 60 KB at depth 100; a consumer AI raw payload is 8 KB compressed.

| Load | Raw per month | 13-month steady state (SERP) + AI kept |
|---|---|---|
| 1,000 keywords `standard` + 1,000 prompts/week | 0.9 GB | about 12 GB after 13 months (`serp_raw` 400 days), then +1.4 GB per year (AI only) |
| 5,000 keywords `standard` + 1,000 prompts/week | 4.0 GB | about 52 GB |
| 10,000 keywords top 100 daily + 10,000 prompts/week | 20 GB | about 265 GB, then +29 GB per year |

Costs are in [27-cost-model.md](27-cost-model.md) section 7 (negligible relative to collection).

## 4. Retention policy

| Data | Location | Retention | Rationale |
|---|---|---|---|
| Normalized SEO observations (snapshots, features, domain ranks, events) | PostgreSQL | indefinite | Compact; rank history is the product |
| `seo.serp_current_results` | PostgreSQL | latest only | Cache |
| Raw SERP JSON (daily and deep weekly checks) | R2 `serp_raw` | 400 days (13 months plus margin), then deleted (doc 23 section 9.2) | Enough for year-over-year re-parse; older re-parse needs are rare |
| AI observations incl. answer text | PostgreSQL | indefinite for core-panel prompts; answer text of discovery-only prompts pruned after 25 months (facts, citations and mentions kept) | Answers cannot be re-observed; text is needed to re-derive |
| Raw AI JSON | R2 `ai_raw` | indefinite | Small; the only evidence of a probabilistic answer |
| Non-current derivations (old extraction outputs) | PostgreSQL | 90 days | Reproducibility via re-derivation from text |
| `ops.collection_tasks` | PostgreSQL | 6 months | Operational ledger; cost events outlive it |
| `ops.provider_cost_events` | PostgreSQL | 25 months, then `ops.cost_daily` only | Billing and audit |
| First-party (GSC etc.) | PostgreSQL | indefinite | GSC keeps only 16 months; our copy is the long history |
| Imported files (CSV exports) | R2 `imports/` | 25 months | Provenance for imported first-party AI data |
| Audit logs | PostgreSQL | 2 years | Security |
| Backups | R2 `seo-backups/daily/` | 30 days, enforced by an R2 lifecycle rule; DigitalOcean weekly droplet backups as a second, host-level copy ([23](23-backup-disaster-recovery.md), ADR-022) | RPO 24 h, RTO 4 h |

Retention is per workspace configurable within limits (a workspace can shorten, not extend beyond platform maximums, in V1).

## 5. Partitioning and index strategy

- Monthly range partitions for all observation tables ([04-data-model.md](04-data-model.md) section 12). At 10,000 keywords daily, the largest monthly partition (`seo.serp_features`) is about 2.4 M rows and 700 MB, a comfortable size for vacuum and index maintenance on the droplet.
- Partition count after 5 years: about 60 per table x 12 partitioned tables = 720 partitions; well within PostgreSQL planner limits when queries include the partition key (every observation query is time-bounded by design).
- Index rules:
  - Every observation index leads with the most selective tenant key (`tracked_keyword_id`, `prompt_id`, `project_id`) followed by time, so queries touch few partitions and few pages.
  - BRIN on `observed_at` for maintenance and ad-hoc time scans (with `autosummarize = on`, off by default in PostgreSQL, verified).
  - No GIN indexes on observation arrays in V1 (write cost); array containment queries are bounded by keyword and time.
  - `pg_stat_statements` reviewed monthly; unused indexes (idx_scan = 0 over 30 days on partitions older than 2 months) are dropped from **old** partitions only.
- Old partitions can be moved to a slower tablespace on a DO Volume (`ALTER TABLE ... SET TABLESPACE`) before a full database move is needed.

## 6. Query strategy at scale

| Query type | V1 approach | Scales to |
|---|---|---|
| Latest rank per keyword | `seo.tracked_keyword_state` (one row per keyword) | any size |
| Rank history for one keyword | index on `(tracked_keyword_id, entity_id, observed_at DESC)`, partition pruning by window | any size |
| Project dashboards | `seo.daily_project_metrics`, `ai.daily_prompt_engine_metrics`, `ai.daily_domain_citations`, `core.xch_keyword_weekly` rollups; Redis cache keyed by `data_version` | hundreds of millions of observation rows |
| Ad-hoc analysis over raw observations (research, backfills) | batch jobs, off-peak | tens of millions of rows per job |
| Cross-project analytics (platform level) | not in V1 | ClickHouse (section 8) |

Rollups store counts and sums, so any window and any prompt- or keyword-level dimension can be aggregated without touching observation partitions.

## 7. Scaling path and triggers

Step numbers match [03-system-architecture.md](03-system-architecture.md) section 10 and [22-infrastructure-devops.md](22-infrastructure-devops.md) section 11. This table is the canonical source for trigger values, which are fixed by [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) and the [locked architecture diagram](diagrams/architecture-locked.html); doc 22 section 11 adds how each trigger is measured. A fired trigger opens a planning ticket, not an emergency. Decisions are made on measurements, not on a hunch; each trigger has one action.

| Step | Trigger (any one) | Action | Cost and effort |
|---|---|---|---|
| 1. Vertical resize to 4 vCPU / 8 GB | swap in steady use; PostgreSQL buffer cache hit ratio under 99% for a week; the database over 10 GB | DO resize (minutes of downtime), raise `shared_buffers` to 2 GB | $24 to $48 a month; 1 hour |
| 2. Database storage | the database over 40 GB | Attach a DO Volume for PostgreSQL data; then move PostgreSQL to its own droplet with the Volume and private VPC networking | from $10 a month; half a day for the Volume, 1 to 2 days for the move |
| 3. Worker capacity | the collection window overruns twice in a month | Raise worker concurrency (`process` first); then a second `worker` container against the same PostgreSQL and Redis | none; an hour |
| 4. API capacity | API p95 over 300 ms on the overview with rollups in place | Profile the query first; a second `api` container behind Caddy is the last resort | none; a day |
| 5. ClickHouse for observation analytics | section 8 | CDC or batch export; PostgreSQL stays the ledger | project |
| 6. Outside customers | the tool is offered to outside companies | API keys (and the Idempotency-Key header), envelope encryption of tenant integration credentials, point-in-time recovery (PITR), GFS backup rotation; revisit ADR-022 | engineering time |

Nothing in V1 blocks step 6: the tables for API keys may already exist without routes, and the backup and PITR upgrade path is described in [23](23-backup-disaster-recovery.md).

## 8. When to introduce ClickHouse (exact triggers)

ClickHouse is not in V1. Introduce it when **any two** of these hold for 30 days:

1. Observation tables exceed **500 million rows** in total, or PostgreSQL data exceeds **150 GB**.
2. p95 of rollup-backed dashboard queries exceeds **1 second** after index and rollup tuning.
3. Product requirements need interactive queries over **raw observation rows** (not rollups) spanning more than 12 months and more than 50 million rows (for example, arbitrary citation-level slicing across all projects).
4. Nightly rollup and derivation jobs exceed **2 hours** of wall time and cannot be parallelized further on the database host.
5. Platform-level analytics across tenants (benchmarks, industry indexes) become a product feature.

Design for later adoption (already in place):
- Observation tables are append-only and partitioned by month, so each closed month can be exported once (Parquet to R2) and loaded into ClickHouse with no change tracking.
- Current-month changes can flow through logical replication or a CDC tool; the tables have primary keys and no in-place updates except documented interpretation backfills, which can be replayed as corrections.
- Canonical ids (url_id, domain_id, entity ids) are stable integers or uuids shared by both stores.

## 9. Redis sizing

Redis carries the Taskiq transport (the `collect` and `process` queues), the shared rate limiter, locks, dedupe keys and the 60 s session read-through cache ([21-scheduler-workers.md](21-scheduler-workers.md) section 5.1). Taskiq keeps a message in Redis only while it waits in its queue; there is no result backend and no retained completed or failed jobs, because outcomes are recorded in `ops.collection_tasks`. At V1 peak (about 20,000 jobs per day) with payloads under 1 KB, Redis stays under 100 MB. `maxmemory 256mb` with `noeviction` is the cap (ADR-022), so a runaway producer gets write errors instead of silently evicting queue messages or locks. Nothing lives only in Redis: after a loss, the reconciler rebuilds in-flight work from the ledger. The Redis cache for dashboard responses uses the `cache:` key prefix with its own TTLs ([22](22-infrastructure-devops.md) section 4.3) and is capped by an application-side size limit (responses over 1 MB are not cached).