# ADR-007: Organic rank is the canonical rank; depth-aware nulls

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
DataForSEO exposes `rank_group` (position within the same item type), `rank_absolute` (position among all elements) and `position` (left/right alignment). Since September 2025 depth is billed per 10 results, so most daily checks will not cover 100 positions.

## Decision
Canonical rank = organic `rank_group`. Absolute rank stored as secondary. Ranks beyond requested depth are NULL with `depth_requested`, displayed as 'not in top N'; averages use ranked keywords with counts; top-100 metrics come only from deep checks.

## Alternatives considered
Absolute rank as canonical (moves when features appear); imputing rank 100/101 for unranked (averages depend on keyword count); daily top-100 for all keywords (10x cost).

## Consequences
Stable, comparable history; honest handling of partial depth; users see both organic and absolute when layout changes matter.

## Revisit trigger
A provider cannot supply organic group rank; or product need for pixel-based position (then add `calculate_rectangles`).
