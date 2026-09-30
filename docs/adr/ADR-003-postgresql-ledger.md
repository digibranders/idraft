# ADR-003: PostgreSQL 18 as the source of truth with native monthly partitioning

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
All product data, including millions of observations per year, must be queryable, reproducible and backed up. Analytics must be fast on a small host. ClickHouse is excluded for V1.

## Decision
PostgreSQL 18 (uuidv7, lz4 TOAST, async I/O) is the ledger. Observation tables are append-only and range-partitioned by month from day one via an in-house partition function. Rollups store counts and sums; current-state tables serve hot reads. JSONB only for small, non-analytic extras. Kysely for typed SQL; SQL-file migrations.

## Alternatives considered
TimescaleDB (compression and continuous aggregates are under the Timescale License; not needed at our scale); ClickHouse now (premature, second datastore to operate); document store (weak relational integrity for our joins).

## Consequences
Strong integrity and joins across SEO, AI and first-party data; partition maintenance is our responsibility; ClickHouse can be added later from closed monthly partitions.

## Revisit trigger
Any two ClickHouse triggers in doc 28 section 8.
