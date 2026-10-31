# 25. Observability

Status: Draft for architecture freeze
Last updated: 2026-09-30
Research basis: `research/08-infra-methodology.md` section 6 (free tiers verified 2026-09-29)
Related: [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) (supersedes ADR-021), [03](03-system-architecture.md), [06](06-dataforseo-seo-integration.md), [07](07-dataforseo-ai-integration.md), [13](13-ai-extraction-engine.md), [16](16-metrics-methodology.md), [21](21-scheduler-workers.md), [22](22-infrastructure-devops.md) (host checks and log rotation), [23](23-backup-disaster-recovery.md), [24](24-security.md)

## 1. Decisions in brief

| Concern | Decision |
|---|---|
| Errors, sampled traces | Sentry (Python SDK in `api` and `worker`, Next.js SDK in `web`), 10% performance sampling |
| Heartbeats and scheduled checks | Healthchecks.io: planner tick, backups, restore drill, maintenance jobs, host check, and the `ops_health` SQL checks, which ping `/fail` when a rule fires |
| External uptime | Better Stack free tier, one check |
| Operations view | The in-app Operations screen (section 8.1), reading `ops.collection_tasks`, `ops.collection_runs`, `ops.cost_daily` and the `ops_health` results |
| Collection, freshness, cost, database and data quality alerts | SQL rules in `ops_health` jobs, stored in `ops.platform_alerts`, delivered through their Healthchecks checks |
| Logs | Structured JSON to stdout, Docker `json-file` rotation, about 14 days on the host, read with `docker compose logs`. No log shipping |
| Metrics | None exported. No Prometheus, Alloy, Grafana or `/metrics` |
| Paging | Healthchecks, Better Stack and Sentry notifications to Slack and email. No PagerDuty in V1 |

Two rules drive the design. Anything on the host cannot report that the host is down, so uptime and heartbeats are checked from outside. The host is shared with a second project ([ADR-023](adr/ADR-023-shared-hostinger-vps.md)), so host-wide memory, disk and load are alerted on as well as idraft's own share (`idraft.slice`); Hostinger's hPanel graphs are a manual cross-check only (verify in hPanel), not an alert source. PostgreSQL is the ledger, so collection health, freshness, cost and data quality are measured in SQL against the ledger, not reconstructed from counters. ADR-022 removed the Alloy and Grafana Cloud stack of ADR-021 because it competed with PostgreSQL for RAM and duplicated what the ledger already records.

## 2. Goals and SLOs (V1)

### 2.1 SLO table

| SLO | SLI | Target | Window |
|---|---|---|---|
| API availability | Better Stack check of `GET https://<domain>/api/healthz` every 30 s ([22](22-infrastructure-devops.md) section 9.2; `/readyz` is internal and Caddy returns 404 for it); a minute with a failed check is down | 99.5% (216 min per 30 days) | calendar month |
| Overview latency | p95 of Sentry `http.server` transactions for route group `overview` (10% sample) | 300 ms | rolling 28 days |
| Prompt Explorer latency | p95, `prompt_explorer` | 500 ms | same |
| Share of Voice latency | p95, `sov` | 200 ms | same |
| Citation intelligence latency | p95, `citations` | 800 ms | same |
| Bootstrap intervals | p95, `bootstrap_ci` | 1.5 s | same |
| Rank collection | scheduled `seo_rank` tasks `ingested` or `skipped_cached` with `completed_at <= window_end + 6h` | 98% | calendar month |
| AI collection | same for `ai_prompt` and `ai_mode_keyword` | 95% | calendar month |
| Rank freshness | active tracked keywords (older than 48 h) with `is_stale = false`, platform-wide, sampled hourly | 98% | calendar month |
| Prompt freshness | expected prompt-engine pairs with a valid observation in the last 9 days | 95% | calendar month |
| Rollup freshness | p95 of rollup lag, sampled every 5 min by `ops_health` | 15 min | rolling 7 days |
| Backup | nightly logical dump succeeds | 1 success per 26 h | daily |
| Restore drill | monthly scripted restore passes its checks ([23](23-backup-disaster-recovery.md) section 8.3) | 1 pass per 31 days | monthly |

Latency targets come from [16](16-metrics-methodology.md) section 13.4 and staleness rules from [21](21-scheduler-workers.md) section 9. The pingback handler SLO is gone with the pingback route (readiness is polling only, ADR-022).

Without a metrics store, sampled SLIs are written by `ops_health` and `ops_health_hourly` to `ops.slo_samples (sampled_at timestamptz, sli text, scope text, value numeric)`, kept 90 days, and read by the Operations screen. Latency SLOs are read from Sentry's performance view; they are reviewed monthly, not alerted on.

### 2.2 Collection SLI query

Runs hourly in `ops_health_hourly`; month-to-date results are written to `ops.slo_samples` (`sli = 'collection_ratio'`, `scope = <workload>`).

```sql
SELECT r.workload,
       count(*) FILTER (WHERE t.status IN ('ingested','skipped_cached')
                          AND t.completed_at <= r.window_end + interval '6 hours')::numeric
       / nullif(count(*) FILTER (WHERE t.status <> 'cancelled'), 0) AS ratio
FROM ops.collection_runs r
JOIN ops.collection_tasks t
  ON t.run_id = r.id
 AND t.created_at >= date_trunc('month', now()) - interval '1 month'   -- partition pruning
WHERE r.trigger = 'schedule'
  AND r.status <> 'budget_blocked'
  AND r.window_start >= date_trunc('month', now())
  AND r.window_end + interval '6 hours' < now()
GROUP BY r.workload;
```

Budget-blocked runs are a customer decision and are reported separately. `empty_result` tasks end as `ingested` ([21](21-scheduler-workers.md) section 6), so they count as on time.

### 2.3 Error budget policy

No error budget machinery in V1. When an SLO misses its target for a month, the next piece of platform work starts with its top contributing cause. Every P1 gets a short note in `docs/incidents/YYYY-MM-DD-<slug>.md`: what happened, impact in SLO minutes or tasks, cause, fix.

## 3. Logging

### 3.1 Fields

Every process logs one JSON object per line to stdout, with string levels and `ts` in ISO 8601 UTC. The Python side configures this once in `idraft/config/logging.py`; the Next.js server uses the same field names.

| Field | Notes |
|---|---|
| `ts`, `level`, `msg` | levels `debug` to `critical`, production minimum `info`; `msg` is stable text, ids go in fields |
| `service`, `version` | `api`, `worker`, `web`, `migrator`, `cli`; git SHA |
| `request_id` | `req_` plus the 26-character Crockford base32 form of a UUIDv7 (for example `req_01M3RN3BWAEXTAVZR9WHJEDSFK`), so ids sort by time; on API logs, in the `X-Request-Id` response header, in problem bodies, and on jobs started by a request. A well-formed inbound `X-Request-Id` is kept; anything else is replaced |
| `job_id`, `queue`, `job_name` | set by the Taskiq middleware (`queue` is `collect` or `process`) |
| `run_id`, `task_id` | collection run and `ops.collection_tasks.id` |
| `workspace_id`, `project_id`, `user_id` | allowed in logs. `user_id` is on every line of an authenticated request, including the access line and the 500 line. A session is never named |
| `provider`, `endpoint`, `engine_code` | endpoint is a family name, for example `serp_organic_task_get` |
| `duration_ms`, `status_code`, `attempt` | request, job, provider call or query |
| `error_kind` | taxonomy of [05](05-provider-integrations.md) section 3.3 (`rate_limited`, `auth`, `schema_mismatch`, ...) or `internal` |
| `route`, `method` | route template, never the raw URL |
| `err` | `type`, `message`, `stack`; provider bodies excluded |

```python
# idraft/config/logging.py (sketch; the field contract above is what is fixed)
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,          # request, job, run, task, workspace ids
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
        redact_processor(REDACT_KEYS, censor="[redacted]"),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(settings.log_level),
)
```

### 3.2 Redaction

Extends [24](24-security.md) section 11. The redaction processor walks nested dicts and lists, so a key is matched at any depth, and a unit test logs fixtures containing every secret-shaped key and asserts none survive.

| Category | Rule |
|---|---|
| Headers | `authorization`, `cookie`, `x-api-key` on requests, `set-cookie` on responses |
| Credential keys | `password`, `token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `apiKey`, `secret`, `client_secret`, `totp_secret`, `dek`, `dek_wrapped`, `ciphertext` |
| OAuth callback (Phase 12) | `code` and `state` query parameters removed |
| Platform config | never logged whole; boot logs an allowlist of non-secret keys (covers `DATAFORSEO_*`, `KEK_*`, `R2_*`) |
| Tenant content, provider bodies | keyword, prompt, answer and snippet text are never logged; log ids plus `sha256` and byte size |
| Personal data | no emails or IPs in application logs (IPs only in `ops.audit_logs`) |

Sentry uses the same key list in `before_send` and `before_breadcrumb` (Python) and `beforeSend` and `beforeBreadcrumb` (Next.js), with `send_default_pii=False`.

### 3.3 Correlation ids

```
browser -> Caddy -> api: the api mints request_id and returns it in X-Request-Id; Caddy's access log records that response header
browser -> Caddy -> web: web mints a request_id in the same format for the page render
web server component -> api over the Docker network, forwarding its X-Request-Id and sentry-trace/baggage
api "check now" -> collection_runs.origin_request_id, task labels meta = { request_id, sentry_trace, baggage }
planner tick -> run_id -> dispatcher -> submit_batch { task_ids } -> fetch_task { task_id } -> ingest_* -> extract, rollups
```

- The api owns the format (section 3.1): `req_` plus a UUIDv7 in Crockford base32. Its middleware keeps an incoming `X-Request-Id` only when it is exactly that (128 bits, version 7, RFC 9562 variant), otherwise mints one, echoes it in the response and tags the Sentry scope with it. Caddy does not add the header: a Caddy UUID would be a second format that the api would have to replace, and the two logs would never share an id. `apps/web` mints ids with the same 10-line encoding (`src/lib/request-id.ts`) and forwards them on server-side calls, so a page render and its API calls share one id.
- Every Taskiq message carries a `meta` label. A Taskiq middleware binds `contextvars` for the job, run, task, request, workspace and project ids before the handler runs, so every log line and Sentry event of that job carries them.
- Scheduled work has no request id; `run_id` is the root. `docker compose logs worker | grep <task_id>` gives a task's history, `grep <run_id>` a run's, `grep <request_id>` a user action's.

### 3.4 Rotation and retention

The daemon default (`max-size 10m`, `max-file 5`, `compress true`) stays for Postgres, Redis and Caddy. App containers (`web`, `api`, `worker`) override it so about 14 days fit:

```yaml
x-app-logging: &app-logging
  driver: json-file
  options: { max-size: "50m", max-file: "8", compress: "true", labels: "com.docker.compose.service" }
```

Estimated volume (INFERRED, measure in Phase 4): about 150,000 lines, 60 MB per day across services. journald is capped at `SystemMaxUse=500M`. The monthly ops review runs `docker compose logs --since 336h api | head -1` and raises `max-file` if the oldest line is younger than 14 days.

Logs are read on the host with `docker compose logs [--since 30m] <service>` and filtered with `grep` or `jq`. Nothing ships logs off the host ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). Errors that matter across restarts go to Sentry, which keeps them 30 days. Retention on the host is about 14 days, size-capped rather than time-based, matching [24](24-security.md) section 11.

## 4. Metrics

### 4.1 Decision

No exported metrics ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). There is no `/metrics` endpoint, no Prometheus client, no Alloy and no Grafana. What each former metric family became:

| Need | Where it is now |
|---|---|
| Request latency and error rate | Sentry performance (10% sample) and Sentry issues (section 10) |
| Queue and task state, provider errors, turnaround, cost | The ledger: `ops.collection_tasks`, `ops.task_attempts`, `ops.collection_runs`, `ops.cost_daily`, read by the Operations screen and by `ops_health` rules |
| Postgres and Redis health | `ops_health` SQL checks (section 4.4) |
| Data quality counters | `ops.quality_counters_daily` (section 9) |
| Host disk, memory, swap, OOM, container health | `seo-hostcheck.timer` pinging Healthchecks ([22](22-infrastructure-devops.md) section 9.2) |
| Sampled SLIs | `ops.slo_samples` (section 2.1) |

### 4.2 Cardinality rules

Removed with the metrics export. Per-project numbers are on the Operations screen, from SQL.

### 4.3 Catalog

Removed with the metrics export; section 4.1 maps each former metric family to its replacement.

### 4.4 Postgres and Redis checks, rollup lag

`ops_health` runs every 5 minutes in the worker's `process` queue as `app_worker` (granted `pg_read_all_stats`), in a read-only transaction with `SET LOCAL statement_timeout = '5s'`. It evaluates these checks in SQL and raises alerts 7 to 11 (section 6); nothing is exported. Queries target catalog views: `pg_stat_activity` (connections by state; longest transaction with `application_name <> 'pg_dump'` so the nightly dump does not alert), `pg_stat_database` (block counters, differenced between runs through `ops.slo_samples`), `pg_stat_user_tables` (dead tuples, last autovacuum), `pg_inherits` (partitions per parent), and the number of future monthly partitions per parent (fewer than 2 means `ensure_partitions` is failing; doc 04 section 12.2 creates no default partition, so a missing partition makes inserts fail). Redis checks use `INFO memory` (used memory, `maxmemory`, `maxmemory_policy`) and `INFO stats` (evictions); the application user's ACL allows `INFO` but not `CONFIG`. Largest tables and top `pg_stat_statements` entries are shown on the Operations screen.

```sql
SELECT coalesce(max(extract(epoch FROM now() - xact_start)), 0) AS longest_txn_s
FROM pg_stat_activity
WHERE xact_start IS NOT NULL AND application_name <> 'pg_dump' AND pid <> pg_backend_pid();
```

Rollup lag: when `ingest_*` enqueues a debounced rollup it runs `HSETNX rollup:pending <kind>:<project>:<date> <epoch_ms>`; the rollup job runs `HDEL` on success. `ops_health` reads `now - min(values)` every 5 minutes and writes it to `ops.slo_samples`. After Redis loss the reconciler re-enqueues rollups ([21](21-scheduler-workers.md) section 8, step 6) and the hash refills.

Readiness source: `ops.collection_tasks.ready_source` records whether `poll`, `sweeper` or `live` marked a task ready (readiness is polling only, ADR-022). The Operations screen shows the split and the submitted-to-ready turnaround per endpoint.

## 5. Monitoring stack

### 5.1 Choice

Only external services and the ledger ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). Sentry catches exceptions and samples performance; Healthchecks.io watches every scheduled job, including the `ops_health` SQL checks; Better Stack checks from outside that the site answers; the Operations screen shows the ledger. The earlier Grafana Alloy plus Grafana Cloud design (ADR-021) and the Beszel fallback are removed, and so is the memory budget they needed: nothing monitoring-related runs on the host beyond the SDKs inside the app processes and a 5-minute host check timer.

### 5.2 Components

| Component | Where | RAM on host | Free-tier limits | Monitors |
|---|---|---|---|---|
| Sentry SDK | `api`, `worker` (Python), `web` (Next.js) | 15 to 25 MB per process (INFERRED), inside process budgets | 5,000 errors, 5 M spans, 1 user, 30-day retention | exceptions, sampled traces |
| Healthchecks.io Hobbyist | SaaS | 0 | 20 checks, 100 log entries each | planner tick, backups, restore drill, maintenance jobs, host check, `ops_health` |
| Better Stack Free | SaaS | 0 | 10 monitors and heartbeats, 1 status page | one external uptime check |
| `ops_health` jobs | worker `process` queue | inside its budget | n/a | SQL alerts, SLO samples |
| `seo-hostcheck.timer` | host systemd timer ([22](22-infrastructure-devops.md) section 9.2) | under 10 MB for about 2 s every 5 min | n/a | host-wide disk (193 GB, both projects), idraft disk share (budget 90 GB), host `MemAvailable`, swap, load average, `idraft.slice` memory (`/sys/fs/cgroup/idraft.slice/memory.current`), OOM kills, container health |
| Operations screen | `web` and `api` | none extra | n/a | ledger, alerts, SLO samples |
| Rejected: Grafana Alloy + Grafana Cloud (ADR-021) | | 70 to 100 MB | | superseded by ADR-022 |
| Rejected: Netdata | | 250 to 350 MB | | too heavy for an 8 GB slice on a shared host |
| Rejected: Uptime Kuma on the host | | extra process | | cannot see its own host down |

### 5.3 Alloy configuration

Removed. ADR-022 dropped Alloy; there is no on-host agent configuration. Host checks are the `seo-hostcheck.sh` script in [22](22-infrastructure-devops.md) section 9.2.

## 6. Alert catalog

Sources: **B** Better Stack, **H** a Healthchecks.io check that is late or pinged `/fail`, **O** a SQL rule (evaluated by `ops_health` every 5 min, `ops_health_hourly`, `dq_daily` at 05:00 UTC, or the monthly lifecycle audit) delivered through the `ops-health` Healthchecks checks (section 7.1), **S** Sentry. Severities are defined in section 7. "min n" means the rule does not fire below that volume. P3 rules are recorded in `ops.platform_alerts` and shown on the Operations screen only.

| # | Alert | Condition | Sev | Src | Runbook |
|---|---|---|---|---|---|
| 1 | Site down | `GET https://<domain>/api/healthz` fails 2 consecutive checks | P1 | B | [rb-api-down](#rb-api-down) |
| 2 | Container unhealthy or restarting | host check: any container not `healthy` (covers `web`, which the uptime check does not reach), or its restart count up by more than 3 in 10 min | P1 | H (`host-health`) | [rb-memory](#rb-memory) |
| 3 | Application error | new or regressed Sentry issue in `api`, `worker` or `web` (P2 if > 50 events in 1 h) | P3/P2 | S | [rb-api-errors](#rb-api-errors) |
| 4 | Disk | host check, host-wide root filesystem of 193 GB (both projects): > 70%, about 135 GB (reason `disk_warn`) or > 85%, about 164 GB (reason `disk_crit`); and idraft's own share (Docker volumes, images, spool, restore scratch) > 65 GB (`idraft_disk_warn`) or > 80 GB (`idraft_disk_crit`), the lines derived in [22](22-infrastructure-devops.md) section 9.5 | P1 | H (`host-health`) | [rb-disk](#rb-disk) |
| 5 | Memory | host check: shared swap (2 GB) used > 512 MB, host-wide `MemAvailable` < 1 GB (15.6 GiB visible, both projects), `idraft.slice` `memory.current` > 7 GB (its `MemoryHigh`; the cap is 8 GB), or any OOM kill in the last 10 min (reason names the cgroup: `idraft.slice`, the neighbour's slice or system) | P1 | H (`host-health`) | [rb-memory](#rb-memory) |
| 6 | Swap and capacity trend | any of: swap used > 256 MB for 24 h; `idraft.slice` memory > 70% of 8 GB (5.6 GB) for a week; host `MemAvailable` < 2 GB more than twice a week; host load average > 3.5 (4 vCPU) for 15 min more than three times a week. These are the dedicated-host triggers of [ADR-023](adr/ADR-023-shared-hostinger-vps.md) and doc 28 section 7; host values are read from `/proc/meminfo` and `/proc/loadavg`, which show host values inside the worker container | P3 | O | [rb-memory](#rb-memory) |
| 7 | Postgres connections | connections > 80% of `max_connections` (80 in the baseline 8 GB profile, so 64; 60 only on the 4 GB laptop and CI profile, [22](22-infrastructure-devops.md) sections 4.2 and 12.4) in 2 consecutive runs | P2 | O | [rb-postgres](#rb-postgres) |
| 8 | Postgres cache hit | hit / (hit + read) over the last 24 h < 99% (capacity trigger when it holds for a week, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)) | P3 | O | [rb-postgres](#rb-postgres) |
| 9 | Long transaction | longest transaction > 10 min, or idle in transaction > 5 min | P2 | O | [rb-postgres](#rb-postgres) |
| 10 | Partition runway | any partitioned parent with fewer than 2 future partitions, or any ingest error `no partition of relation` | P2 | O | [rb-postgres](#rb-postgres) |
| 11 | Redis memory | used / maxmemory > 80% in 2 consecutive runs, policy not `noeviction`, or any eviction | P1 | O | [rb-queue](#rb-queue) |
| 12 | Queue backlog | ledger: tasks due and `pending` for more than 30 min, or Taskiq queue length above N for 30 min (`collect` 5,000; `process` 5,000), or oldest queued message > 2 h | P2 | O | [rb-queue](#rb-queue) |
| 13 | Task failure rate | failed attempts (`ops.task_attempts` rows with an `error_kind`, plus tasks moved to `failed`) / tasks submitted, over 30 min per workload, > 5%, min 40 | P2 | O | [rb-queue](#rb-queue) |
| 14 | Dead tasks in run | dead > 1% of `tasks_total`, min 100 tasks | P2 | O | [rb-collection](#rb-collection) |
| 15 | Run overdue | run `running` past `window_end + 6h` | P2 | O | [rb-collection](#rb-collection) |
| 16 | Schedule stuck | active schedule with `next_run_at < now() - 1h` | P1 | O | [rb-collection](#rb-collection) |
| 17 | Planner heartbeat | `planner-tick` check late by 5 min | P1 | H | [rb-collection](#rb-collection) |
| 18 | Stale keywords | project with > 5% of active keywords stale, min 20 (P3 if its last rank run is `budget_blocked`) | P2 | O | [rb-collection](#rb-collection) |
| 19 | Stale prompts | project with > 5% of expected prompt-engine pairs stale, min 20 (P3 if budget blocked) | P2 | O | [rb-collection](#rb-collection) |
| 20 | Collection SLO burn | month-to-date ratio below target with more than half the month left | P2 | O | [rb-collection](#rb-collection) |
| 21 | Rollup lag | lag > 1800 s in 3 consecutive runs (15 min) | P2 | O | [rb-queue](#rb-queue) |
| 22 | Provider error rate | same ledger source as 13, per provider, counting only non-ok, non-empty kinds: > 5% over 30 min, min 100 | P2 | O | [rb-provider](#rb-provider) |
| 23 | Provider auth or payment | any task or attempt with kind `auth`, `payment` or `account_limit` (DataForSEO 401, 402, 40203), or a provider paused | P1, immediate | O | [rb-provider](#rb-provider) |
| 24 | DataForSEO balance | balance < 14 days of trailing 7-day average spend (P2); < 5 days (P1) | P2/P1 | O | [rb-spend](#rb-spend) |
| 25 | Spend anomaly | yesterday > 150% of prior 7-day average and > $5, or today so far already above that | P2 | O | [rb-spend](#rb-spend) |
| 26 | Budget soft limit | a budget reaches `soft_limit_pct` | P3 | O | [rb-spend](#rb-spend) |
| 27 | Budget hard limit | a budget reaches 100% (runs become `budget_blocked`) | P2 | O | [rb-spend](#rb-spend) |
| 28 | Cost reconciliation | absolute gap between provider daily spend and our cost events > 10% of provider spend and > $1 | P2 | O | [rb-spend](#rb-spend) |
| 29 | Schema mismatch | from `ops.quality_counters_daily`: > 0.5% of ingests per component over 1 h, min 200 (P2); > 5% (P1) | P2/P1 | O | [rb-parser](#rb-parser) |
| 30 | AIO presence drop | platform AIO presence today < 50% of yesterday, min 500 SERPs per day | P2 | O | [rb-parser](#rb-parser) |
| 31 | Mass rank change | in a project, > 30% of comparable keywords moved > 10 positions day over day, min 50 | P2 | O | [rb-parser](#rb-parser) |
| 32 | Data quality breach | any `dq_daily` check outside threshold (section 9) | P3 (P2 where noted) | O | [rb-parser](#rb-parser) |
| 33 | New model string | new `(engine_code, model_reported)` pair | P3 | O | [rb-parser](#rb-parser) |
| 34 | Extraction LLM budget | a project reaches its monthly classifier cap (P3); > 20% of projects (P2) | P3/P2 | O | [rb-spend](#rb-spend) |
| 35 | Backup missed or failed | `backup-nightly` late 2 h or failed with exit 2, 3 or 4 (P1); size anomaly, exit 5 (P2) ([23](23-backup-disaster-recovery.md) section 15) | P1/P2 | H | [rb-backup](#rb-backup) |
| 36 | Restore drill overdue or failed | `restore-drill` late (period 31 days, grace 3 days) (P2); failed with exit 11, 12 or 13 (P1) or 10, 14 or 15 (P2) ([23](23-backup-disaster-recovery.md) section 15) | P2/P1 | H | [rb-backup](#rb-backup) |
| 37 | R2 failures | fetches whose result could not be stored (the task goes back to `submitted` with `last_error_code = 'storage_failed'`, and the worker logs `result not stored`) > 1% of fetches over 15 min (min 50), or 10 consecutive | P1 | O | [rb-provider](#rb-provider) |
| 38 | Certificate expiry | TLS handshake from `ops_health` to the domain: < 14 days (P2), < 7 days (P1). Caddy renews about 30 days ahead, so this means renewal fails | P2/P1 | O | [rb-api-down](#rb-api-down) |
| 39 | Alerting blind | `ops-health` or `ops-health-critical` check late 10 min (the rules themselves are not running) | P1 | H | [rb-queue](#rb-queue) |
| 40 | Spool size | local raw spool (`/var/spool/seo`) above 400 MB for 15 min (R2 uploads falling behind) | P2 | O | [rb-disk](#rb-disk) |
| 41 | R2 lifecycle drift | the monthly lifecycle audit job finds R2 lifecycle rules differing from `infra/r2/*.json` ([23](23-backup-disaster-recovery.md) section 7.2) | P2 | O | doc 23 |
| 42 | Maintenance job missed or failed | any maintenance check in section 12 late or pinged `/fail` | P2 | H | [rb-collection](#rb-collection) |

Removed with ADR-022: the Grafana-only rules on API 5xx rate and per-route latency (Sentry issues and the monthly latency review replace them), metric series budget, pingback ratio and the pingback runbook, and the `ai_raw` replica lag.

Examples:

```sql
-- 24: balance runway; $1 is the balance read by balance_check
SELECT $1::numeric / nullif(sum(cost_usd) / 7, 0) AS days_left
FROM ops.cost_daily
WHERE provider_code = 'dataforseo' AND cost_date >= current_date - 7 AND cost_date < current_date;

-- 25: spend anomaly (after cost_reconcile at 00:45 UTC)
WITH d AS (SELECT cost_date, sum(cost_usd) AS usd FROM ops.cost_daily
           WHERE cost_date >= current_date - 8 GROUP BY 1)
SELECT (SELECT usd FROM d WHERE cost_date = current_date - 1) AS yesterday,
       (SELECT avg(usd) FROM d WHERE cost_date BETWEEN current_date - 8 AND current_date - 2) AS avg7;
```

## 7. Routing and noise control

### 7.1 Severities and channels

| Sev | Meaning | Delivered by | Channels |
|---|---|---|---|
| P1 critical | users affected now, data loss risk, or money at risk | Better Stack (site down); Healthchecks checks `ops-health-critical`, `planner-tick`, `backup-nightly`, `host-health` | Slack `#ops-critical` and email to two people, 24/7 |
| P2 warning | degradation or SLO risk; act within the business day | Healthchecks check `ops-health` (every P2 SQL rule); late or failed heartbeats of `ops-health-hourly`, `dq-daily`, `restore-drill` and the maintenance checks; Sentry issues above 50 events in 1 h | Slack `#ops-alerts` and email to on-call |
| P3 info | trend, capacity or change notice | `ops.platform_alerts` only; Sentry new issues | Operations screen; Sentry email |

How a SQL rule reaches a person: every rule, whichever job evaluates it (`ops_health`, `ops_health_hourly`, `dq_daily`, the monthly lifecycle audit), writes its state to `ops.platform_alerts`. The 5-minute `ops_health` run is the only notifier. It owns two Healthchecks checks so severities route separately: `ops-health-critical` gets `/fail` while any P1 row is firing, `ops-health` while any P2 row is firing, and a success ping otherwise. The `/fail` body lists the firing rules (alert code, scope, value, threshold, runbook anchor), which Healthchecks includes in its notification. The other jobs ping their own checks only as heartbeats: success when the job finished, `/fail` when it crashed.

Healthchecks and Better Stack send Slack (incoming webhook integration) and email; Sentry's free plan alerts by email, and Slack availability on the Developer plan is confirmed at setup. Messages never carry keyword, prompt or answer text: the `/fail` body is built from `ops.platform_alerts.evidence`, which holds values, thresholds and ids only.

### 7.2 Grouping, dedupe, pending

- Healthchecks notifies on state changes only (up to down, down to up). A second rule firing while the same check is already down does not notify again; it shows on the Operations screen and in the check's ping log, and the on-call person clears the first cause or reads the screen. Splitting P1 and P2 into separate checks keeps a P2 from masking a P1.
- SQL rules use `dedupe_key = alert_code|scope`, for example `stale_keywords|project:<id>`. A rule first writes `status = 'pending'` and fires only after holding for its duration. A resolved rule sets `resolved_at`; when no rule of that severity is firing, the next run pings success and Healthchecks sends the recovery message.
- Each condition has one owner: site reachability is Better Stack only; container and host health is `host-health` only; everything read from PostgreSQL or Redis is `ops_health` only.

```sql
CREATE TABLE ops.platform_alerts (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_code        text NOT NULL,
    dedupe_key        text NOT NULL,
    scope             jsonb NOT NULL,
    severity          text NOT NULL CHECK (severity IN ('info','warning','critical')),
    status            text NOT NULL CHECK (status IN ('pending','firing','resolved')),
    summary           text NOT NULL,
    evidence          jsonb NOT NULL,        -- values, thresholds, ids; no tenant content
    pending_since     timestamptz NOT NULL,
    fired_at          timestamptz,
    last_evaluated_at timestamptz NOT NULL,
    last_notified_at  timestamptz,
    resolved_at       timestamptz,
    acknowledged_by   uuid,
    acknowledged_at   timestamptz,
    runbook           text NOT NULL
);
CREATE UNIQUE INDEX ON ops.platform_alerts (dedupe_key) WHERE status IN ('pending','firing');
```

Platform alerts are separate from customer alert rules (`ops.alert_rules`, `ops.alert_events`).

### 7.3 Maintenance windows

`ops.maintenance_windows (id, starts_at, ends_at, scope text[], reason, created_by)`. The deploy workflow opens a 20-minute window before restarting containers and closes it after the smoke check. `ops_health` skips rules whose scope matches (`api`, `workers`, `db`, `all`), the workflow pauses the Better Stack monitor through its API, and Healthchecks grace periods (at least 5 min) absorb the restarts of `worker` and the host check.

### 7.4 Escalation for a small team

- One primary on-call per week, rotating among the people on the team, plus a secondary. Both receive P1 notifications.
- P1 not acknowledged in 15 min: the secondary phones the primary. There is no automatic re-notification (section 7.2).
- Acknowledge on the Operations screen (`POST /api/v1/admin/platform-alerts/{id}/ack`, doc 19 section 3.11.5b), in Better Stack, or by pausing the Healthchecks check with a note.
- A P2 firing for 3 business days goes to the weekly ops review. The monthly review covers alert counts by rule, false positives, threshold changes, SLO status, Sentry latency per route group and free-tier usage.

## 8. Dashboards

There are no metric dashboards. The in-app Operations screen is the only dashboard ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)); Sentry's own views cover errors and performance, and Healthchecks and Better Stack show check history.

### 8.1 In-app Operations screen

Route `/ops` in the Next.js app, API `/api/v1/admin/*` ([19](19-api-specification.md), pseudo-permission `platform_operator`). It reads PostgreSQL (the ledger, `ops.platform_alerts`, `ops.slo_samples`) and Taskiq queue lengths from Redis through the API, and shows per-project detail. Access needs a platform operator flag (section 13).

| Section | Content |
|---|---|
| Health | firing and pending platform alerts with ack, last `ops_health` run, last planner tick, links to Healthchecks, Better Stack and Sentry |
| SLOs | every section 2.1 SLO with target and current value (from `ops.slo_samples`; latency links to Sentry) |
| Runs | last 7 days: workload, window, status, tasks by status, estimated vs actual cost, `origin_request_id` |
| Dead letters | dead and failed tasks with error kind, attempts, raw error body, requeue ([21](21-scheduler-workers.md) section 6) |
| Freshness | per project stale keyword and prompt ratios, last successful check, last run status |
| Queues | ledger tasks by workload and status, Taskiq queue lengths, oldest queued message, provider turnaround p50/p95 from `ops.collection_tasks`, paused providers with resume |
| Cost | month-to-date spend by workspace, project, workload; budgets; runway; reconciliation history |
| Data quality | 30 days of `dq_daily` results with drill-down to sample observation ids |
| Database | connections, cache hit, longest transaction, largest tables, partitions and runway, top 20 `pg_stat_statements` by total time, Redis memory |
| Versions, maintenance | `ops.component_versions` including model boundaries; maintenance windows |

## 9. Data quality monitors

Counts not stored on observation rows (uncertain mentions, redirects, recomputed ranks) are accumulated in memory by the worker's `process` queue and flushed every 60 s:

```sql
CREATE TABLE ops.quality_counters_daily (
    metric_date       date NOT NULL,
    component         text NOT NULL,     -- 'serp_parser', 'ai_normalizer:dataforseo_chatgpt', 'extractor', ...
    component_version smallint NOT NULL,
    engine_code       text NOT NULL DEFAULT '',
    counter           text NOT NULL,     -- ingests, schema_mismatch, rank_recomputed, unresolved_redirect, organic_results,
                                         -- mentions_total, mentions_uncertain, llm_rule_compared, llm_rule_disagree
    value             bigint NOT NULL,
    PRIMARY KEY (metric_date, component, component_version, engine_code, counter)
);
-- flush: INSERT ... ON CONFLICT (...) DO UPDATE SET value = ops.quality_counters_daily.value + EXCLUDED.value
```

`dq_daily` runs at 05:00 UTC over the previous UTC day, writes each check result to `ops.slo_samples` (`sli = 'dq:<check>'`), raises alert 32 and pings the `dq-daily` check. Below the minimum volume a check reports "insufficient data".

| Check | Definition | Threshold | Min n |
|---|---|---|---|
| SERP parser anomaly | `rank_recomputed / ingests` for `serp_parser` | > 0.5% | 500 |
| Unresolved redirects | `unresolved_redirect / organic_results` | > 0.1% (DataForSEO resolves 99.99%, [06](06-dataforseo-seo-integration.md) section 5.2) | 5,000 results |
| Schema mismatch (daily) | `schema_mismatch / ingests` per component | > 0.5% | 200 |
| AI status mix | share `empty`, `refused`, `error` per engine | `error + empty` > 10%, or `refused` > 2x 7-day baseline | 100 |
| Citation presence | valid observations with `has_citations`, per engine, vs 7-day baseline | < 70% of baseline (P2) | 200 |
| Fan-out presence | valid `chatgpt_web` observations with `fanout_count > 0` vs baseline (no other engine exposes fan-out, [07](07-dataforseo-ai-integration.md) section 2) | < 50% of baseline | 100 |
| AIO presence | `has_ai_overview` share of SERP snapshots vs previous day (alert 30) | < 50% of previous day (P2) | 500 |
| Model change | new `(engine_code, model_reported)` (alert 33) | any | 1 |
| Duplicate answers | replicate groups (run, prompt version, engine) with a repeated `answer_hash` | > 50% for an engine; baseline from spike S-05 | 50 groups |
| Extraction uncertain | `mentions_uncertain / mentions_total` per engine | > 15%, or > 1.5x 28-day mean | 500 |
| LLM classifier disagreement (weekly, Mondays) | rules re-run on 200 sampled LLM-labelled items; `llm_rule_disagree / llm_rule_compared` | up > 10 points on the 4-week mean | 100 |

```sql
-- AI status mix and citation presence by engine for day $1 (AIO from rank SERPs excluded)
SELECT engine_code, count(*) AS n,
       avg((status IN ('error','empty'))::int) AS error_empty_rate,
       avg((status = 'refused')::int)          AS refused_rate,
       avg(has_citations::int) FILTER (WHERE status IN ('complete','partial')) AS citation_rate
FROM ai.observations
WHERE observed_at >= $1::date AND observed_at < $1::date + 1
  AND engine_code <> 'google_ai_overview'
GROUP BY engine_code;

-- Duplicate answer rate per engine
WITH g AS (
  SELECT engine_code, collection_run_id, prompt_version_id,
         count(*) AS reps, count(DISTINCT answer_hash) AS distinct_answers
  FROM ai.observations
  WHERE observed_at >= $1::date AND observed_at < $1::date + 1
    AND prompt_version_id IS NOT NULL AND status = 'complete'
  GROUP BY 1, 2, 3 HAVING count(*) > 1)
SELECT engine_code, count(*) AS groups, avg((distinct_answers < reps)::int) AS dup_rate
FROM g GROUP BY 1;

-- Mass rank change (alert 31)
SELECT project_id, count(*) AS comparable,
       count(*) FILTER (WHERE abs(rank_change) > 10)::numeric / count(*) AS moved_share
FROM seo.tracked_keyword_state
WHERE last_observed_at > now() - interval '24 hours' AND rank_change IS NOT NULL
GROUP BY project_id
HAVING count(*) >= 50 AND count(*) FILTER (WHERE abs(rank_change) > 10) > 0.3 * count(*);
```

On a new model string, the job inserts `ops.component_versions (component = 'engine_model:<engine_code>', version = next, notes = <model string>, git_sha = 'external', is_breaking = true)`, so charts show a version boundary as [07](07-dataforseo-ai-integration.md) section 10 requires. Detection compares recent `model_reported` values against existing `notes` for that component.

A mass rank change in one project usually means a Google update, a site problem, or a location or device mismatch. The same alert in three or more projects on one day points to the provider or our parser; the alert text states which case applies.

## 10. Tracing

V1 uses correlation ids (section 3.3) plus Sentry performance sampling at 10% ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). No OpenTelemetry collector runs on the host.

| Setting | Value |
|---|---|
| API (`traces_sampler`) | 0.1 for every route group; 0 for `health` |
| Worker jobs | 0.1 |
| Next.js (`tracesSampleRate`) | 0.1. Browser calls go to the same origin (`/api/...`), and server components call `http://api:8000` on the Docker network; both are in `tracePropagationTargets`, so traces continue from browser to `web` to `api` |
| Errors | always captured |
| Expected errors | provider error kinds handled by the retry policy live in the ledger; `before_send` drops them |
| Volume guard | 10 events per fingerprint per minute in process; Sentry spike protection on |
| Tags | `service`, `version`, `queue`, `job_name`, `route_group`, `request_id`, `run_id` |

Request ids are kept everywhere: Caddy sets `X-Request-Id`, every log line and Sentry event carries `request_id`, and jobs started by a request carry it in their `meta` label. The API copies `sentry-trace` and `baggage` into the Taskiq message `meta`, and the worker continues the trace.

Estimate (INFERRED): about 100,000 requests and 600,000 jobs per month give about 70,000 sampled transactions of 10 to 15 spans, about 0.7 M to 1 M spans (14% to 20% of 5 M), and under 1,000 error events once expected errors are filtered. If span volume approaches the free limit, lower the worker rate first; per-route latency needs the API sample more.

Later: when the dedicated host or a separate Postgres host arrives ([03](03-system-architecture.md) section 10, steps 2 and 3), revisit OpenTelemetry. Correlation fields stay the same.

## 11. Runbooks

Commands run as `deploy` in `/opt/seo-platform/src/infra/compose` ([22](22-infrastructure-devops.md) section 12) against database `seo`. `idraft` is the backend's admin CLI, run as `docker compose run --rm worker idraft <command>`.

<a id="rb-api-down"></a>
### 11.1 Site down, web container down, certificate expiry (alerts 1, 2, 38)

- **First checks:** host reachable over SSH? (If the neighbour project is also down, it is the host: check hPanel status first.) `docker compose ps` (is `caddy`, `web` or `api` unhealthy?); `curl -sS -o /dev/null -w '%{http_code}\n' https://<domain>/api/healthz`; `curl -sS -o /dev/null -w '%{http_code}\n' https://<domain>/`.
- **Commands:** `docker compose logs --since 15m caddy api web | tail -200`; certificate: `echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null | openssl x509 -noout -enddate`; `docker compose logs caddy | grep -i -E 'acme|certificate'`.
- **Mitigation:** `docker compose up -d caddy web api`. If `readyz` fails on Postgres or Redis, go to [rb-postgres](#rb-postgres) or [rb-queue](#rb-queue). Unreachable host: check hPanel status, then restart from hPanel (this also restarts the neighbour project, so tell its owner first; take a snapshot only if you suspect a compromise). Renewal failures are usually DNS, port 80 blocked at the hPanel firewall or `ufw`, or the host-level edge proxy not forwarding idraft's hostnames (D-H2, doc 30).

<a id="rb-api-errors"></a>
### 11.2 Application errors and latency (alert 3, monthly latency review)

- **First checks:** which service and route group? Deploy in the last hour? Sentry issue and its release tag; Sentry performance for the route group. `docker stats --no-stream` for CPU contention with the worker.
- **Commands:** `docker compose logs --since 30m api | grep '"level":"error"' | tail -50`; `SELECT calls, round(mean_exec_time) AS ms, left(query, 100) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`
- **Mitigation:** roll back to the previous image tag if a deploy caused it. For rollup-backed routes, check `data_version` churn. For CPU contention, lower the `process` queue concurrency in `/etc/seo-platform/.env` and restart `worker`.

<a id="rb-disk"></a>
### 11.3 Disk and spool (alerts 4, 40)

- **First checks:** `df -h /` (host-wide, both projects); idraft's share: `docker system df` and `du -sh /var/lib/docker/volumes/idraft_* /var/spool/seo /var/lib/seo-restore`; `du -xh --max-depth=1 /var/lib | sort -h | tail`; `journalctl --disk-usage`; `du -sh /var/spool/seo`.
- **Commands:** `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;` and `SELECT pg_size_pretty(sum(size)) FROM pg_ls_waldir();`
- **Mitigation:** `docker image prune -a --filter "until=168h"`; `idraft maintenance-run retention_drop` if drops are overdue; `journalctl --vacuum-size=300M`. Never delete files in the Postgres volume by hand. A growing spool means R2 uploads are failing: go to [rb-provider](#rb-provider). If the host is full but idraft is under its 90 GB budget, the neighbour project is the cause: tell its owner, do not delete anything of theirs. If idraft is over budget, free space first, then plan the dedicated host (doc 28 section 7); there is no Volume to attach. The idraft database over 20 GB is a dedicated-host trigger ([ADR-023](adr/ADR-023-shared-hostinger-vps.md)).

<a id="rb-memory"></a>
### 11.4 Memory, swap, OOM, unhealthy or restarting containers (alerts 2, 5, 6)

- **First checks:** which container? `docker compose ps`; `dmesg -T | grep -i -E 'killed process|oom'` (the line names the cgroup, so it shows whether idraft or the neighbour was killed); `free -m`; `systemctl show idraft.slice -p MemoryCurrent -p MemoryHigh -p MemoryMax`; container memory vs `mem_limit`.
- **Commands:** `docker stats --no-stream`; `docker compose logs --since 30m <service> | tail -100`; `docker inspect --format '{{.RestartCount}} {{.State.OOMKilled}}' <container>`.
- **Mitigation:** a boot loop with a Pydantic settings error: fix `/etc/seo-platform/.env` through the GitHub environment and redeploy. A memory leak in `api` or `worker`: restart, file an issue with `docker stats` samples, lower job concurrency until fixed. Postgres OOM: find the runaway query, reduce `work_mem`. Swap above 256 MB for a day, or cache hit under 99% for a week: check `idraft.slice` first (above 5.6 GB for a week means the 8 GB share is too small); then ask whether the neighbour project grew; the next step is the dedicated 16 GB host (doc 28 section 7), not an in-place resize. If the host `MemAvailable` is low while `idraft.slice` is under 7 GB, the neighbour is the cause: tell its owner.

<a id="rb-postgres"></a>
### 11.5 Postgres connections, long transactions, cache hit, partition runway (alerts 7 to 10)

- **First checks:**
  ```sql
  SELECT application_name, state, count(*) FROM pg_stat_activity GROUP BY 1, 2 ORDER BY 3 DESC;
  SELECT pid, now() - xact_start AS age, state, application_name, left(query, 120)
  FROM pg_stat_activity WHERE xact_start < now() - interval '10 minutes' ORDER BY xact_start;
  ```
- **Mitigation:** `SELECT pg_cancel_backend(pid)`, then `pg_terminate_backend(pid)` if needed. Many `idle in transaction` from one application means a session leak: restart that container. Falling cache hit after growth is a capacity signal (slice and host triggers, alert 6). Partition runway: `idraft maintenance-run ensure_partitions`, then re-ingest the failed tasks from R2 ([04](04-data-model.md) section 12.2).

<a id="rb-queue"></a>
### 11.6 Queues, Redis, rollup lag, alerting blind (alerts 11 to 13, 21, 39)

- **First checks:** which queue and workload? Is the worker consuming (tasks moving out of `pending` and `ready` in the ledger)? Provider paused (alert 23)?
- **Commands:** `idraft queue-counts`; `docker compose exec redis redis-cli --user admin --askpass INFO memory` (the default user is disabled, [22](22-infrastructure-devops.md) section 4.3); `docker compose logs --since 30m worker | grep '"level":"error"' | tail -50`.
- **Mitigation:** restart the worker; the reconciler re-enqueues lost work from the ledger. A burst from backfill or re-derivation: let it drain or pause its schedule. Redis above 80%: check that Taskiq results expire (`result_ex_time` on the result backend) and that no queue is growing; keep `noeviction`. After Redis loss the reconciler rebuilds in-flight work within 5 min. Alerting blind (the `ops-health` checks are late): `docker compose logs --since 30m worker | grep ops_health`, then the worker and Healthchecks status pages.

<a id="rb-collection"></a>
### 11.7 Schedule stuck, run overdue, dead tasks, stale data, maintenance missed (alerts 14 to 20, 42)

- **First checks:** `docker compose logs --since 15m worker | grep -E 'planner|dispatcher' | tail -100` (the planner tick runs inside the worker); run `budget_blocked`? Tasks stuck in `submitted` (provider slow) or `pending` (dispatcher not moving)?
  ```sql
  SELECT status, count(*), min(scheduled_for), max(attempts) FROM ops.collection_tasks
  WHERE run_id = $1 AND created_at >= date_trunc('month', now()) - interval '1 month' GROUP BY 1;
  ```
- **Mitigation:** restart the worker (always safe, [21](21-scheduler-workers.md) section 12). Group dead tasks by `last_error_code`: provider errors go to [rb-provider](#rb-provider), `schema_mismatch` to [rb-parser](#rb-parser). After the fix, requeue with `POST /api/v1/workspaces/{workspace_id}/tasks/{task_id}/requeue` ([19](19-api-specification.md) section 3.11.4) or `idraft tasks-requeue --run <id> --status dead`. Missed windows stay as visible gaps by design. A missed maintenance check: read the job's error in the worker log and run it by hand with `idraft maintenance-run <job>`.

<a id="rb-provider"></a>
### 11.8 Provider errors, auth or payment, R2 (alerts 22, 23, 37)

- **First checks:** which error kind and endpoint (Operations screen, Dead letters)? DataForSEO status page; balance and limits on the Operations screen; Cloudflare status for R2.
- **Mitigation:** `rate_limited` recovers through the halved limiter; persistent 40202 means our limiter is too high. `auth` or `payment` pauses the provider: fix credentials (GitHub environment, redeploy) or top up, then `idraft provider-resume dataforseo`; pending tasks resume without duplicate spend. 50301 is DataForSEO's upstream; the last 20% of each window is reserved for retries. R2 failures stop fetches because raw is written first; check token expiry and bucket permissions.

<a id="rb-spend"></a>
### 11.9 Balance, spend anomaly, budgets, reconciliation, LLM budget (alerts 24 to 28, 34)

- **First checks:** new keywords, prompts, replicates or depth profiles? Many retries (each creates a new provider task)?
  ```sql
  SELECT workload, project_id, sum(cost_usd) FROM ops.cost_daily
  WHERE cost_date >= current_date - 1 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;
  ```
- **Mitigation:** top up DataForSEO before runway drops below 5 days. A spike from one project: set its schedules `is_active = false` and contact the owner. A gap above 10% usually means unmodelled refunds or a price change: compare with `price_book_drift` and update the price book. LLM budget exhaustion is expected behavior (items stay `uncertain`).

<a id="rb-pingback"></a>
### 11.10 Pingback ratio

Removed. Readiness is polling only ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)); a slow `tasks_ready` poll shows as tasks stuck in `submitted` and is handled in [rb-collection](#rb-collection).

<a id="rb-parser"></a>
### 11.11 Schema mismatch and collection anomalies (alerts 29 to 33)

- **First checks:** which component and version? DataForSEO changelog? Open 3 failing raw payloads from Dead letters and diff against fixtures.
- **Mitigation:** fix the normalizer, bump its version in `ops.component_versions`, add the payload as a fixture, deploy, re-ingest from R2 (`idraft reingest --error schema_mismatch --since <date>`) at no provider cost. AIO drop across all projects: check sample `check_url`s by hand, then contact DataForSEO support, and note affected dates in `ops.component_versions`. New model string: confirm the boundary shows in charts.

<a id="rb-backup"></a>
### 11.12 Backup missed or restore drill overdue or failed (alerts 35, 36)

- **First checks:** `systemctl status seo-backup.service seo-backup.timer`; `journalctl -u seo-backup --since -1day`; Healthchecks log (exit status); latest object under `daily/` in R2 ([23](23-backup-disaster-recovery.md) section 7).
- **Mitigation:** `systemctl start seo-backup.service` and watch it finish. Common causes: expired R2 token, `pg_dump` waiting on a lock behind a migration. An overdue drill: a custodian runs it ([23](23-backup-disaster-recovery.md) section 8.3). For a failed drill, read which check failed; row drift after a retention drop can be legitimate, but a decrypt failure means the recovery identity and the recipients file disagree, and backups may be unrecoverable. Two consecutive missed backups make RPO 48 h: treat as P1 until a backup and a drill pass.

## 12. Cost and upgrade triggers

| Service | Plan | Cost | Limits | Expected V1 use |
|---|---|---|---|---|
| Sentry | Developer | $0 | 5,000 errors, 5 M spans, 1 user, 30 days | under 1,000 errors, about 1 M spans |
| Healthchecks.io | Hobbyist | $0 | 20 checks | 19 |
| Better Stack | Free | $0 | 10 monitors, 1 status page | 1 monitor |
| Total | | **$0 per month** | | |

Healthchecks checks: `planner-tick` (5 min; pinged only when the planner tick, dispatcher and reconciler all ran), `backup-nightly`, `restore-drill` (period 31 days, [23](23-backup-disaster-recovery.md) section 15), `host-health` (`seo-hostcheck.timer`, [22](22-infrastructure-devops.md) section 9.2), `ops-health-critical`, `ops-health`, `ops-health-hourly`, `dq-daily`, `cost-reconcile`, `balance-check`, `ensure-partitions`, `retention-drop`, `raw-retention`, `cost-rollup`, `analyze-hot-partitions`, `location-sync`, `price-book-drift`, `vuln-scan` (monthly from CI) and `firstparty-sync` (from Phase 12). That is 19 of the 20 free checks. The three pgBackRest checks ([23](23-backup-disaster-recovery.md) section 13.3) need the Business plan or merging the maintenance checks into one.

| Trigger | Action |
|---|---|
| A second engineer needs Sentry, or errors above 4,000 per month twice in a row | Sentry Team, from $26 per month (annual) |
| More than 20 Healthchecks checks (for example when pgBackRest is adopted) | Healthchecks Business, $20 per month, or merge maintenance checks |
| First external customer with a contractual SLA, or two P1s missed in a quarter | paid on-call paging (Better Stack paid tier or PagerDuty) |
| A second host, or a question the ledger and Sentry cannot answer twice in a quarter | revisit the no-metrics decision in [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) |

## 13. Changes required in other documents

| Doc | Change |
|---|---|
| [24](24-security.md) section 11 | Done: logs stay on the host, no external sink; redaction list shared with Sentry |
| [24](24-security.md) sections 2.1, 3 | Done: same-origin cookie, no CORS. The Operations screen needs a platform operator flag (`auth.users.is_platform_operator`); workspace roles do not cover platform-wide views |
| [04](04-data-model.md) section 11 | Add `ops.slo_samples (sampled_at, sli, scope, value)` with 90-day retention (section 2.1). Already there: `ops.maintenance_windows` (04 section 11.8), `ops.collection_tasks.ready_source`, `ops.collection_runs.origin_request_id`; `ops.platform_alerts` and `ops.quality_counters_daily` are listed in 04 section 15 |
| [21](21-scheduler-workers.md) section 10 | `ops_health` pings two checks (`ops-health-critical`, `ops-health`) and is the only notifier for SQL rules; the planner tick pings `planner-tick`; `ops_health_hourly` and `dq_daily` are listed |
| [22](22-infrastructure-devops.md) | Remove Alloy, `container-stats.sh`, the loopback metrics ports and Grafana alert silences; keep `seo-hostcheck.timer` and the per-service log options in section 3.4; the uptime check targets `https://<domain>/api/healthz` |
