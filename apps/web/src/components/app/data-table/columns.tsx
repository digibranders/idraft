import type { ReactElement, ReactNode } from 'react';

import type { ColumnPriority, DataTableColumn } from './types';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
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
): DataTableColumn<TRow> {
  return {
    id,
    type,
    header: options.header,
    headerTooltip: options.headerTooltip,
    priority: options.priority ?? 1,
    width: clampWidth(type, options.width),
    defaultVisible: options.defaultVisible ?? true,
    sortValue: options.sortable === false ? undefined : sortValue,
    cell,
  };
}

/** A missing value: `n/a`, or the column's own word for it, in tertiary text with its reason on hover. */
function Unknown({ value }: { value: UnknownValue }): ReactElement {
  const text = <span className="text-foreground-tertiary">{value.label}</span>;
  return value.tooltip === undefined ? (
    text
  ) : (
    <Tooltip content={value.tooltip}>
      <span className="text-foreground-tertiary" tabIndex={-1}>
        {value.label}
      </span>
    </Tooltip>
  );
}

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
          const detail = options.detail?.(row);
          return detail === undefined ? (
            <Truncate text={value} className="text-foreground" />
          ) : (
            <Tooltip content={value} detail={detail}>
              <span className="block min-w-0 truncate text-foreground" tabIndex={-1}>
                {value}
              </span>
            </Tooltip>
          );
        },
        (row) => text(row).toLocaleLowerCase(),
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
    options: Options & { timeZone: string; secondary?: boolean | undefined },
  ): DataTableColumn<TRow> {
    return base(
      id,
      'date',
      options,
      (row) => {
        const instant = value(row);
        return instant === null ? (
          <Unknown value={NOT_AVAILABLE} />
        ) : (
          <span className={options.secondary === true ? 'num text-foreground-tertiary' : 'num'}>
            {formatTableDateTime(instant, options.timeZone)}
          </span>
        );
      },
      (row) => {
        const instant = value(row);
        return instant === null ? null : Date.parse(instant);
      },
    );
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
    );
  },
};

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
  );
}
