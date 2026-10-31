# ADR-021: Low-footprint observability on free tiers

Status: Superseded by ADR-022 (2026-09-30)
Date: 2026-09-29

## Superseded
Replaced by [ADR-022](ADR-022-python-backend-simplified-platform.md): observability is Sentry (Python and Next.js SDKs, 10% performance sampling), Healthchecks.io heartbeats and one Better Stack uptime check, with structured JSON logs read through `docker compose logs` and no exported metrics. Grafana Alloy and Grafana Cloud are dropped because the agent competed with Postgres for RAM and duplicated what the task ledger already records.

## Context
4 GB RAM leaves little room for agents. We need errors, metrics, logs, heartbeats and uptime.

## Decision
Sentry (errors), Healthchecks.io (timers and heartbeats), Better Stack (external uptime), Grafana Alloy capped at 128 MB, running as a host systemd service without the Docker socket, shipping metrics and logs to Grafana Cloud free (Beszel on the host is the documented fallback if Alloy fails its Phase 2 memory gate); collection, cost and data-quality checks run as scheduled SQL jobs (`ops_health`, `dq_daily`) so they alert even if Grafana is unreachable. Details in doc 25.

## Alternatives considered
Netdata (250 to 350 MB), full Prometheus + Grafana on the droplet, paid APM.

## Consequences
Zero cost within free tiers; retention limited (14 days logs).

## Revisit trigger
Free-tier limits exceeded or team size grows beyond free seats.

## Amendment (2026-10-31)
Host note only: "4 GB RAM" and "the droplet" above describe the original host. The current host is the idraft 8 GB share of a shared Hostinger VPS ([ADR-023](ADR-023-shared-hostinger-vps.md)); disk alerts must count both projects on the host. This ADR remains superseded by ADR-022.
