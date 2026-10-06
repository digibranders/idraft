import { useId, type ReactElement, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface PlainColumn<TRow> {
  id: string;
  header: string;
  /** Draws no text for the header, which still names the column for assistive technology (an actions column). */
  hideHeader?: boolean | undefined;
  /**
   * What a definition of the header says, such as the time zone a column's times are in. It is the header
   * cell's description for assistive technology and its tooltip on hover.
   */
  description?: string | undefined;
  align: 'left' | 'right';
  /** Lets a long value wrap onto more lines, where a value of one line stays on it. */
  wrap?: boolean | undefined;
  cell: (row: TRow) => ReactNode;
}

export interface PlainTableProps<TRow> {
  /** Names the table for assistive technology; not drawn. */
  caption: string;
  columns: readonly PlainColumn<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  /** A last row in bold, one node per column, such as the total. */
  footer?: readonly ReactNode[] | undefined;
  status: 'loading' | 'ready' | 'error';
  /** Shown instead of the table when the request failed. */
  errorState: ReactNode;
  /** Shown in one full-width row when there are no rows. */
  emptyText: string;
  /** How many placeholder rows draw while the rows load. Default 4. */
  skeletonRows?: number | undefined;
}

const alignClass = (align: PlainColumn<unknown>['align']): string =>
  align === 'right' ? 'text-right tabular-nums' : 'text-left';

/**
 * The plain table of a short, fixed list (a dozen rows at most): the markup of the members table, with money
 * and counts right-aligned in tabular figures (12-tables.md). Costs and the project's schedules use it.
 * Longer or sortable lists use `DataTable`.
 */
export function PlainTable<TRow>({
  caption,
  columns,
  rows,
  rowKey,
  footer,
  status,
  errorState,
  emptyText,
  skeletonRows = 4,
}: PlainTableProps<TRow>): ReactElement {
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
              <HeaderCell key={column.id} column={column} />
            ))}
          </tr>
        </thead>
        <tbody aria-busy={status === 'loading'}>
          {status === 'loading' ? (
            Array.from({ length: skeletonRows }, (_, row) => (
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
                      className={cn('px-4 py-2 type-body font-normal text-foreground', alignClass(column.align))}
                    >
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td
                      key={column.id}
                      className={cn(
                        'px-3 py-2 type-body text-foreground-secondary last:px-4',
                        column.wrap !== true && 'whitespace-nowrap',
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

/** A column header: its label, and its definition as the header's description and its tooltip. */
function HeaderCell<TRow>({ column }: { column: PlainColumn<TRow> }): ReactElement {
  const descriptionId = useId();
  const header = (
    <th
      scope="col"
      aria-describedby={column.description === undefined ? undefined : descriptionId}
      className={cn('h-row-header px-3 type-label whitespace-nowrap first:px-4 last:px-4', alignClass(column.align))}
    >
      {column.hideHeader === true ? <span className="sr-only">{column.header}</span> : column.header}
      {column.description === undefined ? null : (
        <span id={descriptionId} hidden>
          {column.description}
        </span>
      )}
    </th>
  );
  return column.description === undefined ? (
    header
  ) : (
    <Tooltip content={column.description} side="bottom" purpose="label">
      {header}
    </Tooltip>
  );
}
