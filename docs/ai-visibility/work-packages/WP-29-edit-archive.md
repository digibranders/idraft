# WP-29: Edit details, archive and restore, row, bulk and inspector menus

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-29-edit-archive` in `.claude/worktrees/wp-29` (`infra/dev/wp-start WP-29 edit-archive`) |
| Depends on (merged on develop first) | [WP-13 prompts-lane](WP-13-prompts-lane.md) |
| Owner decisions | D-43 Archived view with Status All (default: Yes); D-46 Optimistic concurrency on prompt PATCH (default: Yes (ETag and If-Match)) |
| Estimate | 6 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 50 (built already: 12, to do: 38) |

## Goal

Edit details dialog (metadata, no version) with concurrency, the Archived view and restore one or many, quota effect lines, and every menu item of prompt-dialogs.md section 15 that needs no slice 4 data: Edit details, Topics, Copy link, bulk Topics and Edit details, bulk restore.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- prompt-dialogs.md sections 10.1, 12, 14, 15

## Files this package owns

- `apps/web/src/features/prompts/edit/ (new)`
- `apps/web/src/features/prompts/archive/ (new)`
- apps/web/src/features/prompts/seams/actions edit and archive entries

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

Consumes PATCH with If-Match, bulk update, `is_active=any`.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Two Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-29 edit-archive`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-29-edit-archive.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Edit details dialog | PD-EDIT-01..10, WB-EDT-01..05, WB-MNU-05 |
| 2 | Archived view, restore one and many | PD-ARC-01..07, WB-BLK-12, PD-STATE-11 |
| 3 | Menus: row, bulk, inspector | PD-ROW-01..03, PD-ROW-05, PD-ROW-07..09, PD-BULK-01..07, PD-BULK-09, PD-BULK-10, PD-INS-01, PD-INS-02, PD-INS-04..06, PD-TOP-05, WB-BLK-11 |
| 4 | Tests | PD-TEST-14, PD-TEST-16 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Language and Country are read only in Edit details; a 403 and a 404 show their text
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-29: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-29 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-29 <status> | branch ai/wp-29-edit-archive @ <short sha> | rows done <n>/50 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| PD-EDIT-01 | PD | NOT BUILT | Type |
| PD-EDIT-02 | PD | NOT BUILT | Intent |
| PD-EDIT-03 | PD | NOT BUILT | Stage |
| PD-EDIT-04 | PD | NOT BUILT | Importance |
| PD-EDIT-05 | PD | NOT BUILT | Branded |
| PD-EDIT-06 | PD | NOT BUILT | Topics |
| PD-EDIT-07 | PD | NOT BUILT | Language, Country |
| PD-EDIT-08 | PD | NOT BUILT | Save |
| PD-EDIT-09 | PD | NOT BUILT | Concurrency |
| PD-EDIT-10 | PD | NOT BUILT | Audit line |
| WB-EDT-01 | WB | NOT BUILT | Edit details dialog: topics (`term_ids`), importance, intent, Branded  |
| WB-EDT-02 | WB | NOT BUILT | Edit details: type (override) |
| WB-EDT-03 | WB | NOT BUILT | Edit details: funnel stage, language, country (if PATCH allows) |
| WB-EDT-04 | WB | BUILT | Archive confirm (more than 100) |
| WB-EDT-05 | WB | BUILT | Bulk Run confirm (runs, engines, 20 a day used) |
| WB-MNU-05 | WB | NOT BUILT | Prompt row: Edit details (opens WB-EDT) (G46, G125) |
| PD-ARC-01 | PD | BUILT | Archive one |
| PD-ARC-02 | PD | BUILT | Archive many |
| PD-ARC-03 | PD | NOT BUILT | Quota effect line |
| PD-ARC-04 | PD | NOT BUILT | Archived view |
| PD-ARC-05 | PD | PARTIAL | Restore one |
| PD-ARC-06 | PD | NOT BUILT | Restore many |
| PD-ARC-07 | PD | NOT BUILT | Country no longer offered |
| WB-BLK-12 | WB | NOT BUILT | Bulk restore (unarchive) from an Archived filter |
| PD-STATE-11 | PD | SPEC | Archived view empty |
| PD-ROW-01 | PD | BUILT | Open |
| PD-ROW-02 | PD | BUILT | Ask now |
| PD-ROW-03 | PD | NOT BUILT | Edit details |
| PD-ROW-05 | PD | NOT BUILT | Topics |
| PD-ROW-07 | PD | BUILT | Copy prompt |
| PD-ROW-08 | PD | NOT BUILT | Copy link |
| PD-ROW-09 | PD | SPEC | Archive / Restore |
| PD-BULK-01 | PD | PARTIAL | "N selected" and "Select all N matching" |
| PD-BULK-02 | PD | NOT BUILT | Hidden by filter note |
| PD-BULK-03 | PD | BUILT | Ask now |
| PD-BULK-04 | PD | BUILT | Export |
| PD-BULK-05 | PD | BUILT | Archive |
| PD-BULK-06 | PD | NOT BUILT | Topics |
| PD-BULK-07 | PD | NOT BUILT | Edit details |
| PD-BULK-09 | PD | NOT BUILT | Restore (Archived view) |
| PD-BULK-10 | PD | BUILT | Clear |
| PD-INS-01 | PD | BUILT | Run now (header button) |
| PD-INS-02 | PD | NOT BUILT | More: Edit details |
| PD-INS-04 | PD | SPEC | More: Copy prompt, Copy link |
| PD-INS-05 | PD | SPEC | More: Archive / Restore |
| PD-INS-06 | PD | PARTIAL | Facts block editable in place |
| PD-TOP-05 | PD | NOT BUILT | Bulk "Set topics" |
| WB-BLK-11 | WB | NOT BUILT | Bulk edit details (topic, importance, intent) |
| PD-TEST-14 | PD | SPEC | Edit details sends only changed fields; Language and Country are read  |
| PD-TEST-16 | PD | SPEC | Restore many from the Archived view confirms always and is disabled ov |
