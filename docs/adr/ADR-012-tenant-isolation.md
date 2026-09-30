# ADR-012: Workspace-scoped tenancy with RLS; global URL and domain dictionaries

Status: Accepted, amended by ADR-022 (2026-09-30)
Date: 2026-09-29

## Context
The product is multi-tenant (agency clients now, SaaS later). URLs and domains repeat across tenants and dominate row width.

## Decision
Tenant rows carry `workspace_id`; API connections set `app.workspace_id` per transaction with RLS policies as defense in depth; path scoping and repository enforcement are primary. `core.urls` and `core.domains` are global dictionaries readable only through tenant joins. Shared fetch cache reuses identical same-day SERP payloads across projects while each project gets its own observation rows.

## Alternatives considered
Schema per tenant (operational overhead); database per tenant (cost); no RLS (single layer of protection).

## Consequences
Strong isolation with compact storage; RLS adds a small per-transaction cost.

## Revisit trigger
Enterprise customers requiring physical isolation.

## Amendment (2026-09-30)
Changed by [ADR-022](ADR-022-python-backend-simplified-platform.md): the shared fetch cache described in the Decision is deferred to Phase 11 or later (see [ADR-017](ADR-017-shared-fetch.md)); until then each project fetches its own SERPs. Everything else stays: `workspace_id` on tenant tables, `set_config('app.workspace_id', ...)` per transaction, RLS policies, the global URL and domain dictionaries, and the cross-tenant test suite in CI.
