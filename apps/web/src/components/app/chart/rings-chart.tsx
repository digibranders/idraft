'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, type ReactElement } from 'react';

import { useElementWidth } from './use-element-width';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ringCenterX, ringsOption, type RingRow, type RingSegment } from '@/lib/charts/rich-rings';
import type { ChartTokens } from '@/lib/design/read-tokens';

// ECharts loads on the client only, after the page; the chart holds its height meanwhile
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

export interface RingsChartRow extends RingRow {
  /** The number in the middle of the ring: "42%". */
  center: string;
  /** What stands behind the number (its counts), read with it by a screen reader and not drawn. */
  centerNote?: string | undefined;
  /** A small line under the name: why a ring is empty ("Not classified"). */
  sub?: string | undefined;
}

export interface RingsChartProps {
  rows: readonly RingsChartRow[];
  segments: readonly RingSegment[];
  /** What the rings show, for people who cannot see them. */
  label: string;
  height: number;
  /** The name of each ring under it (default). A lone ring that a heading already names leaves them out. */
  names?: boolean | undefined;
  /** The number in the middle at the size of a headline figure (`type-metric`), for a lone ring. Default: a section title. */
  emphasis?: boolean | undefined;
}

/**
 * One plain ring per row with its number in the middle and its name below (15-data-visualization.md section 1a). The
 * numbers and names are text in equal columns over and under the canvas, so the page's font and wrapping apply to them.
 */
export function RingsChart({ rows, segments, label, height, names = true, emphasis = false }: RingsChartProps): ReactElement {
  // The caller builds `rows` on every render; the chart redraws, and so animates, only when what it shows changes
  const signature = JSON.stringify([rows.map(({ id, label: name, shares, tips }) => ({ id, name, shares, tips })), segments]);
  const stable = useMemo(
    () => JSON.parse(signature) as [{ id: string; name: string; shares: number[] | null; tips: string[] }[], RingSegment[]],
    [signature],
  );
  const [wrapper, width] = useElementWidth<HTMLDivElement>();
  const option = useCallback(
    (tokens: ChartTokens) =>
      ringsOption({
        width,
        height,
        rows: stable[0].map((row) => ({ id: row.id, label: row.name, shares: row.shares, tips: row.tips })),
        segments: stable[1],
        tokens,
      }),
    [stable, width, height],
  );
  const columns = { gridTemplateColumns: `repeat(${String(rows.length)}, minmax(0, 1fr))` };
  return (
    <div ref={wrapper} role="img" aria-label={label}>
      <div className="relative" style={{ height }}>
        <EChart option={option} height={height} />
        {rows.map((row, index) => (
          <span
            key={row.id}
            className={cn(
              'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 num text-foreground',
              emphasis ? 'type-metric' : 'type-section-title',
            )}
            style={{ left: ringCenterX(index, rows.length) }}
          >
            {row.center}
            {row.centerNote === undefined ? null : <span className="sr-only">, {row.centerNote}</span>}
          </span>
        ))}
      </div>
      {names ? (
        <div className="grid gap-1" style={columns}>
          {rows.map((row) => (
            <span key={row.id} className="min-w-0 text-center type-label break-words text-foreground-secondary">
              {row.label}
              {row.sub === undefined || row.sub === '' ? null : (
                <span className="block type-micro text-foreground-tertiary">{row.sub}</span>
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
