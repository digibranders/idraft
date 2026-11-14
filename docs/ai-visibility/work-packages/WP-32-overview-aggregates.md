# WP-32: Overview aggregate routes and the competitors read

| Field | Value |
|---|---|
| Wave | W3: AI Visibility Overview, Competitors page, notes |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-32-overview-aggregates` in `.claude/worktrees/wp-32` (`infra/dev/wp-start WP-32 overview-aggregates`) |
| Depends on (merged on develop first) | [WP-12 summary-lane](WP-12-summary-lane.md), [WP-14 sources-lane](WP-14-sources-lane.md) |
| Owner decisions | D-17 New metric registry keys ai.prompts_in_scope and ai.valid_answers (default: Yes, added to doc 16 2.1 first) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 12 (built already: 2, to do: 10) |

## Goal

The generic metric routes the Overview needs (OD-7): `ai/metrics/overview`, `ai/metrics/{metric}`, `.../series`, `.../breakdown`, the Overview AI block, `ai/competitors` with top competitor, prompts lost to a named competitor, `overview/competitors`, and the data reads behind each Overview card (METRICS-24). New registry keys `ai.prompts_in_scope`, `ai.valid_answers` (D-17).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/19 3.7.9
- docs/16 section 2
- docs/20 5.2
- overview-and-charts.md sections 2, 9.4

## Files this package owns

- `backend/src/idraft/api/ai/metrics_routes.py`
- `backend/src/idraft/api/ai/metrics.py (new)`
- `backend/src/idraft/api/ai/competitor_routes.py`
- `backend/src/idraft/api/schemas/ai_metrics.py`
- `backend/tests/api/ai/test_metrics*.py`
- `backend/tests/api/ai/test_competitors*.py`

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

New contract group C8 metric part and C5 competitor part; the contract note is the first task and is pushed alone.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; two Sonnet implementers (metric routes; competitors) on disjoint files; one Sonnet reviewer; prove-it-bites on tenant scope and denominators.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-32 overview-aggregates`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-32-overview-aggregates.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Contract note and stubs pushed alone; gen:api | CF-16 |
| 2 | `ai/metrics/overview`, `{metric}`, series, breakdown | BE-METRICS-08..11, BE-REPORTS-01 |
| 3 | Card data reads | BE-METRICS-24 |
| 4 | `ai/competitors`, prompts lost, overview competitors | BE-COMPETITORS-01..03, BE-COMPETITORS-05, BE-REPORTS-03 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Every value carries numerator, denominator and n; branded excluded by default
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

- One commit per task, message `WP-32: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-32 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-32 <status> | branch ai/wp-32-overview-aggregates @ <short sha> | rows done <n>/12 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-16 | CF | SPEC | Overview aggregates: per engine mention, citation, SOV, own citation s |
| BE-METRICS-08 | BE | NOT BUILT | `GET {P}/ai/metrics/overview` (Overview AI block: A1, A2, A5, A7, A8 p |
| BE-METRICS-09 | BE | NOT BUILT | `GET {P}/ai/metrics/{metric}` returning `MetricValue` (registry keys o |
| BE-METRICS-10 | BE | NOT BUILT | `GET {P}/ai/metrics/{metric}/series` (granularity day, week, month) |
| BE-METRICS-11 | BE | NOT BUILT | `GET {P}/ai/metrics/{metric}/breakdown?dimension=` topic, intent, funn |
| BE-METRICS-24 | BE | PARTIAL | Data reads behind each AI Overview card and number (LAYOUTS-08): `ai.b |
| BE-REPORTS-01 | BE | NOT BUILT | `GET {P}/overview/ai?engines=` (Overview AI block) |
| BE-COMPETITORS-01 | BE | BUILT | Tracked entities per project (own, competitor, watch, `track_ai`, colo |
| BE-COMPETITORS-02 | BE | BUILT | Per entity mention and SOV cells per prompt, topic and engine (B5) |
| BE-COMPETITORS-03 | BE | NOT BUILT | `GET {P}/ai/competitors` (SOV, recommendation, citation share per enti |
| BE-COMPETITORS-05 | BE | PARTIAL | Prompts lost to a named competitor (competitor named, own not), sorted |
| BE-REPORTS-03 | BE | NOT BUILT | `GET {P}/overview/competitors` (SEO and AI SOV per engine) |
