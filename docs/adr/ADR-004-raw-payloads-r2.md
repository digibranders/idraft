# ADR-004: Raw provider payloads in Cloudflare R2, normalized facts in PostgreSQL

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
Raw SERP JSON is 100 KB to 600 KB uncompressed per check; storing it in PostgreSQL would exhaust the 80 GB disk within months. Raw evidence must be kept for re-parsing and audit.

## Decision
Write every provider response, zstd-compressed, to R2 before normalization; register it in `ops.raw_payloads` (sha256, size, key, retention class). PostgreSQL stores compact normalized facts (organic URL id arrays, features, domain ranks) and AI answer text. Keys follow `raw/v1/<retention_class>/<provider>/<endpoint_slug>/<yyyy>/<mm>/<dd>/<sha256>.json.zst` so R2 lifecycle rules can expire by prefix. Retention by class: `serp_raw` 400 days (deep checks included), `ai_raw` indefinite, `first_party_raw` 90 days, `error` 30 days (doc 23 section 9).

## Alternatives considered
PostgreSQL JSONB for raw (disk growth, backup size); local disk only (no off-host copy); no raw retention (no re-parse after parser fixes).

## Consequences
Cheap storage with free egress; re-ingest is the same code path as ingest; R2 availability is needed only for raw views and re-parse, not for dashboards. SERP and first-party raw payloads have a single copy; `ai_raw` has a weekly replica in a separate Cloudflare account (doc 23 section 9.5; risk R-10).

## Revisit trigger
R2 pricing or reliability changes; a need to query raw SERP content interactively at scale.
