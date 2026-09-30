# ADR-022: Python backend, self-hosted Next.js, and the simplified V1 platform

Status: Accepted (architecture locked 2026-09-30)
Date: 2026-09-30
Supersedes: ADR-001 (language), ADR-005 (queue transport), ADR-014 (auth library), ADR-018 (readiness signal), ADR-021 (observability stack). Amends: ADR-002 (process model, host budget), ADR-012 (shared fetch cache timing), ADR-013 (retention and restore testing), ADR-017 (timing).
Diagram: [../diagrams/architecture-locked.html](../diagrams/architecture-locked.html)

## Context

The documentation package was written for a three-engineer SaaS launch on a memory-starved host. The product is being built first for one agency and its clients; a public offering is possible later but not planned. A review on 2026-09-30 kept every decision that affects what a user sees or what a number means, and removed or deferred plumbing that only pays off at a scale or a team size the project does not have.

Two stack changes were made at the same time. The backend moves to Python, because the parts of the product that are ours (extraction, canonicalization, statistics) are stronger there and the original design already expected a Python sidecar. The web app moves from Vercel to the droplet, because server rendering on Vercel would call the API across regions on every page.

## Decision

### Language and repository

| Item | Locked value |
|---|---|
| Backend | Python 3.13, FastAPI, Pydantic v2, uvicorn. Package manager `uv` |
| Frontend | Next.js (App Router), TypeScript, pnpm. Unchanged libraries: TanStack Query and Table, ECharts, shadcn/ui on Tailwind v4, the locked design system |
| Repository | `apps/web/` (Next.js), `backend/` (one Python project, two entrypoints), `data/fixtures/`, `data/gold/`, `infra/`, `docs/`. No Turborepo |
| Python layout | `backend/src/sightline/{api, worker, domain, extraction, providers, collectors, db, storage, config}` ("sightline" is the working package name) |
| Purity rules | Enforced with import-linter: `domain` and `extraction` import nothing internal and do no I/O; `providers` never imports `db`; `collectors` owns persistence |
| Contracts | Pydantic models are the contract. FastAPI generates OpenAPI 3.1. `apps/web` uses a client generated from it (`openapi-typescript` plus `openapi-fetch`), regenerated in CI and committed |

### Serving and hosting

| Item | Locked value |
|---|---|
| Host | One DigitalOcean droplet, 2 vCPU, 4 GB, 80 GB, Ubuntu 26.04, Docker Compose. Region nearest the team |
| Containers | `caddy`, `web`, `api`, `worker`, `postgres` (`postgres:18`), `redis` (`redis:8`). A `migrator` one-off runs `alembic upgrade head` during deploy |
| Origin | One domain. Caddy routes `/api/*` to `api` and everything else to `web`. No CORS, one cookie, no staging API |
| Base path | The API is served at `/api/v1` |
| Web | `output: 'standalone'`, one Node process, image built in CI. Server components call the API over the Docker network |
| Edge | Cloudflare proxied DNS is optional: static asset caching and DDoS protection. It changes nothing inside the droplet |
| Vercel | Not used |
| Steady RAM | caddy 40 MB; web 150 to 250; api 120 to 200; worker 150 to 300; postgres 1.0 to 1.3 GB (`shared_buffers` 768 MB); redis 100 to 256 (`maxmemory 256mb`); host about 400. Total 2.1 to 2.8 GB of about 3.8 usable. 2 GB swap as a safety net |
| Resize to 8 GB when | swap in steady use, or Postgres buffer cache hit ratio under 99% for a week, or the database over 10 GB |

### Data and queue

| Item | Locked value |
|---|---|
| Database | PostgreSQL 18. SQLAlchemy 2 (async, asyncpg) for application code, raw SQL for analytics, Alembic for migrations (SQL in `op.execute` is allowed). Schemas, tables, partitioning and rollups per doc 04 are unchanged |
| Database roles | `app_api` (the api container, subject to RLS), `app_worker` (the worker container, `BYPASSRLS` because planning, dispatch and maintenance read across workspaces; never reachable from a request), `migrator` (owner, runs Alembic), `backup` (read-only) |
| Tenancy | Unchanged: `workspace_id` on tenant tables, `set_config('app.workspace_id', ...)` per API transaction, RLS policies on the API role, a cross-tenant test suite in CI that covers routes and worker tasks |
| Task ledger | Unchanged: `ops.collection_tasks` rows exist before any queue job; the dispatcher checks the budget before enqueueing; retries move the row by error class; the reconciler re-enqueues from the ledger after Redis loss |
| Queue | Taskiq with `RedisStreamBroker` (acknowledged, at-least-once delivery; tasks are idempotent through the ledger). Two queues, one broker each: `collect` (provider calls, concurrency 8, shared rate limiter) and `process` (ingest, extraction, analytics, maintenance, concurrency 4). One worker process runs both receivers through `taskiq.api.run_receiver_task`. Phase 1 smoke test decides: first fallback is three Compose services from the same image (`worker-collect`, `worker-process`, `scheduler`, about 250 MB more RAM, no code change); second fallback is Celery |
| Scheduler | The planner tick runs inside the worker under a Redis lock; Taskiq's scheduler (`run_scheduler_task`) drives maintenance cron jobs in the same process. No scheduler container unless the fallback above is taken |
| Redis | Transport, rate limiter, locks, session cache. AOF on, `noeviction`. Nothing lives only in Redis |
| Readiness | Polling only: `tasks_ready` every 60 s, 30 s while a collection window is open, plus the id sweeper for tasks older than the window. No pingback endpoint |

### Auth and security

| Item | Locked value |
|---|---|
| Auth | Our own module in FastAPI: argon2id passwords, opaque session ids in `auth.sessions` with a 60 s Redis read-through cache, email verification and password reset with hashed tokens, invitations, roles per doc 24 section 3, TOTP (pyotp) required for owner and admin |
| Cookie | `__Host-session`, HttpOnly, Secure, SameSite=Lax, Path=/. Same origin, so no parent-domain cookie |
| CSRF | SameSite=Lax plus an Origin check on state-changing requests |
| Deferred | Google OIDC, API keys and the Idempotency-Key header (tables may exist, no routes), envelope encryption of tenant credentials (arrives with first-party integrations, Phase 12) |
| Platform secrets | `/etc/seo-platform/.env`, root-owned, mode 0600, written by the deploy workflow from GitHub Actions environment secrets. The backup job's R2 token lives in a separate root-only `backup.env` so no app container ever holds it. No SOPS, no age for secrets |

### Operations

| Item | Locked value |
|---|---|
| CI/CD | GitHub Actions: lint, typecheck, tests, build the three images (`seo-web`, and `seo-api` and `seo-worker` as two targets of one `backend/` Dockerfile), push to GHCR by digest, SSH deploy: pull, run `migrator`, restart `api` and `worker`, then `web`. Rollback is the previous tag |
| Errors and performance | Sentry (Python SDK and Next.js SDK, 10% performance sampling) |
| Heartbeats | Healthchecks.io for the planner tick, backups, maintenance, the `ops_health` SQL checks, the host check (`seo-hostcheck.timer`: disk, swap, OOM kills, container health, which is what feeds the resize triggers) and the monthly restore drill |
| Uptime | One external uptime check (Better Stack free tier) on `/api/healthz`; the `web` container is covered by the host check |
| Logs | Structured JSON to stdout, Docker json-file driver with rotation, read with `docker compose logs`. No log shipping |
| Metrics | None exported. The in-app Operations screen reads `ops.collection_tasks`, `ops.collection_runs`, `ops.cost_daily` and `ops.slo_samples` (sampled indicators, 90 days). No Prometheus, Alloy, Grafana or `/metrics` |
| Backups | Nightly `pg_dump -Fc`, zstd, age-encrypted to one offline recipient pair, `rclone` to R2 `seo-backups/daily/` with a 30-day lifecycle rule; DigitalOcean weekly droplet backups enabled; a scripted restore drill (`restore-verify.sh` into a temporary container) run monthly and recorded. No GFS rotation, no bucket lock, no CI restore workflow, no `restore-test` identity, no second copy of `ai_raw` |
| Recovery objectives | RPO 24 h, RTO 4 h, unchanged. PITR remains the trigger-based later step |

### Testing

| Item | Locked value |
|---|---|
| Backend | pytest, Testcontainers (`postgres:18`, `redis:8`), Hypothesis where it earns its keep; coverage targets per package kept |
| Frontend | Vitest for units, Playwright for the key flows |
| Fixtures | Recorded provider responses with schema hashes, unchanged. The schema hash check runs in the normal test suite; no nightly drift canary |
| Gold sets | 100 SERPs and 100 AI answers at V1, single annotation, grown from real bugs. Targets in doc 26 apply to that size |

### Phases

| Phase | Change |
|---|---|
| 0 (about 1 week) | S-01 to S-06 (DataForSEO), S-09 (synthetic dataset), S-11 (canonicalizer). S-07 (Better Auth) and S-08 (BullMQ load) dropped. S-10 (restore drill) becomes Phase 1 work |
| 1 (about 3.5 weeks) | Backend skeleton, schemas and RLS, task ledger and price book, auth, worker with dispatcher and DataForSEO client, Next.js shell with the generated client, droplet bootstrap, Compose, deploy pipeline, backups, Sentry, Healthchecks |
| 2 to 10a | Scope unchanged, including budgeted LLM adjudication (Phase 8) and the multiple-comparison filter (Phase 9). Estimates are re-checked at the end of Phase 1 |

## Alternatives considered

- Keep the TypeScript backend (ADR-001). Rejected: the product's own logic wants Python's libraries, and two backends would follow within a year.
- Keep Better Auth. Not possible with a Python API. fastapi-users was considered and rejected: maintenance mode, no 2FA, ORM lock-in.
- arq for the queue. Rejected: maintenance-only. Celery: sync-first, awkward for an async HTTP collector; kept as the fallback.
- Next.js on Vercel with the region pinned near the droplet. Rejected: still a network hop per server-rendered request, a second deploy target, cross-domain cookies and CORS, per-seat cost.
- Postgres-only queue (pg-boss style, in Python: Procrastinate). Viable at this load; rejected because Redis is also the rate limiter, lock and session cache, and Taskiq is the cleaner fit for async collection.
- Keep the full observability stack. Rejected: it competed with Postgres for RAM and duplicated what the task ledger already records.

## Consequences

- The TypeScript contract package is gone; the contract is the OpenAPI document. Any drift between API and client fails CI at client generation.
- One less language in the backend, two toolchains in the repo.
- Phase 1 effort drops from about 6 to about 3.5 engineer-weeks; Phase 0 from 3 weeks to about 1.
- Fixed monthly cost about $30 at the start: droplet $24, DigitalOcean backups $4.80, R2 about $1 (growing to $1.50 to $6 by month 12 as raw payloads and 30 daily dumps accumulate, doc 23 section 14.4); Sentry, Healthchecks and Better Stack on free tiers.
- Nothing here blocks a later public offering. The items it would need (API keys, encrypted tenant credentials, PITR, GFS backups) are listed as triggers in doc 28.

## Revisit trigger

The tool is offered to outside companies; the collection window overruns twice in a month; Taskiq fails its smoke test; a Python-only or a Node-only capability becomes central to a phase.
