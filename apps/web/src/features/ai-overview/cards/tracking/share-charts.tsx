'use client';

import type { ReactElement } from 'react';

import type { ShareRow, ShareSegment } from './share-types';
import { RingsChart, type RingsChartRow } from '@/components/app/chart/rings-chart';
import { SharesTable, type SharesColumn } from '@/components/app/chart/shares-table';
import { StackedColumnsChart } from '@/components/app/chart/stacked-columns-chart';

export interface ShareChartProps {
  segments: readonly ShareSegment[];
  rows: readonly ShareRow[];
  caption: string;
  /** What the chart shows in words, for people who cannot see it. */
  label: string;
}

/** The chart is 176 px (rings) or 280 px (columns) tall. */
const RING_HEIGHT = 176;
const COLUMNS_HEIGHT = 280;

/** The shares of a row, or `null` for a row that has none and says why in a chip. */
const sharesOf = (row: ShareRow): readonly { share: number; shareText: string; tip: string }[] | null =>
  row.body.kind === 'shares' ? row.body.cells : null;

/** The table under a chart: every share of every platform in text, with the reason a platform has none. */
function TableOf({ segments, rows, caption }: Omit<ShareChartProps, 'label'>): ReactElement {
  const columns: SharesColumn[] = rows.map((row) => {
    const cells = sharesOf(row);
    return {
      id: row.id,
      label: row.label,
      icon: row.icon,
      sub: row.note,
      noneText: row.body.kind === 'chip' ? row.body.text : '',
      cells: cells === null ? null : cells.map((cell) => ({ text: cell.shareText, tip: cell.tip })),
    };
  });
  return (
    <SharesTable
      caption={caption}
      segments={segments.map(({ id, name, token }) => ({ id, name, token }))}
      columns={columns}
    />
  );
}

/**
 * One plain ring per platform with the share of the first segment in the middle (the tone card: how many mentions are
 * positive), the platform name below, and the exact shares in a table under the rings (15-data-visualization.md section
 * 1a). A platform with nothing to show is an empty ring that says why under its name.
 */
export function ShareRings({ segments, rows, caption, label }: ShareChartProps): ReactElement {
  const ringRows: RingsChartRow[] = rows.map((row) => {
    const cells = sharesOf(row);
    return {
      id: row.id,
      label: row.label,
      center: cells?.[0]?.shareText ?? '',
      sub: row.body.kind === 'chip' ? row.body.text : undefined,
      shares: cells === null ? null : cells.map((cell) => cell.share),
      tips: cells === null ? [] : cells.map((cell) => cell.tip),
    };
  });
  return (
    <div className="flex flex-col gap-3">
      <RingsChart
        height={RING_HEIGHT}
        label={label}
        segments={segments.map(({ id, name, token }) => ({ id, name, token }))}
        rows={ringRows}
      />
      <TableOf segments={segments} rows={rows} caption={caption} />
    </div>
  );
}

/**
 * One stacked 100% column per platform (the position card: where the brand is named), with the platform's note under its
 * name and the exact shares in a table under the chart (15-data-visualization.md section 1a). A platform with nothing to
 * show has no column and says why under its name.
 */
export function ShareColumns({ segments, rows, caption, label }: ShareChartProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <StackedColumnsChart
        height={COLUMNS_HEIGHT}
        label={label}
        segments={segments.map(({ id, name, token }) => ({ id, name, token }))}
        rows={rows.map((row) => {
          const cells = sharesOf(row);
          return {
            id: row.id,
            label: row.label,
            note: row.note,
            shares: cells === null ? null : cells.map((cell) => cell.share),
            tips: cells === null ? [] : cells.map((cell) => cell.tip),
          };
        })}
      />
      <TableOf segments={segments} rows={rows} caption={caption} />
    </div>
  );
}
