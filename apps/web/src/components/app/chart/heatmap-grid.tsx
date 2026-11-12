'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { DIVERGING_BINS, SEQUENTIAL_BINS, cellUnder, divergingBin, sequentialBin, type HeatScale } from './heat-bins';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { MIN_OBSERVATIONS, type RateState } from '@/lib/stats';
import { CELL_CONTROL, moveFocus } from '@/lib/tables/grid-focus';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/** One cell: a rate (or a change in points) with the words and counts behind it. */
export interface HeatCell {
  /** Rate 0 to 1 (sequential) or change in points (diverging); read only when `state` is 'ok'. */
  value: number | null;
  /** The valid answers behind the cell; an insufficient cell prints it ("3 ans"). */
  answers: number;
  state: RateState;
  /** The printed value, "47%" or "+2.1 pts" (`@/lib/format`). */
  text: string;
  /**
   * The cell's accessible name and tooltip, with its counts (R1): "CRM for startups on ChatGPT: 47%, prompt
   * weighted over 17 prompts, 64 of 136 answers". The Table view prints it.
   */
  tip: string;
  /** Diverging only (R5): the fill is for a change whose 95% interval excludes 0, otherwise it is neutral. */
  detectable?: boolean | null | undefined;
  /** Where the cell goes: the prompt list filtered to its row and column. */
  href?: Route | undefined;
}

export interface HeatColumn {
  id: string;
  label: ReactNode;
}

export interface HeatRow {
  id: string;
  label: ReactNode;
  /** The row's plain name, "CRM": its accessible name, and what the disclosure button says it opens. */
  name: string;
  /** One per column, same order. */
  cells: readonly HeatCell[];
  /** The prompt count as text, "17", for the Prompts column. */
  prompts?: string | undefined;
  /** The row's own page; Enter on a row without children follows it. */
  href?: Route | undefined;
  /** Subtopics or prompts, shown in place under the row once it is opened. */
  children?: readonly HeatRow[] | undefined;
}

export interface HeatmapGridProps {
  caption: string;
  /** The header of the label column, "Topic". */
  rowHeader: string;
  /** The header of the Prompts column; the column shows when this is given and any row has a count. */
  promptsHeader?: string | undefined;
  /** Engines in fixed order, then "avg of 3" (R3, built by the feature). */
  columns: readonly HeatColumn[];
  /** Sorted by the feature. */
  rows: readonly HeatRow[];
  scale: HeatScale;
  /** Column indexes that start after a version boundary (CH-12): a 2 px `foreground-muted` rule on the left. */
  boundaries?: readonly number[] | undefined;
  density: Density;
  /** `table`: the Table view of the frame; no fill, each cell prints its `tip` words. */
  form?: 'grid' | 'table' | undefined;
}

/** DS 15 section 5: cell text is drawn only when the cell is at least this wide, in px. */
const MIN_TEXT_WIDTH = 36;
/** Rows a Page key moves; the grid has no scroll region of its own to measure. */
const PAGE_ROWS = 10;

/** Left side only: a colour for every side would override the hairline under the cell (`cn` merges them). */
const BOUNDARY = 'border-l-2 border-l-foreground-muted';
/**
 * The row header's width, once, as a custom property on the root: the column, and the scroll padding that keeps
 * a focused cell clear of the pinned header, read the same value. 12 steps of the spacing scale (192 px).
 */
const ROW_HEADER_VAR = '--heatmap-row-header';
const ROW_HEADER_STYLE = { [ROW_HEADER_VAR]: 'calc(var(--spacing) * 48)' } as CSSProperties;
/**
 * The pinned column: DS 19 rule 5a pins it only while it leaves 360 px for the data, and the smallest named
 * container width of 192 + 360 is `@xl` (576 px). Narrower, it scrolls away like a column. Its right edge shows
 * only while it is pinned (DS 19 section 3).
 */
const PINNED = '@xl:sticky @xl:left-0 @xl:z-(--z-pinned-cell) @xl:border-r @xl:border-r-border-subtle';
/** A data cell: no padding, so its fill reaches the edges, and a hairline under it. */
const CELL = 'border-b border-b-border-subtle p-0 outline-none';
const CELL_TEXT = 'text-center num';

interface VisibleRow {
  row: HeatRow;
  level: number;
  setSize: number;
  posInSet: number;
  parentId: string | null;
  expandable: boolean;
  expanded: boolean;
}

const hasChildren = (row: HeatRow): boolean => row.children !== undefined && row.children.length > 0;

function someRow(rows: readonly HeatRow[], test: (row: HeatRow) => boolean): boolean {
  return rows.some((row) => test(row) || someRow(row.children ?? [], test));
}

/** The rows on screen in order: a row's children follow it while it is open. */
function visibleRows(
  rows: readonly HeatRow[],
  open: ReadonlySet<string>,
  level = 1,
  parentId: string | null = null,
): VisibleRow[] {
  return rows.flatMap((row, index) => {
    const expandable = hasChildren(row);
    const expanded = expandable && open.has(row.id);
    const own: VisibleRow = { row, level, setSize: rows.length, posInSet: index + 1, parentId, expandable, expanded };
    return expanded ? [own, ...visibleRows(row.children ?? [], open, level + 1, row.id)] : [own];
  });
}

interface CellLook {
  fill: string;
  text: string;
  label: string;
}

/** The look of a cell, by its state. Hatched and empty cells carry no bin, whatever `value` holds (R2, R6). */
function cellLook(
  cell: HeatCell,
  scale: HeatScale,
  words: { insufficient: (answers: number) => string; none: string },
): CellLook {
  if (cell.state === 'insufficient') {
    return { fill: 'bg-insufficient', text: 'text-foreground-tertiary', label: words.insufficient(cell.answers) };
  }
  if (cell.state === 'none' || cell.value === null) {
    return { fill: 'bg-surface', text: 'text-foreground-tertiary', label: words.none };
  }
  const bin = scale === 'sequential' ? sequentialBin(cell.value) : divergingBin(cell.value, cell.detectable ?? null);
  return { fill: bin.fill, text: bin.text, label: cell.text };
}

/**
 * A rate heat-map as a real table (CH-04, CH-11, CH-12, CH-40): rows are topics or prompts, columns are
 * engines or weeks, each cell is one rate on the shared bins of `heat-bins.ts`. The printed value and the
 * cell's accessible name carry the numbers; the fill only helps scanning. A cell with fewer than 4 answers is
 * hatched and says how many it has, and a cell with none says n/a: neither shows a percent or a bin. One tab
 * stop, arrows move between cells, and Right and Left open and close a row that has children
 * (20-accessibility.md section 6.7). The grid is a `treegrid` while any row has children.
 */
export function HeatmapGrid({
  caption,
  rowHeader,
  promptsHeader,
  columns,
  rows,
  scale,
  boundaries = [],
  density,
  form = 'grid',
}: HeatmapGridProps): ReactElement {
  const t = useTranslations('chart.heatmap');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // The focused cell by its row's id, so opening a row above it does not move the focus
  const [focus, setFocus] = useState<{ rowId: string | null; column: number }>({ rowId: null, column: 0 });
  const focusRequested = useRef(false);
  const table = useRef<HTMLTableElement>(null);
  const firstDataHead = useRef<HTMLTableCellElement>(null);
  const [roomForText, setRoomForText] = useState(true);

  const visible = useMemo(() => visibleRows(rows, open), [rows, open]);
  const tree = useMemo(() => someRow(rows, hasChildren), [rows]);
  const showPrompts = promptsHeader !== undefined && someRow(rows, (row) => row.prompts !== undefined);
  const dataStart = showPrompts ? 2 : 1;
  const columnCount = dataStart + columns.length;
  // The observed header is keyed by its column's id, so a new first column is a new element to watch
  const firstColumnId = columns[0]?.id;
  const asTable = form === 'table';
  const rowIndex = Math.max(
    0,
    visible.findIndex((entry) => entry.row.id === focus.rowId),
  );
  const current = { row: rowIndex, column: Math.min(focus.column, columnCount - 1) };

  // One observer, on the first data column: every data column is as wide as it, so it decides for the cells
  useEffect(() => {
    const head = firstDataHead.current;
    if (asTable || head === null || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.target.getBoundingClientRect().width ?? 0;
      // No layout (0) draws the text; the state changes only when the answer does
      setRoomForText(width === 0 || width >= MIN_TEXT_WIDTH);
    });
    observer.observe(head);
    return () => observer.disconnect();
  }, [asTable, firstColumnId]);

  // A key moved the focus: the cell is rendered by now, whether a row opened or not
  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    const key = `${String(current.row)}:${String(current.column)}`;
    Array.from(table.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])
      .find((cell) => cell.dataset.cell === key)
      ?.focus();
  });

  const toggle = (id: string): void =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const moveTo = (row: number, column: number): void => {
    const target = visible[row];
    if (target === undefined) return;
    focusRequested.current = true;
    setFocus({ rowId: target.row.id, column });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    const target = event.target;
    // Keys in a portaled tooltip reach the table through React, and are not the grid's
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return;
    const cell = target.closest<HTMLElement>('[data-cell]');
    if (cell === null) return;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const at = visible[current.row];
    if (at === undefined) return;
    // A control inside the cell (the disclosure button) keeps Enter and Space
    if (target !== cell && (event.key === 'Enter' || event.key === ' ')) return;
    // Tree keys, on the row header (20-accessibility.md section 6.7); anywhere else the arrows move between cells
    if (current.column === 0 && plain && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      if (event.key === 'ArrowRight') {
        if (at.expandable && !at.expanded) {
          event.preventDefault();
          toggle(at.row.id);
          return;
        }
        if (at.expanded && visible[current.row + 1]?.parentId === at.row.id) {
          event.preventDefault();
          moveTo(current.row + 1, 0);
          return;
        }
      } else if (at.expanded) {
        event.preventDefault();
        toggle(at.row.id);
        return;
      } else if (at.parentId !== null) {
        event.preventDefault();
        moveTo(
          visible.findIndex((entry) => entry.row.id === at.parentId),
          0,
        );
        return;
      }
    }
    const moved = event.altKey
      ? null
      : moveFocus(
          current,
          event.key,
          { rows: visible.length, columns: columnCount, pageRows: PAGE_ROWS },
          {
            ctrl: event.ctrlKey || event.metaKey,
          },
        );
    if (moved !== null) {
      event.preventDefault();
      // There is no header row to reach: Up stops at the first row
      moveTo(Math.max(0, moved.row), moved.column);
      return;
    }
    // Enter on a linked cell is the link's own; on a row header it opens the row, or follows the row's link
    if (event.key === 'Enter' && target === cell && current.column === 0) {
      if (at.expandable) {
        event.preventDefault();
        toggle(at.row.id);
      } else if (at.row.href !== undefined) {
        event.preventDefault();
        cell.querySelector('a')?.click();
      }
    }
  };

  // The focusable cell's attributes: one cell is a tab stop, the first until another has had the focus
  const cellProps = (row: number, column: number, rowId: string): Record<string, unknown> => ({
    'data-cell': `${String(row)}:${String(column)}`,
    tabIndex: current.row === row && current.column === column ? 0 : -1,
    onFocus: (): void => {
      if (focus.rowId !== rowId || focus.column !== column) setFocus({ rowId, column });
    },
  });

  const words = {
    insufficient: (answers: number): string => t('insufficient', { count: answers }),
    none: t('none'),
  };
  const dataWidth = asTable ? 'w-60' : 'w-22';
  const headClass = 'sticky top-0 border-b border-border bg-surface-subtle px-3 font-normal type-table-header';

  return (
    <div style={ROW_HEADER_STYLE} className="@container flex min-w-0 flex-col gap-3">
      {/* Only this scrolls on a narrow screen, never the page; a pinned header leaves room for a focused cell */}
      <div className="min-w-0 overflow-x-auto rounded-md border border-border-subtle @xl:scroll-pl-(--heatmap-row-header)">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The role is grid or treegrid; the rule reads only a literal role */}
        <table
          ref={table}
          role={tree ? 'treegrid' : 'grid'}
          onKeyDown={onKeyDown}
          className="w-full table-fixed border-separate border-spacing-0 type-table"
        >
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className="w-(--heatmap-row-header)" />
            {showPrompts ? <col className="w-22" /> : null}
            {columns.map((column) => (
              <col key={column.id} className={dataWidth} />
            ))}
          </colgroup>
          <thead>
            <tr role="row" className="h-row-header">
              <th role="columnheader" scope="col" className={cn(headClass, PINNED, 'text-left')}>
                {rowHeader}
              </th>
              {showPrompts ? (
                <th role="columnheader" scope="col" className={cn(headClass, 'text-right')}>
                  {promptsHeader}
                </th>
              ) : null}
              {columns.map((column, index) => (
                <th
                  key={column.id}
                  ref={index === 0 ? firstDataHead : undefined}
                  role="columnheader"
                  scope="col"
                  className={cn(
                    headClass,
                    asTable ? 'text-left' : 'text-center',
                    boundaries.includes(index) && BOUNDARY,
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, level, setSize, posInSet, expandable, expanded }, index) => (
              <tr
                key={row.id}
                role="row"
                aria-level={tree ? level : undefined}
                aria-setsize={tree ? setSize : undefined}
                aria-posinset={tree ? posInSet : undefined}
                aria-expanded={expandable ? expanded : undefined}
                className={density === 'compact' ? 'h-row-compact' : 'h-row'}
              >
                <th
                  role="rowheader"
                  scope="row"
                  aria-label={row.name}
                  {...cellProps(index, 0, row.id)}
                  className={cn(
                    PINNED,
                    'border-b border-b-border-subtle bg-surface px-3 text-left font-normal outline-none focus-visible:focus-ring-inset',
                  )}
                >
                  <span className={cn('flex min-w-0 items-center gap-1', level === 2 && 'pl-6', level > 2 && 'pl-12')}>
                    {expandable ? (
                      <IconButton
                        icon={expanded ? ChevronDown : ChevronRight}
                        size="icon-xs"
                        label={t(expanded ? 'collapse' : 'expand', { name: row.name })}
                        aria-expanded={expanded}
                        tabIndex={-1}
                        onClick={() => toggle(row.id)}
                      />
                    ) : tree ? (
                      <span aria-hidden="true" className="size-6 shrink-0" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      {row.href === undefined ? (
                        row.label
                      ) : (
                        <Link href={row.href} {...CELL_CONTROL} className="hover:underline">
                          {row.label}
                        </Link>
                      )}
                    </span>
                  </span>
                </th>
                {showPrompts ? (
                  <td
                    role="gridcell"
                    {...cellProps(index, 1, row.id)}
                    className="border-b border-b-border-subtle px-3 text-right num outline-none focus-visible:focus-ring-inset"
                  >
                    {row.prompts}
                  </td>
                ) : null}
                {columns.map((column, columnIndex) => {
                  const cell = cellUnder(row.cells, columnIndex, row.name);
                  const position = dataStart + columnIndex;
                  const edge = boundaries.includes(columnIndex) ? BOUNDARY : null;
                  if (asTable) {
                    return (
                      <td
                        key={column.id}
                        role="gridcell"
                        {...cellProps(index, position, row.id)}
                        className={cn(
                          CELL,
                          'px-3 py-1 text-left align-top whitespace-normal focus-visible:focus-ring-inset',
                          edge,
                        )}
                      >
                        {cell.tip}
                      </td>
                    );
                  }
                  const look = cellLook(cell, scale, words);
                  const text = roomForText ? look.label : null;
                  const props = cellProps(index, position, row.id);
                  const tone = cn(look.fill, look.text, CELL_TEXT);
                  if (cell.href !== undefined) {
                    return (
                      <td key={column.id} role="gridcell" className={cn(CELL, 'relative', tone, edge)}>
                        <Tooltip content={cell.tip} purpose="label">
                          <Link
                            href={cell.href}
                            aria-label={cell.tip}
                            {...props}
                            className="absolute inset-0 flex items-center justify-center outline-none focus-visible:focus-ring-inset"
                          >
                            {text}
                          </Link>
                        </Tooltip>
                      </td>
                    );
                  }
                  return (
                    <Tooltip key={column.id} content={cell.tip} purpose="label">
                      <td
                        role="gridcell"
                        aria-label={cell.tip}
                        {...props}
                        className={cn(CELL, tone, edge, 'focus-visible:focus-ring-inset')}
                      >
                        {text}
                      </td>
                    </Tooltip>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {asTable ? null : <HeatKey scale={scale} />}
    </div>
  );
}

/** The key under the table: the bins with their bounds, then the two cells that have no bin. */
function HeatKey({ scale }: { scale: HeatScale }): ReactElement {
  const t = useTranslations('chart.heatmap');
  const bins = scale === 'sequential' ? SEQUENTIAL_BINS : DIVERGING_BINS;
  const swatch = 'size-4 shrink-0 rounded-xs border border-border-subtle forced-color-adjust-none';
  return (
    <ul aria-label={t('key')} className="flex flex-wrap items-center gap-x-4 gap-y-2 type-meta">
      {bins.map((bin) => (
        <li key={bin.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn(swatch, bin.fill)} />
          {t(`bins.${bin.key}`)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn(swatch, 'bg-insufficient')} />
        {t('keyInsufficient', { min: MIN_OBSERVATIONS })}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn(swatch, 'bg-surface')} />
        {t('keyNone')}
      </li>
    </ul>
  );
}
