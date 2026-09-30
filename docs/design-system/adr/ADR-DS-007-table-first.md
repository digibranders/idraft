# ADR-DS-007: Table-first analytics

Status: Accepted
Date: 2026-09-29

## Context
Users compare, sort, filter and act on thousands of keywords, prompts and citations. Card grids and KPI tiles waste space and prevent comparison.

## Decision
Any list of records is a DataTable; summaries are a MetricStrip; cards only for grouped summaries, small non-compared collections, previews and spatial information.

## Alternatives considered
Card-based dashboards (familiar in templates, poor for analysis).

## Tradeoffs
Screens look less decorative; power users get more information per viewport.

## Revisit trigger
User research shows a specific workflow is better served by another representation.
