# WP-12: Summary additions: compare, total, rows, entities per week, co-mentions, filters

| Field | Value |
|---|---|
| Wave | W1: Shared web packages and the first backend lanes |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-12-summary-lane` in `.claude/worktrees/wp-12` (`infra/dev/wp-start WP-12 summary-lane`) |
| Depends on (merged on develop first) | [WP-03 contract-pack](WP-03-contract-pack.md) |
| Owner decisions | D-04 Pooling threshold POOL_BELOW_PROMPTS for topic and project weekly points (default: 10 prompts) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 24 (built already: 8, to do: 16) |

## Goal

Finish the summary route for every wave 1 to 3 web need in one lane that owns `summary*.py` and the summary schemas: `compare=previous_period` (B4, D1 Task 3 as written) and `previous_year` refusal rules, `include=total` with `rows=none|topics` (N1, N15), `series[].entities` (N3), `include=co_mentions` (N14), `filter[outcome]` and `filter[opportunity]` (N10), `group_by=country` (N4), and the small cells (citation among answers with citations, own citation share, first mention, fan-out per answer, country breakdown).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/superpowers/plans/2026-11-12-ai-prompts-d1-summary-additions.md Task 3
- overview-and-charts.md section 5
- docs/16-metrics-methodology.md
- docs/17 section 6

## Files this package owns

- `backend/src/idraft/api/ai/summary.py`
- `backend/src/idraft/api/ai/summary_repository.py`
- `backend/src/idraft/api/ai/summary_routes.py`
- backend/src/idraft/api/schemas/ai.py: EngineSummary, MetricCell, WeekCells, EntityCells, PromptsSummary only
- `backend/tests/api/ai/test_summary*.py`

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

Implements contract C2 of the contract pack (fields declared there).

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; one Sonnet implementer per task in sequence (all tasks touch the summary files); one Sonnet reviewer; prove-it-bites on cursor-free aggregates and statement counts.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-12 summary-lane`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-12-summary-lane.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | `compare=previous_period` with `previous` cells and `compare_window`; `previous_year` and custom compare windows | BE-METRICS-05, BE-METRICS-06, CF-01, OV-N2 |
| 2 | `include=total` and `rows=none|topics` | OV-N1, OV-N15 |
| 3 | Entities per week in `series` | OV-N3, CF-06 |
| 4 | Co-mentions per engine | OV-N14 |
| 5 | Outcome and opportunity filters | OV-N10 |
| 6 | Country breakdown with `group_by=country` | OV-N4, BE-METRICS-22 |
| 7 | Small cells: among-with-citations, own citation share, first mention, fan-out per answer | BE-METRICS-13, BE-METRICS-14, BE-METRICS-15, BE-METRICS-21 |
| 8 | Statement count tests, EXPLAIN at full capacity notes, As built note in doc 19 | BE-METRICS-01..04, BE-METRICS-07, BE-TOPICS-04..06 |
| 9 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Each opt-in block is absent unless asked (test)
- Statement count fixed per include combination
- Prove it bites: dropping the branded exclusion or the term subtree from the new aggregates fails a test
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

- One commit per task, message `WP-12: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-12 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-12 <status> | branch ai/wp-12-summary-lane @ <short sha> | rows done <n>/24 | steps <n>/10 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-METRICS-01 | BE | BUILT | `GET {P}/ai/prompts-summary`: per prompt and engine Mentioned, Cited,  |
| BE-METRICS-02 | BE | BUILT | `last_observed_at`, `last_valid_at` on prompt and topic rows (B1) |
| BE-METRICS-03 | BE | BUILT | Scope `filter[country_iso]`, `filter[term]`, `branded_only` (B2) |
| BE-METRICS-04 | BE | BUILT | `include=series` weekly cells per engine (B3) |
| BE-METRICS-05 | BE | NOT BUILT | `compare=previous_period` with `previous` cells and `compare_window` ( |
| BE-METRICS-06 | BE | NOT BUILT | `compare=previous_year`, `compare_from`, `compare_to` |
| BE-METRICS-07 | BE | BUILT | `include=entities` per tracked entity cells (B5, at most 20 entities) |
| BE-METRICS-13 | BE | PARTIAL | Mention and citation rate (A3), citation rate among answers with citat |
| BE-METRICS-14 | BE | PARTIAL | Citation share (A8, own units over all units) |
| BE-METRICS-15 | BE | NOT BUILT | First mention rate (A12) from `own_mention_order = 1` |
| BE-METRICS-21 | BE | PARTIAL | Fan-out per answer mean (F2) and presence rate (F1) per prompt |
| BE-METRICS-22 | BE | PARTIAL | Country and language breakdown of every rate (M-11) |
| BE-TOPICS-04 | BE | BUILT | Topic rows in the summary, prompt weighted, rolled up to ancestors |
| BE-TOPICS-05 | BE | BUILT | `filter[term]` subtree scope on summary, citations, sources, fan-out |
| BE-TOPICS-06 | BE | BUILT | Topic tree of two levels with rollup note (Topics tab, D-3) |
| CF-01 | CF | SPEC | Summary compare: `compare=previous_period` returning `previous: Metric |
| CF-06 | CF | SPEC | Per entity weekly series (own vs top 3 competitors per topic, per engi |
| OV-N1 | N | NOT BUILT | N1 `include=total` on the summary (project totals per engine) |
| OV-N2 | N | NOT BUILT | N2 `compare=previous_period` on the summary (D1 task 3) |
| OV-N3 | N | NOT BUILT | N3 entities per week in `series` (`series[].entities`) |
| OV-N4 | N | NOT BUILT | N4 country breakdown (`group_by=country` or the breakdown route) |
| OV-N10 | N | NOT BUILT | N10 outcome and opportunity filters on the summary |
| OV-N14 | N | NOT BUILT | N14 co-mention counts `include=co_mentions` |
| OV-N15 | N | NOT BUILT | N15 topic-only reads `rows=topics` on the summary |
