# ADR-009: Brand mention and domain citation are separate facts

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
An answer can mention a brand without citing its domain, cite the domain without mentioning the brand, both, or neither. Each case has a different meaning and a different action.

## Decision
Mentions come from text extraction; citations from the citation list with domain role resolution. Metrics expose the four-outcome mix; no metric collapses them. Domain names written in text count as mentions, not citations.

## Alternatives considered
A single 'visible' boolean.

## Consequences
Clear source-visibility vs brand-visibility analysis; more complex UI, handled with the outcome mix component.

## Revisit trigger
None expected.
