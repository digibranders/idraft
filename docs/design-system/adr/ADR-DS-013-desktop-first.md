# ADR-DS-013: Desktop-first responsive approach

Status: Accepted
Date: 2026-09-29

## Context
The product is used at 1440 to 1920 px by analysts; mobile use is monitoring.

## Decision
Design at 1440 first; full capability at 1280 and above; tablet for review and triage with collapsed chrome and column priorities; mobile for monitoring and simple inspection with list rows instead of wide tables.

## Alternatives considered
Mobile-first (constrains density), desktop-only (excludes quick checks on phones).

## Tradeoffs
Some workflows (bulk editing, imports, column customization) are desktop-only and say so.

## Revisit trigger
Mobile usage exceeds 15% of sessions for a workflow.
