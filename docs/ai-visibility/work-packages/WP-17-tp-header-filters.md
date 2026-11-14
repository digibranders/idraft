# WP-17: Topics & Prompts: header, filters, facets, strip, menus and shell items

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-17-tp-header-filters` in `.claude/worktrees/wp-17` (`infra/dev/wp-start WP-17 tp-header-filters`) |
| Depends on (merged on develop first) | [WP-02 web-scaffold](WP-02-web-scaffold.md), [WP-07 app-parts-a](WP-07-app-parts-a.md), [WP-10 controls](WP-10-controls.md), [WP-13 prompts-lane](WP-13-prompts-lane.md) |
| Owner decisions | D-03 Compare on by default (Overview and Topics & Prompts) (default: On: vs previous period by default on both, `cmp=off` in the URL turns it off); D-35 "Run now" or "Ask now" (default: Keep "Run now" on buttons) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 75 (built already: 53, to do: 22) |

## Goal

Finish the page header and filter bar of Topics & Prompts: meta counts, view presets, Export CSV and XLSX in More, cadence line, Branded three way, intent, funnel, importance and language facets, the filter sheet under 768 px, the single engine strip variant, Copy link to a prompt, right click menus, shortcut hints, the shortcuts dialog, the project switch carrying the query, and the e2e flows the inventory lists as missing.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-w2-web-parity.md W5, W6
- web.md 2.1 to 2.4, 2.7, 2.8

## Files this package owns

- `apps/web/src/features/prompts/prompts-screen.tsx (sole owner in wave 2)`
- `apps/web/src/features/prompts/views-model.ts`
- `apps/web/src/features/prompts/facets/ (new)`
- `apps/web/src/features/prompts/prompts-strip.tsx`
- `apps/web/e2e/flows/ai-prompts.spec.ts (sole owner in wave 2)`

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

Consumes C1 filters (prompts lane) and the existing summary.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; two Sonnet implementers (header and menus; filters and facets); one Sonnet reviewer; Haiku writes the e2e boilerplate and messages.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-17 tp-header-filters`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-17-tp-header-filters.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Header meta counts, presets menu, More menu Export CSV and XLSX, cadence line | WB-TPH-01..04, WB-TPH-07..09, WB-TPH-13, WB-TPH-15, WB-TPH-17 |
| 2 | Branded three way, facets including Type, filter sheet | WB-TPF-01..05, WB-TPF-08, WB-TPF-10..13, WB-TPF-16..18 |
| 3 | Strip single engine variant | WB-TPS-01..04, WB-TPS-06, WB-TPS-09, WB-TPS-10 |
| 4 | Menus: Copy link, right click wiring, shortcut hints | WB-MNU-01..04, WB-MNU-08..15, WB-BLK-01, WB-BLK-02, WB-BLK-04..08, WB-BLK-13 |
| 5 | Shell: shortcuts dialog, project switch query, window and country | WB-NAV-05, WB-NAV-07, WB-NAV-11, WB-NAV-12, WB-KEY-01..06, WB-KEY-10, WB-KEY-11, WB-IA-02 |
| 6 | e2e: tree expand, bulk run and archive, export download | WB-E2E-06..08 |
| 7 | States confirmed | WB-STATE-01..07, WB-STATE-10, WB-STATE-14 |
| 8 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Every filter and preset is in the URL and restores from a link
- Export downloads a file in e2e
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

- One commit per task, message `WP-17: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-17 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-17 <status> | branch ai/wp-17-tp-header-filters @ <short sha> | rows done <n>/75 | steps <n>/9 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-TPH-01 | WB | BUILT | One row header under a visually hidden `h1` "Topics & Prompts" |
| WB-TPH-02 | WB | BUILT | "Updated {time}" from the newest `last_observed_at` (G01) |
| WB-TPH-03 | WB | PARTIAL | Meta counts "13 topics, 250 prompts" in the header (G01, AP-23) |
| WB-TPH-04 | WB | NOT BUILT | Saved view menu "View: Default" with Default, Branded prompts presets  |
| WB-TPH-07 | WB | BUILT | More actions menu: Copy link |
| WB-TPH-08 | WB | PARTIAL | More actions menu: Export CSV (all rows in scope) |
| WB-TPH-09 | WB | NOT BUILT | More actions menu: Export XLSX |
| WB-TPH-13 | WB | BUILT | Primary "Add prompts" (icon only under 640 px) |
| WB-TPH-15 | WB | BUILT | Topics and Prompts switch as a segmented control at the toolbar end |
| WB-TPH-17 | WB | NOT BUILT | Cadence line "Asked twice a week, Monday and Thursday" |
| WB-TPF-01 | WB | BUILT | Filter button and chips that wrap beside it |
| WB-TPF-02 | WB | BUILT | Topic filter (keeps the topic and every topic below) |
| WB-TPF-03 | WB | BUILT | Engine filter |
| WB-TPF-04 | WB | BUILT | Branded filter, Include only |
| WB-TPF-05 | WB | PARTIAL | Branded filter three way: Excluded (default chip), Included, Only (G08 |
| WB-TPF-10 | WB | NOT BUILT | Intent filter |
| WB-TPF-11 | WB | NOT BUILT | Funnel stage filter and column (AP-03) |
| WB-TPF-12 | WB | NOT BUILT | Importance filter (AP-21) |
| WB-TPF-13 | WB | NOT BUILT | Language filter |
| WB-TPF-08 | WB | NOT BUILT | Type filter chip (G10) |
| WB-TPF-16 | WB | BUILT | Reset filters |
| WB-TPF-17 | WB | BUILT | Dropped filters notice (a filter in the link that no longer applies) |
| WB-TPF-18 | WB | NOT VERIFIED | Filter sheet below 768 px (filters, window, country move into it) |
| WB-TPS-01 | WB | BUILT | Prompts chip (prompts in view, topics spanned in the tooltip) |
| WB-TPS-02 | WB | BUILT | One chip per engine: Mention rate, Cited and SOV in the tooltip with c |
| WB-TPS-03 | WB | BUILT | Insufficient chip under 4 valid answers (hatched) |
| WB-TPS-04 | WB | BUILT | "n/a" with the reason when an engine has no answer |
| WB-TPS-06 | WB | PARTIAL | Single engine in scope: its four rates (Mentioned, Cited, SOV, Valid a |
| WB-TPS-09 | WB | BUILT | Skeletons with labels while loading; hidden when no answers |
| WB-TPS-10 | WB | BUILT | "SOV" short label under 1,280 px |
| WB-MNU-01 | WB | BUILT | Prompt row: Open |
| WB-MNU-02 | WB | BUILT | Prompt row: Run now |
| WB-MNU-03 | WB | BUILT | Prompt row: Copy prompt |
| WB-MNU-04 | WB | BUILT | Prompt row: Archive |
| WB-MNU-08 | WB | PARTIAL | Prompt row: Copy link to the prompt (`?inspect=prompt:`) |
| WB-MNU-09 | WB | BUILT | Topic row: Open |
| WB-MNU-10 | WB | BUILT | Topic row: Show in Prompts (topic as filter, others kept) (G28) |
| WB-MNU-11 | WB | BUILT | Topic row: Add prompt (dialog with topic preselected) (G82) |
| WB-MNU-12 | WB | BUILT | Topic row: Run now |
| WB-MNU-13 | WB | BUILT | Topic row: Export CSV |
| WB-MNU-14 | WB | NOT BUILT | Right click opens the row menu (`RowContextMenu`) |
| WB-MNU-15 | WB | NOT VERIFIED | Menu items carry their shortcut hint ("Open" Enter) |
| WB-BLK-01 | WB | BUILT | Selection as a set of prompt ids, dropped when scope changes |
| WB-BLK-02 | WB | BUILT | Bar text "N selected"; on Topics "N topics selected, M prompts" |
| WB-BLK-04 | WB | BUILT | Bulk Run now, one `POST ai/runs` per 150 prompts, confirm naming the r |
| WB-BLK-05 | WB | BUILT | Run now refusals in words (paused provider, day limit, month quota, no |
| WB-BLK-06 | WB | BUILT | Bulk Archive, one `bulk-archive`, confirm above 100, Undo when every p |
| WB-BLK-07 | WB | BUILT | Bulk Export CSV of the selection (formula safe) |
| WB-BLK-08 | WB | BUILT | Clear selection |
| WB-BLK-13 | WB | BUILT | Keyboard: Shift click range, Escape clears |
| WB-NAV-05 | WB | BUILT | Top bar window select 7, 28, 90 days |
| WB-NAV-07 | WB | BUILT | Top bar Country scope (one market, "All countries") |
| WB-NAV-11 | WB | PARTIAL | Keyboard shortcuts dialog lists the AI page shortcuts (`/`, J, K, Ente |
| WB-NAV-12 | WB | PARTIAL | Project switch keeps AI page query minus `inspect`, `itab` |
| WB-KEY-01 | WB | BUILT | `/` focuses the table search |
| WB-KEY-02 | WB | BUILT | `j`, `k` next and previous record in an inspector |
| WB-KEY-03 | WB | BUILT | Enter opens the focused row |
| WB-KEY-04 | WB | BUILT | Escape closes the inspector, menu or dialog, focus returns to the row |
| WB-KEY-05 | WB | BUILT | Arrow keys in the treegrid (Right expand, Left collapse or parent) |
| WB-KEY-06 | WB | BUILT | `[` collapses the sidebar |
| WB-KEY-10 | WB | BUILT | Single-key shortcuts respect the preference switch |
| WB-KEY-11 | WB | PARTIAL | Shortcuts listed in the Help menu dialog |
| WB-IA-02 | WB | BUILT | AI Visibility > Topics & Prompts |
| WB-E2E-06 | WB | NOT BUILT | Topics tree expand, rollup note, Show in Prompts |
| WB-E2E-07 | WB | NOT BUILT | Bulk Run now and bulk Archive with the bulk routes |
| WB-E2E-08 | WB | NOT BUILT | Export CSV downloads a file |
| WB-STATE-01 | WB | BUILT | No engine on |
| WB-STATE-02 | WB | BUILT | No prompts |
| WB-STATE-03 | WB | BUILT | No answers yet |
| WB-STATE-04 | WB | BUILT | Filtered empty |
| WB-STATE-05 | WB | BUILT | Load error with error id, retry |
| WB-STATE-06 | WB | BUILT | Partial list (a page failed) |
| WB-STATE-07 | WB | BUILT | Insufficient data (under 4 valid answers) |
| WB-STATE-10 | WB | BUILT | No access (permission) |
| WB-STATE-14 | WB | BUILT | No flash of empty before data |
