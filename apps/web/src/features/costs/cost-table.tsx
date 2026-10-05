import type { ReactElement, ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface CostColumn<TRow> {
  id: string;
  header: string;
  align: 'left' | 'right';
  cell: (row: TRow) => ReactNode;
}

export interface CostTableProps<TRow> {
  /** Names the table for assistive technology; not drawn. */
  caption: string;
  columns: readonly CostColumn<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  /** A last row in bold, one node per column, such as the total. */
  footer?: readonly ReactNode[] | undefined;
  status: 'loading' | 'ready' | 'error';
  /** Shown instead of the table when the request failed. */
  errorState: ReactNode;
  /** Shown in one full-width row when there are no rows. */
  emptyText: string;
}

const SKELETON_ROWS = 4;

const alignClass = (align: CostColumn<unknown>['align']): string =>
  align === 'right' ? 'text-right tabular-nums' : 'text-left';

/**
 * The plain table of a short, fixed list (a dozen rows at most): the markup of the members table, with money
 * and counts right-aligned in tabular figures (12-tables.md). Longer or sortable lists use `DataTable`.
 */
export function CostTable<TRow>({
  caption,
  columns,
  rows,
  rowKey,
  footer,
  status,
  errorState,
  emptyText,
}: CostTableProps<TRow>): ReactElement {
  if (status === 'error') {
    return <div className="rounded-lg border border-border bg-surface">{errorState}</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle">
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  'h-row-header px-3 type-label whitespace-nowrap first:px-4 last:px-4',
                  alignClass(column.align),
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-busy={status === 'loading'}>
          {status === 'loading' ? (
            Array.from({ length: SKELETON_ROWS }, (_, row) => (
              <tr key={row} className="h-row border-t border-border-subtle">
                <td colSpan={columns.length} className="px-4">
                  <Skeleton shape="text-14" widthPct={56} />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr className="h-row border-t border-border-subtle">
              <td colSpan={columns.length} className="px-4 type-body text-foreground-secondary">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="h-row border-t border-border-subtle">
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th
                      key={column.id}
                      scope="row"
                      className={cn('px-4 type-body font-normal text-foreground', alignClass(column.align))}
                    >
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td
                      key={column.id}
                      className={cn(
                        'px-3 type-body whitespace-nowrap text-foreground-secondary last:px-4',
                        alignClass(column.align),
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
        {status === 'ready' && rows.length > 0 && footer !== undefined ? (
          <tfoot>
            <tr className="h-row border-t border-border bg-surface-subtle">
              {columns.map((column, index) => (
                <td
                  key={column.id}
                  className={cn('px-3 type-body-strong text-foreground first:px-4 last:px-4', alignClass(column.align))}
                >
                  {footer[index]}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
