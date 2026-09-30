# ADR-017: Shared fetch, private observations

Status: Accepted, amended by ADR-022 (2026-09-30)
Date: 2026-09-29

## Context
Several projects in a workspace (or across workspaces) can track the same keyword, location and device on the same day.

## Decision
Identical SERP request fingerprints on the same UTC date are fetched once; later consumers create their own observation rows pointing to the same raw payload with zero-cost cost events. AI prompt replicates are never served from cache.

## Alternatives considered
No sharing (duplicate spend); shared observation rows across tenants (breaks tenancy model).

## Consequences
Lower cost at scale with clean tenancy.

## Revisit trigger
None expected.

## Amendment (2026-09-30)
Changed by [ADR-022](ADR-022-python-backend-simplified-platform.md): timing only. The shared fetch cache is built in Phase 11 or later, not in V1; until then each project fetches its own SERPs. The decision is unchanged: when built, identical same-day fingerprints are fetched once, each consumer gets its own observation rows, and AI prompt replicates are never served from cache.
