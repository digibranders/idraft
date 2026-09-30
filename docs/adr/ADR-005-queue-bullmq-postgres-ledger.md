# ADR-005: BullMQ on Redis for transport; PostgreSQL task table as the ledger

Status: Superseded by ADR-022 (2026-09-30)
Date: 2026-09-29

## Superseded
Replaced by [ADR-022](ADR-022-python-backend-simplified-platform.md): the transport is Taskiq with the Redis broker, running two queues (`collect` and `process`) in one worker process, with Celery as the fallback if Taskiq fails its Phase 1 smoke test. BullMQ has no Python client; the PostgreSQL task ledger described below is unchanged and carries over.

## Context
Paid provider work must never be lost or duplicated. We need priorities, rate limiting, delayed work, debouncing and job schedulers on a small host. BullMQ 6.0 (2026-07-30) removed `repeat` and `debounce` in favor of job schedulers and deduplication, and added an experimental PostgreSQL backend.

## Decision
Every unit of paid work is a row in `ops.collection_tasks` created by a planner; a dispatcher moves due tasks into BullMQ queues split by resource profile; retries are driven by task state and an error taxonomy (BullMQ attempts = 1 for provider jobs); a reconciler rebuilds in-flight work from PostgreSQL after Redis loss. Redis 8 with `noeviction` and AOF.

## Alternatives considered
Delayed BullMQ jobs as the schedule (state only in Redis); pg-boss or graphile-worker (Postgres-native, fewer features for rate limiting across queues); BullMQ PostgreSQL backend (new, slower per its own docs); BullMQ Pro groups (paid) for fairness.

## Consequences
No double submission on retries; schedule queryable in SQL; Redis loss is an inconvenience, not data loss; fairness implemented in the dispatcher query.

## Revisit trigger
BullMQ PostgreSQL backend matures and removing Redis would free meaningful memory; or queue throughput needs exceed a single Redis.
