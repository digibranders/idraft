# ADR-002: Single-host Docker Compose for V1

Status: Accepted, amended by ADR-022 and ADR-023
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

## Amendment (2026-10-31)
Changed by [ADR-023](ADR-023-shared-hostinger-vps.md). The single-host Compose decision stands; the host description above is history. The title was "Single DigitalOcean droplet with Docker Compose for V1" until this amendment.

- Host: a Hostinger VPS (Ubuntu 24.04, 4 vCPU, 16 GB RAM, 193 GB disk, 2 GB swap) shared with a second project, not a dedicated DigitalOcean droplet. The "$24/month" constraint is gone; fixed cost is H (50% of the Hostinger invoice, owner fills in) plus R2 about $1.
- Sizes: idraft is capped at 8 GB RAM (soft limit 7 GB) by the systemd slice `idraft.slice`, with fair-share CPU. The 8 GB profile (Postgres `shared_buffers` 2 GB) is the baseline; the 4 GB profile is the laptop and CI profile only. The RAM budget from the ADR-022 amendment is superseded by doc 22.
- Edge and firewall: a shared host-level edge proxy owns ports 80 and 443 (open decision D-H2 in doc 30); the idraft `caddy` service is the loopback-only application gateway. The firewall is Hostinger hPanel plus `ufw`; the DigitalOcean Cloud Firewall is removed.
- Backups: the nightly encrypted dump to R2 is unchanged; Hostinger snapshots (verify in hPanel) replace the DigitalOcean weekly droplet backups as the second copy (see the ADR-013 amendment).
- Scaling ladder: the "resize, Volume, separate DB droplet, second worker droplet" steps are replaced by: run in the 8 GB share, then move idraft to its own 16 GB VPS, then 32 GB, then a separate database host. Triggers are in doc 28 section 7.
