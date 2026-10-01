# 31. Implementation Checklist

Status: Draft for architecture freeze; Phases 0 and 1 follow [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)
Last updated: 2026-09-30
Use: copy the relevant phase section into the phase's tracking issue. Each item links to the document that specifies it. Phase goals, dependencies and acceptance criteria are in [29-phase-roadmap.md](29-phase-roadmap.md).

## Phase 0: Validation and freeze

Scope per [ADR-022](adr/ADR-022-python-backend-simplified-platform.md): about 1 week. S-07 (Better Auth) and S-08 (BullMQ load) are dropped; S-10 (restore drill) is Phase 1 work.

- [ ] Repository under git; baseline committed
- [ ] DataForSEO account funded (minimum payment $50), sandbox credentials for request-shape tests
- [ ] R2 buckets `seo-raw`, `seo-backups` created; lifecycle rules, including the 30-day rule on `seo-backups/daily/` ([23](23-backup-disaster-recovery.md)); no bucket lock
- [ ] Scratch droplet with Docker; spike repo folder `spikes/`
- [ ] S-01 SERP task flow, billing formulas, `tasks_ready` recovery, `tag` echo, `id_list` returns tag ([06](06-dataforseo-seo-integration.md) section 11)
- [ ] S-02 SERP payload sizes and zstd ratios
- [ ] S-03 AI Overview async share and presence delta
- [ ] S-04 ChatGPT/Gemini scraper payloads, ads in markdown, natural vs forced search decision ([07](07-dataforseo-ai-integration.md) section 4.2)
- [ ] S-05 replicate independence
- [ ] S-06 AI Mode payload and billing
- [ ] S-09 synthetic 12-month dataset query performance
- [ ] S-11 canonicalizer on real URLs; S-12 to S-16 scheduled before the phase that needs them ([01](01-research-findings.md) section 12)
- [ ] Fixtures captured into `data/fixtures/` with schema hashes
- [ ] Price book seeded from confirmed billing; docs 27 and 28 updated with measurements
- [ ] Open questions Q-01 to Q-06, Q-08 and Q-09 answered or deferred; Q-07 is retired ([30](30-risks-open-questions.md))
- [ ] Architecture freeze sign-off on docs 04, 05, 12, 19

## Phase 1: Platform foundation

Scope per [ADR-022](adr/ADR-022-python-backend-simplified-platform.md): about 3.5 engineer-weeks. The order of work is [29](29-phase-roadmap.md) section 1.1; items deferred there are ticked under Launch readiness, not here.

### Repository and tooling

- [ ] Layout: `apps/web/` (Next.js), `backend/` (one Python project, two entrypoints), `data/fixtures/`, `infra/`, `docs/`; no Turborepo ([03](03-system-architecture.md))
- [ ] Backend package `backend/src/sightline/{api, worker, domain, extraction, providers, collectors, db, storage, config}`; Python 3.13, `uv` lockfile, ruff
- [ ] import-linter contracts in CI: `domain` and `extraction` import nothing internal and do no I/O; `providers` never imports `db`; `collectors` owns persistence
- [ ] pytest, Testcontainers (`postgres:18`, `redis:8`), Hypothesis where it earns its keep ([26](26-testing-quality.md))
- [ ] `sightline.config`: settings from the environment validated at start; process exits on invalid config
- [ ] Structured JSON logs to stdout with the redaction list ([24](24-security.md) section 11), request ids, Sentry init (Python SDK, 10% performance sampling)
- [ ] Web: pnpm, TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint, Prettier, Vitest, Playwright scaffolding
- [ ] Generated TypeScript client: `openapi-typescript` plus `openapi-fetch` from the FastAPI OpenAPI 3.1 document, regenerated in CI and committed; CI fails when the committed client differs

### Database

- [ ] SQLAlchemy 2 (async, asyncpg) for application code; raw SQL for analytics
- [ ] Alembic migrations (SQL in `op.execute` allowed, `autocommit_block()` for statements that cannot run in a transaction, lock_timeout 2 s)
- [ ] Extensions: citext, pg_trgm, pgcrypto, btree_gist, pg_stat_statements
- [ ] Schemas `auth`, `core`, `ops`; roles `app_api` (api, subject to RLS), `app_worker` (worker, bypasses RLS, never reachable from a request), `migrator` (owner), `backup` (read-only) with grants
- [ ] Tables for Phase 1 ([29](29-phase-roadmap.md) Phase 1 database list; DDL in [04](04-data-model.md)); no `ops.secrets` or `ops.fetch_cache` yet
- [ ] `ops.maintain_partitions()` over the partition registry (UTC-safe; built) and the daily maintenance job that calls it
- [ ] RLS policy generator for all `workspace_id` tables; per-transaction `set_config('app.workspace_id', ...)`
- [ ] Synthetic fixture database (1 GB) for migration checks

### API

- [ ] FastAPI on uvicorn, Pydantic v2 models as the contract, OpenAPI 3.1 generation, base path `/api/v1`
- [ ] Own auth module at `/api/v1/auth/*`: argon2id passwords, opaque session ids in `auth.sessions` with a 60 s Redis read-through cache, email verification and password reset with hashed tokens, invitations, TOTP (pyotp) as an opt-in ([24](24-security.md) section 3 for roles)
- [ ] Cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax, Path=/); Origin check on state-changing requests; same origin, so no CORS allowlist ([24](24-security.md) section 2.1)
- [ ] Tenancy dependency (workspace in path, membership lookup, 404 for foreign ids)
- [ ] Permission dependency on every route; route permission coverage test
- [ ] problem+json errors; rate limiting with a Redis store
- [ ] Endpoints: me, workspaces, members, invitations, roles, projects, audit logs, quotas, budgets ([19](19-api-specification.md)); API keys, Google OIDC and the Idempotency-Key header deferred
- [ ] Health endpoints `/healthz`, `/readyz` on the Docker network; no `/metrics`

### Worker and queue

- [x] Taskiq with the Redis broker; queues `collect` (provider calls, concurrency 8) and `process` (ingest, extraction, analytics, maintenance, concurrency 4) in one worker process ([21](21-scheduler-workers.md)). The shared rate limiter is Redis token buckets under `rl:`, taken before every DataForSEO call
- [x] Planner tick inside the worker under a Redis lock; dispatcher checks the budget before enqueueing; reconciler re-enqueues from `ops.collection_tasks` after Redis loss (no workloads yet)
- [ ] Taskiq scheduler for maintenance cron jobs: partitions and the reconciler are scheduled; retention stubs wait for the tables they prune. No scheduler container
- [x] Taskiq smoke test: jobs on both queues, retries by error class through the ledger (none at the broker), worker restart mid-run, reconciler after a Redis flush (`backend/tests/worker/test_end_to_end.py`). Taskiq stays
- [ ] Redis 8: AOF on, `noeviction`, `maxmemory 256mb`; nothing lives only in Redis
- [x] Graceful shutdown handling (worker: `backend/smoke.sh` stops it with SIGTERM and requires exit code 0)

### Storage and providers

- [x] R2 client, zstd compression, raw payload writer/reader, `ops.raw_payloads` registration (`storage/raw.py`, `collectors/raw_payloads.py`; no local spool)
- [ ] Provider adapter contract types and contract test harness ([05](05-provider-integrations.md) section 3). The types for submitting and fetching are built; the shared contract suite over recorded fixtures waits for real fixtures (spike S-01) and the first normalizer
- [x] DataForSEO HTTP client: auth, status_code parsing at two levels, error taxonomy, shared rate limiter; readiness by polling `tasks_ready`, no pingback route; the id sweeper and the `submit_unknown` resolver (off until S-01)
- [ ] Envelope encryption of tenant credentials is not built in Phase 1; it arrives with first-party integrations in Phase 12 ([24](24-security.md) section 5.2)

### Frontend

- [ ] Next.js App Router project in `apps/web/`, `output: 'standalone'`, one Node process, image built in CI, served as `web` behind Caddy on the same origin (no Vercel, no preview deployments)
- [ ] shadcn/ui on Tailwind v4; layout shell; workspace and project switcher
- [ ] Auth screens (sign-up, sign-in, email verification, password reset, TOTP enrolment); settings: members, roles, projects; empty Overview
- [ ] Generated API client with TanStack Query; server components call the API over the Docker network; error boundaries; CSP headers; Sentry Next.js SDK ([20](20-frontend-specification.md))

### Infrastructure

- [ ] Droplet 2 vCPU, 4 GB, 80 GB, Ubuntu 26.04; bootstrap script; deploy user; SSH hardening; unattended upgrades with reboot window
- [ ] DO Cloud Firewall (80/443 public only); SSH over Tailscale; break-glass port 22 rule documented ([22](22-infrastructure-devops.md) section 6.1)
- [ ] Docker daemon.json (json-file log rotation, `"ip": "127.0.0.1"`), sysctls, swap 2 GB
- [ ] Compose stack: `caddy`, `web`, `api`, `worker`, `postgres` (`postgres:18`, `shared_buffers` 768 MB), `redis` (`redis:8`), one-off `migrator` running `alembic upgrade head` ([22](22-infrastructure-devops.md)); Caddy with HTTPS routes `/api/*` to `api` and everything else to `web`
- [ ] Steady RAM measured within 2.1 to 2.8 GB; resize triggers (steady swap, cache hit ratio under 99% for a week, database over 10 GB) documented
- [ ] Platform secrets in `/etc/seo-platform/.env` (root-owned, mode 0600), written by the deploy workflow from GitHub Actions environment secrets; no SOPS, no age for secrets
- [ ] GitHub Actions: backend `uv run ruff check` and `uv run pytest`; web `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; build the three images, push to GHCR by digest, SSH deploy (pull, run `migrator`, restart `api` and `worker`, then `web`); rollback to the previous tag
- [ ] Backups: nightly `pg_dump -Fc`, zstd, age to one offline recipient pair, `rclone` to R2 `seo-backups/daily/` with a 30-day lifecycle rule; Healthchecks pings ([23](23-backup-disaster-recovery.md))
- [ ] DigitalOcean weekly droplet backups enabled on the droplet
- [ ] Monthly restore drill: `restore-verify.sh` into a temporary container; first run in Phase 1 (S-10) with dump and restore times recorded; monthly repeat scheduled
- [ ] Monitoring: Sentry (Python and Next.js SDKs), Healthchecks (planner tick, backups, maintenance, `ops_health` SQL checks), one Better Stack uptime check, alert routing ([25](25-observability.md)); logs read with `docker compose logs`

### Phase 1 security checklist

- [ ] Postgres and Redis have no published ports; external port scan shows only 80 and 443
- [ ] Redis ACL user for the api and worker (queue, rate limiter, locks, session cache); dangerous commands disabled
- [ ] Cross-tenant test suite running in CI
- [ ] Auth module reviewed: argon2id, hashed verification, reset and invitation tokens, TOTP enrolment and sign-in, `__Host-session` cookie flags, Origin check, rate limiting on sign-in
- [ ] `/etc/seo-platform/.env` root-owned with mode 0600; platform secrets exist only there and in GitHub Actions environment secrets
- [ ] Secret scanning and push protection enabled; Renovate with minimum release age
- [ ] Audit log entries for auth and membership events verified

## Phase 2: Entities and taxonomy

- [x] Tables per Phase 2 list; seeds for domain categories and PSL snapshot pinned. `core.urls` and `core.url_remap` wait for SERP ingest (step 5), publishers and domain classification rules for source intelligence (step 11)
- [x] URL canonicalizer v1 with test vectors ([14](14-citation-intelligence.md) section 3)
- [x] Domain resolver with specificity rules; `core.project_domain_roles` view
- [x] Alias automaton compiler (Aho-Corasick, negatives, possessives, domain-shaped aliases, RE2 for regex mode)
- [x] Location sync job (DataForSEO locations; a language code is checked as two ISO 639-1 letters, so no language list is synced yet)
- [x] Entities, aliases, taxonomy APIs; alias test tool. The screens are the web session's
- [x] Acceptance through the API: an own brand with domains and 5 competitors, the alias test on 20 sample answers, locations searchable after a sync (`backend/tests/api/test_onboarding.py`)

## Phase 3: SEO keyword system

- [ ] Keyword and tracked keyword APIs; config history on measurement-affecting changes
- [ ] Import pipeline (R2 upload, parse, validate, preview, confirm, report); duplicate matrix tests ([08](08-seo-keyword-system.md) section 3.3)
- [ ] Labs `keyword_overview` adapter; `keyword_metrics` workload through the task ledger; `is_material_change`
- [ ] Depth profiles, schedules API, quotas
- [ ] Rank Tracker table shell with metrics; exports

## Phase 4: SEO rank collection

- [ ] SERP adapter: submit (batches of 100), `tasks_ready` polling (60 s, 30 s while a collection window is open), sweeper, fetch, `submit_unknown` recovery via `id_list`
- [ ] Normalizer v1: organic list, grouped results, rank validation, redirect unwrap, features mapping, AIO parsing ([06](06-dataforseo-seo-integration.md) section 5)
- [ ] Ingest transaction (snapshots, features, domain ranks, AIO observation and citations, state, current results, events)
- [ ] Planner and dispatcher for `seo_rank`: staggering, deep-check weekday, fairness cap
- [ ] Retry policy per error kind; dead letters; requeue endpoint
- [ ] Cost capture per task; daily reconciliation with `user_data`
- [ ] Competitor backfill from stored snapshots
- [ ] Rank Tracker with ranks, features, AIO, competitors, sparklines; Keyword Detail v1
- [ ] SEO gold set in CI; 14-day production soak at 5,000 keywords

## Phase 5: SEO analytics

- [ ] Rollups: `seo.daily_project_metrics`, `seo.daily_page_metrics`
- [ ] `ops.ctr_curves` seeded with `ctr_v1`; visibility (both variants), estimated clicks, SEO SOV ([09](09-rank-tracking-methodology.md))
- [ ] Metric service returning `MetricValue`; version boundaries
- [ ] Cannibalization detector v1
- [ ] Alerts: rules, evaluation, digests, dedupe, flapping, anomaly hold; email and signed Slack/webhook delivery
- [ ] Overview (SEO), Landing Pages, Competitors (SEO), Alerts, Costs v1 screens
- [ ] Metric regression dataset in CI

## Phase 6: AI prompt system

- [ ] Prompts, versions (immutable, change kinds), panels, memberships with exclusion constraint and reasons
- [ ] Branded detection; prompt lint rules; bulk import
- [ ] `ai.project_engines` configuration; AI schedules
- [ ] Template keyword-to-prompt generation; manual and generated links

## Phase 7: AI collection

- [ ] LLM Scraper adapters (ChatGPT, Gemini), AI Mode adapter
- [ ] Normalizers v1 incl. ads exclusion, refusals, null vs empty semantics ([12](12-normalized-observation-schemas.md) section 4)
- [ ] Planner expansion with replicates and spacing; priority subset
- [ ] Observation list and raw answer viewer
- [ ] Two full weekly runs at 1,000 prompts x 3 engines

## Phase 8: AI extraction

- [ ] Stages 1 to 10 ([13](13-ai-extraction-engine.md)); derivations; `is_current` flips
- [ ] LLM adjudication with budget, caching, JSON validation, no tools
- [ ] Entity candidates; citation-entity links (same block)
- [ ] Re-derivation jobs on alias change and extractor upgrade
- [ ] AI gold set targets as merge gates

## Phase 9: AI analytics

- [ ] `ai.daily_prompt_engine_metrics`, denominator view, `ai.daily_domain_citations`, `ai.project_source_stats`
- [ ] Metrics A1 to A14, C1 to C9, V1 to V7, F1 to F4 ([16](16-metrics-methodology.md))
- [ ] Statistics library: Wilson (SQL and Python), fixed-panel variance, bootstrap, Newcombe, McNemar counts, BH, RBO, Jaccard
- [ ] Prompt Explorer, AI Overview tiles, statistics drawer (basic), AI alerts

## Phase 10a: Cross-channel

- [ ] Link suggestions (cluster, semantic, fan-out); accept/reject
- [ ] `core.xch_keyword_weekly`; SEO/AI matrix service and screen; AIO citation by rank bucket
- [ ] Page intelligence (SEO + AI)

## Launch readiness (MVP)

- [ ] Definition of Done met for all MVP phases ([29](29-phase-roadmap.md) section 2)
- [ ] Monthly restore drill passed in the last 30 days; RTO measured
- [ ] Budgets configured for every project; balance alerts active
- [ ] Cost reconciliation within 5% for the last 30 days
- [ ] Methodology pages published in-app for every metric shown
- [ ] Runbooks for top 12 alerts reviewed by on-call engineer ([25](25-observability.md))
- [ ] Data retention jobs verified on staging data
- [ ] Every item deferred by [29](29-phase-roadmap.md) section 1.1 is built or dropped by a recorded decision, including TOTP enforced for owner and admin

## External SaaS readiness (post-MVP)

- [ ] DataForSEO written confirmation for multi-tenant display and resale (Q-03)
- [ ] Google OAuth app verification for GSC and GA4 scopes
- [ ] DPA, privacy policy, terms; data export and deletion flows
- [ ] pgBackRest with WAL archiving (RPO minutes); consider separate DB host
- [ ] API keys and GFS backup rotation, deferred by [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) until an external offering (doc 28 triggers)
- [ ] External penetration test; fixes verified
- [ ] Counsel review of content retention and display ([30](30-risks-open-questions.md) section 2)
