import type { ReactElement, ReactNode } from 'react';

import type { CellTip, ColumnPriority, DataTableColumn } from './types';
import { CollectionStatusIcon, type CollectionStatus } from '@/components/app/status/collection-progress';
import { Badge } from '@/components/ui/badge';
import { Truncate } from '@/components/ui/truncate';
import { EMPTY_VALUE, formatCurrency, formatInteger, formatTableDateTime } from '@/lib/format';
import { COLUMN_TYPES, type ColumnType } from '@/lib/tables/column-types';

/**
 * The column helpers of 25-component-inventory.md section 7.13: each fixes its type's width, alignment,
 * default sort direction and cell, so a screen names only the header, the priority and the values.
 */

/** What a cell shows for a value that is missing (12-tables.md section 7.3): never an empty cell. */
export interface UnknownValue {
  label: string;
  tooltip?: string | undefined;
}

interface Options {
  header: string;
  headerTooltip?: string | undefined;
  priority?: ColumnPriority | undefined;
  /** The screen's default width, kept between the type's minimum and maximum. */
  width?: number | undefined;
  defaultVisible?: boolean | undefined;
  /** Whether the column sorts; on by default for the types that sort. */
  sortable?: boolean | undefined;
}

const clampWidth = (type: ColumnType, width: number | undefined): number | undefined => {
  if (width === undefined) return undefined;
  const spec = COLUMN_TYPES[type];
  return Math.min(spec.max, Math.max(spec.min, width));
};

function base<TRow>(
  id: string,
  type: ColumnType,
  options: Options,
  cell: (row: TRow) => ReactNode,
  sortValue: ((row: TRow) => string | number | null) | undefined,
  cellTip?: ((row: TRow) => CellTip | undefined) | undefined,
): DataTableColumn<TRow> {
  return {
    id,
    type,
    header: options.header,
    headerTooltip: options.headerTooltip,
    cellTip,
    priority: options.priority ?? 1,
    width: clampWidth(type, options.width),
    defaultVisible: options.defaultVisible ?? true,
    sortValue: options.sortable === false ? undefined : sortValue,
    cell,
  };
}

/** A missing value: `n/a`, or the column's own word for it, in tertiary text. Its reason is the cell's tooltip. */
function Unknown({ value }: { value: UnknownValue }): ReactElement {
  return <span className="text-foreground-tertiary">{value.label}</span>;
}

/** The tooltip of a cell that shows a missing value: the reason, when the column gives one. */
const reasonTip = (value: UnknownValue | undefined): CellTip | undefined =>
  value?.tooltip === undefined ? undefined : { content: value.tooltip };

const NOT_AVAILABLE: UnknownValue = { label: EMPTY_VALUE };

export const col = {
  /** The identity column: the row header, flexible width, pinned left, never hidden. */
  keyword<TRow>(
    id: string,
    text: (row: TRow) => string,
    options: Options & { detail?: ((row: TRow) => string) | undefined },
  ): DataTableColumn<TRow> {
    return {
      ...base(
        id,
        'keyword',
        options,
        (row) => {
          const value = text(row);
          // With a detail the cell's own tooltip shows the value and the detail
          return options.detail?.(row) === undefined ? (
            <Truncate text={value} className="text-foreground" />
          ) : (
            <span className="block min-w-0 truncate text-foreground">{value}</span>
          );
        },
        (row) => text(row).toLocaleLowerCase(),
        (row) => {
          const detail = options.detail?.(row);
          // The value is the cell's name: its description is the detail alone
          return detail === undefined ? undefined : { content: text(row), detail, description: detail };
        },
      ),
      identity: true,
    };
  },

  /** Short text, such as a group path or tags, truncated with its full value on hover. */
  text<TRow>(
    id: string,
    value: (row: TRow) => string | null,
    options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  ): DataTableColumn<TRow> {
    return base(
      id,
      'text',
      options,
      (row) => {
        const text = value(row);
        return text === null ? <Unknown value={options.unknown?.(row) ?? NOT_AVAILABLE} /> : <Truncate text={text} />;
      },
      (row) => value(row)?.toLocaleLowerCase() ?? null,
      (row) => (value(row) === null ? reasonTip(options.unknown?.(row)) : undefined),
    );
  },

  /** An exact grouped count (`12,400`), right-aligned in tabular figures. */
  count<TRow>(
    id: string,
    value: (row: TRow) => number | null,
    options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  ): DataTableColumn<TRow> {
    return numeric(id, 'count', value, options, (number) => formatInteger(number));
  },

  /** A search volume: as a count, sorted high to low first. */
  volume<TRow>(
    id: string,
    value: (row: TRow) => number | null,
    options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  ): DataTableColumn<TRow> {
    return numeric(id, 'volume', value, options, (number) => formatInteger(number));
  },

  /** A cost in US dollars, two decimals. */
  currency<TRow>(
    id: string,
    value: (row: TRow) => number | null,
    options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  ): DataTableColumn<TRow> {
    return numeric(id, 'currency', value, options, (number) => formatCurrency(number));
  },

  /** A date and time in the project's time zone (`Sep 29, 18:32`), newest first. */
  date<TRow>(
    id: string,
    value: (row: TRow) => string | null,
    options: Options & {
      timeZone: string;
      secondary?: boolean | undefined;
      /** What a row without a date shows; `n/a` when the column gives none. */
      unknown?: ((row: TRow) => UnknownValue) | undefined;
      /** A word before the date, such as a "Stale" marker; `null` for a row without one. */
      marker?: ((row: TRow) => ReactNode) | undefined;
      /** The tooltip of a row that has a date (a row without one explains itself through `unknown`). */
      cellTip?: ((row: TRow) => CellTip | undefined) | undefined;
    },
  ): DataTableColumn<TRow> {
    return base(
      id,
      'date',
      options,
      (row) => {
        const instant = value(row);
        if (instant === null) return <Unknown value={options.unknown?.(row) ?? NOT_AVAILABLE} />;
        const date = (
          <span className={options.secondary === true ? 'num text-foreground-tertiary' : 'num'}>
            {formatTableDateTime(instant, options.timeZone)}
          </span>
        );
        const marker = options.marker?.(row) ?? null;
        return marker === null ? (
          date
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {marker}
            {date}
          </span>
        );
      },
      (row) => {
        const instant = value(row);
        return instant === null ? null : Date.parse(instant);
      },
      (row) => (value(row) === null ? reasonTip(options.unknown?.(row)) : options.cellTip?.(row)),
    );
  },

  /**
   * A collection status: its glyph in the status color beside its word (17-empty-loading-error-states.md
   * section 4.1). Sorts by the word.
   */
  status<TRow>(
    id: string,
    value: (row: TRow) => { status: CollectionStatus; label: string } | null,
    options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  ): DataTableColumn<TRow> {
    return base(
      id,
      'status',
      options,
      (row) => {
        const state = value(row);
        if (state === null) return <Unknown value={options.unknown?.(row) ?? NOT_AVAILABLE} />;
        return (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <CollectionStatusIcon status={state.status} />
            <Truncate text={state.label} />
          </span>
        );
      },
      (row) => value(row)?.label.toLocaleLowerCase() ?? null,
      (row) => (value(row) === null ? reasonTip(options.unknown?.(row)) : undefined),
    );
  },

  /**
   * A rank: right aligned, best (lowest) first. The cell is the screen's, since what it shows depends on the
   * check (a number, `>20`, Pending, a failure); `sortValue` is the rank, or `null` for a keyword with none,
   * which sorts last both ways (12-tables.md sections 6 and 8).
   */
  rank<TRow>(id: string, sortValue: (row: TRow) => number | null, options: RichOptions<TRow>): DataTableColumn<TRow> {
    return rich(id, 'rank', sortValue, options);
  },

  /** A change in rank: right aligned, the biggest improvement first; `null` sorts last both ways. */
  rankDelta<TRow>(
    id: string,
    sortValue: (row: TRow) => number | null,
    options: RichOptions<TRow>,
  ): DataTableColumn<TRow> {
    return rich(id, 'rankDelta', sortValue, options);
  },

  /** A URL: left aligned, A to Z; `null` sorts last both ways. */
  url<TRow>(id: string, sortValue: (row: TRow) => string | null, options: RichOptions<TRow>): DataTableColumn<TRow> {
    return rich(id, 'url', sortValue, options);
  },

  /** A neutral badge, such as an intent. */
  badge<TRow>(
    id: string,
    value: (row: TRow) => { label: string; detail?: string | undefined } | null,
    options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  ): DataTableColumn<TRow> {
    return base(
      id,
      'badge',
      options,
      (row) => {
        const badge = value(row);
        if (badge === null) return <Unknown value={options.unknown?.(row) ?? NOT_AVAILABLE} />;
        return badge.detail === undefined ? (
          <Badge>{badge.label}</Badge>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Badge>{badge.label}</Badge>
            <span className="type-meta">{badge.detail}</span>
          </span>
        );
      },
      (row) => value(row)?.label.toLocaleLowerCase() ?? null,
      (row) => (value(row) === null ? reasonTip(options.unknown?.(row)) : undefined),
    );
  },
};

/** The options of a column whose cell and tooltip the screen builds, since they depend on more than one value. */
interface RichOptions<TRow> extends Options {
  /** The cell's content. */
  cell: (row: TRow) => ReactNode;
  /** The cell's tooltip and description; the table puts it on the cell that holds the focus. */
  cellTip?: ((row: TRow) => CellTip | undefined) | undefined;
}

function rich<TRow>(
  id: string,
  type: Extract<ColumnType, 'rank' | 'rankDelta' | 'url'>,
  sortValue: (row: TRow) => string | number | null,
  options: RichOptions<TRow>,
): DataTableColumn<TRow> {
  return base(id, type, options, options.cell, sortValue, options.cellTip);
}

function numeric<TRow>(
  id: string,
  type: Extract<ColumnType, 'count' | 'volume' | 'currency'>,
  value: (row: TRow) => number | null,
  options: Options & { unknown?: ((row: TRow) => UnknownValue) | undefined },
  format: (value: number) => string,
): DataTableColumn<TRow> {
  return base(
    id,
    type,
    options,
    (row) => {
      const number = value(row);
      return number === null ? (
        <Unknown value={options.unknown?.(row) ?? NOT_AVAILABLE} />
      ) : (
        <span className="num">{format(number)}</span>
      );
    },
    value,
    (row) => (value(row) === null ? reasonTip(options.unknown?.(row)) : undefined),
  );
}
