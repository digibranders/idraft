# WP-17 detailed task plan: Topics & Prompts header, filters, facets, strip, menus and shell items

Brief: [docs/ai-visibility/work-packages/WP-17-tp-header-filters.md](../../ai-visibility/work-packages/WP-17-tp-header-filters.md).
Branch `ai/wp-17-tp-header` in `.claude/worktrees/wp-17`, cut from `origin/develop` at `48fdde4d`. Kind: web. Rows: 75, of which 53 are
BUILT and 22 are to do (NOT BUILT, PARTIAL or NOT VERIFIED). Owner requirements R-05 (the quality bar of the Keywords and Prompts pages)
and R-09 (topic performance stays readable beside the new filters).

Specs: [web.md](../../ai-visibility/inventory/web.md) sections 2.1 to 2.4, 2.7, 2.8, 3.1, 3.2, 3.6;
[24-page-templates.md](../../design-system/24-page-templates.md) 9.5 (and its "As built" notes); [c1-prompts.md](../../ai-visibility/contracts/c1-prompts.md)
(list filters); [2026-11-12-ai-prompts-w2-web-parity.md](2026-11-12-ai-prompts-w2-web-parity.md) W5 and W6;
[2026-11-13-ai-wp-16-layouts-customize.md](2026-11-13-ai-wp-16-layouts-customize.md) section 5; the WP-33 Overview shell
(`features/ai-overview`) as a model for scope, default chip, filter sheet, shortcuts and export blocks; DS 11 (navigation), 13 (filters),
12 (tables), 16 (menus), 17 (states), 20 (keyboard), 25 (parts).

Rules for every task (the brief's, repeated so a fresh agent has them in one place): one fresh Sonnet implementer per task, tests written
first and seen red, files edited only with the file tools (never shell heredocs, `sed` or replace scripts); then one fresh Sonnet reviewer
who reads this task, the diff and the guards table, runs the task's targeted tests, breaks each guard on purpose (section 3.4) and returns
PASS or a numbered fix list. At most two subagents of this session at once. One commit per task, message `WP-17: <task title>`, naming only
this package's files, no attribution lines, no dashes. No em-dash or en-dash in any string, comment, test name or doc line. House rules
(AI_DEVELOPMENT_UI_RULES.md): tokens only, type utilities only, numbers and dates through `@/lib/format`, `useShortcut` for single keys,
`Base UI` through `components/ui`, filters in the URL, every state (loading skeleton, empty with reason and action, error with retry,
partial, stale), no full-page spinner, a refetch keeps the previous data.

## 0. The hazard and how this plan stays out of its way

The coordinator warned that WP-19 (compare) and WP-27 (Add dialog) also touch `prompts-screen.tsx`, `prompt-columns.tsx` and
`rate-columns.tsx`. The plan therefore has two kinds of task:

- **(A) pure parts and new files only** (T1 to T11): models, components, hooks and tests in new folders (`facets/`, `header/`, `export/`,
  `columns/`, `menus/`, `shortcuts/`), plus the small leased edits to shared files that are not those three (section 8). No task of kind A
  edits `prompts-screen.tsx`, `prompt-columns.tsx` or `rate-columns.tsx`. They can be pushed to `develop` at any time.
- **(B) wiring** (T12 to T14): the only tasks that edit `prompts-screen.tsx`. They are last, small, and are **pushed only after the
  coordinator says WP-19 has merged**; the session then rebases and also rebases on WP-27's state before the B tasks start (the pre-flight
  of section 5.3). `prompt-columns.tsx` and `rate-columns.tsx` are not edited at all: the one new column goes in through the columns seam.
  After the B tasks come the tests that need the wiring (T15), the e2e (T16) and the closing task (T17).

Read on 2026-11-14: `git merge-base --is-ancestor origin/ai/wp-19-compare HEAD` is false (3 commits ahead: change in the prompt inspector
strip, the topic drawer, review fixes), but the compare select and chip (`prompts-screen.tsx` 209 to 211, 911), the change columns
(`columns/compare-columns.tsx`, seam `seams/columns.ts` line 14) and the change on the strip (`prompts-strip.tsx` 62 to 83) are already in this
base. `origin/ai/wp-27-add-dialog` is 7 commits ahead (add dialog, topic picker, entry points hook); its hunk in `prompts-screen.tsx` is the
dialog wiring near lines 1249 to 1263 and the empty state actions. Neither is in this worktree, so every B hunk below is described by what it
does and by the lines of the base it was read at, and is re-found by name after the rebase.

## 1. What exists and what was verified

Read in this worktree on 2026-11-14 (planning). Everything is from code unless it is in section 12.

| # | Fact | Consequence |
|---|---|---|
| V1 | `prompts-screen.tsx` is 1,267 lines: `PromptsScreen` (access gate) and `PromptsContent`. The list is **every active prompt**, read page after page (`usePromptList`, `prompt-queries.ts` 114 to 142, up to `MAX_PROMPTS = 1000`), and Topic, Country, Branded and the Detectable chip filter it **in the browser** (`rows` memo, lines 369 to 411). The summary is read once (`summaryQuery(scope, range, includeBranded, { country, include: SERIES, compare })`, 332 to 340) and feeds the strip, the engine columns and the Topics tab. | Prompt facets (intent, funnel, importance, language, type) are pure client filters over `Prompt` fields, with no new request and no mock change. The list holds the whole project, so option counts are exact once `optionsPending` is false |
| V2 | API: `GET prompts` takes `filter[intent_in]`, `filter[funnel_stage_in]`, `filter[importance_in]` (1 to 5), `filter[language_code]`, `filter[prompt_type_in]`, `filter[is_branded]` (openapi, c1-prompts.md lines 15, 47 to 56). The summary takes `branded_only` and `include_branded`, no facet. `summaryQuery` already accepts `brandedOnly` (`prompt-queries.ts` 160, 176); the screen never passes it. The mock summary supports `branded_only` (`mocks/handlers/prompt-answers.ts` 565, 601) | Branded Only is a request parameter plus a client filter. The Type chip needs no wait: B16 is on develop (`prompt_type`, `filter[prompt_type_in]` are in the schema), so the inventory note "hidden until B16" is out of date |
| V3 | The summary's topic rows are server aggregates over all prompts of a topic. There is no facet filter on the summary, so the Topics tab **cannot** narrow its rates by a facet without re-aggregating on the client | Decision D2: facets narrow the Prompts tab and the strip; the Topics tab keeps whole topics and says so in a notice. Open question Q1 |
| V4 | `seams/` exists (WP-02): `toolbar.ts` (`BUILT_IN_TOOLBAR_IDS = ['copy-link','add-prompts']`, slots `more` and `actions`), `actions.ts` (surfaces `promptRow`, `topicRow`, `bulk`, `inspectorMore`; line 16 and 70 reserve `copyLinkAction` for WP-17, WB-MNU-08), `columns.ts` (`PromptColumnEntry { id, after?, build(context) }`; WP-19's `compareColumns` is the live entry), `inspector-tabs.ts`, `topic-tabs.ts`. `wiring.test.tsx` proves the screens read each seam | Copy link and the Funnel column are seam entries in new files; no screen edit |
| V5 | `components/app/views` (WP-10) has `SavedViewMenu`, `useSavedView`, `matchView`, `viewParams`, `governedKeys`. `useSavedView` writes the id into the URL key **`view`** (`VIEW_KEY`). The Topics tab already owns the URL key `view` (`topics-by-engine/topics-view.tsx` 70 to 72, `drill.ts` 19: `heatmap`, `engines`, anything else is the List). Citations uses the hook (`citations-screen.tsx` 257) | A preset id in `view` would collide with the Topics view. Decision D3: the presets are **derived from the filter keys**, written with no `view` key; `SavedViewMenu` (props only) and `matchView` (pure) are reused, `useSavedView` is not |
| V6 | `write-excel-file` ^4.1.1 is a dependency (`apps/web/package.json` 85) and `lib/export/export-file.ts` loads it by `import('write-excel-file/universal')`. Its `buildWorkbook` is keyword shaped (`KeywordExport` with kinds and four KPI tiles). `fflate` is installed only as a dependency of it (pnpm strict: not importable from our tests). `lib/csv/csv-write.ts` has `safeText`, `csvBlob`, `downloadBlob`, `CsvTable` | No new dependency. A small prompts workbook builder over `write-excel-file/universal`; the test checks the zip signature, the member names and the cell model, not the packed XML |
| V7 | The row export exists: `buildPromptExport(rows, engines, labels): CsvTable` and `exportFileName(range)` (`export-rows.ts`), used by the bulk bar and row menus for a **selection** (`use-prompt-actions.tsx` 442 to 481). The labels are built inline there from `prompts.columns.*` and `prompts.bulk.*` | The header Export is the same writer over **all rows in scope**; the labels hook is repeated in a new file (shortcut comment, parity test) because `use-prompt-actions.tsx` is not ours |
| V8 | The shared `DataTable` already opens the row menu on right click and long press: `rowContextMenu = true` (`data-table.tsx` 166), `RowContextMenu` (`row-menu.tsx` 58), `ownsContextMenu` (`context-menu.ts`), tests in `data-table.test.tsx` (3002 to 3229). Both tabs pass `rowActions` (`prompts-screen.tsx` 1080, `topics-table.tsx` 586) | WB-MNU-14 is not "NOT BUILT": it is built in the shared table (WP-09) and has no page test. T8 proves it on both tabs |
| V9 | `Menu` items take `shortcut?: readonly string[]` (`components/ui/menu.tsx` 19, drawn at 127 with `Kbd decorative`). `RecordAction` (`data-table/types.ts` 8 to 26) has no `shortcut` and `rowMenuItems` (`data-table/row-menu.tsx` 21 to 34) drops it; `PromptAction` and `asRecordActions` (`prompt-action.ts`) likewise | WB-MNU-15 needs `shortcut` carried through three small shared edits (lease L3). Only a key that works may be shown: Enter opens the focused row (WB-KEY-03, `data-table.test.tsx` 390) |
| V10 | The shortcuts dialog is `features/shell/top-bar-controls.tsx` 128 to 138: the shell's own entries, `usePageShortcutEntries()` (the page seam, `components/app/shell/page-shortcuts.tsx`) and `?`. Only the AI Overview registers (`ai-overview/export/export-menu.tsx` 84, `header/customize-shortcut.tsx` 28). The Prompts page registers nothing; `/` (`data-table/toolbar.tsx` 59), `j`/`k` (`components/app/inspector/inspector.tsx` 142 to 143) and the shell's `[` (`use-sidebar.ts` 59) are live but unlisted except `[` | NAV-11 and KEY-11 are a page registration (`usePageShortcuts`), not a shell change |
| V11 | `switchHref` (`lib/navigation/registry.ts` 262 to 269) drops `inspect` and `itab` and carries the query only for destinations with `carriesQuery`, which are Runs and Costs (lines 200, 210; `registry.test.ts` 110 asserts exactly those two). `features/shell/project-shell.tsx` 105 to 114 calls it with `window.location.search` | NAV-12 is a registry edit (lease L2): carry the Prompts query and drop the project bound key `topic` (term ids belong to one project) |
| V12 | Schedules: `GET {P}/schedules?filter[workload]=ai_prompt` (`ai-overview/data/overview-queries.ts` 199 to 203, limit 10); a schedule has `cadence` (`daily`, `weekly`, `monthly`, `cron`), `weekday` (1 to 7), `month_day`, `cron_expr`, `is_active`, `next_run_at`. The mocks seed Monday and Thursday AI schedules (`mocks/ai-runs.ts` 22; at most two per project, `handlers/schedules.ts` 90) and the first engine turned on creates them (`engines-screen.tsx` 293). The copy "twice a week, on Monday and Thursday" is static text on the Engines screen (`en.json` 3661) | The cadence line is derived from the active schedules' weekdays and never invented: no schedule, a failed read or an unreadable cadence shows nothing; all paused says so |
| V13 | The layout system has a `prompts` screen of kind numbers only with no numbers (`lib/layouts/catalog.ts` 920, `numbersScreen('prompts', ...)`); every AI number type lists `screens` without `prompts` (lines 805 to 836). `NumberStrip` draws `MetricStrip size="md"`; the Prompts strip is `size="inline"` chips in the toolbar and one chip per engine **in scope** (`prompts-strip.tsx` 85 to 95). WP-16's as built says WB-LAY-43 is partial and that the Prompts strip "belongs to WP-17, which adopts `NumberStrip` and `useCustomizeMenuItem('customizeNumbers')`". WB-LAY-43 is **not** one of the 75 rows of this package; the tracker note repeats the request | Section 6: decision D6 (not built by default), the evidence, and a fully specified optional task T18 for the coordinator's go |
| V14 | Fixtures: Fynix has 24 prompts, all `intent: unknown`, `funnel_stage: unknown`, `prompt_type: question`, `importance: 3`, one Hindi prompt (`hi`, `mocks/prompt-fixtures.ts` 134 to 175) and one branded prompt ("Is Fynix a good SEO agency", `is_branded` by the text). Eventus Security (`fixtures/ai-prompts/eventus-security.json`, 72 prompts, on only after `setAiSeeded(true)`) has intent informational 34, commercial 36, navigational 2; funnel tofu 15, mofu 47, bofu 10; importance 2 to 5; types question, comparison, recommendation, how_to, definition, other; 7 branded; all English | Facet unit tests use Eventus; the language facet and the Branded three way use Fynix; the e2e (Fynix only, `ai-seed.ts`) tests the facets by their URL restore and by language and branded, and leaves Eventus variety to unit tests. No fixture edit is needed |
| V15 | `prompts.facets` is an empty object in `messages/en.json` (the namespace WP-02 pre-created for this package, MASTER-PLAN 3.4). Existing relevant keys: `prompts.filters.*`, `prompts.strip.*`, `prompts.rowMenu.*`, `prompts.meta`, `prompts.updated`, `prompts.copyLink`, `prompts.linkCopied`, `prompts.moreActions`, `prompts.droppedFilters.*`, `prompts.bulk.exported`, `prompts.bulk.exportFailed`, `prompts.bulk.exportNone` | New words go under `prompts.facets.<area>` only, additive; existing keys are not renamed |
| V16 | `components/app/filters`: `FilterBar` (`hideClear` for screens whose defaults are chips), `useUrlFilters` (one URL key per field id, keeps enum values while `optionsLoading`, reports dropped values), `FilterOption { value, label, count? }`. There is no shared `FilterSheet` (DS25 6.7 names one). The Overview has a local `features/ai-overview/scope/filters-sheet.tsx` (`FiltersSheet`, `SheetRow`) on `components/ui/sheet`; a feature may not import another feature | T11 builds a local copy in `facets/` with a `shortcut:` comment and a follow-up to promote it (F2) |
| V17 | e2e: `e2e/flows/ai-prompts.spec.ts` (265 lines, sole owner in wave 2) has WB-E2E-01 to 05 and an axe and sideways scroll matrix at widths 1440, 1280, 1024 and 390 in both themes (`WIDTHS`, line 17): **768 is missing**. Playwright runs only `e2e/flows/*.spec.ts`; helpers live in `e2e/support/<slug>.ts` (precedent `ai-overview-topics.ts`); `e2e/support.ts` is frozen (`signIn`, `expectAccessible`, `waitForContent`). Downloads and requests are tested with `page.waitForEvent('download')` and `page.waitForRequest` in other flows | T16 adds 768 and the new flows; the helper file is `apps/web/e2e/support/ai-prompts-header.ts` |
| V18 | Test evidence for the BUILT rows is in section 10. Two BUILT claims did not hold up: WB-TPS-10 (no "SOV" short label exists in the strip; only the column header "{engine} SOV", `en.json` 3777) and WB-BLK-13 (generic table tests exist, none on the Prompts page) | T7 builds the strip label; T9 adds the Prompts page proof for Shift range and Escape. Reported, not silently changed |

## 2. Goal and what "done" means

The Topics & Prompts header and filter bar are finished: meta counts, view presets, Export CSV (all rows in scope) and XLSX in More, the
cadence line, the Branded three way (Excluded default chip, Included, Only), the facets Intent, Funnel stage (with a column), Importance,
Language and Type, the filter sheet under 768 px, the single engine strip, Copy link to a prompt, shortcut hints and right click proven, the
shortcuts dialog listing the page's keys, the project switch carrying the query, and the three e2e flows the inventory lists as missing.

Every filter and every preset is in the URL and restores from a link; Export downloads a file in e2e; a percent always shows its count;
unknown is never 0; colour only for a detectable change; engines are never pooled silently; loading is a skeleton with labels; empty states
give a reason and an action; errors offer retry; a refetch keeps the previous data; light and dark; 390, 768, 1024 and 1280 px; axe clean
(no serious or critical); a keyboard path for each action; no em-dash or en-dash in any string.

## 3. Design

### 3.1 Folder layout (all new; the screen is edited only in T12 to T14)

```text
apps/web/src/features/prompts/
  facets/
    url-keys.ts            FACET_IDS, FacetId, FILTER_URL_KEYS (the keys a view governs)                         T1
    facet-model.ts         value lists, promptFacetValue, matchesFacets, facetSelectionOf, facetOptions,
                           facetFields, facetsActive                                                              T1
    branded-model.ts       BrandedChoice, parseBrandedChoice, brandedParams, keepsBranded, brandedField,
                           barValues, fromBar                                                                    T2
    facet-notice.ts        topicsFacetNotice (the Topics tab note, D2)                                           T2
    filters-sheet.tsx      FiltersSheet, SheetRow (local copy of the Overview's, F2)                              T11
  columns/facet-columns.ts  facetColumns: PromptColumnEntry (Funnel stage, hidden in the chooser)                T3
  views-model.ts           PROMPT_VIEWS, PROMPT_VIEW_KEYS, currentView, viewState                                T4
  header/
    prompt-view-menu.tsx   PromptViewMenu (SavedViewMenu over derived presets)                                  T4
    header-meta.ts         metaCounts, metaLines (pure)                                                          T6
    cadence-model.ts       cadenceOf(schedules): Cadence (pure)                                                  T6
    cadence-query.ts       useAiCadence(scope): CadenceRead                                                      T6
    header-meta.tsx        HeaderMeta (inline and menu variants)                                                 T6
    header-test-kit.tsx    renderPrompts, FYNIX, EVENTUS, serveSchedules, NOW (test support)                     T1
  export/
    prompts-workbook.ts    buildPromptSheet (pure), buildPromptWorkbook (writes the file)                         T5
    export-labels.ts       usePromptExportLabels()                                                               T5
    use-scope-export.tsx   useScopeExport({ rows, engines, range }): { csv, xlsx, items }                         T5
  actions/copy-link-action.ts   copyLinkAction: PromptActionEntry, promptLinkOf                                  T8
  menus/action-shortcuts.ts     ACTION_SHORTCUTS, shortcutOf                                                    T8
  shortcuts/
    prompts-shortcuts.ts   promptsShortcutEntries(words): ShortcutEntry[]                                       T9
    use-prompts-shortcuts.ts  usePromptsShortcuts()                                                             T9
```

Edits to existing files (all small, all leased or in the package's own lines, section 8): `prompts-strip.tsx` (T7, owned), `seams/actions.ts` (T8,
the two WP-17 lines), `seams/columns.ts` (T3, one import and one entry, L1), `seams/toolbar.ts` (T5, two built in ids, L4),
`data-table/types.ts` and `data-table/row-menu.tsx` (T8, L3), `prompt-action.ts` (T8, L3), `lib/navigation/registry.ts` and its test (T10, L2),
`selection-model.ts` and its test (T12, L5), `messages/en.json` (`prompts.facets` only), `prompts-screen.tsx` (T12 to T14, B).

### 3.2 URL keys (every filter and preset restores from a link)

| Key | Written by | Value | Notes |
|---|---|---|---|
| `topic`, `engine` | existing | as today | unchanged; `topic` is project bound (L2) |
| `branded` | T2, T12 | absent = Excluded (the default chip, never written), `include` = Included, `only` = Only | `include` is the value links already carry (Overview `drillHref` writes it, `drill-links.ts` 90); `included` is read too as an alias and rewritten to `include`; anything else is dropped by `useUrlFilters` and reported |
| `intent` | T1 | comma list of `informational`, `navigational`, `commercial`, `transactional`, `local`, `unknown` | the API's own words |
| `funnel` | T1 | comma list of `tofu`, `mofu`, `bofu`, `retention`, `unknown` | |
| `importance` | T1 | comma list of `1` to `5` | |
| `lang` | T1 | comma list of two letter codes present in the project | options wait for the list (`optionsLoading`) |
| `ptype` | T1 | comma list of `question`, `comparison`, `recommendation`, `how_to`, `definition`, `local`, `transactional`, `other` | named `ptype` so it never reads as an inspector `type` |
| `detectable` | existing (WP-19) | `only` | unchanged |
| `view` | existing (WP-20) | Topics view | **not used by the presets** (V5) |

A preset (Default, Branded prompts) is no key: it is a set of filter values, and the menu shows the preset whose values equal the URL's.

### 3.3 Decisions taken by default (reverse on the coordinator's word)

| # | Decision |
|---|---|
| D1 | Facets are client side filters over the loaded list (V1, V2): no request, no mock change. Counts on options are exact once the list is whole and absent (`count: null`) while it is not |
| D2 | **Facets narrow the Prompts tab and the strip's prompt set only.** On the Topics tab the strip, the topic rows and their rates ignore facets and a neutral notice (`Banner tone="info"`) names the active facets and offers "Show in Prompts" (V3). The alternative, re-aggregating topic rows from prompt rows on the client, is open question Q1 |
| D3 | View presets are derived, written without the `view` key; governed keys are the filter keys only (`topic`, `engine`, `branded`, `detectable`, the five facet keys); tab, sort, columns, density, search, country, window and compare are left alone by a preset (V5). WP-49's stored views must settle the key collision before they land: told to the coordinator (open question Q3) |
| D4 | Branded follows the Overview's rule: Excluded is a chip drawn from the default and never written; removing the chip means Included (URL `branded=include`, no chip); "+ Filter" brings Branded back; the chip editor offers Excluded, Included, Only. The bar uses `hideClear` and the screen draws "Reset filters" only while the URL has a filter |
| D5 | Header Export acts on the prompts in scope on both tabs (after topic, country, branded, facet and Detectable filters, not the search field and not the selection), file `prompts-<from>-to-<to>.csv` or `.xlsx`; the By engine CSV of the Topics view stays where WP-20 put it. A file of a header alone is never written (`bulk.exportNone`) |
| D6 | The Prompts strip is **not** made customizable in this package (section 6, V13). T18 is the specified optional task |
| D7 | The XLSX is one sheet "Prompts" (header row frozen, bold, text cells typed as text, percents and counts as numbers, text already `safeText` as in the CSV so the two files read the same) built with `write-excel-file/universal`; no colours from tokens (a sheet with no tokens in tests keeps the writer's defaults, as `export-file.test.ts` does) |
| D8 | Cadence line: weekdays of the active weekly `ai_prompt` schedules, sorted, named "Monday and Thursday"; "once a week", "twice a week", "N times a week" from the count; daily is "Asked every day"; monthly or cron is "Asked on a custom schedule"; all schedules paused is "Scheduled runs are paused"; none or a failed read is no line (never "weekly" for two a week, D-6) |
| D9 | Header meta: "Updated {time}" (existing link, unchanged), then "{n} topics, {m} prompts" (topics left out while the trees are unknown, as `stripTopics` is, never 0), then the cadence. Inline from the 64rem container (as Updated is), always in the More menu header with the window dates |
| D10 | Single engine strip: when exactly one engine is shown the chips are Prompts, Mentioned, Cited, Share of voice and Valid answers, each with its counts in the tooltip and the engine named in the strip's label and every tooltip; the change stays on Mentioned only (`stripChangeOf`, interim test). Under 1,280 px the Share of voice label is "SOV" (V18) |
| D11 | Copy link to a prompt writes the current address with `inspect=prompt:<id>`, without `itab` and `eng`, every other key kept; offered on the prompt row menu and in the inspector's More menu (surfaces `promptRow`, `inspectorMore`), for every role that can read |
| D12 | Shortcut hints only for keys that work: Open shows Enter. No other item gets a hint until a key exists for it |
| D13 | Page shortcuts listed in the Help dialog: `/` Search the table, J Next record, K Previous record, Enter Open the focused row, Escape Close the open record; the shell lists `[` and `?` itself. No new single key is added |
| D14 | The project switch carries the Prompts query minus `inspect`, `itab` and `topic` (L2). Other AI pages keep their current rule until their packages decide |
| D15 | Filter sheet (under 768 px): one "Filters" button with the count of filters that differ from the default, a bottom sheet holding the window, the country and the filter bar, taking effect at once; Done only closes. The top bar slot is not used below 768 px |
| D16 | A failed secondary read (schedules) leaves the page as it is: no banner, no line. The summary and list errors keep the page's existing states |

### 3.4 How a reviewer breaks a guard on purpose

Each task lists "guards": invariants that must have a test that fails BY NAME when the guard is removed. The reviewer removes or inverts the
guard in the code (a one line edit, reverted after), runs the named test, and records that it failed. A guard whose test does not fail is a
fix item (the test is too weak). Guards are the honest states and the data rules, not style.

## 4. Checks used by every task

- C1 TARGETED (no lock): `cd apps/web && pnpm exec vitest run <paths>`
- C2 MESSAGES (any task that edits `en.json`): `cd apps/web && pnpm exec vitest run src/i18n/messages.test.ts`
- C3 FORMAT (light): `cd apps/web && pnpm exec prettier --write <changed files>`
- C4 MEDIUM LANE, one call each (syntax in `infra/dev/README.md`):
  `infra/dev/heavy --lane medium --label wp17-tN-lint -- bash -c 'cd apps/web && pnpm lint'`,
  `... --label wp17-tN-types -- bash -c 'cd apps/web && pnpm typecheck'`,
  `... --label wp17-tN-format -- bash -c 'cd apps/web && pnpm format:check'`
- C4b FOLDER (medium lane, B tasks and anything that changes the screen's behaviour):
  `infra/dev/heavy --lane medium --label wp17-tN-prompts -- bash -c 'cd apps/web && pnpm exec vitest run src/features/prompts --maxWorkers=2'`
- C5 HEAVY (T17 only): `infra/dev/heavy --label wp17-test --wait 120 --max 60 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'`,
  then `--label wp17-build --wait 120 --max 60 -- bash -c 'cd apps/web && pnpm build'`, then
  `--label wp17-e2e --wait 120 --max 60 -- bash -c 'cd apps/web && E2E_PORT=3217 pnpm exec playwright test --project=e2e e2e/flows/ai-prompts.spec.ts e2e/flows/ai-topics-by-engine.spec.ts e2e/flows/ai-layouts.spec.ts'`
- Dev server (browser looks only, at most one): reuse one that already runs for this worktree (`lsof -nP -iTCP -sTCP:LISTEN`, match the cwd);
  else `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p 3217` in the background, and **stop it when the looks are done**; never
  kill a process on a port; delete the `AGENTS.md` and `CLAUDE.md` that `next dev` writes in `apps/web`. Pages: `/digibranders/eventus-security/ai/prompts`
  (seeded in dev: facet variety), `/digibranders/fynix/ai/prompts`, `/digibranders/cleanstart/ai/prompts` (no engine on). Accounts:
  `priya@digibranders.test` (editor), `jonas@digibranders.test` (analyst), `mei@digibranders.test` (viewer), `tomas@digibranders.test` (admin).
- Browser look of every task that draws something: 390, 768, 1024 and 1280 px, light and dark, Default and Compact density, with the
  keyboard path walked once. Reported in the task's commit message body only as "looked at 4 widths, 2 themes".
- Never push `main`, never run `infra/ship.sh`. Push is `git fetch origin && git rebase origin/develop`, the task's C1 and C4, then
  `git push origin HEAD:develop`.

Test harness (T1 creates `header/header-test-kit.tsx`; every later test of the screen uses it instead of copying the head of
`row-menu.test.tsx`): `renderPrompts({ search?, role?, project?: 'fynix' | 'eventus', onUrlUpdate? })` returns `ProvidedRender` plus
`writes: { queryString, history }[]` (the pattern of `compare/compare-wiring.test.tsx` 80 to 96); it mocks nothing itself, the test file keeps
`vi.mock('next/navigation', ...)`, `vi.mock('@/components/app/chart/echart', ...)` and the `@/test/topic-drawer-harness` import as
`row-menu.test.tsx` does. Eventus turns on with `setAiSeeded(true)` before the render (reset by the mock reset after each test); its project
fields (`id`, `slug`, `timeZone`, `defaultLanguage`) come from the `WORLDS` of `src/test/ai-overview-harness.tsx`. `NOW` is
`2026-11-12T12:00:00Z` with `vi.setSystemTime`, `stubWideScreen()` as the other prompts tests. `serveSchedules(weekdays | 'paused' | 'none' | 'fail')`
answers `GET .../schedules` with `server.use`. Axe: `import { axe } from '@/test/axe'` and `expect(await axe(container)).toHaveNoViolations()`.

## 5. Order, parallelism and file ownership (at most 2 subagents at once)

### 5.1 Waves

| Wave | Tasks | Files they touch (disjoint) |
|---|---|---|
| 1 | T1 with T5 | T1: `facets/url-keys.ts`, `facet-model.ts` + tests, `header/header-test-kit.tsx`, `en.json` skeleton and `facets.fields`. T5: `export/*`, `seams/toolbar.ts` (+ test), `en.json` `facets.export` |
| 2 | T2 with T4 | T2: `facets/branded-model.ts`, `facet-notice.ts` + tests, `en.json` `facets.branded` and `facets.notices`. T4: `views-model.ts`, `header/prompt-view-menu.tsx` + tests, `en.json` `facets.views` |
| 3 | T3 with T6 | T3: `columns/facet-columns.ts`, `seams/columns.ts`, test, `en.json` `facets.columns`. T6: `header/header-meta.*`, `cadence-*` + tests, `en.json` `facets.header` |
| 4 | T7 with T8 | T7: `prompts-strip.tsx` and its test, `en.json` `facets.strip`. T8: `actions/`, `menus/`, `seams/actions.ts`, `prompt-action.ts`, `data-table/types.ts`, `data-table/row-menu.tsx` (+ tests), `en.json` `facets.menus` |
| 5 | T9 with T10 | T9: `shortcuts/*` + tests, `en.json` `facets.shortcuts`. T10: `lib/navigation/registry.ts` and `registry.test.ts` |
| 6 | T11 | `facets/filters-sheet.tsx` + test, `en.json` `facets.sheet` |
| M1 | push the A tasks | `git fetch origin && git rebase origin/develop`, C1 on T1 to T11 files plus `seams/wiring.test.tsx`, `prompts.test.tsx`, `row-menu.test.tsx`, C4, `git push origin HEAD:develop`, `infra/dev/wp-status WP-17 building "pure parts on develop"` and the report line |
| wait | the coordinator says WP-19 has merged | tell the coordinator the B tasks are ready; do nothing on the screen until then |
| 7 | T12, then T13, then T14 (serial: one file) | `prompts-screen.tsx`, `selection-model.ts` + test (T12), `en.json` only if a word is missing |
| 8 | T15 with T16 | T15: tests under `header/` and `facets/`. T16: `e2e/flows/ai-prompts.spec.ts`, `e2e/support/ai-prompts-header.ts` |
| 9 | T17 | docs appends, rebase, whole app checks, whole diff review, push |

Rules that keep parallel tasks apart: each task replaces only its own `prompts.facets.<area>` object (T1 creates the skeleton first and
nobody else adds a sibling); when an `Edit` of `en.json` reports that the file changed, re-read only the lines around the object being
replaced and retry; a defect in another task's file is reported to the coordinator and fixed in a separate small commit `WP-17: fix <file>`
while nothing else runs, then the other task rebases.

### 5.2 Model plan

Opus planned (this file). Sonnet implements every task and reviews every task (fresh subagent each; the brief). Haiku may write the e2e
boilerplate of T16 (locators, the download helper) and the message objects of T1, T5, T6 and T9 when the keys are listed in the task. A
reviewer is never the implementer's session.

### 5.3 Pre-flight of T12 (before any B task)

`git fetch origin && git rebase origin/develop`; confirm `git log origin/develop --oneline | grep -c "WP-19"` shows the compare commits and the
coordinator's go; `git diff --stat origin/develop...HEAD -- apps/web/src/features/prompts/prompts-screen.tsx` is empty (nothing of ours is
in the screen yet); re-run C1 on `compare/compare-wiring.test.tsx`, `prompts.test.tsx`, `row-menu.test.tsx` so the base is green; read the
three screen hunks WP-19 and WP-27 left (the toolbar right group, the empty state actions, the dialog) so no B hunk lands inside them.

## 6. The WP-16 hand-over: customize the numbers of this page (decision with evidence)

The tracker note asks this package to adopt `NumberStrip` inside `CustomizableScreen` and to add "Customize numbers" to the page More menu.
The WP-16 plan section 5 and its as built say the parts exist and are proven on a specimen (`features/layouts/customize/numbers-only-screen.test.tsx`
renders exactly such a page: hidden title, `useCustomizeMenuItem('customizeNumbers', more)` in the More menu, `CustomizingBadge` in `actions`,
`NumberStrip` with `readBanner`). What was read here against it:

1. **Not in the rows.** WB-LAY-43 is a WP-16 row (partial) and is not one of this package's 75. The brief's step 3 asks for the single engine
   variant only.
2. **The strip is not a fixed list.** Its chips are one per engine in scope (`prompts-strip.tsx` 85 to 95), driven by the Engine filter and by
   which engines are on, and by one engine the chips change kind (D10). A stored layout names fixed numbers with fixed engines
   (`NumberItem { id, metric, engine? }`): a layout that lists Gemini while the Engine filter leaves it out must either show an engine that is
   out of scope or hide a number silently, and a layout cannot express "the engines in scope". That breaks "engines never pooled silently" and
   "the strip follows the filters".
3. **The look differs.** `NumberStrip` draws `MetricStrip size="md"` (a 76 px panel); the Prompts strip is `size="inline"` chips in the toolbar
   row by design (ADR-DS-022 decision 12, D20 784, the compact header). Adopting it moves the strip out of the toolbar.
4. **It needs shared files this package does not own.** The `prompts` screen has no numbers (`catalog.ts` 920) and no number type lists the
   `prompts` screen (805 to 836); adding them is an edit of `lib/layouts/catalog.ts` plus `pnpm gen:layout-catalog` and a regenerated
   `backend/src/idraft/api/layouts/catalog.json` (WP-16's as built: every catalog edit regenerates it), and the backend's allowed screens and
   numbers must agree. The page also needs `CustomizableScreen` around the whole screen body, header included, which is a large hunk of the
   hazard file.

Default (D6): not built here. The honest outcome is reported to the coordinator with this evidence, WB-LAY-43 stays partial (WP-16's row), and
T18 below is a complete task the coordinator can release if the owner wants it. T18 is deliberately last and needs leases L6 to L8.

## 7. Tasks

Each task: files, exports with signatures, tests first (file and cases), guards, checks, rows, commit.

---

### T1 (A): facet model, URL keys, message skeleton and the test kit

Files (new): `facets/url-keys.ts`, `facets/facet-model.ts`, `facets/facet-model.test.ts`, `header/header-test-kit.tsx`. Modify: `messages/en.json`
(the skeleton `prompts.facets = { fields: {}, branded: {}, columns: {}, views: {}, export: {}, header: {}, strip: {}, menus: {}, shortcuts: {}, sheet: {}, notices: {} }`
in one tiny first edit, then `fields` filled here).

Exports:

```ts
// url-keys.ts
export const FACET_IDS = ['intent', 'funnel', 'importance', 'lang', 'ptype'] as const;   // field id = URL key
export type FacetId = (typeof FACET_IDS)[number];
export const FILTER_URL_KEYS: readonly string[];   // 'topic','engine','branded','detectable' then FACET_IDS: the keys a preset governs
// facet-model.ts
export const INTENTS: readonly Prompt['intent'][];            // informational, navigational, commercial, transactional, local, unknown
export const FUNNEL_STAGES: readonly Prompt['funnel_stage'][]; // tofu, mofu, bofu, retention, unknown
export const PROMPT_TYPES: readonly Prompt['prompt_type'][];   // question, comparison, recommendation, how_to, definition, local, transactional, other
export const IMPORTANCES: readonly string[];                    // '1' to '5'
export type FacetSelection = Readonly<Record<FacetId, readonly string[]>>;
export const NO_FACETS: FacetSelection;
export function promptFacetValue(prompt: Prompt, id: FacetId): string;          // importance as String(n); lang lower case
export function matchesFacets(prompt: Prompt, selection: FacetSelection): boolean; // AND across facets, OR inside one, empty facet: no constraint
export function facetSelectionOf(values: FilterValues): FacetSelection;         // reads enum values of the five fields
export function facetsActive(selection: FacetSelection): number;                // facets with at least one value
export interface FacetWords { field: (id: FacetId) => string; option: (id: FacetId, value: string) => string }
export function facetOptions(id: FacetId, prompts: readonly Prompt[], words: FacetWords, countsKnown: boolean): FilterOption[];
export function facetFields(prompts: readonly Prompt[], words: FacetWords, loading: boolean): EnumFilterField[]; // order: intent, funnel, importance, ptype, lang
```

`facetOptions`: the four enum facets list every API value in the API's order (so a valid link value is never "dropped" for being absent from
the project), each with `count` = prompts with it when `countsKnown` else `null`; `lang` lists the codes present in `prompts` (and a code
already chosen is the caller's, via `optionsLoading`), most prompts first then code, labels through `languageName` of `@/lib/format/language`
(by `words.option('lang', code)`). All fields `multi: true`; `optionsLoading: loading` for `lang` only. Option and field words come from
`prompts.facets.fields` (`intent`, `funnel`, `importance`, `type`, `language`, and `intentOptions.<value>`, `funnelOptions.<value>`,
`typeOptions.<value>`, `importanceOption` "{value}"); `unknown` reads "Not set" in all three.

Test kit (`header/header-test-kit.tsx`): see section 4; it is a test support file (named `*-kit.tsx`, not a test), exports `NOW`, `FYNIX`,
`EVENTUS`, `renderPrompts`, `serveSchedules`, `promptsAs`.

Tests first (`facet-model.test.ts`):
- `lists every API value of intent, funnel stage and type, in the API order, with the project's counts`
- `a value no prompt has is still an option with a count of 0`
- `counts are null while the list is not whole`
- `language options are the codes the prompts carry, most prompts first, named in words`
- `a prompt matches when it has any chosen value of each facet and every facet with a value is met`
- `an empty facet puts no constraint`
- `unknown is a value of its own: intent unknown matches the prompts whose intent is unknown, not every prompt`
- `importance is compared as a number read from the link, so 4 matches importance 4`
- `a language code matches without regard to case`
- `facetSelectionOf reads only the five fields and ignores the rest`
- `facetsActive counts the facets, not the values`
- `facetFields has the five fields in order and only language waits for the list`
- `no string holds a dash` (reads `en.json` `prompts.facets` and asserts no U+2013 or U+2014; the messages test does it too, this is the early catch)

Guards:

| Guard | Test that fails when it is removed |
|---|---|
| AND across facets, OR inside one | `facet-model.test.ts > a prompt matches when it has any chosen value of each facet and every facet with a value is met` |
| unknown is a value, an empty facet is no constraint | `... > unknown is a value of its own: ...` and `... > an empty facet puts no constraint` |
| valid values are always options | `... > a value no prompt has is still an option with a count of 0` |
| no count while the list is incomplete | `... > counts are null while the list is not whole` |

Checks: C1 on `facets/facet-model.test.ts` and `src/i18n/messages.test.ts` (C2), C3, C4. Rows: TPF-08, TPF-10, TPF-12, TPF-13 (model), TPF-11 (model).
Commit `WP-17: facet model, URL keys and test kit`.

---

### T5 (A, with T1): header Export, CSV in scope and XLSX

Files (new): `export/prompts-workbook.ts`, `export/prompts-workbook.test.ts`, `export/export-labels.ts`, `export/export-labels.test.tsx`,
`export/use-scope-export.tsx`, `export/use-scope-export.test.tsx`. Modify: `seams/toolbar.ts` (add `'export-csv'` and `'export-xlsx'` to
`BUILT_IN_TOOLBAR_IDS`, so a later package cannot take them; L4) and `seams/toolbar.test.ts` (one case), `messages/en.json` (`facets.export`).

Exports:

```ts
// prompts-workbook.ts
export const XLSX_FILE_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function buildPromptSheet(table: CsvTable): SheetData;        // pure: header cells bold String, numbers Number, text String, null cells absent
export function buildPromptWorkbook(table: CsvTable, sheetName: string): Promise<Blob>;   // import('write-excel-file/universal'), header row frozen
export const workbookFileName = (range: DateRange): string => `prompts-${range.from}-to-${range.to}.xlsx`;
// export-labels.ts   (shortcut: repeats the labels of use-prompt-actions.tsx 456 to 468; parity test below; move to one place when that file is free)
export function usePromptExportLabels(): PromptExportLabels;
// use-scope-export.tsx
export interface ScopeExport { items: MenuItemDef[] }   // ids 'export-csv', 'export-xlsx', group 'export'
export function useScopeExport(input: { rows: readonly PromptRow[]; engines: readonly ProjectEngine[]; range: DateRange; waiting: string | null }): ScopeExport;
```

Behaviour: the items are "Export CSV" and "Export XLSX" (icon `Download`); `rows` are the rows in scope in list order, not the selection; with no
row both items carry `disabledReason` (`facets.export.none`: "No prompts to export in this view"), and while `waiting` is a reason
(`facets.export.waiting`: "The list is still loading") they carry it; CSV: `csvBlob(buildPromptExport(rows, engines, labels))` through
`downloadBlob` with `exportFileName(range)`; XLSX: `buildPromptWorkbook(table, t('sheet'))` (`facets.export.sheet` "Prompts") then `downloadBlob(blob, workbookFileName(range))`;
success toast `prompts.bulk.exported` with the row count; failure toast `prompts.bulk.exportFailed`; the writer is loaded only on the XLSX click.

Tests first:
- `prompts-workbook.test.ts`: `a workbook is a zip: the blob starts with PK and holds the sheet and content type members` (reads the bytes, finds the ASCII names `[Content_Types].xml` and `xl/worksheets/sheet1.xml`, which a zip stores uncompressed in its headers), `the sheet has the header row as bold text and one row for each prompt`, `percents and counts are numbers, not text`, `an empty cell is no cell, never 0`, `text that starts with = + - or @ is written as text with the same apostrophe the CSV gets` (compares `buildPromptSheet(buildPromptExport(...))` text cells with `toCsv` lines), `the file name carries the window`, `the writer is not imported until the workbook is asked for` (the module's static imports contain no `write-excel-file`; read the source text, as `components/design-system` tests do).
- `export-labels.test.tsx`: `the labels equal the ones the bulk export uses` (renders a probe that calls both `usePromptExportLabels()` and builds the header of `buildPromptExport` once with a header written the way `use-prompt-actions.tsx` writes it; the expected header is spelled out in the test so a drift in either fails).
- `use-scope-export.test.tsx`: `Export CSV downloads all rows in scope, not the selection` (spies `downloadBlob`; three rows, one selected state is irrelevant to the hook, the file has three data lines), `the file name is prompts-from-to-to.csv`, `a prompt text that starts with = is written with the leading apostrophe`, `Export XLSX downloads a blob named .xlsx and says how many prompts`, `no rows disables both items with the reason, and no file is written`, `a waiting list disables both with its reason`, `a failure of the writer says the export failed and writes nothing`, `a header only file is never written`.

Guards:

| Guard | Test |
|---|---|
| export is all rows in scope, not the selection | `use-scope-export.test.tsx > Export CSV downloads all rows in scope, not the selection` |
| formula injection safe in both files | `use-scope-export.test.tsx > a prompt text that starts with = ...` and `prompts-workbook.test.ts > text that starts with = + - or @ ...` |
| no file of a header alone | `use-scope-export.test.tsx > no rows disables both items with the reason, and no file is written` |
| unknown is an empty cell | `prompts-workbook.test.ts > an empty cell is no cell, never 0` |
| the XLSX is a real zip | `prompts-workbook.test.ts > a workbook is a zip ...` |
| the writer loads only on demand | `prompts-workbook.test.ts > the writer is not imported until ...` |

Checks: C1, C2, C3, C4. Rows: TPH-08 (the writer and hook; the menu item arrives in T13), TPH-09. Commit `WP-17: header export as CSV and XLSX`.

---

### T2 (A): Branded three way, the default chip and the Topics notice

Depends on T1. Files (new): `facets/branded-model.ts`, `facets/branded-model.test.ts`, `facets/facet-notice.ts`, `facets/facet-notice.test.ts`.
Modify `messages/en.json` (`facets.branded`: `label` "Branded prompts", `excluded` "Excluded", `included` "Included", `only` "Only"; `facets.notices`).

Exports:

```ts
export type BrandedChoice = 'excluded' | 'included' | 'only';
export function parseBrandedChoice(value: string | null | undefined): BrandedChoice;   // 'only' only; 'include' and 'included' included; else excluded
export const brandedUrlValue = (choice: BrandedChoice): string | null;                 // excluded null, included 'include', only 'only'
export function brandedParams(choice: BrandedChoice): { includeBranded: boolean; brandedOnly: boolean };   // only: both true
export function keepsBranded(choice: BrandedChoice, prompt: Pick<Prompt, 'is_branded'>): boolean;
export function brandedField(words: { label: string; excluded: string; included: string; only: string }): EnumFilterField;  // options: excluded, include, only
export function barValues(url: FilterValues): FilterValues;      // the bar's values: a chip for excluded (from the default) and only, none for included
export function fromBar(next: FilterValues): FilterValues;       // back to URL values: no chip is included ('include'), the excluded chip is not written
// facet-notice.ts
export function topicsFacetNotice(input: { tab: PromptsTab; selection: FacetSelection }): { facets: FacetId[] } | null;   // topics tab and a facet set
```

Tests first:
- `branded-model.test.ts`: `reads include and included as Included, only as Only, and anything else as Excluded`, `Excluded is the default and is not written`, `only asks the summary for branded prompts alone and includes them`, `included includes branded prompts without narrowing to them`, `keepsBranded: excluded drops branded prompts, included keeps all, only keeps branded ones`, `the bar draws a default chip for Excluded and a chip for Only, and none for Included`, `removing the chip means Included and writes include`, `choosing Excluded in the editor writes nothing`, `a link with branded=included is read as Included and rewritten as include` (through `fromBar(barValues(...))` round trip: every choice round trips).
- `facet-notice.test.ts`: `no notice on the Prompts tab`, `no notice without a facet`, `the Topics tab with a facet names the facets in the field order`.

Guards:

| Guard | Test |
|---|---|
| Excluded is a default chip, never written | `branded-model.test.ts > Excluded is the default and is not written` and `... > the bar draws a default chip ...` |
| removing the chip is Included, not "no filter" | `branded-model.test.ts > removing the chip means Included and writes include` |
| Only is branded alone, not "all" | `branded-model.test.ts > keepsBranded: ...` and `... > only asks the summary ...` |
| the Topics tab says facets do not narrow it | `facet-notice.test.ts > the Topics tab with a facet names the facets in the field order` |

Checks: C1, C2, C3, C4. Rows: TPF-05 (model). Commit `WP-17: Branded three way model and Topics facet notice`.

---

### T4 (A, with T2): view presets and the view menu

Depends on T1. Files (new): `views-model.ts`, `views-model.test.ts`, `header/prompt-view-menu.tsx`, `header/prompt-view-menu.test.tsx`. Modify `messages/en.json` (`facets.views`:
`default` "Default", `brandedPrompts` "Branded prompts").

Exports:

```ts
export const PROMPT_VIEW_KEYS: readonly string[];                        // = FILTER_URL_KEYS, a stable module constant
export function promptViews(names: { default: string; brandedPrompts: string }): SavedView[];   // default (no params) and 'branded-prompts' { branded: 'only' }
export function currentView(views: readonly SavedView[], state: ViewState, defaultName: string): { view: SavedView; edited: boolean };   // the preset whose params equal the state on the governed keys, else Default edited
export function viewWrites(view: SavedView): Record<string, string | null>;   // every governed key, its value or null; never `view`, `inspect`, `itab`, `win`, `from`, `to`, `tab`, `sort`, `cols`, `density`, `country`, `cmp`, `q`
// header/prompt-view-menu.tsx
export function PromptViewMenu(): ReactElement;   // reads and writes the URL itself (nuqs useQueryStates over PROMPT_VIEW_KEYS), no props
```

`PromptViewMenu` renders the shared `SavedViewMenu` (trigger "View: Default", "(edited)" when the filter keys differ from the preset), applies a
preset with one URL update, `history: 'push'` (a view is a place to go back to), announces through the menu's own `applied` text, and keeps
the Topics view (`view`), the tab, the sort, the columns, the density, the country, the window and the comparison as they are.

Tests first:
- `views-model.test.ts`: `Default has no params and Branded prompts is branded=only`, `no filter key is the Default view`, `branded=only alone is the Branded prompts view`, `branded=only with a topic is Default, edited`, `the same values in another order are the same view` (facets as sets), `viewWrites clears every governed key the preset does not name`, `viewWrites never writes view, tab, sort, columns, density, country, comparison, search, window or inspector keys`, `a preset round trips through the URL: apply, read, equal`.
- `prompt-view-menu.test.tsx`: `shows View: Default with no filter`, `shows Branded prompts for ?branded=only and is not edited`, `choosing Branded prompts writes branded=only in one update and keeps ?view=heatmap and ?tab=prompts`, `choosing Default clears the filters and keeps the tab, sort, columns and window`, `the menu says (edited) when a filter is added to a preset`, `a shared link restores the preset` (render with `?branded=only`, no click), `Reset applies the current view again`, `the menu is a labelled button, opens with Enter and Space, closes with Escape and returns focus` (axe on the open menu), `a preset applied is announced`.

Guards:

| Guard | Test |
|---|---|
| a preset never touches the Topics `view` key | `prompt-view-menu.test.tsx > choosing Branded prompts writes branded=only in one update and keeps ?view=heatmap and ?tab=prompts` |
| scope and layout keys are not governed | `views-model.test.ts > viewWrites never writes ...` |
| a preset restores from a link with no key of its own | `prompt-view-menu.test.tsx > a shared link restores the preset` |
| edited is read from the URL, not remembered | `views-model.test.ts > branded=only with a topic is Default, edited` |

Checks: C1, C2, C3, C4. Rows: TPH-04. Commit `WP-17: view presets and the view menu`.

---

### T3 (A, with T6): Funnel stage column through the columns seam

Depends on T1. Files (new): `columns/facet-columns.ts`, `columns/facet-columns.test.tsx`. Modify `seams/columns.ts` (one import line and one entry line under a
new `// WP-17 tp-header-filters` comment, L1), `seams/columns.test.ts` (the entry is placed and unique), `messages/en.json` (`facets.columns.funnel`).

Export: `facetColumns: PromptColumnEntry = { id: 'facets', after: 'topic', build }` where `build(context)` returns one column, id `funnel`, header
"Funnel stage", `defaultVisible: false` (the chooser, like WP-19's change columns), a neutral `col.badge` with the stage's words (never a colour of
its own), sorted by the stage order tofu, mofu, bofu, retention, unknown (unknown last either way), cell tooltip "Funnel stage: Middle of the funnel". No
other facet column is added (the Funnel row asks for one).

Tests first (`facet-columns.test.tsx`): `has one column, hidden until the chooser asks for it`, `the cell says the stage in words and unknown as Not set`, `sorts by funnel order with unknown last in both directions`, `is placed after the Topic column and its id is unique`, `the Prompts tab offers it in the column chooser and shows it when chosen` (renders the screen on Eventus with `?tab=prompts&cols=prompt,funnel`, the screen being unedited: the seam is the only wiring), `a prompt with no funnel stage in the payload reads as Not set, never a blank or 0`.

Guards: `unknown sorts last both ways` (`... > sorts by funnel order with unknown last in both directions`); `hidden by default` (`... > has one column, hidden until ...`); `reads the seam only` (`seams/wiring.test.tsx` stays green with the fake entries).

Checks: C1 on the two tests and `seams/columns.test.ts`, `seams/wiring.test.tsx`, `columns/compare-columns.test.tsx`, C2, C3, C4. Rows: TPF-11 (the column; the filter is T1/T12). Commit `WP-17: funnel stage column`.

---

### T6 (A, with T3): header meta counts and the cadence line

Files (new): `header/header-meta.ts`, `header/header-meta.test.ts`, `header/cadence-model.ts`, `header/cadence-model.test.ts`, `header/cadence-query.ts`,
`header/cadence-query.test.tsx`, `header/header-meta.tsx`, `header/header-meta.test.tsx`. Modify `messages/en.json` (`facets.header`).

Exports:

```ts
// cadence-model.ts
export type Cadence =
  | { kind: 'days'; weekdays: readonly number[] }      // active weekly schedules, 1 (Monday) to 7, sorted, distinct
  | { kind: 'daily' } | { kind: 'custom' } | { kind: 'paused' } | { kind: 'none' };
export function cadenceOf(schedules: readonly Pick<Schedule, 'cadence' | 'weekday' | 'is_active'>[]): Cadence;
// cadence-query.ts
export function useAiCadence(scope: PromptScope): { cadence: Cadence; status: 'loading' | 'ready' | 'failed' };   // GET schedules?filter[workload]=ai_prompt&limit=10 (same request as the Overview's, one cache entry)
// header-meta.ts
export function metaCounts(input: { topics: number | null; prompts: number }): { topics: number | null; prompts: number };
// header-meta.tsx
export function HeaderMeta(props: { variant: 'inline' | 'menu'; updated: ReactNode | null; topics: number | null; prompts: number; ready: boolean; scope: PromptScope; windowCaption: string }): ReactElement | null;
```

`HeaderMeta` words (all `prompts.facets.header`): `counts` "{topics, plural, one {# topic} other {# topics}}, {prompts, plural, one {# prompt} other {# prompts}}", `countsPromptsOnly`
"{prompts, plural, one {# prompt} other {# prompts}}" (topics unknown), `cadenceDays` "Asked {times}, {days}" with `times` ("once a week", "twice a week", "{count} times a week"),
`cadenceDaily` "Asked every day", `cadenceCustom` "Asked on a custom schedule", `cadencePaused` "Scheduled runs are paused". Day names through `@/lib/format` (a
weekday formatter exists there; if not, the model uses `Intl.DateTimeFormat` through the format module, never directly) and `formatList` for "Monday and Thursday". `inline`: "Updated {time}" then the
counts after a middle dot, with the window dates and the cadence in the tooltip (the existing tooltip on Updated); `menu`: four lines (updated, counts, cadence, window). While `ready`
is false nothing is drawn for the counts (no flash of "0 prompts"); a failed or empty cadence read draws no line (D16).

Tests first:
- `cadence-model.test.ts`: `Monday and Thursday are two weekly schedules on days 1 and 4`, `days are sorted and distinct`, `a paused schedule is not counted`, `all schedules paused is paused`, `no schedule is none, never twice a week`, `a daily schedule is daily`, `a monthly or cron schedule is custom`, `a weekly schedule without a weekday is custom`.
- `cadence-query.test.tsx`: `asks the AI workload only`, `a failed read is failed and draws nothing`, `shares one request with a second reader` (two probes, one request).
- `header-meta.test.ts`: `the counts need the topic trees: topics null leaves the topics out`, `one topic and one prompt use the singular`.
- `header-meta.test.tsx`: `inline shows Updated and the counts after a middle dot`, `menu shows four lines`, `no counts while the list loads`, `says Asked twice a week, Monday and Thursday for the Monday and Thursday schedules`, `never says weekly for two a week` (asserts the text does not match /weekly/), `says Scheduled runs are paused`, `draws no cadence for a failed read and no error`, `numbers are formatted by the format module (1,250 prompts)`, `axe has no violations in both variants`.

Guards:

| Guard | Test |
|---|---|
| unknown topics are left out, never 0 | `header-meta.test.ts > the counts need the topic trees: ...` |
| the cadence is derived, never invented | `cadence-model.test.ts > no schedule is none, never twice a week` and `... > a paused schedule is not counted` |
| never "weekly" for two runs a week | `header-meta.test.tsx > never says weekly for two a week` |
| no flash of empty counts | `header-meta.test.tsx > no counts while the list loads` |
| a failed secondary read is silent | `header-meta.test.tsx > draws no cadence for a failed read and no error` |

Checks: C1, C2, C3, C4. Rows: TPH-03, TPH-17 (parts; wired in T13). Commit `WP-17: header meta counts and cadence line`.

---

### T7 (A, with T8): single engine strip

Files: modify `prompts-strip.tsx` (owned); modify `prompts-strip.test.tsx`; `messages/en.json` (`facets.strip`: `labelOne` "Summary of the prompts in view on {engine}", `validAnswers` "Valid answers",
`mentioned` "Mentioned", `cited` "Cited", `shareOfVoice` "Share of voice", `shareShort` "SOV", `tipValid` "{answers, plural, one {# valid answer} other {# valid answers}} over {prompts, plural, one {# prompt} other {# prompts}}, each counted once", `tipEngine` "{engine}: {detail}").
No screen change: the strip derives the variant from `engines.length`.

Behaviour: with `engines.length === 1` and counts read, the items are Prompts, Mentioned, Cited, Share of voice and Valid answers. Each rate chip shows
`useRateWords().text` (percent, or the answers when under 4, or n/a), its `unknown` state, and a tooltip with the counts (`words.basis`, "k of n answers"; share of voice "n answers that name a brand") and the
engine's name. Valid answers is a count (`formatInteger(mentioned.answers)`), the tooltip says over how many prompts; no valid answer is 0 valid answers, a real count, and the Mentioned
chip beside it says n/a with its reason. The change (`stripChangeOf`) stays on Mentioned only and only while compare is on and the status is not loading. The strip label names the engine. The Share of voice chip label is "SOV" under 1,280 px
(`useMediaQuery(MEDIA.xl)`) and "Share of voice" from it. With two or more engines the strip is unchanged (existing tests stay green). While loading the labels stay (`MetricStrip status`), counts failed gives the Prompts chip alone.

Tests first (`prompts-strip.test.tsx`, new cases):
- `with one engine the chips are Prompts, Mentioned, Cited, Share of voice and Valid answers`
- `each rate chip's tooltip holds its counts and the engine's name`
- `under 4 valid answers a rate chip shows the answers, hatched, and no percent`
- `an engine with no answer shows n/a with the reason on the rates and 0 on Valid answers`
- `Valid answers counts the pooled valid answers of the prompts in view`
- `the change is on Mentioned only, neutral unless detectable`
- `share of voice is SOV under 1280 px and Share of voice from it`
- `two engines keep one chip per engine`
- `loading keeps the labels of the five chips`
- `counts that failed leave the Prompts chip alone`
- `axe has no violations` and `the tooltip of a chip is reachable by Tab`

Guards:

| Guard | Test |
|---|---|
| every percent has its count, no percent under 4 answers | `prompts-strip.test.tsx > each rate chip's tooltip holds its counts ...` and `... > under 4 valid answers ...` |
| no valid answer is n/a on a rate, never 0% | `... > an engine with no answer shows n/a ...` |
| engines are not pooled: one engine only in this variant | `... > two engines keep one chip per engine` |
| colour only for a detectable change | `... > the change is on Mentioned only, neutral unless detectable` |
| labels stay while loading | `... > loading keeps the labels of the five chips` |

Checks: C1 on `prompts-strip.test.tsx` and `prompts.test.tsx` (the strip describe at 1834), C2, C3, C4; look at 390, 768, 1024, 1280, light and dark (chips scroll on a phone). Rows: TPS-06, and TPS-10 (the "SOV" label that V18 found missing). Commit `WP-17: single engine strip`.

---

### T8 (A, with T7): Copy link to a prompt, shortcut hints and right click proven

Files (new): `actions/copy-link-action.ts`, `actions/copy-link-action.test.ts`, `menus/action-shortcuts.ts`, `menus/action-shortcuts.test.ts`, `menus/menus.test.tsx`. Modify (L3): `prompt-action.ts` (field `shortcut`, carried by `asRecordActions`), `components/app/data-table/types.ts` (`RecordAction.shortcut?: readonly string[] | undefined`), `components/app/data-table/row-menu.tsx` (`rowMenuItems` passes `shortcut`), their tests (`components/app/data-table/row-menu.test.tsx`: one case), `seams/actions.ts` (uncomment the two WP-17 lines: the import and `copyLinkAction`), `seams/actions.ts` `asMenuItems` carries `shortcut` too, `messages/en.json` (`facets.menus`: `copyLink` "Copy link", `linkCopied` is the existing `prompts.linkCopied`; reuse it, add nothing for it).

Exports:

```ts
// copy-link-action.ts
export function promptLinkOf(href: string, promptId: string): string;   // sets inspect=prompt:<id> (formatInspectTarget), deletes itab and eng, keeps every other key
export const copyLinkAction: PromptActionEntry;   // id 'copy-link-prompt', surfaces ['promptRow','inspectorMore'], permission null, group 'copy'; build() null unless exactly one prompt id
// action-shortcuts.ts
export const ACTION_SHORTCUTS: Readonly<Record<string, readonly string[]>> = { open: ['Enter'] };
export const shortcutOf = (id: string): readonly string[] | undefined;
```

`copyLinkAction.run` reads `window.location.href` when it runs (not at render), copies `promptLinkOf(...)` with `copyText`, toasts `prompts.linkCopied` or `common.copy.failed`. `asRecordActions` and `asMenuItems` apply `shortcutOf(action.id)` when the action has no `shortcut` of its own. The id `copy-link-prompt` differs from the header's built in `copy-link` (no `assertUniqueIds` clash).

Tests first:
- `copy-link-action.test.ts`: `sets inspect to the prompt and keeps the filters, the window and the tab`, `drops itab and eng, which belong to another record`, `replaces the inspect of another prompt`, `a topic target is replaced by the prompt`, `encodes the prompt id the way formatInspectTarget does`, `builds nothing for a topic row or for more than one prompt`, `is on the prompt row and the inspector More surfaces and nowhere else`.
- `action-shortcuts.test.ts`: `only Open has a hint`, `a hint is a key that works: Enter` (the test names the DataTable Enter open and links to the proof in `menus.test.tsx`).
- `menus.test.tsx` (renders the unedited screen, Fynix): `a prompt row menu has Copy link after Copy prompt for every role`, `Copy link copies the address with inspect=prompt:<id> and says Link copied`, `the inspector More menu has Copy link`, `Open shows the Enter hint on a prompt row and on a topic row`, `no other item shows a hint`, `right click on a prompt row opens the same menu as the More button`, `right click on a topic row opens the topic menu`, `Shift plus right click leaves the browser menu`, `a long press opens the menu on touch`, `Shift+F10 opens the menu from the keyboard`, `Enter on the focused row opens it`, `focus returns to the row after Escape closes the menu`.
- `components/app/data-table/row-menu.test.tsx`: `an action with a shortcut hands it to the menu item`.

Guards:

| Guard | Test |
|---|---|
| the link names the prompt and nothing from another record | `copy-link-action.test.ts > drops itab and eng, which belong to another record` |
| other filters, window and tab stay in the link | `copy-link-action.test.ts > sets inspect to the prompt and keeps ...` |
| the address is read when the action runs | `menus.test.tsx > Copy link copies the address with inspect=prompt:<id> ...` (the test changes the URL between render and click) |
| a hint exists only for a key that works | `action-shortcuts.test.ts > only Open has a hint`, `menus.test.tsx > no other item shows a hint` |
| right click, long press and the key open the one menu | the three `menus.test.tsx` right click cases |

Checks: C1 on all of the above plus `seams/actions.test.ts`, `seams/wiring.test.tsx`, `components/app/data-table/row-menu.test.tsx`, `row-menu.test.tsx` (prompts), `topic-menu-list.test.tsx`, `bulk-actions.test.tsx`; C2, C3, C4. Rows: MNU-08, MNU-14 (proof), MNU-15. Commit `WP-17: copy link to a prompt, menu shortcut hints and right click proof`.

---

### T9 (A, with T10): page shortcuts in the Help dialog, single keys and keyboard proofs

Files (new): `shortcuts/prompts-shortcuts.ts`, `shortcuts/prompts-shortcuts.test.ts`, `shortcuts/use-prompts-shortcuts.ts`, `shortcuts/shortcuts.test.tsx`, `shortcuts/keys.test.tsx`. Modify `messages/en.json` (`facets.shortcuts`: `search` "Search the table", `next` "Next record", `previous` "Previous record", `open` "Open the focused row", `close` "Close the open record").

Exports:

```ts
export function promptsShortcutEntries(words: Record<'search' | 'next' | 'previous' | 'open' | 'close', string>): readonly ShortcutEntry[];   // ids 'prompts-search','prompts-next','prompts-previous','prompts-open','prompts-close'; keys ['/'], ['j'], ['k'], ['Enter'], ['Escape']
export function usePromptsShortcuts(): void;   // useMemo(entries) then usePageShortcuts(entries); registers nothing but the list: the keys themselves stay in DataTable and the inspector (useShortcut)
```

Tests first:
- `prompts-shortcuts.test.ts`: `lists the five keys with unique ids`, `no label holds a dash`.
- `shortcuts.test.tsx` (the pattern of `ai-overview/header/overview-shortcuts.test.tsx`: `PageShortcutsProvider`, a `Listing` probe, `SingleKeysContext`): `the page lists / J K Enter Escape while it is mounted`, `the list is gone when the page unmounts`, `the Help dialog lists them next to the shell's [ and ?` (renders `TopBarControls` with the provider and the hook, opens Help, reads the dialog), `the entry list keeps its identity between renders` (a re-render does not re-register).
- `keys.test.tsx` (renders the unedited screen): `/ focuses the table search on both tabs` (WB-KEY-01), `with single-key shortcuts off, / does nothing and j does not step an open prompt` (WB-KEY-10, `SingleKeysContext` false), `j and k step the open prompt, Escape closes it and focus returns to its row` (KEY-02, KEY-04), `Enter opens the focused row` (KEY-03), `Right opens and Left closes a topic on the treegrid` (KEY-05), `Shift click selects the range between two prompt rows and Escape clears the selection` (BLK-13), `typing in the search box does not fire a shortcut`.

If `keys.test.tsx > Shift click ... Escape clears` fails, stop and report to the coordinator: the fix is in the shared `DataTable` (a lease), not here.

Guards: `unmount removes the list` (`shortcuts.test.tsx > the list is gone when ...`); `single keys honour the preference` (`keys.test.tsx > with single-key shortcuts off ...`); `no key is listed that does nothing` (`keys.test.tsx` cases 1 to 4 are the proof of each listed key).

Checks: C1, C2, C3, C4. Rows: NAV-11, KEY-11 (the registration; wired in T13), KEY-01 to 05 and 10, BLK-13 (proofs). Commit `WP-17: page shortcuts list and keyboard proofs`.

---

### T10 (A, with T9): the project switch keeps the page query

Files: modify `lib/navigation/registry.ts` and `lib/navigation/registry.test.ts` (L2).

Change: `NavDestination` gains `projectBoundKeys?: readonly string[]`; the `prompts` entry gets `carriesQuery: true` and `projectBoundKeys: ['topic']`; `switchHref` deletes `PROJECT_BOUND_KEYS` and then the destination's own. No other destination changes.

Tests first (`registry.test.ts`):
- `lets Prompts, Runs and Costs carry the query of the page to another project, and no other destination` (replaces the line 110 case: `['prompts', 'runs', 'costs']`)
- `Prompts keeps the window, the country, the tab, the sort, the columns, the density, the search and the facets for the other project`
- `Prompts leaves out the open inspector and the topic filter, which belong to one project`
- `Prompts carries the branded choice and the preset filters`
- `the keys Runs and Costs drop are unchanged`

Guards: `topic ids never follow the person to another project` (`... > Prompts leaves out the open inspector and the topic filter ...`); `no other destination carries a query` (the first case).

Also read and say in the commit message whether `features/shell/project-shell.test.tsx` exists and covers a Prompts switch; if it does, add one case (the page's `window.location.search` is read at the choice).

Checks: C1 on `registry.test.ts` and the shell tests, C3, C4. Rows: NAV-12. Commit `WP-17: project switch keeps the Prompts query`.

---

### T11 (A): filter sheet part for the phone

Files (new): `facets/filters-sheet.tsx`, `facets/filters-sheet.test.tsx`. Modify `messages/en.json` (`facets.sheet`: `filters` "Filters", `filtersActive` "Filters, {count} applied", `close` "Close filters", `done` "Done", `window` "Window", `country` "Country", `topicsNote` is not here).

Exports: `FiltersSheet({ count, children })` and `SheetRow({ label, children })`, a local copy of `features/ai-overview/scope/filters-sheet.tsx` with a `shortcut:` comment (a feature may not import another; promote to `components/app/filters` as follow-up F2), using `components/ui/sheet`, `Button`, `Badge`, `IconButton`, `formatInteger`; the strings come from `prompts.facets.sheet`.

Tests first: `shows one Filters button with the count of applied filters and none for zero`, `the button's name says how many are applied`, `opens a labelled dialog with the children and a Done button`, `a change inside takes effect at once (the children are live) and Done only closes`, `Escape and the close button close it and return focus to the button`, `the sheet is a dialog: focus stays inside while open`, `rows are named by their label`, `axe has no violations closed and open`, `the count uses the format module (1,000 is not asked of a count this small, a count of 12 reads 12)`.

Guards: `the count is of filters that differ from the default` (the component takes the count; the test that the screen computes it is T14's `the Filters button counts only filters that differ`); `focus returns to the button` (`... > Escape and the close button ...`).

Checks: C1, C2, C3, C4; looked at 390 px, both themes, with the keyboard. Rows: TPF-18 (part). Commit `WP-17: filters sheet part`.

---

#### Milestone M1: push the A tasks (section 5.1). Then wait for the coordinator.

---

### T12 (B): wire the filters, Branded three way and facets into the screen

Depends on T1, T2, T3, T11 only for words; edits `prompts-screen.tsx` (B hunks 1 to 7 below), `selection-model.ts` and `selection-model.test.ts` (L5). Pre-flight 5.3 first.

Hunks (each re-found by name after the rebase):
1. `fields` memo: replace the Branded field by `brandedField(words)`; append `facetFields(list.rows, facetWords, optionsPending)` after it and before `detectableField`; the Detectable field stays last. `facetWords` and the Branded words come from `useTranslations('prompts.facets')`, `languageName` for language options.
2. `useUrlFilters(fields, { onDropped })` unchanged; its result is `urlValues`. `const brandedChoice = parseBrandedChoice(urlValues.branded ? enumValuesOf(...)[0] : null)`; the bar gets `values={barValues(urlValues)}` and `onChange={(next) => setValues(fromBar(next))}`, `hideClear`; `filtered` stays computed from `urlValues` (a default chip is not a filter set); "Reset filters" (a `Button variant="link"`, `prompts.clearFilters` reused) shows beside the bar only while `filtered`, and calls the existing `clearFilters`.
3. `includeBranded` becomes `brandedParams(brandedChoice).includeBranded`; `summaryQuery(..., { ..., brandedOnly: true })` when `brandedOnly` (the existing `SummaryScope.brandedOnly`); the query key therefore differs per choice.
4. The `rows` filter: `(includeBranded || !prompt.is_branded)` becomes `keepsBranded(brandedChoice, prompt)`, and `&& (tab !== 'prompts' || matchesFacets(prompt, selection))` is added, `selection = facetSelectionOf(urlValues)` (D2). `narrowed` also counts `facetsActive(selection) > 0 && tab === 'prompts'`, so an empty table under a facet is filtered-empty with "Reset filters", never "no prompts yet".
5. `selectionKeyOf({ ..., includeBranded, narrowing })`: `narrowing = [brandedChoice, JSON.stringify(selection)].join('|')` (L5), so changing Branded between Included and Only or changing a facet drops the selection.
6. Topics tab: above `TopicsView`, `topicsFacetNotice({ tab, selection })` draws `<Banner tone="info" placement="region" message={...} actions={<Button size="sm" variant="secondary">Show in Prompts</Button>} />` whose action sets `tab=prompts` (the same `setView({ tab: 'prompts' }, { history: 'push' })` the topic menu uses, filters kept). The strip on the Topics tab is fed the rows without the facet predicate (rows for the strip = `tab === 'topics'` ? rows ignoring facets : rows); implement as two memoised lists, `rows` (what the active tab lists) and `scopeRows` (without facets) with the strip, `stripTopics`, `selection` ids and the export reading `rows` on Prompts and `scopeRows` on Topics.
7. `emptyFields` and `emptyValues` (the read only chips of the filtered empty state) use the new `fields` and `urlValues`, so a facet and a Branded choice are named there.

Tests first (a new file `facets/filters-wiring.test.tsx` and edits of existing cases that asserted the old Branded chip; the existing cases named below are updated, not deleted):
- `Intent filters the Prompts tab to the chosen intents and the URL holds intent=commercial` (Eventus)
- `Funnel stage, Importance, Type and Language each filter the Prompts tab and restore from a link` (five links, Eventus; Language on Fynix with `?lang=hi` shows the Hindi prompt only)
- `facets combine: any of the values of one, all of the facets`
- `the strip follows the facets on the Prompts tab: Prompts and the rates are those of the prompts left`
- `a facet value the project has nothing for in the link is kept as an option and filters to the empty state with Reset filters`
- `a nonsense facet value in the link is dropped, the URL is rewritten and the person is told once` (WB-TPF-17 for the new fields: `?intent=nonsense`)
- `language options wait for the list: ?lang=hi is kept while the pages load` (`optionsLoading`)
- `Branded is Excluded with a default chip, nothing in the URL`; `choosing Only writes branded=only, asks the summary with branded_only=true and lists the branded prompts alone`; `choosing Included writes branded=include and removes the chip`; `removing the Excluded chip means Included`; `a link with branded=included reads as Included`; `Reset filters brings back Excluded and clears the facets, and leaves the window, the country and the comparison`
- `Reset filters is not shown while only the default chip is there`
- `the Topics tab shows the facet notice, keeps its rates, and Show in Prompts switches the tab with the facets kept`
- `the strip on the Topics tab ignores the facets` (D2)
- `changing a facet drops the selection; changing Excluded to Only drops it; a sort does not` (`selection.test.tsx` style)
- `an empty list under a facet is filtered-empty, not no prompts yet`
- `the filter bar and its chips pass axe with every facet chosen`
- update `prompts.test.tsx` cases at 671 ("leaves branded prompts out until the Branded filter includes them"), 866 ("says there are no prompts yet ... when only the Engine or Branded filter is set") and `compare/compare-wiring.test.tsx` where it reads the Branded chip, to the D4 behaviour; each update is listed in the commit body.
- `selection-model.test.ts`: `a changed narrowing is a changed key` (L5).

Guards:

| Guard | Test |
|---|---|
| facets narrow the Prompts tab and the strip, never the Topics tab silently | `filters-wiring.test.tsx > the Topics tab shows the facet notice, keeps its rates ...` and `... > the strip on the Topics tab ignores the facets` |
| Only is branded alone and asks the summary so | `... > choosing Only writes branded=only, asks the summary with branded_only=true ...` |
| removing the default chip is Included | `... > removing the Excluded chip means Included` |
| a default is not a filter set | `... > Reset filters is not shown while only the default chip is there` |
| a link restores every facet | `... > Funnel stage, Importance, Type and Language each filter ... and restore from a link` |
| a bad link value is dropped and said once | `... > a nonsense facet value in the link is dropped ...` |
| the selection is dropped when the rows asked for change | `... > changing a facet drops the selection ...` and `selection-model.test.ts > a changed narrowing is a changed key` |
| the empty state says filtered, with the action | `... > an empty list under a facet is filtered-empty, not no prompts yet` |

Checks: C1 on the new file and the edited cases, C4b (the prompts folder, medium lane), C2, C3, C4; browser: Eventus at 390, 768, 1024, 1280, both themes, Default and Compact, keyboard walk of the bar (chip, editor, remove, "+ Filter", Reset). Rows: TPF-05, TPF-08, TPF-10, TPF-11, TPF-12, TPF-13, TPF-02/03/04/16/17 (touched, re-proven). Commit `WP-17: wire Branded three way and facets`.

---

### T13 (B): wire the header: view menu, meta, export, cadence, shortcuts, copy link

Edits `prompts-screen.tsx` only (B hunks 1 to 5); everything else already exists.
1. Toolbar right group (the `ml-auto flex h-control ...` div, base line 910): `<PromptViewMenu />` before `CompareSelect`; the inline Updated span gets `HeaderMeta variant="inline"` (replacing the bare `UpdatedRunLink` text: `updated` is the existing `UpdatedRunLink` node, counts and cadence from the new parts) and keeps its tooltip.
2. More menu (`moreMenu`, base 782 to 794): `header` becomes `<HeaderMeta variant="menu" ... />`; `items` become `[copy-link, ...openRun, ...exportItems, ...extras.more]`, `exportItems = useScopeExport({ rows: scopeRows or rows by D5 (the prompts in scope of the active tab: the Prompts tab's `rows`; the Topics tab's `scopeRows`), engines: shown, range, waiting: listReason }).items`.
3. `usePromptsShortcuts()` once at the top of `PromptsContent`.
4. `useAiCadence(scope)` once; counts: `topics = stripTopics`, `prompts = rows.length` (the strip's number), `ready = !waiting`.
5. Copy link to a prompt needs no screen edit (the seam), only the proof.

Tests first (new file `header/header-wiring.test.tsx`):
- `the header says Updated, the counts and the cadence, and the More menu holds them with the window`
- `the counts follow the filters: 250 prompts becomes the prompts left` and `topics are left out until the trees are read`
- `View: Default is in the header; Branded prompts writes branded=only and the table lists the branded prompts`
- `More actions has Copy link, Open latest run, Export CSV and Export XLSX in that order, then the seam's items` (the fake seam of `wiring.test.tsx` still appears)
- `Export CSV from More downloads all prompts in scope with the window in the name; with a facet it holds only those; a selection does not narrow it`
- `Export XLSX downloads a .xlsx`
- `Export is disabled with its reason while the list loads and when nothing is in scope`
- `the Help dialog lists / J K Enter Escape and [ and ?` (through the real `TopBarControls`)
- `a viewer sees every export item (reading is enough)`; `a role without data:read sees the no access state and no header` (WB-STATE-10 stays)
- `Copy link of a prompt row from the table menu`

Guards: `export is in scope, not the selection` (`... > Export CSV from More ...`); `the counts follow the filters`; `no flash of counts before the data`; `the seam's items still appear` (the `wiring.test.tsx` cases stay green: run them).

Checks: C1, C4b, C2, C3, C4; browser at four widths. Rows: TPH-03, TPH-04, TPH-08, TPH-09, TPH-17, NAV-11, KEY-11, MNU-08 (end to end). Commit `WP-17: wire the header meta, views, export and shortcuts`.

---

### T14 (B): wire the filter sheet under 768 px

Edits `prompts-screen.tsx` only (B hunks 1 to 3).
1. `const onPage = useMediaQuery('(width >= 48rem)')`. At or above 768 px nothing changes. Below it: the `TopBarPortal` is not rendered (the window and the country are not in the top bar), and the toolbar's filter bar, compare select, view menu and Reset filters are children of `<FiltersSheet count={changed}>` after two `SheetRow`s (`window`: the `DateRangePicker` with the same props, `country`: `PromptsCountryControl`), where `changed = filters differing from default` = `Object.keys(urlValues).length + (country === null ? 0 : 1) + (compare ? 0 : 1)` (compare off is a change, as the Overview counts it).
2. The strip stays on the page (a row of chips that scroll), the table, the tab switch and Add prompts (icon only) stay outside the sheet.
3. Focus returns to the Filters button on close; a filter chosen inside takes effect at once.

Tests first (`facets/filters-sheet-wiring.test.tsx`, with `matchMedia` stubbed to 390 px, a helper in the kit):
- `below 768 px the page has one Filters button and no filter bar, window or country in the top bar slot`
- `the button counts only filters that differ from the default (a default Branded chip is not one)`
- `the sheet holds the window, the country and the filter bar; choosing a country there narrows the table at once`
- `a filter chip removed in the sheet leaves the URL as the bar would`
- `from 768 px the bar and the top bar controls are on the page and there is no Filters button`
- `crossing 768 px keeps the URL and the open state sensible (the sheet closes when the width grows)`
- `axe at 390 px closed and open, light and dark`
- `Add prompts is icon only below 640 px and keeps its name` (WB-TPH-13 re-proof)

Guards: `the count excludes defaults` (`... > the button counts only filters that differ ...`); `the top bar slot is not used on a phone` (`... > below 768 px the page has one Filters button ...`); `nothing is lost between widths` (`... > crossing 768 px ...`).

Checks: C1, C4b, C2, C3, C4; browser: 390 and 768 px both themes, keyboard (Tab into the sheet, Escape, Done), zoom 200% on a 1280 window gives the phone layout. Rows: TPF-18. Commit `WP-17: filter sheet below 768 px`.

---

### T15 (tests): states and honesty of the new surfaces, and the BUILT rows' missing tests

Needs T12 to T14. Files (new, tests only): `header/states.test.tsx`, `facets/states.test.tsx`. No production edit; a defect found is fixed in a task commit `WP-17: fix <file>` and reported.

Cases (each in the four states where it applies):
- loading: `the header meta draws nothing before the list and summary have answered`, `the view menu is there at once and the facet fields wait for the list (optionsLoading) without dropping a link's values`, `Export is disabled with a reason while loading`, `the strip keeps its labels` (WB-STATE-14)
- empty: `no engine on, no prompts, no answers yet, filtered empty each say their reason and offer their action with the header present or absent as before` (WB-STATE-01 to 04, header parts only), `the filter sheet's Filters button is absent while the page shows an empty state`
- error: `a failed list shows the page's InlineError with the error id and Retry, and Export is disabled`, `a failed summary leaves the Prompts chip alone and the banner`, `a failed schedule read draws no cadence and no error` (WB-STATE-05)
- partial and stale: `a page of the list that failed says the list may be incomplete and Export names it` (the toast of an export from an incomplete list says "{n} prompts" and the banner stays; WB-STATE-06), `a refetch of the window keeps the table, the counts and the strip with no dimming` (WB-STATE-14)
- insufficient: `the single engine strip shows the answers hatched under 4` (WB-STATE-07)
- permission: `a viewer has the header, views and export; no Add prompts; a member without data:read sees only the no access state` (WB-STATE-10)

Guards: each case above is its own guard; the reviewer breaks `optionsLoading`, the export disabled reason and the "no counts before data" rule.

Checks: C1, C4b, C4. Rows: STATE-01 to 07, 10, 14 (confirmed with named tests, section 10). Commit `WP-17: states of the new surfaces`.

---

### T16 (e2e): the three missing flows, the new surfaces and 768 px

Files: modify `e2e/flows/ai-prompts.spec.ts` (sole owner); new `e2e/support/ai-prompts-header.ts` (locators and helpers: `openPrompts(page, search)`, `moreMenu(page)`, `downloadOf(page, trigger)` returning `{ name, bytes, text }`, `requestsTo(page, pattern)` collecting `POST` requests, `viewport(width)`); `e2e/support.ts` is not touched.

New tests in the existing `test.describe('AI prompt tracking')`:
- **WB-E2E-06** `Topics: a parent opens onto its topics, the note says a parent does not add up, Show in Prompts keeps the topic as the filter and the window` (expand a parent with the button and with ArrowRight, read the rollup note under the table, choose Show in Prompts from the row menu, assert `?tab=prompts&topic=<id>` and the table narrowed).
- **WB-E2E-07** `Bulk Run now and bulk Archive use the bulk routes`: select two prompts, Run now, confirm, assert exactly one `POST .../ai/runs` carrying both prompt ids (collected with `page.waitForRequest`), the toast says what started; select two prompts, Archive, assert exactly one `POST .../prompts/bulk-archive`, then Undo and assert the prompts are back (`bulk-archive` with `archive=false` or the restore route the existing e2e uses at line 183).
- **WB-E2E-08** `Export CSV downloads a file`: from More actions, Export CSV, `waitForEvent('download')`, assert the name `prompts-<from>-to-<to>.csv`, the file starts with the BOM, has the header and one line per prompt in scope (24 on Fynix, the branded one left out), and no cell starts with `=`; with `?branded=only` the file holds one prompt; Export XLSX: the name ends `.xlsx`, the bytes start `PK` and contain `xl/worksheets/sheet1.xml`.
- `the Branded chip: Excluded by default, Only from the editor, restored from the link, removing the chip is Included` (Fynix: one branded prompt).
- `facets restore from a link`: `?lang=hi` shows the Hindi prompt only, with the Language chip; `?intent=unknown` shows all 24 (Fynix has no variety, V14); `?intent=nonsense` is dropped with the "left out" toast; `?branded=only&tab=prompts` shows the Fynix prompt.
- `View: Branded prompts from the menu writes branded=only and a reload keeps it`.
- `the shortcuts dialog from Help lists the page's keys` (`?` and the Help button).
- `Copy link of a prompt row: the clipboard holds an address with inspect=prompt:<id>` (grant clipboard permissions in the test context; else assert the toast).
- `the project switch carries the filters but not the open prompt or the topic` (switch from Fynix with `?tab=prompts&branded=only&inspect=...&topic=...` to Cleanstart through the project switcher and read the URL).
- `a phone has one Filters button` at 390 px and the sheet's window and country.
- extend `WIDTHS` to `[1440, 1280, 1024, 768, 390]` in the matrix of line 17 and keep the two themes; the matrix visits `?tab=prompts&facets` states too (one facet chosen, the sheet open at 390, the More menu open) and runs `expectAccessible` and the sideways scroll check on each.

Guards: the specs are the guards of the flows (a reviewer deletes the Archive request assertion's route, or the BOM check, and the named test must fail).

Checks: `infra/dev/heavy --label wp17-e2e-t16 --wait 120 --max 60 -- bash -c 'cd apps/web && E2E_PORT=3217 pnpm exec playwright test --project=e2e e2e/flows/ai-prompts.spec.ts'`, then C3, C4. Rows: E2E-06, E2E-07, E2E-08 (and E2E-11 for the four widths on this page, which the inventory lists as not verified). Commit `WP-17: e2e flows for the header, filters and export`.

---

### T17: As built notes, rebase, whole app checks, whole diff review, push

1. Append `As built (header, filters, facets, menus and shell items, 2026-11-xx, WP-17)` to `docs/design-system/24-page-templates.md` after the existing 9.5 As built notes: the Branded three way and its URL words, the five facet keys, the Topics notice (D2) and the open question, the presets and why `view` is not used, the strip variant, Export CSV and XLSX in More, the cadence line, the Copy link action, the shortcut hints, the shortcuts list, the project switch rule, the filter sheet, what was measured in a browser and what was not. Append the package's section to `docs/20-frontend-specification.md` under 4.6 (the spec section the brief names; L9). Add the new parts to `docs/design-system/25-component-inventory.md` (L9). Append the As built section to this plan.
2. `git fetch origin && git rebase origin/develop`; resolve `en.json` by keeping both sides then C2; if WP-27 changed the screen, rerun C4b.
3. Whole app checks (C4 on the whole app, then C5 in order: the capped full suite, the build, the e2e files named in C5). Fix before reporting.
4. A second fresh Sonnet reviewer reads the whole package diff against the brief's acceptance criteria and the row table (section 9), breaks every guard of section 7 once more in a sample of one per task, opens `/digibranders/eventus-security/ai/prompts`, `fynix` and `cleanstart` at 390, 768, 1024 and 1280 px in both themes and both densities, and walks the keyboard path of each new action.
5. Push (`git push origin HEAD:develop`), `infra/dev/wp-status WP-17 merged "..."`, and the report line of the brief.

Rows: process. Commit `WP-17: as built notes`.

---

### T18 (optional, only on the coordinator's go; section 6): Customize numbers for the Prompts strip

Not part of the plan unless released. Needs leases L6 to L8. If released it is built as: (1) `lib/layouts/catalog.ts`: number types `ai.prompts_in_scope`, `ai.mention_rate`, `ai.citation_rate`, `ai.share_of_voice`, `ai.valid_answers` list `prompts` in `screens`; `SCREENS.prompts.builtin.numbers` is the Default (Prompts, one mention rate per engine), then `pnpm gen:layout-catalog` and the regenerated `backend/src/idraft/api/layouts/catalog.json` committed with it (L6, L7); (2) `prompts-strip.tsx` is kept as the view and gets a sibling `prompts-numbers.tsx` that maps `NumberItem` to `NumberValue` from the same `engineRates` (engine out of scope: the number says "Not in this view", never a pooled value, and the Engine filter never silently drops a number); (3) `prompts-screen.tsx`: `CustomizableScreen` around the body, `CustomizingBadge` in `actions`, `useCustomizeMenuItem('customizeNumbers', moreRef)` in the More menu, the strip rendered by `NumberStrip` at md size only from 768 px with the inline chips staying as the phone strip (L8); (4) tests: the page proof of `numbers-only-screen.test.tsx` for this screen, a leave guard test (a dirty layout with filters in the URL), e2e in `ai-layouts.spec.ts` style. Estimated 3 tasks and a decision on the look (md strip versus inline chips) from the owner first.

## 8. Lease requests (for the coordinator)

Files the brief does not list as owned. Paths are exact; each is the smallest edit; every lease is released at the package's last push.

| # | File (owner) | Smallest edit | Why | Task | Fallback without it |
|---|---|---|---|---|---|
| L1 | `apps/web/src/features/prompts/seams/columns.ts` and `seams/columns.test.ts` (WP-02 seam) | One import line and one entry line `facetColumns` under a new `// WP-17 tp-header-filters` comment; one test case | The Funnel stage column (WB-TPF-11) without editing `prompt-columns.tsx` | T3 | Edit `prompt-columns.tsx` after WP-19 merges (a B edit) |
| L2 | `apps/web/src/lib/navigation/registry.ts` and `registry.test.ts` (WP-02) | `NavDestination.projectBoundKeys?`; the `prompts` entry gets `carriesQuery: true` and `projectBoundKeys: ['topic']`; `switchHref` drops them; the test of line 110 and four cases | WB-NAV-12; the brief allows only flipping a page to live | T10 | None: the row cannot close. (Alternative: the same logic in `features/shell/project-shell.tsx`, which is also not ours) |
| L3 | `apps/web/src/components/app/data-table/types.ts`, `components/app/data-table/row-menu.tsx`, `components/app/data-table/row-menu.test.tsx` (WP-09) and `features/prompts/prompt-action.ts` (WP-02) | `RecordAction.shortcut?`; `rowMenuItems` passes it; `PromptAction.shortcut?` and `asRecordActions` carry it | WB-MNU-15: a hint on a menu item needs the field to reach `Menu` (V9) | T8 | Close the row as "Open shows Enter only where the menu is the page's own": not possible, the table builds the menu |
| L4 | `apps/web/src/features/prompts/seams/toolbar.ts` and `seams/toolbar.test.ts` (WP-02) | Add `'export-csv'` and `'export-xlsx'` to `BUILT_IN_TOOLBAR_IDS` | A later package must not take the ids of the header's own Export items (`assertUniqueIds`) | T5 | The ids stay unguarded; a clash would throw in a later package's test |
| L5 | `apps/web/src/features/prompts/selection-model.ts` and `selection-model.test.ts` (W5, no current owner) | `selectionKeyOf` takes an optional `narrowing: string` part of the key | The selection must drop when Branded changes between Included and Only or a facet changes (WB-BLK-01) | T12 | The selection is only pruned to rows still shown and returns when a filter is removed |
| L6 | `apps/web/src/lib/layouts/catalog.ts` (WP-33) and `backend/src/idraft/api/layouts/catalog.json` (generated) | Only if T18 is released | Number types for the `prompts` screen | T18 | not built |
| L7 | `apps/web/src/lib/layouts/` generators (`pnpm gen:layout-catalog`) | Only if T18 is released | as L6 | T18 | |
| L8 | `apps/web/src/features/prompts/prompts-screen.tsx` large hunk for `CustomizableScreen` | Only if T18 is released | as L6 | T18 | |
| L9 | `docs/20-frontend-specification.md`, `docs/design-system/24-page-templates.md`, `docs/design-system/25-component-inventory.md` | Append only (T17) | The brief asks for As built notes in the relevant spec | T17 | Notes only in this plan |

Also used, but already within the rules and listed so nothing is a surprise: `seams/actions.ts` (the two WP-17 lines the file reserves for this package, T8), `apps/web/messages/en.json` (`prompts.facets` only, V15), new e2e helper `e2e/support/ai-prompts-header.ts` (a new file, not `e2e/support.ts`), `apps/web/e2e/flows/ai-prompts.spec.ts` (owned).

Not touched: `prompt-columns.tsx`, `rate-columns.tsx` (WP-19), `add-prompts-dialog.tsx` (WP-27), `topics-table.tsx`, `use-prompt-actions.tsx` (labels repeated, V7), `mocks/*` (no fixture edit, V14), `mocks/handlers/index.ts`, `lib/api/schema.ts`, `backend/*`, `package.json` (no dependency, V6), `e2e/support.ts`, `lib/navigation/registry.ts` beyond L2, tracker files, the main checkout.

Told to the coordinator, not leased: (a) the `view` key collision for WP-49's stored views (D3); (b) once T2 lands, the Overview's `drilldown/drill-links.ts` `BRANDED_INCLUDE` can add `only: 'only'` so a branded Only scope is expressible from the Overview (WP-33's file); (c) `fromBar` and `barValues` mirror WP-33's `branded-field.ts` behaviour and the two should move to one place with the sheet (F2).

## 9. Rows to tasks: the 22 to do rows

| Row | Status | What exists (file and line) | What is missing | Task |
|---|---|---|---|---|
| WB-TPH-03 | PARTIAL | counts only in the strip Prompts chip tooltip (`prompts-strip.tsx` 57 to 60, `topicsSpanned`) and the table footer | header line "13 topics, 250 prompts" | T6, T13 |
| WB-TPH-04 | NOT BUILT | shared `SavedViewMenu` and `matchView` (`components/app/views`, WP-10), Citations uses them (`citations-screen.tsx` 257); no `features/prompts/views-model.ts` | presets Default and Branded prompts, derived (V5, D3) | T4, T13 |
| WB-TPH-08 | PARTIAL | `buildPromptExport`, `exportFileName` (`export-rows.ts`), row menu and bulk Export of a selection (`use-prompt-actions.tsx` 442) | Export CSV of all rows in scope in More (`prompts-screen.tsx` 792 has Copy link and Open run only) | T5, T13 |
| WB-TPH-09 | NOT BUILT | `write-excel-file` installed, `lib/export/export-file.ts` keyword workbook only | Export XLSX writer and item | T5, T13 |
| WB-TPH-17 | NOT BUILT | static "twice a week" copy on Engines; schedules read in the Overview (`overview-queries.ts` 199) | the cadence line on this page, derived (D8) | T6, T13 |
| WB-TPF-05 | PARTIAL | `Included` option only (`prompts-screen.tsx` 269 to 275, 322); `summaryQuery` accepts `brandedOnly` (`prompt-queries.ts` 176), the mock too | Excluded default chip, Only, request and row filter | T2, T12 |
| WB-TPF-08 | NOT BUILT | `Prompt.prompt_type`, `filter[prompt_type_in]` (openapi, c1) | Type filter (key `ptype`), client side | T1, T12 |
| WB-TPF-10 | NOT BUILT | `Prompt.intent` | Intent filter | T1, T12 |
| WB-TPF-11 | NOT BUILT | `Prompt.funnel_stage` | Funnel filter and the Funnel stage column (seam entry) | T1, T3, T12 |
| WB-TPF-12 | NOT BUILT | `Prompt.importance` | Importance filter 1 to 5 | T1, T12 |
| WB-TPF-13 | NOT BUILT | `Prompt.language_code`; one Hindi prompt on Fynix | Language filter (key `lang`) | T1, T12 |
| WB-TPF-18 | NOT VERIFIED | `TopBarPortal` always drawn (`prompts-screen.tsx` 1216), no breakpoint logic; the Overview has a local `FiltersSheet` | the sheet below 768 px and its proof at 390 and 768 | T11, T14, T16 |
| WB-TPS-06 | PARTIAL | one chip per engine (`prompts-strip.tsx` 85 to 95) | the four rate variant with one engine in scope | T7 |
| WB-MNU-08 | PARTIAL | `?inspect=prompt:` restores the drawer; seam lines reserved (`seams/actions.ts` 16, 70) | the Copy link item | T8 |
| WB-MNU-14 | NOT BUILT | **built in the shared table**: `data-table.tsx` 166, `row-menu.tsx` 58, tests 3002 to 3229; both tabs pass `rowActions` | page level proof on both tabs | T8 |
| WB-MNU-15 | NOT VERIFIED | `Menu` supports `shortcut` (`ui/menu.tsx` 19, 127); `RecordAction` has none (`data-table/types.ts` 8 to 26) | the field carried through, Enter on Open | T8 |
| WB-NAV-11 | PARTIAL | dialog and registry exist (`top-bar-controls.tsx` 128 to 138, `page-shortcuts.tsx`); only the Overview registers | the page registers its keys | T9, T13 |
| WB-NAV-12 | PARTIAL | `switchHref` (`registry.ts` 262), `carriesQuery` for Runs and Costs only (200, 210) | carry the Prompts query minus `inspect`, `itab`, `topic` | T10 |
| WB-KEY-11 | PARTIAL | same as NAV-11 | same | T9, T13 |
| WB-E2E-06 | NOT BUILT | `ai-prompts.spec.ts` has E2E-01 to 05 | Topics tree expand, rollup note, Show in Prompts | T16 |
| WB-E2E-07 | NOT BUILT | unit tests of the bulk routes (`bulk-actions.test.tsx` 199 to 720) | bulk Run now and bulk Archive in the browser with the bulk requests | T16 |
| WB-E2E-08 | NOT BUILT | none | Export CSV downloads a file (and XLSX) | T16 |

## 10. Verified BUILT rows (53): evidence, and the tests this plan adds where one was missing

Not rebuilt. Where a row is touched by another task it says so and the touching task re-proves it.

| Row | Evidence read (file and line, test) | Missing test, added by |
|---|---|---|
| WB-TPH-01 | `prompts-screen.tsx` 1231 to 1238 (`PageHeader` `titleHidden`); `prompts.test.tsx` 86 | none |
| WB-TPH-02 | 745 to 747 and 912 to 924 (`UpdatedRunLink`); `updated-link.test.tsx`, `updated-run-link.test.tsx` | none (T13 keeps it) |
| WB-TPH-07 | 761 to 765, 792; `prompts.test.tsx` 2541 ("Link copied") | none |
| WB-TPH-13 | 707 to 712 (`sr-only sm:not-sr-only`); `prompts.test.tsx` 2550 asserts the classes | a real 390 px proof: T14 |
| WB-TPH-15 | 723 to 741; `prompts.test.tsx` 1507, 1522, 1538 | none |
| WB-TPF-01, 02, 03 | 240 to 268, 908; `prompts.test.tsx` 626 to 826, 881, 1479 | none |
| WB-TPF-04 | 269 to 275, 322; `prompts.test.tsx` 671, 866. Replaced by the three way (D4): its cases are updated in T12 | T12 |
| WB-TPF-16 | 318 to 321, 838 to 842; `prompts.test.tsx` 888, 1496 | T12 (Reset filters beside the bar) |
| WB-TPF-17 | 280 to 292; `prompts.test.tsx` 826, 842, 914 | T12 re-proves it for the new fields |
| WB-TPS-01 to 04, 09 | `prompts-strip.tsx`; `prompts.test.tsx` 1919 to 2035 (chips, tab stop tooltip, hatched answers, n/a with reason, labels while loading) | none |
| WB-TPS-10 | **not found as stated**: no "SOV" label in the strip; the column header "{engine} SOV" exists (`en.json` 3777, `topics-view.test.tsx` 162) | built in T7 |
| WB-MNU-01 to 04 | `use-prompt-actions.tsx`; `row-menu.test.tsx` 82 to 123 (Open, Run now, Copy prompt, Archive with Undo) | none |
| WB-MNU-09 to 13 | `prompts-screen.tsx` 585 to 661; `row-menu.test.tsx` 135 to 174, `topic-menu-list.test.tsx` 80 to 153 | none |
| WB-BLK-01 | `selection-model.ts`; `selection.test.tsx`; the key lacks Included versus Only | T12 (L5) |
| WB-BLK-02 | `selection.test.tsx` 73 to 163 ("N selected", topics and prompts) | none |
| WB-BLK-04, 05, 06 | `use-prompt-actions.tsx`, `run-model.ts`; `bulk-actions.test.tsx` 199 to 720, `archive-confirm.test.tsx` 60 | the browser proof: T16 |
| WB-BLK-07, 08 | `bulk-actions.test.tsx` 176 to 197, `selection.test.tsx` 73, 141 | none |
| WB-BLK-13 | generic `data-table.test.tsx` 390 (Shift+Space range); **no Prompts page test** | T9 (`keys.test.tsx`) |
| WB-NAV-05, 07 | `prompts.test.tsx` 366 to 505 (picker, window keys), 2410 to 2461 (country control); `prompts-scope.tsx` | none |
| WB-KEY-01 | `data-table/toolbar.tsx` 59 | page proof: T9 |
| WB-KEY-02, 04 | `inspector.tsx` 142 to 143; `prompt-inspector.test.tsx` 384 | page proof: T9 |
| WB-KEY-03, 05 | `data-table.test.tsx` 390; `prompts.test.tsx` 1205, 1232, 1261 | page proof: T9 |
| WB-KEY-06 | `features/shell/use-sidebar.ts` 59 (`useShortcut('[', ...)`); the shell tests were not opened | listed in the Help dialog by the shell; T9 asserts it is listed |
| WB-KEY-10 | `lib/a11y/use-shortcut.ts` (`SingleKeysContext`) | Prompts page proof: T9 |
| WB-IA-02 | `lib/navigation/registry.ts` (`prompts`, `/ai/prompts`, `live`); `registry.test.ts` | none |
| WB-STATE-01 | `prompts.test.tsx` 116 | T15 |
| WB-STATE-02 | `prompts.test.tsx` 161 to 180 | T15 |
| WB-STATE-03 | `prompts.test.tsx` 125 | T15 |
| WB-STATE-04 | `prompts.test.tsx` 888, 809 | T12, T15 |
| WB-STATE-05 | `prompts.test.tsx` 147, 294 | T15 |
| WB-STATE-06 | `prompts.test.tsx` 598 | T15 |
| WB-STATE-07 | `prompts.test.tsx` 1995 | T7, T15 |
| WB-STATE-10 | `prompts.test.tsx` 154 | T15 |
| WB-STATE-14 | `prompts.test.tsx` 548, 564, 2007, 520 (a window change keeps the table) | T15 |

## 11. Rows of the 75 not in either list above

None. The brief's table lists 75 rows: 22 in section 9 and 53 in section 10. (WB-TPS-01 to 04, 09; WB-MNU-01 to 04, 09 to 13; WB-BLK-04 to 08 and WB-KEY-01 to 05 are grouped there.)

## 12. Not verified (read these first in the named task and report what was found)

- U1 (T6): that the Fynix mock has an `ai_prompt` schedule seeded (the Eventus one is `mocks/ai-runs.ts` 22; the first engine turned on creates them, `engines-screen.tsx` 293). If Fynix has none, the e2e cadence assertion uses Eventus in a unit test only and the plan's e2e asserts the absence of a line on Fynix.
- U2 (T6): a weekday formatter in `@/lib/format`; if there is none, the day name goes in the message catalog (seven keys under `facets.header.days`), never through `Intl` in a component.
- U3 (T1): that `src/i18n/messages.test.ts` accepts empty objects (the existing `prompts.facets: {}` suggests yes).
- U4 (T8): that Base UI draws `Kbd decorative` for `Enter` in a row menu without a second accessible name; `aria-keyshortcuts` is set by the menu (`useAriaKeyShortcuts`).
- U5 (T9): that Shift click range and Escape clear work in the Prompts bulk bar (V18). If the proof fails the defect is in the shared table: report it, do not patch it here.
- U6 (T12): that the facet predicate keeps the strip honest on the Topics tab without a double `rows` computation costing a visible stall on Eventus (72 prompts); measure once on 1,000 mock prompts if the dev server has them, else say not measured.
- U7 (T16): that the Fynix e2e project can select two rows and reach a Run now confirm with a manual run budget left (`manual_run_limit` is 20 a day); the helper reloads the session between tests if the cap is hit.
- U8 (T14): the stub for a narrow `matchMedia` already in `@/test/customize-harness.stubViewport`; reuse it before writing another.
- U9: whether `features/shell/project-shell.test.tsx` covers a switch with a query (T10 reads it).
- U10: the visual regression baselines (`e2e/visual/pages.spec.ts`) were not read; a baseline of this page changes with the Branded default chip and the View menu. If one exists the coordinator decides who updates it in the pinned image (WB-E2E-12, not in this package's rows).

## 13. Open questions for the coordinator

1. **Q1 (D2): facets on the Topics tab.** Default: facets narrow the Prompts tab and the strip's prompts; the Topics tab keeps whole topics and says so. The alternative is a pure client re-aggregation of topic rows from prompt rows (about one extra task and the risk of drifting from the server's pooled and prompt weighted arithmetic, series and `previous` included). Say which.
2. **Q2 (D4): Branded Included has no chip** (the Overview's rule), where today the Prompts page shows an "Included" chip. Existing cases are updated in T12. Say so if the owner wants a chip in every state.
3. **Q3 (D3): the `view` URL key** is shared by the Topics view (WP-20) and by `useSavedView` (WP-10, WP-49's stored views). Presets here avoid it. WP-49 must choose a different key for the Prompts page or rename the Topics view key.
4. **Q4 (D6): customize the numbers of this strip?** Default no (section 6). T18 is specified if the owner says yes; it needs a design call on md strip versus inline chips first.
5. **Q5 (L2): is the registry the right home for the project switch rule**, or does the coordinator prefer `features/shell/project-shell.tsx`?
6. **Q6 (D8): the cadence wording** "Asked twice a week, Monday and Thursday" is derived from the schedules; when the owner changes cadence per project the line changes with it. Confirm that no static copy is wanted.
7. **Q7: Eventus in the e2e.** The e2e build starts with Fynix only (V14), so the facet e2e is by URL restore, language and branded; the variety lives in unit tests on Eventus.

## 14. Follow-ups

- F1: facet columns for Intent, Importance, Language and Type (the Funnel stage column is the one the row asks for).
- F2: promote `FiltersSheet` and the default chip mapping (`barValues`, `fromBar`) to `components/app/filters`, one definition for this page and the Overview.
- F3: server side facet filters on the summary so the Topics tab can narrow (a backend and WP-12 question).
- F4: the `Open` hint for the bulk bar and an `e` shortcut for Export once the Overview and this page agree on it.
- F5: move the export labels of `use-prompt-actions.tsx` and `export-labels.ts` to one place.
- F6: WB-LAY-43 (section 6, T18).
