# WP-28: Paste with columns and CSV import (R-10)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-28-import-csv` in `.claude/worktrees/wp-28` (`infra/dev/wp-start WP-28 import-csv`) |
| Depends on (merged on develop first) | [WP-27 add-dialog](WP-27-add-dialog.md) |
| Owner decisions | none |
| Estimate | 6 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 32 (built already: 0, to do: 32) |

## Goal

Paste with columns inside "Type or paste" and the 720 px multi-step CSV import (upload, map, review, confirm in chunks of 1,000, result with the errors file), with the header Import entry and the More menu item.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- prompt-dialogs.md sections 5 and 6
- apps/web/src/features/rankings/import/ as the reference

## Files this package owns

- `apps/web/src/features/prompts/import/ (new)`

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

Consumes `bulk-create` and lint `items`.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Two Sonnet implementers (paste parser; CSV steps), one Sonnet reviewer; Haiku writes CSV fixtures.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-28 import-csv`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-28-import-csv.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Paste with columns | PD-PASTE-01..06 |
| 2 | CSV upload and map | PD-CSV-01..08 |
| 3 | Review, confirm, result | PD-CSV-09..18, PD-STATE-12 |
| 4 | Entries and tests | WB-TPH-10, WB-TPH-11, WB-ADD-17, PD-TEST-08..10, PD-TEST-21 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- A non-UTF-8 file, over 5 MB, over 1,000 rows and no header are refused before any request
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

- One commit per task, message `WP-28: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-28 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-28 <status> | branch ai/wp-28-import-csv @ <short sha> | rows done <n>/32 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| PD-PASTE-01 | PD | NOT BUILT | Detection |
| PD-PASTE-02 | PD | NOT BUILT | Header row |
| PD-PASTE-03 | PD | NOT BUILT | Column mapping popover |
| PD-PASTE-04 | PD | NOT BUILT | Cell reading |
| PD-PASTE-05 | PD | NOT BUILT | Shared fields in column mode |
| PD-PASTE-06 | PD | NOT BUILT | Limits |
| PD-CSV-01 | PD | NOT BUILT | Entry |
| PD-CSV-02 | PD | NOT BUILT | Upload |
| PD-CSV-03 | PD | NOT BUILT | Upload |
| PD-CSV-04 | PD | NOT BUILT | Upload |
| PD-CSV-05 | PD | NOT BUILT | Upload |
| PD-CSV-06 | PD | NOT BUILT | Upload |
| PD-CSV-07 | PD | NOT BUILT | Map |
| PD-CSV-08 | PD | NOT BUILT | Map |
| PD-CSV-09 | PD | NOT BUILT | Review |
| PD-CSV-10 | PD | NOT BUILT | Review |
| PD-CSV-11 | PD | NOT BUILT | Review |
| PD-CSV-12 | PD | NOT BUILT | Review |
| PD-CSV-13 | PD | NOT BUILT | Review |
| PD-CSV-14 | PD | NOT BUILT | Confirm |
| PD-CSV-15 | PD | NOT BUILT | Confirm |
| PD-CSV-16 | PD | NOT BUILT | Confirm |
| PD-CSV-17 | PD | NOT BUILT | Result |
| PD-CSV-18 | PD | NOT BUILT | Result |
| PD-STATE-12 | PD | SPEC | CSV import, reading |
| WB-TPH-10 | WB | NOT BUILT | More actions menu: Import prompts (CSV into the Add dialog, G04) |
| WB-TPH-11 | WB | NOT BUILT | Header "Import" button |
| WB-ADD-17 | WB | NOT BUILT | CSV import step (file to lines, preview, then the same checks) (G04) |
| PD-TEST-08 | PD | SPEC | a tab-separated paste is read as columns with a header, maps country n |
| PD-TEST-09 | PD | SPEC | CSV: a non-UTF-8 file, a file over 5 MB, over 1,000 rows and one witho |
| PD-TEST-10 | PD | SPEC | CSV: the mapping refuses no Prompt column and a field mapped twice; Re |
| PD-TEST-21 | PD | SPEC | import the template CSV with one bad country, review, import, download |
