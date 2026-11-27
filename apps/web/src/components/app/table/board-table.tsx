'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';

import { clampWidth, limitsOf, widthForKey, widthOfColumn, type ColumnWidths } from './board-widths';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
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
  /** With `resize` on the table: the narrowest the column goes, in pixels (default 60 percent of `width`, at least 56). */
  least?: number | undefined;
  /** With `resize` on the table: the widest the column goes, in pixels (default double `width`, 360 to 560). */
  widest?: number | undefined;
  /** The key the table's sort names; a column without one does not sort. */
  sortKey?: string | undefined;
  cell: (row: TRow) => ReactNode;
  /** Type and layout classes of the cell: `num`, `truncate text-foreground-secondary`. */
  cellClassName?: string | undefined;
  /** The cell's tooltip, such as "Lost on Gemini to HubSpot" (C 661). */
  cellTip?: ((row: TRow) => string | undefined) | undefined;
}

/** Opt-in column resizing: the widths in use, how a change is kept, and the words of each header's separator. */
export interface BoardResize {
  widths: ColumnWidths;
  /** A width in pixels, or `null` for the column's default. */
  onChange: (id: string, width: number | null) => void;
  /** The separator's name: "Resize the Rank column". */
  label: (header: string) => string;
  /** The separator's value as a sentence: "120 pixels wide". */
  valueText: (width: number) => string;
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
  /** Makes the columns that have a width adjustable: drag a header's right edge, or focus it and use the keys. */
  resize?: BoardResize | undefined;
}

const HEADER =
  'sticky top-0 h-row-header border-b border-border bg-surface-subtle px-3 text-left align-middle font-normal not-last:border-r not-last:border-r-border-subtle';
const CELL = 'border-b border-border-subtle px-3';
// The pinned first column keeps the row's ground when the row is hovered or open in the drawer (C 83 to 84)
const PIN =
  'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover group-data-active:bg-surface-selected';
const DEFAULT_FLEX_MIN = 280;

/** The right edge of a header: a vertical separator that a pointer drags and the keys move. */
function ResizeHandle<TRow>({
  column,
  width,
  resize,
}: {
  column: BoardColumn<TRow>;
  width: number;
  resize: BoardResize;
}): ReactElement {
  const limits = limitsOf(column.width ?? width, column.least, column.widest);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const move = (next: number | null): void => {
    resize.onChange(column.id, next === null || next === limits.default ? null : next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = widthForKey(event.key, event.shiftKey, width, limits);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    move(next);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.current = { x: event.clientX, width };
  };
  return (
    // A focusable separator is the WAI-ARIA window splitter: it takes the keys and carries a value, so it is interactive
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={resize.label(column.header)}
      aria-valuemin={limits.least}
      aria-valuemax={limits.widest}
      aria-valuenow={width}
      aria-valuetext={resize.valueText(width)}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="absolute inset-y-0 right-0 z-(--z-table-header) w-2 cursor-col-resize touch-none outline-none hover:bg-border focus-visible:bg-primary active:bg-primary"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (drag.current !== null) move(clampWidth(drag.current.width + event.clientX - drag.current.x, limits));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={() => move(null)}
    />
  );
}

function HeaderCell<TRow>({
  column,
  pinned,
  sort,
  onSortChange,
  resize,
}: {
  column: BoardColumn<TRow>;
  pinned: boolean;
  sort: BoardSort;
  onSortChange: (next: BoardSort) => void;
  resize?: BoardResize | undefined;
}): ReactElement {
  const width = resize === undefined ? null : widthOfColumn(column, resize.widths);
  const sortKey = column.sortKey;
  const active = sortKey !== undefined && sort.key === sortKey;
  // The pinned corner sits above the other headers and the pinned cells (C 334 to 338)
  const layer = pinned ? 'left-0 z-(--z-sticky)' : 'z-(--z-table-header)';
  // The preview's tip covers the whole header (C 318 to 380): the trigger's pseudo-element reaches the sticky `th`
  const reach = column.tip === undefined ? undefined : 'after:absolute after:inset-0';
  const label = (
    <>
      {column.headerLead}
      <span className={cn('truncate type-table-header', active && 'text-foreground')}>{column.header}</span>
    </>
  );
  const content =
    sortKey === undefined ? (
      <span className={cn('flex min-w-0 items-center gap-1.5', reach)}>{label}</span>
    ) : (
      <button
        type="button"
        className={cn('flex min-w-0 items-center gap-1 rounded-sm outline-none focus-visible:focus-ring', reach)}
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
      {resize !== undefined && width !== null ? <ResizeHandle column={column} width={width} resize={resize} /> : null}
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
  resize,
}: BoardTableProps<TRow>): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const reached = useRef(onEndReached);
  useEffect(() => {
    reached.current = onEndReached;
  }, [onEndReached]);
  // A new order starts at its first row, not where the last one was scrolled to
  useEffect(() => {
    if (scroller.current !== null) scroller.current.scrollTop = 0;
  }, [sort.key, sort.dir]);
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
    // A new page can leave the sentinel inside the margin: observing again delivers a fresh initial entry
  }, [rows.length]);
  const widthOf = (column: BoardColumn<TRow>): number | null =>
    resize === undefined ? column.width : widthOfColumn(column, resize.widths);
  const minWidth = columns.reduce((sum, column) => sum + (widthOf(column) ?? flexMin), 0);
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
          {columns.map((column) => {
            const width = widthOf(column);
            return <col key={column.id} style={width === null ? undefined : { width: `${String(width)}px` }} />;
          })}
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
                resize={resize}
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
                      // React events bubble through portals: a click in a popover that is a child of the row is not the row's
                      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
                      if (event.target instanceof Element && event.target.closest('[data-cell-action]') !== null)
                        return;
                      // The row cannot take focus: the identity button is where focus returns after a click on the row
                      onOpen(row, event.currentTarget.querySelector<HTMLElement>('button') ?? event.currentTarget);
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

const SKELETON_WIDTHS = [72, 56, 80, 64, 48, 72, 56, 64] as const;

/** The table while its first rows load (17 section 3): the real headers, eight rows of pulsing bars. */
export function BoardTableSkeleton({
  columns,
  rows = 8,
  flexMin = DEFAULT_FLEX_MIN,
}: {
  columns: readonly Pick<BoardColumn<unknown>, 'id' | 'header' | 'width'>[];
  rows?: number | undefined;
  flexMin?: number | undefined;
}): ReactElement {
  const minWidth = columns.reduce((sum, column) => sum + (column.width ?? flexMin), 0);
  return (
    <div className="relative isolate min-h-0 flex-1 overflow-hidden" aria-hidden="true">
      <table
        className="table-fixed border-separate border-spacing-0 type-table"
        style={{ width: '100%', minWidth: `${String(minWidth)}px` }}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={column.width === null ? undefined : { width: `${String(column.width)}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={cn(HEADER, 'z-(--z-table-header)')}>
                <span className="truncate type-table-header">{column.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} className="h-row">
              {columns.map((column, index) => (
                <td key={column.id} className={CELL}>
                  <Skeleton shape="text-13" widthPct={SKELETON_WIDTHS[(row + index) % SKELETON_WIDTHS.length] ?? 64} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
