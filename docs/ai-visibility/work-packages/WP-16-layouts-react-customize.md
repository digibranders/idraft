# WP-16: Layouts customize UI: catalog, numbers, save bar, team default, presets, undo

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-16-layouts-react-customize` in `.claude/worktrees/wp-16` (`infra/dev/wp-start WP-16 layouts-react-customize`) |
| Depends on (merged on develop first) | [WP-15 layouts-react-core](WP-15-layouts-react-core.md) |
| Owner decisions | D-01 Overview presets: code (built-in documents behind a Start from menu) or stored named layouts (default: Code. No table change; the person saves the result as their layout or the team default); D-06 Undo and redo in customize mode (default: Yes: 50 drafts of history, ends with the mode, Hide raises a toast with Undo); D-12 What shared layouts means (default: The team default only; no sharing with one person); D-15 Duplicate in the card More menu (default: Yes, with the next free identity value); D-42 Customize on phones (default: Display only below 768 px) |
| Estimate | 9 Sonnet-agent tasks, about 7 hours with one task in flight |
| Rows | 24 (built already: 0, to do: 24) |

## Goal

Finish customize mode: card catalog dialog (search, groups, states), `NumberStrip` and the number catalog, Customize button and badge, save bar with change count, team default menu, discard and 412 conflict dialogs, read and save failures, placeholders for unavailable cards, per card error boundary, presets ("Start from" menu, D-01), undo and redo (D-06), drawer cards mode (one column), numbers on table pages, phone display only, audit entries visible, the unit, component and e2e tests.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- layout spec 5.4 to 5.6
- overview-and-charts.md 9.3 to 9.7

## Files this package owns

- `apps/web/src/features/layouts/catalog/`
- `apps/web/src/features/layouts/save-bar/`
- `apps/web/src/features/layouts/numbers/`
- `apps/web/src/features/layouts/presets/`
- `apps/web/e2e/flows/ai-layouts.spec.ts`

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

Consumes C12a.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; three Sonnet implementers (catalog and numbers; save bar, team default and dialogs; presets, undo, drawers, phones); one Sonnet reviewer; Haiku writes message strings.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-16 layouts-react-customize`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-16-layouts-react-customize.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Catalog dialog | WB-LAY-25 |
| 2 | NumberStrip and number catalog | WB-LAY-26..28 |
| 3 | Customize button, badge, save bar, team default line and menu | WB-LAY-29..33 |
| 4 | Discard, Escape, narrow window, placeholders, error boundaries, failures, 412 | WB-LAY-34..41 |
| 5 | Drawer cards mode and table page numbers | WB-LAY-42, WB-LAY-43 |
| 6 | Phones, reduced motion, presets, tests, audit lines | WB-LAY-44..48 |
| 7 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- e2e: a layout persists across reload and across projects, reset, team default by an admin, a member cannot set it, 412 dialog
- No customize controls below 768 px
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

- One commit per task, message `WP-16: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-16 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-16 <status> | branch ai/wp-16-layouts-react-customize @ <short sha> | rows done <n>/24 | steps <n>/8 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-LAY-25 | WB | NOT BUILT | Card catalog dialog 720 px: search, groups SEO, AI, Cross-channel, Act |
| WB-LAY-26 | WB | NOT BUILT | `NumberStrip` fed from the layout (`MetricStrip` with the layout's num |
| WB-LAY-27 | WB | NOT BUILT | Numbers in customize mode: handle, Remove, Move menu above each number |
| WB-LAY-28 | WB | NOT BUILT | "Add number" slot and number catalog list grouped SEO and AI, already  |
| WB-LAY-29 | WB | NOT BUILT | Customize button (`secondary`, `SlidersHorizontal`, `aria-pressed`) in |
| WB-LAY-30 | WB | NOT BUILT | "Customizing" badge on the title (text, not colour alone) |
| WB-LAY-31 | WB | NOT BUILT | Layout save bar: "N changes, Applies to your view, in every project",  |
| WB-LAY-32 | WB | NOT BUILT | "Your layout differs from the team default" line |
| WB-LAY-33 | WB | NOT BUILT | Save button menu: Save as team default, Remove team default (`layouts: |
| WB-LAY-34 | WB | NOT BUILT | Discard unsaved changes dialog on any way out (link, Back, Forward, dr |
| WB-LAY-35 | WB | NOT BUILT | Escape leaves customize mode (through the dialog when changed); focus  |
| WB-LAY-36 | WB | NOT BUILT | Narrow window below 768 px leaves the mode only when nothing is unsave |
| WB-LAY-37 | WB | NOT BUILT | Placeholder card with the reason in customize mode when the project la |
| WB-LAY-38 | WB | NOT BUILT | Per card error boundary with Retry; other cards unaffected |
| WB-LAY-39 | WB | NOT BUILT | Layout read failure: built-in default plus banner "Your layout could n |
| WB-LAY-40 | WB | NOT BUILT | Save failure in the save bar "Could not save. Try again."; draft kept |
| WB-LAY-41 | WB | NOT BUILT | `412` conflict dialog "This layout was changed somewhere else." with K |
| WB-LAY-42 | WB | NOT BUILT | Drawer cards customize mode (one column, no widths) for `inspector.pro |
| WB-LAY-43 | WB | NOT BUILT | "Customize numbers" for table pages (Topics & Prompts strip, Citations |
| WB-LAY-44 | WB | NOT BUILT | Phones show the saved layout full width; editing needs 768 px |
| WB-LAY-45 | WB | NOT BUILT | Reduced motion: cards jump without animation |
| WB-LAY-46 | WB | NOT BUILT | Presets: built-in default and team default are the presets of the spec |
| WB-LAY-47 | WB | PARTIAL | Unit, component, e2e (persist across reload and projects, reset, team  |
| WB-LAY-48 | WB | NOT BUILT | Audit entries `layout.default.set` and `layout.default.remove` visible |
