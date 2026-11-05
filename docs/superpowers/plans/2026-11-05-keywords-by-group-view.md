# Keywords: the By group view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Keywords page has a view switch, "By group" and "All keywords". By group lists one row per keyword group with its figures (keywords, rank buckets, volume, CPC, AI Overview, updated); a group opens to its keywords (the first 8, then "Show all N"), a group's checkbox selects all its keywords, and a group opens a drawer. The columns that make no sense for a group are left out of By group.

**Architecture:** The shared `DataTable` gains a small, opt-in tree mode (pre-ordered rows, treegrid roles and keys, a tri-state group checkbox, a selected-keyword count, a slot for the view switch); nothing changes for tables that do not use it. The page builds a flat list of rows of three kinds (group, keyword, "show all") from the already loaded `PairedRow`s of the device shown, in client mode only (up to 10,000 keywords; above that the view switch is off). Keyword columns are reused through an adapter, so the flat view is untouched. Selection stays a set of tracked keyword ids, as bulk actions expect; the table's ids for By group rows are composite and map back.

**Tech Stack:** Next.js, TypeScript strict, nuqs, next-intl, TanStack table (inside `DataTable`), MSW, vitest, Playwright.

**Source of truth:** the mock `apps/web/design-preview/kw-grouped.js` (group rows, expansion, selection, view switch, columns menu), `kw-grouped-model.js` (`measures`, `COLUMNS` with `only` and `not`, `columnsFor`), `kw-grouped-drawer.js` (group drawer), `docs/design-system/12-tables.md` section 16 (grouping: one level, sums or counts), `docs/design-system/20-accessibility.md` 6.7 (treegrid roles and keys) and `docs/design-system/24-page-templates.md`.

**Preconditions:** the "one device at a time" plan is merged in this branch (rows are `pairRows(rows, device)`, one Rank column). Clicks and Impressions sums are NOT in this plan (see the Search Console columns plan, which extends `GroupMeasures`).

**Decisions made here:**
- Group rows are the keyword's **direct groups** (`row.groups[].group_id`), one level, labelled by the group's `path`. A keyword in several groups is listed under each; a keyword in none is under "Not grouped" (id `__none`). A group with no keyword in view (device, country, filters, search) is not listed.
- Counting is by **distinct keyword** (`keyword.keyword_id`), never by the API's `keyword_count` (which counts tracked rows on both devices, ignores filters).
- By group works in **client mode only** (every row loaded, at most 10,000 keywords). In server mode the switch shows "All keywords" and the By group option is disabled with the reason; the URL `view=groups` then falls back to the flat view.
- Default view: By group when the project has at least one group and the table is in client mode, otherwise All keywords; an explicit `view` in the URL wins.
- While a search is on, every group with a match is open (the "Show more" limit still applies), and the open groups from before come back when it is cleared. J and K step over the keyword rows shown, so they are idle while the open keyword's group is closed.
- Not in this plan: "Export this group", nested group rows, drag to move a keyword between groups.

Work in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/keywords-grouped`; commands from `apps/web`. The three known failing vitest tests (rank trend sparkline, two rank-strip tests) and four failing e2e tests are not yours.

---

### Task 1: DataTable tree mode

**Files:**
- Modify: `src/components/app/data-table/types.ts`, `data-table.tsx`, `toolbar.tsx`
- Test: `src/components/app/data-table/data-table.test.tsx` (add a `describe('tree mode')`)

Add these optional props (all absent means today's behaviour exactly):

```ts
/** Tree mode: the caller sends the rows already in display order (group rows and their keywords). */
export interface RowTree {
  /** 1 for a group row, 2 for a row inside one. */
  level: 1 | 2;
  /** Group rows only: whether its rows are shown. */
  expanded?: boolean;
  /** Rows at this level in the group it belongs to, and this row's place among them (aria-setsize, aria-posinset). */
  setSize: number;
  posInSet: number;
}
// in DataTableProps:
/** The tree facts of a row; a table with this prop is a `treegrid`, shows rows in the order given (no sorting of its own), toggles a group row on click, Enter, and Right/Left Arrow. */
rowTree?: ((row: TRow) => RowTree | undefined) | undefined;
/** Called to open or close a group row. */
onToggleGroup?: ((row: TRow) => void) | undefined;
/** A slot at the start of the toolbar: the view switch. */
toolbarStart?: ReactNode;
// in Selection:
/** Rows drawn as partly selected (a group with some of its keywords chosen). */
indeterminateIds?: ReadonlySet<string> | undefined;
/** What the bulk bar counts when it is not the number of ids (keywords chosen, not rows). */
selectedCount?: number | undefined;
/** Selectable rows the table does not render (the keywords of closed groups): they are not "hidden by filters". */
unrenderedCount?: number | undefined;
```

- [ ] **Step 1: Read first**

Read `data-table.tsx` lines 186-211 (row pipeline), 424-473 (selection), 508-610 (keys), 749-761, 791-837 (toolbar and bulk bar), 988-1110 (row render), and `toolbar.tsx`; read `docs/design-system/20-accessibility.md` 6.7 and `12-tables.md` section 16. The edits below follow the line ranges the earlier survey gave; re-find them by content.

- [ ] **Step 2: Failing tests**

In `data-table.test.tsx`, using its own `renderTable`-style helper (read how the file builds rows and columns), add tests with a flat list of four rows: group A (level 1, expanded), two rows under it (level 2), group B (level 1, collapsed):
1. With `rowTree` the table has `role="treegrid"`; a group row has `aria-expanded="true"` or `"false"`, `aria-level="1"`, `aria-setsize` and `aria-posinset`; a child has `aria-level="2"` and no `aria-expanded`.
2. Rows are shown in the order given even when `sort` names a column (no re-sorting): with `sort=[{id:'name', desc:true}]` the DOM order is still the given order.
3. Clicking a group row, pressing Enter on it, and ArrowRight (collapsed) / ArrowLeft (expanded) call `onToggleGroup` with that row; ArrowRight on an expanded group row and ArrowLeft on a child move focus as the ARIA treegrid pattern says (ArrowRight on an expanded group moves to its first child; ArrowLeft on a child moves to its group row).
4. A group row's checkbox is `aria-checked="mixed"` when its id is in `selection.indeterminateIds`, checked when in `selectedIds`.
5. With `selection.selectedCount = 7` the bulk bar says 7 selected though `selectedIds.size` is 3; with `unrenderedCount = 4` the bar does not say 4 are hidden by filters.
6. `toolbarStart` renders at the start of the toolbar.
7. Without any of the new props the existing 69 tests still pass (run the whole file).

Run: `pnpm vitest run src/components/app/data-table`; expect the new tests FAIL.

- [ ] **Step 3: Implement**

- Sorting: `useSortedRows({ ..., manual: serverMode || rowTree !== undefined })`; search stays off when `searchText` is not given.
- Table role: `role={rowTree === undefined ? 'grid' : 'treegrid'}`.
- Row attributes: when `rowTree?.(row)` is defined add `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded` for level 1; a level 1 row gets the group row class (use the existing row hover/selected tokens; a `bg-surface-sunken` style or the one `12-tables.md` section 16 names, read it) and `data-group-row`.
- Click and keys: a click on a level 1 row that `isRowClick` accepts calls `onToggleGroup(row)` instead of `onRowOpen`; Enter on a level 1 row toggles; ArrowRight/ArrowLeft as in test 3, before `moveFocus` handles the arrows in a tree table. Space keeps selecting the row.
- Checkbox: `checked={isSelected ? true : selection.indeterminateIds?.has(id) ? 'indeterminate' : false}` (the header checkbox already accepts `'indeterminate'`).
- Counts: where the bulk bar gets the selected count and the "hidden" count use `selection.selectedCount ?? selectedIds.size` and `hiddenSelected - (selection.unrenderedCount ?? 0)` floored at 0 (read lines 430-434 and 805-806 and adjust the exact expressions).
- `toolbarStart`: render in `toolbar.tsx` before the search field.

- [ ] **Step 4: Run, check the other users, commit**

Run: `pnpm vitest run src/components/app/data-table src/features/operations && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: pass (the design system sections and the runs screen use `DataTable` without the new props).

```bash
git add apps/web && git commit -m "DataTable: an opt-in tree mode for grouped rows"
```

---

### Task 2: The model of grouped rows (pure)

**Files:**
- Create: `src/features/rankings/grouped/grouped-rows.ts`
- Test: `src/features/rankings/grouped/grouped-rows.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { groupedRows, groupMeasures, NOT_GROUPED, selectionOf, toggleGroupIds, trackedIdsOf } from './grouped-rows';
import { makeKeywordRow } from '@/test/rankings-harness'; // use the file's own row builder; see keyword-pairs.test.ts for `row(...)`
```

Use the row builder of `keyword-pairs.test.ts` (its `row(id, text, device, options)`), extended in the test file with `groups`, `rank`, `volume`, `cpc` and `aio` options (build `PairedRow`s with `pairRows`). Cases:

1. **Grouping:** three keywords, `a` in group G1, `b` in G1 and G2, `c` in none, give group rows in this order: G1 (2 keywords), G2 (1), then "Not grouped" (1) last; label is the group `path`.
2. **Counting by distinct keyword:** the same keyword tracked in two countries (two `PairedRow`s with the same `keyword_id`) counts once in `size`.
3. **Measures:** for G1 with ranks 2 and 14: `top3: 1`, `top10: 1`, `top20: 2`; volume is the sum of `metrics.search_volume.value` (null counts as 0); `cpc` is the mean of the non-null CPCs, `null` when none; `cited` counts `aio.state === 'present_cited'`; `updated` is the newest `last_observed_at`.
4. **Expansion:** with `expanded = new Set([G1])` the flat list is `[group G1, keyword, keyword, group G2, group NOT_GROUPED]`; a group with more than 8 keywords shows 8 and a `more` row with `hidden = n - 8` unless its id is in `showAll`.
5. **Ids:** keyword row ids are `${groupId}:${trackedKeywordId}`; group ids are `group:${groupId}`; `more` ids are `more:${groupId}`; all unique even when a keyword sits in two groups.
6. **Order inside:** keywords sort by rank (best first, unranked last) by default; groups sort by the sort given: `groupSort: { by: 'size' | 'name' | 'volume' | 'rank'; desc: boolean }` with `'size'` desc the default, "Not grouped" always last.
7. **Selection mapping:** `selectionOf(rows, chosenTrackedIds)` returns `{ selectedIds, indeterminateIds }` over the rendered row ids: a keyword row is selected when its tracked id is chosen (every copy of it); a group row is selected when all its members are chosen, indeterminate when some are; `trackedIdsOf(group)` gives all members' tracked ids (not only the rendered ones, so a closed group selects all of its keywords). `toggleGroupIds(chosen, group)` adds all members when not all are chosen, else removes them. `applySelectionChange(chosen, previousSelectedIds, nextSelectedIds, rows)` turns the table's new set of row ids into new chosen tracked ids using the difference (added ids add, removed ids remove; a group id adds or removes all its members; the same keyword under two groups stays chosen while any of its ticked copies is not removed by this change).

Run: `pnpm vitest run src/features/rankings/grouped/grouped-rows.test.ts`; expect FAIL.

- [ ] **Step 2: Implement**

```ts
import type { PairedRow } from '../keyword-pairs';

export const NOT_GROUPED = '__none';
export const GROUP_PREVIEW = 8;

export interface GroupMeasures {
  /** Distinct keywords. */
  size: number;
  top3: number;
  top10: number;
  top20: number;
  volume: number;
  /** Mean CPC of the keywords that have one, in USD; null when none has. */
  cpc: number | null;
  /** Keywords the site is cited for in the AI Overview. */
  cited: number;
  /** The newest check time among the keywords, ISO; null when none was checked. */
  updated: string | null;
}

export interface GroupData {
  groupId: string;
  /** The group's path, or the "Not grouped" label. */
  label: string;
  rows: readonly PairedRow[];
  measures: GroupMeasures;
  /** Tracked keyword ids behind every keyword of the group, both devices of each. */
  memberIds: readonly string[];
}

export type GroupedRow =
  | { kind: 'group'; id: string; group: GroupData; expanded: boolean }
  | { kind: 'keyword'; id: string; groupId: string; row: PairedRow }
  | { kind: 'more'; id: string; groupId: string; hidden: number };

export type GroupSort = { by: 'size' | 'name' | 'volume' | 'rank'; desc: boolean };
```

`groupMeasures(rows)`, `buildGroups(rows, notGroupedLabel)`, `groupedRows({ rows, notGroupedLabel, expanded, showAll, sort })`, `selectionOf`, `trackedIdsOf`, `toggleGroupIds`, `applySelectionChange` as the tests specify. Rank of a row is `row.state.current.state === 'ranked' ? row.state.current.rank : null`; the group's rank sort key is its best (lowest) rank; `memberIds` come from `memberIds([row])` of `keyword-pairs.ts` (both devices) so a group selection reaches both devices of each keyword, as the existing bulk actions do. `aio` cited is `row.state.aio.state === 'present_cited'`.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/features/rankings/grouped && pnpm lint && pnpm typecheck`

```bash
git add apps/web && git commit -m "Keywords: the model of grouped rows"
```

---

### Task 3: Columns for By group

**Files:**
- Create: `src/features/rankings/grouped/grouped-columns.tsx`, `src/features/rankings/grouped/view-columns.ts`
- Modify: `src/features/rankings/keyword-columns.tsx` (order), `messages/en.json` (`rankings.grouped`)
- Test: `grouped-columns.test.tsx`, `view-columns.test.ts`, update `rankings.test.tsx` if it asserts column order

- [ ] **Step 1: Failing tests**

`view-columns.test.ts` (pure): `columnsForView(allIds, view)` returns for `'groups'` the ids without `serp_features`, `keyword_difficulty`, `intent`, `trend`, `tags`, `group` and the competitor columns, and for `'flat'` all of them; `visibleForView(urlCols, allIds, view)`: with `urlCols === null` the defaults of the view; with an explicit list, that list minus the hidden ones in By group; `mergeHidden(urlCols, next, allIds, view)` keeps the ids that the By group view hides when the person edits the chooser there (so editing columns in By group does not lose KD, Intent, Features, Trend, Tags in the flat view).

`grouped-columns.test.tsx`: `useGroupedColumns(keywordColumns, device)` maps each keyword column to a `DataTableColumn<GroupedRow>`: for a `keyword` row the cell and sort value are the keyword column's; for a `group` row the cell is the group's: identity column shows a chevron button named `Expand {label} group, {n} keywords` / `Collapse ...`, the label and the count; rank column `"{n} in top 10"` (the plural form of the existing messages; `0 in top 10` muted); volume the sum with the column's own formatting; CPC the mean (`Unknown` when null); AI Overview `"{n} cited"`; Updated the newest time; every other column an empty muted cell. For a `more` row the identity cell is a link button `Show all {n}` and the others are empty. Sorting: only the group order is sortable (the table is pre-ordered), so `sortValue` is `undefined` on all columns in By group and the header sort control is replaced by choosing the group sort (Task 4).

Run: `pnpm vitest run src/features/rankings/grouped/grouped-columns.test.tsx src/features/rankings/grouped/view-columns.test.ts`; expect FAIL.

- [ ] **Step 2: Implement**

- `keyword-columns.tsx`: reorder the array literal to the mock's order: `keyword, rank, url, volume, [clicks, impressions: added by the Search Console plan], KD, intent, features, aio, cpc, competitors, trend, priority, group, tags, best, updated, added` (move the `cpc_usd` column from after KD to after `ranks.aio`). Update any test that asserts the order.
- `view-columns.ts`: constants `HIDDEN_IN_GROUPS = ['serp_features', 'keyword_difficulty', 'intent', 'trend', 'tags', 'group']` and the pure functions above (competitor columns are the ids starting `competitor_`).
- `grouped-columns.tsx`: `useGroupedColumns` as specified; group cells read `row.group.measures` and the `GroupData`; formatting uses the same `lib/format` functions as the keyword cells (`formatInteger`, `formatCurrency`, `formatTableDateTime`). Messages under `rankings.grouped`: `expand` (`"Expand {label} group, {count} keywords"`), `collapse`, `inTop10` (`"{count} in top 10"`), `cited` (`"{count} cited"`), `showAll` (`"Show all {count}"`), `notGrouped` (`"Not grouped"`), `viewLabel`, `byGroup`, `allKeywords`, `needsClientMode`. No em-dashes.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/features/rankings && pnpm lint && pnpm typecheck && pnpm format:check` (only the three known failures may remain).

```bash
git add apps/web && git commit -m "Keywords: columns for the By group view and the CPC order"
```

---

### Task 4: The view in the screen

**Files:**
- Modify: `src/features/rankings/rankings-screen.tsx`
- Create: `src/features/rankings/grouped/view-switch.tsx`, `src/features/rankings/grouped/use-grouped-table.ts`
- Test: `src/features/rankings/grouped/grouped-view.test.tsx` (screen level, using `rankingsAs` from `src/test/rankings-harness.tsx`), plus `rankings.test.tsx` for the default

Behaviour:
- URL state `view` (`'groups' | 'flat'`, absent = default rule above). `view-switch.tsx` is a `SegmentedControl` (semantics `view`, items "By group" with `Layers` and "All keywords" with `List` icons; the project's icon set, see `07-icons.md`), passed to `DataTable` as `toolbarStart`. In server mode By group is disabled with `needsClientMode` as its reason.
- `use-grouped-table.ts` takes `pairedRows`, `device`, the group sort, local `expanded` and `showAll` sets (React state; all groups start collapsed except the first), and returns the `GroupedRow[]`, the `rowTree`, `onToggleGroup`, the `selection` (selectedIds, indeterminateIds, selectedCount, unrenderedCount from Task 2's functions) and the mapped `onChange`.
- The screen passes `DataTable<GroupedRow>` in By group (rows = flat grouped list, `getRowId = (r) => r.id`, `rowTree`, columns from `useGroupedColumns`, `columnState` from `view-columns.ts`, `searchText` set to the keyword text so the search still filters keywords in memory and groups with no match disappear), and the existing `DataTable<PairedRow>` in All keywords. The total shown is the number of distinct keywords in view.
- Bulk actions: the `bulkActions` and `expandAction` of the screen receive `GroupedRow`s from the table; map them to tracked ids with `trackedIdsOf` (group rows expand to all members), then to `expandIds` as today. `allMatching` is off in By group (the "select all N matching" offer is not shown there: `matchingTotal = null`).
- Group sort: a small menu in the identity column header or beside the view switch ("Sort groups: Most keywords, Name, Volume, Best rank"), local state, not in the URL.
- Empty and loading states are the table's own. While the list is still loading in pages (`list.loadProgress !== null`) By group shows a banner line "Groups are complete when all keywords have loaded" (copy the style of the existing `incomplete` banner) so partial sums are not read as final.

- [ ] **Step 1: Failing tests (screen level)**

With a harness project that has groups (the fixture `fynix` has keywords; read `src/mocks/keyword-table.ts` and `keyword-fixtures.ts` for their group memberships and add one `Not grouped` keyword and one keyword in two groups to the fixture if missing, then update the counts of tests that depend on the fixture):
1. By group is the default when the project has groups; `?view=flat` shows the flat table (`columnheader` Rank exists, no `treegrid` role).
2. Group rows show the label and distinct keyword count; expanding one (click, then check `aria-expanded`) shows its keywords; "Show all N" appears for a group over 8 and shows the rest.
3. The group checkbox selects all of the group's keywords, including those not shown (the bulk bar says `N selected` with N the keywords, not rows), and a keyword in two groups shows selected under both.
4. Ticking one keyword makes its group's checkbox indeterminate.
5. Delete on a group selection sends `bulk-delete` (the bulk bar has no Archive since develop e4ff2fd) with the tracked ids of both devices of every keyword (capture the request like the existing bulk tests).
6. KD, Intent, SERP features, Trend and Tags headers are absent in By group and present in All keywords; editing columns in By group and going back keeps the flat view's columns.
7. Switching device re-aggregates (Mobile shows different counts than Desktop for a group, using a keyword whose ranks differ).
8. In server mode (override the count so the list is server mode, as `rankings.test.tsx` tests of server mode do) By group is disabled and the flat view shows.

Run: `pnpm vitest run src/features/rankings/grouped`; expect FAIL.

- [ ] **Step 2: Implement** as described above, then run the whole feature folder.

Run: `pnpm vitest run src/features/rankings src/test && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: only the three known failures.

- [ ] **Step 3: Commit**

```bash
git add apps/web && git commit -m "Keywords: the By group view, the view switch and group selection"
```

---

### Task 5: Group actions and the group drawer

**Files:**
- Modify: `src/lib/inspector/placement.ts` (add `'group'` to `INSPECTOR_TYPES`), `src/features/rankings/rankings-screen.tsx` (`onRowOpen`, inspector wiring, row actions), `add-keywords/add-keywords-dialog.tsx` (a `groupPreset` prop)
- Create: `src/features/rankings/grouped/group-inspector.tsx`, `group-actions.ts`
- Test: `group-inspector.test.tsx`, `group-actions.test.tsx`, `src/lib/inspector/placement.test.ts`

Group row menu (from the mock, `kw-grouped-menus.js` group menu): Open group (the drawer), Check now (the group's keywords through `use-check-now`, up to its 100-id limit with the same refusal text), Add keywords (the dialog opens with the group chosen), Rename group, Delete group (the keywords become "Not grouped", the existing group delete). Rename and Delete reuse the mutations of `groups/manage-groups-dialog.tsx` (PATCH at line ~41, DELETE ~115; extract them to hooks in `groups/group-mutations.ts` rather than duplicating).

Group drawer (`kw-grouped-drawer.js`): header with the group name and `n keywords`; the measures (rank buckets, volume, cited, updated) of the device shown; a list of the group's keywords with their rank (a `PlainTable`; clicking one opens that keyword's inspector); actions: Add keywords, Check now, Rename, Delete. `inspect=group:<groupId>` in the URL; J and K move between keywords only (report only keyword ids through `onRowOrderChange`, mapped from composite ids).

- [ ] **Step 1: Failing tests**

`placement.test.ts`: `parseInspectTarget('group:0192...')` returns `{type:'group', id}`; widths default. `group-actions.test.tsx`: the menu lists the five items; Check now posts the group's tracked ids (both devices) to the runs route (copy `check-now.test.tsx`'s capture); Add keywords opens the dialog with the group chip chosen; Rename sends PATCH with the new name; Delete asks to confirm (copy the Manage groups confirm text) and sends DELETE. `group-inspector.test.tsx`: opens from `?inspect=group:<id>`, shows the name, count and bucket figures for Desktop and different ones for Mobile, lists keywords, a keyword click switches to the keyword inspector. Run and expect FAIL.

- [ ] **Step 2: Implement, run, commit**

Run: `pnpm vitest run src/features/rankings src/lib/inspector src/test && pnpm lint && pnpm typecheck && pnpm format:check`

```bash
git add apps/web && git commit -m "Keywords: group actions and the group drawer"
```

---

### Task 6: End to end, docs, full checks

**Files:**
- Modify: `e2e/flows/rankings.spec.ts`, `docs/design-system/24-page-templates.md`, `docs/design-system/12-tables.md` (section 16: As built), `docs/20-frontend-specification.md` (5.3)

- [ ] **Step 1: e2e** one flow: open the page (By group default for a project with groups), expand a group, select the group, see `N selected`, switch to All keywords and see Rank and Group columns, switch device to Mobile and see group counts change. Run `pnpm e2e e2e/flows/rankings.spec.ts` (the four earlier failures are not yours).
- [ ] **Step 2: Docs** As built paragraphs (decisions above, the column sets per view, client mode only).
- [ ] **Step 3: Final checks:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`.

```bash
git add apps/web docs && git commit -m "Keywords: the By group view, end to end and in the docs"
```

---

## Self-review

- **Spec coverage:** view switch and default (task 4); group rows with the mock's figures (tasks 2, 3); expansion, first 8 and Show all (2, 4); group checkbox selecting all its keywords and tri-state (1, 2, 4); columns hidden in By group without losing the flat view's choice (3); CPC after AI Overview (3); group drawer and menu (5); device-only aggregates (2, 4); counting distinct keywords (2); client mode limit (4). Clicks and Impressions sums, top bar and search are the next plan.
- **Placeholders:** none; where a step says "read how the file builds rows", the file and the behaviour are named.
- **Type consistency:** `GroupedRow`, `GroupData`, `GroupMeasures`, `GroupSort`, `NOT_GROUPED`, `GROUP_PREVIEW` are defined in task 2 and used in 3 to 5; `RowTree`, `rowTree`, `onToggleGroup`, `toolbarStart`, `Selection.indeterminateIds/selectedCount/unrenderedCount` are defined in task 1 and used in 3 and 4; ids `group:`, `more:` and `${groupId}:${trackedId}` are defined once (task 2).
- **Known limits:** By group needs every row in memory (at most 10,000 keywords); a keyword in several groups is counted once in the strip but listed in each group; a closed group's keywords are selectable only through the group checkbox.
