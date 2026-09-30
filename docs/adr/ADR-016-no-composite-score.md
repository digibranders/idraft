# ADR-016: No opaque combined visibility score

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
Commercial tools publish 0 to 100 scores with undisclosed weights. Different competitor tools compute visibility with denominators that differ by about 2x on the same data.

## Decision
Ship component metrics with denominators, and matrices with explicit thresholds. SEO visibility is a documented CTR-weighted ratio with a versioned curve; AI metrics are rates and shares.

## Alternatives considered
A master 'AI + SEO score'.

## Consequences
Harder to summarize in one number; defensible and explainable.

## Revisit trigger
None; a composite could only be added as a user-defined formula with visible weights.
