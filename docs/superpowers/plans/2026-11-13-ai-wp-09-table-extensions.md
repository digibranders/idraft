# WP-09 DataTable extensions: task plan

Brief: [docs/ai-visibility/work-packages/WP-09-table-extensions.md](../../ai-visibility/work-packages/WP-09-table-extensions.md).
Worktree `.claude/worktrees/ai-prompts-web-8c68b5`, branch `ai/wp-09-table-extensions`, base `07a9a447` (every fact below read at that commit).
Rows: SC-03 (tasks 1 to 4) and SC-05 (task 5). The WB-* rows are consumer rows: this package enables them, WP-18, WP-20, WP-21 and WP-22 close them when they adopt the new props.

## 0. Facts found (they change the plan)

| # | Fact | Consequence |
|---|---|---|
| F1 | Shift+F10 and the Menu key already open the row "More" menu (`data-table.tsx` `onKeyDown`, tests at `data-table.test.tsx` 548 to 605). | Task 5 adds only the pointer and touch paths and pins the keyboard path with tests. No change to that handler. |
| F2 | `ui/context-menu.tsx` (DS 3.26) does not exist. `ui/menu.tsx` opens from a trigger only. Base UI `ContextMenu.Trigger` calls `stopEvent` on every `contextmenu` and adds a document listener that `preventDefault`s inside the trigger, so it cannot leave Shift+right-click or a link to the browser. | Build `app/data-table/row-menu.tsx`: our own `onContextMenu`, and the existing `Menu` opened (controlled) from a zero-size anchor button at the pointer. No edit to `components/ui`. |
| F3 | The flat Rankings Keywords table has no `rowActions`; By group, Prompts and Runs have. | Right click is inert on flat Rankings until its screen supplies `rowActions` (feature code, not this package). D-40 is met at table level. |
| F4 | `ServerPaging`, `TableFooter` paging, `Selection.matchingTotal/allMatching`, "Select all N matching", `otherPagesSelected`, the announcement and Rankings server mode (above `CLIENT_MODE_LIMIT` 10,000) are built and partly tested. | Task 4 is verification tests plus two small fixes (F5, F6). |
| F5 | Pressing "Select all N matching" unmounts the focused button (`bulk-action-bar.tsx` renders it only while `!allMatching`), so focus falls to `body`. Not tested. | Fix in task 4. |
| F6 | In client mode a search in memory narrows `rows` but `matchingTotal` still offers "all N matching". Rankings guards this itself (`rankings-screen.tsx` ~382); Prompts will not. | Table-side guard in task 4 (no change for Rankings: it already passes null then). |
| F7 | `RowTree.level` is `1 | 2`; `isGroup` needs `level === 1`; `groupIdAbove`, the tree keys and `isPickable` assume two levels. Topics (`topics-table.tsx` shortcut comment) is the first consumer of level 3. | Task 2 touches `isGroup`, `isPickable`, `FocusCell.groupId`, the tree-key block. |
| F8 | Header height is the constant `HEADER_HEIGHT = 40`, used by `rowWindow`, `pageRows` and `scrollToRow`; body `aria-rowindex` is `rowOffset + index + 2`; the message row is `aria-rowindex={2}`; `rowCount` is `rows.length + 1`. | Task 1 replaces the literals with `headerRows` and `headerHeight`, equal to today's values when no group row is drawn. |
| F9 | 12-tables.md section 3 gives a pinned edge a 1 px `border` and no shadow. The left pin draws no edge today. | Task 3 draws the 1 px border on the right pin only (the brief's "scroll shadow", read as the spec's border). The left pin is left alone so Rankings does not change. |
| F10 | All four tasks edit `data-table.tsx` (1369 lines). | Run tasks one after the other, never in parallel. New logic goes in new pure files beside it (tested alone) so the diff to `data-table.tsx` stays small. |
| F11 | `/design-system/tables` (`components/design-system/tables-section.tsx`, e2e `table-style.spec.ts`) is the only gallery table; it already has `rowActions` and server mode. | Demo rows and e2e need an edit there: outside the owned folder, so ask the coordinator for a lease before task 6 (section 7). |

No new visible string is expected: group labels come from the caller, menus reuse `dataTable.rowActions`. If one appears it goes under `dataTable` in `apps/web/messages/en.json` (the table's own namespace), ASCII, no dashes.

## 1. Common rules for every task

- Order: write the tests, run them red for the right reason, implement, run green, then the checks, then one commit `WP-09: <title>` naming only this package's files. Edit with the file tools only (no heredocs, `sed`, replace scripts).
- Run from `apps/web`. Targeted tests: `pnpm vitest run src/components/app/data-table --maxWorkers=2`. Consumers after any change to `data-table.tsx`: `pnpm vitest run src/features/rankings src/features/prompts src/features/operations src/components/design-system --maxWorkers=2`.
- Checks on the changed files: `pnpm exec eslint <files> --max-warnings 0`, `pnpm exec prettier --check <files>`, then `pnpm typecheck`.
- House rules: tokens and `type-*` utilities only; spacing steps 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 only; no `Intl`, `toFixed`, `toLocaleString` in components (counts use `formatInteger`); no strings outside `en.json`; no em or en dash anywhere (code comments too); no `any`; no live region of our own (use `announce` only where the table already does); every new prop is optional and defaults to today's behaviour, so Rankings and Prompts render unchanged.
- ARIA: `role="grid"` stays; `treegrid` in tree mode; no `aria-colindex` or `aria-colcount` (20-accessibility.md section 6.2 rule 4: columns are not virtualized, native `colSpan` and `rowSpan` carry the spans).
- Existing tests are the first regression proof: the whole `data-table.test.tsx` (1859 lines), `toolbar.test.tsx`, `use-sorted-rows.test.tsx` must pass untouched. A task that has to edit an existing assertion is wrong.

## 2. Task 1: Column groups (WP-09: Column groups)

Goal: a two-row header, a group cell over adjacent columns, one sortable header per column, the group gone when one column is shown (WB-PRM-09 table side).

Files
- Create `components/app/data-table/column-groups.ts` and `column-groups.test.ts`.
- Edit `types.ts`, `columns.tsx` (`Options.group`, copied by `base()`), `data-table.tsx`, `data-table.test.tsx` (new `describe`).

Types and signatures
```ts
// types.ts
/** A header cell over the adjacent shown columns that share it (24-page-templates.md 9.5). `label` is already translated. */
export interface ColumnGroup { id: string; label: string }
// DataTableColumn<TRow>
group?: ColumnGroup | undefined;
// DataTableProps<TRow>
/** Opt in: draw a group row over columns that share a `group`. Off: one header row, as before. */
columnGroups?: boolean;
// column-groups.ts
export type HeaderSlot =
  | { kind: 'group'; group: ColumnGroup; span: number } // row 1, colSpan = span
  | { kind: 'tall' }                                    // row 1, rowSpan = 2 (ungrouped, alone in its group, select, actions)
  | { kind: 'covered' };                                // a column under a group cell: drawn in row 2 only
export interface HeaderPlan { rows: 1 | 2; slots: readonly HeaderSlot[] }
export function planHeader(groups: readonly (ColumnGroup | undefined)[]): HeaderPlan;
```
Rules in `planHeader`: a run of adjacent columns with the same `group.id` and length 2 or more is one `group` slot (first column) plus `covered` for the rest; a run of 1 is `tall`; same id in two separate runs is two group cells; `rows` is 2 only if some slot is `group`, otherwise every slot is `tall` and one row is drawn.

`data-table.tsx` changes
- `plan = columnGroups === true ? planHeader(grid.map(c => c.kind === 'data' ? c.column.group : undefined)) : null`; `headerRows = plan?.rows ?? 1`; `GROUP_ROW_HEIGHT = 24` (`h-6`, 25 section 16.2); `headerHeight = HEADER_HEIGHT + (headerRows === 2 ? GROUP_ROW_HEIGHT : 0)`, replacing `HEADER_HEIGHT` in `rowWindow` viewport, `pageRows`, `scrollToRow`.
- Row 1: group `th` (`role="columnheader" scope="colgroup" colSpan={span}`, `type-table-header`, `bg-surface-subtle`, `h-6`, sticky `top-0`, not focusable, no tab stop); `tall` cells are today's `th` with `rowSpan={2}` when `headerRows === 2`. Row 2: only the `covered` leaf `th`s (`scope="col"`), sticky `top-6`, `h-row-header`. Row 1 has `aria-rowindex={1}`, row 2 `aria-rowindex={2}`.
- Leaf header cells keep `cellProps(-1, index)`: the roving focus model stays one header row (row `-1`), group cells are static text. Dividers: `border-r border-r-border-subtle` on every header cell except the table's last column (use the column index, not `not-last:`, because the two rows have different last cells). The refetch bar (`after:`) only on cells whose bottom edge is the header's bottom.
- Body: `aria-rowindex = rowOffset + index + headerRows + 1`; message row `aria-rowindex={headerRows + 1}`; `rowCount` uses `headerRows` instead of the literal 1 (and `showsMessage ? headerRows + 1`).

Tests first (names, what they assert)
- `column-groups.test.ts`: "plans one row when no column has a group"; "spans a run of adjacent columns of one group"; "makes a group of one shown column a tall cell and keeps rows at 1 when no other group spans"; "splits a group whose columns are not adjacent into two cells"; "treats columns with no group (select, actions) as tall".
- `data-table.test.tsx` `describe('DataTable column groups')`: "draws one header row when columns have groups but columnGroups is off"; "draws a group cell with colSpan over its columns and one sortable header per column"; "numbers header rows 1 and 2, body rows from 3, and counts both in aria-rowcount (client and server mode)"; "collapses a group to the column's own tall header when the chooser hides all but one of its columns"; "keeps one header row when every group has one shown column"; "keeps roving focus on the leaf header row: ArrowUp from the first body row lands on a column header and Enter sorts"; "sets the leaf header's sticky offset below the group row and leaves rowWindow math in step (page keys move by the same rows)"; "puts no aria-colindex on any cell"; "passes the accessibility check with groups".

Checks: targeted vitest, consumers, lint, prettier, typecheck.

Regression: `columnGroups` is false by default and no column sets `group`, so `plan` is null, `headerRows` is 1, `headerHeight` is 40 and every literal evaluates to its old value. Proof: all existing tests (header, rowindex 202, rowcount 4813) pass untouched; new test "draws one header row when ... columnGroups is off" compares the header markup with and without `group` set on the columns (equal).

Rows: SC-03 (part). WB-PRM-09 enabled; WP-18 passes `group` and `columnGroups={engines.length > 1}` (with one engine the plan collapses by itself).

## 3. Task 2: Third tree level (WP-09: Third tree level)

Decision: RowTree level 3, not lazy rows. Lazy child rows (WB-CIT-07, domain to its top 10 pages) need no table support: the caller inserts a non-selectable placeholder row (`selectable: false`, as Topics does for "Show all") while its children load, and keeps `expanded` in its own state. Say so in the As built note. No `busy` prop.

Files
- Create `components/app/data-table/tree-rows.ts` and `tree-rows.test.ts`.
- Edit `types.ts`, `data-table.tsx`, `data-table.test.tsx`.

Types and signatures
```ts
// types.ts: RowTree
level: 1 | 2 | 3;
/** Level 1 and 2 rows only; ignored on level 3 (a level 3 row is always a leaf). */
expanded?: boolean | undefined;
// tree-rows.ts
export interface TreeRowFacts { level: 1 | 2 | 3; expanded: boolean | null } // null: not a group
export function parentIndex(rows: readonly TreeRowFacts[], index: number): number | null; // nearest earlier row with a lower level
export type TreeKeyResult = { kind: 'toggle' } | { kind: 'move'; row: number } | null;
export function treeKey(rows: readonly TreeRowFacts[], index: number, key: 'ArrowRight' | 'ArrowLeft'): TreeKeyResult;
export function ancestorIndexes(rows: readonly TreeRowFacts[], index: number): number[]; // nearest first
```
`treeKey`: Right on a closed group is `toggle`; on an open group `move` to `index + 1` when that row's level is the group's level + 1, else null; on a leaf null. Left on an open group is `toggle`; on a closed group or a leaf with level above 1 it is `move` to `parentIndex`; on a closed level 1 group null (the grid moves left, as today).

`data-table.tsx` changes
- `isGroup(tree)`: `(tree?.level === 1 || tree?.level === 2) && tree.expanded !== undefined`.
- `isPickable(tree, groupsToo)`: `tree === undefined || (hasCheckbox(tree) && (groupsToo || (tree.level >= 2 && !isGroup(tree))))`. For today's data (level 2 rows never have `expanded`) this equals the old rule.
- Replace the two-level `ArrowRight/ArrowLeft` block by `treeKey(...)` over `rows.map(...)`; keep the identity-cell and plain-key conditions exactly.
- `FocusCell.groupId: string | null` becomes `ancestorIds: readonly string[]` (nearest first, from `ancestorIndexes`); when the focused row goes, focus goes to the first ancestor still present, else to the row now at that place (today's fallback).
- Cell classes: level 2 keeps `pl-10`. Level 3: `pl-10` plus a leading `<span aria-hidden className="size-5 shrink-0" data-tree-spacer />` inside the same `flex min-w-0 items-center gap-2` wrapper a group row uses, so its text starts under a level 2 group's text. When any rendered level 2 row is a group, level 2 leaves get the same spacer so level 2 text aligns. A two-level tree gets no spacer. `aria-level`, `aria-setsize`, `aria-posinset` already pass `tree` through; `aria-expanded` only for `isGroup`.
- A level 2 group row uses the existing group band, disclosure button and `onToggleGroup(row)`; click and Enter toggle it.

Tests first (`describe('DataTable tree mode, third level')`)
- `tree-rows.test.ts`: "finds the nearest lower level row as parent"; "Right opens a closed group, moves into an open one, and does nothing on a leaf"; "Left closes an open group, goes to the parent from a leaf or a closed level 2 group, and returns null on a closed level 1 group"; "lists ancestors nearest first".
- `data-table.test.tsx`: "sets aria-level 3 with its own setsize and posinset, aria-expanded on level 2 groups only, and ignores expanded on level 3"; "toggles a level 2 group on click, Enter and Right and Left Arrow, calling onToggleGroup with that row"; "moves Right from an open level 2 group to its first level 3 row and Left from level 3 to the level 2 parent, not the level 1 group"; "moves Left from a closed level 2 group to its level 1 parent and from a closed level 1 group one cell left"; "hands focus to the level 2 group when it closes under a focused level 3 row, and to the row at that place when its level 1 ancestor closed"; "selects level 3 rows with a Shift range, the header checkbox and Ctrl+A, and leaves level 2 group rows out unless headerCoversGroups"; "gives an indeterminate level 2 group checkbox from indeterminateIds"; "indents with no spacer in a two level tree, with the spacer on level 3 and on level 2 leaves once a level 2 group exists"; "counts every rendered row in aria-rowcount and numbers aria-rowindex across three levels"; "passes the accessibility check with three levels".

Regression: Topics and Rankings By group send only levels 1 and 2 and never `expanded` on level 2, so `isGroup`, `isPickable`, `treeKey` and the classes reduce to the old results. Proof: the whole existing tree-mode `describe` (1374 to 1855, selection, announcements, Clear, toolbarEnd) passes untouched; new test "indents with no spacer in a two level tree" asserts the old class list on a level 2 cell and no `[data-tree-spacer]`; consumers' tests (`topic-tree.test.ts`, `selection.test.tsx`, `use-grouped-table.test.ts`, `grouped-columns.test.tsx`) pass.

Rows: SC-03 (part). WB-TOP-11 enabled; WP-18/WP-20 change `topics-table.tsx` (the shortcut comment names the upgrade).

## 4. Task 3: Pinned right column (WP-09: Pinned right column)

Goal: the actions (row menu) column stays in sight when the columns scroll sideways (WB-TOP-35).

Files: edit `types.ts`, `data-table.tsx`, `data-table.test.tsx`.

```ts
// DataTableProps<TRow>
/** Opt in: the actions column sticks to the right edge while the columns scroll under it. */
pinActions?: boolean;
```

`data-table.tsx` changes
- `pinnedRight = pinActions === true` for `column.kind === 'actions'`: header `th` gets `sticky right-0 z-(--z-sticky)` (the left pin header already uses `z-(--z-sticky)`), body `td` gets `sticky right-0 z-(--z-pinned-cell)`; backgrounds are already opaque per state (`bg-surface`, `bg-surface-subtle` on group rows and header, hover and selected via `group-*`). With two header rows the cell is `rowSpan=2` and `top-0`.
- Edge: state `atEnd` (boolean) set in the region's existing `onScroll` (`scrollLeft + clientWidth >= scrollWidth - 1`) and refreshed by the ResizeObserver callback; the border is drawn while `tableWidth > regionSize.width && !atEnd`: `border-l border-l-border` on the actions `th` and every body `td`. 1 px border, no shadow (F9). Re-renders only when the boolean flips, not per scroll event.
- Works with the left pin: `identityPinned` already leaves at least `PIN_LEAVES_ROOM` (360) px; the right pin adds 40 px, so 320 px of scrolling columns remain at least. No change to `stickyLeft`.
- Compact density: no height change (the cell sits in an `h-row-compact` row; the trigger is `icon-xs`). Right alignment (`text-right`) stays.

Tests first (`describe('DataTable pinned actions column')`; extend `FixedResizeObserver` with a `regionWidth` variable, default 1600, so a test can make the table overflow)
- "leaves the actions column static unless pinActions is set" (no `sticky` class, no border).
- "pins the actions header and cells to the right edge with the right z-index tokens".
- "draws the pinned edge only while columns are hidden behind it: overflowing and not at the end, none when the table fits or after scrolling to the end" (stub `scrollWidth` and `clientWidth`, `fireEvent.scroll`).
- "keeps the left pin and the right pin together: selection cell left 0, identity left 40, actions right 0 at a 1280 wide region".
- "keeps rows 32 px in compact and 40 px in comfortable with the pin".
- "opens the row menu with Shift+F10 from the pinned cell and returns focus to the pinned cell" (the menu still anchors to the trigger).
- "passes the accessibility check".

Regression: `pinActions` false by default, so class lists are untouched. Proof: existing "right aligns the row-actions column" and house-style tests pass untouched; the first new test asserts the old markup. `e2e/flows/table-style.spec.ts` (measures the actions column) runs in task 6.

Rows: SC-03 (part). WB-TOP-35 enabled: the Topics screen adds `pinActions` (WP-18).

## 5. Task 4: Server paging and Select all N matching (WP-09: Server paging and Select all N matching)

Built already (F4): footer range text, page size, previous and next with `focusableWhenDisabled`, `aria-rowcount` and `aria-rowindex` from `server.offset`, scroll reset on page change, the button, `allMatchingSelected`, the announcement, "N selected rows are on other pages", Clear, actions get `allMatching` in the scope. Plan only the gap.

Files: edit `bulk-action-bar.tsx`, `data-table.tsx` (one guard), `data-table.test.tsx`. No new prop, no type change.

Tests first, existing behaviour pinned (they should pass at once; if one fails, that is a bug to fix in this task)
- "keeps the selection across server pages: ids from page 1 stay selected on page 2, the bar says N selected rows are on other pages" (rerender with a new `offset`).
- "offers all matching from a server page once every row of that page is selected, and the header checkbox stays checked on the next page while all matching is on".
- "announces 'All 4,812 matching keywords selected. Bulk actions apply to all of them.' once".
- "sends the filters, not ids: the action gets allMatching true across a page change".
- "keeps Select all N matching out of reach while matchingTotal is null (unknown total)".

Tests first, the gap (these fail now)
- "keeps focus in the bulk bar after Select all N matching": focus must not fall to `body`. Fix: the count `<p>` gets `tabIndex={-1}` and a ref; the button's `onClick` focuses it before calling `onSelectAllMatching` (the `<p>` stays mounted, so focus survives the button unmounting). `data-slot="bulk-count"`; no visible change.
- "does not offer all matching while a search in memory narrows the loaded rows (client mode)": in `data-table.tsx` pass `matchingTotal={serverMode || needle === '' || searchText === undefined ? selection.matchingTotal : null}` to `BulkActionBar`.
- "does offer it again when the search is cleared".

Skipped on purpose: the 12-tables.md section 14 cap of 10,000 records per bulk action. Nothing in the table or Rankings enforces it today; adding `Selection.maxMatching` is a product call (owner, backend bulk limit). Raise it in the report, do not build it.

Regression: Rankings passes `matchingTotal = null` while a client search is active, so the new guard changes nothing there; its server mode is covered by the pinned tests. Existing tests 399 to 432 and 470 to 505 pass untouched. The focus fix only adds `tabIndex={-1}` to a paragraph (not a tab stop) and moves focus on one click.

Rows: SC-03 closed after this task (client and server select-all, paging). WB-BLK-03 enabled for Prompts (client mode, note shown through `hiddenSelected`).

## 6. Task 5: RowContextMenu (WP-09: RowContextMenu)

D-40 (default Yes): right click and a touch long press open the row menu on every DataTable with `rowActions`, Rankings By group included; Shift+F10 and the Menu key already do (F1); flat Rankings stays inert until its screen supplies `rowActions` (F3).

Files
- Create `components/app/data-table/row-menu.tsx`, `context-menu.ts`, `context-menu.test.ts`, `row-menu.test.tsx`.
- Edit `types.ts`, `data-table.tsx` (move the inline menu items to `rowMenuItems`; add the handlers), `data-table.test.tsx`.

Types and signatures
```ts
// types.ts: DataTableProps<TRow>
/** Right click and touch long press open the row menu at the pointer. Default true; needs `rowActions`. */
rowContextMenu?: boolean;
// context-menu.ts
export const LONG_PRESS = { delayMs: 500, slopPx: 10 } as const; // Base UI's own constants
export interface ContextEventFacts { shiftKey: boolean; target: EventTarget | null; fromKeyboard: boolean }
/** Whether the table, not the browser, handles this contextmenu event. */
export function ownsContextMenu(facts: ContextEventFacts, hasActions: boolean): boolean;
// row-menu.tsx
export function rowMenuItems<TRow>(actions: readonly RecordAction<TRow>[], row: TRow, id: string): MenuItemDef[]; // today's sorted, toMenuItem'd list
export interface MenuPoint { x: number; y: number }
export interface RowContextMenuProps {
  point: MenuPoint | null; items: readonly MenuItemDef[]; name: string; // name: t('rowActions', { name })
  onClose: () => void; finalFocus: () => HTMLElement | true;
}
export function RowContextMenu(props: RowContextMenuProps): ReactElement | null; // null when point is null
```
`ownsContextMenu` is false when: `shiftKey` (DS 16 section 5.4: Shift plus right click shows the browser menu), the target is inside `a[href]`, `input`, `textarea`, `select` or `[contenteditable]`, `fromKeyboard`, or `hasActions` is false. Ctrl plus click on a Mac raises `contextmenu` and counts as a right click.

Behaviour in `data-table.tsx`
- `<tr onContextMenu>`: if `rowContextMenu !== false` and `ownsContextMenu(...)`: `preventDefault()`, set `contextMenu = { rowId, point: { x: clientX, y: clientY }, column }`, close any other menu (`setMenu(null)`), `setFocus(cellAt(index, column))` and focus that cell with `preventScroll` (DS: right click also focuses the row). It does not select, toggle a group, open the inspector or change `activeRowId` (a `contextmenu` raises no `click`).
- `RowContextMenu` renders the existing `Menu` controlled (`open`, `onOpenChange`) with a trigger that is a zero-size fixed `button` (`tabIndex={-1}`, `aria-label` from `name`, inline `left` and `top` from the point; dynamic coordinates, the same use of `style` as `left` for the pins). Items are `rowMenuItems(actionsOf(rowActions, row), row, id)`, scope `{ ids: new Set([id]), allMatching: false }`, exactly the More menu (see deviation below). Nothing is rendered while closed.
- Keyboard origin: `onKeyDown` already handles Shift+F10 and ContextMenu; it sets `keyOpened.current = true` (cleared on keyup and a 0 ms timeout), and `onContextMenu` with the flag only calls `preventDefault()`, so the browser's own `contextmenu` for the same key press neither doubles the menu nor shows the native one.
- Touch: Android raises `contextmenu` on a long press, handled by the same path. iOS Safari raises none, so rows also run a long press for `pointerType === 'touch'`: `pointerdown` starts a `LONG_PRESS.delayMs` timer, `pointermove` beyond `slopPx`, `pointerup`, `pointercancel` or the region's `scroll` cancel it, firing opens the menu at the touch point (skipped when this row's context menu is already open) and sets a flag that swallows the next `click`, so the press does not open the inspector. The always-present More button stays the other touch path.
- Close: Escape or outside press closes; `finalFocus` is the clicked cell (`cellElement(index, column)`), so the arrow keys move on from it. Selection never changes.

Deviation to record (DS 25 3.28 says a right click on a selected row acts on the selection with a "12 keywords selected" label): the menu is the More menu and acts on the one row. Reason: `PromptAction`s are bound to their rows by the screen (`prompt-action.ts`) and ignore the `rows` argument, so applying them to a selection would silently act on one row. Revisit with the screens.

Tests first
- `context-menu.test.ts`: "is the table's for a plain right click on a cell"; "leaves Shift plus right click to the browser"; "leaves a link, an input, a textarea, a select and a contenteditable to the browser"; "leaves a keyboard raised contextmenu to the key handler"; "is not the table's for a row with no actions".
- `row-menu.test.tsx`: "renders nothing while point is null"; "puts the anchor at the point and names the menu from `name`"; "lists the actions in menu order, destructive last, as the More menu does".
- `data-table.test.tsx` `describe('DataTable row context menu')`:
  - "opens the row menu on right click with the More menu's items, and the browser menu is prevented" (`fireEvent.contextMenu` returns false);
  - "puts the anchor at the pointer coordinates";
  - "focuses the clicked cell and leaves selection, the active row and the inspector alone" (`onOpen` not called, checkboxes unchanged);
  - "runs an action on that row only, with the same arguments as the More menu, also while another row is selected";
  - "closes on Escape, returns focus to the clicked cell, and the arrows move on from it";
  - "moves the menu to another row on a second right click, never two menus";
  - "leaves Shift plus right click, a link in a cell and an input to the browser";
  - "opens nothing for a row the actions function gives no actions, or without rowActions";
  - "keeps Shift+F10 and the Menu key opening the More menu on the focused row, and one menu when the browser also raises contextmenu for that key press";
  - "opens on a touch long press of 500 ms at the touch point, not on a move over 10 px, a lift, a cancel or a scroll, and the click after it does not open the row" (fake timers, `pointerType: 'touch'`);
  - "right click on a tree group row opens its menu and does not toggle the group";
  - "rowContextMenu false leaves the browser menu in place";
  - "adds nothing to the markup before it is used" (`container.innerHTML` equal with `rowContextMenu` true and false);
  - "passes the accessibility check with the context menu open".
- Consumers: `grouped-columns.test.tsx`, `row-menu.test.tsx` (prompts) and `runs` tests pass untouched.

Regression: handlers are added to `<tr>` only; `onClick`, `onAuxClick`, `isRowClick` stay as they are. The one behaviour change is deliberate (D-40): right click on a row that has actions opens its menu instead of the browser menu (Rankings By group, Prompts, Runs, the gallery). Rankings flat is unchanged (no `rowActions`). Opt out per table with `rowContextMenu={false}`. Proof: the markup-equality test, the whole existing keyboard and menu tests (548 to 605), and e2e in task 6.

Rows: SC-05 closed. WB-MNU-14 enabled (closed for the screens that have `rowActions`).

## 7. Task 6: As built notes, rebase, final checks (WP-09: As built notes)

Docs (the brief allows docs "if strictly needed"; these are the spec's own As built places)
- `docs/design-system/12-tables.md`: add one `As built (2026-11-13, WP-09)` paragraph in section 16 (column groups, level 3, lazy rows are the caller's) and extend section 10 "Pinning" (right pin opt in, 1 px border, no shadow), section 13 "Right-click" (our own handler, Shift and links keep the browser menu, long press, acts on the one row) and section 14 (focus after Select all, client search guard, the 10,000 cap still open).
- `docs/design-system/25-component-inventory.md`: deviation row 152 (the new props `columnGroups`, `ColumnGroup`, `RowTree.level 3`, `pinActions`, `rowContextMenu`; context menu not `ui/context-menu.tsx`, and why; acts on one row); update 3.28 in one line to point to it.
- `docs/design-system/20-accessibility.md`: section 6.7 add level 3 keys; section 6.3 note that right click is built.
- `apps/web/src/components/design-system/registry.ts`: no new entry (no new component); the `tables` section gains demo rows (below).

Needs a lease from the coordinator before this task (outside the owned folder): `apps/web/src/components/design-system/tables-section.tsx` (three sample tables: groups with one and two columns, three levels, `pinActions` with 12 columns) and the new e2e spec `apps/web/e2e/flows/table-extensions.spec.ts` (its own file, not `support.ts`). If the lease is refused, drop the demos and run the e2e on Rankings By group only (right click, Escape, focus) and say so in the report.

E2E (`table-extensions.spec.ts`, at 1280 and 390 px, light and dark, both densities):
- right click on a Rankings By group row opens the menu at the pointer, Escape returns focus to the cell, the page's inspector did not open; Shift plus right click does not open it;
- gallery: group header spans, one column collapses; level 3 keyboard path; pinned actions stay in view after `scrollLeft` to the end with no overlap of the Keyword pin; Select all N matching keeps focus in the bar; axe has no serious or critical finding at 390, 768, 1024 and 1280 px.

Final checks (through the lock when `infra/dev/heavy` exists on develop, else directly)
- `cd apps/web && pnpm install --frozen-lockfile` (root first), `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`.
- `pnpm e2e -- rankings.spec.ts table-style.spec.ts table-extensions.spec.ts`; visual check of Keywords at 390, 768, 1024, 1280 px: no change.
- `git fetch origin && git rebase origin/develop`, re-run the targeted tests, `git push origin HEAD:develop`. Never push `main`, never run `infra/ship.sh`.
- Report line per the brief; rows done 2/2; list the open items: the 10,000 cap, flat Rankings `rowActions`, selection-aware context menu, iOS long press untested in a real device.

## 8. Regression map (Rankings and Prompts)

| Task | What could change | Why it does not | Proof |
|---|---|---|---|
| 1 Column groups | Header height, `aria-rowindex`, `aria-rowcount`, page-key math | `columnGroups` false by default, `headerRows = 1`, `headerHeight = 40` | whole existing suite; markup equality with `group` set and the prop off |
| 2 Third level | Selection counts, tree keys, focus fallback, indent | Level 1 and 2 data never has `expanded` on level 2; `treeKey` and `isPickable` reduce to the old rules | existing tree `describe` untouched; no-spacer assertion; Topics and Rankings grouped tests |
| 3 Right pin | Actions column markup, scroll listener | `pinActions` false by default; the `atEnd` state only updates its own boolean | static-markup test; `table-style.spec.ts` |
| 4 Select all | Bulk bar focus, count paragraph | One `tabIndex={-1}` and one focus call on one click; the client-search guard matches what Rankings already passes | pinned and new tests; Rankings server tests |
| 5 Context menu | Right click on rows with actions | Deliberate (D-40); `rowContextMenu={false}` opts out; nothing in the DOM until used; flat Rankings has no `rowActions` | markup equality; menu and keyboard tests untouched; e2e |

## 9. Skipped, and risks

- Skipped: the 10,000 bulk cap, a `busy` state for lazy children, a left pin edge border, a selection-aware context menu, `aria-colindex`, `ui/context-menu.tsx`, a `aria-busy` on group rows.
- Risks: `data-table.tsx` conflicts if another session edits it (none owns it but WP-09; check `git log origin/develop -- apps/web/src/components/app/data-table` before each task); the long press cannot be proven in jsdom beyond timers and events, so check it once in the iOS Simulator or a phone; the zero-size anchor button relies on Base UI `Menu` accepting a non-visible trigger (task 5 test "puts the anchor at the point" and the axe test cover it; if Base UI warns about `nativeButton`, keep the `button` element as designed).
