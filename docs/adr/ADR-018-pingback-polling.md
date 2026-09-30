# ADR-018: Pingback plus polling for task readiness, not postback

Status: Superseded by ADR-022 (2026-09-30)
Date: 2026-09-29

## Superseded
Replaced by [ADR-022](ADR-022-python-backend-simplified-platform.md): readiness is polling only, `tasks_ready` every 60 s (30 s while a collection window is open) plus the id sweeper for tasks older than the window; there is no pingback endpoint. At V1 volume the faster poll costs little, and dropping the tokenized, IP-allowlisted callback route removes a public surface from the API.

## Context
DataForSEO supports postback (full result POSTed to us) and pingback (GET notification). Both time out after 10 s; failed deliveries appear in `tasks_ready`.

## Decision
Use pingback to a tokenized, IP-allowlisted route that only enqueues a fetch; poll `tasks_ready` every 2 minutes as fallback; sweep old submitted tasks by id.

## Alternatives considered
Postback (large bodies on the API process within a 10 s deadline); polling only (slower, more calls).

## Consequences
Tiny API work per callback; one extra free GET per task.

## Revisit trigger
Provider changes callback semantics or adds signed postbacks with retries.
