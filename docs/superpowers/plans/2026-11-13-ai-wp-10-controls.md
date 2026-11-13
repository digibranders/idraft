# WP-10 detailed task plan: mobile list rows, saved view presets menu, date range picker

Brief: [docs/ai-visibility/work-packages/WP-10-controls.md](../../ai-visibility/work-packages/WP-10-controls.md).
Branch `ai/wp-10-controls`, worktree `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6` (the brief names
`.claude/worktrees/wp-10`; this session works in the worktree it was given and stays in it), cut from
`origin/develop` at `1e163b05`. Rows: SC-04, SC-06, SC-08, WB-NAV-06 (4). Steps: T0 to T5 (6). Kind: web.
Contract: consumes the built `from` and `to` of the summary routes (project days, both included, at most 92,
`422 window_too_large` with `limit_days`); no new route, no MSW handler, no `pnpm gen:api`.

## 1. Header

### 1.1 Goal

Three shared controls that every AI table page composes, each with tests beside it, a `/design-system` entry
and an e2e flow:

- `DataTableList`: the below 768 px rendering of a table as two-line rows that open the inspector, with a
  "List / Table" switch for a narrow screen that is not touch-primary (a zoomed desktop), and a sort menu.
- `SavedViewMenu`: "View: Default" with presets that map to URL states, the "(edited)" state and Reset, and a
  typed seam through which WP-49 adds persisted views and Save, Save as, Rename, Delete, Default and Share.
- `DateRangePicker`: presets 7, 28 and 90 days and a custom range with typed dates and a keyboard calendar,
  in the project time zone, capped at 92 days with the reason in words, fitting a 320 px screen; wired into
  the top bar of Topics & Prompts (the only live AI page) in place of today's window select.

### 1.2 Scope

| Part | File | Row |
|---|---|---|
| `DataTableList`, `useListMode`, `ListTableSwitch`, `DataTableListSort`, `LIST_ROW_HEIGHT` | `apps/web/src/components/app/data-table/data-table-list.tsx` (new) | SC-04 |
| View model (pure): `matchView`, `viewParams`, `viewChangeCount`, types | `apps/web/src/components/app/views/views-model.ts` (new) | SC-06 |
| URL hook: `useSavedView` | `apps/web/src/components/app/views/use-saved-view.ts` (new) | SC-06 |
| `SavedViewMenu` | `apps/web/src/components/app/views/saved-view-menu.tsx` (new) | SC-06 |
| Business date arithmetic (pure) | `apps/web/src/components/app/date-range/business-date.ts` (new) | SC-08 |
| Range model (pure): presets, resolve, check, URL codec | `apps/web/src/components/app/date-range/range-model.ts` (new) | SC-08 |
| URL hook: `useDateRangeParams` | `apps/web/src/components/app/date-range/use-date-range-params.ts` (new) | SC-08 |
| `MonthGrid` (one month, APG grid keyboard) | `apps/web/src/components/app/date-range/month-grid.tsx` (new) | SC-08 |
| `DateRangePicker` (trigger, popover, presets, custom pane) | `apps/web/src/components/app/date-range/date-range-picker.tsx` (new) | SC-08 |
| Top bar wiring on Topics & Prompts (lease) | `apps/web/src/features/prompts/prompts-screen.tsx`, `prompts-scope.tsx`, `prompt-model.ts` and their tests | WB-NAV-06 |
| Gallery section | `apps/web/src/components/design-system/controls-section.tsx` (new) | all |
| e2e flow | `apps/web/e2e/flows/ai-controls.spec.ts` (new) | all |

Every `.ts`/`.tsx` above gets a `<name>.test.ts(x)` beside it, except the gallery section (covered by
`registry.test.tsx` and the e2e flow).

### 1.3 Not touched

- `components/app/data-table/data-table.tsx`, `types.ts`, `use-sorted-rows.ts`, `toolbar.tsx` and every other file
  of `data-table/` (WP-09 built and merged them; they are imported, never edited). The screen chooses between
  `DataTable` and `DataTableList` (C1).
- `components/app/shell/top-bar.tsx` and `top-bar-slot.tsx`: the existing `TopBarPortal` is the date slot (C5).
- `components/ui/*`, including `popover.tsx`: the picker fits narrow screens through its own `className` and
  layout (C7). No lease on `ui/popover.tsx` is needed. The `notifications` width (`w-95`) is NotificationCenter's
  (SC-21), not this package's.
- `lib/dom/use-media-query.ts` (its `MEDIA` has no 768 px query; the list keeps its own two query constants),
  `lib/preferences/*`, `lib/format/*`, `lib/tables/*`, `lib/permissions/*`.
- `messages/en.json` outside the three new `common` sub-objects of T0 (section 2.4). The empty top-level
  `savedViews` namespace belongs to WP-49 and stays empty.
- Backend, OpenAPI, `schema.ts`, mocks, navigation registry, `e2e/support.ts`, `e2e/flows/ai-prompts.spec.ts`
  (WP-17), `e2e/flows/rankings.spec.ts` (another agent of this session is editing it), tracker files.

### 1.4 Contradictions and decisions

| # | Contradiction (source) | Decision |
|---|---|---|
| C1 | DS19 6.7: "Below 768 px, a `DataTable` renders as a list"; DS25 7.10 makes `DataTableList` its own component with `line1`, `line2`, `onOpen`; `data-table.tsx` belongs to WP-09 (merged, shared hot spot, MASTER-PLAN 3.6) and the brief owns only `data-table-list.tsx` | `DataTableList` is a sibling of `DataTable` in `data-table-list.tsx`. It takes the same `columns`, `rows`, `sort`, `search`, `searchText`, `status` and state slots as `DataTable`, so the screen passes one set of props to whichever it renders: `const list = useListMode(); list.mode === 'list' ? <DataTableList .../> : <DataTable ... toolbarEnd={list.canSwitch ? <ListTableSwitch .../> : undefined} />`. No edit of `data-table.tsx`. Making `DataTable` switch by itself is follow-up F1 under a lease |
| C2 | "Switch to the full table": DS19 6.7 rule 7 and 1.1: only when the layout is mobile and the device is not touch-primary, a "List / Table" segmented control; DS19 principle 3: URLs are identical across widths | `useListMode()` returns `{ mode, canSwitch, onModeChange }`: `mode` is `list` when `(width < 48rem)` matches and the person has not chosen Table, `canSwitch` is true only when `(width < 48rem)` matches and `(pointer: coarse) and (hover: none)` does not. The choice is component state, not in the URL (presentation, not a view of the data), reset on reload; persisting it is follow-up F2 (a preference needs `lib/preferences` under a lease). Server render and hydration render the table (both queries answer false), then a phone switches to the list on the first effect: desktop is the reference layout (DS19 1.1) |
| C3 | DS20 6.8: "each row is one link" with `href="?inspect=keyword:..."`; no inspector href builder exists, typed `Route` forbids building `?inspect=` strings without a cast, and the inspector is nuqs state | Each row is one native `button` inside an `li` that calls `onRowOpen(row)` (the screen calls `useInspector().open`). The accessible name reads identity, value label and value, context, delta, as DS20 6.8 says. A link form (`rowHref`) is follow-up F3 once an inspector href helper exists |
| C4 | DS25 7.10 `line1: { identity, value }`, `line2: { context, delta }` as slots; DS20 6.8 wants the value spoken "with its label" | `line1` returns `{ identity: string; value: ReactNode; valueLabel: string }` (the label is spoken before the value through an `sr-only` span); `line2` returns `{ context: string; delta: ReactNode \| null }`. Value and delta are the desktop cell components (MetricCell, RankCell, Delta), so a value reads the same on both (DS19 6.7 rule 2) |
| C5 | Brief owns "shell/top-bar date slot"; DS25 5.4 `TopBarProps.dateRange: Slot \| null`; the code has one generic `TopBarSlotTarget` that `prompts-screen.tsx` fills with its window select then its country, in that order | No new slot. The page renders `DateRangePicker` first inside its one `TopBarPortal`, which already gives the DS order (date range, then location, then the fixed controls). `top-bar.tsx` and `top-bar-slot.tsx` are not edited. A named slot is a ten-line follow-up (F4) if a second page needs the date range without a location |
| C6 | DS19 3.2 and the preview (`hidden md:flex`): below 768 px the date range leaves the top bar for the filter sheet; no filter sheet exists (`filter-bar.tsx` has none) and WB-NAV-05 built "28d" under 640 px as the approved phone form | The trigger stays in the top bar at every width: "Last 28 days" from 640 px, "28d" below (custom: "45d"), the full dates in the tooltip and in the accessible name. Moving it into the filter sheet is for the package that builds the sheet (F5). Recorded in T5 |
| C7 | DS10 10.2: the open picker is about 665 px and below 768 px a bottom sheet; `ui/popover.tsx` `date-range` is `w-162` (648 px), which the coordinator says ignores the available width; DS19 9: popovers become bottom sheets below 640 px, which no popover in the code does | Fixed inside the picker, no lease: presets only, `width="content"` with `className="w-44 min-w-0"` (176 px, as DS10); custom pane open, `width="date-range"` with `className="w-auto"` (the popover shrinks to its content, and the base `max-w-(--available-width)` caps it). The layout is `flex-col` below `md` (presets above, one month) and `md:flex-row` from 768 px (two months; the second month is `max-md:hidden`, CSS only, no hydration difference). At 320 px the content is at most 292 px of the 304 px the viewport leaves. Anchored popover on phones, like every other popover in the code; a bottom sheet is F6 |
| C8 | DS25 4.18 and DS10 10.2: presets 7d, 28d, 90d, 12w and `granularity: 'day' \| 'week'`; the coordinator and WB-NAV-05: 7, 28, 90 | Presets 7, 28, 90 days (`RANGE_PRESETS`), default 28. `12w` and week snapping are skipped: no weekly screen exists yet (F7) |
| C9 | DS25 4.18 path `app/filters/date-range-picker.tsx`; DS25 7.7 path `app/data-table/saved-view-menu.tsx`; the brief owns `app/date-range/` and `app/views/` | The brief wins: `components/app/date-range/` and `components/app/views/`. Recorded in T5 |
| C10 | DS25 4.16: the calendar is react-day-picker 10 in `ui/calendar.tsx`; react-day-picker is not a dependency (`apps/web/package.json`) and a new dependency needs a lease; the approved preview (`design-preview/interactions.js` `renderMonth`) draws its own grid | An in-house `MonthGrid` in `date-range/month-grid.tsx` (one `table role="grid"` per month, about 150 lines), with the DS10 10.1 rules: Monday start, outside days hidden, future days and days outside `min`/`max` disabled and not focusable, 32 px day cells, keyboard by APG (arrows by day, Page Up and Page Down by month, Shift with them by year, Home and End to week start and end, Enter and Space select). No dependency, no lease |
| C11 | URL keys: DS23 15 and DS10 10.2 say `win=28d` or `from` and `to`; the code (`prompts-screen.tsx` `VIEW_STATE`) has `window=7\|28\|90`, used by 5 tests and every shared link so far | The shared hook uses the DS keys `win` (`7d`, `28d`, `90d`) and `from`, `to` (project days), history `replace`. On Topics & Prompts (T3b, leased) a legacy `window=7` is read as `win=7d` and rewritten on the first change, so old links and the existing tests that open `?window=7` keep working |
| C12 | The 92 day cap: the summary routes count project days, both included (`summary_dates`, `SUMMARY_MAX_DAYS = 92`); the answers route (`observations.py`, `OBSERVATIONS_MAX_DAYS = 92`) compares elapsed time, so 92 project days across the October clock change are 92 days and 1 hour and refused; `prompt-model.ts` keeps `WIDEST_WINDOW = 90` for that reason | `MAX_RANGE_DAYS = 92`, counted as the summary counts (project days, both included); `maxDays` is a prop (default 92), so a screen whose range also reaches the answers route passes 91. T3b checks which requests of Topics & Prompts receive the range and sets `maxDays` accordingly, with a test (R4) |
| C13 | "A reason in words when the cap or the data start limits it" (coordinator); DS10 10.2 shows only a 400 day message; the API has no "data starts" field for AI data | Three reasons in words under the inputs and as the Apply button's description: the cap ("105 days is longer than the 92 day limit..."), the data start (`earliest` prop: "Data starts on Mar 2, 2026, so earlier dates are not available."), and the future ("Dates after today, Nov 13, 2026, are not available."). While only a start is picked, ends past the cap are disabled and the note says from which date. `earliest` is the caller's (for example the project's first collection day); Topics & Prompts passes none until such a field exists (F8) |
| C14 | Comparison range (`cmp`, DS13, CompareSelect in DS25) | Not asked by the inventory rows of this package: no comparison in the picker. `CompareSelect` is its own part (skipped, 1.5) |
| C15 | DS25 7.7 `SavedViewMenuProps` is the persisted menu (`onSave`, `onSaveAs`, `onRename`, `onDelete`, `canSaveWorkspace`); the brief: presets now, persistence later (WP-49 owns "components/app/views/ (persistence)" and `lib/views/`) | The menu takes `views` (presets now, WP-49 adds `scope: 'workspace' \| 'personal'` views) and an optional `actions: SavedViewActions` (the persistence seam, section 2.2). Without `actions` the menu has the views and "Reset to {view}". WP-49 adds `components/app/views/use-persisted-views.ts` that returns `views` and `actions` and reads `useCan('views:write')` itself; it never edits `saved-view-menu.tsx` except to fill an item the seam already names |
| C16 | What is a preset: DS12 11 stores filters, sort, columns, density, grouping, search; DS23 14 "does not store the inspector or date window"; WB-TPH-04 "Presets map to URL states; Branded prompts is `branded=only`" | A preset is `{ id, name, params }`: the URL values it sets for the screen's `viewKeys` (the keys a view governs, never `inspect`, `itab`, `win`, `from`, `to`); a key of `viewKeys` that the preset does not list is cleared. The URL carries `view=<id>` (push, DS23 15) so "(edited)" can be told from another view; `default` is the view with no params and no `view` key |
| C17 | No message namespace was pre-created for WP-10; `savedViews` (top level) is WP-49's; WP-07 and WP-08 used `common.<part>` for shared parts; `dataTable.*` keys exist for counts, load progress, Updating and sort words | Three new sub-objects under `common`, all added in T0: `dataTableList`, `savedViewMenu`, `dateRange` (section 2.4). Existing keys are read, never edited: `dataTable.count`, `dataTable.loadProgress`, `dataTable.updating`, `dataTable.sortAscending`, `dataTable.sortDescending`, `common.cancel`, `common.weekdays.*` |
| C18 | DS19 6.7 rule 3: "No checkbox, no inline row actions" in the list; WB-BLK-03 "Select all N matching" is DROP for now | The list has no selection and no row menu; the bulk bar and "Select all N matching" stay table-only. A person who needs bulk actions on a narrow non-touch screen switches to Table |
| C19 | `infra/dev/wp-status` prints `tasks n/t`; the brief's line says `steps n/5`, the coordinator `steps n/6` | `--tasks n/6` to the script; the SendMessage line says `steps n/6` (T0 to T5) |
| C20 | Brief step 0: "Opus writes the plan and commits it"; the planning agent writes the file only | The session commits this file as `WP-10: detailed task plan` before the T0 commit, in the first push |

### 1.5 Deliberately skipped (one line each)

- `12w` preset and week snapping (C8, F7). Comparison range (C14). Bottom sheet for the picker on phones (C7, F6).
- Persisted list or table choice (C2, F2). Link rows (C3, F3). `DataTable` switching by itself (C1, F1).
- The mobile filter sheet (C6, F5). "Include date window" in a view and missing-reference warnings: WP-49 (the
  menu has a `notice` prop for the latter).
- Seed views of Prompts, Citations, Rankings (DS23 14): each page package passes its own presets.

## 2. Interfaces

All strict TypeScript: no `any`, no casts in source (`as Route` only in tests, and no hrefs are needed here),
explicit return types, `readonly` arrays, `| undefined` on optional props (the repo's
`exactOptionalPropertyTypes` style). Every visible string comes from a prop or from `common.*` (T0); numbers and
dates only through `@/lib/format` (`formatInteger`, `formatBusinessDate`, `formatDateRange`, `formatMonth`);
no `Intl`, `toLocaleString` or date-fns `format` in these files. No component reads the clock: `today` is a prop.

### 2.1 `data-table/data-table-list.tsx` (SC-04)

```ts
import type { ReactElement, ReactNode } from 'react';
import type { DataTableColumn, ServerPaging, TableStatus } from './types';
import type { SortKey } from '@/lib/tables/table-state';

/** Rows are 56 px (two 20 px lines and 8 px padding, 19 section 6.7 rule 1): `min-h-14`, fixed for the window. */
export const LIST_ROW_HEIGHT = 56;
/** The layout class of the list (19 section 2) and touch-primary (19 section 1.1). */
export const LIST_MEDIA = '(width < 48rem)';
export const TOUCH_MEDIA = '(pointer: coarse) and (hover: none)';

/** Line 1: who the row is, and its primary value. */
export interface ListLine1 {
  /** Plain text, one line with an ellipsis; spoken in full. */
  identity: string;
  /** The desktop column's cell (MetricCell, RankCell), right aligned, `shrink-0`. */
  value: ReactNode;
  /** The column header, spoken before the value: "Mention rate". */
  valueLabel: string;
}

/** Line 2: context, and the change of the primary value. */
export interface ListLine2 {
  /** "Technical SEO, 3 engines". Plain text, one line with an ellipsis. */
  context: string;
  /** `Delta` or the rank change cell, which carry their own spoken text; `null` shows nothing (never a 0). */
  delta: ReactNode | null;
}

export interface DataTableListProps<TRow> {
  /** "Prompts": the list's name, with the count: "Prompts, 412 results". */
  caption: string;
  itemNoun: { one: string; other: string };
  /** The table's columns: the list sorts with their `sortValue`, the sort menu lists the sortable ones. */
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  /** Rows the filters match; `null` when unknown (the count line then says what is loaded). */
  total: number | null;
  getRowId: (row: TRow) => string;
  sort: readonly SortKey[];
  search: string;
  /** Client mode: the text a search looks in (the same function the table gets). */
  searchText?: ((row: TRow) => string) | undefined;
  /** Server mode: rows come sorted and searched; the list shows them as given and offers Previous and Next. */
  server?: ServerPaging | undefined;
  loadProgress?: { loaded: number; total: number } | null | undefined;
  line1: (row: TRow) => ListLine1;
  line2: (row: TRow) => ListLine2;
  /** Opens the record in the inspector (a full-screen sheet below 768 px). */
  onRowOpen: (row: TRow) => void;
  activeRowId?: string | null | undefined;
  /** The ids in the list's order each time it changes, for `useInspectorStepping` (as `DataTable`). */
  onRowOrderChange?: ((ids: readonly string[]) => void) | undefined;
  status: TableStatus;
  errorState: ReactNode;
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
  /** In the count line after the count: "Updated 12m ago", or a stale or partial notice from the caller. */
  footerNote?: string | undefined;
  /** The sticky row above the list: `DataTableListSort` and, when `canSwitch`, `ListTableSwitch`. */
  toolbar?: ReactNode;
}
export function DataTableList<TRow>(props: DataTableListProps<TRow>): ReactElement;

export type ListMode = 'list' | 'table';
export interface ListModeState {
  mode: ListMode;
  /** The layout is mobile and the device is not touch-primary: offer "List / Table". */
  canSwitch: boolean;
  onModeChange: (mode: ListMode) => void;
}
/** `list` below 768 px unless the person chose Table; Table again from 768 px. Server and hydration: `table`. */
export function useListMode(): ListModeState;

export interface ListTableSwitchProps {
  mode: ListMode;
  onModeChange: (mode: ListMode) => void;
}
/** `SegmentedControl semantics="view" size="sm"`, label "Layout", items List and Table. */
export function ListTableSwitch(props: ListTableSwitchProps): ReactElement;

export interface DataTableListSortProps<TRow> {
  columns: readonly DataTableColumn<TRow>[];
  sort: readonly SortKey[];
  onSortChange: (sort: readonly SortKey[]) => void;
}
/** `Menu` with a radio group of the sortable columns and a radio group Ascending, Descending; the trigger
 * (36 px secondary, `ArrowUpDown` icon) reads "Sort: Mention rate". Choosing a column keeps the direction;
 * the list sorts by one key (the table's second key is dropped while the list is shown, never written). */
export function DataTableListSort<TRow>(props: DataTableListSortProps<TRow>): ReactElement;
```

Render and behaviour:

- Region: `div[data-slot="data-table-list"]`, the same bounded height as the table region (`min-h-0 flex-1`),
  `overflow-y-auto`; a sticky first row holds `toolbar` and the count line (`type-meta num`: "412 prompts", or
  `dataTable.loadProgress` while partial; with a `footerNote` both go through the existing `dataTable.footerNote`
  message, as the table's footer does, never concatenated in JSX).
- Rows: `ul aria-label="{caption}, {count} results"` (`common.dataTableList.label`), `divide-y
  divide-border-subtle`; each `li` has `aria-setsize` (total of the list) and `aria-posinset` (1-based); inside, one
  `button type="button"` `w-full min-h-14 px-3 py-2 text-left flex flex-col gap-0` with `hover:bg-surface-hover`,
  `focus-visible:focus-ring-inset`, and for the active row `aria-current="true"` and `bg-surface-selected` with the
  identity in `text-primary-text`. Line 1: `flex items-center gap-3`, identity `min-w-0 truncate
  type-body-strong`, then `span.sr-only` valueLabel, then the value `ml-auto shrink-0 type-body-strong num`. Line 2:
  context `min-w-0 truncate type-meta`, delta `ml-auto shrink-0`. The whole row is 56 px or more: a 44 px touch
  target with room.
- Order: client mode filters by the table's rule (`search.trim().toLocaleLowerCase()` contained in
  `searchText(row).toLocaleLowerCase()`; `shortcut: copies DataTable's one-line search rule, upgrade when F1 makes
  DataTable own the list`) and sorts with `useSortedRows({ rows, columns, sort: sort.slice(0, 1), manual: server
  !== undefined, getRowId })`. Server mode keeps the order given.
- Windowing: above `WINDOW_FROM` rows, `rowWindow` and `rangeGaps` from `@/lib/tables/row-window` with
  `rowHeight: LIST_ROW_HEIGHT`, the region's `scrollTop` and `clientHeight`; `keep` holds the active row and the
  focused row, so focus and the "back to the same row" rule (19 6.7 rule 5) hold. Spacers are `li
  aria-hidden="true"` with an inline height style, as the table does.
- Keyboard: Tab and Shift Tab move row to row (native buttons); Enter and Space open. No roving focus, no
  single-key shortcut. After the inspector closes the row gets focus back from the inspector's own return
  rule; the list scrolls the active row into view on mount (`scrollToRow`).
- States: `loading`: `role="status"` named `common.dataTableList.loading` ("Loading prompts") holding 8 skeleton
  rows of two `Skeleton shape="text-14"` lines inside the 56 px frame, no spinner; `error`: `errorState`;
  `empty`: `emptyState`; `filtered-empty` or no rows after search: `filteredEmptyState`; `refetching`: previous
  rows at full opacity, `aria-busy="true"` on the `ul`, a 2 px `bg-primary` bar under the sticky row
  (`data-slot="list-refetch-bar"`) and `dataTable.updating` after 400 ms in the count line, as the table; partial
  (`loadProgress`): the count line says "Loading 1,200 of 4,812 prompts"; stale: the caller's `footerNote`.
- Server mode: Previous and Next `Button size="sm"` under the list with `server.rangeText`.

### 2.2 `views/` (SC-06)

```ts
// views-model.ts (pure)
/** URL values a view sets for the screen's view keys; a key it does not list is cleared. */
export type ViewParams = Readonly<Record<string, string>>;

export interface SavedView {
  /** `default` for the built-in default (no params); a slug for a preset; the API id for a stored view. */
  id: string;
  name: string;
  kind: 'preset' | 'stored';
  /** Stored views only (WP-49): the menu groups them under Workspace views and Your views. */
  scope?: 'workspace' | 'personal' | undefined;
  params: ViewParams;
}
export const DEFAULT_VIEW_ID = 'default';

/** The current values of the view keys, as nuqs gives them (`null` for absent). */
export type ViewState = Readonly<Record<string, string | null>>;

/** The view the URL names (`view` key, `default` when absent or unknown) and whether the view keys differ from it. */
export function matchView(
  views: readonly SavedView[],
  viewId: string | null,
  state: ViewState,
  viewKeys: readonly string[],
): { view: SavedView; edited: boolean };

/** What applying `view` writes: every view key (its value or `null`) and `view` (`null` for the default). */
export function viewParams(view: SavedView, viewKeys: readonly string[]): Record<string, string | null>;

/** How many view keys `view` sets: "3 filters" in the announcement. */
export function viewChangeCount(view: SavedView): number;
```

```ts
// use-saved-view.ts
export interface UseSavedViewOptions {
  views: readonly SavedView[];
  /** The URL keys a view governs on this screen; never `inspect`, `itab`, `win`, `from`, `to`. */
  viewKeys: readonly string[];
}
export interface SavedViewState {
  view: SavedView;
  edited: boolean;
  /** Writes `viewParams` through nuqs: `view` with history push, the view keys in the same update. */
  apply: (view: SavedView) => void;
  /** Applies the current view again (Reset to {view}). */
  reset: () => void;
}
export function useSavedView(options: UseSavedViewOptions): SavedViewState;
```

```ts
// saved-view-menu.tsx
/** The persistence seam: WP-49 passes it with stored views; absent, the menu offers views and Reset only. */
export interface SavedViewActions {
  /** `useCan('views:write')`, read by WP-49's hook, never by the menu. */
  canSaveWorkspace: boolean;
  onSave?: (() => void) | undefined;              // only when the current view is stored and edited
  onSaveAs: (name: string, scope: 'workspace' | 'personal') => void;
  onRename: (view: SavedView, name: string) => void;
  onDelete: (view: SavedView) => void;
  onSetDefault: (view: SavedView) => void;
  onShare?: ((view: SavedView) => void) | undefined;
}

export interface SavedViewMenuProps {
  views: readonly SavedView[];
  current: SavedView;
  edited: boolean;
  onApply: (view: SavedView) => void;
  onReset: () => void;
  actions?: SavedViewActions | undefined;
  /** "1 filter no longer exists" (WP-49): a warning line in the menu header and in the trigger's description. */
  notice?: string | null | undefined;
}
export function SavedViewMenu(props: SavedViewMenuProps): ReactElement;
```

Render and behaviour: trigger `Button variant="secondary" size="sm"` (32 px, DS25 7.7), `ChevronDown` trailing; text
"View" in `text-foreground-tertiary`, then the view name (`truncate`, `max-w-48`), then "(edited)" in
`text-foreground-tertiary` when edited. The trigger's accessible name is the visible text with a prefix
(`common.savedViewMenu.name`: "Saved view: Default" or `nameEdited`: "Saved view: Default, edited"), which
contains the visible words (WCAG 2.5.3). `Menu` items: group "Presets" (`kind: 'radio'`, `checked` on the current
view, the default first), then groups "Workspace views" and "Your views" when stored views exist, then an action
group: "Reset to {view}" (only when edited; `RotateCcw` icon) and, with `actions`, the items WP-49 fills (the
labels are WP-49's; the seam's callbacks are named here so the menu's item order is fixed now). Applying a view
closes the menu, returns focus to the trigger (Base UI) and calls `announce(t('applied', { name, count }), { key:
'saved-view' })` ("View Branded prompts applied, 1 filter"). Keyboard: Base UI Menu (Enter, Space and Down open;
arrows, Home, End and typeahead move; Enter selects; Escape closes). Permissions: none read here (C15).

### 2.3 `date-range/` (SC-08, WB-NAV-06)

```ts
// business-date.ts (pure; project days as "YYYY-MM-DD", arithmetic in UTC so a clock change moves no day)
export type BusinessDate = string;
export function isBusinessDate(value: string): boolean;             // shape and a real calendar day
export function addDays(date: BusinessDate, days: number): BusinessDate;
export function addMonths(date: BusinessDate, months: number): BusinessDate; // clamps the day (Jan 31 + 1 = Feb 28)
export function daysInclusive(from: BusinessDate, to: BusinessDate): number; // Nov 1 to Nov 1 is 1
/** 0 for Monday to 6 for Sunday (ISO). */
export function weekdayIndex(date: BusinessDate): number;
export function monthStart(date: BusinessDate): BusinessDate;
/** The month's days in weeks of 7, Monday first; `null` before the 1st and after the last (outside days hidden). */
export function monthWeeks(month: BusinessDate): readonly (readonly (BusinessDate | null)[])[];
```

```ts
// range-model.ts (pure)
export const MAX_RANGE_DAYS = 92;
export const RANGE_PRESETS = ['7d', '28d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const DEFAULT_PRESET: RangePreset = '28d';
export const PRESET_DAYS: Readonly<Record<RangePreset, number>> = { '7d': 7, '28d': 28, '90d': 90 };

export type DateRangeValue =
  | { kind: 'preset'; preset: RangePreset }
  | { kind: 'custom'; from: BusinessDate; to: BusinessDate };
export interface ResolvedRange { from: BusinessDate; to: BusinessDate; days: number }

/** A preset ends on `today`, both ends included; a custom range is itself. */
export function resolveRange(value: DateRangeValue, today: BusinessDate): ResolvedRange;

export interface RangeLimits {
  today: BusinessDate;
  /** The first day with data, when known. */
  earliest?: BusinessDate | null | undefined;
  maxDays?: number | undefined;   // default MAX_RANGE_DAYS
}
export type RangeProblem =
  | { code: 'invalid'; field: 'from' | 'to' }
  | { code: 'order' }
  | { code: 'future'; today: BusinessDate }
  | { code: 'before_start'; earliest: BusinessDate }
  | { code: 'too_long'; days: number; max: number };
/** The first problem of a typed or picked range, in this order: invalid, order, future, before start, too long. */
export function checkRange(from: string, to: string, limits: RangeLimits): RangeProblem | null;
/** The last day an end may be while only `from` is picked: the earlier of today and from + max - 1. */
export function lastEnd(from: BusinessDate, limits: RangeLimits): BusinessDate;

/** URL form (DS23 15): `win=7d|28d|90d`, or `from` and `to`. The default preset writes nothing. */
export interface RangeParams { win: string | null; from: string | null; to: string | null }
export function writeRangeParams(value: DateRangeValue): RangeParams;
/** Never throws: an unreadable or refused range falls back to the default with the reason (13 section 5). */
export function readRangeParams(
  params: RangeParams,
  limits: RangeLimits,
): { value: DateRangeValue; dropped: RangeProblem | null };
```

```ts
// use-date-range-params.ts
export interface UseDateRangeParamsOptions extends RangeLimits {
  /** A key a page used before `win` (Topics & Prompts: `window` with 7, 28, 90): read once as `win`. */
  legacyWindowKey?: string | undefined;
}
export interface DateRangeParamsState {
  value: DateRangeValue;
  range: ResolvedRange;
  /** Why the link's range was not used, for the page's notice; `null` when it was. */
  dropped: RangeProblem | null;
  onValueChange: (value: DateRangeValue) => void;   // nuqs, history replace; clears the legacy key
}
export function useDateRangeParams(options: UseDateRangeParamsOptions): DateRangeParamsState;
```

```ts
// month-grid.tsx
export interface MonthGridProps {
  /** Any day of the month shown. */
  month: BusinessDate;
  /** The picked start and end (end null while only a start is picked); `hover` previews the end. */
  from: BusinessDate | null;
  to: BusinessDate | null;
  hover?: BusinessDate | null | undefined;
  /** Days outside `min` to `max` are disabled and not focusable. */
  min: BusinessDate | null;
  max: BusinessDate;
  today: BusinessDate;
  /** The roving focus day (one Tab stop in all the months shown). */
  focusDay: BusinessDate;
  onFocusDayChange: (day: BusinessDate) => void;   // the picker moves the shown months when it leaves them
  onPick: (day: BusinessDate) => void;
  onHover?: ((day: BusinessDate | null) => void) | undefined;
}
export function MonthGrid(props: MonthGridProps): ReactElement;
```

```ts
// date-range-picker.tsx
export interface DateRangePickerProps extends RangeLimits {
  value: DateRangeValue;
  onValueChange: (value: DateRangeValue) => void;
  /** The project's IANA zone, for the zone note "Dates in Europe/Berlin" (`today` is already a day of it). */
  timeZone: string;
  /** `md` (36 px) in the top bar, `sm` (32 px) in forms. Default `md`. */
  size?: 'sm' | 'md' | undefined;
}
export function DateRangePicker(props: DateRangePickerProps): ReactElement;
```

Render and behaviour:

- Trigger: `Button variant="secondary"`, leading `Calendar` (`text-foreground-tertiary`, hidden below `sm`),
  trailing `ChevronDown`. Visible label: from 640 px the preset name ("Last 28 days") or `formatDateRange(from, to)`;
  below 640 px `common.dateRange.short` ("28d", custom "45d"), both rendered and switched with `hidden sm:inline` /
  `sm:hidden` (CSS, no hydration difference). Name: `sr-only` "Date range: " + the visible label + `sr-only` ", Oct
  17 to Nov 13, 2026" (the resolved dates), so the visible text is inside the name. Tooltip
  (`purpose="label"`, bottom): the resolved dates and the zone note.
- Popover: `title` none, `aria-label` "Date range" (`common.dateRange.label`), `padding="list"`, `align="end"`.
  Presets only: `width="content"`, `className="w-44 min-w-0"`. Custom pane: `width="date-range"`,
  `className="w-auto"` (C7). Opening moves focus to the selected preset button (`initialFocus`), closing returns
  it to the trigger (Base UI).
- Presets column (`w-44` from `md`, full width below): a `type-meta` "Presets" heading and one `button` per preset
  and "Custom range" (`h-control-sm`, `Check` on the applied one, `aria-pressed` on the applied one, "Custom
  range" with `ChevronRight` and `aria-expanded`). A preset applies and closes; "Custom range" opens the pane and
  moves focus to "Start date".
- Custom pane (`border-subtle` hairline: `md:border-l`, `max-md:border-t`): `fieldset` with `legend` "Custom range"
  (`sr-only`); two `Input size="sm"` (`w-32`, `inputMode="numeric"`, `autoComplete="off"`, `placeholder`
  `common.dateRange.placeholder` "YYYY-MM-DD", `type-input-touch` below `md`), labels "Start date" and "End date",
  validated on blur with `checkRange` (`aria-invalid` and the message as `aria-describedby`); the note line
  (`type-meta`, `id` used as the Apply button's description): the problem text in `text-negative-text` when there is
  one, else `common.dateRange.limit` ("A range is at most 92 days."), else while only a start is picked
  `endLimited` ("End dates after Jan 31, 2027 are not available, because a range is at most 92 days."); then the
  months: Previous and Next month `IconButton size="icon-sm"` (disabled at `earliest` and at today's month), a
  `flex gap-4` of `MonthGrid` for the month before the end and the end's month (the first `max-md:hidden` so a phone
  shows the end's month); then a footer row: the zone note `common.dateRange.zone` ("Dates in Europe/Berlin",
  `type-meta`), Cancel (`Button variant="ghost" size="sm"`, `common.cancel`) and Apply (`Button size="sm"`,
  disabled while `checkRange` reports a problem or the range is incomplete). Apply calls `onValueChange({ kind:
  'custom', from, to })` (a custom range equal to a preset stays custom: the person chose dates) and closes.
  Escape or Cancel closes without change.
- Day picking: the first pick sets `from` (and clears `to`); the second pick sets `to` (or, before `from`, swaps);
  days after `lastEnd(from)` are disabled while only `from` is picked; typing in an input moves the shown months to
  that day.
- `MonthGrid`: caption `formatMonth(year, month)` as the grid's `aria-label` and a visible `type-subsection-title`
  line (`aria-hidden`); `table role="grid"`, header `th scope="col" abbr={weekday}` with
  `common.dateRange.weekdaysShort.*` ("Mo"); each day a `td role="gridcell" aria-selected` holding a `button
  type="button"` (`size-8 rounded-md type-body num`, `tabIndex` 0 only on `focusDay`), named
  `common.dateRange.day` ("{weekday}, {date}", weekday from `common.weekdays.*`, date `formatBusinessDate`) with
  `aria-current="date"` on today; states per DS10 10.1 (edges `bg-primary text-primary-foreground`, in range
  `bg-primary-subtle rounded-none`, today `text-primary-text type-body-strong`, disabled
  `text-foreground-disabled`, `disabled` attribute so it is not focusable). Keys: Left, Right one day; Up, Down
  one week; Page Up, Page Down one month; Shift with them one year; Home, End to Monday and Sunday; a move that lands
  on a disabled day stops at the nearest enabled day in that direction (or stays); Enter and Space pick (native
  button).

### 2.4 Messages (T0, `apps/web/messages/en.json`, additive, inside `common` only)

```json
"dataTableList": {
  "label": "{caption}, {count, plural, one {# result} other {# results}}",
  "loading": "Loading {caption}",
  "layout": "Layout",
  "list": "List",
  "table": "Table",
  "sort": "Sort: {column}",
  "sortNone": "Sort",
  "sortBy": "Sort by",
  "direction": "Direction"
},
"savedViewMenu": {
  "view": "View",
  "edited": "(edited)",
  "name": "Saved view: {name}",
  "nameEdited": "Saved view: {name}, edited",
  "default": "Default",
  "presets": "Presets",
  "workspace": "Workspace views",
  "personal": "Your views",
  "reset": "Reset to {name}",
  "applied": "View {name} applied, {count, plural, =0 {no filters} one {# filter} other {# filters}}"
},
"dateRange": {
  "label": "Date range",
  "namePrefix": "Date range:",
  "presets": "Presets",
  "lastDays": "Last {days, number} days",
  "short": "{days, number}d",
  "custom": "Custom range",
  "from": "Start date",
  "to": "End date",
  "placeholder": "YYYY-MM-DD",
  "previousMonth": "Previous month",
  "nextMonth": "Next month",
  "zone": "Dates in {zone}",
  "apply": "Apply",
  "limit": "A range is at most {max, number} days.",
  "endLimited": "End dates after {date} are not available, because a range is at most {max, number} days.",
  "tooLong": "{days, number} days is longer than the {max, number} day limit. Pick a later start date or an earlier end date.",
  "beforeStart": "Data starts on {date}, so earlier dates are not available.",
  "future": "Dates after today, {date}, are not available.",
  "invalid": "Enter the date as YYYY-MM-DD.",
  "order": "The start date is after the end date.",
  "droppedTooLong": "The link asked for more than {max, number} days, so the last 28 days are shown.",
  "droppedInvalid": "The dates in the link could not be read, so the last 28 days are shown.",
  "day": "{weekday}, {date}",
  "weekdaysShort": { "monday": "Mo", "tuesday": "Tu", "wednesday": "We", "thursday": "Th", "friday": "Fr", "saturday": "Sa", "sunday": "Su" }
}
```

`server.rangeText` is preformatted by the caller and needs no key. A key that turns out unused after T0 is pushed
stays (harmless) and T5 lists it. Dates in
messages are preformatted strings (`formatBusinessDate`); `{count}` and `{days}` are numbers. The messages test
(`src/i18n/messages.test.ts`) passes on these: no straight double quotes, no dashes as punctuation (the hyphens of
`YYYY-MM-DD` are not spaced), no contraction of "not", camelCase keys.

## 3. Tasks

Rules for every task:

- Tests first: write the test file, run it, watch it fail for the reason the task names (module not found counts
  only for a new file; then the first behaviour assertion), then implement. Each guard (the 92 day cap, the
  future and data start limits, the touch-primary rule, the edited comparison) is proven to bite: the reviewer
  weakens it in the working tree (never committed), reruns the test, records the failing test name, restores it.
- File tools only (Write, Edit). No shell heredocs, `sed`, `python` or replace scripts. Edit only the task's files.
- Tokens and the 15 type utilities only; no hex, no palette classes, no arbitrary values (`[...]`), spacing steps
  0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 only (`eslint.config.mjs` `ALLOWED_STEPS`), no weight classes
  (`FONT_WEIGHT`: use `type-body-strong`), named or numeric sizes only for height, width and size, breakpoints only
  as `sm:`, `md:`, `max-md:` and the like (no `min-[...]`). `num` on every number. ASCII copy and comments, no em or
  en dashes (`src/test/source-text.test.ts` reads comments). No `dangerouslySetInnerHTML`.
- No casts in source; `as Route` only in tests. Dates in tests are pinned: every component and hook takes `today`
  as a prop; a test that renders a screen through its harness uses the harness's pinned clock; nothing reads
  `new Date()` in these files.
- Tests: `renderWithProviders` from `@/test/render` (it has the nuqs testing adapter; assert URL writes through
  its `onUrlUpdate`), `axe` from `@/test/axe` (each component test runs it once on its richest state), `user` from
  the render result, `vi.stubGlobal('matchMedia', ...)` for `LIST_MEDIA` and `TOUCH_MEDIA` (as `registry.test.tsx`).
- Commands from the worktree root. One file, light, no lock: `pnpm --dir apps/web exec vitest run <path from
  apps/web>`. A folder, lint, types, format: medium lane (below). Never plain `pnpm test`, `pnpm build`, `pnpm lint`,
  `pnpm typecheck` or `pnpm e2e`.
- The session commits after the reviewer's PASS: `git add <the task's paths>` then `git commit -m "WP-10:
  <title>"`. No attribution lines, no dashes. Never stage another session's files (`git status` first:
  `apps/web/e2e/flows/rankings.spec.ts` is another agent's and stays unstaged).
- Reviewer (fresh Sonnet per task): reads this plan, the task and `git diff`, runs the task's test command and the
  medium LINT and TYPES, greps the diff for ` as ` (casts), `any`, `dangerouslySetInnerHTML`, `#[0-9a-fA-F]{3}`,
  `-\[`, `\[.*px\]`, `font-(medium|semibold|bold)`, `new Date(`, `Intl\.`, U+2013 and U+2014, does the
  prove-it-bites step, and returns PASS or a numbered fix list; the implementer (the same subagent, resumed with
  SendMessage) fixes, the reviewer re-checks.

Medium lane commands (used below as LINT, TYPES, FORMAT, FOLDER):

```bash
infra/dev/heavy --lane medium --label wp10-lint -- bash -c 'cd apps/web && pnpm lint'
infra/dev/heavy --lane medium --label wp10-types -- bash -c 'cd apps/web && pnpm typecheck'
infra/dev/heavy --lane medium --label wp10-format -- bash -c 'cd apps/web && pnpm format:check'
infra/dev/heavy --lane medium --label wp10-<folder> -- bash -c 'cd apps/web && pnpm exec vitest run <folder> --maxWorkers=2'
```

Order and parallelism (at most 2 subagents at once, disjoint files):

| Wave | Subagents | Files |
|---|---|---|
| 0 | none (the session) | T0 |
| A | T1 implementer and T2 implementer, then T1 reviewer and T2 reviewer | `data-table/data-table-list*` (T1) and `views/` (T2) |
| B | T3a implementer, then its reviewer (one slot stays free for fixes of A) | `date-range/` |
| C | T3b implementer (after the lease) and T4 implementer, then their reviewers | `features/prompts/*` (T3b) and `design-system/controls-section.tsx`, `e2e/flows/ai-controls.spec.ts` (T4) |
| D | the session (T5), then the final whole-package reviewer | docs, rebase, checks |

T1, T2 and T3a share no file and import nothing from each other. T3b needs T3a; T4 needs T1, T2 and T3a. If the
T3b lease is not granted by wave C, T4 runs alone and T3b waits (WB-NAV-06 stays open, section 5).

### T0: early registry line and message keys (the session)

Goal: everything later tasks share is on develop first, so parallel tasks never touch `en.json` or the registry.

Files:
- `apps/web/messages/en.json`: the three `common` sub-objects of section 2.4, appended after
  `common.inspectorStepping` (additive). Ask the coordinator first to confirm the `en.json` lease covers
  `common.dataTableList`, `common.savedViewMenu`, `common.dateRange` (the recorded lease names WP-06's keys).
- `apps/web/src/components/design-system/registry.ts`: import `ControlsSection` from `./controls-section` and append
  `{ slug: 'controls', title: 'Lists, views and dates', render: ControlsSection }` after `domains-feeds`.
- `apps/web/src/components/design-system/section-slugs.ts`: append `'controls'`.
- `apps/web/src/components/design-system/registry.test.tsx`: append `'controls'` to the expected list.
- `apps/web/src/components/design-system/controls-section.tsx` (stub): `'use client'`, exports
  `ControlsSection(): ReactNode` returning one `SpecimenGroup title="Lists, views and dates" note="Filled by
  WP-10."` with one line of `type-body` text (the registry test needs a `section` with an `h2`).
- `docs/superpowers/plans/2026-11-13-ai-wp-10-controls.md` (this plan), as its own commit first.

Tests: `registry.test.tsx` (19 slugs; the stub renders axe clean in both themes) and `messages.test.ts`. The
registry test fails first on the slug list once its line is added and before the registry line is.

Commands: `pnpm --dir apps/web exec vitest run src/components/design-system/registry.test.tsx
src/i18n/messages.test.ts`, then LINT, TYPES, FORMAT. Rows: none (process). Commits: `WP-10: detailed task plan`,
then `WP-10: gallery slot and message keys`. Then `git fetch origin && git rebase origin/develop`, rerun the two
tests, `git push origin HEAD:develop`, report `building` (section 5). Model: the Opus session. The shared registry
lease stays with the current package (coordinator's rule); on a rebase conflict keep every slug in order.

### T1: DataTableList (SC-04)

Goal: two-line rows under 768 px with the table's order, states and switch (section 2.1).

Files: `apps/web/src/components/app/data-table/data-table-list.tsx`,
`apps/web/src/components/app/data-table/data-table-list.test.tsx`.

Tests first (`data-table-list.test.tsx`, a fixture of 6 prompt-like rows with `col.*` columns, one with `null`
value, one with no delta):
- Markup: one `ul` named "Prompts, 6 results"; 6 `li` with `aria-setsize="6"` and `aria-posinset` 1 to 6; each holds
  one `button`; the first button's accessible name is "<identity> Mention rate 42% <context> <delta text>" (the
  order of DS20 6.8); the row with no delta renders no delta node and no "0".
- Order: rows follow `sort` (descending Mention rate puts the `null` value last, as `useSortedRows` does) and
  `search` (only matching rows, `filteredEmptyState` when none); `onRowOrderChange` is called with the shown ids in
  order and again after a sort change; server mode keeps the given order.
- Open: clicking, Enter and Space on a row call `onRowOpen` with that row; `activeRowId` sets `aria-current="true"`
  and the selected classes on that row only.
- Keyboard: Tab from the toolbar goes to row 1, then row 2 (every row is a tab stop).
- States: `loading` has `role="status"` named "Loading prompts" and skeleton rows, no spinner; `error`, `empty`,
  `filtered-empty` render their slots; `refetching` keeps the rows, sets `aria-busy` and renders the refetch bar;
  `loadProgress` shows "Loading 3 of 6 prompts" in the count line; `footerNote` follows the count.
- Windowing: 150 rows render fewer than 150 `li` buttons, spacers are `aria-hidden`, and the active row is in the
  document even when it is row 140.
- `useListMode` (a harness component): wide (`LIST_MEDIA` false) gives `table` and `canSwitch` false; narrow and
  touch gives `list`, `canSwitch` false; narrow and not touch gives `list`, `canSwitch` true, and
  `onModeChange('table')` gives `table`; growing past 768 px while Table is chosen gives `table` and shrinking
  again gives `list` (the choice resets when the layout class changes). Fails first because the module is absent,
  then on the touch rule (the guard proven to bite).
- `ListTableSwitch`: a radio group named "Layout" with List and Table; choosing Table calls `onModeChange('table')`.
- `DataTableListSort`: trigger "Sort: Mention rate" for `[{ id: 'mention', desc: true }]`; the menu lists only the
  columns with `sortValue`; choosing Prompt calls `onSortChange([{ id: 'prompt', desc: true }])`; choosing
  Ascending calls it with `desc: false`.
- axe clean on the ready list with the toolbar.

Implementation notes: reuse `useSortedRows`, `rowWindow`, `rangeGaps`, `scrollToRow`, `WINDOW_FROM` from
`@/lib/tables/row-window`, `Skeleton`, `Menu` (`kind: 'radio'` items, `group`), `SegmentedControl`, `Button`,
`Icon`, `formatInteger`, `useMediaQuery` (with `LIST_MEDIA` and `TOUCH_MEDIA`), `useTranslations('common.dataTableList')`
and `useTranslations('dataTable')` (read only). The "Updating" text after 400 ms copies the table's timer
pattern (`data-table.tsx` around line 882). Keep the file under about 400 lines; split nothing out (the brief owns
this one file).

Commands: `pnpm --dir apps/web exec vitest run src/components/app/data-table/data-table-list.test.tsx`, then
`infra/dev/heavy --lane medium --label wp10-table -- bash -c 'cd apps/web && pnpm exec vitest run src/components/app/data-table --maxWorkers=2'`
(nothing else in the folder may change), LINT, TYPES, FORMAT.

Row closed: SC-04 (the gallery entry follows in T4). Reviewer checklist: no edit outside the two files; no
checkbox, no row menu; 56 px rows; spoken order identity, value label, value, context, delta; unknown value
never "0"; `aria-setsize` and `aria-posinset` on every `li`; touch-primary hides the switch; server render
answers `table`; the search rule matches `data-table.tsx` exactly. Commit: `WP-10: DataTableList mobile list rows
with the list and table switch`. Model: Sonnet. Parallel with T2.

### T2: SavedViewMenu with presets (SC-06)

Goal: presets that map to URL states, the edited state, Reset, the announcement and the persistence seam
(section 2.2).

Files (under `apps/web/src/components/app/views/`): `views-model.ts`, `views-model.test.ts`, `use-saved-view.ts`,
`use-saved-view.test.tsx`, `saved-view-menu.tsx`, `saved-view-menu.test.tsx`.

Tests first:
- `views-model.test.ts` (views: Default, Branded prompts `{ branded: 'only' }`, Uncited `{ cited: 'no', sort:
  '-mention' }`; `viewKeys` `['branded', 'cited', 'sort', 'q', 'cols', 'density']`): no `view` key and all keys null
  gives Default, not edited; `view=branded` with `branded=only` gives Branded, not edited; with `q=crm` added gives
  Branded, edited; an unknown `view` id gives Default (edited when keys are set); a key outside `viewKeys` (for
  example `inspect`) never makes a view edited; `viewParams(Uncited)` sets `cited`, `sort`, `view` and clears the
  other four; `viewParams(Default)` clears all and sets `view` to null; `viewChangeCount` counts params.
- `use-saved-view.test.tsx` (nuqs testing adapter): `apply(Branded)` writes `view=branded&branded=only` and removes
  `q` in one update, with history push for `view`; `reset()` after an edit restores the view's params; the returned
  `edited` follows the URL.
- `saved-view-menu.test.tsx`: the trigger shows "View", "Default" and no "(edited)", and is named "Saved view:
  Default"; edited shows "(edited)" and the name "Saved view: Branded prompts, edited"; Enter opens the menu with a
  "Presets" group of radio items, the current one checked; choosing Branded calls `onApply` with it, closes the menu,
  returns focus to the trigger and calls `announce` with "View Branded prompts applied, 1 filter" (mock
  `@/lib/a11y/announcer`); "Reset to Branded prompts" appears only when edited and calls `onReset`; stored views with
  `scope` appear under "Workspace views" and "Your views"; without `actions` there is no Save, Rename or Delete item;
  `notice` shows in the menu header and as the trigger's description; a 60 character view name truncates (class
  `truncate`) and stays whole in the accessible name; axe clean with the menu open.

They fail first because the modules do not exist, then on the edited comparison.

Implementation notes: `useQueryStates` with `parseAsString` for `view` and each view key, `{ history: 'replace' }`
for the keys and `history: 'push'` for `view` in the same `setState` call (nuqs takes per-key options:
`parseAsString.withOptions({ history: 'push' })` for `view`). `Menu`, `Button`, `Icon`, `announce`,
`useTranslations('common.savedViewMenu')`. No `useCan` (C15).

Commands: `infra/dev/heavy --lane medium --label wp10-views -- bash -c 'cd apps/web && pnpm exec vitest run src/components/app/views --maxWorkers=2'`,
LINT, TYPES, FORMAT.

Row closed: SC-06 (presets; persistence is WP-49's, CF-14). Reviewer checklist: `inspect`, `itab`, `win`, `from`,
`to` can never be view keys (a test pins that `viewParams` never writes them even if a view lists them);
"(edited)" exactly when a view key differs; announcement once per apply; the seam's types match section 2.2 so
WP-49 adds a hook and no menu edit. Commit: `WP-10: SavedViewMenu with presets`. Model: Sonnet. Parallel with T1.

### T3: DateRangePicker (SC-08) and the top bar wiring (WB-NAV-06)

T3a and T3b are two subagent runs and two commits.

#### T3a: the picker

Files (under `apps/web/src/components/app/date-range/`): `business-date.ts`, `business-date.test.ts`,
`range-model.ts`, `range-model.test.ts`, `use-date-range-params.ts`, `use-date-range-params.test.tsx`,
`month-grid.tsx`, `month-grid.test.tsx`, `date-range-picker.tsx`, `date-range-picker.test.tsx`.

Tests first (today pinned at `'2026-11-13'`, zone `Europe/Berlin`):
- `business-date.test.ts`: `isBusinessDate` refuses `2026-02-30`, `2026-1-01`, `''`; `addDays` across month, year
  and the March and October clock changes of Europe/Berlin and America/New_York gives calendar days (no shift);
  `addMonths('2026-01-31', 1)` is `2026-02-28`; `daysInclusive` same day 1, Aug 14 to Nov 13 92; `weekdayIndex` of
  2026-11-09 (a Monday) is 0; `monthWeeks('2026-11-01')` starts with six nulls (Nov 1, 2026 is a Sunday) and has 30
  days.
- `range-model.test.ts`: `resolveRange` of each preset ends on today and has 7, 28, 90 days; `checkRange` returns,
  in order, `invalid` (typed `2026-13-01`), `order` (from after to), `future` (to after today), `before_start`
  (from before `earliest`), `too_long` for Aug 13 to Nov 13 (93 days) and null for Aug 14 to Nov 13 (92 days, the
  boundary both ways, proven to bite); `maxDays: 91` refuses 92; `lastEnd('2026-09-01')` is `2026-11-13` (today
  first) and `lastEnd('2026-05-01')` is `2026-07-31`; `writeRangeParams` writes nothing for 28d, `win=7d` for 7d,
  `from` and `to` for custom; `readRangeParams` reads them back, falls back to 28d with `too_long` for a 120 day
  link and with `invalid` for `from=abc`, ignores `win=12w` (unknown preset: default, `invalid`).
- `use-date-range-params.test.tsx`: `?win=7d` gives the 7 day range; choosing custom writes `from` and `to` and
  removes `win` with history replace; `legacyWindowKey: 'window'` reads `?window=90` as 90d and the next change
  removes `window`; a dropped link reports its problem once.
- `month-grid.test.tsx`: a `grid` named "Nov 2026" with 7 column headers ("Mo" first, `abbr` "Monday"); Nov 1 is
  in the first row's last cell; days after today are `disabled`; today has `aria-current="date"`; only the focus
  day has `tabindex="0"`; Right from Nov 12 calls `onFocusDayChange('2026-11-13')`, Right from Nov 13 stays (future
  disabled); Page Up from Nov 13 goes to Oct 13, Shift Page Up to 2025-11-13; Home from Thursday Nov 12 goes to
  Monday Nov 9, End to Sunday Nov 15 clamps to Nov 13; Enter on a day calls `onPick`; edge, in-range and today
  classes; the day button is named "Thursday, Nov 12, 2026"; axe clean.
- `date-range-picker.test.tsx`: the trigger is named "Date range: Last 28 days, Oct 17 to Nov 13, 2026" and shows
  "Last 28 days" and "28d" (one hidden by class); opening focuses the applied preset; choosing "Last 7 days" calls
  `onValueChange({ kind: 'preset', preset: '7d' })` and closes; "Custom range" sets `aria-expanded`, shows the
  pane and focuses "Start date"; typing `2026-08-01` and `2026-11-13` shows "105 days is longer than the 92 day
  limit. Pick a later start date or an earlier end date." with Apply disabled and described by it; changing the
  start to `2026-08-14` enables Apply and applying calls `onValueChange({ kind: 'custom', from: '2026-08-14', to:
  '2026-11-13' })`; picking Sep 1 in the grid then hovering shows "End dates after" only when the cap is earlier
  than today (pick May 1 with today Nov 13: "End dates after Jul 31, 2026 are not available..."); `earliest:
  '2026-03-02'` disables Mar 1 and says "Data starts on Mar 2, 2026, so earlier dates are not available." when
  typed earlier; the zone note reads "Dates in Europe/Berlin"; Escape closes without change and focus returns to
  the trigger; the custom popover carries `w-auto` and the presets popover `w-44` (the class contract of C7); two
  month grids are rendered and the first has `max-md:hidden`; axe clean open with the pane.

They fail first because the modules do not exist, then on the first behaviour.

Implementation notes: `Popover` (`initialFocus` ref for the applied preset, `onOpenChange`), `Button`, `IconButton`,
`Input`, `Tooltip`, `Icon` (`Calendar`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `Check`),
`formatBusinessDate`, `formatDateRange`, `formatMonth`, `formatInteger`, `useTranslations('common.dateRange')`,
`useTranslations('common.weekdays')`, `useTranslations('common')` for Cancel. `useQueryStates` with `parseAsString`
for `win`, `from`, `to` and the legacy key, history replace. Pure modules have no React import. Year and month
for `formatMonth` come from splitting the business date string, never from a `Date` in local time.

Commands: `infra/dev/heavy --lane medium --label wp10-dates -- bash -c 'cd apps/web && pnpm exec vitest run src/components/app/date-range --maxWorkers=2'`,
LINT, TYPES, FORMAT.

Row closed: SC-08. Reviewer checklist: no clock read; 92 inclusive days pass and 93 fail; every limit has its
words; future and pre-start days not focusable; one Tab stop in the grids; label in name; no edit of
`ui/popover.tsx`; widths by `className` only; second month hidden by CSS below `md`; ASCII messages. Commit:
`WP-10: DateRangePicker with presets, custom range and the 92 day cap`. Model: Sonnet.

#### T3b: the top bar of Topics & Prompts (lease)

Before dispatch the session asks the coordinator for a lease (section 5): paths
`apps/web/src/features/prompts/prompts-screen.tsx`, `apps/web/src/features/prompts/prompts-scope.tsx`,
`apps/web/src/features/prompts/prompt-model.ts`, `apps/web/src/features/prompts/prompt-model.test.ts`,
`apps/web/src/features/prompts/prompts.test.tsx`; reason: replace the window select (WB-NAV-05) with
`DateRangePicker` in the existing `TopBarPortal` to close WB-NAV-06; WP-17 (the wave 2 holder of
`prompts-screen.tsx`) has not started. Without the lease, T3b is skipped, WB-NAV-06 is reported open with that
reason, and the picker is shown in a top bar specimen in the gallery only.

Files: the five above.

Tests first (`prompts.test.tsx`, the existing harness `renderOnPrompts(withTopBar(...))` and its pinned clock):
- Update "asks the summary for the window in the address": `?window=7` still asks `from=2026-11-06`,
  `to=2026-11-12` (the legacy key), and the top bar button is named "Date range: Last 7 days, Nov 6 to Nov 12, 2026".
- Update "keeps the table on screen while a new window is read": open the date range button, choose "Last 7 days".
- New: `?from=2026-09-01&to=2026-10-31` asks the summary for those dates and the button shows "Sep 1 to Oct 31,
  2026"; a custom range applied through the picker writes `from` and `to` and removes `window`.
- New: `?from=2026-06-01&to=2026-10-31` (153 days) asks for the default 28 days and shows the dropped notice
  ("The link asked for more than 92 days, so the last 28 days are shown.") as the page's existing notice pattern
  does for dropped filters.
- New (R4): the requests that carry the range are listed; if the answers route (`/ai/observations`) receives it,
  the picker gets `maxDays={91}` and a test pins the words "91 day limit"; otherwise 92.
- `prompt-model.test.ts`: tests of removed exports go; `trailingRange` tests stay.

Implementation notes: in `prompts-screen.tsx`, drop `window` from `VIEW_STATE`, call `useDateRangeParams({ today:
formatIsoDate(now, project.timeZone), timeZone..., legacyWindowKey: 'window' })` (today from the existing
`useUtcDay`), take `range` from it (`{ from, to }` keeps the `DateRange` shape the queries take), render
`<DateRangePicker value onValueChange today timeZone={project.timeZone} />` first inside `TopBarPortal`, keep the
caption text for the header tooltip. In `prompts-scope.tsx` delete `PromptsWindowControl`. In `prompt-model.ts`
delete `WINDOW_DAYS`, `WindowDays`, `DEFAULT_WINDOW`, `parseWindow`, `windowRange` once nothing imports them
(grep first); keep `WIDEST_WINDOW` and `trailingRange`. The `prompts.window*` messages stay (other namespaces'
cleanup is not ours; T5 lists them as unused).

Commands: `infra/dev/heavy --lane medium --label wp10-prompts -- bash -c 'cd apps/web && pnpm exec vitest run src/features/prompts --maxWorkers=2'`,
LINT, TYPES, FORMAT.

Row closed: WB-NAV-06. Reviewer checklist: old `?window=` links still work; no other prompts behaviour changed
(the folder's tests all pass unchanged except the two named); the picker is the first control in the slot; the
range reaching every query comes from one place. Commit: `WP-10: date range picker in the top bar of Topics and
Prompts`. Model: Sonnet. Parallel with T4.

### T4: design-system section and e2e flow

Files: `apps/web/src/components/design-system/controls-section.tsx` (replaces the stub),
`apps/web/e2e/flows/ai-controls.spec.ts` (new).

Section content: section 4.

Tests first: write `ai-controls.spec.ts` (it fails against the stub: headings missing). Unit coverage of the
section is `registry.test.tsx` (axe in both themes, every group titled).

The spec (model: `e2e/flows/ai-app-parts-b.spec.ts`, its local `group` helper, `expectAccessible` from
`../support`; page `/design-system/controls`):
1. For light and dark at 390, 768, 1024, 1280: `expectAccessible` (no serious or critical) and
   `document.documentElement.scrollWidth <= clientWidth`.
2. List at 390 (the live specimen renders `useListMode`): a `list` named "Prompts, 6 results"; every row button is
   at least 44 px tall (measure: 56); Tab from the sort button reaches all 6 rows in order; Enter on row 2 marks it
   `aria-current` and shows "Opened: <identity>" in the specimen; no "Layout" control in a context with `hasTouch:
   true, isMobile: true` (`test.describe` with `test.use`); at 640 px without touch the "Layout" control is present,
   Table renders a `grid`, List brings the `list` back.
3. Saved views: focus the trigger, Enter, ArrowDown to "Branded prompts", Enter: the trigger reads "View Branded
   prompts", the URL has `view=branded&branded=only`, the polite live region says "View Branded prompts applied, 1
   filter"; toggle the specimen's "Search crm" button: "(edited)" shows; open the menu, "Reset to Branded prompts":
   "(edited)" goes and `q` leaves the URL.
4. Date range at 320, 360, 390, 768 and 1280: open the trigger, choose "Custom range": the popover's box is inside
   the viewport (left >= 0, right <= innerWidth, bottom <= innerHeight or the popover scrolls inside), its
   `scrollWidth <= clientWidth`; one month grid visible below 768, two from 768.
5. Date range keyboard at 1280: opening focuses "Last 28 days"; Tab to "Custom range", Enter; type `2026-08-01` and
   `2026-11-13`: Apply is disabled and the 105 days reason is visible; change the start to `2026-08-14`: Apply
   enabled; Enter on Apply: the trigger reads "Aug 14 to Nov 13, 2026" and focus is on it. Reopen, Custom range,
   focus a day in the grid, ArrowRight moves focus by one day, PageUp changes the grid caption to the month before,
   from Nov 13 ArrowRight keeps focus on Nov 13; Escape closes and focus returns to the trigger.
6. Top bar specimen at 320 and 390: the bar's `scrollWidth <= clientWidth` with the picker showing "28d".

Commands: TYPES and LINT (the spec is type checked), the registry test (light), then the e2e through the heavy lane
(`lsof -nP -iTCP:3114 -sTCP:LISTEN` must print nothing first; `reuseExistingServer` is on outside CI; pick another
free port, never 3000, 3002, 3004 or 3100, if it is taken):

```bash
E2E_PORT=3114 infra/dev/heavy --label wp10-e2e --wait 30 --max 40 -- \
  bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-controls.spec.ts e2e/flows/design-system.spec.ts'
```

`e2e/flows/ai-prompts.spec.ts` is WP-17's and is not edited; the prompts top bar is checked in the browser
(section 4) and by `prompts.test.tsx`. Pre-existing failures on clean develop (shell, schedules,
costs-runs, keyword-detail specs, F-03) are not WP-10's and are not in this command. Then the browser check of
section 4.

Row closed: none new (the gallery entries for SC-04, SC-06, SC-08). Reviewer checklist: every part in both
densities where it sits in a table; the three phone frames; no cast; `today` a constant; e2e green; browser check
numbers attached. Commit: `WP-10: gallery section and e2e flow for the list rows, views and dates`. Model: Sonnet.
Parallel with T3b.

### T5: As built notes, rebase, final checks, push (the session)

1. `docs/20-frontend-specification.md`: one blockquote "As built (AI visibility controls, WP-10, 2026-11-13, plan
   `docs/superpowers/plans/2026-11-13-ai-wp-10-controls.md`)" at the end of section 4.8 Table conventions, right
   after the WP-08 note (line 411 at `1e163b05`). It lists the files, the props of 2.1 to 2.3 in one line each, the
   decisions C1 to C13 and C15 to C18 that depart from DS19, DS20, DS25 and DS10 (sibling list, switch rules and
   state, button rows, no new top bar slot, trigger kept below 768 px, popover widths by class, presets 7, 28, 90,
   paths, in-house grid, `win` keys with the legacy `window`, the 92 day count and the answers route caveat, the
   three reasons, the persistence seam), the measured numbers of the browser check, the unused message keys (if any)
   and follow-ups F1 to F9. Append one line at the end of 4.3 Saved views and of 4.2 Filter bar: "As built (WP-10):
   see the WP-10 note at the end of 4.8."
2. Ask the coordinator for a lease on `docs/design-system/25-component-inventory.md` to add one append-only "As
   built (WP-10)" line under 4.18, 7.7 and 7.10 (paths, prop differences, the in-house calendar), as WP-07 and WP-08
   did. Without it, the doc 20 note is the record.
3. `git fetch origin && git rebase origin/develop`. `en.json` conflicts: keep both sides, then
   `pnpm --dir apps/web exec vitest run src/i18n/messages.test.ts`. Registry conflicts: keep every slug in order,
   then the registry test. `prompts-screen.tsx` conflicts (if another lease holder pushed): stop and ask the
   coordinator.
4. Final checks: LINT, TYPES, FORMAT (medium), then through the heavy lane, one at a time:

```bash
infra/dev/heavy --label wp10-test --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'
infra/dev/heavy --label wp10-build --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm build'
```

   and the T4 e2e command again if anything changed after it. Before the full suite and the build: no dev server of
   this session is running and `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` do not exist (section 4 step 5).
5. Final reviewer (fresh Sonnet): the whole diff `origin/develop...HEAD` against the brief's acceptance criteria,
   the four rows and this plan; opens `/design-system/controls` and the Topics & Prompts page at 390, 768, 1024,
   1280 in both themes.
6. Commit `WP-10: As built notes`, `git push origin HEAD:develop` (fast-forward only; rejected means back to step
   3), report `merged` (section 5). Model: the session; the reviewer Sonnet.

## 4. The design-system section and the browser check

Slug `controls`, title "Lists, views and dates", file `apps/web/src/components/design-system/controls-section.tsx`,
export `ControlsSection(): ReactNode`. Gallery copy is exempt from the message rule (team only) but stays ASCII.
Fixtures are module constants: `TODAY = '2026-11-13'`, `ZONE = 'Europe/Berlin'`, six prompt rows (one long
identity of 120 characters, one unknown Mention rate shown as `n/a` by `MetricCell`, one with no change, one with a
detectable rise, one with a detectable decline, one undetectable change) built with the real `col.*` helpers and
`MetricCell` and `Delta`. Light and dark come from the gallery's theme control; every group is checked in both by
`registry.test.tsx` (structure) and the e2e (contrast). Specimens that need a viewport class (the live list, the
switch) use the real hooks; frame specimens force the list by rendering `DataTableList` directly.

| Group (`SpecimenGroup` title) | What it shows |
|---|---|
| Mobile list rows at 320, 390 and 768 px | Three fixed frames (`w-80`, `w-97.5`, `w-192`), each inside a `TableScroll` (so a 768 px frame scrolls inside its region on a phone and never widens the page), each holding `DataTableList` with the six rows, the sort menu and the count line; the long identity truncates, the unknown value reads `n/a` |
| Live list or table | The same rows through `useListMode`: below 768 px the list (with the switch when not touch-primary), from 768 px a `DataTable` with the table's own density control (Default 40 px and Compact 32 px rows); row open sets the active row and shows "Opened: <identity>" |
| List states | loading, empty (reason and action), filtered empty, error with Retry, refetching (a button toggles it), partial ("Loading 3 of 6 prompts"), stale (`footerNote` "Updated 3d ago, the last run did not finish") |
| SavedViewMenu | Live on the page URL with presets Default, Branded prompts (`branded=only`), Uncited (`cited=no`, `sort=-mention`), the view keys `branded`, `cited`, `sort`, `q`; a "Search crm" toggle that sets `q=crm` to show "(edited)"; the current address keys shown as text |
| SavedViewMenu states | Static: default, named, edited, a 60 character name, stored views with workspace and personal scope, a `notice` ("1 filter no longer exists") |
| DateRangePicker | Live: `md` with the 28 day preset; a custom range applied (`Sep 1 to Oct 31, 2026`); `earliest` Mar 2, 2026; `maxDays` 91; `sm` size |
| Top bar | A 52 px bar specimen with a breadcrumb text, the picker and a location button, in fixed frames of 320, 390 and 768 px inside `TableScroll`, so the short label "28d" and the room are seen |

Browser check (T4, the T4 subagent or the session, with the Browser tools):

1. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'`: reuse a server of this worktree on 3004 if one runs (match
   the process cwd to this worktree). Never kill another process. If 3004 is taken by another worktree, use a free
   port from 3101 to 3105 and say which.
2. Otherwise start it in the background from the worktree: `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev
   --port 3004`; take the URL from its output.
3. Open `http://localhost:3004/design-system/controls`. For 320, 360, 390, 768, 1024, 1280 (`resize_window`), light
   and dark (`colorScheme`, and the gallery theme control), Default and Compact (the live table's density control),
   run in the page:

```js
({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  listRows: [...new Set([...document.querySelectorAll('[data-slot="data-table-list"] li > button')]
    .map((b) => Math.round(b.getBoundingClientRect().height)))],
  smallTargets: [...document.querySelectorAll('main button, main a, main [role="radio"]')]
    .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); })
    .map((n) => n.getAttribute('aria-label') ?? n.textContent),
});
```

   Expect `overflow` 0, `listRows` `[56]` (44 or more in every case), `smallTargets` empty (24 px minimum, WCAG
   2.5.8). Open the picker, choose Custom range, then run
   `(() => { const p = document.querySelector('[data-slot="popover"]'); const r = p.getBoundingClientRect(); return [r.left, r.right, innerWidth, r.bottom, innerHeight, p.scrollWidth - p.clientWidth]; })()`:
   left >= 0, right <= innerWidth, the last value 0, at 320, 360 and 390 too. Open the saved view menu at 320: its
   box inside the viewport. Then open `http://localhost:3004/<workspace>/<project>/ai/prompts` (the mock's slugs,
   from the sidebar) after T3b: at 320 and 390 the `header` has `scrollWidth <= clientWidth` and the picker reads
   "28d"; at 1280 it reads "Last 28 days"; a custom range changes the summary request (network panel: `from`, `to`).
   Take one screenshot per width and theme of the gallery and look at it (line alignment of value and delta, the
   selected and today days, the hairline between presets and pane, the "(edited)" mark).
4. Stop the server (`preview_stop` or the background shell), then remove the files the dev server writes:
   `git status --porcelain apps/web/AGENTS.md apps/web/CLAUDE.md` must show `??` (untracked) before
   `rm apps/web/AGENTS.md apps/web/CLAUDE.md`; never commit them; do this before any commit or full suite.
5. Reset the Browser pane viewport to `desktop`.

## 5. Status line

Format, at start (`planning`), plan committed (`building`), every push to develop, review start (`review`), blocked
(`blocked`), done (`merged`):

```text
WP-10 <status> | branch ai/wp-10-controls @ <short sha> | rows done n/4 | steps n/6 | blockers: <none or list> | next: <one line>
```

Write it with `infra/dev/wp-status WP-10 <status> "<note>" --rows n/4 --tasks n/6 --blockers "<...>" --next "<...>"`
(the script names the field `tasks`) and send the same line, with `steps`, to the coordinator with SendMessage to
`local_9ebe99ff-3b99-4536-b3f5-3b1701a264ad`. Rows count when their task is pushed: SC-04 after T1, SC-06 after T2,
SC-08 after T3a, WB-NAV-06 after T3b. Steps count T0 to T5 (T3a and T3b are one step, done with T3b or with T3a
when the lease is refused and the reason is reported).

Lease requests to send with the `building` report (exact paths and reasons):

| Path | Reason | Task |
|---|---|---|
| `apps/web/messages/en.json` | additive `common.dataTableList`, `common.savedViewMenu`, `common.dateRange` only (C17) | T0 |
| `apps/web/src/features/prompts/prompts-screen.tsx`, `prompts-scope.tsx`, `prompt-model.ts`, `prompt-model.test.ts`, `prompts.test.tsx` | replace the window select with `DateRangePicker` in the existing top bar portal, legacy `window` key kept, to close WB-NAV-06; WP-17 not started | T3b |
| `docs/design-system/25-component-inventory.md` | append-only "As built (WP-10)" lines under 4.18, 7.7, 7.10 | T5 |

Not requested: `components/ui/popover.tsx` (fixed inside the picker, C7), `components/app/data-table/*` other than
`data-table-list.tsx` (C1), `components/app/shell/top-bar*.tsx` (C5), the registry trio (the shared lease already
names WP-10).

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Layout bugs (popover width, truncation, top bar room, row height) show only in a real browser; jsdom has no layout (WP-04, WP-05, WP-08 lesson) | Fixed row height (56 px), fixed input and month widths (`w-32`, 7 x 32 px), CSS-only switches between narrow and wide forms; three phone frames in the gallery; the browser check measures overflow, popover box and target sizes at 320, 360, 390; the e2e asserts them |
| R2 | The open picker overflows at 768 to 1023 px or at 320 px | Content widths add up to at most 292 px stacked and about 665 px side by side (C7); `w-auto` plus the popover's `max-w-(--available-width)`; measured at 320, 360, 390, 768 |
| R3 | Hydration: `useListMode` and `useMediaQuery` answer false on the server, so a phone first paints the table | Accepted (desktop is the reference); the table is the same data; the e2e at 390 waits for the list. CSS-only for every label switch, so no text mismatch |
| R4 | The answers route refuses 92 days across a fall-back clock change (elapsed time, `observations.py`), the summary accepts them | `maxDays` prop; T3b lists which requests carry the range and pins 91 or 92 with a test; recorded in T5 |
| R5 | Tests that read the clock become date dependent (F-03 lesson) | `today` is a prop everywhere; pure modules take dates as strings; the gallery uses a constant; prompts tests keep their harness's pinned clock |
| R6 | Shared files: `en.json`, the registry trio collide with other sessions | All edits in the early T0 push; on conflict keep both sides and rerun `messages.test.ts` and `registry.test.tsx` |
| R7 | T3b lease refused or `prompts-screen.tsx` changed by another holder | T3b is isolated; WB-NAV-06 reported open with the reason; on a rebase conflict the session stops and asks the coordinator |
| R8 | The list's search and sort drift from `DataTable` (two implementations) | Same `useSortedRows`; the search rule copied with a `shortcut:` comment and a test that compares the list's order with the table's for the same props; F1 moves the switch into `DataTable` |
| R9 | 150 tab stops in a long list on a zoomed desktop | DS20 6.8 chooses one link per row; Table is one switch away; windowing keeps the DOM small |
| R10 | Base UI Popover with a focus target inside a scrolling `ScrollArea`, and Menu radio groups in a 320 px viewport | Tests check initial focus and return; e2e checks focus and the boxes at 320 |
| R11 | nuqs mixed history (`view` push, keys replace) in one update | Unit test on the testing adapter's `onUrlUpdate`; the e2e checks Back after applying a view returns the previous view |
| R12 | The dev server writes `apps/web/AGENTS.md` and `CLAUDE.md` | Removed after stopping the server, checked untracked first, never staged, before any commit or full suite |
| R13 | Another agent edits `apps/web/e2e/flows/rankings.spec.ts` in this worktree | Never staged; `git add` names paths; the final reviewer checks `git show --stat` of every WP-10 commit |

Follow-ups for the coordinator: F1 `DataTable` renders `DataTableList` itself below 768 px (lease on `data-table.tsx`).
F2 persist the List or Table choice as a preference. F3 link rows once an inspector href helper exists. F4 a named
top bar date slot if a page needs the date range without a location. F5 the mobile filter sheet takes the date
range below 768 px (DS19 3.2). F6 bottom sheet popovers on phones (DS19 9) for every popover, not one. F7 the `12w`
preset and week snapping for weekly screens. F8 a "data starts on" field for AI data, so pages pass `earliest`. F9
`ui/popover.tsx` `notifications` width (`w-95`) for SC-21, and the unused `prompts.window*` messages after T3b.
