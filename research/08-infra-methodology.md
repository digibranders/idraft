# 08: Infrastructure and Measurement Methodology

Research date: 2026-09-29. All URLs accessed 2026-09-29 unless stated.

Target stack: one DigitalOcean Basic Droplet (2 vCPU, 4 GB, 80 GB SSD, Ubuntu LTS) running PostgreSQL, Redis, a Node.js/TypeScript API, BullMQ workers and a scheduler under Docker Compose. Frontend on Vercel. Backups to Cloudflare R2.

Labels used:
- **VERIFIED**: read on the primary source at the URL given.
- **INFERRED**: my reasoning or arithmetic from verified facts, or common practice without a primary source fetched this session.
- **UNVERIFIED**: secondary source only, or the primary page failed.

---

## 0. Headline findings

1. **The $24 Droplet is still $24/mo** (2 vCPU, 4 GiB, 80 GiB SSD, 4,000 GiB transfer). Premium AMD/Intel at the same size is $28. VERIFIED.
2. **BullMQ 6.0.0 (2026-07-30) added an official PostgreSQL backend.** Same Queue/Worker/Flow API; Redis stays the default and "most battle-tested" option. Processing throughput on Postgres is roughly 1.5x to 2x lower than Redis per BullMQ's own figures. This makes "drop Redis entirely" a real option later. VERIFIED.
3. **BullMQ 6 removed the legacy `repeat` option.** Recurring jobs must use `upsertJobScheduler`. VERIFIED.
4. **WAL-G currently hangs on `wal-push` against R2** (issue #2550, opened 2026-09-10, open). Use pgBackRest or pg_dump for R2. VERIFIED.
5. **PostgreSQL 18.6 is current; PostgreSQL 19 is at Beta 4 (2026-09-24)** with GA expected October 2026. PG 19 switches `default_toast_compression` to `lz4`. On 18, set it yourself. VERIFIED.
6. **Official postgres Docker image 18+ changed PGDATA** to `/var/lib/postgresql/18/docker` and the volume to `/var/lib/postgresql`. Mount the parent directory. Default `/dev/shm` of 64 MB needs raising. VERIFIED.
7. **R2 has no S3 versioning or S3 Object Lock API**, but has its own **bucket locks** (age, date, indefinite; prefix scoped; override lifecycle deletes). VERIFIED.
8. **DigitalOcean Cloud Firewall is free and network-based**, so Docker's iptables rules cannot bypass it (unlike UFW). VERIFIED (free, network-based); the bypass-immunity is INFERRED from it being off-host.
9. **Statistics**: for per-prompt rates with small K, use Wilson (or Jeffreys). For aggregate visibility across prompts, treat the prompt as the cluster. With intra-prompt correlation near 0.5, adding prompts shrinks error far faster than adding replicates.

---

## 1. DigitalOcean

### 1.1 Droplet pricing (VERIFIED)

Source: https://www.digitalocean.com/pricing/droplets (values extracted from the page's embedded size catalog JSON). Per-second billing with a 60 second or $0.01 minimum applies from 2026-01-01 (same page).

| Plan | Slug | vCPU | RAM | SSD | Transfer | $/hr | $/mo |
|---|---|---|---|---|---|---|---|
| Basic Regular | s-2vcpu-4gb | 2 | 4 GiB | 80 GiB | 4,000 GiB | 0.03571 | **24** |
| Basic Premium AMD | s-2vcpu-4gb-amd | 2 | 4 GiB | 80 GiB | 4,000 GiB | 0.04167 | 28 |
| Basic Premium Intel | s-2vcpu-4gb-intel | 2 | 4 GiB | 80 GiB | 4,000 GiB | 0.04167 | 28 |
| Basic Premium Intel | s-2vcpu-4gb-120gb-intel | 2 | 4 GiB | 120 GiB | 4,000 GiB | 0.04762 | 32 |
| Basic Premium AMD | s-2vcpu-8gb-amd | 2 | 8 GiB | 100 GiB | 5,000 GiB | 0.0625 | 42 |
| Basic Regular | s-4vcpu-8gb | 4 | 8 GiB | 160 GiB | 5,000 GiB | 0.07143 | **48** |
| Basic Premium AMD | s-4vcpu-8gb-amd | 4 | 8 GiB | 160 GiB | 5,000 GiB | 0.08333 | 56 |
| Basic Premium Intel | s-4vcpu-8gb-intel | 4 | 8 GiB | 160 GiB | 5,000 GiB | 0.08333 | 56 |
| Basic Premium AMD | s-4vcpu-16gb-amd | 4 | 16 GiB | 200 GiB | 8,000 GiB | 0.125 | 84 |
| Basic Regular | s-8vcpu-16gb | 8 | 16 GiB | 320 GiB | 6,000 GiB | 0.14286 | **96** |
| Basic Premium AMD | s-8vcpu-16gb-amd | 8 | 16 GiB | 320 GiB | 6,000 GiB | 0.16667 | 112 |
| Basic Premium Intel | s-8vcpu-16gb-intel | 8 | 16 GiB | 320 GiB | 6,000 GiB | 0.16667 | 112 |
| General Purpose | g-2vcpu-8gb | 2 | 8 GiB | 25 GiB | 4,000 GiB | 0.09375 | 63 |
| General Purpose (NVMe) | gd-2vcpu-8gb | 2 | 8 GiB | 50 GiB | 4,000 GiB | 0.10119 | 68 |
| General Purpose | g-4vcpu-16gb | 4 | 16 GiB | 50 GiB | 5,000 GiB | 0.1875 | 126 |
| General Purpose (NVMe) | gd-4vcpu-16gb | 4 | 16 GiB | 100 GiB | 5,000 GiB | 0.20238 | 136 |

Notes:
- Basic = shared vCPU. General Purpose = dedicated vCPU. The "8 GB / 16 GB" line in the brief maps to s-8vcpu-16gb ($96) or g-4vcpu-16gb ($126). INFERRED mapping.
- Upgrade path from $24 is $48 (double everything). Resizing CPU/RAM only (without disk) keeps the option to downsize later. INFERRED from DO resize behaviour; not re-verified this session.

### 1.2 Bandwidth, Volumes, Backups, Snapshots, Firewall

| Item | Price | Status / source |
|---|---|---|
| Outbound transfer overage | $0.01 per GiB | VERIFIED https://docs.digitalocean.com/products/droplets/details/pricing/ |
| Volumes (block storage) | $0.10 per GiB-month, 1 GiB to 16 TiB, billed while it exists (attached or not) | VERIFIED https://docs.digitalocean.com/products/volumes/details/pricing/ |
| Droplet snapshots | $0.06 per GB-month | VERIFIED https://www.digitalocean.com/pricing/droplets |
| Backups, percentage plans | Weekly 20% of Droplet price; Daily 30% | VERIFIED https://docs.digitalocean.com/products/backups/details/pricing/ |
| Backups, usage-based plans | Weekly $0.04, Daily $0.03, 12-hourly $0.02, 6-hourly $0.015, 4-hourly $0.01 per GiB-month (as printed; the ordering looks counter-intuitive, likely tied to retention differences, check before relying) | VERIFIED text, interpretation UNVERIFIED |
| Cloud Firewall | Free: "a network-based, stateful firewall service for Droplets provided at no additional cost" | VERIFIED https://docs.digitalocean.com/products/networking/firewalls/details/pricing/ |

For reference: daily DO backups on the $24 Droplet = $7.20/mo, weekly = $4.80/mo. INFERRED arithmetic. They are crash-consistent disk images and are not a substitute for database-aware backups. INFERRED.

### 1.3 Ubuntu images (VERIFIED)

Source: https://docs.digitalocean.com/products/droplets/details/images/

DO offers Ubuntu **22.04 LTS, 24.04 LTS and 26.04 LTS** (x64). No interim releases listed.

Ubuntu 26.04 LTS "Resolute Raccoon" released 2026-04-23, 5 years of maintenance updates (to April 2031). VERIFIED https://lists.ubuntu.com/archives/ubuntu-announce/2026-April/000323.html. It ships OpenSSH 10.2p1 per secondary sources (UNVERIFIED).

Docker Engine officially supports Ubuntu 26.04, 24.04 and 22.04. VERIFIED https://docs.docker.com/engine/install/ubuntu/

Recommendation (INFERRED): **Ubuntu 26.04 LTS** for a new build (Docker supported, longest runway, newer OpenSSH with `PerSourcePenalties`). Pick 24.04 only if a required package is not yet available for 26.04.

---

## 2. Cloudflare R2

### 2.1 Pricing (VERIFIED)

Source: https://developers.cloudflare.com/r2/pricing/ (page "Last updated Aug 7, 2026").

| | Standard | Infrequent Access |
|---|---|---|
| Storage | $0.015 / GB-month | $0.01 / GB-month |
| Class A ops | $4.50 / million | $9.00 / million |
| Class B ops | $0.36 / million | $0.90 / million |
| Data retrieval | None | $0.01 / GB |
| Egress | Free | Free |
| Minimum storage duration | None | 30 days |

Free tier (Standard only, monthly): 10 GB-month storage, 1 million Class A, 10 million Class B, egress free.

Billing rounds **up** to the next unit (1.1 GB-month billed as 2).

- Class A: ListBuckets, PutBucket, ListObjects, PutObject, CopyObject, CompleteMultipartUpload, CreateMultipartUpload, LifecycleStorageTierTransition, ListMultipartUploads, UploadPart, UploadPartCopy, ListParts, PutBucketEncryption, PutBucketCors, PutBucketLifecycleConfiguration.
- Class B: HeadBucket, HeadObject, GetObject, UsageSummary, GetBucketEncryption, GetBucketLocation, GetBucketCors, GetBucketLifecycleConfiguration.
- Free: DeleteObject, DeleteBucket, AbortMultipartUpload.

Cost model for us (INFERRED): 30 GB of backups in Standard = (30 - 10) x $0.015 = $0.30/mo. A nightly dump plus a few thousand WAL segment uploads a month stays inside the 1 M Class A free tier. Do **not** put backups in Infrequent Access: restores pay retrieval, IA has no free tier, and a 30-day minimum applies.

### 2.2 Lifecycle rules (VERIFIED)

Source: https://developers.cloudflare.com/r2/buckets/object-lifecycles/

- Actions: delete after N days (or date), transition Standard to Infrequent Access, abort incomplete multipart uploads.
- "Objects will typically be removed from a bucket within 24 hours" of expiration.
- Max 1,000 rules per bucket. Default rule: abort multipart uploads 7 days after initiation.
- If a transition and an expiry fall in the same 24 h, expiry wins.
- Wrangler: `wrangler r2 bucket lifecycle add|set|list|remove`.
- Also settable via S3 `PutBucketLifecycleConfiguration` (marked supported in the S3 compatibility table). VERIFIED https://developers.cloudflare.com/r2/api/s3/api/

### 2.3 Bucket locks (VERIFIED)

Source: https://developers.cloudflare.com/r2/buckets/bucket-locks/

- "Bucket locks prevent the deletion and overwriting of objects in an R2 bucket for a specified period, or indefinitely."
- Modes: age-based, date-based, indefinite. Prefix-scoped; no prefix means whole bucket. Applies to new and existing objects.
- Bucket lock beats lifecycle: a 30-day lifecycle delete under a 90-day lock waits for 90 days.
- Up to 1,000 rules per bucket; strictest rule wins.
- Wrangler: `wrangler r2 bucket lock add|set|list|remove`.

### 2.4 S3 compatibility (VERIFIED)

Source: https://developers.cloudflare.com/r2/api/s3/api/

- Region: `auto` (`""` and `us-east-1` also map to it).
- Not supported: ACLs, SSE-KMS / `x-amz-server-side-encryption`, **object versioning** (Get/PutBucketVersioning), **S3 Object Lock** (Get/PutObjectLockConfiguration, `x-amz-object-lock-*`), object tagging, legal hold, request payer.
- Supported: SSE-C, conditional requests (If-Match / If-None-Match on PutObject/GetObject/HeadObject), multipart, CopyObject, lifecycle configuration.
- Storage classes: only `STANDARD` and `STANDARD_IA`.
- Checksums: CRC-64/NVME supports FULL_OBJECT; CRC-32, CRC-32C, SHA-1, SHA-256 support COMPOSITE only.

### 2.5 Design implication for backups (INFERRED)

- R2 lacks versioning, so a leaked read/write token can delete or overwrite backups. Protection = **bucket lock** on the backup prefix + client-side encryption + a token scoped to one bucket.
- Bucket locks and pgBackRest's own `expire` conflict: pgBackRest will fail to delete locked files. Either keep lock age <= pgBackRest retention window, or lock only a separate prefix (for example `logical/` for nightly pg_dump files) and let pgBackRest manage `pgbackrest/` without a lock.
- Never put a lifecycle delete rule on a pgBackRest or WAL-G repository path: deleting WAL out from under the tool breaks PITR silently.

---

## 3. PostgreSQL

### 3.1 Versions (VERIFIED)

Source: https://www.postgresql.org/support/versioning/

| Major | Current minor | First release | EOL |
|---|---|---|---|
| 18 | 18.6 | 2025-09-25 | 2030-11-14 |
| 17 | 17.11 | 2024-09-26 | 2029-11-08 |
| 16 | 16.15 | 2023-09-14 | 2028-11-09 |
| 15 | 15.19 | 2022-10-13 | 2027-11-11 |
| 14 | 14.24 | 2021-09-30 | 2026-11-12 |

PostgreSQL 19: Beta 4 released 2026-09-24; release notes page shows date "2026-??-??". VERIFIED https://www.postgresql.org/docs/19/release-19.html and https://www.postgresql.org/about/news/postgresql-19-beta-4-released-3386/ (search result). GA "planned for October 2026" per search summaries (UNVERIFIED).

**Recommendation (INFERRED): start on PostgreSQL 18.** Move to 19 after 19.1 or 19.2 (typically a few months after GA). The official image layout change in 18 makes `pg_upgrade --link` easier later.

### 3.2 PostgreSQL 18 features that matter to us (VERIFIED)

Source: https://www.postgresql.org/about/news/postgresql-18-released-3142/ and https://www.postgresql.org/docs/18/runtime-config-resource.html

| Feature | Detail | Why we care |
|---|---|---|
| Async I/O | New `io_method` = `worker` (default), `io_uring` (needs `--with-liburing`), `sync`. `io_workers` default 3. Up to 3x faster reads in PG's claim. Covers seq scans, bitmap heap scans, vacuum. | Faster analytics scans over run history. Keep `worker` in Docker (see note). |
| `uuidv7()` | Timestamp-ordered UUIDs | Use as PK: index locality like bigserial, globally unique IDs usable in URLs. |
| Virtual generated columns | Now the **default** kind for generated columns (computed at read). Use `STORED` explicitly when you want to index it. | Derived fields (for example registrable domain from URL) without storage, but index needs STORED. |
| Skip scan | Multicolumn B-tree usable when leading column has no `=` condition | Fewer indexes needed on (project_id, engine, created_at) style keys. |
| OLD/NEW in RETURNING | For INSERT/UPDATE/DELETE/MERGE | Cheap audit/diff of changed rows. |
| Temporal constraints | `WITHOUT OVERLAPS` on PK/UNIQUE, `PERIOD` on FK | Optional for plan/subscription periods. |
| Stats kept across `pg_upgrade` | Planner stats survive major upgrade | Faster post-upgrade recovery. |
| Data checksums on by default | New `initdb` clusters have page checksums | Corruption detection; nothing to configure. |
| `effective_io_concurrency` default 16 | Per docs | Fine for SSD. |

Docker note (INFERRED, not verified this session): Docker's default seccomp profile has blocked `io_uring` syscalls since 2023, so `io_method=io_uring` in a container would need a custom seccomp profile. Stay on `worker`.

### 3.3 PostgreSQL 19 items worth tracking (VERIFIED from beta release notes)

Source: https://www.postgresql.org/docs/19/release-19.html

- Default TOAST compression changes from `pglz` to **`lz4`**.
- `REPACK` command replaces `VACUUM FULL` and `CLUSTER`; `REPACK CONCURRENTLY` rebuilds tables without an access-exclusive lock (removes the need for pg_repack).
- Parallel autovacuum (`autovacuum_max_parallel_workers`, per-table `autovacuum_parallel_workers`).
- `io_method=worker` auto-scales workers (`io_min_workers`, `io_max_workers`, ...).
- `COPY TO ... (FORMAT json)` output.
- `max_locks_per_transaction` default 64 to 128 (relevant with many partitions).
- `pg_dump` can include restorable extended statistics.
- Casts between `bytea` and `uuid`.

### 3.4 Declarative partitioning best practice (VERIFIED)

Source: https://www.postgresql.org/docs/18/ddl-partitioning.html

- Partition by the column(s) most used in `WHERE` so pruning works.
- "The query planner is generally able to handle partition hierarchies with up to a few thousand partitions fairly well, provided that typical queries allow the query planner to prune all but a small number of partitions."
- Each partition's metadata is loaded into each session that touches it, so memory grows with partitions touched.
- `ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY` needs only `SHARE UPDATE EXCLUSIVE` on the parent.

Our sizing (INFERRED): at MVP volumes (tens of millions of rows), **monthly range partitions on `created_at`** for the raw-run and citation tables give 12 to 36 live partitions. Retention = `DROP`/`DETACH` old partitions instead of `DELETE` (no bloat, no vacuum storm). Do not partition small tables (projects, prompts, brands).

### 3.5 pg_partman (VERIFIED)

Sources: https://github.com/pgpartman/pg_partman, https://github.com/pgpartman/pg_partman/blob/master/doc/pg_partman.md, GitHub releases API.

- Latest release: **v5.5.0 (2026-07-22)**. Requires PostgreSQL >= 14. 5.x supports native declarative partitioning only.
- `create_parent(p_parent_table, p_control, p_interval, p_type DEFAULT 'range', ..., p_premake DEFAULT 4, p_default_table DEFAULT true, ...)`.
- Retention via `part_config.retention` (interval); by default old children are detached, not dropped; set `retention_keep_table = false` to drop.
- Maintenance by `pg_partman_bgw` (in `shared_preload_libraries`; `pg_partman_bgw.interval` default 3600 s) or by calling `CALL partman.run_maintenance_proc()` from cron.
- A default partition catches out-of-range rows; `check_default()` monitors it.

Docker note (INFERRED): the official `postgres` image does not bundle pg_partman. Either build a small image (`FROM postgres:18` + `apt-get install postgresql-18-partman` from PGDG) or skip the extension and create next month's partition from the BullMQ scheduler with plain SQL. For 1 to 3 partitioned tables, the scheduler job is simpler.

### 3.6 BRIN for time series (VERIFIED)

Source: https://www.postgresql.org/docs/18/brin.html

- BRIN is "designed for handling very large tables in which certain columns have some natural correlation with their physical location within the table", for example insert-ordered timestamps.
- Stores min/max per block range; `pages_per_range` default 128 (INFERRED from knowledge; page quotes the trade-off but the number was not in the fetched summary).
- `autosummarize` is **off by default**; turn it on for append-only tables.

Use (INFERRED): `CREATE INDEX ON runs USING brin (created_at) WITH (autosummarize = on);` on append-only history tables. Keep B-tree for `(project_id, created_at)` lookups; BRIN is for wide date-range scans. With monthly partitions, BRIN adds little; it helps most if you skip partitioning.

### 3.7 TimescaleDB licensing (VERIFIED)

Source: https://www.tigerdata.com/docs/about/latest/timescaledb-editions (old docs.timescale.com URL 301-redirects there). Latest release 2.30.1 (2026-09-17, GitHub API).

| Edition | License | Includes |
|---|---|---|
| Apache 2.0 | Apache 2.0 | hypertables, `create_hypertable`, `drop_chunks`, `time_bucket`, basic hyperfunctions |
| Community | Timescale License (TSL) | Hypercore columnstore (compression), continuous aggregates, retention policies, job scheduler, advanced hyperfunctions |

- "You can install TimescaleDB Community Edition in your own on-premises or cloud infrastructure and run it for free."
- "You cannot sell TimescaleDB Community Edition as a service."

Assessment (INFERRED): self-hosting TSL features inside our own SaaS is allowed (we sell an SEO tool, not a database service). But it adds an extension to upgrade in lockstep with Postgres majors. For our scale, native partitioning plus a few rollup tables is enough; revisit if raw-run history passes roughly 100 M rows.

### 3.8 Memory tuning for 4 GB shared host

PG guidance (VERIFIED):
- `shared_buffers`: "a reasonable starting value ... is 1/4 of the memory"; docs say up to 40%. Default 128 MB. https://www.postgresql.org/docs/18/runtime-config-resource.html and https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server
- `effective_cache_size`: 1/2 of RAM conservative, 3/4 aggressive. (wiki)
- `work_mem` default 4 MB, per sort/hash node, multiplied by concurrency; `hash_mem_multiplier` default 2.0. `maintenance_work_mem` default 64 MB; `autovacuum_work_mem` -1 falls back to it.
- `max_connections`: "a few hundred" fine; thousands need pooling. (wiki)

Because Postgres shares 4 GB with Redis, three Node processes, Caddy and monitoring, use about 20% instead of 25% for `shared_buffers`. INFERRED.

**RAM budget (INFERRED):**

| Component | Budget |
|---|---|
| Kernel, systemd, Docker daemon, sshd | ~350 MB |
| Caddy | ~40 MB |
| PostgreSQL shared_buffers | 768 MB |
| PostgreSQL backends (about 30 x 5 to 10 MB) + work_mem headroom | ~300 MB |
| Redis `maxmemory` 256 MB + fork copy-on-write headroom | ~450 MB |
| Node API (`--max-old-space-size=384`) | ~450 MB RSS |
| BullMQ worker process (`--max-old-space-size=512`) | ~600 MB RSS |
| Scheduler (`--max-old-space-size=128`) | ~180 MB |
| Beszel agent | ~30 MB |
| Remaining for OS page cache | ~0.9 GB |
| Swap file | 2 GB, `vm.swappiness=10` |

`postgresql.conf` starting point (INFERRED from the verified guidance above):

```conf
# memory
shared_buffers = 768MB
effective_cache_size = 1536MB
work_mem = 8MB
hash_mem_multiplier = 2.0
maintenance_work_mem = 128MB
autovacuum_work_mem = 64MB
max_connections = 50
# WAL / checkpoints
wal_compression = zstd          # PG15+ supports lz4/zstd for full page writes (VERIFIED in 15 release notes)
max_wal_size = 2GB
min_wal_size = 256MB
checkpoint_completion_target = 0.9
# planner, SSD
random_page_cost = 1.1
effective_io_concurrency = 16   # PG18 default
# I/O
io_method = worker              # PG18 default
# TOAST
default_toast_compression = lz4 # PG19 default; set explicitly on 18
# observability
shared_preload_libraries = 'pg_stat_statements'
log_min_duration_statement = 500ms
log_autovacuum_min_duration = 10s
# jobs table churn (if BullMQ Postgres backend or pg-boss is used)
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.05
```

**PgBouncer? Not at launch.** (INFERRED) Connection count: API pool 10, worker pool 10, scheduler 3, admin/migrations 5, monitoring 2 = about 30, under `max_connections = 50`. Add PgBouncer 1.26 (latest, 2026-09-23) only if you add serverless callers (for example Vercel functions hitting Postgres directly). Transaction mode breaks `SET`, `LISTEN`, session advisory locks, `WITH HOLD` cursors; protocol-level prepared statements work if `max_prepared_statements` > 0; about 2 kB per connection. VERIFIED https://www.pgbouncer.org/features.html. Note that BullMQ's Postgres backend and pg-boss both use `LISTEN`, so they must connect directly, not through transaction-mode PgBouncer. INFERRED.

### 3.9 Docker specifics for the official image (VERIFIED)

Source: https://github.com/docker-library/docs/blob/master/postgres/content.md

- PG 18+: `PGDATA=/var/lib/postgresql/18/docker`, `VOLUME /var/lib/postgresql`. Mount the volume at `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`.
- "the default `/dev/shm` size for containers is 64MB". Exhaustion gives `could not resize shared memory segment`. Set `shm_size: 256mb` in Compose.
- `POSTGRES_INITDB_ARGS` passes initdb flags (checksums are already default on 18).

### 3.10 JSONB, TOAST and row size

VERIFIED (https://www.postgresql.org/docs/18/storage-toast.html, https://www.postgresql.org/docs/18/storage-page-layout.html, https://www.postgresql.org/docs/18/runtime-config-client.html):
- TOAST triggers when a row exceeds `TOAST_TUPLE_THRESHOLD` (about 2 kB); compresses/moves values until the row is under `TOAST_TUPLE_TARGET` (2 kB, per-table `toast_tuple_target`).
- Strategies PLAIN / EXTENDED (default for jsonb/text) / EXTERNAL / MAIN. Max field 1 GB.
- `default_toast_compression`: `pglz` (default on 18) or `lz4` (needs `--with-lz4`). Per column: `ALTER TABLE t ALTER COLUMN c SET COMPRESSION lz4;` (affects new values only).
- Page 8 kB; page header 24 bytes; line pointer 4 bytes per row; heap tuple header 23 bytes (padded to 24 with MAXALIGN 8), plus null bitmap when any column is null.

Row size estimates (INFERRED arithmetic):

| Table | Columns (approx.) | Bytes per row incl. header and line pointer |
|---|---|---|
| `citations` | uuidv7 id 16, run_id 16, project_id 8, position int2 2, domain_id 8, url_id 8, created_at 8, flags 4 | ~24 + 70 + 4 = **~100 B** heap; with 2 B-tree indexes about 180 B total |
| `mentions` | id 16, run_id 16, brand_id 8, position 2, sentiment 2, created_at 8 | ~80 B heap |
| `runs` (metadata only) | id 16, prompt_id 8, engine 2, model text ~20, status 2, tokens 8, cost numeric ~8, timestamps 16 | ~110 B heap |
| `run_payloads` (raw answer + sources JSONB) | 4 to 20 kB raw text/JSON | TOASTed; lz4 or pglz typically 2x to 4x on prose/JSON (INFERRED, measure with `pg_column_size()`) |

Storage projection (INFERRED): 1,000 prompts x 4 engines x 3 replicates x daily = 12,000 runs/day. At ~6 kB compressed payload per run that is ~72 MB/day or ~2.2 GB/month of payload, plus ~15 citations per run x 180 B = ~32 MB/day. The 80 GB disk lasts well over a year at that rate if raw payloads older than 90 days are moved to R2 as compressed JSONL and dropped from Postgres. Keep payloads in a separate table from hot metadata so scans on `runs` do not touch TOAST.

---

## 4. Backups

### 4.1 pg_dump (VERIFIED)

Source: https://www.postgresql.org/docs/18/app-pgdump.html; PG16 release notes https://www.postgresql.org/docs/release/16.0/

- `-Z/--compress` = `gzip`, `lz4`, `zstd` or `none`, with detail `level=N` and, for zstd, `long`. LZ4 and Zstandard for pg_dump were added in **PostgreSQL 16**.
- Formats: `-Fc` custom (compressed by default, selective restore), `-Fd` directory (compressed by default, the only format supporting `-j` parallel dump), `-Ft` tar (no compression), `-Fp` plain.
- `-j N` works only with directory format.

Nightly logical backup, streamed (no local temp file), encrypted, uploaded (INFERRED script built from verified flags):

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
HC="https://hc-ping.com/${HC_UUID}"
curl -fsS -m 10 --retry 3 "${HC}/start" >/dev/null || true
docker compose exec -T postgres \
  pg_dump -U app -d app -Fc -Z zstd:level=6 \
| age -R /etc/backup/age-recipients.txt \
| rclone rcat --s3-no-check-bucket "r2:app-backups/logical/daily/app-${TS}.dump.age"
rc=$?
curl -fsS -m 10 --retry 3 "${HC}/${rc}" >/dev/null
```

`pipefail` makes a pg_dump failure fail the pipeline; the Healthchecks ping carries the exit status.

### 4.2 Physical backup + PITR tools

| Tool | Latest (GitHub, 2026-09-29) | R2 status | Notes |
|---|---|---|---|
| **pgBackRest** | 2.59.2 (2026-09-27) | Works; restore is slow with many small files in bundles (issue #2782 asks for bundle-level caching) | S3 repo with `repo1-s3-uri-style=path`, compression `zst`/`lz4`/`gz`/`bz2` (default gz), built-in `aes-256-cbc` encryption, full/diff/incr, block incremental (`repo-block`), async archiving, `verify` command. |
| **WAL-G** | v3.0.9 (2026-08-20) | **Broken**: `wal-push` hangs against R2 (issue #2550, open, "help wanted") | Root cause per issue: uploader sends `X-Amz-Content-Sha256` plus `Content-MD5`; R2 never responds. |
| **Barman (barman-cloud)** | 3.20.0 (2026-08-27) | Works via boto3 with `--endpoint-url`; Barman states it does not directly support third-party S3 vendors | Per search result, `barman-cloud-backup` lacks lz4/xz/zstd for base backups (WAL archive supports them). Python/boto3 dependency inside the Postgres container. |

Sources (VERIFIED): https://pgbackrest.org/configuration.html, https://github.com/wal-g/wal-g/issues/2550, https://github.com/pgbackrest/pgbackrest/issues/2782. Barman compression note from https://github.com/cloudnative-pg/barman-cloud/issues/88 and docs.pgbarman.org search snippet (UNVERIFIED; the direct docs URL returned 404).

PostgreSQL 17 also added native incremental base backups (`pg_basebackup --incremental`, `pg_combinebackup`, `summarize_wal`). VERIFIED https://www.postgresql.org/docs/release/17.0/. This is a DIY option but has no retention or object-store handling.

pgBackRest config for R2 (INFERRED from verified option names):

```ini
[global]
repo1-type=s3
repo1-s3-endpoint=<ACCOUNT_ID>.r2.cloudflarestorage.com
repo1-s3-bucket=app-backups
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-s3-key=<R2_ACCESS_KEY_ID>
repo1-s3-key-secret=<R2_SECRET>
repo1-path=/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=<long random secret, stored offline too>
repo1-retention-full-type=count
repo1-retention-full=4          # 4 weekly fulls
repo1-retention-diff=7          # daily diffs
repo1-bundle=y
repo1-block=y
compress-type=zst
compress-level=3
archive-async=y
process-max=2
start-fast=y
spool-path=/var/spool/pgbackrest

[app]
pg1-path=/var/lib/postgresql/18/docker
```

```conf
# postgresql.conf
archive_mode = on
archive_command = 'pgbackrest --stanza=app archive-push %p'
archive_timeout = 300          # bound RPO to 5 min on quiet systems
```

Docker caveat (INFERRED): `archive_command` runs inside the Postgres container, so the pgBackRest binary must be in that image. Build `FROM postgres:18` + `apt-get install pgbackrest` (PGDG). Run `backup` via `docker compose exec` from host cron or the scheduler.

**Phased recommendation (INFERRED):**
1. Launch: nightly `pg_dump -Fc -Z zstd` + age + rclone to R2 (RPO 24 h, simple, restorable into any PG >= 18).
2. When customer data matters: add pgBackRest for PITR (RPO minutes), keep the nightly logical dump as an independent second path.

### 4.3 rclone to R2 (VERIFIED)

Source: https://rclone.org/s3/ (Cloudflare R2 section). Latest rclone v1.75.1 (2026-09-04).

```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = <KEY>
secret_access_key = <SECRET>
region = auto
endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
```

- "For R2 tokens with the 'Object Read & Write' permission, you may also need to add `no_check_bucket = true`."
- R2 decompresses objects uploaded with `Content-Encoding: gzip` unless uploaded with `Cache-Control: no-transform`. Irrelevant for `.dump.age` files (no content-encoding set). INFERRED.

### 4.4 age vs gpg (VERIFIED for age features)

Source: https://github.com/FiloSottile/age (latest v1.3.2, 2026-08-29), spec https://age-encryption.org/v1

- age: small explicit keys (X25519 `age1...`), SSH Ed25519/RSA recipients, **post-quantum hybrid ML-KEM-768 + X25519 recipients since v1.3.0** (`age1pq1...`), multiple recipients via `-R file`, passphrase mode via scrypt, streaming (`tar | age -r ... > x.age`), no config options.
- gpg: works, but has keyrings, trust model and many options (INFERRED comparison). Redis docs themselves suggest `gpg -c` for RDB snapshots (VERIFIED https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/), which is fine but heavier.

Recommendation (INFERRED): **age with two recipients**: a server-side public key only (the private key never lives on the Droplet) plus an offline recovery key kept in a password manager. The Droplet can encrypt but cannot decrypt, so a compromised host cannot read old backups.

### 4.5 Restore testing and retention

Restore testing (INFERRED practice; no single primary source):
- Weekly automated restore drill: a scheduler job pulls the latest dump from R2, decrypts with a restore-only key held in a separate secret, runs `pg_restore -j 2` into a throwaway `postgres:18` container, runs sanity queries (row counts per table within X% of prod, latest `created_at` within 26 h), then destroys it. Ping a separate Healthchecks check. Run it on a different host (for example a CI runner) so the recovery key never touches prod.
- For pgBackRest: `pgbackrest verify` plus a quarterly PITR drill to a timestamp.
- Record RTO measured, not assumed.

GFS retention (INFERRED convention; "grandfather-father-son"):

| Tier | Keep | Implementation |
|---|---|---|
| Daily | 7 | `logical/daily/` + R2 lifecycle delete after 8 days |
| Weekly | 4 to 5 | copy Sunday dump to `logical/weekly/`, lifecycle delete after 35 days |
| Monthly | 12 | copy 1st-of-month dump to `logical/monthly/`, lifecycle delete after 400 days |
| Lock | 7 days on `logical/` | R2 bucket lock age rule, so a stolen token cannot wipe the last week |

`rclone copyto` inside R2 is a server-side CopyObject (one Class A op). INFERRED.

---

## 5. Redis, Valkey, BullMQ, and Postgres-native queues

### 5.1 Licensing (VERIFIED)

Source: https://redis.io/legal/licenses/ ; GitHub license API.

| Version | License |
|---|---|
| Redis <= 7.2 | BSD-3-Clause |
| Redis 7.4 | RSALv2 or SSPLv1 |
| Redis >= 8.0 ("Redis Open Source") | RSALv2 or SSPLv1 **or AGPLv3** (tri-license) |
| Valkey (Linux Foundation fork of 7.2.4) | BSD-3-Clause |

Latest: Redis **8.10.2** (2026-09-17), Valkey **9.1.2** (2026-09-01). VERIFIED via GitHub releases API.

Assessment (INFERRED): running unmodified Redis 8 as a private backing service under AGPLv3 creates no source-disclosure obligation for our app because users never interact with Redis over the network. Valkey (BSD) removes the question entirely. BullMQ documents Redis-compatible hosts in `docs/gitbook/guide/redis-tm-compatibility/` (only a Dragonfly page is listed there; Valkey compatibility not re-verified this session). Either is fine; pick **Valkey 9** if legal review prefers BSD, else Redis 8.

Redis 8.10 added a `BACKUP START/LIST/SEAL/CLEANUP` command family for online backups. VERIFIED persistence page.

### 5.2 Redis config for BullMQ (VERIFIED guidance + INFERRED values)

VERIFIED:
- BullMQ: `maxmemory-policy` must be `noeviction`; enable AOF, "1 second per write is enough for most applications"; Workers need `maxRetriesPerRequest: null`; Queues (producers) should disable `enableOfflineQueue` to fail fast; handle SIGINT/SIGTERM and `await worker.close()`. https://docs.bullmq.io/guide/going-to-production
- Redis: `appendfsync everysec` is default and suggested; use RDB and AOF together for PostgreSQL-like safety; Redis 7+ uses multi-part AOF. https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
- Redis admin: `vm.overcommit_memory = 1`; disable Transparent Huge Pages; set explicit `maxmemory`; during RDB save or AOF rewrite a write-heavy Redis can use up to 2x memory; enable swap. https://redis.io/docs/latest/operate/oss_and_stack/management/admin/

`redis.conf` (INFERRED values):

```conf
bind 0.0.0.0              # inside the compose network only; never publish 6379
protected-mode yes
requirepass ${REDIS_PASSWORD}
maxmemory 256mb
maxmemory-policy noeviction
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
save 900 1 300 100        # keep RDB too
```

Host sysctl: `vm.overcommit_memory=1`. THP: `echo never > /sys/kernel/mm/transparent_hugepage/enabled` (via a systemd unit).

### 5.3 BullMQ current state (VERIFIED)

Sources: GitHub releases API; https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/changelog.md; docs pages cited per row.

- Latest Node release **v6.3.10 (2026-09-29)**. **v6.0.0 released 2026-07-30.**
- v6 breaking changes (selected): pluggable backends (`IQueueBackend`, Redis and **PostgreSQL**); `Connection` constructor param replaced by `BackendFactory`; legacy repeatable jobs removed (`repeat` option, `Repeat` class, `getRepeatableJobs`, `removeRepeatable*`); `debounce` option removed (use `deduplication`); `Job#discard()` removed (throw `UnrecoverableError`); **ioredis now an optional peer dependency** (install it explicitly); `paused` state removed from `getJobCounts()`; `Worker#resume()` is async; `RepeatOptions` drops `utc` (use `tz: 'UTC'`).

| Feature | Status | Source |
|---|---|---|
| Priorities | Core (OSS) | docs.bullmq.io/guide/jobs/prioritized (not fetched; listed as core in PG backend parity list) |
| Global rate limiter | Core (OSS) | https://docs.bullmq.io/guide/rate-limiting (listed in PG backend parity) |
| Flows (parent/child) | Core; v6 forbids deduplication on parent nodes | changelog |
| Job Schedulers | `queue.upsertJobScheduler(id, {every | pattern, tz, limit, startDate, endDate, immediately}, {name, data, opts})`; plus `removeJobScheduler`, `getJobSchedulers` | https://docs.bullmq.io/guide/job-schedulers |
| Deduplication | Simple (`{id}` until job completes/fails), Throttle (`{id, ttl}`), Debounce (`{id, ttl, extend: true, replace: true}` + `delay`) | https://docs.bullmq.io/guide/jobs/deduplication |
| Stalled jobs | Checked every 30 s by default; `maxStalledCount` default 1; beyond that the job fails with "job stalled more than allowable limit"; no "stalled" state, only an event | https://docs.bullmq.io/guide/jobs/stalled |
| Auto-removal | `removeOnComplete` / `removeOnFail` (count or `{age, count}`) | going-to-production page |
| **Groups** (per-group concurrency, rate limit, round-robin, max group size, pause) | **BullMQ Pro only** (`QueuePro`/`WorkerPro`) | https://docs.bullmq.io/bullmq-pro/groups |

Scheduler example for our stack (INFERRED from verified API):

```ts
await visibilityQueue.upsertJobScheduler(
  `daily-run:${projectId}`,
  { pattern: '0 0 6 * * *', tz: 'UTC' },
  { name: 'run-prompt-set', data: { projectId }, opts: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: { age: 7 * 24 * 3600, count: 5000 }, removeOnFail: { age: 30 * 24 * 3600 } } },
);
```

Fairness across tenants without Pro Groups (INFERRED): one queue per engine with a global rate limiter matching the provider's RPM; enqueue each project's daily batch with `addBulk` interleaved round-robin by project, or use priorities by plan tier.

### 5.4 BullMQ PostgreSQL backend (VERIFIED)

Source: https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/postgresql.md

- Requires PostgreSQL 13+ (14+ recommended) and the `pg` package. Select with `createPostgresBackend` or `withBackend(createPostgresBackend)`.
- Lives in schema `bullmq`; migrations are explicit via `runMigrations(client)`, idempotent, advisory-lock protected; **no schema downgrades**.
- Uses tables + SQL functions for state transitions, `LISTEN/NOTIFY` for blocking waits; each backend holds a `pg.Pool` plus one dedicated `LISTEN` connection.
- Parity: queues, workers, flows, job schedulers, rate limiting, prioritization, delayed jobs, deduplication, metrics, events.
- Performance: per-op latency comparable; processing throughput "usually lower than Redis", roughly 1.5x to 2x fewer jobs/s. Laptop figures: processing at concurrency 8 to 32 about 11,000 jobs/s on Postgres vs 18,000 on Redis.
- Suggests `synchronous_commit = off` for throughput if durability policy allows; `removeOnComplete`/`removeOnFail` to keep tables small.

Assessment (INFERRED): our throughput is tiny (thousands of LLM calls per day, each seconds long), so Postgres would be more than fast enough. The backend is two months old, though. **Launch on Redis/Valkey; keep job code backend-agnostic** (it already is under v6); revisit dropping Redis after the PG backend has a few minor releases. Dropping Redis frees about 450 MB on a 4 GB box and removes one backup target.

### 5.5 Postgres-native alternatives (VERIFIED feature lists)

| | pg-boss | graphile-worker |
|---|---|---|
| Latest | 12.35.0 (2026-09-26) | v0.18.0 (2026-09-08) |
| Mechanism | `SKIP LOCKED`, optional `LISTEN/NOTIFY` | `LISTEN/NOTIFY` + `SKIP LOCKED` |
| Features | Transactional enqueue (Drizzle, Knex, Kysely, Prisma adapters), cron and RRULE schedules, priorities, DLQ with redrive, retries with backoff, debounce/throttle/concurrency policies, pub/sub, dashboard package | crontab scheduling, job keys (dedupe), named queues (serial execution) |
| Requirements | Node 22.12+ or Bun, PostgreSQL 13+ | PostgreSQL (version not re-verified) |
| Source | https://github.com/timgit/pg-boss | https://github.com/graphile/worker |

Assessment (INFERRED): pg-boss's transactional enqueue ("insert run row and enqueue job atomically") is its strongest argument. With BullMQ 6 now offering a Postgres backend, staying on BullMQ keeps one API whichever store we choose.

---

## 6. Lightweight monitoring on 4 GB

### 6.1 Options

| Tool | What | Footprint / limits | Status |
|---|---|---|---|
| **Beszel** v0.20.0 (2026-09-19) | Hub (PocketBase) + agent; host + Docker/Podman container CPU/mem/net history, alerts, multi-user, OAuth/OIDC, backups to disk or S3; MIT | "lightweight"; exact MB not published on the fetched page (INFERRED tens of MB for agent) | VERIFIED features https://beszel.dev/guide/what-is-beszel |
| **Netdata** v2.11.1 | Full per-second agent | 100 to 200 MB empty, **250 to 350 MB typical production**; CPU 1 to 5% of a core, up to 5 to 20% | VERIFIED https://learn.netdata.cloud/docs/netdata-agent/resource-utilization |
| **Uptime Kuma** 2.5.5 | Self-hosted uptime (HTTP, TCP, keyword, JSON query, ping, DNS, push, Docker), 90+ notification types, status pages, 20 s intervals | Node process | VERIFIED https://github.com/louislam/uptime-kuma |
| **Grafana Cloud Free** | 10k active metric series, 50 GB logs, 50 GB traces, 50 GB profiles, 14-day retention, 3 active users, 100k synthetic API checks | SaaS | VERIFIED https://grafana.com/pricing/ |
| **Grafana Alloy** v1.20.1 | Collector | ~11 GiB per **1 M** active series, 120 MiB per 1 MiB/s logs; small hosts scale down (baseline not published) | VERIFIED https://grafana.com/docs/alloy/latest/introduction/estimate-resource-usage/ |
| **Healthchecks.io** Hobbyist | Cron / dead-man switch | **20 checks**, 100 log entries per check, $0; Business $20/mo | VERIFIED https://healthchecks.io/pricing/ |
| **Sentry** Developer | Errors, tracing | 5,000 errors, 5 M spans, 50 replays, 1 cron monitor, 1 uptime monitor, 1 user, 30-day retention; Team from $26/mo (annual) | VERIFIED https://sentry.io/pricing/ |
| **Better Stack** Free | Uptime + logs | 10 monitors and heartbeats, 1 status page, Slack and email alerts, 3 GB logs kept 3 days, 30 GB metrics, 100k exceptions | VERIFIED https://betterstack.com/pricing |
| node_exporter | v1.12.1 | Scrape target for Alloy | GitHub API |

Alloy scaled estimate (INFERRED): node_exporter + cAdvisor + postgres_exporter + redis_exporter on one host is roughly 3k to 6k series, well under Grafana's 10k free limit; by the 11 GiB per 1 M series rule, ~5k series is ~55 MB of WAL/series memory, plus Alloy's baseline.

### 6.2 Recommended stack (INFERRED)

- **Off-box uptime**: Better Stack free (10 monitors, 30 s checks advertised) on `/healthz` of the API and the Vercel frontend. Anything running on the Droplet cannot tell you the Droplet is down.
- **Dead-man switches**: Healthchecks.io free: nightly backup, weekly restore drill, scheduler heartbeat (every 5 min from the scheduler container), pgBackRest archive freshness. 20 checks is enough.
- **Errors**: Sentry free for the API, workers and Vercel frontend (5k errors/mo).
- **Host + container metrics**: Beszel agent on the Droplet, hub somewhere else (a free-tier box or the Beszel hub on a second tiny VM). Skip Netdata on 4 GB (250 to 350 MB).
- **Later**: Alloy to Grafana Cloud free when you want Postgres query dashboards and log search.

### 6.3 Docker log rotation (VERIFIED)

Source: https://docs.docker.com/engine/logging/drivers/json-file/

`max-size` defaults to **-1 (unlimited)**; `max-file` default 1 and only effective with `max-size`; `compress` default false. Without this, container logs will eventually fill the 80 GB disk.

`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5", "compress": "true" },
  "ip": "127.0.0.1"
}
```

`"ip": "127.0.0.1"` makes any `ports:` without an explicit address bind to localhost only (see 7.2). Apply to existing containers with `docker compose up -d --force-recreate`. INFERRED. Also cap journald: `SystemMaxUse=500M` in `/etc/systemd/journald.conf`. INFERRED.

---

## 7. Security hardening

### 7.1 unattended-upgrades (VERIFIED)

Source: https://ubuntu.com/server/docs/how-to/software/automatic-updates/ (old documentation.ubuntu.com URL redirects here)

- Pre-installed on Ubuntu Server; security updates applied automatically via `apt-daily.timer` and `apt-daily-upgrade.timer`.
- `/etc/apt/apt.conf.d/50unattended-upgrades`: `Allowed-Origins`, `Automatic-Reboot "false"` (default), `Automatic-Reboot-Time "now"` (set for example `"04:30"`).
- `/etc/apt/apt.conf.d/20auto-upgrades`: values in days; 0 disables.
- Test: `sudo unattended-upgrade -v --dry-run`.

Recommended (INFERRED): enable `Automatic-Reboot "true"`, `Automatic-Reboot-Time "04:30"` UTC (outside the 06:00 run window), and give every container `restart: unless-stopped` so the stack returns after reboot. Add the Docker apt origin to `Allowed-Origins` only if you accept Docker engine restarts unattended.

### 7.2 UFW and Docker (VERIFIED problem, several fixes)

VERIFIED:
- "Docker and ufw use firewall rules in ways that make them incompatible with each other." Published ports are diverted in the NAT table "before it reaches the INPUT and OUTPUT chains that ufw uses." https://docs.docker.com/engine/network/packet-filtering-firewalls/
- Published ports bind to `0.0.0.0` and `[::]` by default; "Publishing container ports is insecure by default"; use `-p 127.0.0.1:8080:80`; daemon `"ip"` key changes the default bind. https://docs.docker.com/engine/network/port-publishing/
- Docker install docs repeat that exposed ports "bypass your firewall rules". https://docs.docker.com/engine/install/ubuntu/
- Docker supports `iptables` and (experimental) `nftables` via `firewall-backend`.

Fixes, in order of preference (INFERRED ranking):
1. **Publish only Caddy's 80/443.** Postgres, Redis, API, workers get no `ports:`; they talk over the Compose network. For admin access use `ssh -L 5432:...` to a `127.0.0.1:5432` binding.
2. **Set `"ip": "127.0.0.1"` in daemon.json** so an accidental `ports: ["5432:5432"]` stays local.
3. **DigitalOcean Cloud Firewall** (free, off-host): inbound 22 from your IP(s) only, 80/443 from anywhere (or Cloudflare IP ranges only if proxied). Docker cannot bypass it.
4. Optional `chaifeng/ufw-docker` (DOCKER-USER chain in `/etc/ufw/after.rules`). UNVERIFIED (secondary sources only).

### 7.3 SSH: key-only vs fail2ban

- OpenSSH 9.8+ has **`PerSourcePenalties`, "enabled by default"**: sshd penalises addresses that fail to authenticate, escalating up to a maximum. VERIFIED https://www.openssh.org/txt/release-9.8. Ubuntu 26.04 ships OpenSSH 10.2p1 (UNVERIFIED secondary), so this is on by default there.
- Recommendation (INFERRED): key-only auth + Cloud Firewall allow-list for port 22 makes fail2ban mostly redundant. fail2ban still adds value if SSH must stay open to the world or for Caddy auth-log jails.

`/etc/ssh/sshd_config.d/10-hardening.conf` (INFERRED):

```conf
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
```

Ubuntu 22.10+ uses socket-activated sshd (`ssh.socket`); changing the port requires editing the socket unit, not only `Port`. INFERRED from knowledge; not re-verified this session.

### 7.4 Reverse proxy with automatic HTTPS

| | Caddy v2.11.4 | Nginx + certbot / native ACME | Traefik v3.7.13 |
|---|---|---|---|
| Auto HTTPS | Default on; Let's Encrypt and ZeroSSL with automatic failover between CAs; HTTP to HTTPS redirect automatic; background renewal. Needs DNS A/AAAA, ports 80/443, writable data dir. VERIFIED https://caddyserver.com/docs/automatic-https | certbot, or the new **`ngx_http_acme_module`** (Rust dynamic module, announced August 2025, HTTP-01 only in preview). VERIFIED via https://blog.nginx.org/blog/native-support-for-acme-protocol and https://letsencrypt.org/2025/09/11/native-acme-for-nginx (search results) | `certificatesResolvers` ACME (HTTP-01, TLS-ALPN-01, DNS-01) storing `acme.json`. Docs page redirected to `/reference/install-configuration/tls/certificate-resolvers/acme/`; content not fetched. UNVERIFIED detail |
| Config size for 1 API | ~3 lines | ~25 lines + renew timer | labels on each container + static config |
| Fit | **Best for one host** | Familiar, more moving parts | Best for many dynamic containers |

Caddyfile (INFERRED):

```caddyfile
api.example.com {
  encode zstd gzip
  reverse_proxy api:3000
  header -Server
}
```

### 7.5 Cloudflare proxy or Tunnel

VERIFIED:
- Cloudflare Tunnel: `cloudflared` makes outbound-only, post-quantum encrypted connections; "No open inbound ports. No public IPs." Four long-lived connections to two data centres per tunnel. **"Available on all plans"**. https://developers.cloudflare.com/tunnel/
- Proxied traffic limits: Proxy Read Timeout **125 s** (524 error, configurable on Enterprise only); origin TCP connect 19 s; URL max 16 KB; headers max 128 KB. https://developers.cloudflare.com/fundamentals/reference/connection-limits/
- Request body max **100 MB** on Free and Pro plans (413 above). https://developers.cloudflare.com/workers/platform/limits/

Implications (INFERRED):
- Any API endpoint that waits on an LLM must not hold the HTTP request for more than about 100 s behind Cloudflare. Our design already enqueues runs to BullMQ and returns a job id; keep it that way.
- Tunnel option: no inbound 80/443 at all; Cloud Firewall allows only 22 from your IP (or nothing, using Cloudflare Access for SSH). Caddy then runs without ACME (`http://` site or `auto_https off`), or is dropped in favour of `cloudflared` pointing at `api:3000`.
- Proxy option (orange cloud + Caddy): restrict 80/443 in the Cloud Firewall to Cloudflare IP ranges; Caddy obtains certs via HTTP-01 through the proxy or via DNS-01 with the Cloudflare plugin.

Recommendation (INFERRED): **Cloudflare Tunnel + Cloud Firewall with zero public web ports** is the smallest attack surface for a single Droplet whose only public client is the Vercel frontend and API users. Keep Caddy only if you want to avoid Cloudflare in the data path.

---

## 8. Statistics for repeated AI runs

Notation: x successes (for example "brand mentioned") in n runs, p̂ = x/n, z = z_{1-α/2} (1.96 for 95%).

### 8.1 Single-proportion intervals

| Interval | Formula | Reference |
|---|---|---|
| Wald (avoid) | p̂ ± z·sqrt(p̂(1-p̂)/n) | Brown, Cai, DasGupta (2001): textbook guidance on Wald "cannot be trusted" |
| **Wilson score** | [p̂ + z²/(2n) ± z·sqrt(p̂(1-p̂)/n + z²/(4n²))] / (1 + z²/n) | Wilson, E.B. (1927) JASA 22:209 to 212, doi:10.1080/01621459.1927.10502953; NIST/SEMATECH e-Handbook 7.2.4.1 https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm |
| **Agresti-Coull** | ñ = n + z²; p̃ = (x + z²/2)/ñ; p̃ ± z·sqrt(p̃(1-p̃)/ñ) | Agresti and Coull (1998) The American Statistician 52:119 to 126, doi:10.1080/00031305.1998.10480550 |
| **Clopper-Pearson** (exact, conservative) | L = B(α/2; x, n-x+1), U = B(1-α/2; x+1, n-x); L = 0 if x = 0, U = 1 if x = n (B = Beta quantile) | Clopper and Pearson (1934) Biometrika 26:404 to 413, doi:10.1093/biomet/26.4.404 |
| **Jeffreys** | Beta(x + 0.5, n - x + 0.5) quantiles at α/2 and 1-α/2; L = 0 if x = 0, U = 1 if x = n | Brown, Cai, DasGupta (2001) Statistical Science 16(2), doi:10.1214/ss/1009213286 |

All DOIs VERIFIED via Crossref (api.crossref.org) on 2026-09-29. The BCD 2001 recommendation (VERIFIED via Project Euclid abstract page): **Wilson or equal-tailed Jeffreys for small n; Agresti-Coull for larger n.** NIST notes Wilson was recommended by Agresti and Coull and cannot produce negative lower limits.

Worked 95% intervals (INFERRED, computed with scipy):

| x / n | Wilson | Agresti-Coull | Clopper-Pearson | Jeffreys |
|---|---|---|---|---|
| 3 / 10 | 0.108 to 0.603 | 0.103 to 0.608 | 0.067 to 0.652 | 0.093 to 0.606 |
| 0 / 10 | 0 to 0.278 | 0 to 0.321 | 0 to 0.308 | 0 to 0.217 |
| 10 / 10 | 0.722 to 1 | 0.679 to 1 | 0.692 to 1 | 0.783 to 1 |
| 12 / 20 | 0.387 to 0.781 | 0.386 to 0.782 | 0.361 to 0.809 | 0.384 to 0.789 |
| 60 / 100 | 0.502 to 0.691 | 0.502 to 0.691 | 0.497 to 0.697 | 0.502 to 0.692 |

**Product choice (INFERRED): Wilson** for display (closed form, no Beta quantile needed in TypeScript, never outside [0,1], good coverage at small n).

### 8.2 Replicates needed

Unclustered margin of error E at 95%: n = z²·p(1-p)/E². Worst case p = 0.5 (INFERRED arithmetic):

| E (±) | n |
|---|---|
| 0.20 | 25 |
| 0.15 | 43 |
| 0.10 | 97 |
| 0.05 | 385 |

Wilson half-width at p = 0.5 by replicates K for a **single prompt** (INFERRED): K=3 ±0.375, K=5 ±0.33, K=10 ±0.26, K=20 ±0.20, K=30 ±0.17, K=50 ±0.13, K=100 ±0.10.

Takeaway: per-prompt mention rates from 3 to 10 runs are very noisy. Show them with intervals, or as "mentioned in 2 of 3 runs", not as bare percentages.

### 8.3 Clustering: prompt as the unit

Runs of the same prompt are correlated. Kish design effect (Kish, L. 1965, *Survey Sampling*, Wiley; standard textbook result, not fetched):

DEFF = 1 + (m - 1)·ρ, n_eff = N / DEFF

where m = runs per prompt, ρ = intra-class correlation (ICC) of the mention indicator within prompt.

Examples at p = 0.5 (INFERRED):

| Prompts P | Runs K | ρ | DEFF | n_eff | 95% MOE |
|---|---|---|---|---|---|
| 50 | 5 | 0.5 | 3.0 | 83 | ±0.107 |
| 50 | 10 | 0.5 | 5.5 | 91 | ±0.103 |
| 100 | 3 | 0.5 | 2.0 | 150 | ±0.080 |
| 200 | 3 | 0.4 | 1.8 | 333 | ±0.054 |

Doubling runs from 5 to 10 on 50 prompts barely helps (83 to 91 effective); doubling prompts does. **Spend budget on more prompts, not more replicates**, once K is about 3. INFERRED.

Estimator for aggregate visibility (INFERRED, consistent with Miller 2024 below):
- v̂ = (1/P)·Σ_i p̂_i, where p̂_i = x_i/K_i per prompt (prompt-weighted mean).
- SE(v̂) = sd(p̂_1..p̂_P)/sqrt(P). This is the cluster-robust SE when prompts are equally weighted.
- Estimate ρ from the data with a one-way ANOVA ICC on the 0/1 outcomes, and report it.

Miller, E. (2024) "Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations", arXiv:2411.00640. VERIFIED https://arxiv.org/abs/2411.00640 and https://arxiv.org/html/2411.00640. Recommendations: CLT standard errors; **clustered standard errors when questions come in related groups**; reduce variance by resampling answers (the within-question variance term shrinks as σ²_i/K); compare models on **question-level paired differences**; power analysis with n = (z_{α/2} + z_β)²·(ω² + σ²_A/K_A + σ²_B/K_B)/δ².

### 8.4 Share of voice: bootstrap

Share of voice SoV_b = mentions of brand b / mentions of all tracked brands, a ratio estimator with no simple binomial form.

**Cluster (prompt-level) percentile bootstrap** (Efron, B. 1979, Annals of Statistics 7(1), doi:10.1214/aos/1176344552, VERIFIED via Crossref; Efron and Tibshirani 1993 *An Introduction to the Bootstrap*, textbook, not fetched):
1. For b = 1..B (B = 2,000): sample P prompts with replacement; keep all runs of each drawn prompt.
2. Recompute SoV on the resample.
3. 95% CI = 2.5th and 97.5th percentiles.

Resampling individual runs instead of prompts understates the interval when ρ > 0. INFERRED. Cost: 2,000 x (a few hundred prompts) is milliseconds in Node or SQL; run in the worker after each period closes.

### 8.5 Change between periods

Independent samples, one proportion each:
- **Two-proportion z-test**: p̄ = (x1 + x2)/(n1 + n2), z = (p̂1 - p̂2)/sqrt(p̄(1-p̄)(1/n1 + 1/n2)). Standard textbook test (for example Agresti, *Categorical Data Analysis*); not fetched this session.
- **Newcombe hybrid score interval** for p1 - p2 (method 10 of 11 compared): with Wilson limits (l1,u1), (l2,u2) and d = p̂1 - p̂2:
  - L = d - sqrt((p̂1 - l1)² + (u2 - p̂2)²)
  - U = d + sqrt((u1 - p̂1)² + (p̂2 - l2)²)
  - Newcombe, R.G. (1998) Statistics in Medicine 17:873 to 890, doi:10.1002/(SICI)1097-0258(19980430)17:8<873::AID-SIM779>3.0.CO;2-I. VERIFIED Crossref. (Single-proportion companion paper: 17:857 to 872.)

Worked example (INFERRED): 12/20 vs 6/20: d = 0.30, Newcombe 95% CI -0.006 to 0.538; z = 1.91, p = 0.057. A 30-point swing on 20 runs is not significant.

**Same prompts both periods (our normal case): use paired analysis.** d_i = p̂_i(t2) - p̂_i(t1) per prompt; mean d̄, SE = sd(d_i)/sqrt(P); CI d̄ ± t_{P-1}·SE (Miller 2024, paired differences). Pairing removes between-prompt variance and is much tighter than treating the periods as independent. For many prompts with binary outcomes per prompt, McNemar's test is the exact-pair analogue (textbook; INFERRED applicability).

### 8.6 Multiple comparisons

Dashboards test many brands x engines x prompts at once. At α = 0.05, 100 true-null comparisons produce about 5 false "significant change" flags per period. INFERRED arithmetic.

- **Benjamini-Hochberg FDR** (Benjamini and Hochberg 1995, JRSS-B 57:289 to 300, doi:10.1111/j.2517-6161.1995.tb02031.x, VERIFIED Crossref): sort p-values p_(1) <= ... <= p_(m); find the largest k with p_(k) <= (k/m)·q; flag hypotheses 1..k. Use q = 0.10 for alerting.
- Bonferroni (α/m) only for a small number of pre-registered headline metrics.
- Also require a minimum effect size (for example |Δ| >= 10 points) before alerting. INFERRED.

### 8.7 Volatility of cited sources

**Jaccard distance** between cited-domain sets A and B of two runs (Jaccard, P. 1912, New Phytologist 11:37 to 50, doi:10.1111/j.1469-8137.1912.tb05611.x, VERIFIED Crossref):

J(A,B) = |A ∩ B| / |A ∪ B|, distance = 1 - J(A,B). Define J = 1 when both sets are empty.

Use (INFERRED): mean pairwise Jaccard distance among the K replicates of a prompt = **within-period instability**; Jaccard distance between pooled domain sets of consecutive periods = **drift**. Report drift relative to within-period instability, otherwise normal sampling noise looks like change.

**Rank-biased overlap (RBO)** for ranked source lists (Webber, Moffat, Zobel 2010, "A similarity measure for indefinite rankings", ACM TOIS 28(4):20, doi:10.1145/1852102.1852106, VERIFIED Crossref; ACM page returned 403):

- Agreement at depth d: A_d = |S_{1:d} ∩ T_{1:d}| / d
- RBO(S,T,p) = (1 - p)·Σ_{d=1..∞} p^{d-1}·A_d
- Extrapolated for lists evaluated to depth k: RBO_ext = (X_k/k)·p^k + ((1 - p)/p)·Σ_{d=1..k} (X_d/d)·p^d, where X_d = |S_{1:d} ∩ T_{1:d}|.
- Weight on the top d ranks: W(1:d) = 1 - p^{d-1} + ((1 - p)/p)·d·(ln(1/(1 - p)) - Σ_{i=1..d-1} p^i/i).

Computed top weights (INFERRED): p = 0.9 puts 85.6% of weight on the top 10; p = 0.8 puts 86.1% on the top 5; p = 0.5 puts 95.4% on the top 3. **Use p = 0.8** for AI answers that cite 3 to 10 sources. RBO handles non-conjoint lists (items appearing in only one list), unlike Kendall's tau or Spearman's rho. Volatility = 1 - RBO.

---

## 9. SEO visibility methodology

### 9.1 Rank volatility metrics (INFERRED definitions unless noted)

For keyword k with daily ranks r_{k,t} over window W:
- **Rank standard deviation**: sd(r_{k,t}) over W. Cap unranked at a sentinel (for example 101 for top-100 tracking) and report the share of days unranked separately, else a drop-out dominates the SD.
- **Mean absolute rank change**: (1/(|W| - 1))·Σ |r_{k,t} - r_{k,t-1}|.
- **Log-rank change** |ln r_t - ln r_{t-1}| weights moves near the top more (1 to 3 matters more than 51 to 53).
- **Top-10 set churn**: 1 - Jaccard or 1 - RBO between day t and t-1 top-10 URL lists, averaged over keywords. This is the SERP-level analogue of 8.7.
- **Visibility-weighted change**: Σ_k volume_k·|CTR(r_{k,t}) - CTR(r_{k,t-1})| using a position-CTR curve.

**Semrush Sensor** (VERIFIED https://www.semrush.com/kb/652-sensor; the URL /kb/1165-sensor returned 404): "a proprietary formula that checks the changes in search results for a fixed set of keywords on a daily basis"; 0 to 10 scale; bands "0-2 is considered low, 2-5 is normal, 5-8 is high and 8-10 is very high"; tracks 30+ SERP features; desktop and mobile across databases (US, UK, DE, IT, ES, FR, AU, JP, and Baidu for China); a "Personal Score" from your Position Tracking keywords. **The formula and keyword-set size are not published.** Our own index should therefore be documented and reproducible: for example, the daily mean over tracked keywords of (1 - RBO_p=0.8 of top-10 URLs), scaled to 0 to 10 against a trailing 90-day distribution (percentile rank x 10). INFERRED design.

### 9.2 URL canonicalization (RFC 3986 section 6)

VERIFIED https://www.rfc-editor.org/rfc/rfc3986#section-6

Safe (semantics-preserving) normalization:
1. **Case**: lowercase scheme and host; uppercase hex digits in percent-encodings (`%3a` to `%3A`). (6.2.2.1)
2. **Percent-encoding**: decode percent-encoded **unreserved** characters (`A-Z a-z 0-9 - . _ ~`). (6.2.2.2)
3. **Path segments**: remove `.` and `..` dot-segments. (6.2.2.3)
4. **Scheme-based**: empty path becomes `/` for http(s); drop default port (`:80` for http, `:443` for https); drop an empty port `:`. (6.2.3)
5. **Protocol-based** (trailing slash, `www.`): RFC notes these are not generally safe; apply only as explicit, documented heuristics. (6.2.4)

Our additional, lossy rules for citation grouping (INFERRED; store the raw URL alongside):
- Drop fragment (`#...`).
- Strip tracking params (`utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `ref`, `srsltid`), then sort remaining query params.
- Convert IDN hosts to punycode (ASCII) before comparing.
- Keep `http` vs `https` and trailing slash differences in the URL key; collapse them only at the page-group level.
- Node's `new URL()` implements the WHATWG URL Standard, which already lowercases scheme/host, removes default ports, resolves dot-segments and punycodes hosts; it does not decode percent-encoded unreserved characters. INFERRED from WHATWG behaviour; test it.

### 9.3 Registrable domain: Public Suffix List + tldts

PSL algorithm (VERIFIED https://github.com/publicsuffix/list/wiki/Format):
- A rule matches when the domain has at least as many labels and each label equals the rule label or the rule label is `*`.
- Wildcards only in the leftmost position.
- `!` exception rules override other matches.
- If nothing matches, the prevailing rule is `*`.
- **Registrable domain = public suffix + one more label.**
- ICANN section: IANA-delegated suffixes. PRIVATE section: suffixes submitted by domain holders (for example `github.io`, `s3.amazonaws.com`).
- Download at most once per day; the list "usually changes a few times per week". VERIFIED https://publicsuffix.org/list/

tldts (VERIFIED https://github.com/remusao/tldts; latest v7.4.16, 2026-09-27):
- API: `parse`, `getDomain`, `getPublicSuffix`, `getSubdomain`, `getHostname`, plus `getDomainWithoutSuffix`.
- Options: `allowPrivateDomains` (default false: ICANN only), `extractHostname`, `detectSpecialUse` (RFC 6761), `validateHostname`.
- Example: `http://www.writethedocs.org/conf/eu/2017/` gives `domain: "writethedocs.org"`, `subdomain: "www"`, `publicSuffix: "org"`, `isIcann: true`, `isIp: false`.
- About 0.1 to 1 µs per parse; PSL bundled and updated with releases.

Decision (INFERRED): for **citation attribution** use `allowPrivateDomains: true`, so `alice.github.io` and `bob.github.io` are different sources (they are different publishers). For **brand/owner rollups** use ICANN-only (`medium.com`, not per-user subdomains) as a secondary grouping. Pin tldts in `package.json` and bump monthly (Renovate), so PSL changes arrive through code review rather than silently changing historical groupings. Store `registrable_domain` computed at ingest time with the tldts version, so re-computation is explicit.

```ts
import { parse } from 'tldts';

export interface DomainParts { hostname: string; registrableDomain: string | null; publicSuffix: string | null; isIp: boolean }

export function domainParts(rawUrl: string): DomainParts {
  const r = parse(rawUrl, { allowPrivateDomains: true });
  if (r.hostname === null) throw new Error(`Unparseable URL: ${rawUrl}`);
  return { hostname: r.hostname, registrableDomain: r.domain, publicSuffix: r.publicSuffix, isIp: r.isIp === true };
}
```

---

## 10. Recommended single-Droplet layout (INFERRED synthesis)

`docker-compose.yml` sketch:

```yaml
services:
  caddy:            # or cloudflared if using Tunnel
    image: caddy:2.11
    ports: ["80:80", "443:443"]
    volumes: [caddy_data:/data, ./Caddyfile:/etc/caddy/Caddyfile:ro]
    restart: unless-stopped
  postgres:
    image: registry.example/postgres-pgbackrest:18   # FROM postgres:18 + pgbackrest (+ partman if used)
    shm_size: 256mb
    environment: { POSTGRES_USER: app, POSTGRES_DB: app, POSTGRES_PASSWORD_FILE: /run/secrets/pg_password }
    volumes: [pg:/var/lib/postgresql, ./postgresql.conf:/etc/postgresql/postgresql.conf:ro]
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
    mem_limit: 1400m
    restart: unless-stopped
  redis:
    image: valkey/valkey:9      # or redis:8
    command: ["valkey-server", "/etc/valkey/valkey.conf"]
    volumes: [redis:/data, ./valkey.conf:/etc/valkey/valkey.conf:ro]
    mem_limit: 512m
    restart: unless-stopped
  api:
    image: registry.example/api:${TAG}
    environment: { NODE_OPTIONS: "--max-old-space-size=384" }
    mem_limit: 512m
    restart: unless-stopped
  worker:
    image: registry.example/api:${TAG}
    command: ["node", "dist/worker.js"]
    environment: { NODE_OPTIONS: "--max-old-space-size=512" }
    stop_grace_period: 60s      # let BullMQ finish active jobs
    mem_limit: 700m
    restart: unless-stopped
  scheduler:
    image: registry.example/api:${TAG}
    command: ["node", "dist/scheduler.js"]
    environment: { NODE_OPTIONS: "--max-old-space-size=128" }
    mem_limit: 200m
    restart: unless-stopped
volumes: { pg: {}, redis: {}, caddy_data: {} }
```

Monthly cost (INFERRED): Droplet $24 + R2 about $0 to $1 + monitoring $0 (free tiers) = **about $25/mo**. Optional DO weekly backups +$4.80. Next step up: $48 (4 vCPU / 8 GB).

---

## 11. Source log

| # | URL | Result |
|---|---|---|
| 1 | https://www.digitalocean.com/pricing/droplets | OK (embedded JSON parsed with curl) |
| 2 | https://docs.digitalocean.com/products/droplets/details/pricing/ | OK (overage $0.01/GiB) |
| 3 | https://docs.digitalocean.com/products/volumes/details/pricing/ | OK |
| 4 | https://docs.digitalocean.com/products/backups/details/pricing/ | OK |
| 5 | https://docs.digitalocean.com/products/networking/firewalls/details/pricing/ | OK |
| 6 | https://docs.digitalocean.com/products/droplets/details/images/ | OK |
| 7 | https://slugs.do-api.dev/ | Failed (no prices on page) |
| 8 | https://developers.cloudflare.com/r2/pricing/ (and index.md) | OK |
| 9 | https://developers.cloudflare.com/r2/buckets/bucket-locks/ | OK |
| 10 | https://developers.cloudflare.com/r2/buckets/object-lifecycles/ | OK |
| 11 | https://developers.cloudflare.com/r2/api/s3/api/ (and index.md) | OK |
| 12 | https://www.postgresql.org/support/versioning/ | OK |
| 13 | https://www.postgresql.org/about/news/postgresql-18-released-3142/ | OK |
| 14 | https://www.postgresql.org/docs/19/release-19.html | OK (beta notes) |
| 15 | https://www.postgresql.org/docs/18/app-pgdump.html | OK |
| 16 | https://www.postgresql.org/docs/18/ddl-partitioning.html | OK |
| 17 | https://www.postgresql.org/docs/18/brin-intro.html | 404; used /docs/18/brin.html (OK) |
| 18 | https://www.postgresql.org/docs/18/runtime-config-client.html | OK |
| 19 | https://www.postgresql.org/docs/18/runtime-config-resource.html | OK |
| 20 | https://www.postgresql.org/docs/18/storage-toast.html | OK |
| 21 | https://www.postgresql.org/docs/18/storage-page-layout.html | OK |
| 22 | https://www.postgresql.org/docs/release/15.0/, /16.0/, /17.0/ | OK |
| 23 | https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server | OK |
| 24 | https://docs.timescale.com/about/latest/timescaledb-editions/ | 301 to tigerdata.com; fetched OK there |
| 25 | https://github.com/pgpartman/pg_partman (+ raw docs, changelog) | OK |
| 26 | https://pgbackrest.org/configuration.html | OK |
| 27 | https://github.com/wal-g/wal-g/issues/2550 | OK |
| 28 | https://github.com/pgbackrest/pgbackrest/issues/2782 | Search result only |
| 29 | https://docs.pgbarman.org/release/latest/user_guide/barman_cloud.html | 404; search results only |
| 30 | https://rclone.org/s3/ | OK |
| 31 | https://github.com/FiloSottile/age | OK |
| 32 | https://redis.io/legal/licenses/ | OK |
| 33 | https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/ | OK |
| 34 | https://redis.io/docs/latest/operate/oss_and_stack/management/admin/ | OK |
| 35 | https://docs.bullmq.io/guide/going-to-production | OK |
| 36 | https://docs.bullmq.io/guide/job-schedulers | OK |
| 37 | https://docs.bullmq.io/guide/jobs/deduplication | OK |
| 38 | https://docs.bullmq.io/guide/jobs/stalled | OK |
| 39 | https://docs.bullmq.io/bullmq-pro/groups | OK |
| 40 | https://github.com/taskforcesh/bullmq (changelog.md, guide/postgresql.md, releases API) | OK |
| 41 | https://github.com/timgit/pg-boss (README) | OK |
| 42 | https://github.com/graphile/worker | OK |
| 43 | https://www.pgbouncer.org/features.html | OK |
| 44 | https://github.com/docker-library/docs/blob/master/postgres/content.md | OK |
| 45 | https://grafana.com/pricing/ | OK |
| 46 | https://grafana.com/docs/alloy/latest/introduction/estimate-resource-usage/ | OK |
| 47 | https://healthchecks.io/pricing/ | OK |
| 48 | https://sentry.io/pricing/ | OK |
| 49 | https://betterstack.com/pricing | OK |
| 50 | https://beszel.dev/guide/what-is-beszel | OK |
| 51 | https://learn.netdata.cloud/docs/netdata-agent/resource-utilization | OK |
| 52 | https://github.com/louislam/uptime-kuma | OK |
| 53 | https://docs.docker.com/engine/logging/drivers/json-file/ | OK |
| 54 | https://docs.docker.com/engine/network/packet-filtering-firewalls/ | OK |
| 55 | https://docs.docker.com/engine/network/port-publishing/ | OK |
| 56 | https://docs.docker.com/engine/install/ubuntu/ | OK |
| 57 | https://ubuntu.com/server/docs/how-to/software/automatic-updates/ | OK (after redirect) |
| 58 | https://lists.ubuntu.com/archives/ubuntu-announce/2026-April/000323.html | OK |
| 59 | https://www.openssh.org/txt/release-9.8 | OK (after redirect from openssh.com) |
| 60 | https://caddyserver.com/docs/automatic-https | OK |
| 61 | https://doc.traefik.io/traefik/https/acme/ | Redirect only; content not fetched |
| 62 | https://blog.nginx.org/blog/native-support-for-acme-protocol | Search result only |
| 63 | https://developers.cloudflare.com/tunnel/ (index.md) | OK |
| 64 | https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ | OK |
| 65 | https://www.cloudflare.com/plans/zero-trust-services/ | Fetched; no plan details in content |
| 66 | https://developers.cloudflare.com/fundamentals/reference/connection-limits/ | OK |
| 67 | https://developers.cloudflare.com/workers/platform/limits/ | OK (body size table) |
| 68 | https://github.com/chaifeng/ufw-docker | Search results only |
| 69 | https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm | OK |
| 70 | https://projecteuclid.org/.../10.1214/ss/1009213286.full | OK (abstract) |
| 71 | https://dl.acm.org/doi/10.1145/1852102.1852106 | 403; metadata verified via Crossref |
| 72 | https://api.crossref.org/works/{doi} for Wilson 1927, Clopper-Pearson 1934, Agresti-Coull 1998, Newcombe 1998 (x2), BCD 2001, Benjamini-Hochberg 1995, Efron 1979, Jaccard 1912, Webber et al. 2010 | OK |
| 73 | https://arxiv.org/abs/2411.00640 and /html/2411.00640 | OK |
| 74 | https://www.semrush.com/kb/1165-sensor | 404; used https://www.semrush.com/kb/652-sensor (OK) |
| 75 | https://www.rfc-editor.org/rfc/rfc3986#section-6 | OK |
| 76 | https://publicsuffix.org/list/ | OK |
| 77 | https://github.com/publicsuffix/list/wiki/Format | OK |
| 78 | https://github.com/remusao/tldts | OK |
| 79 | GitHub releases API (api.github.com/repos/*/releases/latest) for version numbers | OK |
