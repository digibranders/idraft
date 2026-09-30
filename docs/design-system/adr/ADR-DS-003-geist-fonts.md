# ADR-DS-003: Geist Sans and Geist Mono from the geist npm package

Status: Accepted
Date: 2026-09-29

## Context
The client prefers Geist. Dense tables need tabular figures. Research on the font files (2026-09-29): Geist Sans digits are proportional by default and `tnum` exists; `next/font/google`'s Geist subset drops OpenType features beyond `tnum`; no slashed zero feature exists.

## Decision
Geist Sans for all UI text at 14 px base (13 px in table cells) with weights 400, 500, 600; Geist Mono only for IDs, keys, raw queries and code. Load from the `geist` package via `next/font/local`. Apply `tabular-nums` through the `num` utility on every compared number.

## Alternatives considered
Inter (widely used, the client asked for Geist), IBM Plex Sans (good tabular figures, heavier look), system UI stack (inconsistent across platforms), monospace for numbers (uneven typography).

## Tradeoffs
About 70 KB of variable fonts versus 29 KB for the Google subset, in exchange for full OpenType features. No slashed zero; Geist Mono is used where 0 and O must be distinguished.

## Revisit trigger
Geist drops tabular figures in a release, or measured LCP suffers from font weight.
