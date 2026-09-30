# ADR-019: Tiered SERP depth with the standard profile as default

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
Top-100 daily costs 10x top-10 daily; most value is in the top 20.

## Decision
Depth profiles per keyword or group; default `standard` = top 20 daily plus top 100 weekly on a project weekday (about $0.057 per keyword per month on the standard queue).

## Alternatives considered
Top 100 daily (about $0.18 per keyword per month); top 10 only (loses page 2 movement).

## Consequences
Daily precision where it matters; weekly full distribution; depth-aware metrics required.

## Revisit trigger
Provider pricing changes, or customers need daily page 3 to 10 tracking for many keywords.
