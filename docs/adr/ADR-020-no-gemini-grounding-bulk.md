# ADR-020: Gemini API grounding is not used for bulk measurement

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
Gemini API terms restrict caching, analyzing and programmatically collecting grounded results and require showing Search Suggestions (verified 2026-09-29).

## Decision
Gemini consumer data comes from the DataForSEO scraper; Gemini API grounding is excluded until counsel approves a compliant use.

## Alternatives considered
Use Gemini grounding as a cheap benchmark.

## Consequences
No Gemini API fan-out data in V1.

## Revisit trigger
Terms change or counsel approves a specific use.
