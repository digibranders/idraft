import type { ReactElement, ReactNode } from 'react';

export interface SharesSegment {
  id: string;
  name: string;
  /** The colour token without the dashes, for the dot beside the name. */
  token: string;
}

export interface SharesColumn {
  id: string;
  /** "ChatGPT": read by a screen reader; drawn only through `icon`, because the chart names its subjects itself. */
  label: string;
  /** The platform mark, decorative. */
  icon?: ReactNode;
  /** Small text under the mark: "166 answers". */
  sub?: string | undefined;
  /** One cell per segment, in the order of the segments; `null` is a subject with nothing to show ("n/a"). */
  cells: readonly { text: string; tip?: string | undefined }[] | null;
  /** What a subject with nothing to show says, once, in its first row: "Too few mentions". */
  noneText: string;
}

export interface SharesTableProps {
  segments: readonly SharesSegment[];
  columns: readonly SharesColumn[];
  caption: string;
}

/**
 * The exact shares of every segment for every subject of a chart, with a dot of each segment's colour in the row head
 * (15-data-visualization.md section 1a): the legend of the chart and its text alternative, so a colour never carries a
 * number alone. Fixed columns, so a long name wraps in its column instead of pushing the table out of the card.
 */
export function SharesTable({ segments, columns, caption }: SharesTableProps): ReactElement {
  return (
    <table className="w-full table-fixed type-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="text-left" style={{ width: '34%' }}>
            <span className="sr-only">{caption}</span>
          </th>
          {columns.map((column) => (
            <th key={column.id} scope="col" className="min-w-0 pl-1 text-right type-micro font-normal break-words">
              <span className="flex items-center justify-end gap-1">
                {column.icon}
                <span className="sr-only">{column.label}</span>
              </span>
              {column.sub === undefined ? null : <span className="block num text-foreground-tertiary">{column.sub}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {segments.map((segment, index) => (
          <tr key={segment.id} className="border-t border-border-subtle">
            <th scope="row" className="py-1 pr-2 text-left font-normal text-foreground-secondary">
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block size-2 rounded-2xs align-middle"
                style={{ backgroundColor: `var(--${segment.token})` }}
              />
              {segment.name}
            </th>
            {columns.map((column) => {
              const cell = column.cells?.[index];
              return (
                <td
                  key={column.id}
                  className="py-1 pl-1 text-right num text-foreground"
                  title={cell?.tip}
                >
                  {column.cells === null ? (index === 0 ? column.noneText : '') : cell?.text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
