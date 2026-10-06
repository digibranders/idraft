'use client';

import type { RowData } from '@tanstack/react-table';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { toneOf } from './action-tone';
import { BulkActionBar } from './bulk-action-bar';
import { ColumnChooser } from './column-chooser';
import { TableFooter } from './table-footer';
import { DataTableToolbar } from './toolbar';
import type { ActionScope, CellTip, DataTableColumn, DataTableProps, RecordAction, RowActions } from './types';
import { useSortedRows } from './use-sorted-rows';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { announce } from '@/lib/a11y/announcer';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { formatInteger } from '@/lib/format';
import { COLUMN_TYPES, resolveWidths, type SizedColumn } from '@/lib/tables/column-types';
import { moveFocus, rangeOf, type GridCell } from '@/lib/tables/grid-focus';
import { rangeGaps, rowWindow, SCROLL_STEP, scrollToRow } from '@/lib/tables/row-window';
import { nextSort, type Density, type SortKey } from '@/lib/tables/table-state';
import { columnsAtTier, chosenColumns, moveColumn, toggleColumn } from '@/lib/tables/visible-columns';
import { cn } from '@/lib/utils';

/** Row heights per density, as `h-row` and `h-row-compact` draw them (04-spacing-density.md). */
const ROW_HEIGHT: Readonly<Record<Density, number>> = { default: 40, compact: 32 };
const HEADER_HEIGHT = 40;
const SKELETON_ROWS = 12;
const EMPTY_IDS: ReadonlySet<string> = new Set();
const GROUP_ORDER: Readonly<Record<RecordAction<unknown>['group'], number>> = {
  open: 0,
  object: 1,
  copy: 2,
  destructive: 3,
};

/** The actions of one row's menu. */
const actionsOf = <TRow,>(rowActions: RowActions<TRow> | undefined, row: TRow): readonly RecordAction<TRow>[] =>
  rowActions === undefined ? [] : typeof rowActions === 'function' ? rowActions(row) : rowActions;

/** The identity cell is the row header (20-accessibility.md section 6.2, rule 1). */
const cellTag = (identity: boolean): 'th' | 'td' => (identity ? 'th' : 'td');
const ROW_SCOPE = 'row';

type GridColumn<TRow> = { kind: 'select' } | { kind: 'data'; column: DataTableColumn<TRow> } | { kind: 'actions' };

const keyOf = <TRow,>(column: GridColumn<TRow>): string => (column.kind === 'data' ? column.column.id : column.kind);

const ALIGN: Readonly<Record<'left' | 'right' | 'center', string>> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/** The column tier the viewport shows (19-responsive-behavior.md section 6.1). */
function useColumnTier(): 1 | 2 | 3 | 4 {
  const xl = useMediaQuery(MEDIA.xl);
  const wide = useMediaQuery(MEDIA['2xl']);
  const widest = useMediaQuery(MEDIA['3xl']);
  return widest ? 4 : wide ? 3 : xl ? 2 : 1;
}

/** A record action as a menu item; destructive ones are listed last by the menu. */
const toMenuItem = <TRow,>(action: RecordAction<TRow>, rows: readonly TRow[], scope: ActionScope): MenuItemDef => ({
  id: action.id,
  label: action.label,
  icon: action.icon,
  tone: toneOf(action),
  disabledReason: action.disabledReason ?? undefined,
  onSelect: () => action.onSelect(rows, scope),
});

/**
 * Whether a click landed on the row itself rather than on a control in it. Clicks in a menu or tooltip
 * portaled out of the row still reach it through React, so a target outside the row's element is not the
 * row's either.
 */
const isRowClick = (event: MouseEvent<HTMLTableRowElement>): boolean =>
  event.target instanceof Element &&
  event.currentTarget.contains(event.target) &&
  event.target.closest('button, a, input, label, [role="checkbox"], [role="menuitem"]') === null;

/** The keys a control inside a cell hands back to the grid (20-accessibility.md section 6.3, widget mode). */
const GRID_KEYS = new Set(['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * The one table for record lists (12-tables.md, 20-accessibility.md section 6, 25-component-inventory.md
 * section 7.1). A native table with `role="grid"` and one roving tab stop: arrows move between cells, Enter
 * opens the row (sorts on a header), Space selects, Shift+Space selects a range, Ctrl+A selects what is
 * loaded, Shift+F10 opens the row menu, Alt+Down Arrow opens a column's options. Client mode sorts and
 * searches the loaded rows; server mode shows a page the caller sorted. Rows beyond 100 are rendered only
 * near the view, and the focused row always is. The identity column is the row header and stays pinned.
 */
export function DataTable<TRow extends RowData>({
  caption,
  itemNoun,
  columns,
  getRowId,
  rows: loaded,
  total,
  server,
  loadProgress,
  sort,
  onSortChange,
  defaultSort,
  density,
  onDensityChange,
  columnState,
  search,
  onSearchChange,
  searchPlaceholder,
  searchText,
  selection,
  bulkActions,
  rowActions,
  rowName,
  onRowOpen,
  activeRowId,
  onRowOrderChange,
  status,
  errorState,
  emptyState,
  filteredEmptyState,
  footerNote,
}: DataTableProps<TRow>): ReactNode {
  const t = useTranslations('dataTable');
  const captionId = useId();
  const hintId = useId();
  const gridId = useId();
  // Announcements about one subject share a key, so a newer one replaces one still waiting
  const selectionKey = `${captionId}-selection`;
  const region = useRef<HTMLDivElement>(null);
  const tier = useColumnTier();

  // Columns: the chosen set at this width, framed by the selection and actions columns
  const meta = columns.map((column) => ({
    id: column.id,
    priority: column.priority,
    identity: column.identity === true,
    defaultVisible: column.defaultVisible !== false,
  }));
  const byId = new Map(columns.map((column) => [column.id, column]));
  const shown = columnsAtTier(meta, columnState.visible, tier).flatMap((id) => {
    const column = byId.get(id);
    return column === undefined ? [] : [column];
  });
  const grid: GridColumn<TRow>[] = [
    ...(selection === undefined ? [] : [{ kind: 'select' as const }]),
    ...shown.map((column) => ({ kind: 'data' as const, column })),
    ...(rowActions === undefined || (typeof rowActions !== 'function' && rowActions.length === 0)
      ? []
      : [{ kind: 'actions' as const }]),
  ];

  // Rows: searched and sorted here in client mode, as given in server mode
  const needle = search.trim().toLocaleLowerCase();
  const serverMode = server !== undefined;
  const searched = useMemo(
    () =>
      serverMode || needle === '' || searchText === undefined
        ? loaded
        : loaded.filter((row) => searchText(row).toLocaleLowerCase().includes(needle)),
    [loaded, needle, searchText, serverMode],
  );
  const rows = useSortedRows({ rows: searched, columns, sort, manual: serverMode, getRowId });
  const ids = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const indexOfId = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids]);
  const showRows = status === 'ready' || status === 'refetching';
  const reportOrder = useRef(onRowOrderChange);
  const reportedIds = useRef<readonly string[] | null>(null);
  useEffect(() => {
    reportOrder.current = onRowOrderChange;
  });
  // Rows that are a new array of the same ids (a refetch, an empty page) are not a new order
  useEffect(() => {
    const last = reportedIds.current;
    if (last !== null && last.length === ids.length && last.every((id, index) => id === ids[index])) return;
    reportedIds.current = ids;
    reportOrder.current?.(ids);
  }, [ids]);

  // Geometry
  const [regionSize, setRegionSize] = useState({ width: 1200, height: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  // A server list's next or previous page starts at its first row, not at the place the last page was left
  const pageOffset = server?.offset;
  const [shownOffset, setShownOffset] = useState(pageOffset);
  if (shownOffset !== pageOffset) {
    setShownOffset(pageOffset);
    setScrollTop(0);
  }
  useEffect(() => {
    if (region.current !== null) region.current.scrollTop = 0;
  }, [pageOffset]);
  useEffect(() => {
    const element = region.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setRegionSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sized: SizedColumn[] = grid.map((column) => {
    if (column.kind !== 'data') return { id: column.kind, ...COLUMN_TYPES[column.kind] };
    const spec = COLUMN_TYPES[column.column.type];
    return {
      id: column.column.id,
      ...spec,
      width: column.column.width ?? spec.width,
      flex: column.column.identity === true,
    };
  });
  const widths = resolveWidths(sized, regionSize.width);
  const widthOf = (column: GridColumn<TRow>): number => widths.get(keyOf(column)) ?? 0;
  const tableWidth = sized.reduce((sum, column) => sum + (widths.get(column.id) ?? column.width), 0);
  // Pinned on the left: the selection column, then the identity column
  const stickyLeft = (column: GridColumn<TRow>): number | null => {
    if (column.kind === 'select') return 0;
    if (column.kind === 'data' && column.column.identity === true) {
      return selection === undefined ? 0 : (widths.get('select') ?? COLUMN_TYPES.select.width);
    }
    return null;
  };

  // Focus: one cell holds the tab stop. It follows the row's id through sorting, searching and refetches
  // (20-accessibility.md section 6.4, rule 6); when the row goes, the row now at its index takes it.
  // `rowId` null is the header row.
  const [focus, setFocus] = useState<{ rowId: string | null; index: number; column: number }>({
    rowId: null,
    index: -1,
    column: 0,
  });
  // A key's move, kept apart from focus that follows a click, so only keys scroll and move focus. A
  // request `ifLost` only takes focus that fell to the page body (the inspector closed around it).
  const [focusRequest, setFocusRequest] = useState<{
    cell: GridCell;
    seq: number;
    ifLost?: boolean;
    /** Only bring the row into view: the inspector stepped to it while focus stays in the inspector. */
    scrollOnly?: boolean;
  } | null>(null);
  const handledRequest = useRef(0);
  const focusedIndex = focus.rowId === null ? -1 : (indexOfId.get(focus.rowId) ?? focus.index);
  const current: GridCell = {
    row: showRows ? Math.min(focusedIndex, rows.length - 1) : -1,
    column: Math.min(focus.column, grid.length - 1),
  };
  const cellAt = (row: number, column: number): { rowId: string | null; index: number; column: number } => ({
    rowId: row < 0 ? null : (ids[row] ?? null),
    index: row,
    column,
  });
  // The focused row went (a refetch or a filter dropped it): the row now at its place takes the tab stop
  // for good, so the old row coming back (an undo) does not pull the tab stop away
  if (showRows && current.row >= 0 && focus.rowId !== null && !indexOfId.has(focus.rowId)) {
    setFocus(cellAt(current.row, current.column));
  }
  // Looked up by the grid's id when a menu closes, which is after render
  const cellElement = (row: number, column: number): HTMLElement | null =>
    document.getElementById(gridId)?.querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(column)}"]`) ??
    null;
  const rowHeight = ROW_HEIGHT[density];
  const count = showRows ? rows.length : 0;
  const ranges = rowWindow({
    count,
    rowHeight,
    scrollTop,
    viewport: regionSize.height - HEADER_HEIGHT,
    // The focused row, and the row focus returns to when the inspector closes, which may be far from view
    keep: [
      ...(current.row >= 0 ? [current.row] : []),
      ...(focusRequest?.ifLost === true && focusRequest.cell.row >= 0 ? [focusRequest.cell.row] : []),
    ],
  });
  const gaps = rangeGaps(ranges, count, rowHeight);
  // A key moved focus: bring the cell into view and focus it, once per move
  useEffect(() => {
    const element = region.current;
    if (focusRequest === null || element === null || focusRequest.seq === handledRequest.current) return;
    handledRequest.current = focusRequest.seq;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (focusRequest.ifLost === true && !lost) return;
    const { row, column } = focusRequest.cell;
    if (row >= 0) {
      const target = scrollToRow({
        row,
        rowHeight,
        scrollTop: element.scrollTop,
        viewport: element.clientHeight,
        header: HEADER_HEIGHT,
      });
      if (target !== null) element.scrollTop = target;
    }
    if (focusRequest.scrollOnly === true) return;
    element
      .querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(column)}"]`)
      ?.focus({ preventScroll: true });
  }, [focusRequest, rowHeight]);
  const moveTo = (cell: GridCell): void => {
    setFocus(cellAt(cell.row, cell.column));
    setFocusRequest((request) => ({ cell, seq: (request?.seq ?? 0) + 1 }));
  };
  // The inspector closed: focus returns to the identity cell of the row it showed, scrolled into view, or
  // to the grid's tab stop when that row is gone (16-drawers-dialogs-popovers.md section 2.8, rule 3)
  // The cell takes DOM focus only if focus was lost, and its own focus handler then moves the tab stop, so
  // the tab stop never leaves the cell that has focus.
  const [lastActive, setLastActive] = useState(activeRowId ?? null);
  const [inView, setInView] = useState<string | null>(null);
  if ((activeRowId ?? null) !== lastActive) {
    setLastActive(activeRowId ?? null);
    if ((activeRowId ?? null) === null) setInView(null);
    if ((activeRowId ?? null) === null && lastActive !== null && showRows) {
      const index = indexOfId.get(lastActive);
      const identity = grid.findIndex((column) => column.kind === 'data' && column.column.identity === true);
      const cell = index === undefined ? current : { row: index, column: Math.max(identity, 0) };
      setFocusRequest((request) => ({ cell, seq: (request?.seq ?? 0) + 1, ifLost: true }));
    }
  }
  // The open record's row is kept in view: when J or K step to it, and when a shared link's list arrives
  // (16 section 2.10)
  const activeIndex = activeRowId === null || activeRowId === undefined ? undefined : indexOfId.get(activeRowId);
  if (activeIndex !== undefined && activeRowId !== inView) {
    setInView(activeRowId ?? null);
    const cell = { row: activeIndex, column: current.column };
    setFocusRequest((request) => ({ cell, seq: (request?.seq ?? 0) + 1, scrollOnly: true }));
  }
  // Whether focus is in the grid, so a cell removed under it (a refetch dropped its row) hands focus on
  // instead of leaving it on the page body
  const focusInGrid = useRef(false);
  useEffect(() => {
    const element = region.current;
    if (!focusInGrid.current || element === null || document.activeElement !== document.body) return;
    element
      .querySelector<HTMLElement>(`[data-cell="${String(current.row)}:${String(current.column)}"]`)
      ?.focus({ preventScroll: true });
  });
  const onGridBlur = (event: FocusEvent<HTMLTableElement>): void => {
    const next = event.relatedTarget;
    // Focus left for somewhere else, rather than with an element the table removed
    if (next instanceof Node ? !event.currentTarget.contains(next) : event.target.isConnected) {
      focusInGrid.current = false;
    }
  };

  // Selection. With every matching row selected, each loaded row counts as selected too, so unticking one
  // starts from all of them.
  const allMatching = selection?.allMatching === true;
  const selected = selection?.selectedIds ?? EMPTY_IDS;
  const [anchor, setAnchor] = useState<string | null>(null);
  const loadedSelected = useMemo(() => ids.filter((id) => selected.has(id)).length, [ids, selected]);
  const hiddenSelected = useMemo(() => {
    let hidden = 0;
    for (const id of selected) if (!indexOfId.has(id)) hidden += 1;
    return hidden;
  }, [indexOfId, selected]);
  const allLoadedSelected = allMatching || (ids.length > 0 && loadedSelected === ids.length);
  const setSelected = (next: ReadonlySet<string>): void => {
    if (selection === undefined) return;
    if (allMatching) selection.onAllMatchingChange(false);
    selection.onChange(next);
    announce(t('selected', { count: formatInteger(next.size) }), { key: selectionKey, debounceMs: 250 });
  };
  const effectiveSelected = (): Set<string> => new Set(allMatching ? [...selected, ...ids] : selected);
  const toggleRow = (id: string, range: boolean): void => {
    const next = effectiveSelected();
    // Shift extends the selection to the range; a plain toggle flips the row
    const on = range || !next.has(id);
    for (const each of range ? rangeOf(ids, anchor, id) : [id]) {
      if (on) next.add(each);
      else next.delete(each);
    }
    setAnchor(id);
    setSelected(next);
  };
  // The header checkbox covers the rows in view: unticking it keeps the selected rows the search hides
  const toggleAll = (): void => {
    const next = effectiveSelected();
    if (allLoadedSelected) for (const id of ids) next.delete(id);
    else for (const id of ids) next.add(id);
    setSelected(next);
  };
  const selectLoaded = (): void => {
    if (!allMatching) setSelected(new Set([...selected, ...ids]));
  };
  const headerChecked: boolean | 'indeterminate' = allLoadedSelected
    ? true
    : loadedSelected === 0
      ? false
      : 'indeterminate';
  const selectedRows = useMemo(
    () => (allMatching ? loaded : loaded.filter((row) => selected.has(getRowId(row)))),
    [allMatching, loaded, selected, getRowId],
  );
  const scope: ActionScope = { ids: selected, allMatching };

  // Menus opened from the keyboard
  const [menu, setMenu] = useState<{ kind: 'column' | 'row'; id: string } | null>(null);
  const menuOpen = (kind: 'column' | 'row', id: string): boolean => menu?.kind === kind && menu.id === id;
  const onMenuChange = (kind: 'column' | 'row', id: string) => (open: boolean) => setMenu(open ? { kind, id } : null);

  const labelOf = (id: string): string => byId.get(id)?.header ?? id;
  const keyText = (key: SortKey): string => t(key.desc ? 'descending' : 'ascending', { column: labelOf(key.id) });
  const sortText = (keys: readonly SortKey[]): string | null => {
    const [first, second] = keys;
    if (first === undefined) return null;
    return second === undefined
      ? t('sortedOne', { first: keyText(first) })
      : t('sortedTwo', { first: keyText(first), second: keyText(second) });
  };
  // A sort change is announced in words, since aria-sort names only the first key (section 6.5, rule 3)
  const changeSort = (next: readonly SortKey[]): void => {
    onSortChange(next);
    const text = sortText(next);
    if (text !== null) announce(text, { key: `${captionId}-sort` });
  };
  const sortBy = (column: DataTableColumn<TRow>, additive: boolean): void => {
    const defaultDesc = COLUMN_TYPES[column.type].defaultDesc;
    if (defaultDesc === null || column.sortValue === undefined) return;
    changeSort(nextSort(sort, { id: column.id, defaultDesc }, { additive, tableDefault: defaultSort }));
  };
  const setSortDirection = (column: DataTableColumn<TRow>, direction: 'asc' | 'desc' | null): void => {
    changeSort(direction === null ? [...defaultSort] : [{ id: column.id, desc: direction === 'desc' }]);
  };

  const openRow = (row: TRow, event: { metaKey: boolean; ctrlKey: boolean; button?: number }): void => {
    onRowOpen?.(row, event.metaKey || event.ctrlKey || event.button === 1 ? 'new-tab' : 'inspector');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    const target = event.target;
    // Keys in a portaled menu or tooltip reach the table through React, and are theirs
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return;
    if (target.dataset.cell === undefined) {
      // A control in a cell (a checkbox, a sort button, a menu trigger) keeps its own keys, but Escape and
      // the arrows go back to the grid: Escape to the cell, the arrows on from it
      const cell = target.closest<HTMLElement>('[data-cell]');
      // A control that used the key (an open trigger, a caret in a field) keeps it
      const typing = target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio';
      if (cell === null || !GRID_KEYS.has(event.key) || event.altKey || event.defaultPrevented || typing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        cell.focus({ preventScroll: true });
        return;
      }
    }
    const size = {
      rows: showRows ? rows.length : 0,
      columns: grid.length,
      pageRows: Math.floor((regionSize.height - HEADER_HEIGHT) / rowHeight),
    };
    const column = grid[current.column];
    const row = current.row >= 0 ? rows[current.row] : undefined;
    if (event.altKey && event.key === 'ArrowDown' && current.row < 0 && column?.kind === 'data') {
      event.preventDefault();
      setMenu({ kind: 'column', id: column.column.id });
      return;
    }
    const moved = event.altKey ? null : moveFocus(current, event.key, size, { ctrl: event.ctrlKey || event.metaKey });
    if (moved !== null) {
      event.preventDefault();
      moveTo(moved);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && selection !== undefined) {
      event.preventDefault();
      selectLoaded();
      return;
    }
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      if (row !== undefined && actionsOf(rowActions, row).length > 0) {
        event.preventDefault();
        setMenu({ kind: 'row', id: getRowId(row) });
      }
      return;
    }
    if (event.key === ' ' && selection !== undefined) {
      event.preventDefault();
      if (row !== undefined) toggleRow(getRowId(row), event.shiftKey);
      else if (column?.kind === 'select') toggleAll();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (current.row < 0) {
        if (column?.kind === 'data') sortBy(column.column, event.shiftKey);
        else if (column?.kind === 'select') toggleAll();
        return;
      }
      if (row === undefined) return;
      if (column?.kind === 'actions') {
        // A row without actions has no menu to open, as with Shift+F10
        if (actionsOf(rowActions, row).length > 0) setMenu({ kind: 'row', id: getRowId(row) });
      } else if (column?.kind === 'select' && selection !== undefined) toggleRow(getRowId(row), false);
      else openRow(row, event);
    }
  };

  // The focusable cell's attributes
  const cellProps = (row: number, column: number) => ({
    'data-cell': `${String(row)}:${String(column)}`,
    tabIndex: current.row === row && current.column === column ? 0 : -1,
    onFocus: (): void => {
      if (current.row !== row || current.column !== column) setFocus(cellAt(row, column));
    },
  });

  const primarySort = sort[0];
  // A search narrows the loaded rows here in client mode, so the count is of what it left
  const shownCount = serverMode || needle === '' ? (total ?? rows.length) : rows.length;
  const countText = t('count', {
    count: formatInteger(shownCount),
    noun: shownCount === 1 ? itemNoun.one : itemNoun.other,
  });
  const sortSummary = sort.length < 2 ? null : sortText(sort);
  // The result count is announced when it changes after the first render (13-filters-search.md section 8),
  // whether the toolbar or the bulk bar is showing
  const announcedCount = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' && status !== 'filtered-empty' && status !== 'empty') return;
    if (announcedCount.current !== null && announcedCount.current !== countText) {
      announce(countText, { key: `${captionId}-count`, debounceMs: 500 });
    }
    announcedCount.current = countText;
  }, [captionId, countText, status]);

  // "Updating" appears when a refetch has run for 400 ms
  const [showUpdating, setShowUpdating] = useState(false);
  useEffect(() => {
    if (status !== 'refetching') return undefined;
    const timer = setTimeout(() => setShowUpdating(true), 400);
    return () => {
      clearTimeout(timer);
      setShowUpdating(false);
    };
  }, [status]);

  const chooserColumns = (() => {
    const chosen = chosenColumns(meta, columnState.visible);
    const rest = columns.filter((column) => !chosen.includes(column.id)).map((column) => column.id);
    return [...chosen, ...rest].map((id) => ({
      id,
      label: labelOf(id),
      visible: chosen.includes(id),
      locked: byId.get(id)?.identity === true,
    }));
  })();

  const selecting = selection !== undefined && (selected.size > 0 || selection.allMatching);
  // The bulk bar goes when the selection empties (Clear, or an action that cleared it). Focus inside it
  // would fall to the page body, so it returns to the grid at the last focused cell (20 section 4.3)
  const wasSelecting = useRef(selecting);
  useEffect(() => {
    const left = wasSelecting.current && !selecting;
    wasSelecting.current = selecting;
    if (!left || (document.activeElement !== null && document.activeElement !== document.body)) return;
    document
      .getElementById(gridId)
      ?.querySelector<HTMLElement>(`[data-cell="${String(current.row)}:${String(current.column)}"]`)
      ?.focus({ preventScroll: true });
  }, [selecting, gridId, current.row, current.column]);
  const footerCount =
    loadProgress === null || loadProgress === undefined
      ? countText
      : t('loadProgress', {
          loaded: formatInteger(loadProgress.loaded),
          total: formatInteger(loadProgress.total),
          noun: itemNoun.other,
        });

  // A column's options: sort, then moving and hiding it (12-tables.md section 10)
  const columnMenu = (column: DataTableColumn<TRow>, sorted: boolean): MenuItemDef[] => {
    const change = (visible: readonly string[]): void => columnState.onChange(visible);
    const sortItems: MenuItemDef[] =
      column.sortValue === undefined
        ? []
        : [
            { id: 'asc', label: t('sortAscending'), onSelect: () => setSortDirection(column, 'asc') },
            { id: 'desc', label: t('sortDescending'), onSelect: () => setSortDirection(column, 'desc') },
            ...(sorted ? [{ id: 'clear', label: t('clearSort'), onSelect: () => setSortDirection(column, null) }] : []),
          ];
    const layoutItems: MenuItemDef[] =
      column.identity === true
        ? []
        : [
            {
              id: 'left',
              label: t('moveLeft'),
              group: t('columns'),
              onSelect: () => change(moveColumn(meta, columnState.visible, column.id, -1)),
            },
            {
              id: 'right',
              label: t('moveRight'),
              group: t('columns'),
              onSelect: () => change(moveColumn(meta, columnState.visible, column.id, 1)),
            },
            {
              id: 'hide',
              label: t('hide'),
              group: t('columns'),
              onSelect: () => change(toggleColumn(meta, columnState.visible, column.id, false)),
            },
          ];
    return [...sortItems, ...layoutItems];
  };

  // Row positions for assistive technology (20-accessibility.md section 6.4): in server mode the page's
  // rows sit at their place in the whole list, and an unknown total is -1
  const rowOffset = server?.offset ?? 0;
  // A message in the body (error, empty, no match) is one row after the header
  const showsMessage = status === 'error' || status === 'empty' || status === 'filtered-empty' || rows.length === 0;
  const rowCount =
    status === 'loading' ? -1 : showsMessage ? 2 : serverMode ? (total === null ? -1 : total + 1) : rows.length + 1;
  const bodyItems: ({ kind: 'gap'; key: string; height: number } | { kind: 'row'; row: TRow; index: number })[] = [];
  ranges.forEach((range, position) => {
    const height = gaps[position] ?? 0;
    if (height > 0) bodyItems.push({ kind: 'gap', key: `gap-${String(position)}`, height });
    for (let index = range.start; index < range.end; index += 1) {
      const row = rows[index];
      if (row !== undefined) bodyItems.push({ kind: 'row', row, index });
    }
  });
  const trailingGap = gaps[ranges.length] ?? 0;
  if (trailingGap > 0) bodyItems.push({ kind: 'gap', key: 'gap-end', height: trailingGap });

  // The tooltips of headers and cells: shown on the cell they are about, and read from a hidden description
  // outside the table, so the cell's own text stays what it names the cell by (20 section 6.3)
  const descriptions: { id: string; text: string }[] = [];
  const describe = (position: string, tip: CellTip): string => {
    const id = `${gridId}-tip-${position}`;
    descriptions.push({
      id,
      text: tip.description ?? (tip.detail === undefined ? tip.content : `${tip.content} ${tip.detail}`),
    });
    return id;
  };

  const bodyMessage = (content: ReactNode): ReactElement => (
    <tr role="row" aria-rowindex={2}>
      <td role="gridcell" colSpan={grid.length} className="p-0">
        {content}
      </td>
    </tr>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <h2 id={captionId} className="sr-only">
        {caption}
      </h2>
      <p id={hintId} className="sr-only">
        {t('hint')}
      </p>
      {selecting && selection !== undefined ? (
        <BulkActionBar
          selectedCount={selected.size}
          matchingTotal={selection.matchingTotal}
          allLoadedSelected={allLoadedSelected}
          allMatching={allMatching}
          onSelectAllMatching={() => {
            selection.onAllMatchingChange(true);
            if (selection.matchingTotal !== null) {
              announce(
                t('allMatchingAnnounced', { count: formatInteger(selection.matchingTotal), noun: itemNoun.other }),
                { key: selectionKey },
              );
            }
          }}
          hiddenCount={hiddenSelected}
          hiddenReason={serverMode ? 'pages' : 'filters'}
          actions={bulkActions ?? []}
          selectedRows={selectedRows}
          scope={scope}
          onClear={() => {
            selection.onAllMatchingChange(false);
            selection.onChange(new Set());
            announce(t('selectionCleared'), { key: selectionKey });
          }}
        />
      ) : (
        <DataTableToolbar
          caption={caption}
          search={search}
          onSearchChange={onSearchChange}
          searchPlaceholder={searchPlaceholder}
          countText={status === 'loading' ? null : countText}
          sortSummary={sortSummary}
          updating={showUpdating}
          density={density}
          onDensityChange={onDensityChange}
          columns={(trigger) => (
            <ColumnChooser
              trigger={trigger}
              columns={chooserColumns}
              onToggle={(id, visible) => columnState.onChange(toggleColumn(meta, columnState.visible, id, visible))}
              onMove={(id, direction) => columnState.onChange(moveColumn(meta, columnState.visible, id, direction))}
              onReset={() => columnState.onChange(null)}
            />
          )}
        />
      )}
      <div
        ref={region}
        className="relative isolate min-h-0 flex-1 overflow-auto"
        // Rounded down, so scrolling renders again every SCROLL_STEP pixels rather than on every event
        onScroll={(event) => setScrollTop(Math.floor(event.currentTarget.scrollTop / SCROLL_STEP) * SCROLL_STEP)}
      >
        <table
          role="grid"
          id={gridId}
          aria-labelledby={captionId}
          aria-describedby={hintId}
          aria-rowcount={rowCount}
          aria-multiselectable={selection === undefined ? undefined : true}
          aria-busy={status === 'refetching' || status === 'loading' ? true : undefined}
          onKeyDown={onKeyDown}
          onFocus={() => {
            focusInGrid.current = true;
          }}
          onBlur={onGridBlur}
          className="table-fixed border-separate border-spacing-0 type-table"
          style={{ width: tableWidth }}
        >
          <colgroup>
            {grid.map((column) => (
              <col key={keyOf(column)} style={{ width: widthOf(column) }} />
            ))}
          </colgroup>
          <thead role="rowgroup">
            <tr role="row" aria-rowindex={1} className="h-row-header">
              {grid.map((column, index) => {
                const left = stickyLeft(column);
                const sortKey = column.kind === 'data' ? sort.find((key) => key.id === column.column.id) : undefined;
                const definition = column.kind === 'data' ? column.column.headerTooltip : undefined;
                const header = (
                  <th
                    key={keyOf(column)}
                    role="columnheader"
                    scope="col"
                    aria-describedby={
                      definition === undefined ? undefined : describe(`h${String(index)}`, { content: definition })
                    }
                    {...cellProps(-1, index)}
                    aria-sort={
                      column.kind === 'data' && primarySort?.id === column.column.id
                        ? primarySort.desc
                          ? 'descending'
                          : 'ascending'
                        : undefined
                    }
                    style={left === null ? undefined : { left }}
                    className={cn(
                      'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-3 align-middle font-normal outline-none focus-visible:focus-ring-inset',
                      'not-last:border-r not-last:border-r-border-subtle',
                      left !== null && 'z-(--z-sticky)',
                      // The refetch bar: 2 px under the header while a refetch runs (17 section 3.4)
                      status === 'refetching' &&
                        'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
                      column.kind === 'select' && 'px-0 text-center',
                      column.kind === 'data' && ALIGN[COLUMN_TYPES[column.column.type].align],
                    )}
                  >
                    {column.kind === 'select' ? (
                      <Checkbox
                        checked={headerChecked}
                        label={t('selectAll', {
                          count: formatInteger(ids.length),
                          noun: ids.length === 1 ? itemNoun.one : itemNoun.other,
                        })}
                        labelDisplay="visually-hidden"
                        tabIndex={-1}
                        onCheckedChange={toggleAll}
                        className="justify-center"
                      />
                    ) : column.kind === 'data' ? (
                      <HeaderContent
                        column={column.column}
                        sortKey={sortKey ?? null}
                        sortIndex={sortKey === undefined || sort.length < 2 ? null : sort.indexOf(sortKey) + 1}
                        onSort={(additive) => sortBy(column.column, additive)}
                        menuOpen={menuOpen('column', column.column.id)}
                        onMenuOpenChange={onMenuChange('column', column.column.id)}
                        finalFocus={() => cellElement(-1, index) ?? true}
                        items={columnMenu(column.column, sortKey !== undefined)}
                        optionsLabel={t('columnOptions', { column: column.column.header })}
                      />
                    ) : (
                      <span className="sr-only">{t('actionsColumn')}</span>
                    )}
                  </th>
                );
                return definition === undefined ? (
                  header
                ) : (
                  <Tooltip key={keyOf(column)} content={definition} side="bottom" purpose="label">
                    {header}
                  </Tooltip>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {status === 'loading'
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr
                    key={index}
                    role="row"
                    aria-hidden="true"
                    className={density === 'compact' ? 'h-row-compact' : 'h-row'}
                  >
                    {grid.map((column) => (
                      <td key={keyOf(column)} className="border-b border-border-subtle px-3">
                        {column.kind === 'data' ? (
                          <span
                            className={cn('flex', COLUMN_TYPES[column.column.type].align === 'right' && 'justify-end')}
                          >
                            <Skeleton shape="text-13" widthPct={column.column.identity === true ? 72 : 56} />
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))
              : status === 'error'
                ? bodyMessage(errorState)
                : status === 'empty'
                  ? bodyMessage(emptyState)
                  : status === 'filtered-empty' || rows.length === 0
                    ? bodyMessage(filteredEmptyState)
                    : // One flat keyed list of rows and spacers: a row that moves from the kept range into the view
                      // keeps its element, and with it the focus
                      bodyItems.map((item) => {
                        if (item.kind === 'gap') {
                          return (
                            <tr key={item.key} aria-hidden="true" style={{ height: item.height }}>
                              <td colSpan={grid.length} className="p-0" />
                            </tr>
                          );
                        }
                        const { row, index } = item;
                        const id = getRowId(row);
                        const isSelected = allMatching || selected.has(id);
                        const isActive = activeRowId === id;
                        const name = rowName(row);
                        return (
                          <tr
                            key={id}
                            role="row"
                            aria-rowindex={rowOffset + index + 2}
                            aria-selected={selection === undefined ? undefined : isSelected}
                            aria-current={isActive ? 'true' : undefined}
                            data-selected={isSelected ? '' : undefined}
                            data-active={isActive ? '' : undefined}
                            className={cn('group cursor-default', density === 'compact' ? 'h-row-compact' : 'h-row')}
                            onClick={(event: MouseEvent<HTMLTableRowElement>) => {
                              if (isRowClick(event)) openRow(row, event);
                            }}
                            onAuxClick={(event: MouseEvent<HTMLTableRowElement>) => {
                              if (event.button === 1 && isRowClick(event)) openRow(row, event);
                            }}
                          >
                            {grid.map((column, columnIndex) => {
                              const left = stickyLeft(column);
                              const first = columnIndex === 0;
                              const identity = column.kind === 'data' && column.column.identity === true;
                              const Cell = cellTag(identity);
                              const tip = column.kind === 'data' ? column.column.cellTip?.(row) : undefined;
                              const cellNode = (
                                <Cell
                                  key={keyOf(column)}
                                  role={identity ? 'rowheader' : 'gridcell'}
                                  scope={identity ? ROW_SCOPE : undefined}
                                  aria-describedby={
                                    tip === undefined
                                      ? undefined
                                      : describe(`${String(index)}-${String(columnIndex)}`, tip)
                                  }
                                  {...cellProps(index, columnIndex)}
                                  style={left === null ? undefined : { left }}
                                  className={cn(
                                    'border-b border-border-subtle bg-surface px-3 font-normal outline-none focus-visible:focus-ring-inset',
                                    'group-hover:bg-surface-hover group-data-active:bg-surface-selected group-data-selected:bg-surface-selected',
                                    left !== null && 'sticky z-(--z-pinned-cell)',
                                    first && 'group-data-active:row-active-edge',
                                    column.kind === 'select' && 'px-0 text-center',
                                    column.kind === 'actions' && 'px-2 text-right',
                                    column.kind === 'data' && ALIGN[COLUMN_TYPES[column.column.type].align],
                                    identity &&
                                      'group-data-active:text-primary-text group-data-selected:text-primary-text',
                                  )}
                                >
                                  {column.kind === 'select' ? (
                                    <Checkbox
                                      checked={isSelected}
                                      label={t('selectRow', { name })}
                                      labelDisplay="visually-hidden"
                                      tabIndex={-1}
                                      onCheckedChange={() => toggleRow(id, false)}
                                      onClick={(event) => {
                                        if (event.shiftKey) {
                                          event.preventDefault();
                                          toggleRow(id, true);
                                        }
                                      }}
                                      className="justify-center"
                                    />
                                  ) : column.kind === 'actions' ? (
                                    actionsOf(rowActions, row).length === 0 ? null : (
                                      <Menu
                                        align="end"
                                        open={menuOpen('row', id)}
                                        onOpenChange={onMenuChange('row', id)}
                                        // Back to the cell, not the trigger, so the arrow keys work again
                                        finalFocus={() => cellElement(index, columnIndex) ?? true}
                                        trigger={
                                          <IconButton
                                            icon={Ellipsis}
                                            size="icon-xs"
                                            variant="ghost"
                                            tabIndex={-1}
                                            label={t('rowActions', { name })}
                                          />
                                        }
                                        items={[...actionsOf(rowActions, row)]
                                          .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group])
                                          .map((action) =>
                                            toMenuItem(action, [row], { ids: new Set([id]), allMatching: false }),
                                          )}
                                      />
                                    )
                                  ) : (
                                    column.column.cell(row)
                                  )}
                                </Cell>
                              );
                              return tip === undefined ? (
                                cellNode
                              ) : (
                                <Tooltip key={keyOf(column)} content={tip.content} detail={tip.detail} purpose="label">
                                  {cellNode}
                                </Tooltip>
                              );
                            })}
                          </tr>
                        );
                      })}
          </tbody>
        </table>
      </div>
      <div hidden>
        {descriptions.map((description) => (
          <span key={description.id} id={description.id}>
            {description.text}
          </span>
        ))}
      </div>
      {/* No count while the first rows load: "0 keywords" would be wrong */}
      <TableFooter countText={status === 'loading' ? null : footerCount} note={footerNote} server={server} />
    </div>
  );
}

interface HeaderContentProps<TRow> {
  column: DataTableColumn<TRow>;
  sortKey: SortKey | null;
  /** 1 or 2 when two keys sort the table. */
  sortIndex: number | null;
  onSort: (additive: boolean) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** Where focus goes when the options menu closes: the header cell. */
  finalFocus: () => HTMLElement | true;
  items: MenuItemDef[];
  optionsLabel: string;
}

/** A column header: the label (a sort button when the column sorts), its sort state and its options menu. */
function HeaderContent<TRow>({
  column,
  sortKey,
  sortIndex,
  onSort,
  menuOpen,
  onMenuOpenChange,
  finalFocus,
  items,
  optionsLabel,
}: HeaderContentProps<TRow>): ReactElement {
  const right = COLUMN_TYPES[column.type].align === 'right';
  const label = (
    <span className={cn('truncate type-label', sortKey === null ? 'text-foreground-tertiary' : 'text-foreground')}>
      {column.header}
    </span>
  );
  const sortable = column.sortValue !== undefined;
  return (
    <span className={cn('group/header relative flex min-w-0 items-center gap-1', right && 'flex-row-reverse')}>
      {sortable ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => onSort(event.shiftKey)}
          className={cn('flex min-w-0 items-center gap-1 rounded-sm', right && 'flex-row-reverse')}
        >
          {label}
          {sortKey === null ? null : (
            <Icon
              icon={sortKey.desc ? ArrowDownWideNarrow : ArrowUpNarrowWide}
              size="sm"
              className="shrink-0 text-foreground"
            />
          )}
          {sortIndex === null ? null : <span className="num type-micro text-foreground-tertiary">{sortIndex}</span>}
        </button>
      ) : (
        label
      )}
      {items.length === 0 ? null : (
        // Over the inner edge, so a short label keeps its width while the chevron is hidden
        <span
          className={cn(
            'absolute top-1/2 -translate-y-1/2 bg-surface-subtle opacity-0 group-focus-within/header:opacity-100 group-hover/header:opacity-100',
            right ? 'left-0' : 'right-0',
            menuOpen && 'opacity-100',
          )}
        >
          <Menu
            open={menuOpen}
            onOpenChange={onMenuOpenChange}
            finalFocus={finalFocus}
            trigger={
              <IconButton icon={ChevronDown} size="icon-xs" variant="ghost" tabIndex={-1} label={optionsLabel} />
            }
            items={items}
          />
        </span>
      )}
    </span>
  );
}
