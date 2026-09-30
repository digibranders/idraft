# Architecture Decision Records

| ADR | Decision |
|---|---|
| [ADR-001](ADR-001-typescript-monorepo.md) | TypeScript monorepo for all application code (superseded by ADR-022) |
| [ADR-002](ADR-002-single-droplet-compose.md) | Single DigitalOcean droplet with Docker Compose for V1 (amended by ADR-022) |
| [ADR-003](ADR-003-postgresql-ledger.md) | PostgreSQL 18 as the source of truth with native monthly partitioning |
| [ADR-004](ADR-004-raw-payloads-r2.md) | Raw provider payloads in Cloudflare R2, normalized facts in PostgreSQL |
| [ADR-005](ADR-005-queue-bullmq-postgres-ledger.md) | BullMQ on Redis for transport; PostgreSQL task table as the ledger (superseded by ADR-022) |
| [ADR-006](ADR-006-dataforseo-primary-adapters.md) | DataForSEO as primary provider behind an adapter contract; fallbacks built on trigger |
| [ADR-007](ADR-007-organic-rank-canonical.md) | Organic rank is the canonical rank; depth-aware nulls |
| [ADR-008](ADR-008-observation-classes.md) | Five observation classes are never silently merged |
| [ADR-009](ADR-009-mention-citation-separate.md) | Brand mention and domain citation are separate facts |
| [ADR-010](ADR-010-replicate-measurement.md) | Replicate-based AI measurement with honest intervals |
| [ADR-011](ADR-011-keyword-prompt-links.md) | Keywords and prompts are separate entities with typed many-to-many links |
| [ADR-012](ADR-012-tenant-isolation.md) | Workspace-scoped tenancy with RLS; global URL and domain dictionaries (amended by ADR-022) |
| [ADR-013](ADR-013-backups.md) | Nightly pg_dump with age encryption to R2; pgBackRest for PITR later (amended by ADR-022) |
| [ADR-014](ADR-014-better-auth.md) | Better Auth for authentication, organizations and API keys (superseded by ADR-022) |
| [ADR-015](ADR-015-extraction-deterministic-first.md) | Deterministic extraction first; budgeted LLM adjudication |
| [ADR-016](ADR-016-no-composite-score.md) | No opaque combined visibility score |
| [ADR-017](ADR-017-shared-fetch.md) | Shared fetch, private observations (amended by ADR-022) |
| [ADR-018](ADR-018-pingback-polling.md) | Pingback plus polling for task readiness, not postback (superseded by ADR-022) |
| [ADR-019](ADR-019-depth-profiles.md) | Tiered SERP depth with the standard profile as default |
| [ADR-020](ADR-020-no-gemini-grounding-bulk.md) | Gemini API grounding is not used for bulk measurement |
| [ADR-021](ADR-021-observability-stack.md) | Low-footprint observability on free tiers (superseded by ADR-022) |
| [ADR-022](ADR-022-python-backend-simplified-platform.md) | Python backend, self-hosted Next.js, and the simplified V1 platform (architecture locked 2026-09-30) |
