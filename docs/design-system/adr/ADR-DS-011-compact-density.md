# ADR-DS-011: Density modes: Default (40 px rows) and Compact (32 px rows)

Status: Accepted; values revised by [ADR-DS-018](ADR-DS-018-visual-v2-reference-screens.md)
Date: 2026-09-29

## Context
Power users need many rows per screen. Reference products use 28 to 36 px rows (Carbon, Grafana, Datadog). Targets must stay at least 24 px (WCAG 2.5.8).

## Decision
36 px controls and 40 px rows by default, 32 px small controls for pagination and icon buttons in tables and inspectors, and Compact density (32 px rows) as a per-table user option. Tables embedded in panels and inspectors always use 32 px rows. Density changes row height only, never font size. (Until ADR-DS-018 the default was 32 px controls and rows, with 40 px rows as a larger optional density; that option no longer exists.)

## Alternatives considered
32 px default rows (the v1 default, rejected in ADR-DS-018 in favor of the reference screens), 28 px rows (cramped with sparklines and badges).

## Tradeoffs
About 11 rows visible at 1440 x 900 below the header, metric strip, filters, 48 px table toolbar and 48 px table footer in Default density, 14 in Compact ([24-page-templates.md](../24-page-templates.md) section 4).

## Revisit trigger
Usage data shows most users switch to Compact.
