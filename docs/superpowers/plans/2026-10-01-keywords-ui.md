# Keywords, Imports, Schedules and Costs (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team build its keyword set: add keywords singly or by paste, import a CSV with a preview of what will happen to every row, file keywords in groups and taxonomy terms, see each keyword's search volume, difficulty, CPC and intent, keep the metrics fresh on a schedule, and see what that costs.

**Architecture:** The screens of build-order step 5, first part (docs/29 section 1.1, Phase 3), on the backend plan `docs/superpowers/plans/2026-10-01-keywords.md` (branch `backend/keywords`, ac262fa). Rankings (`/seo/rankings`) becomes the first live analytics destination: a server-paged `DataTable` of tracked keywords with filters, bulk actions and a keyword inspector, without rank columns, which arrive with rank collection (step 5, second part). Add and Import are dialogs over Rankings. Schedules are a project settings section; Costs and Runs are workspace pages. The table, filter, inspector, stepper and chart primitives of the design system are built first, since every later analytics screen reuses them.

**Tech Stack:** As the foundation, plus `@tanstack/react-table` 9 and `@tanstack/react-virtual` 3 (chosen in `research/09-frontend-stack.md`, not installed yet) and the installed `echarts` 6 and `nuqs`.

**Sources of truth.**

| Document | Decides |
|---|---|
| Backend plan `2026-10-01-keywords.md`: Scope, D3, D4, D8, D10 to D13, D15 | What part 1 serves; restore of a deleted identity (D3); quota errors (D4: `422 quota_exceeded` with `limit`, `used`, `requested`; `both` counts two); metrics for new keywords within minutes and monthly on the 20th (D8); schedule cadences and workloads (D10: `cron` is `422 cadence_not_supported`); import sources, outcomes, actions and columns (D11 to D13); the list's filters, sorts, `include` and cursor paging with `page.total` (D15) |
| The backend's draft OpenAPI for step 5 part 1 (path sent by the backend session, built like step 4's) | Field names and shapes before the routes land on main |
| `docs/20-frontend-specification.md` sections 5.3, 5.3.1, 5.16, 5.18, 5.19.5 | What each screen holds |
| `docs/design-system/24-page-templates.md` sections 4 (T2), 9.3 (Rank Tracker), 9.14 (Costs) | Layout, columns, widths and priorities, bulk actions, density |
| `docs/design-system/12-tables.md`, `13-filters-search.md`, `16-drawers-dialogs-popovers.md` sections 2 and 4.6, `23-application-patterns.md` section 4.2, `15-data-visualization.md` | `DataTable`, `FilterBar`, `Inspector`, `StepperDialog`, the keyword inspector, `ChartFrame` |
| `docs/design-system/25-component-inventory.md` | Component paths and contracts (`app/data-table/*`, `app/filters/*`, `app/inspector/*`, `ui/stepper-dialog.tsx`, `app/chart/chart-frame.tsx`, `app/metric/metric-strip.tsx`, `app/status/collection-progress.tsx`) |
| `docs/design-system/11-navigation.md` sections 1 and 5 | Rankings in the sidebar; Project settings > Schedules; Workspace settings > Costs and Operations |

**Notes for the executor**

- Branch `frontend/keywords` in the main checkout, from `main` 2678a09. Never edit `backend/`, `infra/` or `.github/`.
- **Preconditions.** Two things are not this session's to decide alone:
  1. `pnpm add @tanstack/react-table@9 @tanstack/react-virtual@3` needs the user's go-ahead (installs need permission). Ask before Task 1.
  2. The draft contract. Until the backend sends its path, Task 1 to 3 need no generated types; from Task 4 on, `pnpm gen:api` reads `apps/web/openapi/step-5-draft.json` on this branch only, with its `.prettierignore` line, exactly as the entities plan did. The draft guard in `src/lib/api/schema.test.ts` tells when `backend/openapi/v1.json` has every draft route; then point `gen:api` back, delete `apps/web/openapi/`, regenerate (Task 13).
- Every task ends with the gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm run preview`, `pnpm e2e`), an independent review on the Opus model, fixes, the gates again, and a commit. No attribution lines. Push only on the user's word.
- The house rules hold: strict TypeScript, no literal strings in JSX, token utilities only, no en or em dash anywhere (a map of such characters is keyed by code point, as `foldName` does), `design-taste-frontend` before markup, files written with the Write and Edit tools, text limits counted with `textLength`.
- Paged lists that a screen shows whole use `apiAllPagesQuery`; the tracked keyword list is the exception: it pages on the server by cursor, since a project may track tens of thousands of keywords.
- **Not in this plan** (and where it arrives): rank columns, the metric strip's rank items, `RankCell`, `RankDeltaCell`, sparklines, SERP features, AI Overview status, "Check now" and the full keyword page `/seo/keywords/[tkId]` (step 5, second part); Export and the `rankings/export` action (step 7); budget editing, Settings > Budgets and usage (with the budgets API); run detail with its task table, dead letters, providers and freshness (Operations, with the tasks API); XLSX imports, the `competitors` import column, `force_separate` and schedule previews (step 10); saved views (`views:write`, its own plan).
- **Mock state.** Tracked keywords outgrow the entities cookie. They get their own (`mock-keywords`) holding only changes against fixtures (about 60 tracked keywords for Fynix with Labs metrics, two groups, terms from the Topics vocabulary), with the same codec, zod validation and size guard (`422 mock_state_full`). Import previews live in the browser worker's memory only (they expire after 7 days in the API too, and only client code reads them); a reload drops an unconfirmed preview, which the mock says in its doc comment.

## Scope

| Task | Result | Needs routes |
|---|---|---|
| 1 | `DataTable` (server and client mode, sort, selection, column chooser, density, pinned first column, cursor paging), `DataTableToolbar`, `BulkActionBar`; design-system sections | none |
| 2 | `FilterBar` and `FilterChip` with URL state (`nuqs`), `Inspector` with `?inspect=` and `useInspector`, `StepperDialog`, `MetricStrip`, `ChartFrame` on ECharts, `CollectionProgress`; design-system sections | none |
| 3 | Generated client and mocks for every route of the plan | backend Tasks 3 to 10 (mocks lead with the draft) |
| 4 | Rankings: the tracked keyword table, search, filters, sorts, archived view, empty states; the sidebar item goes live and a project opens on it | backend Tasks 3 and 4 |
| 5 | Keyword inspector: demand (metrics and volume by month), settings, groups and tags, competitor overrides, config history; editing | backend Tasks 3 to 5 |
| 6 | Add keywords dialog | backend Task 3 |
| 7 | Bulk actions: move to group, add and remove tags, set priority, set target URL, archive and unarchive with undo, delete | backend Tasks 4 and 5 |
| 8 | Keyword groups: group filter, "Manage groups" dialog (tree: add, rename, move, delete) | backend Task 5 |
| 9 | Import dialog: Upload, Map columns, Review, Confirm; progress; report | backend Task 10 |
| 10 | Keyword metrics: "Refresh metrics" with the day's manual limit, pending state for new keywords | backend Tasks 7 and 8 |
| 11 | Project settings > Schedules, and the keyword defaults in Project settings > General | backend Task 8 |
| 12 | Workspace Costs (`/[workspace]/costs`) and Runs (`/[workspace]/ops/runs`) | backend Tasks 8 and 9 |
| 13 | Contract switch, end to end, visual, documents, whole-branch review | all |

### Task 1: Data table

**Files:** `src/components/app/data-table/{data-table,toolbar,bulk-action-bar,column-chooser,use-table-state}.tsx` with tests; `src/lib/tables/` (sort and column state, URL codec) with tests; design-system section `data-table`.

- [ ] **Step 1:** Ask the user to approve `pnpm add @tanstack/react-table@9 @tanstack/react-virtual@3` in `apps/web`. Install on a yes; on a no, stop and say which tasks wait.
- [ ] **Step 2:** `lib/tables`: the table state as plain data (sort `{ id, desc }`, visible columns, density, selection) and its URL codec (`sort=-search_volume`, `cols=`), tests first: round trips, unknown columns dropped, default sort omitted from the URL.
- [ ] **Step 3:** `DataTable` to doc 12: 40 px rows (Default) and 32 px (Compact); sticky header; first column pinned when the table scrolls sideways; column widths and priorities from a column definition (`priority` 1 to 4 hides by viewport tier, doc 19 section 6.1, never by the inspector); `aria-sort` on sortable headers, sort from the header menu; checkbox column with Shift-click ranges and "Select all N" across pages in server mode (selection by id plus `allMatching` with the filters); row focus with Up and Down, Enter opens the inspector; virtualized rows above 100 (fixed row size per density, overscan 10); `role="grid"` with roving focus as doc 12 section 9 and doc 20-accessibility section 6. The two modes of doc 12 section 12 behind one API: client mode (up to 10,000 rows, loaded whole in 200-row pages in the background, sorted and searched in memory, unknown values last both ways) and server mode (above 10,000: the caller's sort and cursor, `TableFooter` with "Showing 1 to 200 of 48,210 keywords", previous and next, page size 100, 200 or 500); rows stay at full opacity with `aria-busy` and the refetch bar while a page or sort loads.
- [ ] **Step 4:** `DataTableToolbar` (search with `/`, count "1,000 keywords", density, columns) and `BulkActionBar` (replaces the toolbar on selection; count, actions, Clear; destructive actions last after a separator), each with axe and keyboard tests.
- [ ] **Step 5:** Design-system section with a 300-row sample in both modes and densities, e2e section check, gates, Opus review, commit "Add the data table".

### Task 2: Filters, inspector, stepper, strip, chart, progress

**Files:** `src/components/app/filters/{filter-bar,filter-chip,filter-editors}.tsx`, `src/components/app/inspector/*`, `src/components/ui/stepper-dialog.tsx`, `src/components/app/metric/metric-strip.tsx`, `src/components/app/chart/chart-frame.tsx`, `src/components/app/status/collection-progress.tsx`, tests, design-system sections.

- [ ] **Step 1:** `FilterBar` and `FilterChip` to doc 13 section 2: "+ Filter" opens a field menu, each chip opens its editor in a popover (enum multi-select with counts when given, number with an operator, text), chips say "Intent: Commercial, Transactional", Backspace on a focused chip removes it, "Clear filters" past two chips. State lives in the URL through `nuqs` parsers, one key per filter as the API names it (`intent_in`, `search_volume_gte`).
- [ ] **Step 2:** `Inspector` to doc 16 section 2: docked from 1440 px (400 px, resizable 360 to 640, width remembered per object type), overlay below, sheet below 768 px; `?inspect=keyword:<id>` pushed on open; `j` and `k` step through the list's rows in the current sort; Esc closes and returns focus to the row; header with title, meta, previous and next, "Open page" hidden while the object has no page; tabs from a list.
- [ ] **Step 3:** `StepperDialog` to doc 16 section 4.6 (720 px, `<ol>` stepper, completed steps are buttons back, Continue validates the step and focuses the first error, the final button names the result, a close past step 1 is a dirty close).
- [ ] **Step 4:** `MetricStrip` (doc 23 section 2: label, value, context line, `num`), `ChartFrame` on ECharts (doc 15 section 2: title, legend, "Table" toggle that renders the same data as a `SimpleTable`, theme from tokens, reduced motion off, ARIA description) and `CollectionProgress` (doc 17 section 4: label, done of total, cancel).
- [ ] **Step 5:** Design-system sections, axe and keyboard tests, e2e section checks, gates, Opus review, commit "Add filters, inspector, stepper, metric strip, chart and progress".

### Task 3: Generated client and mocks

**Files:** `apps/web/openapi/step-5-draft.json` (branch only), `src/lib/api/schema.ts`, `src/lib/api/types.ts`, `src/mocks/keywords-state.ts` and codec, `src/mocks/keyword-fixtures.ts`, `src/mocks/handlers/{keywords,tracked-keywords,keyword-groups,term-assignments,keyword-imports,keyword-metrics,schedules,runs,costs}.ts`, `src/test/api-shapes.ts`, tests.

- [ ] **Step 1:** Copy the draft, switch `gen:api` to it with its `.prettierignore` line, regenerate, export the new types from `types.ts`.
- [ ] **Step 2:** Fixtures and the `mock-keywords` change cookie (adds, edits, archives, deletes, group and term links, schedules) with the codec's round-trip and size tests.
- [ ] **Step 3:** Handlers mirroring the backend's rules from its plan and, once on its branch, its code (read through `git show backend/keywords:<path>`): identity and restore (D3), the quota (D4), filters, sorts, missing metrics last in both directions and the cursor with `page.total` (D15), groups (hard-deleted links, D2), term assignments with the single-valued check, imports with the five outcomes and `device: both` as two parts (D12), the 202 metrics refresh with 20 manual runs a day (D9), schedules (D10), runs, costs from a fixed rollup, budget status and the price book.
- [ ] **Step 4:** Handler tests against `api-shapes.ts`, one per rule above, gates, Opus review, commit "Add the step 5 client and mocks".

### Task 4: Rankings

**Files:** `src/app/[workspace]/[project]/seo/rankings/page.tsx`, `src/features/rankings/{rankings-screen,keyword-columns,keyword-filters,rankings-queries}.tsx`, `src/lib/navigation/registry.ts`, the project root redirect, `messages/en.json`, tests.

- [ ] **Step 1:** `rankings-queries`: filters always go to the API (`include=metrics,groups,terms`); when `page.total` is at most 10,000 the whole filtered list loads in 200-row pages and the table sorts and searches it in memory, above that the table pages on the server with the API's sort and cursor (doc 12 section 12). Keys under `['ws', W, 'p', P, 'tracked-keywords', filters]`; `refreshKeywords(queryClient, scope)` after every write.
- [ ] **Step 2:** Columns for part 1, in the template's order with rank columns left out: Keyword (location, device, engine and language in the tooltip), Volume (`Estimate` in the header tooltip; "Pending" before the first snapshot, "No data" after an empty one), KD, CPC, Intent (neutral badge, "Manual" marker), Priority, Group, Tags, Added. Volume, KD, CPC, Priority, Keyword and Added sort; the default is Volume descending.
- [ ] **Step 3:** Filters as chips (D15): group, tag (term), device, location, language, intent, funnel stage, priority at most, source, depth profile, volume at least, KD at most; search `q` in the toolbar; "Archived" as a view switch (`is_active=false`) rather than a chip.
- [ ] **Step 4:** Page header ("Rankings", meta "Updated … · 1,000 tracked keywords", primary "Add keywords", secondary "Import", More); no metric strip until ranks exist; empty states: no keywords yet (Add and Import), no matches (Clear filters); limited and read-only members see no write actions (`keywords:write`).
- [ ] **Step 5:** `rankings` goes live in the registry; the project root opens Rankings instead of Settings.
- [ ] **Step 6:** Screen tests (load, sort, filter round trip through the URL, load more, archived view, empty states, axe), gates, Opus review, commit "Rankings: the tracked keyword table".

### Task 5: Keyword inspector

**Files:** `src/features/rankings/keyword-inspector/{keyword-inspector,demand-section,settings-section,links-section,competitors-section,history-section}.tsx`, tests.

- [ ] **Step 1:** Header: keyword, meta "United States · Desktop · Google · English · depth 20"; one tab, Overview, in part 1 (SERP, AI and Timeline arrive with their steps).
- [ ] **Step 2:** Demand: volume (`Estimate`, data month), KD, CPC, intent with the foreign intents, competition level; volume by month as a `ChartFrame` bar chart from `metrics-history`, with its table view.
- [ ] **Step 3:** Settings with a form and `SaveBar`: target URL (`invalid_url` on the field), priority, depth profile, active; config history as a short list (what changed, who, when).
- [ ] **Step 4:** Groups and tags: chips with add and remove (groups by path, terms of the chosen vocabularies, single-valued vocabularies replace); competitor overrides: the project's competitors with include or exclude.
- [ ] **Step 5:** Tests (open from a row, `j` and `k`, each section, edits refresh the row), gates, Opus review, commit "Rankings: the keyword inspector".
- **As built.**
  - Cards: the metric strip (Volume, KD, CPC); searches by month; Groups and tags; Tracking (target URL, priority, intent and funnel stage edit in place); Competitors; Configuration history.
  - The depth profile changes through a dialog with an optional reason, because it starts a configuration version (16 section 2.5). Archive and Unarchive are in the More menu, with an Undo toast; they are not an "active" field in the form.
  - Groups and tags save pessimistically, not optimistically as 16 section 2.5 suggests, because one save is several requests. Terms go as one `replace` per save, and a partial save says so.
  - A save in flight holds Close, J, K and row opens. The browser's Back on a dirty inspector is not caught: this is the documented `useLeaveGuard` limit.
  - The user asked on 2026-10-01 for three rank columns (current position, change since yesterday's check, ranking URL). The backend recorded them for the part 2 contract; they join Rankings with rank collection.

### Task 6: Add keywords

**Files:** `src/features/rankings/add-keywords-dialog.tsx`, tests.

- [ ] **Step 1:** 560 px dialog: keywords one per line (counter, 700 characters each, repeats in any case once), location (`LocationCombobox`, project default), language, device (Desktop, Mobile, Both), search engine, group, tags, priority.
- [ ] **Step 2:** Errors: `422 quota_exceeded` says "This adds 120 keywords and the plan has room for 80 (1,920 of 2,000 used)" with `both` counted twice in the preview line before sending; `409 duplicate` with `existing_id` offers "Show it" and, for an archived one, "Unarchive"; a restored deleted keyword is told apart in the toast.
- [ ] **Step 3:** Tests, gates, Opus review, commit "Rankings: add keywords".
- **As built.**
  - Every add goes through `bulk-create` (`on_duplicate: skip`). Keywords tracked already come back as skipped with "Show it", plus "Unarchive" for an archived one; refused keywords come back with their reason.
  - The search engine is not a control: the contract allows Google only, and the dialog's description says so.
  - The device starts on the project's `seo.default_device`, and is left to the API until the settings load.
  - Lines are read by the API's text rules, which now live in `src/lib/keywords/keyword-text.ts` for both the dialog and the mocks.
  - A restored deleted keyword is told apart through `BulkCreateResult.restored` (backend a4ec77b, asked for on 2026-10-01). The toast and the result say how many came back with their old settings and history.

### Task 7: Bulk actions

**Files:** `src/features/rankings/bulk/{bulk-actions,move-to-group-dialog,tags-dialog,priority-dialog,target-url-dialog}.tsx`, tests.

- [ ] **Step 1:** Bulk bar actions in the template's order: Add tags, Move to group, Set target URL, Set priority, then after the separator Archive and Delete; "Select all N matching" sends the filters, not the ids.
- [ ] **Step 2:** Archive with a toast that undoes (unarchive), confirming first above 100 rows; unarchive over quota says how many fit; Delete confirms with the exact count.
- [ ] **Step 3:** Tests, gates, Opus review, commit "Rankings: bulk actions".
- **As built.**
  - Delete posts `bulk-delete` (backend 63063ae), which takes ids or a filter like the other bulk routes.
  - Ids go in requests of 5,000 at most, and group removals in requests of 100. When some requests land and a later one fails, the message says the change was partly made.
  - Archive by filter ("every matching keyword") has no Undo, since the rows it changed are not known; archive by ids keeps the Undo toast.
  - In client mode the list's search runs in memory, so the bulk filter sends no `q`, and "Select all N matching" is not offered while that search narrows the rows.
  - The selection is dropped for good when the filters, the view or the API's search change, and focus goes back to the grid after a dialog made its change.
  - Choosing terms is shared with Add keywords through `src/features/rankings/term-choices.ts`.

### Task 8: Keyword groups

**Files:** `src/features/rankings/groups/{manage-groups-dialog,group-picker}.tsx`, tests.

**Sub-plan:** `2026-10-05-keyword-groups-ui.md` (step by step; follow it rather than the steps below).

- [ ] **Step 1:** `GroupPicker` (Combobox of group paths, creatable) shared by the filter, the add dialog, bulk move and the inspector.
- [ ] **Step 2:** "Manage groups" from Rankings' More menu: the tree (`TreeView`) with add, rename, "Move to" and delete (subgroups go, members are unlinked, D2), member counts.
- [ ] **Step 3:** Tests, gates, Opus review, commit "Rankings: keyword groups".
- **As built.** Step by step in `2026-10-05-keyword-groups-ui.md`.
  - The filter keeps the filter bar's own group editor (paths with counts); a filter never creates a group.
  - `GroupPicker` (several, on `MultiSelect` with `creatable`) serves Add keywords and the inspector; `GroupSelect` (one or "No group", on `Combobox` filtered by the caller) serves bulk Move to group. A typed path such as `Blog/Guides` creates its missing levels when the form is saved, parents first; Cancel creates nothing.
  - Manage groups is a 560 px dialog from Rankings' More actions menu (`keywords:write` only) with inline forms for add, rename and move, and a confirmation for delete that counts the subgroups.

### Task 9: Import

**Files:** `src/features/rankings/import/{import-dialog,upload-step,mapping-step,review-step,confirm-step,import-queries}.tsx`, the `rankings/import` route rendering Rankings with the dialog open, tests.

**Sub-plan:** `2026-10-05-keyword-import-ui.md` (step by step, with the backend's import rules of 2026-10-05; follow it rather than the steps below).

- [ ] **Step 1:** Upload: paste or a CSV file (50 MB, multipart, a progress bar while it uploads); options: default location, language, device, the tags and topic vocabularies (D13); the API parses (`parse_import`), the dialog polls the import until its preview is ready.
- [ ] **Step 2:** Map columns: file header, "Maps to", a sample; auto-mapped by header, one required column (keyword), `competitors` not offered.
- [ ] **Step 3:** Review: counts per outcome (new, duplicate, variant, conflict, invalid, over quota) with the default action and its alternative (duplicate: skip or merge; conflict: skip or merge to unarchive; variant: create with its warning), the first 20 rows per outcome in a simple list with `row_no` and part, invalid rows with their `reason_code` in words.
- [ ] **Step 4:** Confirm ("Import 1,204 keywords"), then the dialog closes and the header shows `CollectionProgress` for the write job; on completion a toast with "Download report" (the streamed CSV); cancel before confirm; an expired preview says so.
- [ ] **Step 5:** Tests for each step and outcome, gates, Opus review, commit "Rankings: import keywords".
- **As built.** Step by step in `2026-10-05-keyword-import-ui.md`.
  - CSV only (the backend reads CSV). The browser reads the file's first 64 KiB for every header and three sample rows, and refuses a file that is not UTF-8 before uploading; `column_mapping` names only mapped headers.
  - Map is a step for files only. Vocabularies for tags and topics are chosen on the Map row that needs them (and on Upload for a paste with tabs); `needs_mapping` with `keyword_column_missing`, `tags_vocabulary_missing` or `topic_vocabulary_missing` shows on that row.
  - Review offers one choice per outcome: duplicates skip or merge (`duplicate_action`), archived keywords stay or are unarchived (row actions `merge` for every conflict row, sent before confirm). Over quota blocks Confirm: the last button is disabled (`finalDisabled` of `StepperDialog`) and the step says why.
  - `seo/rankings/layout.tsx` keeps Rankings mounted; `/seo/rankings/import` opens the dialog. The upload goes through `XMLHttpRequest` (`src/lib/api/upload.ts`) for its progress.
  - After Confirm the header shows the write's progress, resumed after a reload from `filter[status]=writing`, and the finished toast offers "Download report".
  - The mocks follow the backend's rules of 2026-10-05: `uploaded` instead of `parsing`, the `needs_mapping` codes, `not_applicable`, `not_with_mapping`, and skip only for repeated rows.
  - The component tests cannot upload through `XMLHttpRequest` or a multipart `fetch` under jsdom, so they replace `uploadForm` with `src/test/fetch-upload.ts`, which sends the file's rows to the JSON route; the real upload is covered by `upload.test.ts`, the mocks' own tests and the Playwright flow.

### Task 10: Keyword metrics

**Files:** `src/features/rankings/refresh-metrics.tsx`, tests.

- [ ] **Step 1:** "Refresh metrics" in Rankings' More menu (`runs:trigger`): for the selection, the filters, or all stale keywords; the menu item shows "14 of 20 left today" and is disabled with the reason at 0; a 202 shows `CollectionProgress` for the run.
- [ ] **Step 2:** New keywords show "Pending" until their first snapshot (D8: within minutes); the list refetches while any row on screen is pending, every 30 seconds, and stops when none is.
- [ ] **Step 3:** Tests, gates, Opus review, commit "Rankings: refresh keyword metrics".

### Task 11: Schedules and keyword defaults

**Files:** `src/app/[workspace]/[project]/settings/schedules/page.tsx`, `src/features/project-settings/{schedules-screen,schedule-dialog}.tsx`, Project settings > General's keyword defaults, `settings-frame.tsx`, tests.

- [ ] **Step 1:** Schedules: the project's schedules (workload, selector in words, cadence, time and window in the project's time zone, next run, last run, paused); edit in a dialog: cadence (daily, weekly with weekday, monthly with day of month), time, window, selector per workload (D10); pause, resume, delete; New schedule for `keyword_metrics` and `seo_rank`. Read-only without `schedules:write`.
- [ ] **Step 2:** General gains "Keyword defaults" from `{P}/settings` (`seo`): default device, depth profile, search engine.
- **From the backend as built (0b6371c, 4f99d3b, ecafcbc).**
  - A `keyword_metrics` schedule takes `provider_mode: 'live'` only. Left out, the mode is the workload's own (`live` for keyword metrics, `standard_queue` for rankings), so the dialog offers it only for rankings.
  - `window_start_local` is `HH:MM`: seconds or an offset are a `value_error` at the field.
  - A change recomputes `next_run_at` only when the rule changes, after now and outside the period the last window ran in. A restored keyword whose schedule was deleted comes back with `schedule: null`.
  - The service answers the first failing stage: the workload, the cadence and the provider mode; then the selector (`selector_not_supported`, `selector_empty`, `selector_conflict` for `all` with `stale_days`); then the days on a change (`required`, `not_applicable`) or `cron_expr`; then `timezone_unknown`; then the groups and terms.
  - A create's days that do not fit its cadence are one root `value_error`.
  - Pause and cancel take an optional body.
- [ ] **Step 3:** Tests, gates, Opus review, commit "Project settings: schedules and keyword defaults".

### Task 12: Costs and runs

**Files:** `src/app/[workspace]/costs/page.tsx`, `src/app/[workspace]/ops/runs/page.tsx`, `src/features/costs/*`, `src/features/operations/*`, the workspace menu and Settings > Workspace links, tests.

**Sub-plan:** `2026-10-05-costs-runs-ui.md` (step by step; Runs is per project on `{P}/runs`, since the backend builds no `{W}/runs` in part 1; follow it rather than the steps below).

- [ ] **Step 1:** Costs (`costs:read`) to template 9.14 for what part 1 has: month scope; strip with month to date, budget (`budgets/status`, a meter, read-only), blocked runs; spend by day stacked by workload (`ChartFrame`) with the by-workload table; breakdown tabs By provider, By project and Unit costs (the price book, labeled estimates); the cost sources line from `meta.cost_sources`. No projection until the forecast route exists.
- [ ] **Step 2:** Runs (`ops:read`, or own runs with `runs:trigger`): workload, trigger, status, window, tasks by status, estimate and actual cost, times; a run opens in the inspector (summary); Cancel for planned and running runs.
- [ ] **Step 3:** The workspace menu (Costs, Operations) and Settings > Workspace settings > Costs and Operations link to them.
- [ ] **Step 4:** Tests, gates, Opus review, commit "Workspace costs and runs".

### Task 13: Contract switch, end to end, documents, review

- [ ] **Step 1:** Once the backend's branch is on main: point `gen:api` back at `../../backend/openapi/v1.json`, delete `apps/web/openapi/` and its `.prettierignore` line, regenerate, fix differences.
- [ ] **Step 2:** E2E flows: add keywords and see them pending then filled; import a CSV through review and confirm; bulk move and archive with undo; edit in the inspector; a schedule change; Costs and Runs load. Visual: Rankings, the inspector, the import review step, Schedules, Costs, Runs, light and dark.
- [ ] **Step 3:** Documents: doc 20 as-built notes (5.3, 5.3.1, 5.16, 5.18, 5.19), 11-navigation, the component inventory rows for the new components, the review log.
- [ ] **Step 4:** Whole-branch Opus review, fixes, gates, commit; merge on the user's word.

## Self-review

- Every Scope row of the backend plan has a screen or is named under "Not in this plan": keywords and tracked keywords (Tasks 4 to 7), groups and term assignments (Tasks 5, 7, 8), imports (Task 9), metrics and refresh (Tasks 5, 10), project settings (Task 11), schedules, runs, costs, budget status and the price book (Tasks 11, 12). `{W}/keywords` and its `metrics-history` feed the inspector's demand section.
- Decisions D3, D4, D8, D10 to D13 and D15 each appear in the step that shows them to the user.
- Two preconditions are explicit and left to their owners: the dependency install (the user) and the draft contract (the backend session).
