# ADR-008: Five observation classes are never silently merged

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
Consumer UI answers, official API answers, SERP AI surfaces, first-party data and organic rank data measure different things.

## Decision
Every observation carries `observation_class`; metric functions require it; cross-engine summaries are explicit equal-weight averages shown next to per-engine values; first-party metrics are always labeled with their source.

## Alternatives considered
Pooling all AI answers into one 'AI visibility' number (hides engine differences and sample imbalance).

## Consequences
More numbers on screen; far fewer misleading ones.

## Revisit trigger
None expected.
