# WP-14: Sources and fan-out reads: series, country, min_support, lost, cited with, ads

| Field | Value |
|---|---|
| Wave | W1: Shared web packages and the first backend lanes |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-14-sources-lane` in `.claude/worktrees/wp-14` (`infra/dev/wp-start WP-14 sources-lane`) |
| Depends on (merged on develop first) | [WP-03 contract-pack](WP-03-contract-pack.md) |
| Owner decisions | D-41 Effective sources (C3): web or backend (default: Backend (diversity read); the web may compute it in the interim) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 21 (built already: 5, to do: 16) |

## Goal

Add what the Citations page, the prompt Citations tab, the fan-out views and the source cards need on the built source routes: `include=series` (N6, CF-07), `filter[country_iso]` (CF-08), `min_support` and lost sources over two windows (CF-09, C6), `sources/changes`, diversity (C3), domain detail, "cited with" (CF-10), role split per engine (N7), prompts with no own page, flag toggles, ads read, fan-out truncation measure and fix, fan-out grouped by topic.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/14-citation-intelligence.md
- docs/16 C1 to C9, F1 to F5
- docs/superpowers/plans/2026-11-12-ai-prompts-d2-citations-fanout-bulk.md

## Files this package owns

- `backend/src/idraft/api/ai/source_routes.py`
- `backend/src/idraft/api/ai/source_repository.py`
- `backend/src/idraft/api/ai/sources.py`
- `backend/src/idraft/api/schemas/ai_sources.py`
- `backend/tests/api/ai/test_sources*.py`
- `backend/tests/api/ai/test_fanout*.py`

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

Implements the sources additions of the contract pack.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; two Sonnet implementers (sources reads; fan-out and measures) on disjoint files; one Sonnet reviewer; prove-it-bites on the keyset cursor and tenant scope of each new read.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-14 sources-lane`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-14-sources-lane.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | `include=series` on domains and pages; meta series | CF-07, OV-N6 |
| 2 | `filter[country_iso]` on citations, sources and fan-out | CF-08 |
| 3 | `min_support`, lost sources, `sources/changes` | CF-09, BE-SOURCES-05, BE-SOURCES-06 |
| 4 | Diversity and domain detail | BE-SOURCES-07, BE-SOURCES-11, CF-05 |
| 5 | Cited with and role split per engine | CF-10, OV-N7 |
| 6 | Prompts with no own page; flag toggles; ads presence | BE-SOURCES-20, BE-SOURCES-22, BE-SOURCES-25 |
| 7 | Fan-out truncation measure and the unbounded list; fan-out by topic | BE-FANOUT-03, BE-TOPICS-12 |
| 8 | Statement counts, cross-tenant, As built notes | BE-SOURCES-01..04, BE-FANOUT-01 |
| 9 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Prove it bites on each new cursor and on the tenant filter
- pnpm gen:api in the same push
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

- One commit per task, message `WP-14: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-14 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-14 <status> | branch ai/wp-14-sources-lane @ <short sha> | rows done <n>/21 | steps <n>/10 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-SOURCES-01 | BE | BUILT | `GET {P}/ai/citations` cursor list, filters engine, prompt, term, role |
| BE-SOURCES-02 | BE | BUILT | `GET {P}/ai/sources/domains` by registrable domain: units, observation |
| BE-SOURCES-03 | BE | BUILT | `GET {P}/ai/sources/pages` by page with title, host |
| BE-SOURCES-04 | BE | BUILT | `compare=previous_period` on sources for New markers (C5), `previous`  |
| BE-SOURCES-05 | BE | NOT BUILT | Lost sources (C6: `min_support` then 0 for 2 full windows) |
| BE-SOURCES-06 | BE | NOT BUILT | `GET {P}/ai/sources/changes` (new and lost list with `min_support`) |
| BE-SOURCES-07 | BE | NOT BUILT | Source diversity (C3: distinct domains, effective number of sources),  |
| BE-SOURCES-11 | BE | NOT BUILT | `GET {P}/ai/sources/domains/{domain_id}` detail (pages, prompts, engin |
| BE-SOURCES-20 | BE | PARTIAL | Prompt to page mapping: own URL cited per prompt and engine, prompts c |
| BE-SOURCES-22 | BE | PARTIAL | Unresolved redirect and engine internal link flags, excluded from shar |
| BE-SOURCES-25 | BE | PARTIAL | Ads presence per engine |
| BE-FANOUT-01 | BE | BUILT | `GET {P}/ai/fanout-queries` grouped by normalized text, `min_support`, |
| BE-FANOUT-03 | BE | NOT BUILT | Unbounded fan-out list (lift the 16 KB cut) |
| BE-TOPICS-12 | BE | PARTIAL | Fan-out queries grouped by the originating prompt's topic |
| CF-05 | CF | SPEC | Citations page strip meta: total units, answers, units per role, disti |
| CF-07 | CF | SPEC | Per domain weekly share series (Trend column, domain inspector) |
| CF-08 | CF | SPEC | Country scope on citations, sources and fan-out routes (`filter[countr |
| CF-09 | CF | SPEC | `min_support` on sources routes, and "lost after 2 windows" |
| CF-10 | CF | SPEC | "Cited with" (entity most named in answers citing the domain) and doma |
| OV-N6 | N | NOT BUILT | N6 weekly series on `ai/sources/domains` and `pages` |
| OV-N7 | N | NOT BUILT | N7 role split per engine `meta.by_role_by_engine` on sources |
