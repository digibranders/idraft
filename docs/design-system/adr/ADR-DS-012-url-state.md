# ADR-DS-012: URL-driven view state

Status: Accepted
Date: 2026-09-29

## Context
Analytical views must be shareable and reproducible (alerts, digests, collaboration).

## Decision
Filters, window, compare, sort, search, saved view, inspected record and tabs live in the URL through shared nuqs parsers. Filter, sort and search changes replace history entries. Opening the inspector (`inspect`), page tab changes (`tab`) and saved view changes (`view`) push. Inspector tab changes (`itab`) and moving between records replace, so Back closes the inspector instead of stepping through tabs or records ([16-drawers-dialogs-popovers.md](../16-drawers-dialogs-popovers.md) section 2.7, [23-application-patterns.md](../23-application-patterns.md) section 15).

## Alternatives considered
Local component state (not shareable), global stores synced to localStorage (not shareable, stale).

## Tradeoffs
Parsers must be versioned and tolerant of invalid values.

## Revisit trigger
URLs exceed practical length for common views (then saved views carry the state and the URL carries the view id).
