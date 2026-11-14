# WP-41: Versions: edit text, versions, restore, project feed, boundaries (B11, B12)

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-41-versions` in `.claude/worktrees/wp-41` (`infra/dev/wp-start WP-41 versions`) |
| Depends on (merged on develop first) | [WP-13 prompts-lane](WP-13-prompts-lane.md), [WP-25 inspector-completion](WP-25-inspector-completion.md) |
| Owner decisions | D-24 Personas (context_preamble) before panels (default: No; later, with a migration, when the owner asks) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 43 (built already: 1, to do: 42) |

## Goal

One session end to end. Backend: `GET/POST {P}/prompts/{id}/versions` with If-Match and change kinds (no restore kind, OD-4), restore that re-points `current_version_id` with an audit entry, restore events in the read (N12), the project feed (B12), the doc 19 fix, `context_preamble` only if D-24 says yes. Web: Edit text dialog with lint and the series break warning, the Versions section in the inspector History tab (D-02), restore dialog, versions feed tab, diff view, boundaries on every AI chart of a prompt, the versions count column, persona indicator if D-24.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- prompt-dialogs.md 10.2, 11
- docs/11 section 2
- docs/19 3.7.1

## Files this package owns

- `backend/src/idraft/api/ai/version_routes.py`
- `backend/src/idraft/api/ai/version_service.py (new)`
- `backend/tests/api/ai/test_versions*.py`
- `apps/web/src/features/prompts/versions/ (new)`

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

Contract C9 versions part: the contract note is pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; one Sonnet backend implementer, two Sonnet web implementers; one Sonnet reviewer; prove-it-bites on If-Match, the restore audit and the core panel protection hook.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-41 versions`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-41-versions.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Contract and stubs | CF-21 |
| 2 | Versions read and create, restore, restore events, feed, doc fix | BE-VERSIONS-01..04, BE-VERSIONS-06, BE-VERSIONS-08, PD-B11, PD-N12, PD-B12 |
| 3 | Personas (only if D-24 yes) | BE-PROMPTS-14, WB-PRM-34 |
| 4 | Edit text dialog and the row and inspector items | PD-EDIT-20..25, WB-EDT-06, WB-MNU-06, PD-ROW-04, PD-INS-03, WB-VER-08 |
| 5 | Versions section, restore dialog, feed, diff, boundaries, count column | PD-VER-01..06, PD-INS-07, WB-VER-01..07, WB-PRM-21, WB-PIH-10, WB-STATE-13, PD-STATE-10 |
| 6 | Tests | PD-TEST-15, PD-ERR-24 |
| 7 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Rates are never compared across a version boundary (test)
- pnpm gen:api in the same push
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

- One commit per task, message `WP-41: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-41 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-41 <status> | branch ai/wp-41-versions @ <short sha> | rows done <n>/43 | steps <n>/8 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-21 | CF | SPEC | Versions per prompt, restore, project feed with author and reason |
| BE-VERSIONS-01 | BE | BUILT | One `initial` version per prompt, observations point at the version |
| BE-VERSIONS-02 | BE | NOT BUILT | `GET {P}/prompts/{id}/versions`, `POST .../versions` with `If-Match`,  |
| BE-VERSIONS-03 | BE | NOT BUILT | `POST .../versions/{vid}/restore`: re-point `current_version_id`, audi |
| BE-VERSIONS-04 | BE | NOT BUILT | Core panel protection: new version on a locked core member needs `pane |
| BE-VERSIONS-06 | BE | NOT BUILT | `GET {P}/prompt-versions` project wide feed (B12) |
| BE-VERSIONS-08 | BE | NOT BUILT | Remove `restore` from the `PromptVersion.change_kind` union in doc 19 |
| PD-B11 | N | NOT BUILT | Versions and restore |
| PD-N12 | N | NOT BUILT | Restore events in the versions read |
| PD-B12 | N | NOT BUILT | Project-wide version feed |
| BE-PROMPTS-14 | BE | NOT BUILT | `context_preamble` (persona preamble) stored per version and sent with |
| WB-PRM-34 | WB | NOT BUILT | Persona preamble indicator |
| PD-EDIT-20 | PD | NOT BUILT | Current text |
| PD-EDIT-21 | PD | NOT BUILT | New text |
| PD-EDIT-22 | PD | NOT BUILT | Change kind |
| PD-EDIT-23 | PD | NOT BUILT | Reason |
| PD-EDIT-24 | PD | NOT BUILT | Series break warning |
| PD-EDIT-25 | PD | NOT BUILT | Save |
| WB-EDT-06 | WB | NOT BUILT | Prompt editor (text) with lint, change kind, reason, "creates version  |
| WB-MNU-06 | WB | NOT BUILT | Prompt row: Edit prompt text (new version) |
| PD-ROW-04 | PD | NOT BUILT | Edit text |
| PD-INS-03 | PD | NOT BUILT | More: Edit text |
| WB-VER-01 | WB | NOT BUILT | Versions table: date, prompt, change kind, "v2 to v3", author, reason; |
| WB-VER-02 | WB | NOT BUILT | Change kind filter, date range |
| WB-VER-03 | WB | NOT BUILT | Restore a version (audit entry, not a change kind) (G68) |
| WB-VER-04 | WB | NOT BUILT | Diff view of two versions |
| WB-VER-05 | WB | NOT BUILT | Version boundary on every AI chart of the prompt (G70) |
| WB-VER-06 | WB | NOT BUILT | Rates not compared across a boundary |
| WB-VER-07 | WB | NOT BUILT | "Header note: a wording change starts a new version" |
| WB-VER-08 | WB | NOT BUILT | Edit prompt text as a new version (see WB-EDT-06) (G69) |
| PD-VER-01 | PD | NOT BUILT | Versions section in the inspector |
| PD-VER-02 | PD | NOT BUILT | Restore button per older version |
| PD-VER-03 | PD | NOT BUILT | Restore dialog |
| PD-VER-04 | PD | NOT BUILT | Restore history line |
| PD-VER-05 | PD | NOT BUILT | Project-wide versions feed |
| PD-VER-06 | PD | NOT BUILT | Boundary marker |
| PD-INS-07 | PD | NOT BUILT | Versions tab |
| WB-PRM-21 | WB | NOT BUILT | Versions count column, boundary icon if changed in window |
| WB-PIH-10 | WB | NOT BUILT | Version boundary marker on the chart (G70) |
| WB-STATE-13 | WB | NOT BUILT | Version or model boundary |
| PD-STATE-10 | PD | SPEC | Versions tab, one version |
| PD-TEST-15 | PD | SPEC | Restore version: the dialog requires a reason for a locked core member |
| PD-ERR-24 | PD | SPEC | B11 `duplicate` (version), `invalid_state_transition`, `precondition_f |
