# WP-60: Source intelligence backend: categories, publishers, overlap, opportunities

| Field | Value |
|---|---|
| Wave | W5: Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-60-source-intel-api` in `.claude/worktrees/wp-60` (`infra/dev/wp-start WP-60 source-intel-api`) |
| Depends on (merged on develop first) | [WP-14 sources-lane](WP-14-sources-lane.md) |
| Owner decisions | D-27 LLM use (adjudication, category classification, candidate variants, onboarding suggestions) (default: No until a provider and a budget are chosen; rules and templates first); D-30 Opportunity task status (OP-12, a new table) (default: No for now); D-31 Domain category seed list source (default: Rules plus a small curated seed in the repository, no LLM); D-32 Who maintains the publisher list (default: Deferred with source intelligence; start with a curated seed) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 13 (built already: 0, to do: 13) |

## Goal

Phase 13 source intelligence: categories in the source reads with `filter[category_in]` and the categories route, the classification pipeline (seed list and rules first, LLM only after D-27), workspace category overrides, competitor source overlap (C7), influential pages per topic, publishers and publisher opportunities, opportunity task status (only after D-30), project source stats, the domain citations rollup, the URL remap path.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/14 sections 2, 4, 6, 7, 9
- docs/19 3.7.7, 3.8.3

## Files this package owns

- `backend/src/idraft/api/ai/source_intel_routes.py`
- `backend/src/idraft/sources_intel/ (new)`
- `backend/src/idraft/db/migrations/versions/<next>_source_intel.py`

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

C13, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; two Sonnet implementers; one Sonnet reviewer; prove-it-bites on override tenant scope.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-60 source-intel-api`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-60-source-intel-api.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Categories, classification (rules), overrides | BE-SOURCES-08..10 |
| 2 | Overlap and influential pages | BE-SOURCES-12, BE-SOURCES-14, BE-TOPICS-11, OV-N8 |
| 3 | Publishers and opportunities | BE-SOURCES-15..17 |
| 4 | Stats table, rollup, URL remap | BE-SOURCES-18, BE-SOURCES-19, BE-SOURCES-23 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- No LLM call before D-27
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

- One commit per task, message `WP-60: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-60 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-60 <status> | branch ai/wp-60-source-intel-api @ <short sha> | rows done <n>/13 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-SOURCES-08 | BE | PARTIAL | Domain categories in the source reads, `filter[category_in]`, `GET {P} |
| BE-SOURCES-09 | BE | NOT BUILT | Category classification pipeline: seed list of 2,000 domains, rules (` |
| BE-SOURCES-10 | BE | NOT BUILT | Workspace category overrides `core.workspace_domain_categories`, `GET/ |
| BE-SOURCES-12 | BE | NOT BUILT | Competitor source overlap (C7 Jaccard), `GET {P}/ai/sources/competitor |
| BE-SOURCES-14 | BE | NOT BUILT | `GET {P}/ai/sources/influential-pages` (pages repeatedly influencing a |
| BE-SOURCES-15 | BE | NOT BUILT | Publishers `core.publishers`, `core.publisher_domains`, `GET /api/v1/p |
| BE-SOURCES-16 | BE | NOT BUILT | Publisher opportunities (doc 14 7: `opportunity_d`, `reach_d >= 3`), ` |
| BE-SOURCES-17 | BE | NOT BUILT | Opportunity task status (todo, done, owner) for a condition row |
| BE-SOURCES-18 | BE | NOT BUILT | `ai.project_source_stats` (first seen, last seen, counts, nightly reco |
| BE-SOURCES-19 | BE | NOT BUILT | `ai.daily_domain_citations` rollup |
| BE-SOURCES-23 | BE | NOT BUILT | Canonicalizer upgrade path `core.url_remap` |
| BE-TOPICS-11 | BE | NOT BUILT | Pages repeatedly influencing a topic (cited in at least 25% of a topic |
| OV-N8 | N | NOT BUILT | N8 competitor source overlap with shared domains |
