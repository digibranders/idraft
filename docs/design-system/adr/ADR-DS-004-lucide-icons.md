# ADR-DS-004: Lucide as the single icon library

Status: Accepted
Date: 2026-09-29

## Context
Mixed icon sets look inconsistent. Lucide is the shadcn default. Lucide v1 (1.48 at 2026-09-29) removed brand icons, sets `aria-hidden` by default, and replaces `absoluteStrokeWidth` with `nonScalingStroke`.

## Decision
Lucide only, through an `Icon` wrapper and `LucideProvider` (stroke 1.75, 16 px default, 14 px in tables, 18 px in the sidebar). Fixed glyph assignments per concept. Engine logos are not icons and do not come from Lucide: see ADR-DS-020, which replaces the earlier "no engine or vendor logos in V1" rule.

## Alternatives considered
Phosphor (larger set, different style), Tabler, custom icon set (design cost).

## Tradeoffs
Some concepts need a text label instead of a perfect glyph. Engine badges are text-only until trademark permission and a monochrome glyph set exist.

## Revisit trigger
A required concept has no acceptable Lucide glyph for more than three features, or brand logos are licensed.
