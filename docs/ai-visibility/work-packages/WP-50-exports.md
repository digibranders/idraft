# WP-50: Server exports with AI kinds and the caveat header

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-50-exports` in `.claude/worktrees/wp-50` (`infra/dev/wp-start WP-50 exports`) |
| Depends on (merged on develop first) | [WP-01 backend-scaffold](WP-01-backend-scaffold.md) |
| Owner decisions | none |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 8 (built already: 0, to do: 8) |

## Goal

One session end to end: the job runner `ops.jobs` (also used later by re-derivation), `ops.exports` and `{P}/exports` routes with `exports:create`, workspace exports, AI export kinds (prompt rates, answers, citations, sources, fan-out), the caveat block, mention count share in exports; on the web CSV on every AI table and XLSX.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/19 3.11.6
- docs/04 11.8
- docs/07 section 10

## Files this package owns

- `backend/src/idraft/api/exports/ (new)`
- `backend/src/idraft/jobs/ (new)`
- `backend/src/idraft/db/migrations/versions/<next>_jobs_exports.py`
- `apps/web/src/features/exports/ (new)`
- `apps/web/src/lib/export/ (XLSX use on AI tables)`

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

Contract C12 exports part, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; one Sonnet backend implementer per part (jobs; exports), one Sonnet web implementer; one Sonnet reviewer; prove-it-bites on tenant scope of downloads.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-50 exports`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-50-exports.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Job runner | BE-OPS-08 |
| 2 | Exports routes, kinds, caveat, workspace exports | BE-EXPORT-01..03, BE-REPORTS-11, BE-METRICS-16 |
| 3 | Web CSV and XLSX on every AI table | WB-RPT-01, WB-RPT-02 |
| 4 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- A download link of another workspace answers 404
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
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

- One commit per task, message `WP-50: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-50 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-50 <status> | branch ai/wp-50-exports @ <short sha> | rows done <n>/8 | steps <n>/5 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-OPS-08 | BE | NOT BUILT | Job runner for long backend jobs (`ops.jobs`, re-derivation, exports,  |
| BE-EXPORT-01 | BE | NOT BUILT | Server exports `POST/GET {P}/exports`, `.../{id}`, `.../download`, `DE |
| BE-EXPORT-02 | BE | NOT BUILT | Export kinds for AI: prompt rates, answers, citations, sources, fan-ou |
| BE-EXPORT-03 | BE | NOT BUILT | Workspace exports `POST {W}/exports` (costs, audit) |
| BE-REPORTS-11 | BE | NOT BUILT | Caveat block in every export header (logged-out sessions, country leve |
| BE-METRICS-16 | BE | NOT BUILT | Mention count share (`ai.mention_count_share`, exports only, labeled) |
| WB-RPT-01 | WB | PARTIAL | Client CSV export on every AI table |
| WB-RPT-02 | WB | NOT BUILT | XLSX export of AI tables |
