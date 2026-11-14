# WP-47: Alerts backend: rules, events, evaluation, AI rule types, digests

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-47-alerts-api` in `.claude/worktrees/wp-47` (`infra/dev/wp-start WP-47 alerts-api`) |
| Depends on (merged on develop first) | [WP-01 backend-scaffold](WP-01-backend-scaffold.md), [WP-14 sources-lane](WP-14-sources-lane.md) |
| Owner decisions | none |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 14 (built already: 0, to do: 14) |

## Goal

The alert tables, rule types, rule CRUD with test and preview backtest, events with acknowledge, anomaly hold and flapping mute, the debounced `evaluate_alerts` job, the AI rule types that need no detectability first (`ai_model_changed`, `ai_collection_degraded`, `ai_new_source`, `ai_citation_lost/gained`, `ai_competitor_sov_overtake`), and digests with email. The mention and panel change types come after the statistics package (dependency noted in their tasks).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/11 section 10
- docs/19 3.11.5
- docs/04 11.5
- docs/21 5.2

## Files this package owns

- `backend/src/idraft/api/alerts/ (new)`
- `backend/src/idraft/alerts/ (new job)`
- `backend/src/idraft/db/migrations/versions/<next>_alerts.py`
- `backend/tests/api/alerts/`

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

Contract C11, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; two Sonnet implementers (tables and routes; job and rule types); one Sonnet reviewer; prove-it-bites on tenant scope and the debounce.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-47 alerts-api`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-47-alerts-api.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Contract, tables, rule types, CRUD, test, preview | CF-23, BE-ALERTS-01..03 |
| 2 | Events, acknowledge, hold and mute; evaluate job | BE-ALERTS-04, BE-ALERTS-05 |
| 3 | AI rule types without detectability | BE-ALERTS-07, BE-ALERTS-09..12 |
| 4 | Mention and panel change types (after statistics) | BE-ALERTS-06, BE-ALERTS-08 |
| 5 | Digests and email | BE-ALERTS-13 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- An alert type that needs detectability says "possible change" until the statistics package lands
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

- One commit per task, message `WP-47: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-47 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-47 <status> | branch ai/wp-47-alerts-api @ <short sha> | rows done <n>/14 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-23 | CF | SPEC | Alert rules, events, digests, notifications |
| BE-ALERTS-01 | BE | NOT BUILT | Tables `ops.alert_rules`, `ops.alert_events`, `ops.alert_digests`, `op |
| BE-ALERTS-02 | BE | NOT BUILT | `GET /api/v1/alert-rule-types`, `{P}/alert-rules` CRUD, `.../test` |
| BE-ALERTS-03 | BE | NOT BUILT | `POST {P}/alert-rules/preview` backtest (count of matches in the last  |
| BE-ALERTS-04 | BE | NOT BUILT | `GET {P}/alert-events`, `POST .../acknowledge`; anomaly hold, flapping |
| BE-ALERTS-05 | BE | NOT BUILT | `evaluate_alerts` job (debounced 10 minutes) |
| BE-ALERTS-06 | BE | NOT BUILT | `ai_mention_lost`, `ai_mention_gained` (prompt engine, at least 2 answ |
| BE-ALERTS-07 | BE | NOT BUILT | `ai_citation_lost`, `ai_citation_gained` |
| BE-ALERTS-08 | BE | NOT BUILT | `ai_panel_change` (paired 95% interval excludes zero, weekly) |
| BE-ALERTS-09 | BE | NOT BUILT | `ai_competitor_sov_overtake` per topic |
| BE-ALERTS-10 | BE | NOT BUILT | `ai_new_source` (domain crosses `min_support` in a topic for the first |
| BE-ALERTS-11 | BE | NOT BUILT | `ai_model_changed` (new `model_reported` per engine, makes a version b |
| BE-ALERTS-12 | BE | NOT BUILT | `ai_collection_degraded` (valid rate under 90% for an engine in a run; |
| BE-ALERTS-13 | BE | NOT BUILT | Digests: `GET {P}/alert-digests`, `.../{id}`; email delivery (daily or |
