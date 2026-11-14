# WP-58: Statistics backend: intervals, paired verdict, flip rate, movers, sizing (slice 3)

| Field | Value |
|---|---|
| Wave | W5: Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-58-stats-api` in `.claude/worktrees/wp-58` (`infra/dev/wp-start WP-58 stats-api`) |
| Depends on (merged on develop first) | [WP-12 summary-lane](WP-12-summary-lane.md), [WP-42 panels-api](WP-42-panels-api.md) |
| Owner decisions | D-25 Replicates and spike S-05 (provider spend) (default: No until a budget is set) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 19 (built already: 0, to do: 19) |

## Goal

`ci` on `MetricCell`, the paired comparison on the core panel with `is_detectable`, unpaired Newcombe, flip rate and volatility, the stats routes (interval, compare, movers with BH, volatility), `ai/stats/compare` for the Overview, overview changes, competitor gap with interval, panel sizing, what-if sizing, version and structural boundaries in series, the reference values test set, replicates and their instability only after D-25.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/17 (all)
- docs/16 V1 to V7
- docs/19 3.7.9

## Files this package owns

- `backend/src/idraft/stats/ (new)`
- `backend/src/idraft/api/ai/stats_routes.py`
- `backend/tests/stats/`
- backend/src/idraft/api/schemas/ai.py: MetricCell.ci (lease from the summary lane)

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

C8 statistics part and C2 `ci`, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans and reviews the statistics (Sonnet implements, Opus checks the method against doc 17); prove-it-bites with reference values computed independently.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-58 stats-api`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-58-stats-api.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Contract; `ci` on MetricCell; reference values | CF-24, OV-N12, BE-STATS-01, BE-STATS-12 |
| 2 | Paired and unpaired comparison | BE-STATS-02, BE-STATS-03 |
| 3 | Flip rate and volatility; stats routes; BH movers | BE-STATS-04..06, BE-METRICS-25, BE-REPORTS-02 |
| 4 | Boundaries, competitor gap, sizing | BE-STATS-07, BE-VERSIONS-07, BE-COMPETITORS-04, BE-PANELS-08, BE-STATS-11 |
| 5 | Replicates and instability (only after D-25) | BE-STATS-13, BE-COLLECT-11, BE-STATS-08 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Wilson in SQL and in Python agree on the reference set
- No replicate is bought before D-25
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

- One commit per task, message `WP-58: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-58 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-58 <status> | branch ai/wp-58-stats-api @ <short sha> | rows done <n>/19 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-24 | CF | SPEC | Server `ci` on `MetricCell` and paired verdict |
| OV-N12 | N | NOT BUILT | N12 `ci`, paired compare, movers, volatility (slice 3) |
| BE-STATS-01 | BE | NOT BUILT | `ci` on `MetricCell` (Wilson for a prompt engine cell; fixed panel int |
| BE-STATS-02 | BE | NOT BUILT | Paired comparison on the core panel (bootstrap) and `is_detectable` on |
| BE-STATS-03 | BE | NOT BUILT | Unpaired comparison (Newcombe) when panels changed or engines compared |
| BE-STATS-04 | BE | NOT BUILT | Flip rate `ai.flip_rate` and mention volatility (V4), citation volatil |
| BE-STATS-05 | BE | NOT BUILT | `GET {P}/ai/stats/volatility`, `GET {P}/ai/stats/interval`, `GET {P}/a |
| BE-STATS-06 | BE | NOT BUILT | Benjamini-Hochberg filter on mover lists (V1 to V3 new and lost mentio |
| BE-STATS-07 | BE | NOT BUILT | Version boundaries and structural breaks (model change, entity set cha |
| BE-STATS-08 | BE | NOT BUILT | Within-run instability across replicates (V6) |
| BE-STATS-11 | BE | PARTIAL | What-if sizing (how many prompts detect N points) |
| BE-STATS-12 | BE | NOT BUILT | Statistical reference values test set (Wilson in SQL and Python agree) |
| BE-STATS-13 | BE | NOT BUILT | Spike S-05 replicate independence (30 prompts x 20 replicates per engi |
| BE-METRICS-25 | BE | NOT BUILT | `GET {P}/ai/stats/compare` for the Overview deltas (period change with |
| BE-REPORTS-02 | BE | NOT BUILT | `GET {P}/overview/changes` (detectable AI changes, BH filtered) |
| BE-VERSIONS-07 | BE | NOT BUILT | Version boundaries in metric series responses |
| BE-COMPETITORS-04 | BE | NOT BUILT | Competitor gap A14 with a paired interval |
| BE-PANELS-08 | BE | NOT BUILT | `GET {P}/panels/{id}/sizing` (detectable change from flip rate, doc 17 |
| BE-COLLECT-11 | BE | NOT BUILT | Replicates 1 to 5 per engine, priority subset (importance 1) with 3, 3 |
