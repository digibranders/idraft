'use client';

import type { RowData } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import type { DataTableColumn, ServerPaging, TableStatus } from './types';
import { useSortedRows } from './use-sorted-rows';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, type SkeletonWidth } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/a11y/announcer';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { COLUMN_TYPES } from '@/lib/tables/column-types';
import { rangeGaps, rowWindow, SCROLL_STEP, scrollToRow } from '@/lib/tables/row-window';
import type { SortKey } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/**
 * Rows are 56 px (two 20 px lines and 8 px padding, 19 section 6.7 rule 1), fixed for the window: the `li`, the
 * skeleton row and the spacers all come from this one number. `ROW_BOX` is `h-14` (3.5rem), and its divider is
 * drawn inside that box, over the last pixel of the padding, because a border outside the box would make a row
 * 57 px and the scroll height drift by 1 px per row. jsdom has no layout: the real height must be measured in a
 * browser (the `li` offsetHeight equals `LIST_ROW_HEIGHT`).
 */
export const LIST_ROW_HEIGHT = 56;
const ROW_BOX = 'relative h-14 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border-subtle';
/** The layout class of the list (19 section 2) and touch-primary (19 section 1.1). */
export const LIST_MEDIA = '(width < 48rem)';
export const TOUCH_MEDIA = '(pointer: coarse) and (hover: none)';

const SKELETON_ROWS = 8;
/** Fixed per row, never random, so a render does not flicker (17 section 3.1). */
const LINE_1_WIDTHS: readonly SkeletonWidth[] = [72, 56, 64, 80, 48, 72, 56, 64];
const LINE_2_WIDTHS: readonly SkeletonWidth[] = [48, 64, 56, 48, 64, 56, 48, 64];
/** The region's height until it is measured: a phone's list area. */
const DEFAULT_VIEWPORT = 600;

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

export interface DataTableListProps<TRow extends RowData> {
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
  /** The row above the list: `DataTableListSort` and, when `canSwitch`, `ListTableSwitch`. */
  toolbar?: ReactNode;
}

/** A rendered row of the window, or the space of the rows that are not rendered. */
type ListItem<TRow extends RowData> =
  { kind: 'gap'; key: string; height: number } | { kind: 'row'; row: TRow; index: number };

/**
 * The rendering of a table below 768 px (19-responsive-behavior.md section 6.7): two-line rows, each one
 * button that opens the record. It sorts, searches and windows the rows as the table does, and has no
 * selection and no row menu. The count line and the toolbar are fixed above the scrolling rows.
 *
 * Not available here: J and K stepping. `inspector.tsx` `stepFromHere` only steps from inside a
 * `[role="grid"]`, so it does nothing from the list; the inspector's own Previous and Next buttons work.
 */
export function DataTableList<TRow extends RowData>({
  caption,
  itemNoun,
  columns,
  rows: loaded,
  total,
  getRowId,
  sort,
  search,
  searchText,
  server,
  loadProgress,
  line1,
  line2,
  onRowOpen,
  activeRowId,
  onRowOrderChange,
  status,
  errorState,
  emptyState,
  filteredEmptyState,
  footerNote,
  toolbar,
}: DataTableListProps<TRow>): ReactElement {
  const t = useTranslations('common.dataTableList');
  const tt = useTranslations('dataTable');
  const region = useRef<HTMLDivElement>(null);
  const countKey = useId();
  const serverMode = server !== undefined;

  // Rows: searched and sorted here in client mode (the table's rule), as given in server mode. The list
  // sorts by the first key only
  const needle = search.trim().toLocaleLowerCase();
  const searched = useMemo(
    () =>
      serverMode || needle === '' || searchText === undefined
        ? loaded
        : loaded.filter((row) => searchText(row).toLocaleLowerCase().includes(needle)),
    [loaded, needle, searchText, serverMode],
  );
  const listSort = useMemo(() => sort.slice(0, 1), [sort]);
  const rows = useSortedRows({ rows: searched, columns, sort: listSort, manual: serverMode, getRowId });
  const ids = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const indexOfId = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids]);

  // The order the inspector steps through. Rows that are a new array of the same ids are not a new order
  const reportOrder = useRef(onRowOrderChange);
  const reportedIds = useRef<readonly string[] | null>(null);
  useEffect(() => {
    reportOrder.current = onRowOrderChange;
  });
  useEffect(() => {
    const last = reportedIds.current;
    if (last !== null && last.length === ids.length && last.every((id, index) => id === ids[index])) return;
    reportedIds.current = ids;
    reportOrder.current?.(ids);
  }, [ids]);

  // Geometry: the window follows from the scroll offset alone, as every row has the same height
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  // A server list's next or previous page starts at its first row
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
      if (entry !== undefined) setViewport(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The focused row and the open row stay rendered however far the window moves, so focus is never lost and
  // the list is back at the same row when the inspector closes (19 section 6.7 rule 5)
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const activeIndex = activeRowId === null || activeRowId === undefined ? -1 : (indexOfId.get(activeRowId) ?? -1);
  const focusedIndex = focusedId === null ? -1 : (indexOfId.get(focusedId) ?? -1);
  const showRows = status === 'ready' || status === 'refetching';
  const count = showRows ? rows.length : 0;
  const ranges = rowWindow({
    count,
    rowHeight: LIST_ROW_HEIGHT,
    scrollTop,
    viewport,
    keep: [activeIndex, focusedIndex],
  });
  const gaps = rangeGaps(ranges, count, LIST_ROW_HEIGHT);
  const items: ListItem<TRow>[] = [];
  ranges.forEach((range, position) => {
    items.push({ kind: 'gap', key: `gap-${String(range.start)}`, height: gaps[position] ?? 0 });
    rows.slice(range.start, range.end).forEach((row, offset) => {
      items.push({ kind: 'row', row, index: range.start + offset });
    });
  });
  items.push({ kind: 'gap', key: 'gap-end', height: gaps[ranges.length] ?? 0 });
  // The open row is brought into view when it changes: on mount, and as the inspector steps
  useEffect(() => {
    const element = region.current;
    if (element === null || activeIndex < 0) return;
    const target = scrollToRow({
      row: activeIndex,
      rowHeight: LIST_ROW_HEIGHT,
      scrollTop: element.scrollTop,
      viewport: element.clientHeight,
      header: 0,
    });
    if (target !== null) element.scrollTop = target;
  }, [activeIndex]);

  // The count line. No count while the first rows load or after a failure: "0 prompts" would be wrong
  const nouns = { nounOne: itemNoun.one, nounOther: itemNoun.other };
  const shownCount = serverMode || needle === '' ? (total ?? rows.length) : rows.length;
  // ARIA: -1 says the size of the set is not known; a server page of an unknown total is not the whole set
  const setSize = serverMode && total === null ? -1 : shownCount;
  const countText = tt('count', { count: shownCount, ...nouns });
  const progressText =
    loadProgress === null || loadProgress === undefined
      ? countText
      : tt('loadProgress', { loaded: loadProgress.loaded, total: loadProgress.total, ...nouns });
  const lineText =
    footerNote === undefined ? progressText : tt('footerNote', { count: progressText, note: footerNote });
  const showCount = status !== 'loading' && status !== 'error';
  // The result count is announced when it changes after the first render (13-filters-search.md section 8)
  const announcedCount = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' && status !== 'filtered-empty' && status !== 'empty') return;
    if (announcedCount.current !== null && announcedCount.current !== countText) {
      announce(countText, { key: `${countKey}-count`, debounceMs: 500 });
    }
    announcedCount.current = countText;
  }, [countKey, countText, status]);

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

  const renderRow = (row: TRow, index: number): ReactElement => {
    const id = getRowId(row);
    const first = line1(row);
    const second = line2(row);
    const active = id === activeRowId;
    return (
      <li key={id} aria-setsize={setSize} aria-posinset={(server?.offset ?? 0) + index + 1} className={ROW_BOX}>
        <button
          type="button"
          aria-current={active ? 'true' : undefined}
          onClick={() => onRowOpen(row)}
          onFocus={() => setFocusedId(id)}
          className={cn(
            'flex h-full w-full flex-col px-3 py-2 text-left outline-none hover:bg-surface-hover focus-visible:focus-ring-inset',
            active && 'bg-surface-selected',
          )}
        >
          <span className="flex items-center gap-3">
            <span className={cn('min-w-0 truncate type-body-strong', active && 'text-primary-text')}>
              {first.identity}
            </span>{' '}
            <span className="sr-only">{first.valueLabel}</span>{' '}
            <span className="ml-auto shrink-0 num type-body-strong">{first.value}</span>
          </span>{' '}
          <span className="flex items-center gap-3">
            <span className="min-w-0 truncate type-meta">{second.context}</span>{' '}
            {second.delta === null ? null : (
              <span data-slot="list-delta" className="ml-auto shrink-0">
                {second.delta}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  const body =
    status === 'loading' ? (
      <div role="status" aria-label={t('loading', { caption: itemNoun.other })} className="flex flex-col">
        <span className="sr-only">{t('loading', { caption: itemNoun.other })}</span>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} aria-hidden="true" className={cn(ROW_BOX, 'flex flex-col justify-between px-3 py-2')}>
            <Skeleton shape="text-14" widthPct={LINE_1_WIDTHS[index] ?? 64} />
            <Skeleton shape="text-13" widthPct={LINE_2_WIDTHS[index] ?? 48} />
          </div>
        ))}
      </div>
    ) : status === 'error' ? (
      errorState
    ) : status === 'empty' ? (
      emptyState
    ) : status === 'filtered-empty' || rows.length === 0 ? (
      filteredEmptyState
    ) : (
      <ul
        aria-label={t('label', { caption, count: shownCount })}
        aria-busy={status === 'refetching' ? true : undefined}
      >
        {items.map((item) =>
          item.kind === 'gap' ? (
            item.height === 0 ? null : (
              <li key={item.key} aria-hidden="true" style={{ height: item.height }} />
            )
          ) : (
            renderRow(item.row, item.index)
          ),
        )}
      </ul>
    );

  return (
    <div
      data-slot="data-table-list"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="relative shrink-0 border-b border-border-subtle">
        {toolbar === undefined ? null : <div className="flex flex-wrap items-center gap-2 px-3 pt-2">{toolbar}</div>}
        {showCount ? (
          <div className="flex items-center gap-3 px-3 py-2">
            <p className="num type-meta">{lineText}</p>
            {showUpdating ? (
              <p className="flex items-center gap-1.5 type-meta">
                <Spinner size="sm" />
                {tt('updating')}
              </p>
            ) : null}
          </div>
        ) : null}
        {status === 'refetching' ? (
          <span
            data-slot="list-refetch-bar"
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
          />
        ) : null}
      </div>
      <div
        ref={region}
        data-slot="data-table-list-region"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        // Rounded down, so scrolling renders again every SCROLL_STEP pixels rather than on every event
        onScroll={(event) => setScrollTop(Math.floor(event.currentTarget.scrollTop / SCROLL_STEP) * SCROLL_STEP)}
      >
        {body}
      </div>
      {server === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
          <p className="w-full num type-meta">{server.rangeText}</p>
          <Button
            className="flex-1"
            disabled={!server.hasPrevious}
            // Stays focusable on the first page, so pressing it there does not drop focus
            focusableWhenDisabled
            onClick={server.onPrevious}
          >
            {tt('previous')}
          </Button>
          <Button className="flex-1" disabled={!server.hasNext} focusableWhenDisabled onClick={server.onNext}>
            {tt('next')}
          </Button>
        </div>
      )}
    </div>
  );
}

export type ListMode = 'list' | 'table';

export interface ListModeState {
  mode: ListMode;
  /** The layout is mobile and the device is not touch-primary: offer "List / Table". */
  canSwitch: boolean;
  onModeChange: (mode: ListMode) => void;
}

/**
 * `list` below 768 px unless the person chose Table; Table again from 768 px. The choice is component state
 * (presentation, not a view of the data) and is forgotten when the layout class changes. Server and
 * hydration render `table`, as both queries answer false there.
 */
export function useListMode(): ListModeState {
  const narrow = useMediaQuery(LIST_MEDIA);
  const touch = useMediaQuery(TOUCH_MEDIA);
  const [chose, setChose] = useState<{ narrow: boolean; table: boolean }>({ narrow, table: false });
  // A new layout class is a new screen: the earlier choice does not carry over
  if (chose.narrow !== narrow) setChose({ narrow, table: false });
  const canSwitch = narrow && !touch;
  return {
    mode: narrow && !(chose.table && canSwitch) ? 'list' : 'table',
    canSwitch,
    onModeChange: (mode) => setChose({ narrow, table: mode === 'table' }),
  };
}

export interface ListTableSwitchProps {
  mode: ListMode;
  onModeChange: (mode: ListMode) => void;
}

/** The "List / Table" control of a mobile layout on a screen that is not touch-primary (19 section 6.7 rule 7). */
export function ListTableSwitch({ mode, onModeChange }: ListTableSwitchProps): ReactElement {
  const t = useTranslations('common.dataTableList');
  return (
    <SegmentedControl<ListMode>
      semantics="view"
      size="sm"
      label={t('layout')}
      value={mode}
      // The control also passes the event details, which the caller's callback does not take
      onValueChange={(next) => onModeChange(next)}
      items={[
        { value: 'list', label: t('list') },
        { value: 'table', label: t('table') },
      ]}
    />
  );
}

export interface DataTableListSortProps<TRow extends RowData> {
  columns: readonly DataTableColumn<TRow>[];
  sort: readonly SortKey[];
  onSortChange: (sort: readonly SortKey[]) => void;
}

/**
 * The sort menu of the list (19 section 6.7 rule 4): a radio group of the sortable columns and one for the
 * direction, named "Sort: Mention rate" when a column sorts. Choosing a column keeps the direction. The list
 * sorts by one key, so a choice here replaces the table's two keys.
 */
export function DataTableListSort<TRow extends RowData>({
  columns,
  sort,
  onSortChange,
}: DataTableListSortProps<TRow>): ReactElement {
  const t = useTranslations('common.dataTableList');
  const tt = useTranslations('dataTable');
  const announceKey = `${useId()}-sort`;
  // The columns the table sorts by: a sort value and a type that has a default direction (not a sparkline)
  const sortable = columns.flatMap((candidate) => {
    const defaultDesc = COLUMN_TYPES[candidate.type].defaultDesc;
    return candidate.sortValue === undefined || defaultDesc === null ? [] : [{ column: candidate, defaultDesc }];
  });
  const first = sort[0];
  const column =
    first === undefined ? undefined : sortable.find((candidate) => candidate.column.id === first.id)?.column;
  const current = first !== undefined && column !== undefined ? first : undefined;
  // A change is spoken in the words of the table's own announcement (`DataTable` `changeSort`)
  const changeSort = (next: SortKey, header: string): void => {
    onSortChange([next]);
    announce(tt('sortedOne', { first: tt(next.desc ? 'descending' : 'ascending', { column: header }) }), {
      key: announceKey,
    });
  };
  const items: MenuItemDef[] = [
    ...sortable.map(({ column: candidate, defaultDesc }): MenuItemDef => ({
      id: candidate.id,
      label: candidate.header,
      kind: 'radio',
      group: t('sortBy'),
      checked: candidate.id === current?.id,
      onSelect: () => changeSort({ id: candidate.id, desc: current?.desc ?? defaultDesc }, candidate.header),
    })),
    // The direction belongs to a column, so there is none to choose while nothing sorts
    ...(current === undefined || column === undefined
      ? []
      : [false, true].map((desc): MenuItemDef => ({
          id: desc ? 'direction-descending' : 'direction-ascending',
          label: desc ? tt('sortDescending') : tt('sortAscending'),
          kind: 'radio',
          group: t('direction'),
          checked: current.desc === desc,
          onSelect: () => changeSort({ id: current.id, desc }, column.header),
        }))),
  ];
  return (
    <Menu
      items={items}
      trigger={
        <Button className="max-w-full min-w-0" disabled={items.length === 0}>
          <Icon icon={current === undefined ? ArrowUpDown : current.desc ? ArrowDown : ArrowUp} size="sm" />
          <span className="min-w-0 truncate">
            {column === undefined ? t('sortNone') : t('sort', { column: column.header })}
          </span>
          {current === undefined ? null : (
            <>
              {' '}
              <span className="sr-only">{tt(current.desc ? 'sortDescending' : 'sortAscending')}</span>
            </>
          )}
        </Button>
      }
    />
  );
}
