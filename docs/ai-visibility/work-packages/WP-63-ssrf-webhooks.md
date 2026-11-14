# WP-63: SSRF-safe fetcher and outbound webhooks

| Field | Value |
|---|---|
| Wave | W5: Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-63-ssrf-webhooks` in `.claude/worktrees/wp-63` (`infra/dev/wp-start WP-63 ssrf-webhooks`) |
| Depends on (merged on develop first) | [WP-47 alerts-api](WP-47-alerts-api.md) |
| Owner decisions | none |
| Estimate | 7 Sonnet-agent tasks, about 5 hours with one task in flight |
| Rows | 2 (built already: 0, to do: 2) |

## Goal

The SSRF-safe fetch service of doc 24 7.3 (shared by webhooks, readiness checks and discovery crawls) and outbound webhooks (endpoints, test, rotate secret, deliveries, redeliver, signed payloads).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/24 sections 7.3 and 14
- docs/19 3.11.5 webhooks

## Files this package owns

- `backend/src/idraft/fetch/ (new)`
- `backend/src/idraft/api/webhooks/ (new)`
- `backend/src/idraft/db/migrations/versions/<next>_webhooks.py`

## Files it must not touch

- Any file another work package owns (each WP file lists its own); ask the coordinator for a lease instead
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` except by regeneration in the same push as your own API change
- `backend/src/idraft/api/main.py`, `permissions.py`, `problems.py`, `resources.py` (WP-01 registered everything); new problem codes go in your own module as `ProblemError` subclasses
- `apps/web/src/lib/navigation/registry.ts` except flipping your own page's status to `live`
- `apps/web/src/mocks/handlers/index.ts` (WP-02 registered your handler module)
- `apps/web/e2e/support.ts` (add `apps/web/e2e/support/<slug>.ts` instead)
- Message namespaces of other packages in `apps/web/messages/en.json`
- `docs/ai-visibility/tracker.json` and `TRACKER.md` (the coordinator owns them)
- The main checkout, `.claude/worktrees/release`, Colima and the `idraft-dev-*` containers

## Contract

Webhook routes under `{W}/webhook-endpoints`, pushed first with stubs.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans and reviews the fetcher; one Sonnet implementer per part; prove-it-bites with the blocklist unit tests (private ranges, redirects, DNS rebinding).

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-63 ssrf-webhooks`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-63-ssrf-webhooks.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Fetcher with blocklist tests | BE-GEO-01 |
| 2 | Webhooks | BE-ALERTS-14 |
| 3 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Every private range, a redirect to one and a rebinding answer are refused (tests)
- Every new route has its access line in `test_route_access.py` and is scanned by `test_cross_tenant.py` (inside the package's anchor block); every new table has RLS, grants and a `_TENANT_ROWS` entry
- Aggregates are one grouped query with a statement count test; new expensive parts are opt-in (`include=` or a parameter) and absent unless asked; branded prompts excluded by default
- `backend/openapi/v1.json` regenerated (`cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`) and, in the same push, `pnpm gen:api` and `pnpm typecheck` in apps/web
- Targeted pytest (`--no-cov`, `-n 2`) in the medium lane during work; `./check.sh` through `infra/dev/heavy` before the last push
- No real provider or LLM call in any test or check
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- Prove it bites (risky code: money, tenants, locks, cursors, statistics): for every guard the package adds, the reviewer removes or weakens it in a scratch commit that is never pushed, runs the targeted test, records that it fails, and restores the guard; the list of guards and the failing test names go into the package report
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-63: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-63 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-63 <status> | branch ai/wp-63-ssrf-webhooks @ <short sha> | rows done <n>/2 | steps <n>/4 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-GEO-01 | BE | NOT BUILT | SSRF-safe fetch service (http, https, ports 80 and 443, resolved IP ch |
| BE-ALERTS-14 | BE | NOT BUILT | Outbound webhooks (Slack, custom URL): endpoints, test, rotate secret, |
