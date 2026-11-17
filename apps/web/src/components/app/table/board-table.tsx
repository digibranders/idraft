'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface BoardSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface BoardColumn<TRow> {
  id: string;
  header: string;
  /** Before the header text, such as a competitor's colour dot (C 632). */
  headerLead?: ReactNode;
  /** The header's definition, its tooltip (C 346). */
  tip?: string | undefined;
  /** Pixels; `null` for the one flexible column, which takes the rest of the panel down to `flexMin` (C 367 to 379). */
  width: number | null;
  /** The key the table's sort names; a column without one does not sort. */
  sortKey?: string | undefined;
  cell: (row: TRow) => ReactNode;
  /** Type and layout classes of the cell: `num`, `truncate text-foreground-secondary`. */
  cellClassName?: string | undefined;
  /** The cell's tooltip, such as "Lost on Gemini to HubSpot" (C 661). */
  cellTip?: ((row: TRow) => string | undefined) | undefined;
}

export interface BoardTableProps<TRow> {
  /** Names the table for assistive technology. */
  caption: string;
  /** The first column is the identity: pinned left, its content is the row's button. */
  columns: readonly BoardColumn<TRow>[];
  rows: readonly TRow[];
  rowId: (row: TRow) => string;
  /** The row button's name: "Open northwind.com/pricing" (C 406). */
  rowLabel: (row: TRow) => string;
  /** The row button's tooltip: "<title> (<url>)" (C 483), with a lighter second line when given. */
  identityTip?: ((row: TRow) => { content: string; detail?: string | undefined } | undefined) | undefined;
  /** Opens the row; `opener` is where focus returns when the drawer closes. */
  onOpen: (row: TRow, opener: HTMLElement) => void;
  /** The row open in the inspector. */
  activeId: string | null;
  sort: BoardSort;
  onSortChange: (next: BoardSort) => void;
  /** The narrowest the flexible column gets: 280 px (C 368). */
  flexMin?: number | undefined;
  /** Called when the scroll reaches the last row, to read the next page (D-6). */
  onEndReached?: (() => void) | undefined;
  /** A read of new rows is under way while these stay (17 section 4). */
  busy?: boolean | undefined;
}

const HEADER =
  'sticky top-0 h-row-header border-b border-border bg-surface-subtle px-3 text-left align-middle font-normal not-last:border-r not-last:border-r-border-subtle';
const CELL = 'border-b border-border-subtle px-3';
// The pinned first column keeps the row's ground when the row is hovered or open in the drawer (C 83 to 84)
const PIN =
  'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover group-data-active:bg-surface-selected';
const DEFAULT_FLEX_MIN = 280;

function HeaderCell<TRow>({
  column,
  pinned,
  sort,
  onSortChange,
}: {
  column: BoardColumn<TRow>;
  pinned: boolean;
  sort: BoardSort;
  onSortChange: (next: BoardSort) => void;
}): ReactElement {
  const sortKey = column.sortKey;
  const active = sortKey !== undefined && sort.key === sortKey;
  // The pinned corner sits above the other headers and the pinned cells (C 334 to 338)
  const layer = pinned ? 'left-0 z-(--z-sticky)' : 'z-(--z-table-header)';
  const label = (
    <>
      {column.headerLead}
      <span className={cn('truncate type-table-header', active && 'text-foreground')}>{column.header}</span>
    </>
  );
  const content =
    sortKey === undefined ? (
      <span className="flex min-w-0 items-center gap-1.5">{label}</span>
    ) : (
      <button
        type="button"
        className="flex min-w-0 items-center gap-1 rounded-sm outline-none focus-visible:focus-ring"
        onClick={() => onSortChange({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      >
        {label}
        {active ? (
          <Icon
            icon={sort.dir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow}
            size="sm"
            className="shrink-0 text-foreground"
          />
        ) : null}
      </button>
    );
  let ariaSort: 'ascending' | 'descending' | 'none' | undefined;
  if (sortKey !== undefined) ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={cn(HEADER, layer)}>
      {column.tip === undefined ? (
        content
      ) : (
        <Tooltip content={column.tip} side="bottom">
          {content}
        </Tooltip>
      )}
    </th>
  );
}

/**
 * The table of an analysis board (12-tables.md section 20, the preview's Citations table, C 318 to 408): fixed column
 * widths with one flexible column, a sticky header, a pinned first column whose content is the row's button, headers
 * that sort descending first and ascending on a second click, a row click that opens the drawer except on a cell action
 * (`data-cell-action`), and a callback at the end of the scroll for the next page. It scrolls inside its panel.
 */
export function BoardTable<TRow>({
  caption,
  columns,
  rows,
  rowId,
  rowLabel,
  identityTip,
  onOpen,
  activeId,
  sort,
  onSortChange,
  flexMin = DEFAULT_FLEX_MIN,
  onEndReached,
  busy = false,
}: BoardTableProps<TRow>): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const reached = useRef(onEndReached);
  useEffect(() => {
    reached.current = onEndReached;
  }, [onEndReached]);
  useEffect(() => {
    const root = scroller.current;
    const target = end.current;
    if (root === null || target === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) reached.current?.();
      },
      { root, rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const minWidth = columns.reduce((sum, column) => sum + (column.width ?? flexMin), 0);
  const [identity, ...rest] = columns;
  return (
    <div ref={scroller} className="relative isolate min-h-0 flex-1 overflow-auto">
      <table
        aria-busy={busy ? true : undefined}
        className="table-fixed border-separate border-spacing-0 type-table"
        style={{ width: '100%', minWidth: `${String(minWidth)}px` }}
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={column.width === null ? undefined : { width: `${String(column.width)}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                column={column}
                pinned={index === 0}
                sort={sort}
                onSortChange={onSortChange}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {identity === undefined
            ? null
            : rows.map((row) => {
                const id = rowId(row);
                const tip = identityTip?.(row);
                const button = (
                  <button
                    type="button"
                    aria-label={rowLabel(row)}
                    className="flex max-w-full min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:focus-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(row, event.currentTarget);
                    }}
                  >
                    {identity.cell(row)}
                  </button>
                );
                return (
                  // The row's button is the keyboard way in (C 396); a click anywhere on the row is a mouse convenience
                  <tr
                    key={id}
                    data-id={id}
                    data-active={activeId === id ? '' : undefined}
                    className="group h-row cursor-pointer bg-surface hover:bg-surface-hover data-active:bg-surface-selected"
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('[data-cell-action]') !== null)
                        return;
                      onOpen(row, event.currentTarget);
                    }}
                  >
                    <td className={cn(CELL, PIN, identity.cellClassName)}>
                      {tip === undefined ? (
                        button
                      ) : (
                        <Tooltip content={tip.content} detail={tip.detail}>
                          {button}
                        </Tooltip>
                      )}
                    </td>
                    {rest.map((column) => {
                      const cellTip = column.cellTip?.(row);
                      const content = column.cell(row);
                      return (
                        <td key={column.id} className={cn(CELL, column.cellClassName)}>
                          {cellTip === undefined ? (
                            content
                          ) : (
                            <Tooltip content={cellTip} purpose="label">
                              <span className="block min-w-0">{content}</span>
                            </Tooltip>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
        </tbody>
      </table>
      <div ref={end} aria-hidden="true" className="h-px" />
    </div>
  );
}
