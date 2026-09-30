# ADR-006: DataForSEO as primary provider behind an adapter contract; fallbacks built on trigger

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
We need Google SERPs with features and AI Overviews, Google AI Mode, ChatGPT and Gemini consumer surfaces, and keyword data at low cost. Cloro is excluded. Vendors differ in depth billing, rank semantics, AIO retrieval and AI schemas; Google changes SERPs frequently.

## Decision
Use DataForSEO for all V1 collection (standard queue by default). Define a `ProviderAdapter` contract (validate, fingerprint, estimateCost, submit, listReady, fetch, live, normalize, classifyError) and canonical schemas. Build fallback adapters (Oxylabs or Bright Data for SEO; SearchAPI.io for AI) only when a documented trigger fires.

## Alternatives considered
SerpApi (4x to 20x cost at top-100, litigation); building our own scrapers (legal, anti-bot and maintenance cost); multi-vendor from day one (cost of parity work without need).

## Consequences
One account and billing model; vendor concentration risk (R-01) mitigated by the contract, raw retention and evaluated fallbacks.

## Revisit trigger
Error rate > 5% for 24 h; standard-queue p95 > 6 h for 3 days; price increase > 30%; required surface unavailable.
