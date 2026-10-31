# 28. Data Growth and Scaling

Status: Draft for architecture freeze
Last updated: 2026-10-31
Related: [04-data-model.md](04-data-model.md) section 12, [22-infrastructure-devops.md](22-infrastructure-devops.md), [23-backup-disaster-recovery.md](23-backup-disaster-recovery.md), [27-cost-model.md](27-cost-model.md), [03-system-architecture.md](03-system-architecture.md) section 10, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md), [ADR-023](adr/ADR-023-shared-hostinger-vps.md)

All sizes below are **estimates** from row layouts in doc 04 and typical payload sizes. Spikes S-02 (SERP payloads), S-04 (AI payloads) and S-09 (synthetic dataset on the target host) replace them with measurements in Phase 0. The formulas are kept so the projection can be recomputed.

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

### 2.3 Combined scenarios on idraft's disk budget

Scenario letters in this section are this document's own; doc 22 section 10.1 and doc 23 section 14 use different A, B, C definitions (4 engines x 3 replicates, 15 KB per AI payload), so their numbers are not comparable row by row.

**Disk budget ([ADR-023](adr/ADR-023-shared-hostinger-vps.md)).** The Hostinger VPS has 193 GB of disk shared with a second project. idraft plans on **90 GB**; the rest (103 GB) is the OS and the other project. Measured on 2026-10-31 (idle): 8.3 GB used on the whole disk, database 15 MB. Inside the 90 GB, PostgreSQL gets about **60 GB before the critical alert**:

| Part of the 90 GB budget | GB |
|---|---|
| Docker images, application logs, spool, backup staging | 8 |
| WAL and temporary files | 6 |
| Free-space reserve for vacuum, index rebuilds and partition moves (about 25% of the budget) | 16 |
| **PostgreSQL data usable before the critical alert** | **60** |
| Total | 90 |

This split is a planning figure; the detailed budget and alert thresholds are in [22](22-infrastructure-devops.md) section 9.5. Raw SERP and AI payloads are in Cloudflare R2 per [ADR-004](adr/ADR-004-raw-payloads-r2.md), so they do not use this disk. The step 1 trigger (database over 20 GB) is set at one third of the 60 GB so a move to a dedicated host happens with room to spare.

Time until limit = limit / PG growth per year (from empty):

| Scenario | PG growth per year | Time until 20 GB (step 1 trigger) | Time until 60 GB (critical alert) | Action |
|---|---|---|---|---|
| A. 1,000 keywords daily + 1,000 prompts/week | about 5 GB | 20 / 5 = 4 years | 60 / 5 = 12 years | none |
| B. 5,000 keywords daily + 1,000 prompts/week | about 15 GB | 20 / 15 = 1.3 years (16 months) | 60 / 15 = 4 years | none in year 1; dedicated 16 GB VPS (step 1) in year 2 |
| C. 10,000 keywords daily + 5,000 prompts/week | about 49 GB | 20 / 49 = 4.9 months | 60 / 49 = 1.2 years (15 months) | dedicated 16 GB VPS (step 1) within the first 5 months, rehearsed beforehand |
| D. 100,000 rankings daily + 1M AI obs/month | about 410 GB | 20 / 410 x 365 = 18 days | 60 / 410 x 365 = 53 days (about 8 weeks) | dedicated database host from the start; plan ClickHouse for observation analytics |

The 20 GB column fires step 1 and the 60 GB column is the hard stop on the shared host. Step 1 can also fire earlier on memory, load or the other project's needs (section 7). The growth rates are the sums of the rows in sections 2.1 and 2.2 (A: 2.5 + 2.4, B: 12.6 + 2.4, C: 25 + 24, D: 252 + 160), rounded.

**If raw payloads stayed on local disk** (they do not, ADR-004), they would share the same 60 GB. At the steady states of section 3, scenario A holds about 12 GB of raw after 13 months, so PostgreSQL plus raw reaches 60 GB after about 60 / (5 + 10.8) = 3.8 years (before raw rolls off at 400 days, which flattens it); scenario B holds about 52 GB of raw, so PostgreSQL plus raw grows by about 15 + 48 = 63 GB in the first year and hits 60 GB after about 11 months; at the largest load of section 3 (20 GB raw per month) the budget is gone in about 3 months. Keeping raw in R2 is what makes the shared disk workable.

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
| Backups | R2 `seo-backups/daily/` | 30 days, enforced by an R2 lifecycle rule; Hostinger host snapshots as a second, host-level copy (verify in hPanel what the plan includes; never the only backup) ([23](23-backup-disaster-recovery.md), ADR-022) | RPO 24 h, RTO 4 h |

Retention is per workspace configurable within limits (a workspace can shorten, not extend beyond platform maximums, in V1).

## 5. Partitioning and index strategy

- Monthly range partitions for all observation tables ([04-data-model.md](04-data-model.md) section 12). At 10,000 keywords daily, the largest monthly partition (`seo.serp_features`) is about 2.4 M rows and 700 MB, a comfortable size for vacuum and index maintenance on the shared host.
- Partition count after 5 years: about 60 per table x 12 partitioned tables = 720 partitions; well within PostgreSQL planner limits when queries include the partition key (every observation query is time-bounded by design).
- Index rules:
  - Every observation index leads with the most selective tenant key (`tracked_keyword_id`, `prompt_id`, `project_id`) followed by time, so queries touch few partitions and few pages.
  - BRIN on `observed_at` for maintenance and ad-hoc time scans (with `autosummarize = on`, off by default in PostgreSQL, verified).
  - No GIN indexes on observation arrays in V1 (write cost); array containment queries are bounded by keyword and time.
  - `pg_stat_statements` reviewed monthly; unused indexes (idx_scan = 0 over 30 days on partitions older than 2 months) are dropped from **old** partitions only.
- There is no tablespace or extra-volume step: the Hostinger VPS has one disk (verify in hPanel whether extra disks can be attached). Growth beyond the 60 GB PostgreSQL budget is handled by the dedicated-host steps in section 7. Closed monthly partitions can be exported to Parquet in R2 (section 8) if the database must shrink before a move.

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

Step numbers match [03-system-architecture.md](03-system-architecture.md) section 10 and [22-infrastructure-devops.md](22-infrastructure-devops.md) section 11. This table is the canonical source for trigger values, which follow [ADR-023](adr/ADR-023-shared-hostinger-vps.md) and the [locked architecture diagram](diagrams/architecture-locked.html); doc 22 section 11 adds how each trigger is measured. A fired trigger opens a planning ticket, not an emergency. Decisions are made on measurements, not on a hunch; each trigger has one action.

Step 0 is V1: idraft on the shared Hostinger VPS (4 vCPU, 16 GB RAM, 193 GB disk) with 8 GB RAM in `idraft.slice` (`MemoryHigh=7G`, `MemoryMax=8G`), fair-share CPU (about 2 vCPU guaranteed under contention, up to 4 when the neighbour is idle) and a 90 GB disk budget. The old "8 GB profile" is the baseline: Postgres `mem_limit` 3000m, `shared_buffers` 2 GB, `effective_cache_size` 5 GB. Today's baseline (2026-10-31, idle): load 0.06, 1.06 GB of 16 GB RAM used, 8.3 GB of 193 GB disk, database 15 MB.

| Step | Trigger (any one) | Action | Cost and effort |
|---|---|---|---|
| 1. Dedicated 16 GB VPS for idraft | `idraft.slice` memory above 70% of 8 GB (5.6 GB) for a week, or swap in steady use; host MemAvailable under 2 GB more than twice a week; host load average above 3.5 for 15 minutes more than three times a week; the idraft database over 20 GB; the other project needing more than its half; the tool offered to outside customers (step 6); PostgreSQL buffer cache hit ratio under 99% for a week | Provision a 16 GB VPS, run `infra/bootstrap.sh`, restore the latest nightly dump, switch DNS, retire the old stack. Remove the slice and the shared edge proxy dependency on the new host. Rehearsed in advance (doc 29, doc 31) | `H16` a month in place of `H` (owner enters, doc 27); half a day, 4 h RTO target |
| 2. Dedicated 32 GB VPS or database on its own host | The dedicated 16 GB host above the same 70% / swap thresholds (70% of its memory for a week, or swap in steady use), or the database over 100 GB | Move to a 32 GB VPS (restore and switch as in step 1), or put PostgreSQL on its own host and keep the application on the 16 GB host | `H32` a month, or `H16` plus a database host; 1 to 2 days |
| 3. Worker capacity | the collection window overruns twice in a month | Raise worker concurrency (`process` first); then a second `worker` container against the same PostgreSQL and Redis | none; an hour |
| 4. API capacity | API p95 over 300 ms on the overview with rollups in place | Profile the query first; a second `api` container behind Caddy is the last resort | none; a day |
| 5. ClickHouse for observation analytics | section 8 | CDC or batch export; PostgreSQL stays the ledger | project |
| 6. Outside customers | the tool is offered to outside companies | API keys (and the Idempotency-Key header), envelope encryption of tenant integration credentials, point-in-time recovery (PITR), GFS backup rotation; revisit ADR-022; step 1 fires too | engineering time |

Before step 1, the first response to a memory or cache trigger is cheap: check `docker stats` against each `mem_limit` and the `idraft.slice` counters, and raise Postgres `mem_limit` within the 7 GB soft limit if the other services have room (section 9). Nothing is moved until a trigger is confirmed twice.

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

Redis carries the Taskiq transport (the `collect` and `process` queues), the shared rate limiter, locks, dedupe keys and the 60 s session read-through cache ([21-scheduler-workers.md](21-scheduler-workers.md) section 5.1). Taskiq keeps a message in Redis only while it waits in its queue; there is no result backend and no retained completed or failed jobs, because outcomes are recorded in `ops.collection_tasks`. At V1 peak (about 20,000 jobs per day) with payloads under 1 KB, Redis stays under 100 MB. `maxmemory 256mb` with `noeviction` is the cap (ADR-022); the Redis container `mem_limit` sits just above it and counts inside the 8 GB slice, so a runaway producer gets write errors instead of silently evicting queue messages or locks. Nothing lives only in Redis: after a loss, the reconciler rebuilds in-flight work from the ledger. The Redis cache for dashboard responses uses the `cache:` key prefix with its own TTLs ([22](22-infrastructure-devops.md) section 4.3) and is capped by an application-side size limit (responses over 1 MB are not cached).

**Memory inside the slice.** Baseline limits: Postgres 3,000 MB, worker 768 MB, Redis 256 MB (`maxmemory`), plus `api` (about 165 MB) and `web` (about 170 MB) at their idle measurements of 2026-10-31: about 4.4 GB of the 7 GB soft limit, leaving about 2.6 GB for bursts, page cache and the migrator. The 70% trigger (5.6 GB) therefore fires with real headroom still left before `MemoryMax`. The host's 2 GB swap is shared with the other project and is a safety net only.
