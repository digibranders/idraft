# ADR-DS-017: Arrows for rank changes, signs for metric changes

Status: Accepted
Date: 2026-09-29

## Context
A signed rank change is ambiguous because rank 1 is best: minus five can mean an improvement.

## Decision
Rank changes display as `↑5` (improved) or `↓3` (declined), `New`, `Lost`; metric changes display as signed values in their unit (`+5.3 pts`, `+12`, `+12.4%`). One indicator per value, never arrow plus sign plus color alone. Implemented by `formatRankChange` and `formatMetricDelta`.

## Alternatives considered
Signed rank deltas, arrows for everything, color only.

## Tradeoffs
Two conventions to learn, each unambiguous in its domain.

## Revisit trigger
User testing shows confusion between the two conventions.
