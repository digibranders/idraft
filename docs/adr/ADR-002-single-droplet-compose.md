# ADR-002: Single DigitalOcean droplet with Docker Compose for V1

Status: Accepted, amended by ADR-022 (2026-09-30)
Date: 2026-09-29

## Context
Constraint: one $24/month droplet (2 vCPU, 4 GB, 80 GB) must run API, workers, scheduler, PostgreSQL, Redis and backups. No Kubernetes, no multiple servers in V1.

## Decision
Run all backend services as Docker Compose services on Ubuntu 26.04 LTS behind Caddy, with DO Cloud Firewall, SSH hardening, memory limits per container, 2 GB swap as safety, and documented scaling steps (resize, Volume, separate DB droplet, second worker droplet).

## Alternatives considered
Managed PostgreSQL/Redis (excluded by constraint and cost); Kubernetes (operational overhead); bare systemd services without containers (harder reproducibility and deploys).

## Consequences
Simple operations and low cost; the host is a single point of failure, mitigated by nightly encrypted backups, weekly restore tests and a rebuild runbook (RTO 4 h). Capacity analysis shows V1 load fits (doc 22, doc 28).

## Revisit trigger
Any trigger in doc 28 section 7 (swap, cache hit ratio, disk projection, API latency during collection).

## Amendment (2026-09-30)
Changed by [ADR-022](ADR-022-python-backend-simplified-platform.md):

- Process model: the Compose services are `caddy`, `web`, `api`, `worker`, `postgres` (`postgres:18`) and `redis` (`redis:8`), plus a one-off `migrator` that runs `alembic upgrade head` during deploy. There is no scheduler container; the planner tick runs inside the worker under a Redis lock. The Next.js app runs on the droplet as `web` instead of on Vercel, and Caddy routes `/api/*` to `api` and everything else to `web` on one domain.
- Host: 2 vCPU, 4 GB, 80 GB, 2 GB swap as a safety net. Resize to 8 GB when swap is in steady use, or the Postgres buffer cache hit ratio is under 99% for a week, or the database is over 10 GB.
- The RAM budget table (doc 22 section 3.1) is replaced by these figures: caddy 40 MB; web 150 to 250 MB; api 120 to 200 MB; worker 150 to 300 MB; postgres 1.0 to 1.3 GB (`shared_buffers` 768 MB); redis 100 to 256 MB (`maxmemory 256mb`); host about 400 MB. Total 2.1 to 2.8 GB of about 3.8 GB usable.
- The weekly restore tests named under Consequences are now a monthly scripted restore drill (see the ADR-013 amendment).
